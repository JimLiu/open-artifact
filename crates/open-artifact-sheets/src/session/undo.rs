//! The page's undo and redo, and its taking back of edits the server worked out (`queueNextUndo`, `queueNextRedo`,
//! `queueEditsThatTakeBack`): the session's requests for them. What a step is and how it is taken back is in
//! `history`.

use serde_json::{json, Value as Json};

use super::history::{self, Part, Role, Stack, Step, StepNotTaken};
use super::{new_ids, place, refused, Queued, Recorded, WorkbookSession};
use crate::workbook::load::Op;
use crate::workbook::{version, Workbook};

impl WorkbookSession {
    /// Whether an op id is in use: an edit queued has it, was queued under it, or takes back the action of that id;
    /// or an edit or a step of the history has it.
    pub(super) fn is_op_id_in_use(&self, op_id: &str) -> bool {
        self.queue.iter().any(|q| q.op_id == op_id || q.asked_as == op_id || q.action_id.as_deref() == Some(op_id))
            || self.steps.uses(op_id)
    }

    /// A step of the page's own taken back (`queueNextUndo`) or made again (`queueNextRedo`).
    pub(super) fn queue_next_reverse(&mut self, op_id: String, stack: Stack) -> String {
        if self.stop.is_some() {
            return refused("syncStopped");
        }
        if self.is_op_id_in_use(&op_id) {
            return refused("opIdInUse");
        }
        let queue = &self.queue;
        let Some(step) = self.steps.last(stack) else { return json!({"kind": "nothingToReverse"}).to_string() };
        let (name, is_one_action, made_by) = (step.name.clone(), step.is_one_action, step.made_by.clone());
        let moved = step.moved.clone();
        let reverses = history::reverses_of(step, |id| queue.iter().find(|q| q.op_id == id).map(|q| q.reverse.clone()));
        // Of a step made of several edits, which edit each part queued is of: the parts are taken back last first,
        // those with nothing to take back left out.
        let roles: Option<Vec<Role>> = match (&step.roles, &reverses) {
            (Some(roles), Ok(parts)) => Some(
                parts
                    .iter()
                    .zip(roles)
                    .rev()
                    .filter(|((ops, reverse), _)| !history::zone_kept(ops, reverse).1.is_empty())
                    .map(|(_, &role)| role)
                    .collect(),
            ),
            _ => None,
        };
        // A step undeleting what the load forgot is not taken back on the workbook shown: its edits are queued as
        // they are, for the server to say what became of them (see `queue_made`).
        let forgotten = reverses.as_ref().ok().filter(|parts| {
            parts.iter().all(|(_, reverse)| new_ids::are_well_formed(reverse))
                && parts.iter().any(|(_, reverse)| self.forgets(reverse))
        });
        if let Some(parts) = forgotten {
            let made: Vec<(Vec<Op>, Vec<Op>)> = parts
                .iter()
                .rev()
                .map(|(ops, reverse)| history::zone_kept(ops, reverse).1)
                .filter(|reverse| !reverse.is_empty())
                .map(|reverse| (reverse, Vec::new()))
                .collect();
            self.steps.pop(stack);
            let (mut step, place) = self.queue_made(&op_id, false, is_one_action, self.workbook.clone(), made);
            step.name = name.clone();
            step.roles = roles;
            step.made_by = made_by.clone();
            self.queued_in_sitting(&op_id, made_by.as_ref());
            step.moved = moved;
            self.steps.taken_back(stack, step);
            return self.answer_queued(place, Some(&name));
        }
        let mut after = self.workbook.clone();
        // A step whose reverse was never known is given up whatever: no load tells it.
        let known = reverses.is_ok();
        match reverses.and_then(|parts| history::take_back_step(&mut after, &parts, self.person.as_ref(), made_by.is_some())) {
            Err(why @ StepNotTaken::Refused(_)) => why.answer(),
            // While the workbook is to be loaded, or an edit queued is not made on the workbook shown (it undeletes
            // what the load forgot, or it was sent and no longer applies here), the step is kept, whatever stands in
            // its way (the sheet whose name does is not told): the load, or what the server says of the edit, may
            // change that.
            Err(StepNotTaken::GivenUp(why, _))
                if known && (self.loading.is_some() || self.queue.iter().any(|q| q.reverse.is_none())) =>
            {
                refused(why)
            }
            Err(why) => {
                self.steps.pop(stack);
                why.answer()
            }
            Ok(made) => {
                self.steps.pop(stack);
                let places = roles
                    .as_ref()
                    .filter(|roles| roles.len() == made.len())
                    .map(|roles| self.places_of(&made, roles, &moved, stack));
                let (mut step, place) = self.queue_made(&op_id, false, is_one_action, after, made);
                step.name = name.clone();
                step.roles = roles;
                step.made_by = made_by.clone();
                self.queued_in_sitting(&op_id, made_by.as_ref());
                // A move of cells is told taken back where the cells were, made again where they went.
                let place = match moved.iter().find(|(role, _)| *role == Role::Asked) {
                    Some((_, m)) if step.roles.is_none() => m.told(stack).0.to_json(&self.workbook),
                    _ => place,
                };
                step.moved = moved;
                self.steps.taken_back(stack, step);
                match places {
                    Some((changed, before)) => self.answer_reversed(changed, before, &name),
                    None => self.answer_queued(place, Some(&name)),
                }
            }
        }
    }

