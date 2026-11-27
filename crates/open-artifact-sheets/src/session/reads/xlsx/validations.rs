//! What a sheet holds its cells to, written as the file's data validations: the dropdowns' lists, the limits of
//! values as decimals between them, and default values as the cells' prompts (titled `Default`, `(blank)` for
//! blank, the value as it is edited, cut to Excel's 255 characters).
//!
//! Each cell tells its default value as its control takes it (`default_at`).
//! - A cell with a dropdown is offered its list; its limits are not told.
//! - A cell with a checkbox tells no limits.
//! - Every other cell is held to its limits (from its least, to its most, or between).
//!
//! The lists come in the order of the dropdowns, each without a prompt first and then by its prompt; the others
//! after them, by their limits (none first, then by their least, none being lowest, then by their most, none being
//! highest) and then by their prompt (none first). Of the cells with a default value, only those looked at
//! (`looked_at`, the first 1000) tell it. Each validation's cells are rectangles: each row's runs of cells, those of
//! rows one after the other between the same columns together, by their left column, then right, then top row.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;

use super::worksheet::address;
use super::xml::{attribute, number, text};
use crate::ids::LineId;
use crate::locale;
use super::super::defaults::shown_default;
use crate::session::edits::defaults::{default_at, limits_at, looked_at};
use crate::workbook::formats::{id_order, Leaf};
use crate::workbook::objects::DropdownOption;
use crate::workbook::{Sheet, Workbook};

/// The most characters Excel takes in a prompt.
const LONGEST_PROMPT: usize = 255;

type Limits = (Option<f64>, Option<f64>);
type Cell = (LineId, LineId);

/// What a validation holds its cells to.
pub enum Rule {
    /// A dropdown's options, where they are in the sheet of options.
    List(String),
    /// Numbers within limits.
    Decimal(Limits),
    /// Nothing: the cells only tell their prompt.
    Nothing,
}

/// A validation of the file: the cells it is for, what it holds them to, and the default value they tell.
pub struct Validation {
    pub sqref: String,
    pub rule: Rule,
    /// The default value as it is told, uncut (`""` for blank).
    pub prompt: Option<String>,
}

impl Validation {
    pub fn write(&self, out: &mut String) {
        out.push_str("<dataValidation");
        match &self.rule {
            Rule::List(_) => out.push_str(" type=\"list\""),
            Rule::Decimal((minimum, maximum)) => {
                out.push_str(" type=\"decimal\"");
                match (minimum, maximum) {
                    (Some(_), None) => out.push_str(" operator=\"greaterThanOrEqual\""),
                    (None, Some(_)) => out.push_str(" operator=\"lessThanOrEqual\""),
                    _ => {}
                }
                out.push_str(" showErrorMessage=\"1\"");
            }
            Rule::Nothing => {}
        }
        out.push_str(" allowBlank=\"1\"");
        if let Some(prompt) = &self.prompt {
            let prompt = if prompt.is_empty() { "(blank)".to_owned() } else { prompt.chars().take(LONGEST_PROMPT).collect() };
            let _ = write!(out, " showInputMessage=\"1\" promptTitle=\"Default\" prompt=\"{}\"", attribute(&prompt));
        }
        let _ = write!(out, " sqref=\"{}\">", attribute(&self.sqref));
        match &self.rule {
            Rule::List(formula) => {
                let _ = write!(out, "<formula1>{}</formula1>", text(formula));
            }
            Rule::Decimal((minimum, maximum)) => {
                let ends: Vec<f64> = [*minimum, *maximum].into_iter().flatten().collect();
                for (i, n) in ends.iter().enumerate() {
                    let _ = write!(out, "<formula{0}>{1}</formula{0}>", i + 1, number(*n));
                }
            }
            Rule::Nothing => {}
        }
        out.push_str("</dataValidation>");
    }
}

/// A sheet's cells as the file holds them: the dropdowns its cells offer (each with its cells by their prompt), and
/// the validations of the other cells.
pub struct Held<'a> {
    pub lists: Vec<(&'a [DropdownOption], Vec<(Option<String>, String)>)>,
    pub others: Vec<Validation>,
}

