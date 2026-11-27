//! Connected tables: a sheet whose rows come from a connector call, fetched by the server, not typed in.
//!
//! What is stored is the call (`setConnectedTables`), how each column is filled from a field of the fetched records
//! (`setColumnsOfConnectedTable`) and the snapshot the server fetched last (`setSnapshots`), each set by sheet and
//! taken back to what it was. The stored sheet has columns but no rows. Its rows are made when it is read: a
//! heading row of the columns' names, then a row for each record of the snapshot (`row_` and the snapshot's first
//! 12 characters, or `row_nothingfetched` before a fetch, which has one blank row). The records' values are the
//! table file's (`file.rs`), when the page has streamed it to the module; until then the rows are blank.
//!
//! A table file is held for a snapshot by its id, row count, field count and bytes of text: one set to another of
//! them drops the file, one changed in when it was fetched, whether it was cut off or the digest of its call keeps it.
//! A file is held while a sheet not deleted has its snapshot.

pub mod digest;
pub mod file;

use std::borrow::Cow;
use std::rc::Rc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use self::file::{FileValue, TableFile};
use super::formats::Leaf;
use super::layout::written;
use super::load::{Op, Refusal};
use super::{Cell, Input, Sheet, Workbook};
use crate::column_readings::{ColumnReading, NumberAloneIs, Read};
use crate::ids::LineId;

/// The call a connected table fetches its records with.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Call {
    pub title: String,
    pub connector: String,
    pub tool: String,
    pub arguments_as_json: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub follow_up: Option<FollowUp>,
    pub transform: Transform,
}

/// The call made again for the next records, its cursor written in the arguments as `{{cursor}}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FollowUp {
    pub tool: String,
    pub arguments_as_json: String,
}

/// The code that makes the call's answer into records.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "TransformAsWritten", into = "TransformAsWritten")]
pub struct Transform {
    pub source: String,
}

/// A transform as it is written: `{"kind": "code", "source": ...}`, the one kind there is.
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum TransformAsWritten {
    Code { source: String },
}

impl From<TransformAsWritten> for Transform {
    fn from(TransformAsWritten::Code { source }: TransformAsWritten) -> Self {
        Transform { source }
    }
}

impl From<Transform> for TransformAsWritten {
    fn from(Transform { source }: Transform) -> Self {
        TransformAsWritten::Code { source }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectedTable {
    pub call: Call,
}

/// A column of a connected table: its name, and the field it shows.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Column {
    pub name: String,
    pub from: Source,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Source {
    Field {
        field: String,
        /// How the field's texts are read (`null`: as they are).
        #[serde(deserialize_with = "written::maybe_null")]
        reading: Option<ColumnReading>,
    },
}

impl Column {
    pub fn field(&self) -> &str {
        let Source::Field { field, .. } = &self.from;
        field
    }

    pub fn reading(&self) -> Option<&ColumnReading> {
        let Source::Field { reading, .. } = &self.from;
        reading.as_ref()
    }
}

/// What the server fetched last for a connected table.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub snapshot_id: String,
    pub row_count: u32,
    pub field_count: u32,
    pub text_in_bytes: u32,
    pub is_cut_off: bool,
    pub fetched_at_in_seconds_since1970: u32,
    pub call_digest: String,
}

impl Snapshot {
    fn is_well_formed(&self) -> bool {
        is_snapshot_id(&self.snapshot_id) && digest::is_digest(&self.call_digest)
    }