    /// Edits that take others back, worked out by the server on the confirmed revision (`builtOnRevision`), with no
    /// edit of the page's own queued since and no load needed or under way: queued as one step, all of them or none.
    pub(super) fn queue_edits_that_take_back(&mut self, op_id: String, built_on: u64, edits: &[Json]) -> String {
        let mut read = Vec::with_capacity(edits.len());
        for edit in edits {
            match history::replayed(edit) {
                Ok(ops) => read.push(ops),
                Err(why) => return refused(why),
            }
        }
        if self.stop.is_some() {
            return refused("syncStopped");
        }
        if self.is_op_id_in_use(&op_id) {
            return refused("opIdInUse");
        }
        if built_on != self.confirmed_revision || !self.queue.is_empty() || self.loading.is_some() {
            return refused("builtOnAnotherRevision");
        }
        if read.is_empty() {
            return json!({"kind": "nothingToChange"}).to_string();
        }
        if !read.iter().all(|ops| new_ids::are_well_formed(ops)) {
            return refused("idNotWellFormed");
        }
        // Edits undeleting what the load forgot are not made on the workbook shown (see `queue_made`): none is tried.
        let is_made = !read.iter().any(|ops| self.forgets(ops));
        let mut after = self.workbook.clone();
        let mut made = Vec::with_capacity(read.len());
        for ops in read {
            if !is_made {
                made.push((ops, Vec::new()));
                continue;
            }
            let Ok(reverse) = after.apply(&ops) else { return refused("changedSince") };
            if let Some(why) = history::emptied(&after, &ops) {
                return refused(why);
            }
            made.push((ops, reverse));
        }
        let (step, place) = self.queue_made(&op_id, true, true, after, made);
        self.steps.made(step);
        self.answer_queued(place, None)
    }

    /// Edits made on the workbook shown (`after` is the workbook after them), queued under an op id (one edit: the op
    /// id; more: `<opId>.0`, `.1`, …, with the op id as their action, as the edits taking others back have it): the
    /// step they make, and the place they changed, as the page is told it. When one of them undeletes what the load
    /// forgot, none is made on the workbook shown: they are queued with no way back, for the server to say what
    /// became of them, and the place is where they would be, when the page shows it.
    fn queue_made(
        &mut self,
        op_id: &str,
        is_action: bool,
        is_one_action: bool,
        after: Workbook,
        made: Vec<(Vec<Op>, Vec<Op>)>,
    ) -> (Step, Json) {
        let is_made = !made.iter().any(|(ops, _)| self.forgets(ops));
        let before = if is_made { std::mem::replace(&mut self.workbook, after) } else { self.workbook.clone() };
        if is_made {
            self.workbook.revision = before.revision + made.len() as u64;
        }
        let several = made.len() > 1;
        let mut parts = Vec::with_capacity(made.len());
        let mut all = Vec::new();
        for (k, (ops, reverse)) in made.into_iter().enumerate() {
            let id = if several { format!("{op_id}.{k}") } else { op_id.to_owned() };
            let reverse = is_made.then_some(reverse);
            if is_made {
                for op in &ops {
                    self.report.changes.of_op(op, &self.workbook);
                }
            }
            all.extend(ops.iter().cloned());
            self.queue.push(Queued {
                op_id: id.clone(),
                action_id: (is_action || several && is_one_action).then(|| op_id.to_owned()),
                recorded: Recorded { v: version::of_ops(&ops), base: self.confirmed_revision, ops: ops.clone() },
                acknowledged: None,
                reverse: reverse.clone(),
                is_handed_out: false,
                asked_as: op_id.to_owned(),
            });
            parts.push(Part { op_id: id, ops, reverse });
        }
        if !is_made {
            let place = place::of_ops(&before, &self.workbook, &all).to_json(&self.workbook);
            return (Step { parts, name: op_id.to_owned(), roles: None, is_one_action, made_by: None, moved: Vec::new() }, self.as_shown(place));
        }
        self.applied(&before, &all);
        let place = place::of_ops(&before, &self.workbook, &all).to_json(&self.workbook);
        (Step { parts, name: op_id.to_owned(), roles: None, is_one_action, made_by: None, moved: Vec::new() }, place)
    }

