//! Conditional formats written by address, as the agent reads and writes them, and back.
//!
//! By address, a rule's cells are ranges such as `B2:B15` or `D4` and the columns its tests name are letters; in
//! ids, they are the ids of rows and columns. Rules written by address are read with every problem found, each
//! with the part of the rule it is in (the first so many), for the agent to be told; a column or a cell is read as
//! its letters (any capitals) and its row's number, and must be in the sheet.
//!
//! For some cells, the page is offered rules for the records around them (`suggested`), and the agent is told the
//! records' rules (`told`); both find the records the same way (`records`).

use serde_json::{json, Map, Value as Json};

use super::{area_of, range_address, Answer, Area};
use crate::formula::column_letters;
use crate::session::edits::objects::{
    condition_within_limits, MOST_RANGES_IN_A_CONDITIONAL_FORMAT, MOST_TESTS_IN_A_CONDITIONAL_FORMAT,
};
use crate::workbook::layout::{CellIds, RangeIds};
use crate::workbook::objects::{CellCondition, Effect, FormatOfACondition, NumberOperand, Test, TestedCell};
use crate::workbook::{Sheet, Workbook};

pub(super) use crate::session::edits::objects::conditional_formats::Rule as RuleInIds;

mod colors;
mod records;
mod suggested;
mod told;

/// The most conditional formats a sheet holds, and so a list of rules.
const MOST_CONDITIONAL_FORMATS: usize = 500;
/// The most problems told of rules written by address.
const MOST_PROBLEMS_TOLD: usize = 50;

/// The refusal for a part of a rule that cannot be read.
const NOT_READ: &str = "conditionalFormatNotRead";

/// Rules in ids written by address: each range where it is now (one with nothing left goes), each column by its
/// letters. A rule with no range left, or naming a column not there, is `null`.
pub(super) fn by_address(workbook: &Workbook, sheet_id: &str, rules: &[RuleInIds]) -> Answer {
    if !rules.iter().all(RuleInIds::is_readable) {
        return Err("unreadableRequest");
    }
    let sheet = super::sheet_of(workbook, sheet_id)?;
    let letters = |c: &str| -> Result<String, ()> {
        workbook.bases.parse(c).and_then(|l| sheet.columns.position(l)).map(column_letters).ok_or(())
    };
    let rules: Vec<Json> = rules
        .iter()
        .map(|rule| {
            let cells: Vec<String> = rule
                .ranges
                .iter()
                .filter_map(|r| sheet.live_box(&workbook.bases, r))
                .map(|(t, b, l, r)| range_address((t, l), (b, r)))
                .collect();
            let effect = renamed(&rule.effect, &letters).ok();
            match effect {
                Some(effect) if !cells.is_empty() => json!({"cells": cells, "effect": effect}),
                _ => Json::Null,
            }
        })
        .collect();
    Ok(json!({"kind": "conditionalFormatsByAddress", "rules": rules}))
}

/// Rules written by address read into ids: the rules, or what is wrong with them.
pub(super) fn in_ids(workbook: &Workbook, sheet_id: &str, written: &Json) -> Answer {
    let sheet = super::sheet_of(workbook, sheet_id)?;
    let read = match written.as_array() {
        None => json!({"kind": "notAList", "refusal": NOT_READ}),
        Some(list) if list.len() > MOST_CONDITIONAL_FORMATS => {
            json!({"kind": "notAList", "refusal": "tooManyConditionalFormats"})
        }
        Some(list) => {
            let mut reading = Reading { workbook, sheet, problems: Vec::new() };
            let rules: Vec<Option<Json>> = list.iter().enumerate().map(|(i, rule)| reading.rule(i, rule)).collect();
            let mut problems = reading.problems;
            if problems.is_empty() {
                json!({"kind": "rules", "rules": rules})
            } else {
                problems.truncate(MOST_PROBLEMS_TOLD);
                let (rows, columns) = (sheet.rows.len(), sheet.columns.len());
                json!({"kind": "notRules", "problems": problems, "rowCount": rows, "columnCount": columns})
            }
        }
    };
    Ok(json!({"kind": "conditionalFormatsInIds", "read": read}))
}

/// What the page offers for the conditional formats of some cells, `now` the session's clock reading.
pub(super) fn suggestions(workbook: &Workbook, cells: &Area, now: Option<f64>) -> Answer {
    let (sheet, rows, columns) = area_of(workbook, cells)?;
    Ok(suggested::suggestions(workbook, sheet, &rows, &columns, now))
}

/// The conditional formats of the records around some cells, as the agent is told them.
pub(super) fn as_agent_is_told(workbook: &Workbook, cells: &Area, now: Option<f64>) -> Answer {
    let (sheet, rows, columns) = area_of(workbook, cells)?;
    Ok(told::told(workbook, sheet, &rows, &columns, now))
}

