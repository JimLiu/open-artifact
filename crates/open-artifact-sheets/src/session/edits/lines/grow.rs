//! References that grow with a table when rows are inserted at either end of its body.
//!
//! The tables are the sheet's as the page reads them, declared or guessed, each read with a header; a body that ends
//! higher read at a cell, over a footer that reading finds, ends there. A table's body must read as
//! the recognizer reads one, its rows given their parts (a last record summing some of its column's rows, or a row
//! under a subtotal, and nothing grows with the table), and ends above the footer that reading finds. Rows inserted right after a
//! table's body take in a reference to the sheet that reads down to the body's last row: one whose bottom is that
//! row, whose top is in the header or at the body's first row, and whose columns meet the table's;
//! its bottom becomes the last row inserted. Rows inserted right after the header take in one whose top is the
//! body's first row and whose bottom is at or under the body's last (columns from a row down too): its top becomes
//! the first row inserted. A reference one row high reads across, not down, unless it is one column wide (whole
//! rows always read across); one whose ends are not both fixed or both relative (`B2:B$5`) does not grow; a cell's
//! reference, or a whole column's, has no ends to grow. An end deleted is read as the nearest line of the reference
//! left (none left, the reference has no ends), but a bottom deleted does not grow. A formula a merged range hides
//! (any of its cells but the top left), or one in a row or column deleted, does not grow, though it still has
//! the tables read first; nor does a reference with relative rows in a formula in a table's body (its header and
//! footer aside), with that table.
//!
//! The formulas are written as one `setCells` of a sheet's after the rest of the edit, in sheet order, a sheet's
//! cells in the order of their columns' ids, then their rows' (as text).
//!
//! The tables are read only when a reference to the sheet has an end the rows meet, whatever the tables are:
//! its bottom at the row they go after, or its top (a range's, whole rows', or columns' from a row down) at the row
//! after that (a bottom deleted meets none), the reference not one row high across and its ends both fixed or both
//! relative (`reads_tables_first`). Reading them, it works out the formulas waiting for `calculate` first, so the tables are
//! read as their formulas come to now.

use crate::formula::Reference;
use crate::ids::{Axis, Bases, IdRun, LineId};
use crate::session::reads::tables::{bodies_of_tables, TableBody};
use crate::workbook::grid::CellForm;
use crate::workbook::layout::merged_boxes;
use crate::workbook::load::{CellToSet, Op};
use crate::workbook::{Input, Sheet, Workbook};

/// Which end of the references grows, and from which row.
#[derive(Clone, Copy)]
enum End {
    /// The body's last row: the bottom becomes the last row inserted.
    Bottom,
    /// The body's first row: the top becomes the first row inserted.
    Top,
}

/// A reference's rows (or columns) now, from `a` to `b` either first: each end snapped toward the other, as an end
/// deleted is read (the nearest line of the reference left); none when no line of it is left. With whether the
/// bottom end's own line is there: one deleted meets no rows inserted, and does not grow.
fn ends_now(axis: &Axis, bases: &Bases, a: &str, b: &str) -> Option<(usize, usize, bool)> {
    let (a, b) = (bases.parse(a)?, bases.parse(b)?);
    let (p, q) = (axis.snap_toward(a, b)?, axis.snap_toward(b, a)?);
    let bottom = if axis.index(a) > axis.index(b) { a } else { b };
    Some((p, q, !axis.is_deleted(bottom)))
}

/// Whether rows inserted after `after` meet an end of a reference to the sheet, from any sheet, as growing it would
/// need: the sheet's tables are read then, the formulas waiting for `calculate` worked out first.
pub fn reads_tables_first(workbook: &Workbook, sheet: &Sheet, after: LineId) -> bool {
    let Some(after) = sheet.rows.position(after) else { return false };
    let bases = &workbook.bases;
    // Rows `a` to `b` (either first), the reference reading across when one row high unless `is_one_column`.
    let meets = |a: &str, b: &str, is_one_column: bool| -> bool {
        let Some((p, q, bottom_is_there)) = ends_now(&sheet.rows, bases, a, b) else { return false };
        let (top, bottom) = (p.min(q), p.max(q));
        !(top == bottom && !is_one_column) && ((bottom == after && bottom_is_there) || top == after + 1)
    };
    let last_row = sheet.rows.len().checked_sub(1).and_then(|p| sheet.rows.line(p));
    // Formulas in rows or columns deleted count too.
    workbook.sheets.iter().any(|other| {
        other.cells.values().any(|cell| {
            let Input::Formula { formula } = &cell.input else { return false };
            formula.references.iter().any(|reference| match reference {
                Reference::Range { sheet_id, top_left, bottom_right }
                    if *sheet_id == sheet.id && top_left.is_row_absolute == bottom_right.is_row_absolute =>
                {
                    match ends_now(&sheet.columns, bases, &top_left.c, &bottom_right.c) {
                        Some((x, y, _)) => meets(&top_left.r, &bottom_right.r, x == y),
                        None => false,
                    }
                }
                // Whole rows one row high read across, from whatever column.
                Reference::Rows { sheet_id, top, bottom, .. }
                    if *sheet_id == sheet.id && top.is_row_absolute == bottom.is_row_absolute =>
                {
                    meets(&top.r, &bottom.r, false)
                }
                Reference::Columns { sheet_id, top: Some(top), .. } if *sheet_id == sheet.id => {
                    let (Some(top), Some(last)) = (bases.parse(&top.r), last_row) else { return false };
                    sheet.rows.snap_toward(top, last) == Some(after + 1)
                }
                _ => false,
            })
        })
    })
}

