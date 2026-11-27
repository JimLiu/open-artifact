//! Protections held against the person who makes an edit: the operations an edit makes, or an
//! undo or redo takes, are checked one by one, each on the workbook the ones before it leave, before it applies,
//! against the protections held before the edit (where their lines are now: a protection the edit changes still
//! holds as it was).
//! Refused, the edit is refused whole. A protection is held against anyone but the owner who is not among its editors
//! (always against someone not named); with no person told, against no one.
//!
//! - Any protection of a sheet held against the person refuses deleting, hiding or showing it (`sheetProtected`).
//! - A sheet's protection refuses what changes the sheet itself: inserting, deleting, moving and putting in order
//!   rows and columns, their sizes and groups, its settings and name, its conditional formats and placed views, and
//!   the columns of its connected table (`sheetProtected`); and setting, formatting, merging or unmerging cells, or the dropdowns of cells, that are in
//!   none of its open ranges (`cellsProtected`).
//! - A range's protection refuses the same for its cells (conditional formats too, by their ranges before and
//!   after: `cellsProtected`), and on the axes it bounds (rows for whole rows, columns for whole columns, both for
//!   cells) inserting lines between its first and last, deleting any of them, a move that does not leave them as
//!   they were, side by side, and putting in order rows that are any of them (`linesProtected`). Lines deleted
//!   across it refuse when they take a cell of it holding something; rows put in order across it (whole columns)
//!   when they change the formula of a cell of it on a row that moves (`cellsProtected`).
//!
//! - Any protection of a connected table's sheet with a line left refuses setting the table's call
//!   (`sheetProtected`).
//!
//! A cell is a range's when it is between the range's lines left, at their places now (each end snapped toward the
//! other); a range with none left on an axis protects nothing. Settings that do not hide or show the sheet, renaming,
//! sizes, groups, placements and cell tables are free under a range's protection, and so are moving sheets, cell
//! tables and the locale under a sheet's.

use hashbrown::HashSet;

use super::{Context, Refused};
use crate::ids::{Axis, Bases, IdRun, LineId};
use crate::session::person::Person;
use crate::workbook::formats::Leaf;
use crate::workbook::layout::RangeIds;
use crate::workbook::load::Op;
use crate::workbook::protections::{Protection, Protects, Span};
use crate::workbook::{Input, Sheet, Workbook};

const SHEET: &str = "sheetProtected";
const CELLS: &str = "cellsProtected";
const LINES: &str = "linesProtected";

/// A protection held against the person, as it is now.
enum Guard {
    /// A range's: where it is (`None`: no line of it left on an axis).
    Range(Option<Span>),
    /// A sheet's: where its open ranges are.
    Sheet(Vec<Span>),
}

impl Guard {
    /// Whether the guard holds a cell of the rows and columns at these positions.
    fn holds_any(&self, rows: &[usize], columns: &[usize]) -> bool {
        match self {
            Guard::Range(None) => false,
            Guard::Range(Some(span)) => {
                let within = |ends: Option<(usize, usize)>, ps: &[usize]| match ends {
                    None => !ps.is_empty(),
                    Some((a, b)) => ps.iter().any(|p| (a..=b).contains(p)),
                };
                within(span.rows, rows) && within(span.columns, columns)
            }
            Guard::Sheet(open) => rows.iter().any(|&r| {
                let spans: Vec<&Span> = open.iter().filter(|s| s.rows.is_none_or(|(a, b)| (a..=b).contains(&r))).collect();
                columns.iter().any(|&c| !spans.iter().any(|s| s.columns.is_none_or(|(a, b)| (a..=b).contains(&c))))
            }),
        }
    }
}

/// The protections of a sheet held against the person: those the sheet had before the edit, where they are now.
fn guards(bases: &Bases, sheet: &Sheet, had: &Sheet, person: Option<&Person>) -> Vec<Guard> {
    had
        .protections
        .values()
        .filter(|(_, p)| Person::is_kept_out(person, &p.editors))
        .map(|(_, p)| match &p.protects {
            Protects::Range { range } => Guard::Range(range.live(bases, sheet)),
            Protects::Sheet { open_ranges } => {
                Guard::Sheet(open_ranges.iter().filter_map(|r| r.live(bases, sheet)).collect())
            }
        })
        .collect()
}

