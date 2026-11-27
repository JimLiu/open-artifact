//! The edits of connected tables (`workbook/connected.rs`): adding one as a new sheet (`addConnectedTable`), changing
//! its call (`setCallOfConnectedTable`), and adding or changing a column (`addColumnToConnectedTable`,
//! `changeColumnOfConnectedTable`). Also how a connected table's sheet refuses the edits of other sheets: its cells
//! come from its records, so nothing is typed, pasted or formatted into them, and no row is added, sized or grouped
//! (`sheetIsAConnectedTable`); a column is added only with what it shows (`columnNotDescribed`).
//!
//! A call is checked as the page sends it: a title, a connector and a tool, each a name of no more than 200
//! characters; arguments that are a JSON object, with no placeholder but `{{cursor}}` in a follow-up's texts; code to
//! transform the answer; no character that draws nothing; and no more than 16384 bytes in all.

use serde::Deserialize;
use serde_json::Value as Json;

use super::{cells, formats, lines, tables, Edit as AnyEdit, Made, Refused};
use crate::ids::IdRun;
use crate::session::place::Place;
use crate::workbook::connected::{Call, Column, ColumnToSet, ConnectedTable, ConnectedTableToSet};
use crate::workbook::load::Op;
use crate::workbook::{Sheet, Workbook};

/// The longest a name in a connected table may be, in characters: its call's title, connector and tool, and its
/// columns' names (`limits.longestNameInAConnectedTableInCharacters`).
const LONGEST_NAME: usize = 200;
/// The longest a field's name may be, in bytes.
const LONGEST_FIELD: usize = 128;
/// The most bytes a call takes, written as JSON.
const LARGEST_CALL: usize = 16_384;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    AddConnectedTable {
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        after_sheet: Option<String>,
        name: String,
        call: Call,
        columns: Vec<Column>,
    },
    #[serde(rename_all = "camelCase")]
    SetCallOfConnectedTable { sheet_id: String, call: Call },
    #[serde(rename_all = "camelCase")]
    AddColumnToConnectedTable {
        sheet_id: String,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        after: Option<String>,
        column: Column,
    },
    #[serde(rename_all = "camelCase")]
    ChangeColumnOfConnectedTable { sheet_id: String, c: String, column: Column },
}

/// The edit as the session reads it: a new table has at least one column.
pub fn read(edit: &Json) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    match &edit {
        Edit::AddConnectedTable { columns, .. } if columns.is_empty() => None,
        _ => Some(edit),
    }
}