    /// What a table file is held by.
    pub fn key(&self) -> FileKey {
        (self.snapshot_id.clone(), self.row_count, self.field_count, self.text_in_bytes)
    }
}

/// A snapshot's id: 32 digits of lowercase hexadecimal.
pub fn is_snapshot_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub type FileKey = (String, u32, u32, u32);

/// A snapshot's table file: held, or gone from the server.
#[derive(Clone, Debug)]
pub enum Holding {
    Held(Rc<TableFile>),
    Gone,
}

/// A sheet's connected table, as stored.
#[derive(Clone, Debug, Default)]
pub struct OfSheet {
    pub table: Option<ConnectedTable>,
    pub columns: hashbrown::HashMap<LineId, Column>,
    pub snapshot: Option<Snapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectedTableToSet {
    pub sheet_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub connected_table: Option<ConnectedTable>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnToSet {
    pub c: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub column: Option<Column>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotToSet {
    pub sheet_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub snapshot: Option<Snapshot>,
}

impl Op {
    /// Whether a connected table's operation is well formed: no list left empty, every snapshot's id and digest as
    /// they are written (`None`: not one of them).
    pub(super) fn connected_well_formed(&self) -> Option<bool> {
        Some(match self {
            Op::SetConnectedTables { tables } => !tables.is_empty(),
            Op::SetColumnsOfConnectedTable { columns, .. } => !columns.is_empty(),
            Op::SetSnapshots { snapshots } => {
                !snapshots.is_empty() && snapshots.iter().flat_map(|s| &s.snapshot).all(Snapshot::is_well_formed)
            }
            _ => return None,
        })
    }
}

impl Workbook {
    pub(super) fn apply_connected(&mut self, op: &Op) -> Result<Op, Refusal> {
        match op {
            Op::SetConnectedTables { tables } => {
                let mut seen = hashbrown::HashSet::new();
                if !tables.iter().all(|t| seen.insert(t.sheet_id.as_str())) {
                    return Err(Refusal::ConnectedTableNamedTwice);
                }
                let mut old = Vec::with_capacity(tables.len());
                for t in tables {
                    let sheet = self.sheet_mut(&t.sheet_id)?;
                    let was = std::mem::replace(&mut sheet.connected.table, t.connected_table.clone());
                    old.push(ConnectedTableToSet { sheet_id: t.sheet_id.clone(), connected_table: was });
                }
                Ok(Op::SetConnectedTables { tables: old })
            }
            Op::SetColumnsOfConnectedTable { sheet_id, columns } => {
                let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
                let mut seen = hashbrown::HashSet::new();
                if !columns.iter().all(|c| seen.insert(c.c.as_str())) {
                    return Err(Refusal::ColumnNamedTwice);
                }
                let mut lines = Vec::with_capacity(columns.len());
                for c in columns {
                    let line = self.line(&c.c).filter(|&l| self.sheets[index].columns.contains(l)).ok_or(Refusal::UnknownColumn)?;
                    lines.push(line);
                }
                let sheet = &mut self.sheets[index];
                let mut old = Vec::with_capacity(columns.len());
                for (c, line) in columns.iter().zip(lines) {
                    let was = match &c.column {
                        Some(column) => sheet.connected.columns.insert(line, column.clone()),
                        None => sheet.connected.columns.remove(&line),
                    };
                    old.push(ColumnToSet { c: c.c.clone(), column: was });
                }
                Ok(Op::SetColumnsOfConnectedTable { sheet_id: sheet_id.clone(), columns: old })
            }
            Op::SetSnapshots { snapshots } => {
                let mut seen = hashbrown::HashSet::new();
                if !snapshots.iter().all(|s| seen.insert(s.sheet_id.as_str())) {
                    return Err(Refusal::ConnectedTableNamedTwice);
                }
                let mut old = Vec::with_capacity(snapshots.len());
                for s in snapshots {
                    let sheet = self.sheet_mut(&s.sheet_id)?;
                    let was = std::mem::replace(&mut sheet.connected.snapshot, s.snapshot.clone());
                    old.push(SnapshotToSet { sheet_id: s.sheet_id.clone(), snapshot: was });
                }
                Ok(Op::SetSnapshots { snapshots: old })
            }
            _ => unreachable!("not an operation of connected tables"),
        }
    }

    /// Drops the table files no sheet that is not deleted has the snapshot of.
    pub(crate) fn drop_files_not_held(&mut self) {
        if self.table_files.is_empty() {
            return;
        }
        let kept: hashbrown::HashSet<FileKey> =
            self.sheets.iter().filter_map(|s| s.connected.snapshot.as_ref()).map(Snapshot::key).collect();
        self.table_files.retain(|key, _| kept.contains(key));
    }

    /// Whether a sheet not deleted has a snapshot of this id.
    pub fn has_snapshot(&self, snapshot_id: &str) -> bool {
        self.sheets.iter().filter_map(|s| s.connected.snapshot.as_ref()).any(|s| s.snapshot_id == snapshot_id)
    }

    /// Holds a table file for every snapshot of its id on a sheet not deleted.
    pub fn hold_file(&mut self, snapshot_id: &str, file: Rc<TableFile>) {
        let keys: Vec<FileKey> = self.snapshots_of(snapshot_id);
        for key in keys {
            self.table_files.insert(key, Holding::Held(file.clone()));
        }
    }

    /// The server no longer has the table file of the snapshots of this id: those whose file is not held say so.
    pub fn lose_file(&mut self, snapshot_id: &str) {
        for key in self.snapshots_of(snapshot_id) {
            self.table_files.entry(key).or_insert(Holding::Gone);
        }
    }

    fn snapshots_of(&self, snapshot_id: &str) -> Vec<FileKey> {
        self.sheets
            .iter()
            .filter_map(|s| s.connected.snapshot.as_ref())
            .filter(|s| s.snapshot_id == snapshot_id)
            .map(Snapshot::key)
            .collect()
    }

    /// The ids of the snapshots of connected tables not deleted whose table file is neither held nor gone, in the
    /// sheets' order. A file the server narrowed to some fields is not held while a column of its table (not deleted)
    /// reads a field it was not narrowed to.
    pub fn snapshots_not_held(&self) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for sheet in self.sheets.iter().filter(|s| s.connected.table.is_some()) {
            let Some(snapshot) = &sheet.connected.snapshot else { continue };
            let held = match self.table_files.get(&snapshot.key()) {
                None => false,
                Some(Holding::Held(file)) => file.narrowed_to.as_ref().is_none_or(|fields| {
                    sheet
                        .columns
                        .lines()
                        .iter()
                        .filter_map(|l| sheet.connected.columns.get(l))
                        .all(|c| fields.iter().any(|f| f == c.field()))
                }),
                Some(_) => true,
            };
            if !held && !ids.contains(&snapshot.snapshot_id) {
                ids.push(snapshot.snapshot_id.clone());
            }
        }
        ids
    }

    /// The table file held for a sheet's snapshot, if any.
    pub fn holding(&self, sheet: &Sheet) -> Option<&Holding> {
        self.table_files.get(&sheet.connected.snapshot.as_ref()?.key())
    }

    /// Whether an operation saves, on a connected table's sheet, a protection that names some of its cells: a range's,
    /// or a sheet's with open ranges (a sheet's with none, or a protection removed, is free).
    pub fn saves_ranges_on_connected(&self, op: &Op) -> bool {
        let Op::SetProtections { sheet_id, protections } = op else { return false };
        let is_connected = self.sheet_index(sheet_id).is_some_and(|i| self.sheets[i].connected.table.is_some());
        is_connected
            && protections.iter().any(|set| match set.protection.as_ref().map(|p| &p.protects) {
                Some(super::protections::Protects::Range { .. }) => true,
                Some(super::protections::Protects::Sheet { open_ranges }) => !open_ranges.is_empty(),
                None => false,
            })
    }

    /// Whether any sheet not deleted is a connected table.
    pub fn has_connected_tables(&self) -> bool {
        self.sheets.iter().any(|s| s.connected.table.is_some())
    }

    /// The workbook as it is read: each connected table with its rows made (its heading and its records).
    pub fn with_tables(&self) -> Cow<'_, Workbook> {
        if !self.has_connected_tables() {
            return Cow::Borrowed(self);
        }
        let mut shown = self.clone();
        let locale = crate::locale::find(&self.locale).unwrap_or_else(crate::locale::en_us);
        for index in 0..shown.sheets.len() {
            if shown.sheets[index].connected.table.is_none() {
                continue;
            }
            let held = match self.holding(&self.sheets[index]) {
                Some(Holding::Held(file)) => Some(file.clone()),
                _ => None,
            };
            let snapshot = shown.sheets[index].connected.snapshot.clone();
            let (base, count) = match &snapshot {
                Some(s) => (format!("row_{}", &s.snapshot_id[..12]), s.row_count as u64 + 1),
                None => ("row_nothingfetched".to_owned(), 2),
            };
            let base = shown.bases.intern(&base);
            // A sheet has no more than 1048576 rows, the heading's among them, and a row under the heading even when
            // the snapshot has no records.
            let count = count.clamp(2, 1 << 20) as u32;
            let records = match (&snapshot, &held) {
                (Some(s), Some(file)) => records_shown(s, file).min(count as usize - 1),
                _ => 0,
            };
            let sheet = &mut shown.sheets[index];
            sheet.rows = crate::ids::Axis::default();
            let _ = sheet.rows.insert_after(None, base, 0, count);
            sheet.cells.clear();
            let heading = LineId { base, n: 0 };
            let columns: Vec<(LineId, Column)> = sheet
                .columns
                .all()
                .iter()
                .filter_map(|c| Some((*c, sheet.connected.columns.get(c)?.clone())))
                .collect();
            for (c, column) in &columns {
                sheet.cells.insert((heading, *c), Cell::new(Input::Text { value: column.name.clone() }));
                if let Some(pattern) = column.reading().and_then(|r| r.pattern(locale)) {
                    let format = json!({"pattern": pattern});
                    for n in 0..count {
                        sheet.formats.set(Leaf::NumberFormat, (LineId { base, n }, *c), format.clone());
                    }
                }
                let Some(file) = &held else { continue };
                let Some(field) = file.fields.iter().position(|f| f == column.field()) else { continue };
                for row in 0..records {
                    let input = match file.value(field, row) {
                        FileValue::Null => continue,
                        // A number is read as the column reads one: written out as text in a column of texts,
                        // and taken as percents in a column where a number alone is percents.
                        FileValue::Number(n) => match column.reading() {
                            Some(ColumnReading::Text {}) => {
                                Input::Text { value: crate::edited::number_edited_as(*n, "General", locale) }
                            }
                            Some(ColumnReading::Percent { number_alone_is: NumberAloneIs::Percents, .. }) => {
                                Input::Number { value: if *n == 0.0 { 0.0 } else { *n / 100.0 } }
                            }
                            _ => Input::Number { value: if *n == 0.0 { 0.0 } else { *n } },
                        },
                        FileValue::Boolean(b) => Input::Boolean { value: *b },
                        FileValue::Text(t) => match column.reading() {
                            None => Input::Text { value: t.clone() },
                            Some(reading) => match reading.read(t, locale) {
                                Read::Number(n) => Input::Number { value: n },
                                Read::Text(t) => Input::Text { value: t },
                                // A text of nothing but spaces is no cell in a column with a reading.
                                Read::Blank => continue,
                                Read::DoesNotFit => Input::Text { value: t.clone() },
                            },
                        },
                    };
                    sheet.cells.insert((LineId { base, n: row as u32 + 1 }, *c), Cell::new(input));
                }
            }
        }
        Cow::Owned(shown)
    }

    /// A connected table as `readWorkbook` tells it: its call, its columns (those not deleted, in order) and its
    /// snapshot.
    pub(crate) fn connected_table_contents(&self, sheet: &Sheet) -> Option<Json> {
        let table = sheet.connected.table.as_ref()?;
        let columns: Vec<Json> = sheet
            .columns
            .lines()
            .iter()
            .filter_map(|c| Some(json!({"c": self.bases.text(*c), "column": sheet.connected.columns.get(c)?})))
            .collect();
        Some(json!({"call": table.call, "columns": columns, "snapshot": sheet.connected.snapshot}))
    }
}

/// How many of a file's records a snapshot shows: as many as the snapshot has, so long as they hold no more values
/// (records by the file's fields) and no more bytes of text than the snapshot counted.
pub fn records_shown(snapshot: &Snapshot, file: &TableFile) -> usize {
    records_within_budget(snapshot, file).min(snapshot.row_count as usize)
}

/// How many of a file's records hold no more values and no more bytes of text than the snapshot counted, however
/// many records it has (`readConnectedTable`'s `rowCount`).
pub fn records_within_budget(snapshot: &Snapshot, file: &TableFile) -> usize {
    let most = file.row_count;
    let values = snapshot.row_count as u64 * snapshot.field_count as u64;
    let fields = file.fields.len() as u64;
    let mut bytes = 0u64;
    for row in 0..most {
        bytes += file.text_in_bytes_of_row(row);
        if (row as u64 + 1) * fields > values || bytes > snapshot.text_in_bytes as u64 {
            return row;
        }
    }
    most
}

/// The rows of a connected table as `readConnectedTable` tells them.
pub(crate) fn rows_contents(workbook: &Workbook, sheet: &Sheet) -> Json {
    let Some(snapshot) = &sheet.connected.snapshot else { return json!({"kind": "notFetched"}) };
    match workbook.holding(sheet) {
        None => json!({"kind": "notHeld"}),
        Some(Holding::Gone) => json!({"kind": "notKept"}),
        Some(Holding::Held(file)) => {
            json!({"kind": "held", "rowCount": records_within_budget(snapshot, file), "fields": file.fields})
        }
    }
}

/// A column's name as a structured reference writes it: `[`, `]`, `#` and `'` each after a `'`.
pub fn column_name_text(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if matches!(c, '[' | ']' | '#' | '\'') {
            out.push('\'');
        }
        out.push(c);
    }
    out
}

/// The reference to a connected table's column, as `readConnectedTable` gives it: `Customers[Id]`.
pub fn column_reference_text(table: &str, column: &str) -> String {
    format!("{}[{}]", table_name_text(table), column_name_text(column))
}

/// A connected table's name as a reference writes it: as it is, or between quotes (a quote in it written twice) when
/// it starts with a digit or a point or holds a character of ASCII other than a letter, a digit, `_` or a point.
/// Other characters never need the quotes.
pub fn table_name_text(name: &str) -> String {
    let plain = !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit() || c == '.')
        && name.chars().all(|c| !c.is_ascii() || c.is_ascii_alphanumeric() || c == '_' || c == '.');
    if plain {
        name.to_owned()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}
