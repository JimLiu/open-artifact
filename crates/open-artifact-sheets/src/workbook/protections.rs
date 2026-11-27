//! What of a sheet is protected, and who may still edit it (`setProtections`, format 52).
//!
//! A protection protects a range of the sheet (some cells, whole rows or whole columns), or the whole sheet but its
//! open ranges, and names its editors by user id (each well formed, none twice; otherwise the operation is
//! unreadable). The operation sets protections by id (`null` removes one): an id named twice is refused
//! (`protectionNamedTwice`), and the rows and columns named are to be the sheet's, deleted or not (`unknownRow`,
//! `unknownColumn`). It sets them as written: ends out of order stay so, and no limit is held to (the edits that
//! save protections hold them). The sheet is one not deleted (`unknownSheet`); a deleted sheet keeps its
//! protections, to come back with it.
//!
//! Reads show a range by its lines left: each end snapped toward the other, in order. A range protection with no
//! line left on an axis is left out, and so is an open range with none.

use hashbrown::HashSet;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use super::layout::{id_key, live_ends, CellIds};
use super::load::{Lines, Op, Refusal};

/// Rows (`true`) or columns.
pub type OnRows = bool;
use super::{Sheet, Workbook};
use crate::ids::{Axis, Bases, LineId};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProtectedRange {
    #[serde(rename_all = "camelCase")]
    Cells { top_left: CellIds, bottom_right: CellIds },
    WholeRows { first: String, last: String },
    WholeColumns { first: String, last: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Protects {
    Range { range: ProtectedRange },
    #[serde(rename_all = "camelCase")]
    Sheet { open_ranges: Vec<ProtectedRange> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Protection {
    pub protects: Protects,
    pub editors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectionToSet {
    pub protection_id: String,
    #[serde(deserialize_with = "super::layout::written::maybe_null")]
    pub protection: Option<Protection>,
}

/// The ends of a range on one axis, as written: `None` when the range takes every line of it.
pub type Ends<'a> = Option<(&'a str, &'a str)>;

impl ProtectedRange {
    /// The range's ends on the rows and on the columns.
    pub fn ends(&self) -> (Ends<'_>, Ends<'_>) {
        match self {
            ProtectedRange::Cells { top_left, bottom_right } => {
                (Some((&top_left.r, &bottom_right.r)), Some((&top_left.c, &bottom_right.c)))
            }
            ProtectedRange::WholeRows { first, last } => (Some((first, last)), None),
            ProtectedRange::WholeColumns { first, last } => (None, Some((first, last))),
        }
    }

    fn ends_mut(&mut self) -> (Option<(&mut String, &mut String)>, Option<(&mut String, &mut String)>) {
        match self {
            ProtectedRange::Cells { top_left, bottom_right } => (
                Some((&mut top_left.r, &mut bottom_right.r)),
                Some((&mut top_left.c, &mut bottom_right.c)),
            ),
            ProtectedRange::WholeRows { first, last } => (Some((first, last)), None),
            ProtectedRange::WholeColumns { first, last } => (None, Some((first, last))),
        }
    }

    /// The ends on one axis.
    pub fn ends_on(&self, on_rows: OnRows) -> Ends<'_> {
        let (rows, columns) = self.ends();
        if on_rows { rows } else { columns }
    }

    /// The positions the range takes now on each axis, in order (`None` on an axis it takes whole); `None` when it
    /// has no line left on one.
    pub fn live(&self, bases: &Bases, sheet: &Sheet) -> Option<Span> {
        let on = |axis: &Axis, ends: Ends<'_>| -> Option<Option<(usize, usize)>> {
            match ends {
                None => Some(None),
                Some((a, b)) => Some(Some(live_ends(axis, bases.parse(a)?, bases.parse(b)?)?)),
            }
        };
        let (rows, columns) = self.ends();
        Some(Span { rows: on(&sheet.rows, rows)?, columns: on(&sheet.columns, columns)? })
    }

    /// The range as reads show it: by its lines left, in order.
    fn shown(&self, bases: &Bases, sheet: &Sheet) -> Option<ProtectedRange> {
        let span = self.live(bases, sheet)?;
        let row = |p: usize| bases.text(sheet.rows.line(p).expect("a live position"));
        let column = |p: usize| bases.text(sheet.columns.line(p).expect("a live position"));
        Some(match (span.rows, span.columns) {
            (Some((t, b)), Some((l, r))) => ProtectedRange::Cells {
                top_left: CellIds { r: row(t), c: column(l) },
                bottom_right: CellIds { r: row(b), c: column(r) },
            },
            (Some((t, b)), None) => ProtectedRange::WholeRows { first: row(t), last: row(b) },
            (None, Some((l, r))) => ProtectedRange::WholeColumns { first: column(l), last: column(r) },
            (None, None) => unreachable!("a range bounds an axis"),
        })
    }
}

/// Where a range is now: the positions of its rows and of its columns, in order (`None`: every one).
#[derive(Clone, Copy, Debug)]
pub struct Span {
    pub rows: Option<(usize, usize)>,
    pub columns: Option<(usize, usize)>,
}

impl Span {
    pub fn on(&self, on_rows: OnRows) -> Option<(usize, usize)> {
        if on_rows { self.rows } else { self.columns }
    }

    pub fn holds(&self, row: usize, column: usize) -> bool {
        let within = |ends: Option<(usize, usize)>, p: usize| ends.is_none_or(|(a, b)| (a..=b).contains(&p));
        within(self.rows, row) && within(self.columns, column)
    }

    /// Whether the span shares a cell with a box (top, bottom, left, right).
    pub fn meets(&self, (top, bottom, left, right): (usize, usize, usize, usize)) -> bool {
        let meets = |ends: Option<(usize, usize)>, a: usize, b: usize| ends.is_none_or(|(x, y)| x <= b && a <= y);
        meets(self.rows, top, bottom) && meets(self.columns, left, right)
    }
}

impl Protection {
    /// The ranges the protection names: its range, or the open ranges of its sheet.
    pub fn ranges(&self) -> &[ProtectedRange] {
        match &self.protects {
            Protects::Range { range } => std::slice::from_ref(range),
            Protects::Sheet { open_ranges } => open_ranges,
        }
    }

    fn ranges_mut(&mut self) -> &mut Vec<ProtectedRange> {
        match &mut self.protects {
            Protects::Range { .. } => unreachable!("asked of a sheet's protection"),
            Protects::Sheet { open_ranges } => open_ranges,
        }
    }

    pub fn is_of_the_sheet(&self) -> bool {
        matches!(self.protects, Protects::Sheet { .. })
    }

    /// The protection as reads show it; `None` when its range has no line left.
    fn shown(&self, bases: &Bases, sheet: &Sheet) -> Option<Protection> {
        let protects = match &self.protects {
            Protects::Range { range } => Protects::Range { range: range.shown(bases, sheet)? },
            Protects::Sheet { open_ranges } => {
                Protects::Sheet { open_ranges: open_ranges.iter().filter_map(|r| r.shown(bases, sheet)).collect() }
            }
        };
        Some(Protection { protects, editors: self.editors.clone() })
    }
}

/// Whether the protections to set are read: some, each protection's editors well formed and
/// each named once.
pub fn are_well_formed(protections: &[ProtectionToSet]) -> bool {
    !protections.is_empty()
        && protections.iter().filter_map(|p| p.protection.as_ref()).all(|p| {
            let mut seen = HashSet::new();
            p.editors.iter().all(|e| super::rich::is_user_id(e) && seen.insert(e.as_str()))
        })
}

/// The sheet's protections as reads show them, by id.
pub fn contents(bases: &Bases, sheet: &Sheet) -> Vec<Json> {
    sheet
        .protections
        .values()
        .filter_map(|(id, p)| Some(json!({"protectionId": id, "protection": p.shown(bases, sheet)?})))
        .collect()
}

/// The sheet's protections as written, by id (as snapshots keep them).
pub fn entries(sheet: &Sheet) -> Vec<Json> {
    sheet.protections.values().map(|(id, p)| json!({"protectionId": id, "protection": p})).collect()
}

impl Workbook {
    pub(super) fn apply_protections(&mut self, sheet_id: &str, protections: &[ProtectionToSet]) -> Result<Op, Refusal> {
        let index = self.sheet_index(sheet_id).ok_or(Refusal::UnknownSheet)?;
        let mut seen = HashSet::new();
        if !protections.iter().all(|p| seen.insert(p.protection_id.as_str())) {
            return Err(Refusal::ProtectionNamedTwice);
        }
        let sheet = &self.sheets[index];
        for range in protections.iter().filter_map(|p| p.protection.as_ref()).flat_map(Protection::ranges) {
            let (rows, columns) = range.ends();
            for (lines, ends) in [(Lines::Rows, rows), (Lines::Columns, columns)] {
                if let Some((a, b)) = ends {
                    self.known_line(sheet, lines, a)?;
                    self.known_line(sheet, lines, b)?;
                }
            }
        }
        let sheet = &mut self.sheets[index];
        let mut reverse = Vec::with_capacity(protections.len());
        for p in protections {
            let key = id_key(&p.protection_id);
            let before = match &p.protection {
                Some(protection) => sheet.protections.insert(key, (p.protection_id.clone(), protection.clone())),
                None => sheet.protections.remove(&key),
            };
            reverse.push(ProtectionToSet { protection_id: p.protection_id.clone(), protection: before.map(|(_, p)| p) });
        }
        Ok(Op::SetProtections { sheet_id: sheet_id.to_owned(), protections: reverse })
    }
}

/// The protections of a sheet as they are to be once lines of it are deleted (`after`: the axis without them), in
/// a `setProtections` that comes before the deletion; `None` when none changes. An end on a line gone names the
/// nearest line left toward the other end; a range protection with none left between its ends goes, and so does an
/// open range of a sheet's protection.
pub fn after_deleting(bases: &Bases, sheet: &Sheet, on_rows: OnRows, after: &Axis) -> Option<Op> {
    let follow = |range: &mut ProtectedRange| -> Option<()> {
        let Some((a, b)) = ends_mut(range, on_rows) else { return Some(()) };
        let (one, other) = (bases.parse(a)?, bases.parse(b)?);
        let (pa, pb) = (after.snap_toward(one, other)?, after.snap_toward(other, one)?);
        *a = bases.text(after.line(pa).expect("a live position"));
        *b = bases.text(after.line(pb).expect("a live position"));
        Some(())
    };
    changed(sheet, |protection| match &mut protection.protects {
        Protects::Range { range } => follow(range).map(|()| ()),
        Protects::Sheet { .. } => {
            protection.ranges_mut().retain_mut(|range| follow(range).is_some());
            Some(())
        }
    })
}

/// The protections of a sheet as they are to be once lines of it are moved (`after`: the axis moved, `moved`: the
/// lines that move), in a `setProtections` that comes after the move; `None` when none changes. A range whose lines
/// are still side by side takes its first and last as they come; one whose lines are parted takes the first and
/// last of those that stay.
pub fn after_moving(bases: &Bases, sheet: &Sheet, on_rows: OnRows, after: &Axis, moved: &HashSet<LineId>) -> Option<Op> {
    let axis = if on_rows { &sheet.rows } else { &sheet.columns };
    let follow = |range: &mut ProtectedRange| {
        let Some((a, b)) = ends_mut(range, on_rows) else { return };
        let (Some(one), Some(other)) = (bases.parse(a), bases.parse(b)) else { return };
        let Some((first, last)) = live_ends(axis, one, other) else { return };
        let held: Vec<LineId> = (first..=last).map(|p| axis.line(p).expect("a live position")).collect();
        let mut places: Vec<usize> = held.iter().map(|&l| after.position(l).expect("a live line")).collect();
        places.sort_unstable();
        let (lo, hi) = if places[places.len() - 1] - places[0] + 1 == places.len() {
            (places[0], places[places.len() - 1])
        } else {
            let mut staying = held.iter().filter(|l| !moved.contains(*l)).map(|&l| after.position(l).expect("a live line"));
            let Some(lo) = staying.next() else { return };
            (lo, staying.last().unwrap_or(lo))
        };
        let (lo, hi) = (bases.text(after.line(lo).expect("a live position")), bases.text(after.line(hi).expect("a live position")));
        // Ends out of order stay out of order.
        let is_in_order = axis.snap_toward(one, other) <= axis.snap_toward(other, one);
        let (x, y) = if is_in_order { (lo, hi) } else { (hi, lo) };
        *a = x;
        *b = y;
    };
    changed(sheet, |protection| {
        match &mut protection.protects {
            Protects::Range { range } => follow(range),
            Protects::Sheet { open_ranges } => open_ranges.iter_mut().for_each(follow),
        }
        Some(())
    })
}

fn ends_mut(range: &mut ProtectedRange, on_rows: OnRows) -> Option<(&mut String, &mut String)> {
    let (rows, columns) = range.ends_mut();
    if on_rows { rows } else { columns }
}

/// The protections the change makes other than they are (`None` from it: the protection goes), as one
/// `setProtections` by id.
fn changed(sheet: &Sheet, mut change: impl FnMut(&mut Protection) -> Option<()>) -> Option<Op> {
    let mut protections = Vec::new();
    for (id, protection) in sheet.protections.values() {
        let mut changed = protection.clone();
        let protection_after = change(&mut changed).map(|()| changed);
        if protection_after.as_ref() != Some(protection) {
            protections.push(ProtectionToSet { protection_id: id.clone(), protection: protection_after });
        }
    }
    (!protections.is_empty()).then(|| Op::SetProtections { sheet_id: sheet.id.clone(), protections })
}

/// The ends of the sheet's protections on rows, each naming the row now at its place once rows are put in order
/// (`after`): what a `reorderRows` does to them. An end on a deleted row is left as it is.
pub(super) fn kept_in_place(bases: &Bases, sheet: &mut Sheet, after: &Axis) {
    let rows = sheet.rows.clone();
    let moved = |id: &mut String| {
        let Some(line) = bases.parse(id) else { return };
        if let Some(l) = rows.position(line).and_then(|p| after.line(p)) {
            *id = bases.text(l);
        }
    };
    for (_, protection) in sheet.protections.values_mut() {
        let ranges: &mut [ProtectedRange] = match &mut protection.protects {
            Protects::Range { range } => std::slice::from_mut(range),
            Protects::Sheet { open_ranges } => open_ranges,
        };
        for range in ranges {
            if let Some((a, b)) = ends_mut(range, true) {
                moved(a);
                moved(b);
            }
        }
    }
}