pub fn make(workbook: &Workbook, edit: Edit, code: &str) -> Result<Made, Refused> {
    match edit {
        Edit::AddConnectedTable { after_sheet, name, call, columns } => {
            let name = super::tables::duplicate::copy_name(workbook, &name).ok_or(Refused::Because("sheetNameNotAllowed"))?;
            columns.iter().try_for_each(check_column)?;
            check_call(&call)?;
            // The table's sheet may follow a deleted one, as a sheet added may.
            if after_sheet.as_ref().is_some_and(|after| !workbook.sheet_order.contains(after)) {
                return Err(Refused::Because("unknownSheet"));
            }
            for (n, column) in columns.iter().enumerate() {
                check_column_among(column, columns[..n].iter())?;
            }
            let sheet_id = format!("sht_{code}.0");
            let base = format!("col_{code}");
            let described = columns
                .into_iter()
                .enumerate()
                .map(|(n, column)| ColumnToSet { c: format!("{base}.{n}"), column: Some(column) })
                .collect::<Vec<_>>();
            let count = described.len() as u32;
            Ok(Made {
                ops: vec![
                    Op::InsertSheet { sheet_id: sheet_id.clone(), name, after: after_sheet },
                    Op::InsertColumns { sheet_id: sheet_id.clone(), after: None, columns: IdRun { base, first: 0, count } },
                    Op::SetColumnsOfConnectedTable { sheet_id: sheet_id.clone(), columns: described },
                    Op::SetConnectedTables {
                        tables: vec![ConnectedTableToSet { sheet_id: sheet_id.clone(), connected_table: Some(ConnectedTable { call }) }],
                    },
                ],
                place: Some(Place::sheet(&sheet_id)),
            })
        }
        Edit::SetCallOfConnectedTable { sheet_id, call } => {
            let sheet = connected_sheet(workbook, &sheet_id)?;
            check_call(&call)?;
            if sheet.connected.table.as_ref().is_some_and(|t| t.call == call) {
                return Ok(Made::nothing());
            }
            Ok(Made::ops(vec![Op::SetConnectedTables {
                tables: vec![ConnectedTableToSet { sheet_id, connected_table: Some(ConnectedTable { call }) }],
            }]))
        }
        Edit::AddColumnToConnectedTable { sheet_id, after, column } => {
            let sheet = connected_sheet(workbook, &sheet_id)?;
            check_column(&column)?;
            let base = format!("col_{code}");
            // The new column's id held already is refused before the column it follows is looked for, and before its
            // name or field is compared with the others'.
            let line = workbook.bases.parse(&format!("{base}.0"));
            if line.is_some_and(|l| workbook.sheets.iter().chain(&workbook.deleted_sheets).any(|s| s.columns.knows(l))) {
                return Err(Refused::Because("idAlreadyHeld"));
            }
            // The new column may follow a deleted one: it goes where that one was.
            if let Some(after) = &after {
                workbook
                    .bases
                    .parse(after)
                    .filter(|l| sheet.columns.knows(*l))
                    .ok_or(Refused::Because("unknownColumn"))?;
            }
            check_column_among(&column, live_columns(sheet))?;
            Ok(Made::ops(vec![
                Op::InsertColumns { sheet_id: sheet_id.clone(), after, columns: IdRun { base: base.clone(), first: 0, count: 1 } },
                Op::SetColumnsOfConnectedTable {
                    sheet_id,
                    columns: vec![ColumnToSet { c: format!("{base}.0"), column: Some(column) }],
                },
            ]))
        }
        Edit::ChangeColumnOfConnectedTable { sheet_id, c, column } => {
            let sheet = connected_sheet(workbook, &sheet_id)?;
            check_column(&column)?;
            let line = live_column(workbook, sheet, &c)?;
            if sheet.connected.columns.get(&line) == Some(&column) {
                return Ok(Made::nothing());
            }
            let others = sheet
                .columns
                .lines()
                .iter()
                .filter(|&&l| l != line)
                .filter_map(|l| sheet.connected.columns.get(l));
            check_column_among(&column, others)?;
            Ok(Made::ops(vec![Op::SetColumnsOfConnectedTable {
                sheet_id,
                columns: vec![ColumnToSet { c, column: Some(column) }],
            }]))
        }
    }
}

/// A sheet that is a connected table.
fn connected_sheet<'a>(workbook: &'a Workbook, sheet_id: &str) -> Result<&'a Sheet, Refused> {
    let i = workbook.sheet_index(sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    let sheet = &workbook.sheets[i];
    if sheet.connected.table.is_none() {
        return Err(Refused::Because("notAConnectedTable"));
    }
    Ok(sheet)
}

fn live_column(workbook: &Workbook, sheet: &Sheet, c: &str) -> Result<crate::ids::LineId, Refused> {
    workbook.bases.parse(c).filter(|l| sheet.columns.contains(*l)).ok_or(Refused::Because("unknownColumn"))
}

/// The columns of a table not deleted, as they are described.
fn live_columns(sheet: &Sheet) -> impl Iterator<Item = &Column> + Clone {
    sheet.columns.lines().iter().filter_map(|l| sheet.connected.columns.get(l))
}

/// Whether a text is a name in a connected table (a call's title, connector or tool, or a column's name): not empty,
/// no longer than 200 characters, with no space at either end and no control character.
fn is_name(text: &str) -> bool {
    !text.is_empty()
        && text.chars().count() <= LONGEST_NAME
        && !text.chars().any(char::is_control)
        && !text.starts_with(char::is_whitespace)
        && !text.ends_with(char::is_whitespace)
}

/// Whether a text names a field of the records: not empty, no longer than 128 bytes and with no control character.
/// Spaces at its ends are the field's.
fn is_field(text: &str) -> bool {
    !text.is_empty() && text.len() <= LONGEST_FIELD && !text.chars().any(char::is_control)
}