/// The sheet an operation acts on, when one.
fn sheet_of(op: &Op) -> Option<&str> {
    Some(match op {
        Op::InsertRows { sheet_id, .. }
        | Op::InsertColumns { sheet_id, .. }
        | Op::SetCells { sheet_id, .. }
        | Op::DeleteRows { sheet_id, .. }
        | Op::DeleteColumns { sheet_id, .. }
        | Op::UndeleteRows { sheet_id, .. }
        | Op::UndeleteColumns { sheet_id, .. }
        | Op::DeleteSheet { sheet_id }
        | Op::SetCellFormats { sheet_id, .. }
        | Op::MergeCells { sheet_id, .. }
        | Op::UnmergeCells { sheet_id, .. }
        | Op::SetColumnWidths { sheet_id, .. }
        | Op::SetRowHeights { sheet_id, .. }
        | Op::SetDropdowns { sheet_id, .. }
        | Op::SetRowGroups { sheet_id, .. }
        | Op::SetColumnGroups { sheet_id, .. }
        | Op::SetConditionalFormats { sheet_id, .. }
        | Op::SetPlacements { sheet_id, .. }
        | Op::MoveRows { sheet_id, .. }
        | Op::ReorderRows { sheet_id, .. }
        | Op::MoveColumns { sheet_id, .. }
        | Op::SetColumnsOfConnectedTable { sheet_id, .. } => sheet_id,
        _ => return None,
    })
}

/// Whether the operation changes the sheet itself, which a sheet's protection refuses.
fn changes_the_sheet(op: &Op) -> bool {
    matches!(
        op,
        Op::InsertRows { .. }
            | Op::InsertColumns { .. }
            | Op::DeleteRows { .. }
            | Op::DeleteColumns { .. }
            | Op::UndeleteRows { .. }
            | Op::UndeleteColumns { .. }
            | Op::DeleteSheet { .. }
            | Op::MoveRows { .. }
            | Op::MoveColumns { .. }
            | Op::ReorderRows { .. }
            | Op::SetRowHeights { .. }
            | Op::SetColumnWidths { .. }
            | Op::SetRowGroups { .. }
            | Op::SetColumnGroups { .. }
            | Op::SetConditionalFormats { .. }
            | Op::SetPlacements { .. }
            | Op::SetColumnsOfConnectedTable { .. }
    )
}

/// Whether any protection of the workbook is held against the person.
fn is_any_held(workbook: &Workbook, person: Option<&Person>) -> bool {
    workbook.sheets.iter().any(|s| s.protections.values().any(|(_, p)| Person::is_kept_out(person, &p.editors)))
}

/// Checks the operations, in order, against the protections held against the person: the refusal of the first one
/// refused.
pub fn check(workbook: &Workbook, ops: &[Op], person: Option<&Person>) -> Result<(), &'static str> {
    check_ops(workbook, ops, person, false)
}

/// Checks the operations an undo or redo takes, as `check` does an edit's. A step that only saves and removes
/// protections is refused as the person's edit would be when it changes one held against them
/// (`protectionNotTheirsToChange`); any step is refused when it saves one held against them that was not there
/// (`protectionLeavesOutWhoeverSetsIt`).
pub fn check_step(workbook: &Workbook, ops: &[Op], person: Option<&Person>) -> Result<(), &'static str> {
    check_ops(workbook, ops, person, true)
}

/// What the operations checked come from.
#[derive(Clone, Copy, PartialEq)]
enum Origin {
    /// An edit.
    Edit,
    /// An undo or redo that only saves and removes protections.
    ProtectionsStep,
    /// Any other undo or redo.
    Step,
}

fn check_ops(workbook: &Workbook, ops: &[Op], person: Option<&Person>, is_step: bool) -> Result<(), &'static str> {
    let is_protection = |op: &Op| matches!(op, Op::SetProtections { .. });
    let saves = is_step && ops.iter().any(is_protection);
    let origin = match is_step {
        false => Origin::Edit,
        true if ops.iter().all(is_protection) => Origin::ProtectionsStep,
        true => Origin::Step,
    };
    if ops.is_empty() || !(saves || is_any_held(workbook, person)) {
        return Ok(());
    }
    let mut work: Option<Workbook> = None;
    for (i, op) in ops.iter().enumerate() {
        let now = work.as_ref().unwrap_or(workbook);
        let after = check_op(workbook, now, op, person, origin)?;
        if i + 1 == ops.len() && after.is_none() {
            break;
        }
        let w = work.get_or_insert_with(|| workbook.clone());
        if w.apply_in_place(std::slice::from_ref(op)).is_err() {
            // The operation does not apply: the edit is refused for that, not for a protection.
            return Ok(());
        }
        if let Some(after) = after {
            after.check(w)?;
        }
    }
    Ok(())
}

