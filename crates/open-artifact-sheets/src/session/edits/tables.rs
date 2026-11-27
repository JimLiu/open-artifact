//! Sorting, cell tables, tables imported, and sheets duplicated.
//!
//! Kinds: sortRows, sortCells, declareCellTable, changeCellTable, removeCellTable, importTableAsNewSheet,
//! importTableIntoSheet, duplicateSheet.

use serde::Deserialize;
use serde_json::Value as Json;

use super::{Context, Made, Refused};
use crate::ids::LineId;
use crate::workbook::layout::CellIds;
use crate::workbook::objects::CellTable;
use crate::workbook::{Sheet, Workbook};

mod cell_tables;
pub(crate) use cell_tables::is_shown as is_cell_table_shown;
pub(super) mod duplicate;
mod import;
mod move_columns;
pub(crate) mod into_sheet;
mod sort;

/// Whether an object's id is well formed: its kind (`ctb`, `cfm`, `rgr`, `plc`, `viw`, `vel`, …), `_`, a code
/// of 8 to 16 small letters and digits, a dot and a number (as a `u32` is written).
fn is_well_formed(id: &str, kind: &str) -> bool {
    let Some(rest) = id.strip_prefix(kind).and_then(|rest| rest.strip_prefix('_')) else { return false };
    let Some((code, n)) = rest.split_once('.') else { return false };
    (8..=16).contains(&code.len())
        && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && n.parse::<u32>().is_ok_and(|v| v.to_string() == n)
}

/// Ids the workbook holds that are not well formed cannot go into an edit's ops.
fn well_formed(id: &str, kind: &str) -> Result<(), Refused> {
    if is_well_formed(id, kind) { Ok(()) } else { Err(Refused::Because("idNotWellFormed")) }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Ascending,
    Descending,
}

/// A further column to sort by, when the ones before it tie.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FurtherKey {
    by_column: String,
    direction: Direction,
}

/// Cells from one corner to the other, on a sheet.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellsBetween {
    sheet_id: String,
    one_corner: CellIds,
    other_corner: CellIds,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    SortRows {
        sheet_id: String,
        one_row: String,
        other_row: String,
        by_column: String,
        direction: Direction,
        #[serde(default)]
        then_by: Vec<FurtherKey>,
    },
    #[serde(rename_all = "camelCase")]
    SortCells {
        cells: CellsBetween,
        by_column: String,
        direction: Direction,
        #[serde(default)]
        then_by: Vec<FurtherKey>,
    },
    #[serde(rename_all = "camelCase")]
    MoveColumnsOfCells {
        cells: CellsBetween,
        one_column: String,
        other_column: String,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        after_column: Option<String>,
        widths_go_along: bool,
    },
    #[serde(rename_all = "camelCase")]
    DeclareCellTable {
        sheet_id: String,
        cell_table: CellTable,
        /// Whether the person asked for the table (formatting cells as one), not the page guessing it: read, and
        /// nothing else of the edit changes with it. Null is unreadable.
        #[serde(default, deserialize_with = "crate::workbook::layout::written::not_null")]
        #[allow(dead_code)]
        is_asked_for: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    ChangeCellTable { sheet_id: String, cell_table_id: String, cell_table: CellTable },
    #[serde(rename_all = "camelCase")]
    RemoveCellTable { sheet_id: String, cell_table_id: String },
    #[serde(rename_all = "camelCase")]
    ImportTableAsNewSheet {
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        after_sheet: Option<String>,
        name: String,
        rows: Vec<Vec<String>>,
        /// Left out, none.
        #[serde(default)]
        header_rows: u32,
        /// Left out, none.
        #[serde(default)]
        columns: Vec<import::ColumnToImport>,
        /// Left out, plain. Null is unreadable.
        #[serde(default, deserialize_with = "crate::workbook::layout::written::not_null")]
        look: Option<import::Look>,
    },
    #[serde(rename_all = "camelCase")]
    ImportTableIntoSheet { table: into_sheet::TableIntoSheet },
    #[serde(rename_all = "camelCase")]
    DuplicateSheet {
        sheet_id: String,
        name: String,
        #[serde(default, deserialize_with = "crate::workbook::layout::written::not_null")]
        placed_views: Option<PlacedViews>,
    },
}

