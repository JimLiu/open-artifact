//! Bind an interactive view's writable inputs to live cells and compare them with their defaults.
//!
//! - A cell with limits (`valueLimits`, neither a checkbox's nor a dropdown's) is reset only to a default within them:
//!   blank, or a number between them. A cell saved more than once is reset to the value saved
//!   last, or not at all.
//! - Saving the defaults gives each cell saved the value it holds now, in the order they are saved, twice when it is
//!   saved twice. A cell whose row or column is gone is left out; so is one outside the range, under a merged cell or
//!   holding more than a value, and that is a change. Nothing else changing, there is nothing to save.

use crate::session::edits::defaults::{limits_at, within};
use crate::workbook::formats::Leaf;
use crate::workbook::layout::{merged_boxes, RangeIds};
use crate::workbook::objects::{
    InputOfAWidget, InteractiveCell, InteractiveValue, InteractiveWrite, RangeOnASheet, View, ViewElement,
};
use crate::ids::LineId;
use crate::workbook::{Sheet, Workbook};

pub(super) struct Binding<'a> {
    workbook: &'a Workbook,
    pub sheet: usize,
    bounds: (usize, usize, usize, usize),
    merges: Vec<(usize, usize, usize, usize)>,
}

impl<'a> Binding<'a> {
    pub fn new(workbook: &'a Workbook, range: &RangeOnASheet) -> Option<Self> {
        let sheet = workbook.sheet_index(&range.sheet_id)?;
        let corners = RangeIds {
            top_left: range.top_left.clone(),
            bottom_right: range.bottom_right.clone(),
        };
        let bounds = workbook.sheets[sheet].live_box(&workbook.bases, &corners)?;
        let merges = merged_boxes(&workbook.bases, &workbook.sheets[sheet]);
        Some(Self {
            workbook,
            sheet,
            bounds,
            merges,
        })
    }

    pub fn position(&self, r: &str, c: &str) -> Option<(usize, usize)> {
        self.place(r, c).filter(|&(_, inside)| inside).map(|(at, _)| at)
    }

    /// Where a cell is on the sheet, and whether it is in the range: none when its row or column is not there.
    fn place(&self, r: &str, c: &str) -> Option<((usize, usize), bool)> {
        let sheet = &self.workbook.sheets[self.sheet];
        let row = sheet.rows.position(self.workbook.bases.parse(r)?)?;
        let column = sheet.columns.position(self.workbook.bases.parse(c)?)?;
        let (top, bottom, left, right) = self.bounds;
        Some(((row, column), (top..=bottom).contains(&row) && (left..=right).contains(&column)))
    }

    /// The limits a cell's values are held to (`limits_held`).
    fn limits(&self, (row, column): (usize, usize)) -> Option<(Option<f64>, Option<f64>)> {
        let sheet = &self.workbook.sheets[self.sheet];
        limits_held(sheet, sheet.rows.line(row).zip(sheet.columns.line(column))?)
    }

    /// Whether a value goes with a cell's limits: blank, or a number within them.
    fn is_within_limits(&self, at: (usize, usize), value: Option<&InteractiveValue>) -> bool {
        match (self.limits(at), value) {
            (None, _) | (_, None) => true,
            (Some(limits), Some(InteractiveValue::Number { value })) => within(*value, limits),
            _ => false,
        }
    }

    pub fn at_offset(&self, row: usize, column: usize) -> Option<(usize, usize)> {
        let (top, bottom, left, right) = self.bounds;
        let (r, c) = (top.checked_add(row)?, left.checked_add(column)?);
        (r <= bottom && c <= right).then_some((r, c))
    }

    pub fn is_covered(&self, (row, column): (usize, usize)) -> bool {
        self.merges
            .iter()
            .any(|&(t, b, l, r)| (t..=b).contains(&row) && (l..=r).contains(&column) && (row, column) != (t, l))
    }

    pub fn fits(&self, (row, column): (usize, usize), value: Option<&InteractiveValue>) -> bool {
        let sheet = &self.workbook.sheets[self.sheet];
        let Some(ids) = sheet.rows.line(row).zip(sheet.columns.line(column)) else {
            return false;
        };
        let control = sheet.formats.get(Leaf::CellControl, ids);
        match (control.and_then(|format| format["kind"].as_str()), value) {
            (_, None) | (None | Some("none"), _) => true,
            (Some("checkbox"), Some(InteractiveValue::Boolean { .. })) => true,
            _ => false,
        }
    }

    pub fn read(&self, (row, column): (usize, usize)) -> Result<InteractiveCell, ()> {
        let sheet = &self.workbook.sheets[self.sheet];
        let r = sheet.rows.line(row).ok_or(())?;
        let c = sheet.columns.line(column).ok_or(())?;
        let value = InteractiveValue::from_input(sheet.cells.get(&(r, c)).map(|cell| &cell.input))?;
        Ok(InteractiveCell {
            r: self.workbook.bases.text(r),
            c: self.workbook.bases.text(c),
            value,
        })
    }
}