/// A column checked on its own: its name, its field, and how the field is read.
fn check_column(column: &Column) -> Result<(), Refused> {
    if !is_name(&column.name) {
        return Err(Refused::Because("nameOfColumnNotAllowed"));
    }
    if !is_field(column.field()) {
        return Err(Refused::Because("nameOfFieldNotAllowed"));
    }
    if let Some(crate::column_readings::ColumnReading::Dropdown { .. }) = column.reading() {
        return Err(Refused::Because("fieldReadAsDropdown"));
    }
    Ok(())
}

/// A column checked against the others of its table: no other has its name, whatever its case, or shows its field.
fn check_column_among<'a>(column: &Column, others: impl Iterator<Item = &'a Column> + Clone) -> Result<(), Refused> {
    let name = column.name.to_lowercase();
    if others.clone().any(|o| o.name.to_lowercase() == name) {
        return Err(Refused::Because("nameOfColumnTaken"));
    }
    if others.into_iter().any(|o| o.field() == column.field()) {
        return Err(Refused::Because("fieldShownTwice"));
    }
    Ok(())
}

/// A call checked in turn: its size, its title, its connector and tools, its code, its arguments, then every text of
/// it for a character that draws nothing.
fn check_call(call: &Call) -> Result<(), Refused> {
    let because = |why| Err(Refused::Because(why));
    if serde_json::to_string(call).map_or(true, |json| json.len() > LARGEST_CALL) {
        return because("callTooLarge");
    }
    if !is_name(&call.title) {
        return because("titleOfCallNotAllowed");
    }
    let tools = std::iter::once(&call.tool).chain(call.follow_up.as_ref().map(|f| &f.tool));
    if !is_name(&call.connector) || !tools.into_iter().all(|t| is_name(t)) {
        return because("nameOfConnectorOrToolNotAllowed");
    }
    let source = &call.transform.source;
    if source.trim().is_empty() || source.chars().any(is_control_but_a_line_break) {
        return because("transformNotAllowed");
    }
    let mut texts = check_arguments(&call.arguments_as_json, false)?;
    if let Some(follow_up) = &call.follow_up {
        texts.extend(check_arguments(&follow_up.arguments_as_json, true)?);
    }
    let names = [&call.title, &call.connector, &call.tool, source].into_iter().map(String::as_str);
    let tool = call.follow_up.iter().map(|f| f.tool.as_str());
    if names.chain(tool).chain(texts.iter().map(String::as_str)).any(|t| t.chars().any(draws_nothing)) {
        return because("callHoldsACharacterThatDrawsNothing");
    }
    Ok(())
}

/// Whether a character is a control character other than a tab, a line feed or a carriage return.
fn is_control_but_a_line_break(c: char) -> bool {
    c < ' ' && !matches!(c, '\t' | '\n' | '\r')
}

/// Arguments: a JSON object, no key in it twice, no control character in its texts but a tab or a line break, and no
/// placeholder (`{{` and a name, spaces or tabs around it, then `}}`) but, in a follow-up's values, `{{cursor}}`.
/// Answers the object's keys and texts.
fn check_arguments(text: &str, is_follow_up: bool) -> Result<Vec<String>, Refused> {
    let not_an_object = Err(Refused::Because("argumentsNotAJsonObject"));
    let Some(arguments) = json_without_repeated_keys(text).filter(Json::is_object) else { return not_an_object };
    fn texts(value: &Json, out: &mut Vec<(String, bool)>) {
        match value {
            Json::String(s) => out.push((s.clone(), false)),
            Json::Array(items) => items.iter().for_each(|v| texts(v, out)),
            Json::Object(map) => {
                for (k, v) in map {
                    out.push((k.clone(), true));
                    texts(v, out);
                }
            }
            _ => {}
        }
    }
    let mut found = Vec::new();
    texts(&arguments, &mut found);
    if found.iter().any(|(text, _)| text.chars().any(is_control_but_a_line_break)) {
        return not_an_object;
    }
    for (text, is_key) in &found {
        let allowed = |name: &str| is_follow_up && !is_key && name == "cursor";
        if placeholders(text).any(|name| !allowed(name)) {
            return Err(Refused::Because("placeholderNotAllowed"));
        }
    }
    Ok(found.into_iter().map(|(text, _)| text).collect())
}