/// What becomes of the views placed on a sheet duplicated: left behind, or shown on the copy too, as copies whose
/// widgets show the nodes given for theirs.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PlacedViews {
    LeftBehind {},
    #[serde(rename_all = "camelCase")]
    Copied { copied_widget_nodes: Vec<CopiedWidgetNode> },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CopiedWidgetNode {
    source: String,
    copy: String,
}

/// A node of the page as a widget names it: `node/` and 1 to 128 of `A-Z a-z 0-9 _ -`.
fn is_node(text: &str) -> bool {
    text.strip_prefix("node/").is_some_and(|id| {
        (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

pub fn read(edit: &Json) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    if let Edit::ImportTableAsNewSheet { columns, .. } = &edit {
        if !columns.iter().all(import::ColumnToImport::is_readable) {
            return None;
        }
    }
    if let Edit::ImportTableIntoSheet { table } = &edit {
        if !table.is_readable() {
            return None;
        }
    }
    // Copied nodes are nodes, each source and each copy given once.
    if let Edit::DuplicateSheet { placed_views: Some(PlacedViews::Copied { copied_widget_nodes: nodes }), .. } = &edit {
        let (mut sources, mut copies) = (hashbrown::HashSet::new(), hashbrown::HashSet::new());
        let readable = nodes.iter().all(|n| {
            is_node(&n.source) && is_node(&n.copy) && sources.insert(&n.source) && copies.insert(&n.copy)
        });
        if !readable {
            return None;
        }
    }
    Some(edit)
}

/// What an edit adds once made: an imported table's look (`look`), given the sheet it is imported as.
pub struct FollowUp(import::LookToGive);

pub fn follow_up(edit: &Edit, code: &str) -> Option<FollowUp> {
    match edit {
        Edit::ImportTableAsNewSheet { header_rows, look, .. } => {
            import::look_to_give(look.as_ref(), *header_rows, code).map(FollowUp)
        }
        _ => None,
    }
}

pub fn follow_up_ops(workbook: &Workbook, follow_up: FollowUp) -> Vec<crate::workbook::load::Op> {
    import::look_ops(workbook, follow_up.0)
}

/// Sorts work the formulas out first: they sort by what the formulas come to now.
pub fn calculates_first(edit: &Edit) -> bool {
    matches!(edit, Edit::SortRows { .. } | Edit::SortCells { .. })
}

/// The refusals after which the page is told everything changed: a copy's merged ranges are found wrong only
/// once what is calculated from is rebuilt, and that rebuild is told with the next state the page is given.
pub fn refusals_that_redraw(edit: &Edit) -> &'static [&'static str] {
    match edit {
        Edit::DuplicateSheet { .. } => &["mergedRangesOverlap", "cellCoveredByMergedRange"],
        _ => &[],
    }
}

pub fn make(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    match edit {
        Edit::SortRows { sheet_id, one_row, other_row, by_column, direction, then_by } => {
            let keys = keys(by_column, direction, then_by);
            sort::sort_rows(workbook, &sheet_id, &one_row, &other_row, &keys, context)
        }
        Edit::SortCells { cells, by_column, direction, then_by } => {
            let keys = keys(by_column, direction, then_by);
            sort::sort_cells(workbook, &cells.sheet_id, &cells.one_corner, &cells.other_corner, &keys, context.code)
        }
        Edit::MoveColumnsOfCells { cells, one_column, other_column, after_column, widths_go_along } => {
            move_columns::make(workbook, &cells, &one_column, &other_column, after_column.as_deref(), widths_go_along)
        }
        Edit::DeclareCellTable { sheet_id, cell_table, .. } => {
            cell_tables::declare(workbook, sheet_id, cell_table, context.code)
        }
        Edit::ChangeCellTable { sheet_id, cell_table_id, cell_table } => {
            cell_tables::change(workbook, sheet_id, cell_table_id, cell_table)
        }
        Edit::RemoveCellTable { sheet_id, cell_table_id } => cell_tables::remove(workbook, sheet_id, cell_table_id),
        Edit::ImportTableAsNewSheet { after_sheet, name, rows, header_rows, columns, .. } => {
            import::as_new_sheet(workbook, after_sheet, &name, &rows, header_rows, &columns, context.code)
        }
        Edit::ImportTableIntoSheet { table } => into_sheet::into_sheet(workbook, &table, context.code),
        Edit::DuplicateSheet { sheet_id, name, placed_views } => {
            duplicate::duplicate(workbook, &sheet_id, &name, placed_views.as_ref(), context.code)
        }
    }
}

/// The rows a sort of rows would order, in the order it would put them, as runs of ids (readRowsInSortedOrder):
/// `unknownSheet`, `unknownRow`, `mergedRangeAmongSortedCells`, `unknownColumn`, `sortKeysNotCalculated`.
pub(crate) fn rows_in_sorted_order(
    workbook: &Workbook,
    sheet_id: &str,
    one_row: &str,
    other_row: &str,
    by_column: String,
    direction: Direction,
    then_by: Vec<FurtherKey>,
    is_calculation_due: bool,
) -> Result<Vec<crate::ids::IdRun>, &'static str> {
    let keys = keys(by_column, direction, then_by);
    match sort::rows_in_sorted_order(workbook, sheet_id, one_row, other_row, &keys, is_calculation_due) {
        Ok(rows) => Ok(sorted_runs(workbook, sheet_id, &rows)),
        Err(Refused::Because(why)) => Err(why),
        Err(_) => Err("unreadableRequest"),
    }
}

/// The sorted rows as runs. Rows the sort puts in another order make runs of consecutive ids; rows
/// it leaves in their order are given as the sheet keeps them, consecutive ids one run only when they are next to
/// each other with deleted rows counted, so a deleted row a move left between them keeps two runs apart.
fn sorted_runs(workbook: &Workbook, sheet_id: &str, rows: &[LineId]) -> Vec<crate::ids::IdRun> {
    let Some(i) = workbook.sheet_index(sheet_id) else { return crate::ids::runs_of(rows, &workbook.bases) };
    let axis = &workbook.sheets[i].rows;
    let positions: Vec<Option<usize>> = rows.iter().map(|&r| axis.position(r)).collect();
    if !positions.windows(2).all(|w| matches!((w[0], w[1]), (Some(a), Some(b)) if a < b)) {
        return crate::ids::runs_of(rows, &workbook.bases);
    }
    let mut runs: Vec<crate::ids::IdRun> = Vec::new();
    let mut last: Option<LineId> = None;
    for &line in rows {
        let joins = last.is_some_and(|prev| {
            prev.base == line.base
                && prev.n.checked_add(1) == Some(line.n)
                && matches!((axis.index(prev), axis.index(line)), (Some(a), Some(b)) if a + 1 == b)
        });
        match runs.last_mut() {
            Some(run) if joins => run.count += 1,
            _ => runs.push(crate::ids::IdRun { base: workbook.bases.name(line.base).to_owned(), first: line.n, count: 1 }),
        }
        last = Some(line);
    }
    runs
}

fn keys(by_column: String, direction: Direction, then_by: Vec<FurtherKey>) -> Vec<(String, Direction)> {
    let mut keys = vec![(by_column, direction)];
    keys.extend(then_by.into_iter().map(|k| (k.by_column, k.direction)));
    keys
}

fn sheet<'a>(workbook: &'a Workbook, sheet_id: &str) -> Result<&'a Sheet, Refused> {
    let i = workbook.sheet_index(sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    Ok(&workbook.sheets[i])
}

/// A row of the sheet not deleted, and its position.
fn live_row(workbook: &Workbook, sheet: &Sheet, id: &str) -> Result<(LineId, usize), Refused> {
    let line = workbook.bases.parse(id).ok_or(Refused::Because("unknownRow"))?;
    Ok((line, sheet.rows.position(line).ok_or(Refused::Because("unknownRow"))?))
}

/// A column of the sheet not deleted, and its position.
fn live_column(workbook: &Workbook, sheet: &Sheet, id: &str) -> Result<(LineId, usize), Refused> {
    let line = workbook.bases.parse(id).ok_or(Refused::Because("unknownColumn"))?;
    Ok((line, sheet.columns.position(line).ok_or(Refused::Because("unknownColumn"))?))
}
