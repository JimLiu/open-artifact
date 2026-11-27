//! Named ranges (format 51): names for a workbook's cells, which formulas read by name (`Reference::NamedRange`).
//!
//! One operation sets them, `setNamedRanges`: each by its id, `null` removing it. It checks nothing but that no id
//! is named twice: a name nobody could type, cells on a sheet the workbook doesn't have, are kept as given, and a
//! range whose cells are gone reads `#REF!`. Its cells are kept by the ids of their rows and columns, never written
//! again, and found as a formula's reference finds its own (`Workbook::locate`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use super::layout::{id_key, written, CellIds};
use super::load::{Op, Refusal};
use super::{sheet_name_text, Workbook};
use crate::formula::{column_letters, CellPoint, ColumnPoint, Reference, RowPoint};

/// The most named ranges a workbook holds.
pub const MOST_NAMED_RANGES: usize = 1000;
/// The longest name of a named range, in characters.
pub const LONGEST_NAME: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedRange {
    pub name: String,
    pub cells: CellsOfANamedRange,
}

/// A named range's cells: a range of cells (one cell is a range of one), columns (from a row down, `top`) or rows
/// (from a column right, `left`). No end is fixed (`$`): a name reads the same cells wherever it is written.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CellsOfANamedRange {
    #[serde(rename_all = "camelCase")]
    Range { sheet_id: String, top_left: CellIds, bottom_right: CellIds },
    #[serde(rename_all = "camelCase")]
    Columns {
        sheet_id: String,
        left: String,
        right: String,
        #[serde(deserialize_with = "written::maybe_null")]
        top: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Rows {
        sheet_id: String,
        top: String,
        bottom: String,
        #[serde(deserialize_with = "written::maybe_null")]
        left: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedRangeToSet {
    pub named_range_id: String,
    #[serde(deserialize_with = "written::maybe_null")]
    pub named_range: Option<NamedRange>,
}

/// A named range as a snapshot's `namedRanges` line holds it: there, never `null`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedRangeEntry {
    pub named_range_id: String,
    pub named_range: NamedRange,
}

impl From<NamedRangeEntry> for NamedRangeToSet {
    fn from(entry: NamedRangeEntry) -> Self {
        NamedRangeToSet { named_range_id: entry.named_range_id, named_range: Some(entry.named_range) }
    }
}

impl CellsOfANamedRange {
    pub fn sheet_id(&self) -> &str {
        match self {
            CellsOfANamedRange::Range { sheet_id, .. }
            | CellsOfANamedRange::Columns { sheet_id, .. }
            | CellsOfANamedRange::Rows { sheet_id, .. } => sheet_id,
        }
    }

    /// The cells as a formula's reference to them, no end fixed: a range whose corners are the same cell is that
    /// cell (one whose corners differ stays a range, even once rows or columns between them are deleted).
    pub fn as_reference(&self) -> Reference {
        let cell = |at: &CellIds| CellPoint { r: at.r.clone(), is_row_absolute: false, c: at.c.clone(), is_column_absolute: false };
        let row = |r: &String| RowPoint { r: r.clone(), is_row_absolute: false };
        let column = |c: &String| ColumnPoint { c: c.clone(), is_column_absolute: false };
        match self {
            CellsOfANamedRange::Range { sheet_id, top_left, bottom_right } if top_left == bottom_right => {
                Reference::Cell { sheet_id: sheet_id.clone(), cell: cell(top_left) }
            }
            CellsOfANamedRange::Range { sheet_id, top_left, bottom_right } => Reference::Range {
                sheet_id: sheet_id.clone(),
                top_left: cell(top_left),
                bottom_right: cell(bottom_right),
            },
            CellsOfANamedRange::Columns { sheet_id, left, right, top } => Reference::Columns {
                sheet_id: sheet_id.clone(),
                left: column(left),
                right: column(right),
                top: top.as_ref().map(row),
            },
            CellsOfANamedRange::Rows { sheet_id, top, bottom, left } => Reference::Rows {
                sheet_id: sheet_id.clone(),
                top: row(top),
                bottom: row(bottom),
                left: left.as_ref().map(column),
            },
        }
    }

    /// The cells as a reference with every end fixed (`$C$2`, `$B$3:$C`): how a formula writes a named range whose
    /// name a LET or a LAMBDA gives a value to where it is.
    pub fn as_fixed_reference(&self) -> Reference {
        let mut reference = self.as_reference();
        match &mut reference {
            Reference::Cell { cell, .. } => (cell.is_row_absolute, cell.is_column_absolute) = (true, true),
            Reference::Range { top_left, bottom_right, .. } => {
                for p in [top_left, bottom_right] {
                    (p.is_row_absolute, p.is_column_absolute) = (true, true);
                }
            }
            Reference::Columns { left, right, top, .. } => {
                (left.is_column_absolute, right.is_column_absolute) = (true, true);
                if let Some(top) = top {
                    top.is_row_absolute = true;
                }
            }
            Reference::Rows { top, bottom, left, .. } => {
                (top.is_row_absolute, bottom.is_row_absolute) = (true, true);
                if let Some(left) = left {
                    left.is_column_absolute = true;
                }
            }
            Reference::NamedRange { .. } | Reference::TableColumn { .. } | Reference::TablePart { .. } => {}
        }
        reference
    }

    /// The cells a formula's reference names (as typed: its ends in order), its `$` aside.
    pub fn of_reference(reference: &Reference) -> Option<CellsOfANamedRange> {
        let ids = |p: &CellPoint| CellIds { r: p.r.clone(), c: p.c.clone() };
        Some(match reference {
            Reference::Cell { sheet_id, cell } => {
                CellsOfANamedRange::Range { sheet_id: sheet_id.clone(), top_left: ids(cell), bottom_right: ids(cell) }
            }
            Reference::Range { sheet_id, top_left, bottom_right } => CellsOfANamedRange::Range {
                sheet_id: sheet_id.clone(),
                top_left: ids(top_left),
                bottom_right: ids(bottom_right),
            },
            Reference::Columns { sheet_id, left, right, top } => CellsOfANamedRange::Columns {
                sheet_id: sheet_id.clone(),
                left: left.c.clone(),
                right: right.c.clone(),
                top: top.as_ref().map(|t| t.r.clone()),
            },
            Reference::Rows { sheet_id, top, bottom, left } => CellsOfANamedRange::Rows {
                sheet_id: sheet_id.clone(),
                top: top.r.clone(),
                bottom: bottom.r.clone(),
                left: left.as_ref().map(|l| l.c.clone()),
            },
            Reference::NamedRange { .. } | Reference::TableColumn { .. } | Reference::TablePart { .. } => return None,
        })
    }
}

/// Whether a name may be given to a named range (trimmed first): 1 to 100 characters, a letter or `_` first and then
/// letters, digits, `_` and `.` (any script's), but not TRUE or FALSE, nothing starting with `_xl`, nor anything
/// written as a cell (letters and digits, `FY2024` too) or in R1C1 (`R`, `C`, `R1C1`, `RC2`, `C3R`, …), whatever
/// its case.
pub fn name_is_allowed(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else { return false };
    if name.chars().count() > LONGEST_NAME
        || !(first.is_alphabetic() || first == '_')
        || !chars.all(|c| c.is_alphabetic() || c.is_numeric() || matches!(c, '_' | '.'))
    {
        return false;
    }
    if name.eq_ignore_ascii_case("true") || name.eq_ignore_ascii_case("false") {
        return false;
    }
    if name.get(..3).is_some_and(|head| head.eq_ignore_ascii_case("_xl")) {
        return false;
    }
    !is_written_as_a_cell(name) && !is_written_in_r1c1(name)
}

/// One to three ASCII letters and then ASCII digits, as many as there are.
fn is_written_as_a_cell(name: &str) -> bool {
    let letters = name.bytes().take_while(u8::is_ascii_alphabetic).count();
    let digits = &name[letters..];
    (1..=3).contains(&letters) && !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// `R` and digits, then perhaps `C` and digits; or `C` and digits, then perhaps `R` and digits (in any case).
fn is_written_in_r1c1(name: &str) -> bool {
    let bytes = name.as_bytes();
    let digits = |from: usize| from + bytes[from..].iter().take_while(|b| b.is_ascii_digit()).count();
    let letter = |at: usize, l: u8| bytes.get(at).is_some_and(|b| b.to_ascii_uppercase() == l);
    let second = match bytes.first().map(u8::to_ascii_uppercase) {
        Some(b'R') => b'C',
        Some(b'C') => b'R',
        _ => return false,
    };
    let mut at = digits(1);
    if letter(at, second) {
        at = digits(at + 1);
    }
    at == bytes.len()
}

/// A named range's cells as the page writes them: `Data!A1` (its corners the same cell), `Data!A1:B3` (`A1:A1` once
/// the rows between differing corners are deleted), `'My Sheet'!A:B`, `Data!A2:B`, `Data!1:3`,
/// `Data!B2:3`.
fn address(workbook: &Workbook, cells: &CellsOfANamedRange) -> Option<(String, Json)> {
    let at = workbook.locate(&cells.as_reference())?;
    let sheet = &workbook.sheets[at.sheet];
    let (top, bottom, left, right) = (at.top.0, at.bottom.0, at.left.0, at.right.0);
    let text = match cells {
        CellsOfANamedRange::Range { top_left, bottom_right, .. } if top_left == bottom_right => {
            format!("{}{}", column_letters(left), top + 1)
        }
        CellsOfANamedRange::Range { .. } => {
            format!("{}{}:{}{}", column_letters(left), top + 1, column_letters(right), bottom + 1)
        }
        CellsOfANamedRange::Columns { top: from, .. } => {
            let from = if from.is_some() { (top + 1).to_string() } else { String::new() };
            format!("{}{from}:{}", column_letters(left), column_letters(right))
        }
        CellsOfANamedRange::Rows { left: from, .. } => {
            let from = if from.is_some() { column_letters(left) } else { String::new() };
            format!("{from}{}:{}", top + 1, bottom + 1)
        }
    };
    let id = |axis: &crate::ids::Axis, p: usize| axis.line(p).map(|l| workbook.bases.text(l));
    let corner = |r: usize, c: usize| Some(json!({"r": id(&sheet.rows, r)?, "c": id(&sheet.columns, c)?}));
    let live = json!({
        "sheetId": sheet.id,
        "cells": {"topLeft": corner(top, left)?, "bottomRight": corner(bottom, right)?},
    });
    Some((format!("{}!{text}", sheet_name_text(&sheet.name)), live))
}

impl Workbook {
    pub(super) fn apply_named_ranges(&mut self, named_ranges: &[NamedRangeToSet]) -> Result<Op, Refusal> {
        let mut seen = hashbrown::HashSet::new();
        if !named_ranges.iter().all(|entry| seen.insert(entry.named_range_id.as_str())) {
            return Err(Refusal::NamedRangeNamedTwice);
        }
        let mut reverse = Vec::with_capacity(named_ranges.len());
        for entry in named_ranges {
            let key = id_key(&entry.named_range_id);
            let before = match &entry.named_range {
                Some(range) => self.named_ranges.insert(key, (entry.named_range_id.clone(), range.clone())),
                None => self.named_ranges.remove(&key),
            };
            reverse.push(NamedRangeToSet { named_range_id: entry.named_range_id.clone(), named_range: before.map(|(_, r)| r) });
        }
        Ok(Op::SetNamedRanges { named_ranges: reverse })
    }

    /// The named range of an id.
    pub fn named_range(&self, named_range_id: &str) -> Option<&NamedRange> {
        self.named_ranges.get(named_range_id).map(|(_, range)| range)
    }

    /// The named range a name is, whatever its case (as `to_lowercase` has it: `ẞ` is `ß`, `SS` is not).
    pub fn named_range_named(&self, name: &str) -> Option<&str> {
        let name = name.to_lowercase();
        self.named_ranges.values().find(|(_, range)| range.name.to_lowercase() == name).map(|(id, _)| id.as_str())
    }

    /// The sheet a reference reads: its own, or for a named range its cells' (none once it is removed).
    pub fn sheet_read_by<'a>(&'a self, reference: &'a Reference) -> Option<&'a str> {
        match reference {
            Reference::NamedRange { named_range_id } => self.named_range(named_range_id).map(|r| r.cells.sheet_id()),
            other => Some(other.sheet_id()),
        }
    }

    /// The named ranges as `readNamedRanges` answers them: by name whatever its case (then by id), each with its
    /// cells' address and where they are now (`#REF!` and none once they are gone).
    pub fn named_ranges_read(&self) -> Json {
        let mut ranges: Vec<&(String, NamedRange)> = self.named_ranges.values().collect();
        ranges.sort_by_cached_key(|(_, range)| range.name.to_lowercase());
        let ranges: Vec<Json> = ranges
            .into_iter()
            .map(|(id, range)| {
                let (address, live) = address(self, &range.cells).unwrap_or_else(|| ("#REF!".to_owned(), Json::Null));
                json!({"namedRangeId": id, "namedRange": range, "address": address, "liveCells": live})
            })
            .collect();
        json!({"kind": "namedRanges", "namedRanges": ranges})
    }

    /// The named ranges as `readWorkbook` and a snapshot write them, by id.
    pub fn named_ranges_written(&self) -> Vec<Json> {
        self.named_ranges.values().map(|(id, range)| json!({"namedRangeId": id, "namedRange": range})).collect()
    }

    /// The named ranges as a snapshot's line holds them, by id.
    pub fn named_range_entries(&self) -> Vec<NamedRangeEntry> {
        self.named_ranges
            .values()
            .map(|(id, range)| NamedRangeEntry { named_range_id: id.clone(), named_range: range.clone() })
            .collect()
    }
}
