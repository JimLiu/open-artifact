//! Sittings: the presses of a person at an interactive, taken back and made again as they made them.
//!
//! - `writeFromInteractive` and `resetInteractive` may say what made them (`madeBy`: a `sitting`, any text, and a
//!   `press`, a whole number below 2^32; null is the same as left out, anything else in it is unreadable). Their edits
//!   are queued with the sitting as their action (`actionId`), and so are the edits that take back or make again a
//!   step of a sitting, whatever asks for it. A sitting writes any cell of its input's range, saved or not.
//! - An edit of a sitting whose press is the last step's (the same sitting and press) is folded into that step;
//!   otherwise it is a step of its own, with its sitting and press. Either way, nothing taken back is to be made
//!   again. Folded, when each of its edits sets only cells one of the step's edits sets, each gives them its inputs
//!   there (to the last that sets them), the step's way back kept; otherwise its edits are added to the step. The
//!   step keeps the name of its first edit.
//! - `writeFromInteractive` without `madeBy` is no step at all: the history is as it was, what was taken back can
//!   still be made again, and a press goes on folding into its step. `resetInteractive` without it is a step as any
//!   edit is.
//! - `queueReversalInASitting {opId, sitting, reversal}`: `undoOfAPress` takes back the last step when it is of the
//!   sitting, as `queueNextUndo` does; `redo` makes the last step taken back again when it is of the sitting;
//!   `undoOfAll` takes back the last steps of the sitting, one after the other, as one step (each folded into the one
//!   before it, the last two first; with the first's name and the last one's press), taken back and made again as
//!   one from then on. Otherwise there is nothing to reverse.
//! - Of the steps kept (100), when one more is made, the first is left out, unless the second is of its sitting:
//!   then the two are one step, folded.

use hashbrown::HashMap;
use serde::Deserialize;
use serde_json::json;

use super::edits::{self, interactive};
use super::history::{Part, Stack, Step, Steps};
use super::{refused, WorkbookSession};
use crate::workbook::load::{CellToSet, Op};

/// What made an edit of an interactive: a person's sitting at it, and their press in it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MadeBy {
    pub sitting: String,
    pub press: u32,
}

/// What is taken back or made again of a sitting.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reversal {
    UndoOfAPress,
    UndoOfAll,
    Redo,
}

/// How an edit goes into the history.
pub enum Kept {
    /// As a step of its own.
    Step,
    /// Not at all: an interactive's write that no sitting made.
    Not,
    /// In its sitting's step.
    Made(MadeBy),
}

impl Kept {
    pub fn of(edit: &edits::Edit) -> Kept {
        match edit {
            edits::Edit::Interactive(interactive::Edit::WriteFromInteractive { made_by: None, .. }) => Kept::Not,
            edits::Edit::Interactive(
                interactive::Edit::WriteFromInteractive { made_by: Some(made_by), .. }
                | interactive::Edit::ResetInteractive { made_by: Some(made_by), .. },
            ) => Kept::Made(made_by.clone()),
            _ => Kept::Step,
        }
    }

    /// The action its edits are queued with: its sitting's.
    pub fn action(&self) -> Option<String> {
        match self {
            Kept::Made(made_by) => Some(made_by.sitting.clone()),
            _ => None,
        }
    }

    /// The step made, put in the history as it goes.
    pub fn keep(self, steps: &mut Steps, mut step: Step) {
        match self {
            Kept::Not => {}
            Kept::Step => steps.made(step),
            Kept::Made(made_by) => match steps.undo.last_mut().filter(|last| last.made_by.as_ref() == Some(&made_by)) {
                Some(last) => {
                    fold(last, step);
                    steps.redo.clear();
                }
                None => {
                    step.made_by = Some(made_by);
                    steps.made(step);
                }
            },
        }
    }
}

/// The cells an edit's operations set, by sheet and ids, with their inputs, the last given last; none when it does
/// anything else.
fn cells_set(ops: &[Op]) -> Option<HashMap<(&str, &str, &str), &CellToSet>> {
    let mut set = HashMap::new();
    for op in ops {
        let Op::SetCells { sheet_id, cells, .. } = op else { return None };
        for cell in cells {
            set.insert((sheet_id.as_str(), cell.r.as_str(), cell.c.as_str()), cell);
        }
    }
    Some(set)
}

