//! Declaring, changing and removing a sheet's cell tables (several, none over another).

use super::{live_column, live_row, sheet, Made, Refused};
use crate::session::place::Place;
use crate::workbook::load::Op;
use crate::workbook::objects::{live_cell_table, CellTable, CellTableToSet};
use crate::ids::Bases;
use crate::workbook::{Sheet, Workbook};

/// The rows and columns of a cell table, each a line of the sheet not deleted; then, once the ids the edit writes are
/// checked, its footer under its header (the check this gives back).
fn check(workbook: &Workbook, sheet: &Sheet, t: &CellTable) -> Result<Result<(), Refused>, Refused> {
    let (_, h1) = live_row(workbook, sheet, &t.header_rows.first_row)?;
    let (_, h2) = live_row(workbook, sheet, &t.header_rows.last_row)?;
    let footer = match &t.footer_rows {
        Some(f) => Some((live_row(workbook, sheet, &f.first_row)?.1, live_row(workbook, sheet, &f.last_row)?.1)),
        None => None,
    };
    live_column(workbook, sheet, &t.first_column)?;
    live_column(workbook, sheet, &t.last_column)?;
    if footer.is_some_and(|(f1, f2)| f1.min(f2) <= h1.max(h2)) {
        return Ok(Err(Refused::Because("cellTableFooterNotUnderHeader")));
    }
    Ok(Ok(()))
}

/// Whether the sheet shows a cell table: some of its header rows and columns are left, and its footer (when left)
/// is under its header.
pub(crate) fn is_shown(bases: &Bases, s: &Sheet, t: &CellTable) -> bool {
    let Some(live) = live_cell_table(bases, s, t) else { return false };
    let row = |id: &str| bases.parse(id).and_then(|l| s.rows.position(l));
    match &live.footer_rows {
        Some(f) => row(&f.first_row) > row(&live.header_rows.last_row),
        None => true,
    }
}

/// The rows and columns a cell table covers where it is now (positions, top, bottom, left, right): its header rows,
/// down to its footer when it has one. `None` when it is not there. The table being declared or changed, when it has
/// no footer, reaches down to the end of the sheet (`to_the_end`): it takes in what is under it.
fn area(bases: &Bases, s: &Sheet, t: &CellTable, to_the_end: bool) -> Option<(usize, usize, usize, usize)> {
    let live = live_cell_table(bases, s, t)?;
    let row = |id: &str| bases.parse(id).and_then(|l| s.rows.position(l));
    let column = |id: &str| bases.parse(id).and_then(|l| s.columns.position(l));
    let (h1, h2) = (row(&live.header_rows.first_row)?, row(&live.header_rows.last_row)?);
    let (mut top, mut bottom) = (h1.min(h2), h1.max(h2));
    if let Some(f) = &live.footer_rows {
        let (f1, f2) = (row(&f.first_row)?, row(&f.last_row)?);
        (top, bottom) = (top.min(f1.min(f2)), bottom.max(f1.max(f2)));
    } else if to_the_end {
        bottom = usize::MAX;
    }
    let (c1, c2) = (column(&live.first_column)?, column(&live.last_column)?);
    Some((top, bottom, c1.min(c2), c1.max(c2)))
}

fn overlap(a: Option<(usize, usize, usize, usize)>, b: Option<(usize, usize, usize, usize)>) -> bool {
    let (Some((t1, b1, l1, r1)), Some((t2, b2, l2, r2))) = (a, b) else { return false };
    t1 <= b2 && t2 <= b1 && l1 <= r2 && l2 <= r1
}

/// Whether a cell table's header rows (where they are now) hold any input in its columns; one with no rows or no
/// columns left does, as far as declaring another goes.
pub(crate) fn shows_header(workbook: &Workbook, s: &Sheet, t: &CellTable) -> bool {
    let bases = &workbook.bases;
    let Some(live) = live_cell_table(bases, s, t) else { return true };
    let row = |id: &str| bases.parse(id).and_then(|l| s.rows.position(l));
    let column = |id: &str| bases.parse(id).and_then(|l| s.columns.position(l));
    let (Some(top), Some(bottom), Some(left), Some(right)) = (
        row(&live.header_rows.first_row),
        row(&live.header_rows.last_row),
        column(&live.first_column),
        column(&live.last_column),
    ) else {
        return false;
    };
    // Any input counts, an empty text or a formula whose value is blank too.
    let holds = |r, c| s.rows.line(r).zip(s.columns.line(c)).is_some_and(|at| s.cells.contains_key(&at));
    (top..=bottom).any(|r| (left..=right).any(|c| holds(r, c)))
}

fn well_formed(id: &str) -> Result<(), Refused> {
    super::well_formed(id, "ctb")
}