/// Rules written by address being read, with the problems found so far.
struct Reading<'a> {
    workbook: &'a Workbook,
    sheet: &'a Sheet,
    problems: Vec<Json>,
}

impl Reading<'_> {
    fn problem(&mut self, index: usize, part: Json, refusal: &str) {
        self.problems.push(json!({"index": index, "part": part, "refusal": refusal}));
    }

    /// A rule read: its parts in turn (its keys, its cells and each range, its effect and each test, its format),
    /// each problem told; the rule in ids when it has none.
    fn rule(&mut self, i: usize, rule: &Json) -> Option<Json> {
        let Some(object) = rule.as_object() else {
            self.problem(i, json!({"kind": "whole"}), NOT_READ);
            return None;
        };
        let told = self.problems.len();
        if object.keys().any(|k| k != "cells" && k != "effect") {
            self.problem(i, json!({"kind": "whole"}), NOT_READ);
        }
        let ranges = self.cells(i, object.get("cells"));
        let effect = self.effect(i, object.get("effect"));
        (self.problems.len() == told).then(|| json!({"ranges": ranges, "effect": effect}))
    }

    /// A rule's cells: some ranges, not too many, the first so many each read.
    fn cells(&mut self, i: usize, cells: Option<&Json>) -> Vec<RangeIds> {
        let Some(cells) = cells.and_then(Json::as_array).filter(|c| !c.is_empty()) else {
            self.problem(i, json!({"kind": "cells"}), NOT_READ);
            return Vec::new();
        };
        if cells.len() > MOST_RANGES_IN_A_CONDITIONAL_FORMAT {
            self.problem(i, json!({"kind": "cells"}), "tooManyRangesInConditionalFormat");
        }
        let mut ranges = Vec::new();
        for (j, range) in cells.iter().take(MOST_RANGES_IN_A_CONDITIONAL_FORMAT).enumerate() {
            match range.as_str().ok_or(NOT_READ).and_then(|text| self.range(text)) {
                Ok(range) => ranges.push(range),
                Err(refusal) => self.problem(i, json!({"kind": "range", "index": j}), refusal),
            }
        }
        ranges
    }

    /// A range by address in ids, its corners in order.
    fn range(&self, text: &str) -> Result<RangeIds, &'static str> {
        let mut corners = text.split(':');
        let (Some(one), other, None) = (corners.next(), corners.next(), corners.next()) else {
            return Err("rangeNotReadable");
        };
        let one = cell_address(one).ok_or("rangeNotReadable")?;
        let other = match other {
            Some(other) => cell_address(other).ok_or("rangeNotReadable")?,
            None => one,
        };
        let (rows, columns) = (self.sheet.rows.len() as u64, self.sheet.columns.len() as u64);
        if [one, other].iter().any(|&(row, column)| row > rows || column > columns) {
            return Err("outsideTheSheet");
        }
        let ids = |row: u64, column: u64| {
            let r = self.sheet.rows.line(row as usize - 1).expect("a row in the sheet");
            let c = self.sheet.columns.line(column as usize - 1).expect("a column in the sheet");
            CellIds { r: self.workbook.bases.text(r), c: self.workbook.bases.text(c) }
        };
        Ok(RangeIds {
            top_left: ids(one.0.min(other.0), one.1.min(other.1)),
            bottom_right: ids(one.0.max(other.0), one.1.max(other.1)),
        })
    }

    /// A column's id from its letters.
    fn column(&self, letters: &str) -> Result<String, &'static str> {
        let n = column_number(letters).ok_or("columnsNotReadable")?;
        if n > self.sheet.columns.len() as u64 {
            return Err("outsideTheSheet");
        }
        Ok(self.workbook.bases.text(self.sheet.columns.line(n as usize - 1).expect("a column in the sheet")))
    }

    /// A rule's effect: a color scale read whole; of a `formatWhere`, its tests (some, not too many, the first so
    /// many each read) and its format.
    /// Its colors are read loosely first (`colors`).
    fn effect(&mut self, i: usize, effect: Option<&Json>) -> Option<Effect> {
        let mut effect = effect.cloned();
        effect.as_mut().map(colors::loosened);
        let object = effect.as_ref().and_then(Json::as_object);
        match object.and_then(|o| o.get("kind")).and_then(Json::as_str) {
            Some("formatWhere") => self.format_where(i, object.expect("an object")),
            Some("colorScale") => {
                let effect = effect.clone().expect("an effect");
                let scale = serde_json::from_value::<Effect>(effect).ok().filter(Effect::is_readable);
                if scale.is_none() {
                    self.problem(i, json!({"kind": "effect"}), NOT_READ);
                }
                scale
            }
            _ => {
                self.problem(i, json!({"kind": "effect"}), NOT_READ);
                None
            }
        }
    }

    fn format_where(&mut self, i: usize, effect: &Map<String, Json>) -> Option<Effect> {
        let told = self.problems.len();
        let all_of = effect.get("allOf").and_then(Json::as_array);
        let has_other_keys = effect.keys().any(|k| !["kind", "allOf", "format"].contains(&k.as_str()));
        if has_other_keys || all_of.is_none_or(Vec::is_empty) {
            self.problem(i, json!({"kind": "effect"}), NOT_READ);
        }
        let mut tests = Vec::new();
        if let Some(all_of) = all_of {
            if all_of.len() > MOST_TESTS_IN_A_CONDITIONAL_FORMAT {
                self.problem(i, json!({"kind": "effect"}), "tooManyTestsInConditionalFormat");
            }
            for (k, test) in all_of.iter().take(MOST_TESTS_IN_A_CONDITIONAL_FORMAT).enumerate() {
                tests.extend(self.test(i, k, test));
            }
        }
        let format = effect.get("format").and_then(|f| serde_json::from_value::<FormatOfACondition>(f.clone()).ok());
        let format = format.filter(gives_something);
        if format.is_none() {
            self.problem(i, json!({"kind": "format"}), NOT_READ);
        }
        (self.problems.len() == told).then(|| Effect::FormatWhere { all_of: tests, format: format.expect("a format") })
    }

    /// A test: read whole (a text not empty), then its condition against the limits and its columns, the first that
    /// is not one of the sheet's.
    fn test(&mut self, i: usize, k: usize, test: &Json) -> Option<Test> {
        let part = json!({"kind": "test", "index": k});
        let test = serde_json::from_value::<Test>(test.clone()).ok();
        let Some(mut test) = test.filter(|t| !holds_empty_text(&t.condition)) else {
            self.problem(i, part, NOT_READ);
            return None;
        };
        let mut fine = true;
        if let Err(refusal) = condition_within_limits(&test.condition) {
            self.problem(i, part.clone(), refusal);
            fine = false;
        }
        if let Err(refusal) = rename_columns(&mut test, &|c| self.column(c)) {
            self.problem(i, part, refusal);
            fine = false;
        }
        fine.then_some(test)
    }
}