    /// The places a step made of several edits changes as it is taken back or made again (`made`, the edits queued
    /// for it, each of the edit of its role, on the workbook shown): each edit's place as its operations change it,
    /// told on the workbook they all leave. The edit asked for gives the place changed (none when its sheet is gone),
    /// and when it has nothing to take back, the edits before it do, all their places, unless one is pointed at (as
    /// when the step was made); the edits before it pointed at give the places changed before, in their order, those
    /// on no place or on a sheet gone left out.
    /// A move of cells among them tells the place it told then (`history::Moved`).
    fn places_of(&self, made: &[(Vec<Op>, Vec<Op>)], roles: &[Role], moved: &[(Role, history::Moved)], stack: Stack) -> (Json, Vec<Json>) {
        let mut workbook = self.workbook.clone();
        let mut told: Vec<(Role, place::Told)> = Vec::new();
        let mut place_of_befores = place::Place::Nowhere;
        let mut k = 0;
        while k < made.len() {
            let (role, before) = (roles[k], workbook.clone());
            let mut ops = Vec::new();
            while k < made.len() && roles[k] == role {
                let _ = workbook.apply(&made[k].0);
                ops.extend(made[k].0.iter().cloned());
                k += 1;
            }
            let (place, told_now) = match moved.iter().find(|(r, _)| *r == role) {
                Some((_, m)) => (m.told(stack).1.clone(), m.told(stack).0.clone()),
                None => {
                    let place = place::of_ops(&before, &workbook, &ops);
                    let told_now = place::Told::of(&place, &workbook);
                    (place, told_now)
                }
            };
            if matches!(role, Role::Before { .. }) {
                place_of_befores = place_of_befores.and(place.clone());
            }
            told.push((role, told_now));
        }
        let is_any_pointed = roles.iter().any(|role| matches!(role, Role::Before { is_pointed_at: true, .. }));
        let changed = match told.iter().find(|(role, _)| *role == Role::Asked) {
            Some((_, t)) => t.to_json(&workbook),
            None if is_any_pointed => Json::Null,
            None => place::Told::of(&place_of_befores, &workbook).to_json(&workbook),
        };
        let mut pointed: Vec<(usize, &place::Told)> = told
            .iter()
            .filter_map(|(role, t)| match role {
                Role::Before { index, is_pointed_at: true } => Some((*index, t)),
                _ => None,
            })
            .collect();
        pointed.sort_by_key(|&(index, _)| index);
        let before = pointed.into_iter().filter(|(_, t)| t.is_shown(&workbook)).map(|(_, t)| t.to_json(&workbook)).collect();
        (changed, before)
    }

    /// The answer to a step made of several edits taken back or made again (`places_of`).
    fn answer_reversed(&mut self, changed: Json, before: Vec<Json>, name: &str) -> String {
        let mut place = changed.to_string();
        if !before.is_empty() {
            place += &format!(",\"placesChangedBefore\":{}", Json::from(before));
        }
        let state = self.sync_state_text(None);
        format!("{{\"kind\":\"editQueued\",\"placeChanged\":{place},\"stepReversed\":{},\"syncState\":{state}}}", json!(name))
    }

    /// The answer to an edit queued; for a step taken back or made again, the step's name (`stepReversed`).
    fn answer_queued(&mut self, place: Json, reversed: Option<&str>) -> String {
        let state = self.sync_state_text(None);
        let reversed = reversed.map(|name| format!(",\"stepReversed\":{}", json!(name))).unwrap_or_default();
        format!("{{\"kind\":\"editQueued\",\"placeChanged\":{place}{reversed},\"syncState\":{state}}}")
    }
}