/// A table the sheet shows, by its id: one it does not show is not known.
fn shown<'a>(workbook: &Workbook, s: &'a Sheet, id: &str) -> Result<&'a (String, CellTable), Refused> {
    let table = s.cell_tables.get(id).filter(|(_, t)| is_shown(&workbook.bases, s, t));
    table.ok_or(Refused::Because("unknownCellTable"))
}

fn set(sheet_id: String, cell_table_id: String, cell_table: Option<CellTable>) -> Op {
    Op::SetCellTables { sheet_id, cell_tables: vec![CellTableToSet { cell_table_id, cell_table }] }
}

/// Where a table declared or changed goes among the others the sheet shows (several tables a sheet):
/// one whose header shows something is not to be covered; those whose header shows nothing give way to it when it
/// covers them, a table with no footer reaching down to the end of the sheet. The ids giving way, and whether it is
/// over another; a table changed (`except`) is not over one it meets where it is now.
fn among_others<'a>(workbook: &Workbook, s: &'a Sheet, t: &CellTable, except: Option<&str>) -> (Vec<&'a String>, bool) {
    let bases = &workbook.bases;
    let (new_area, reaching_down) = (area(bases, s, t, false), area(bases, s, t, true));
    let now_area = except.and_then(|id| s.cell_tables.get(id)).and_then(|(_, now)| area(bases, s, now, false));
    let mut giving_way = Vec::new();
    let mut over_another = false;
    let others = s.cell_tables.values().filter(|(id, other)| Some(id.as_str()) != except && is_shown(bases, s, other));
    for (id, other) in others {
        let other_area = area(bases, s, other, false);
        if shows_header(workbook, s, other) {
            // One the changed table meets where it is now is not one it is over.
            over_another |= overlap(new_area, other_area) && !overlap(now_area, other_area);
        } else if overlap(reaching_down, other_area) {
            giving_way.push(id);
        }
    }
    // In the order the page reads them: by place, then by id.
    let place = |id: &String| {
        s.cell_tables.values().find(|(i, _)| i == id).and_then(|(_, t)| crate::workbook::objects::shown_cell_table(bases, s, t)).map(|x| x.0)
    };
    giving_way.sort_by(|a, b| place(a).cmp(&place(b)).then_with(|| a.cmp(b)));
    (giving_way, over_another)
}

/// The op setting a table and removing those giving way to it: with its footer under its header, a
/// table over another is refused first, then ids not well formed (those giving way, then its own); its footer is
/// checked last, and one not under its header leaves the others unread.
fn placed(
    workbook: &Workbook,
    s: &Sheet,
    (sheet_id, id): (String, String),
    t: CellTable,
    except: Option<&str>,
    footer: Result<(), Refused>,
) -> Result<Made, Refused> {
    let (giving_way, over_another) = if footer.is_ok() { among_others(workbook, s, &t, except) } else { (Vec::new(), false) };
    if over_another {
        return Err(Refused::Because("cellTableOverAnother"));
    }
    giving_way.iter().try_for_each(|id| well_formed(id))?;
    well_formed(&id)?;
    footer?;
    let mut cell_tables = vec![CellTableToSet { cell_table_id: id, cell_table: Some(t) }];
    cell_tables.extend(giving_way.into_iter().map(|id| CellTableToSet { cell_table_id: id.clone(), cell_table: None }));
    Ok(Made::ops(vec![Op::SetCellTables { sheet_id, cell_tables }]))
}

pub(super) fn declare(workbook: &Workbook, sheet_id: String, t: CellTable, code: &str) -> Result<Made, Refused> {
    let s = sheet(workbook, &sheet_id)?;
    let footer = check(workbook, s, &t)?;
    placed(workbook, s, (sheet_id, format!("ctb_{code}.0")), t, None, footer)
}

pub(super) fn change(workbook: &Workbook, sheet_id: String, id: String, t: CellTable) -> Result<Made, Refused> {
    let s = sheet(workbook, &sheet_id)?;
    let (_, now) = shown(workbook, s, &id)?;
    let footer = check(workbook, s, &t)?;
    if *now == t {
        return Ok(Made::nothing());
    }
    let except = id.clone();
    placed(workbook, s, (sheet_id, id), t, Some(&except), footer)
}

pub(super) fn remove(workbook: &Workbook, sheet_id: String, id: String) -> Result<Made, Refused> {
    let s = sheet(workbook, &sheet_id)?;
    shown(workbook, s, &id)?;
    well_formed(&id)?;
    let place = Place::sheet(&sheet_id);
    Ok(Made { ops: vec![set(sheet_id, id, None)], place: Some(place) })
}