/// The formulas, in every sheet, whose references to the sheet grow over the rows inserted after `after`.
pub fn formulas_growing(workbook: &Workbook, sheet: &Sheet, after: LineId, new: &IdRun) -> Vec<Op> {
    let Some(after) = sheet.rows.position(after) else { return Vec::new() };
    let tables: Vec<(TableBody, End)> = bodies_of_tables(workbook, sheet)
        .into_iter()
        .filter_map(|t| match after {
            _ if after == t.to => Some((t, End::Bottom)),
            _ if after == t.header_last && t.header_last + 1 == t.from => Some((t, End::Top)),
            _ => None,
        })
        .collect();
    if tables.is_empty() || new.count == 0 {
        return Vec::new();
    }
    let bases = &workbook.bases;
    let first_new = format!("{}.{}", new.base, new.first);
    let last_new = format!("{}.{}", new.base, new.first + new.count - 1);
    let columns = sheet.columns.len();
    // The new ends of a reference's rows (`a`, `b` either first) over columns `left` to `right`, if it grows, in a
    // formula at `at` (row and column): one row high, it reads across unless `is_one_column`.
    let grown = |a: &str, b: &str, left: usize, right: usize, is_one_column: bool, at: (usize, usize)| -> Option<(bool, String)> {
        let (p, q, bottom_is_there) = ends_now(&sheet.rows, bases, a, b)?;
        let (top, bottom) = (p.min(q), p.max(q));
        if top == bottom && !is_one_column {
            return None;
        }
        for (t, end) in &tables {
            if right < t.columns.0 || t.columns.1 < left {
                continue;
            }
            // A formula in the table's body does not grow its relative rows with it.
            if (t.from..=t.to).contains(&at.0) && (t.columns.0..=t.columns.1).contains(&at.1) {
                continue;
            }
            match end {
                End::Bottom if bottom == t.to && bottom_is_there && (t.header_first..=t.from).contains(&top) => {
                    return Some((p > q, last_new.clone()));
                }
                End::Top if top == t.from && bottom >= t.to => return Some((p < q, first_new.clone())),
                _ => {}
            }
        }
        None
    };
    let mut ops = Vec::new();
    for other in &workbook.sheets {
        let mut cells: Vec<CellToSet> = Vec::new();
        let merged = merged_boxes(bases, other);
        for (&(r, c), cell) in &other.cells {
            let Input::Formula { formula } = &cell.input else { continue };
            let (Some(at_row), Some(at_column)) = (other.rows.position(r), other.columns.position(c)) else { continue };
            // A formula a merged range hides (in it, not its top left) does not grow.
            let hides = |&(t, b, l, rt): &(usize, usize, usize, usize)| {
                (t..=b).contains(&at_row) && (l..=rt).contains(&at_column) && (at_row, at_column) != (t, l)
            };
            if merged.iter().any(hides) {
                continue;
            }
            // Only a formula of the sheet can be in its tables' bodies, and only rows it reads relative count.
            let relative = |is_absolute: bool| match other.id == sheet.id && !is_absolute {
                true => (at_row, at_column),
                false => (usize::MAX, usize::MAX),
            };
            let mut formula = formula.clone();
            let mut changed = false;
            for reference in formula.references.iter_mut() {
                match reference {
                    Reference::Range { sheet_id, top_left, bottom_right }
                        if *sheet_id == sheet.id && top_left.is_row_absolute == bottom_right.is_row_absolute =>
                    {
                        let Some((x, y, _)) = ends_now(&sheet.columns, bases, &top_left.c, &bottom_right.c) else {
                            continue;
                        };
                        if let Some((first_is_it, id)) =
                            grown(&top_left.r, &bottom_right.r, x.min(y), x.max(y), x == y, relative(top_left.is_row_absolute))
                        {
                            *(if first_is_it { &mut top_left.r } else { &mut bottom_right.r }) = id;
                            changed = true;
                        }
                    }
                    Reference::Rows { sheet_id, top, bottom, left }
                        if *sheet_id == sheet.id && top.is_row_absolute == bottom.is_row_absolute =>
                    {
                        let last = columns.saturating_sub(1);
                        let left = match left {
                            Some(point) => match bases.parse(&point.c).zip(sheet.columns.line(last)) {
                                Some((x, last)) => match sheet.columns.snap_toward(x, last) {
                                    Some(x) => x,
                                    None => continue,
                                },
                                None => continue,
                            },
                            None => 0,
                        };
                        if let Some((first_is_it, id)) = grown(&top.r, &bottom.r, left, last, false, relative(top.is_row_absolute)) {
                            *(if first_is_it { &mut top.r } else { &mut bottom.r }) = id;
                            changed = true;
                        }
                    }
                    // Columns from a row down grow at their top only: their bottom is the sheet's last row.
                    Reference::Columns { sheet_id, left, right, top: Some(top) } if *sheet_id == sheet.id => {
                        let Some((x, y, _)) = ends_now(&sheet.columns, bases, &left.c, &right.c) else { continue };
                        let Some(last) = sheet.rows.len().checked_sub(1).and_then(|p| sheet.rows.line(p)) else {
                            continue;
                        };
                        if let Some((true, id)) = grown(&top.r, &bases.text(last), x.min(y), x.max(y), x == y, relative(top.is_row_absolute)) {
                            top.r = id;
                            changed = true;
                        }
                    }
                    _ => {}
                }
            }
            if changed {
                cells.push(CellToSet { r: bases.text(r), c: bases.text(c), input: Some(Input::Formula { formula }) });
            }
        }
        if !cells.is_empty() {
            cells.sort_by(|x, y| (&x.c, &x.r).cmp(&(&y.c, &y.r)));
            ops.push(Op::SetCells { sheet_id: other.id.clone(), cells, form: CellForm::List });
        }
    }
    ops
}