/// The names of the placeholders in a text: `{{`, spaces or tabs, a name (a letter or `_`, then letters, digits or
/// `_`, in ASCII), spaces or tabs, `}}`.
fn placeholders(text: &str) -> impl Iterator<Item = &str> {
    let bytes = text.as_bytes();
    (0..bytes.len()).filter_map(move |start| {
        let rest = bytes.get(start..)?.strip_prefix(b"{{")?;
        let blank = |b: &u8| matches!(b, b' ' | b'\t');
        let lead = rest.iter().take_while(|b| blank(b)).count();
        let rest = &rest[lead..];
        let first = *rest.first()?;
        if !(first.is_ascii_alphabetic() || first == b'_') {
            return None;
        }
        let len = rest.iter().take_while(|b| b.is_ascii_alphanumeric() || **b == b'_').count();
        let after = &rest[len..];
        let trail = after.iter().take_while(|b| blank(b)).count();
        after[trail..].starts_with(b"}}").then(|| {
            let from = start + 2 + lead;
            &text[from..from + len]
        })
    })
}

/// JSON read as arguments are read: an object with a key twice is not read.
fn json_without_repeated_keys(text: &str) -> Option<Json> {
    struct Unique(Json);
    impl<'de> Deserialize<'de> for Unique {
        fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            struct Visitor;
            impl<'de> serde::de::Visitor<'de> for Visitor {
                type Value = Unique;
                fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                    f.write_str("JSON")
                }
                fn visit_bool<E>(self, v: bool) -> Result<Unique, E> {
                    Ok(Unique(Json::Bool(v)))
                }
                fn visit_i64<E>(self, v: i64) -> Result<Unique, E> {
                    Ok(Unique(v.into()))
                }
                fn visit_u64<E>(self, v: u64) -> Result<Unique, E> {
                    Ok(Unique(v.into()))
                }
                fn visit_f64<E>(self, v: f64) -> Result<Unique, E> {
                    Ok(Unique(serde_json::Number::from_f64(v).map_or(Json::Null, Json::Number)))
                }
                fn visit_str<E>(self, v: &str) -> Result<Unique, E> {
                    Ok(Unique(Json::String(v.to_owned())))
                }
                fn visit_string<E>(self, v: String) -> Result<Unique, E> {
                    Ok(Unique(Json::String(v)))
                }
                fn visit_unit<E>(self) -> Result<Unique, E> {
                    Ok(Unique(Json::Null))
                }
                fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Unique, A::Error> {
                    let mut items = Vec::new();
                    while let Some(Unique(v)) = seq.next_element()? {
                        items.push(v);
                    }
                    Ok(Unique(Json::Array(items)))
                }
                fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Unique, A::Error> {
                    let mut out = serde_json::Map::new();
                    while let Some(key) = map.next_key::<String>()? {
                        let Unique(v) = map.next_value()?;
                        if out.insert(key, v).is_some() {
                            return Err(serde::de::Error::custom("a key twice"));
                        }
                    }
                    Ok(Unique(Json::Object(out)))
                }
            }
            d.deserialize_any(Visitor)
        }
    }
    serde_json::from_str::<Unique>(text).ok().map(|u| u.0)
}

/// Whether a character draws nothing: one Unicode leaves out of what is drawn unless it is supported
/// (Default_Ignorable_Code_Point), a control character other than a tab or a line feed, a line or paragraph
/// separator, or an interlinear annotation mark.
fn draws_nothing(c: char) -> bool {
    let default_ignorable = matches!(c as u32,
        0x00AD | 0x034F | 0x061C | 0x115F..=0x1160 | 0x17B4..=0x17B5 | 0x180B..=0x180F | 0x200B..=0x200F
        | 0x202A..=0x202E | 0x2060..=0x206F | 0x3164 | 0xFE00..=0xFE0F | 0xFEFF | 0xFFA0 | 0xFFF0..=0xFFF8
        | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF);
    default_ignorable || (c.is_control() && !matches!(c, '\t' | '\n')) || matches!(c, '\u{2028}' | '\u{2029}' | '\u{FFF9}'..='\u{FFFB}')
}