/// A refusal the edit gives before making its operations, unless a protection refuses them first (as they
/// are refused as they are applied).
pub fn refuse(workbook: &Workbook, context: &Context, ops: &[Op], why: &'static str) -> Refused {
    match check(workbook, ops, context.person) {
        Err(protected) => Refused::Because(protected),
        Ok(()) => Refused::Because(why),
    }
}

/// What is left to check once the operation is applied.
enum After {
    /// The lines of each range (by id, in order) are to be side by side and in the same order.
    Together { sheet_id: String, rows: bool, ranges: Vec<Vec<LineId>> },
    /// Cells whose formula is not to change if their row moves: by row, column, input, and the row's place.
    Formulas { sheet_id: String, cells: Vec<(LineId, LineId, Input, usize)> },
}

impl After {
    fn check(self, workbook: &Workbook) -> Result<(), &'static str> {
        match self {
            After::Together { sheet_id, rows, ranges } => {
                let Some(i) = workbook.sheet_index(&sheet_id) else { return Ok(()) };
                let sheet = &workbook.sheets[i];
                let axis = if rows { &sheet.rows } else { &sheet.columns };
                let together = |lines: &Vec<LineId>| {
                    let places: Vec<Option<usize>> = lines.iter().map(|&l| axis.position(l)).collect();
                    places.windows(2).all(|w| matches!(w, [Some(a), Some(b)] if *b == a + 1))
                };
                if ranges.iter().all(together) { Ok(()) } else { Err(LINES) }
            }
            After::Formulas { sheet_id, cells } => {
                let Some(i) = workbook.sheet_index(&sheet_id) else { return Ok(()) };
                let sheet = &workbook.sheets[i];
                let changed = cells.into_iter().any(|(r, c, input, place)| {
                    sheet.rows.position(r) != Some(place) && sheet.cells.get(&(r, c)).map(|cell| &cell.input) != Some(&input)
                });
                if changed { Err(CELLS) } else { Ok(()) }
            }
        }
    }
}

/// The live positions of lines named by runs, in order.
fn positions(workbook: &Workbook, axis: &Axis, runs: &[IdRun]) -> Vec<usize> {
    let bases = &workbook.bases;
    let total: u64 = runs.iter().map(|r| r.count as u64).sum();
    let mut out: Vec<usize> = if total > axis.total() as u64 {
        let named: Vec<(u32, u64, u64)> = runs
            .iter()
            .filter_map(|r| Some((bases.find(&r.base)?, r.first as u64, r.first as u64 + r.count as u64)))
            .collect();
        (0..axis.len())
            .filter(|&p| {
                let l = axis.line(p).expect("a live position");
                named.iter().any(|&(b, f, e)| l.base == b && (f..e).contains(&(l.n as u64)))
            })
            .collect()
    } else {
        runs.iter()
            .filter_map(|r| Some((bases.find(&r.base)?, r)))
            .flat_map(|(base, r)| (r.first as u64..r.first as u64 + r.count as u64).map(move |n| LineId { base, n: n as u32 }))
            .filter_map(|l| axis.position(l))
            .collect()
    };
    out.sort_unstable();
    out.dedup();
    out
}

/// The positions of a range's cells now, on each axis (none: no line of it left).
fn range_positions(bases: &Bases, sheet: &Sheet, range: &RangeIds) -> Option<(Vec<usize>, Vec<usize>)> {
    let (t, b, l, r) = sheet.live_box(bases, range)?;
    Some(((t..=b).collect(), (l..=r).collect()))
}