/// The limits an interactive holds a cell's values to: none for a checkbox's or a dropdown's.
pub(super) fn limits_held(sheet: &Sheet, ids: (LineId, LineId)) -> Option<(Option<f64>, Option<f64>)> {
    let control = sheet.formats.get(Leaf::CellControl, ids).and_then(|format| format["kind"].as_str());
    if control.is_some_and(|kind| kind != "none") {
        return None;
    }
    limits_at(sheet, ids)
}

/// The cells a reset changes, with the value each is given.
pub(super) fn reset_changes(workbook: &Workbook, view: &View) -> Vec<(usize, (usize, usize), InteractiveCell)> {
    let mut changes = Vec::new();
    for element in &view.elements {
        let ViewElement::Interactive { inputs, writes, .. } = element else {
            continue;
        };
        for write in writes {
            let Some(range) = inputs
                .iter()
                .find(|input| input.name == write.input)
                .map(|input| &input.range)
            else {
                continue;
            };
            let Some(binding) = Binding::new(workbook, range) else {
                continue;
            };
            for (at, saved, current) in defaults_held(&binding, &write.saved) {
                if saved.value != current {
                    changes.push((binding.sheet, at, saved.clone()));
                }
            }
        }
    }
    changes
}

/// The cells a write saved that a reset can give their default, each with that default and the value it holds now: a
/// cell saved more than once has the value saved last, and one under a merged cell, holding more than a value, or
/// whose default does not go with its control or limits has none.
fn defaults_held<'s>(
    binding: &Binding,
    saved: &'s [InteractiveCell],
) -> Vec<((usize, usize), &'s InteractiveCell, Option<InteractiveValue>)> {
    let mut last: Vec<((usize, usize), &InteractiveCell)> = Vec::new();
    for cell in saved {
        let Some(at) = binding.position(&cell.r, &cell.c) else {
            continue;
        };
        last.retain(|(other, _)| *other != at);
        last.push((at, cell));
    }
    last.into_iter()
        .filter_map(|(at, cell)| {
            let current = binding.read(at).ok()?;
            let held = !binding.is_covered(at)
                && binding.fits(at, cell.value.as_ref())
                && binding.is_within_limits(at, cell.value.as_ref());
            held.then_some((at, cell, current.value))
        })
        .collect()
}

/// The defaults an interactive's writes keep for one of its inputs, by where each cell is on the input's sheet: the
/// value a reset gives the cell, and whether that changes it. A cell saved by more than one write has the later one's.
pub(super) fn defaults_of_input(
    workbook: &Workbook,
    input: &InputOfAWidget,
    writes: &[InteractiveWrite],
) -> Option<(usize, Vec<((usize, usize), Option<InteractiveValue>, bool)>)> {
    let binding = Binding::new(workbook, &input.range)?;
    let mut defaults: Vec<((usize, usize), Option<InteractiveValue>, bool)> = Vec::new();
    for write in writes.iter().filter(|write| write.input == input.name) {
        for (at, saved, current) in defaults_held(&binding, &write.saved) {
            defaults.retain(|(other, _, _)| *other != at);
            defaults.push((at, saved.value.clone(), saved.value != current));
        }
    }
    Some((binding.sheet, defaults))
}

/// The cells reset would change, each once.
pub(super) fn count_to_reset(workbook: &Workbook, view: &View) -> usize {
    let mut cells: Vec<(usize, (usize, usize))> = reset_changes(workbook, view).into_iter().map(|(s, at, _)| (s, at)).collect();
    cells.sort_unstable();
    cells.dedup();
    cells.len()
}

/// The view with the cells saved given the values they hold now; none when that changes nothing.
pub(super) fn with_current_defaults(workbook: &Workbook, view: &View) -> Option<View> {
    let mut view = view.clone();
    let mut changed = false;
    for element in &mut view.elements {
        let ViewElement::Interactive { inputs, writes, .. } = element else {
            continue;
        };
        for write in writes {
            let binding = inputs
                .iter()
                .find(|input| input.name == write.input)
                .and_then(|input| Binding::new(workbook, &input.range));
            let Some(binding) = binding else { continue };
            let saved = std::mem::take(&mut write.saved);
            for cell in saved {
                let Some((at, inside)) = binding.place(&cell.r, &cell.c) else { continue };
                match binding.read(at) {
                    Ok(current) if inside && !binding.is_covered(at) => {
                        changed |= current.value != cell.value;
                        write.saved.push(InteractiveCell { value: current.value, ..cell });
                    }
                    _ => changed = true,
                }
            }
        }
    }
    changed.then_some(view)
}