/// Whether a sheet is a connected table.
fn is_connected(workbook: &Workbook, sheet_id: &str) -> bool {
    workbook.sheet_index(sheet_id).is_some_and(|i| workbook.sheets[i].connected.table.is_some())
}

/// The formulas an edit of cells puts in, refused when they name a connected table's cells by address
/// (`Customers!A1`): its cells are read by its name and its columns' (`Customers[Id]`).
pub(super) fn check_formulas(workbook: &Workbook, ops: &[Op]) -> Result<(), Refused> {
    use crate::formula::Reference;
    let by_address = |reference: &Reference| {
        !matches!(reference, Reference::TableColumn { .. } | Reference::TablePart { .. })
            && is_connected(workbook, reference.sheet_id())
    };
    let named = ops.iter().any(|op| match op {
        Op::SetCells { cells, .. } => cells.iter().any(|cell| {
            matches!(&cell.input, Some(crate::workbook::Input::Formula { formula }) if formula.references.iter().any(by_address))
        }),
        _ => false,
    });
    if named {
        return Err(Refused::Because("connectedTableNamedByAddress"));
    }
    Ok(())
}

/// Whether an edit deletes or hides rows of a connected table's sheet: its rows are found among the table's, and
/// nothing changes.
pub(super) fn rows_of_table(workbook: &Workbook, edit: &AnyEdit) -> bool {
    match edit {
        AnyEdit::Lines(lines::Edit::DeleteRows { sheet_id, .. } | lines::Edit::HideRows { sheet_id, .. }) => {
            is_connected(workbook, sheet_id)
        }
        _ => false,
    }
}

/// Whether an edit is made on the workbook as it is read, with the rows of its connected tables: the clipboard's
/// edits, fitting columns to what they show, sorting rows or cells and moving columns of cells, and saving a
/// protection, default values or a named range (their cells are found among the table's).
pub(super) fn is_made_as_read(edit: &AnyEdit) -> bool {
    matches!(
        edit,
        AnyEdit::Clipboard(_)
            | AnyEdit::Lines(lines::Edit::FitColumns { .. })
            | AnyEdit::Protections(_)
            | AnyEdit::Defaults(_)
            | AnyEdit::NamedRanges(_)
            | AnyEdit::Tables(
                tables::Edit::SortRows { .. } | tables::Edit::SortCells { .. } | tables::Edit::MoveColumnsOfCells { .. }
            )
    )
}

/// Whether an edit sorts the rows of a connected table's sheet: found among the table's rows, they are put in order
/// there, and a new order is refused as rows the sheet does not hold (`unknownRow`), before any protection.
pub(super) fn sorts_rows_of_table(workbook: &Workbook, edit: &AnyEdit) -> bool {
    matches!(edit, AnyEdit::Tables(tables::Edit::SortRows { sheet_id, .. }) if is_connected(workbook, sheet_id))
}

/// An edit of another family refused before it is made, on a connected table's sheet: its cells are not typed, pasted,
/// formatted or merged, and its rows are not added or sized.
pub(super) fn check_edit(workbook: &Workbook, edit: &AnyEdit) -> Result<(), Refused> {
    let sheet_id = match edit {
        AnyEdit::Cells(edit) => {
            let json = match edit {
                cells::Edit::Enter(j)
                | cells::Edit::EnterInCells(j)
                | cells::Edit::EnterTextWithLooksInCells(j)
                | cells::Edit::PasteTexts(j)
                | cells::Edit::PasteRowsOfTexts(j)
                | cells::Edit::ClearCells(j)
                | cells::Edit::People(j)
                | cells::Edit::ListLine(j) => j,
            };
            ["sheetId", "/cells/sheetId", "/selected/sheetId"]
                .iter()
                .find_map(|p| if p.starts_with('/') { json.pointer(p) } else { json.get(p) })
                .and_then(Json::as_str)
        }
        AnyEdit::Formats(formats::Edit::FormatCells { cells, .. } | formats::Edit::MergeCells { cells }) => {
            Some(cells.sheet_id())
        }
        AnyEdit::Lines(lines::Edit::InsertRows { sheet_id, .. } | lines::Edit::SetRowHeights { sheet_id, .. }) => {
            Some(sheet_id.as_str())
        }
        _ => None,
    };
    match sheet_id {
        Some(sheet_id) if is_connected(workbook, sheet_id) => Err(Refused::Because("sheetIsAConnectedTable")),
        _ => Ok(()),
    }
}