/// Checks one operation on the workbook it applies to; what to check once it is applied, if anything.
fn check_op(
    before: &Workbook,
    workbook: &Workbook,
    op: &Op,
    person: Option<&Person>,
    origin: Origin,
) -> Result<Option<After>, &'static str> {
    let bases = &workbook.bases;
    let guards_of = |sheet_id: &str| -> Option<(&Sheet, Vec<Guard>)> {
        let sheet = &workbook.sheets[workbook.sheet_index(sheet_id)?];
        // A sheet the edit brings back had no protections before it.
        let had = &before.sheets[before.sheet_index(sheet_id)?];
        let guards = guards(bases, sheet, had, person);
        (!guards.is_empty()).then_some((sheet, guards))
    };
    match op {
        Op::SetSheetSettings { sheets } => {
            for set in sheets {
                let Some((_, guards)) = guards_of(&set.sheet_id) else { continue };
                if set.settings.is_hidden.is_some() || guards.iter().any(|g| matches!(g, Guard::Sheet(_))) {
                    return Err(SHEET);
                }
            }
            return Ok(None);
        }
        Op::SetProtections { sheet_id, protections } => {
            // First, a protection held against the person that is changed: lines an edit or step changes take it
            // with them (a range's, `linesProtected`; a sheet's open ranges, `sheetProtected`); a step that only
            // saves and removes protections would change it (`protectionNotTheirsToChange`). A step that saves one
            // held against the person that was not there is refused (`protectionLeavesOutWhoeverSetsIt`).
            // Then each other one is checked by where it is before and where it is to be: a range's by its cells, a
            // sheet's as the whole sheet, which any protection held against the person holds; a sheet's protection
            // that stays one is not checked (its open ranges are free to change).
            let kept_out = |p: Option<&Protection>| p.is_some_and(|p| Person::is_kept_out(person, &p.editors));
            let before_of = |sheet: &'_ Sheet, id: &str| sheet.protections.get(&crate::workbook::layout::id_key(id)).map(|(_, p)| p.clone());
            let Some(index) = workbook.sheet_index(sheet_id) else { return Ok(None) };
            for set in protections {
                let before = before_of(&workbook.sheets[index], &set.protection_id);
                if kept_out(before.as_ref()) {
                    if origin == Origin::ProtectionsStep {
                        return Err("protectionNotTheirsToChange");
                    }
                    return Err(match before.map(|p| p.protects) {
                        Some(Protects::Sheet { .. }) => SHEET,
                        _ => LINES,
                    });
                }
                if origin != Origin::Edit && kept_out(set.protection.as_ref()) {
                    return Err("protectionLeavesOutWhoeverSetsIt");
                }
            }
            let Some((sheet, guards)) = guards_of(sheet_id) else { return Ok(None) };
            let held = |p: &Protection| match &p.protects {
                Protects::Sheet { .. } => guards.iter().any(|g| !matches!(g, Guard::Range(None))),
                Protects::Range { range } => range.live(bases, sheet).is_some_and(|span| {
                    let all = |ends: Option<(usize, usize)>, len: usize| -> Vec<usize> {
                        let (a, b) = ends.unwrap_or((0, len.saturating_sub(1)));
                        if len == 0 { Vec::new() } else { (a..=b).collect() }
                    };
                    let (rows, columns) = (all(span.rows, sheet.rows.len()), all(span.columns, sheet.columns.len()));
                    guards.iter().any(|g| g.holds_any(&rows, &columns))
                }),
            };
            for set in protections {
                let before = before_of(sheet, &set.protection_id);
                let before = before.as_ref();
                let sides = || before.into_iter().chain(set.protection.as_ref());
                if sides().any(|p| kept_out(Some(p))) {
                    continue;
                }
                let is_sheet = |p: Option<&Protection>| matches!(p, Some(Protection { protects: Protects::Sheet { .. }, .. }));
                if is_sheet(before) && is_sheet(set.protection.as_ref()) {
                    continue;
                }
                if sides().any(held) {
                    return Err(CELLS);
                }
            }
            return Ok(None);
        }
        // A connected table's call is the whole sheet's: any protection of it with a line left refuses it.
        Op::SetConnectedTables { tables } => {
            for set in tables {
                let Some((_, guards)) = guards_of(&set.sheet_id) else { continue };
                if guards.iter().any(|g| !matches!(g, Guard::Range(None))) {
                    return Err(SHEET);
                }
            }
            return Ok(None);
        }
        Op::SetSheetNames { names } => {
            for name in names {
                let Some((_, guards)) = guards_of(&name.sheet_id) else { continue };
                if guards.iter().any(|g| matches!(g, Guard::Sheet(_))) {
                    return Err(SHEET);
                }
            }
            return Ok(None);
        }
        _ => {}
    }
    let Some(sheet_id) = sheet_of(op) else { return Ok(None) };
    let Some((sheet, guards)) = guards_of(sheet_id) else { return Ok(None) };
    if matches!(op, Op::DeleteSheet { .. }) {
        return Err(SHEET);
    }
    if changes_the_sheet(op) && guards.iter().any(|g| matches!(g, Guard::Sheet(_))) {
        return Err(SHEET);
    }
    let any_holds = |rows: &[usize], columns: &[usize]| guards.iter().any(|g| g.holds_any(rows, columns));
    let at = |axis: &Axis, id: &str| bases.parse(id).and_then(|l| axis.position(l));
    let spans = || guards.iter().filter_map(|g| match g {
        Guard::Range(Some(span)) => Some(*span),
        _ => None,
    });
    match op {
        Op::SetCells { cells, .. } => {
            for cell in cells {
                if let (Some(r), Some(c)) = (at(&sheet.rows, &cell.r), at(&sheet.columns, &cell.c)) {
                    if any_holds(&[r], &[c]) {
                        return Err(CELLS);
                    }
                }
            }
        }
        Op::SetCellFormats { formats, .. } => {
            for f in formats {
                let (rows, columns) = (positions(workbook, &sheet.rows, &f.rows), positions(workbook, &sheet.columns, &f.columns));
                if any_holds(&rows, &columns) {
                    return Err(CELLS);
                }
            }
        }
        Op::MergeCells { ranges, .. } | Op::UnmergeCells { ranges, .. } => {
            for range in ranges {
                if let Some((rows, columns)) = range_positions(bases, sheet, range) {
                    if any_holds(&rows, &columns) {
                        return Err(CELLS);
                    }
                }
            }
        }
        Op::SetConditionalFormats { conditional_formats, .. } => {
            for set in conditional_formats {
                let before = sheet.conditional_formats.get(&set.conditional_format_id).map(|(_, f)| &f.ranges);
                let after = set.conditional_format.as_ref().and_then(|f| f.ranges.as_ref());
                for range in before.into_iter().chain(after).flatten() {
                    if let Some((rows, columns)) = range_positions(bases, sheet, range) {
                        if any_holds(&rows, &columns) {
                            return Err(CELLS);
                        }
                    }
                }
            }
        }
        Op::SetDropdowns { dropdowns, .. } => {
            let ids: HashSet<&str> = dropdowns.iter().map(|d| d.dropdown_id.as_str()).collect();
            for (leaf, (r, c), value) in sheet.formats.iter() {
                if leaf != Leaf::CellControl || !value["dropdownId"].as_str().is_some_and(|id| ids.contains(id)) {
                    continue;
                }
                if let (Some(r), Some(c)) = (sheet.rows.position(r), sheet.columns.position(c)) {
                    if any_holds(&[r], &[c]) {
                        return Err(CELLS);
                    }
                }
            }
        }
        Op::InsertRows { after, .. } | Op::InsertColumns { after, .. } => {
            let on_rows = matches!(op, Op::InsertRows { .. });
            let axis = if on_rows { &sheet.rows } else { &sheet.columns };
            // Where the lines inserted land: after the lines live up to the one they go after.
            let landing = match after {
                None => Some(0),
                Some(id) => bases.parse(id).and_then(|l| axis.index(l)).map(|i| {
                    axis.all()[..=i].iter().filter(|&&l| axis.contains(l)).count()
                }),
            };
            if let Some(q) = landing {
                if spans().any(|s| s.on(on_rows).is_some_and(|(f, l)| f < q && q <= l)) {
                    return Err(LINES);
                }
            }
        }
        Op::DeleteRows { .. } | Op::DeleteColumns { .. } => {
            let (on_rows, runs): (bool, &[IdRun]) = match op {
                Op::DeleteRows { rows, .. } => (true, rows),
                Op::DeleteColumns { columns, .. } => (false, columns),
                _ => unreachable!(),
            };
            let axis = if on_rows { &sheet.rows } else { &sheet.columns };
            let deleted = positions(workbook, axis, runs);
            // Lines of a range that bounds them, before any range they are deleted across.
            if spans().filter_map(|s| s.on(on_rows)).any(|(f, l)| deleted.iter().any(|p| (f..=l).contains(p))) {
                return Err(LINES);
            }
            // Across a range: a cell of it holding something goes.
            let gone: HashSet<LineId> = deleted.iter().map(|&p| axis.line(p).expect("a live position")).collect();
            let other_axis = if on_rows { &sheet.columns } else { &sheet.rows };
            for span in spans().filter(|s| s.on(on_rows).is_none()) {
                let holds = sheet.cells.keys().any(|&(r, c)| {
                    let (line, other) = if on_rows { (r, c) } else { (c, r) };
                    gone.contains(&line)
                        && other_axis.position(other).is_some_and(|p| span.on(!on_rows).is_none_or(|(f, l)| (f..=l).contains(&p)))
                });
                if holds {
                    return Err(CELLS);
                }
            }
        }
        Op::UndeleteRows { .. } | Op::UndeleteColumns { .. } => {
            let (on_rows, runs): (bool, &[IdRun]) = match op {
                Op::UndeleteRows { rows, .. } => (true, &rows.runs),
                Op::UndeleteColumns { columns, .. } => (false, columns),
                _ => unreachable!(),
            };
            let axis = if on_rows { &sheet.rows } else { &sheet.columns };
            let restored: Vec<LineId> = runs
                .iter()
                .filter_map(|r| Some((bases.find(&r.base)?, r)))
                .flat_map(|(base, r)| (r.first as u64..r.first as u64 + r.count as u64).map(move |n| LineId { base, n: n as u32 }))
                .filter(|&l| axis.is_deleted(l))
                .collect();
            let mut back = axis.clone();
            back.undelete(&restored);
            let mut at_back: Vec<usize> = restored.iter().filter_map(|&l| back.position(l)).collect();
            at_back.sort_unstable();
            // Where each line comes back among the lines there now: after as many of them as are before it.
            let landing: Vec<usize> = at_back.iter().enumerate().map(|(i, &p)| p - i).collect();
            if spans().any(|s| s.on(on_rows).is_some_and(|(f, l)| landing.iter().any(|&q| f < q && q <= l))) {
                return Err(LINES);
            }
            // Across a range: a line comes back with a cell of it holding something.
            let back_lines: HashSet<LineId> = restored.iter().copied().collect();
            let other_axis = if on_rows { &sheet.columns } else { &sheet.rows };
            for span in spans().filter(|s| s.on(on_rows).is_none()) {
                let holds = sheet.cells.keys().any(|&(r, c)| {
                    let (line, other) = if on_rows { (r, c) } else { (c, r) };
                    back_lines.contains(&line)
                        && other_axis.position(other).is_some_and(|p| span.on(!on_rows).is_none_or(|(f, l)| (f..=l).contains(&p)))
                });
                if holds {
                    return Err(CELLS);
                }
            }
        }
        Op::MoveRows { .. } | Op::MoveColumns { .. } => {
            let on_rows = matches!(op, Op::MoveRows { .. });
            let axis = if on_rows { &sheet.rows } else { &sheet.columns };
            let ranges: Vec<Vec<LineId>> = spans()
                .filter_map(|s| s.on(on_rows))
                .map(|(f, l)| (f..=l).map(|p| axis.line(p).expect("a live position")).collect())
                .collect();
            if !ranges.is_empty() {
                return Ok(Some(After::Together { sheet_id: sheet_id.to_owned(), rows: on_rows, ranges }));
            }
        }
        Op::ReorderRows { rows: in_order, .. } => {
            let named: HashSet<LineId> = in_order
                .ids
                .iter()
                .filter_map(|ids| Some((bases.find(&ids.base)?, &ids.runs)))
                .flat_map(|(base, runs)| runs.iter().flat_map(move |&(f, n)| (f as u64..f as u64 + n as u64).map(move |n| LineId { base, n: n as u32 })))
                .collect();
            let named_at: Vec<usize> = named.iter().filter_map(|&l| sheet.rows.position(l)).collect();
            if spans().any(|s| s.rows.is_some_and(|(f, l)| named_at.iter().any(|p| (f..=l).contains(p)))) {
                return Err(LINES);
            }
            let columns: Vec<(usize, usize)> = spans().filter(|s| s.rows.is_none()).filter_map(|s| s.columns).collect();
            if !columns.is_empty() {
                let cells = sheet
                    .cells
                    .iter()
                    .filter(|(_, cell)| matches!(cell.input, Input::Formula { .. }))
                    .filter_map(|(&(r, c), cell)| {
                        let (pr, pc) = (sheet.rows.position(r)?, sheet.columns.position(c)?);
                        columns.iter().any(|&(f, l)| (f..=l).contains(&pc)).then(|| (r, c, cell.input.clone(), pr))
                    })
                    .collect();
                return Ok(Some(After::Formulas { sheet_id: sheet_id.to_owned(), cells }));
            }
        }
        _ => {}
    }
    Ok(None)
}