/// Whether a part sets each of the cells.
fn covers(part: &Part, cells: &HashMap<(&str, &str, &str), &CellToSet>) -> bool {
    let mut set = hashbrown::HashSet::new();
    for op in &part.ops {
        if let Op::SetCells { sheet_id, cells, .. } = op {
            set.extend(cells.iter().map(|cell| (sheet_id.as_str(), cell.r.as_str(), cell.c.as_str())));
        }
    }
    cells.keys().all(|key| set.contains(key))
}

/// A step folded into the one before it (`into`): when each of its parts sets only cells a part of `into` sets, each
/// gives its inputs to the last such part, the way back kept; otherwise its parts are all added. The step's name
/// stays; its press is the later one's. A step folded tells no edit's place of its own (`Step::roles`).
pub fn fold(into: &mut Step, step: Step) {
    into.roles = None;
    if step.made_by.is_some() {
        into.made_by = step.made_by;
    }
    let found: Option<Vec<usize>> = step
        .parts
        .iter()
        .map(|part| cells_set(&part.ops).and_then(|cells| into.parts.iter().rposition(|p| covers(p, &cells))))
        .collect();
    let Some(found) = found else {
        into.parts.extend(step.parts);
        return;
    };
    for (part, k) in step.parts.iter().zip(found) {
        let given = cells_set(&part.ops).unwrap_or_default();
        for op in &mut into.parts[k].ops {
            let Op::SetCells { sheet_id, cells, .. } = op else { continue };
            for cell in cells {
                if let Some(set) = given.get(&(sheet_id.as_str(), cell.r.as_str(), cell.c.as_str())) {
                    cell.input = set.input.clone();
                }
            }
        }
    }
}

/// Of the steps of a stack past the most kept, the first left out, or folded into the second when it is of its
/// sitting.
pub fn leave_out_first(steps: &mut Vec<Step>) {
    let sitting = |step: &Step| step.made_by.as_ref().map(|m| m.sitting.clone());
    if steps.len() > 1 && sitting(&steps[0]).is_some() && sitting(&steps[0]) == sitting(&steps[1]) {
        let second = steps.remove(1);
        fold(&mut steps[0], second);
    } else {
        steps.remove(0);
    }
}

impl WorkbookSession {
    /// A step of a sitting taken back or made again (`queueReversalInASitting`).
    pub(super) fn queue_reversal_in_a_sitting(&mut self, op_id: String, sitting: &str, reversal: Reversal) -> String {
        if self.stop.is_some() {
            return refused("syncStopped");
        }
        if self.is_op_id_in_use(&op_id) {
            return refused("opIdInUse");
        }
        let stack = match reversal {
            Reversal::Redo => Stack::Redo,
            Reversal::UndoOfAPress | Reversal::UndoOfAll => Stack::Undo,
        };
        let is_of = |step: &Step| step.made_by.as_ref().is_some_and(|m| m.sitting == sitting);
        if !self.steps.last(stack).is_some_and(is_of) {
            return json!({"kind": "nothingToReverse"}).to_string();
        }
        if let Reversal::UndoOfAll = reversal {
            let from = self.steps.undo.iter().rposition(|step| !is_of(step)).map_or(0, |k| k + 1);
            // The last two folded first, then the one before them into what they make, and so on.
            let mut of_sitting = self.steps.undo.split_off(from);
            let mut all = of_sitting.pop().expect("a step of the sitting");
            while let Some(mut before) = of_sitting.pop() {
                fold(&mut before, all);
                all = before;
            }
            self.steps.undo.push(all);
        }
        self.queue_next_reverse(op_id, stack)
    }

    /// The edits queued under an op id (it, or `<opId>.0`, `.1`, …) made the action of a sitting.
    pub(super) fn queued_in_sitting(&mut self, op_id: &str, made_by: Option<&MadeBy>) {
        let Some(made_by) = made_by else { return };
        let parts = format!("{op_id}.");
        for queued in &mut self.queue {
            if queued.op_id == op_id || queued.op_id.strip_prefix(&parts).is_some_and(|k| k.parse::<usize>().is_ok()) {
                queued.action_id = Some(made_by.sitting.clone());
            }
        }
    }
}