/// Rows an edit inserts, as a protection checks them when the edit is refused on a connected table's sheet before it
/// is made: a sheet's protection refuses them first, wherever they go.
pub(super) fn rows_inserted(edit: &AnyEdit, code: &str) -> Option<Op> {
    match edit {
        AnyEdit::Lines(lines::Edit::InsertRows { sheet_id, count, .. }) => Some(Op::InsertRows {
            sheet_id: sheet_id.clone(),
            after: None,
            rows: IdRun { base: format!("row_{code}"), first: 0, count: *count },
        }),
        _ => None,
    }
}

/// The operations of an edit of another family, refused on a connected table's sheet when they change its cells or its
/// rows, group its columns, hide its gridlines or save a protection of some of its cells (a named range of its cells,
/// `connectedTableNamedByAddress`); a column inserted into one
/// is refused unless the edit says what it shows. Refused, the place of the operation refused too.
pub(super) fn check_ops(workbook: &Workbook, ops: &[Op]) -> Result<(), (usize, Refused)> {
    let made_connected = |sheet_id: &str| {
        ops.iter().any(|op| {
            matches!(op, Op::SetConnectedTables { tables }
                if tables.iter().any(|t| t.sheet_id == sheet_id && t.connected_table.is_some()))
        })
    };
    for (i, op) in ops.iter().enumerate() {
        let refused = |why: &'static str| Err((i, Refused::Because(why)));
        let sheet_id = match op {
            Op::SetCells { sheet_id, .. }
            | Op::SetCellFormats { sheet_id, .. }
            | Op::MergeCells { sheet_id, .. }
            | Op::SetRowHeights { sheet_id, .. }
            | Op::InsertRows { sheet_id, .. }
            | Op::MoveRows { sheet_id, .. }
            | Op::ReorderRows { sheet_id, .. }
            | Op::SetRowGroups { sheet_id, .. }
            | Op::SetColumnGroups { sheet_id, .. }
            | Op::SetCellTables { sheet_id, .. }
            | Op::SetDropdowns { sheet_id, .. }
            | Op::SetConditionalFormats { sheet_id, .. } => sheet_id,
            Op::SetSheetSettings { sheets } => {
                match sheets.iter().find(|s| s.settings.are_gridlines_hidden.is_some() && is_connected(workbook, &s.sheet_id)) {
                    Some(_) => return refused("sheetIsAConnectedTable"),
                    None => continue,
                }
            }
            Op::SetProtections { .. } if workbook.saves_ranges_on_connected(op) => return refused("sheetIsAConnectedTable"),
            Op::SetNamedRanges { named_ranges } => {
                let on_connected = |set: &crate::workbook::named_ranges::NamedRangeToSet| {
                    set.named_range.as_ref().is_some_and(|range| is_connected(workbook, range.cells.sheet_id()))
                };
                match named_ranges.iter().any(on_connected) {
                    true => return refused("connectedTableNamedByAddress"),
                    false => continue,
                }
            }
            Op::InsertColumns { sheet_id, columns, .. } => {
                if is_connected(workbook, sheet_id) || made_connected(sheet_id) {
                    // Or deleted by the same edit (a copy's deleted columns).
                    let described = |n: u32| {
                        let id = format!("{}.{n}", columns.base);
                        ops.iter().any(|op| match op {
                            Op::SetColumnsOfConnectedTable { sheet_id: s, columns: set } => {
                                s == sheet_id && set.iter().any(|c| c.c == id && c.column.is_some())
                            }
                            Op::DeleteColumns { sheet_id: s, columns: runs } => {
                                s == sheet_id
                                    && runs.iter().any(|r| r.base == columns.base && (r.first..r.first.saturating_add(r.count)).contains(&n))
                            }
                            _ => false,
                        })
                    };
                    if !(columns.first..columns.first.saturating_add(columns.count)).all(described) {
                        return refused("columnNotDescribed");
                    }
                }
                continue;
            }
            _ => continue,
        };
        if is_connected(workbook, sheet_id) {
            return refused("sheetIsAConnectedTable");
        }
    }
    Ok(())
}