/// Whether a format gives something: a fill or a font, a font with something in it.
fn gives_something(format: &FormatOfACondition) -> bool {
    (format.fill_color.is_some() || format.font.is_some())
        && format.font.as_ref().is_none_or(|f| {
            f.bold.is_some()
                || f.italic.is_some()
                || f.underline.is_some()
                || f.strikethrough.is_some()
                || f.color.is_some()
        })
}

/// Whether a condition on text has none to go by.
fn holds_empty_text(condition: &CellCondition) -> bool {
    match condition {
        CellCondition::TextIs { text }
        | CellCondition::TextIsNot { text }
        | CellCondition::TextContains { text }
        | CellCondition::TextDoesNotContain { text }
        | CellCondition::TextStartsWith { text }
        | CellCondition::TextEndsWith { text } => text.is_empty(),
        _ => false,
    }
}

/// A cell's address read: its row's number and its column's, each from 1. Letters (any capitals) then digits, the
/// first not 0; neither so many that the number would not fit.
fn cell_address(text: &str) -> Option<(u64, u64)> {
    let (letters, digits) = text.split_at(text.find(|c: char| !c.is_ascii_alphabetic()).unwrap_or(text.len()));
    if digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((digits.parse().ok()?, column_number(letters)?))
}

/// A column's number from its letters, from 1 for `A`.
fn column_number(letters: &str) -> Option<u64> {
    if letters.is_empty() || !letters.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    letters.bytes().try_fold(0u64, |n, b| n.checked_mul(26)?.checked_add(u64::from(b.to_ascii_uppercase() - b'A' + 1)))
}

/// An effect with each column it names named another way; the first column with no other name stops it.
fn renamed<E>(effect: &Effect, rename: &dyn Fn(&str) -> Result<String, E>) -> Result<Effect, E> {
    let mut effect = effect.clone();
    if let Effect::FormatWhere { all_of, .. } = &mut effect {
        for test in all_of {
            rename_columns(test, rename)?;
        }
    }
    Ok(effect)
}

/// Names each column a test names another way: the tested cell's, then its operands'.
fn rename_columns<E>(test: &mut Test, rename: &dyn Fn(&str) -> Result<String, E>) -> Result<(), E> {
    if let TestedCell::SameRowInColumn { c } = &mut test.tested {
        *c = rename(c)?;
    }
    let operands = match &mut test.condition {
        CellCondition::NumberIs { operand, .. } => vec![operand],
        CellCondition::NumberIsBetween { one_end, other_end }
        | CellCondition::NumberIsNotBetween { one_end, other_end } => {
            vec![one_end, other_end]
        }
        _ => vec![],
    };
    for operand in operands {
        if let NumberOperand::SameRowInColumn { c } = operand {
            *c = rename(c)?;
        }
    }
    Ok(())
}