pub fn held<'a>(workbook: &Workbook, sheet: &'a Sheet) -> Held<'a> {
    let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);
    let live = |at: Cell| sheet.rows.position(at.0).is_some() && sheet.columns.position(at.1).is_some();
    let told: HashSet<Cell> = looked_at(&workbook.bases, sheet).into_iter().collect();

    // Each dropdown's cells by their prompt; the other cells by their limits and prompt.
    let mut offering: HashMap<&str, BTreeMap<Option<String>, Vec<Cell>>> = HashMap::new();
    let mut others: Vec<((Option<Limits>, Option<String>), Vec<Cell>)> = Vec::new();
    let mut cells: Vec<Cell> = sheet
        .formats
        .iter()
        .filter(|&(leaf, at, _)| matches!(leaf, Leaf::CellControl | Leaf::DefaultValue | Leaf::ValueLimits) && live(at))
        .map(|(_, at, _)| at)
        .collect();
    cells.sort_by(|a, b| id_order(&workbook.bases, a.0, b.0).then_with(|| id_order(&workbook.bases, a.1, b.1)));
    cells.dedup();
    for at in cells {
        let default = told.contains(&at).then(|| default_at(workbook, sheet, at)).flatten();
        let prompt = default.map(|d| shown_default(sheet, at, &d, locale)["textToEdit"].as_str().unwrap_or_default().to_owned());
        let control = sheet.formats.get(Leaf::CellControl, at);
        match control.and_then(|c| c.get("kind")?.as_str()) {
            Some("dropdown") => {
                let Some(id) = control.and_then(|c| c.get("dropdownId")?.as_str()) else { continue };
                if sheet.dropdowns.values().any(|(d, _)| d == id) {
                    offering.entry(id).or_default().entry(prompt).or_default().push(at);
                }
            }
            Some("checkbox") => {
                if prompt.is_some() {
                    others_entry(&mut others, (None, prompt)).push(at);
                }
            }
            _ => {
                let limits = limits_at(sheet, at).filter(|l| *l != (None, None));
                if limits.is_some() || prompt.is_some() {
                    others_entry(&mut others, (limits, prompt)).push(at);
                }
            }
        }
    }

    let lists = sheet
        .dropdowns
        .values()
        .filter_map(|(id, options)| {
            let groups = offering.remove(id.as_str())?;
            Some((options.as_slice(), groups.into_iter().map(|(prompt, cells)| (prompt, sqref(sheet, &cells))).collect()))
        })
        .collect();
    others.sort_by(|a, b| key_order(&a.0, &b.0));
    let others = others
        .into_iter()
        .map(|((limits, prompt), cells)| Validation {
            sqref: sqref(sheet, &cells),
            rule: limits.map_or(Rule::Nothing, Rule::Decimal),
            prompt,
        })
        .collect();
    Held { lists, others }
}

fn others_entry<'v>(others: &'v mut Vec<((Option<Limits>, Option<String>), Vec<Cell>)>, key: (Option<Limits>, Option<String>)) -> &'v mut Vec<Cell> {
    let i = match others.iter().position(|(k, _)| *k == key) {
        Some(i) => i,
        None => {
            others.push((key, Vec::new()));
            others.len() - 1
        }
    };
    &mut others[i].1
}

/// Limits and prompts in the file's order.
fn key_order(a: &(Option<Limits>, Option<String>), b: &(Option<Limits>, Option<String>)) -> Ordering {
    let ends = |l: &Limits| (l.0.unwrap_or(f64::NEG_INFINITY), l.1.unwrap_or(f64::INFINITY));
    let limits = match (&a.0, &b.0) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (Some(x), Some(y)) => {
            let (x, y) = (ends(x), ends(y));
            x.0.total_cmp(&y.0).then(x.1.total_cmp(&y.1))
        }
    };
    limits.then_with(|| a.1.cmp(&b.1))
}

/// Cells as the file lists them: each row's runs of cells one after the other, those of rows one after the other
/// that run between the same columns together, by their left column, then their right, then their top row.
pub fn sqref(sheet: &Sheet, cells: &[Cell]) -> String {
    let mut places: Vec<(usize, usize)> =
        cells.iter().filter_map(|&(r, c)| Some((sheet.rows.position(r)?, sheet.columns.position(c)?))).collect();
    places.sort_unstable();
    places.dedup();
    // Each row's runs: (row, left, right).
    let mut runs: Vec<(usize, usize, usize)> = Vec::new();
    for (r, c) in places {
        match runs.last_mut() {
            Some((row, _, right)) if *row == r && *right + 1 == c => *right = c,
            _ => runs.push((r, c, c)),
        }
    }
    // Rectangles: (left, right, top, bottom), a run going on the one above it between the same columns.
    let mut found: Vec<(usize, usize, usize, usize)> = Vec::new();
    let mut open: HashMap<(usize, usize), usize> = HashMap::new();
    for (r, left, right) in runs {
        match open.get(&(left, right)).copied() {
            Some(k) if found[k].3 + 1 == r => found[k].3 = r,
            _ => {
                open.insert((left, right), found.len());
                found.push((left, right, r, r));
            }
        }
    }
    found.sort_unstable();
    let out: Vec<String> = found
        .into_iter()
        .map(|(left, right, top, bottom)| match (top, left) == (bottom, right) {
            true => address(top, left),
            false => format!("{}:{}", address(top, left), address(bottom, right)),
        })
        .collect();
    out.join(" ")
}
