//! Default values and limits: the value a cell is reset to, and the least and most number it may be
//! given, each a leaf of its format (`defaultValue`, `valueLimits`).
//!
//! - `setDefaultValuesAndLimits` gives a block of cells a default value (typed, as each cell reads the text; what
//!   each cell holds; or none), limits (typed, as the cell `typedIn` reads them), or both. The limits are read first
//!   (`limitIsNoNumber`, then `minimumAboveMaximum`), then the default value (`defaultValueNotPlain`,
//!   `defaultValueIsNoOption`, `defaultValueTooLong`), then the two together (`defaultValueOutsideLimits`). Its
//!   operations: the default values of the cells whose own change, the limits of every cell of the block when any
//!   cell's change, and a number format the texts typed bring (every one the same, as each cell of the block reads a
//!   default value) to the cells that show numbers as General does, unless one of the block's cells holds a number
//!   or has a control.
//! - `resetCellsToDefaultValues` and `resetSheetsToDefaultValues` give the cells that hold something else than their
//!   default value that value, row by row.
//!
//! A cell edit is refused once made when it gives a cell with limits (and neither a checkbox nor a dropdown) a value
//! that is neither a number within them nor a formula (`valueOutsideLimits`; emptying it is not). Pastes and fills
//! give no default value, and give limits only to the cells without any, before the rest of each format; moves give
//! and take away both. An edit that leaves the workbook with more than 1000 cells with a default value, and more
//! than it had, is refused (`tooManyCellsWithADefaultValue`, `session/mod.rs`).

use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{Made, Refused};
use crate::ids::{Bases, IdRun, LineId};
use crate::typing;
use crate::value::Value;
use crate::workbook::formats::{blocks, id_order, leaf_blocks, sorted_runs, Leaf};
use crate::workbook::grid::CellForm;
use crate::workbook::load::{CellToSet, CellsToFormat, Op};
use crate::workbook::{Input, Sheet, Workbook};

/// The most cells of a workbook with a default value.
pub(crate) const MOST_CELLS_WITH_A_DEFAULT_VALUE: usize = 1000;

/// The longest text a default value is, in characters.
const LONGEST_DEFAULT_TEXT: usize = 255;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    SetDefaultValuesAndLimits {
        cells: Cells,
        #[serde(default)]
        default_value: Option<Asked>,
        #[serde(default)]
        limits: Option<LimitsAsked>,
    },
    ResetCellsToDefaultValues { cells: Cells },
    #[serde(rename_all = "camelCase")]
    ResetSheetsToDefaultValues { sheet_ids: Vec<String> },
}

/// Cells as the edits name them: rows (by runs), from one column to another.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cells {
    sheet_id: String,
    rows: Vec<IdRun>,
    one_column: String,
    other_column: String,
}

/// The default value asked for.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Asked {
    Typed { text: String },
    WhatEachCellHolds,
    None,
}

/// The limits asked for: texts read as the cell typed in reads them (an empty one is no limit).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LimitsAsked {
    typed_in: CellAt,
    minimum: String,
    maximum: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellAt {
    r: String,
    c: String,
}

/// The edit as the session reads it: rows named by runs of at least one row, short of the largest id.
pub fn read(edit: &Json) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    let run = |r: &IdRun| r.count > 0 && r.first as u64 + r.count as u64 <= 1 << 32;
    let readable = match &edit {
        Edit::SetDefaultValuesAndLimits { cells, .. } | Edit::ResetCellsToDefaultValues { cells } => {
            !cells.rows.is_empty() && cells.rows.iter().all(run)
        }
        Edit::ResetSheetsToDefaultValues { .. } => true,
    };
    readable.then_some(edit)
}

pub fn make(workbook: &Workbook, edit: Edit) -> Result<Made, Refused> {
    match edit {
        Edit::SetDefaultValuesAndLimits { cells, default_value, limits } => set(workbook, &cells, default_value, limits),
        Edit::ResetCellsToDefaultValues { cells } => {
            let (s, rows, columns) = block(workbook, &cells)?;
            let cells: Vec<(usize, usize)> = rows.iter().flat_map(|&r| columns.iter().map(move |&c| (r, c))).collect();
            Ok(Made::ops(reset(workbook, s, &cells).into_iter().collect()))
        }
        Edit::ResetSheetsToDefaultValues { sheet_ids } => {
            let mut ops = Vec::new();
            for id in &sheet_ids {
                let Some(s) = workbook.sheet_index(id) else { continue };
                let sheet = &workbook.sheets[s];
                let mut cells: Vec<(usize, usize)> = defaults_of(workbook, sheet).map(|(at, _)| at).collect();
                cells.sort_unstable();
                ops.extend(reset(workbook, s, &cells));
            }
            Ok(Made::ops(ops))
        }
    }
}

/// The sheet and positions of a block of cells.
fn block(workbook: &Workbook, cells: &Cells) -> Result<(usize, Vec<usize>, Vec<usize>), Refused> {
    let s = workbook.sheet_index(&cells.sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    let sheet = &workbook.sheets[s];
    let (rows, columns) =
        super::objects::dropdowns::block(workbook, sheet, &cells.rows, &cells.one_column, &cells.other_column)?;
    Ok((s, rows, columns))
}

/// A default value as a cell keeps it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Default {
    /// The cell is emptied.
    Blank,
    Number(f64),
    Text(String),
    Boolean(bool),
    Option { option_id: String, label: String },
}

impl Default {
    /// A default value as the format's leaf holds it (none: `None`).
    pub(crate) fn of(v: &Json) -> Option<Default> {
        Some(match v.get("kind")?.as_str()? {
            "blank" => Default::Blank,
            "number" => Default::Number(v.get("value")?.as_f64()?),
            "text" => Default::Text(v.get("value")?.as_str()?.to_owned()),
            "boolean" => Default::Boolean(v.get("value")?.as_bool()?),
            "dropdownOption" => Default::Option {
                option_id: v.get("optionId")?.as_str()?.to_owned(),
                label: v.get("label")?.as_str()?.to_owned(),
            },
            _ => return None,
        })
    }

    /// The default value as the format's leaf holds it.
    fn to_json(&self) -> Json {
        match self {
            Default::Blank => json!({"kind": "blank"}),
            Default::Number(n) => json!({"kind": "number", "value": n}),
            Default::Text(t) => json!({"kind": "text", "value": t}),
            Default::Boolean(b) => json!({"kind": "boolean", "value": b}),
            Default::Option { option_id, label } => json!({"kind": "dropdownOption", "optionId": option_id, "label": label}),
        }
    }

    /// What a cell holds reset to it: nothing for blank; an option with its label now.
    pub(crate) fn input(&self, sheet: &Sheet) -> Option<Input> {
        match self {
            Default::Blank => None,
            Default::Number(n) => Some(Input::Number { value: *n }),
            Default::Text(t) => Some(Input::Text { value: t.clone() }),
            Default::Boolean(b) => Some(Input::Boolean { value: *b }),
            Default::Option { option_id, label } => {
                let label = sheet.dropdown_option(option_id).map_or(label, |o| &o.label).clone();
                Some(Input::DropdownOption { option_id: option_id.clone(), label })
            }
        }
    }
}

/// The default value a cell has, as its control takes it: a cell with a dropdown takes blank or an option of its
/// dropdown (by its id, or a text naming it, as typed), a cell with a checkbox a boolean; any other cell takes its
/// default value as it is.
pub(crate) fn default_at(workbook: &Workbook, sheet: &Sheet, at: (LineId, LineId)) -> Option<Default> {
    let default = Default::of(sheet.formats.get(Leaf::DefaultValue, at)?)?;
    match control_of(sheet, at) {
        Some("dropdown") => {
            let options = typing::dropdown_of(sheet, at).unwrap_or_default();
            let option = match &default {
                Default::Blank => return Some(Default::Blank),
                Default::Option { option_id, .. } => options.iter().find(|o| o.option_id == *option_id),
                Default::Text(t) => {
                    let wanted = typing::option_named(workbook, t);
                    options.iter().find(|o| o.label.to_lowercase() == wanted)
                }
                _ => None,
            }?;
            Some(Default::Option { option_id: option.option_id.clone(), label: option.label.clone() })
        }
        Some("checkbox") => matches!(default, Default::Boolean(_)).then_some(default),
        _ => Some(default),
    }
}

/// The cells of a sheet not deleted with a default value (as it is read), by position, in no order.
pub(crate) fn defaults_of<'a>(workbook: &'a Workbook, sheet: &'a Sheet) -> impl Iterator<Item = ((usize, usize), Default)> + 'a {
    sheet.formats.iter().filter(|(leaf, ..)| *leaf == Leaf::DefaultValue).filter_map(|(_, at, _)| {
        let place = (sheet.rows.position(at.0)?, sheet.columns.position(at.1)?);
        Some((place, default_at(workbook, sheet, at)?))
    })
}

/// The cells not deleted with a default value that are looked at (in reading the changed ones and in writing the
/// file), at most 1000: by the blocks of default values kept, each block's runs of columns in turn, each run row by
/// row.
pub(crate) fn looked_at(bases: &Bases, sheet: &Sheet) -> Vec<(LineId, LineId)> {
    let live = |at: (LineId, LineId)| sheet.rows.position(at.0).is_some() && sheet.columns.position(at.1).is_some();
    let cells = sheet.formats.iter().filter(|&(leaf, at, _)| leaf == Leaf::DefaultValue && live(at));
    let lines = |runs: &[IdRun]| -> Vec<LineId> {
        runs.iter()
            .filter_map(|run| Some((bases.find(&run.base)?, run)))
            .flat_map(|(base, run)| (run.first..run.first + run.count).map(move |n| LineId { base, n }))
            .collect()
    };
    let mut out = Vec::new();
    for (rows, columns, _) in leaf_blocks(bases, cells) {
        let rows = lines(&rows);
        for run in &columns {
            let run = lines(std::slice::from_ref(run));
            for &r in &rows {
                for &c in &run {
                    if out.len() == MOST_CELLS_WITH_A_DEFAULT_VALUE {
                        return out;
                    }
                    out.push((r, c));
                }
            }
        }
    }
    out
}

/// Whether a cell holds something else than its default value: an option matched by its id.
pub(crate) fn is_changed(sheet: &Sheet, at: (LineId, LineId), default: &Default) -> bool {
    let input = sheet.cells.get(&at).map(|cell| &cell.input);
    match (default, input) {
        (Default::Option { option_id, .. }, Some(Input::DropdownOption { option_id: held, .. })) => held != option_id,
        _ => default.input(sheet).as_ref() != input,
    }
}

/// The cells of a workbook with a default value, deleted ones and those of deleted sheets among them.
pub(crate) fn cells_with_a_default_value(workbook: &Workbook) -> usize {
    let count = |sheet: &Sheet| sheet.formats.iter().filter(|(leaf, ..)| *leaf == Leaf::DefaultValue).count();
    workbook.sheets.iter().chain(&workbook.deleted_sheets).map(count).sum()
}

/// The cells given back their default values: those (by position) that hold something else, in the order given.
fn reset(workbook: &Workbook, s: usize, cells: &[(usize, usize)]) -> Option<Op> {
    let sheet = &workbook.sheets[s];
    let set: Vec<CellToSet> = cells
        .iter()
        .filter_map(|&(r, c)| {
            let at = (sheet.rows.line(r)?, sheet.columns.line(c)?);
            let default = default_at(workbook, sheet, at)?;
            is_changed(sheet, at, &default).then(|| CellToSet {
                r: workbook.bases.text(at.0),
                c: workbook.bases.text(at.1),
                input: default.input(sheet),
            })
        })
        .collect();
    (!set.is_empty()).then(|| Op::SetCells { sheet_id: sheet.id.clone(), cells: set, form: CellForm::Auto })
}

/// Limits as a cell keeps them: the least and the most (`None`: no end).
type Limits = (Option<f64>, Option<f64>);

fn limits_of(v: &Json) -> Limits {
    (v["minimum"].as_f64(), v["maximum"].as_f64())
}

fn limits_json((minimum, maximum): Limits) -> Json {
    json!({"minimum": minimum, "maximum": maximum})
}

/// The limits a cell has, if any.
pub(crate) fn limits_at(sheet: &Sheet, at: (LineId, LineId)) -> Option<Limits> {
    sheet.formats.get(Leaf::ValueLimits, at).map(limits_of)
}

pub(crate) fn within(n: f64, (minimum, maximum): Limits) -> bool {
    minimum.is_none_or(|m| n >= m) && maximum.is_none_or(|m| n <= m)
}

/// Whether a default value goes with limits: blank, or a number within them.
fn default_within(default: &Default, limits: Limits) -> bool {
    match default {
        Default::Blank => true,
        Default::Number(n) => within(*n, limits),
        _ => limits == (None, None),
    }
}

/// The kind of control a cell has: `checkbox`, `dropdown`, or none.
fn control_of(sheet: &Sheet, at: (LineId, LineId)) -> Option<&str> {
    sheet.formats.get(Leaf::CellControl, at)?.get("kind")?.as_str().filter(|k| *k != "none")
}

fn set(workbook: &Workbook, cells: &Cells, asked: Option<Asked>, limits: Option<LimitsAsked>) -> Result<Made, Refused> {
    let (s, rows, columns) = block(workbook, cells)?;
    let sheet = &workbook.sheets[s];
    let ids = |(r, c): (usize, usize)| (sheet.rows.line(r).expect("a live row"), sheet.columns.line(c).expect("a live column"));
    let places: Vec<(usize, usize)> = rows.iter().flat_map(|&r| columns.iter().map(move |&c| (r, c))).collect();

    // The texts typed that bring a pattern (or bring none), to see whether they all bring the same.
    let mut brought: Vec<Option<String>> = Vec::new();

    // The limits, as the cell typed in reads them.
    let limits = match &limits {
        None => None,
        Some(asked) => {
            let r = workbook.bases.parse(&asked.typed_in.r).filter(|&l| sheet.rows.contains(l));
            let r = r.ok_or(Refused::Because("unknownRow"))?;
            let c = workbook.bases.parse(&asked.typed_in.c).filter(|&l| sheet.columns.contains(l));
            let c = c.ok_or(Refused::Because("unknownColumn"))?;
            let mut end = |text: &str| -> Result<Option<f64>, Refused> {
                if text.trim().is_empty() {
                    return Ok(None);
                }
                match typing::typed_change(workbook, s, (r, c), text) {
                    (Some(Input::Number { value }), pattern) => {
                        brought.push(pattern);
                        Ok(Some(value))
                    }
                    _ => Err(Refused::Because("limitIsNoNumber")),
                }
            };
            let (minimum, maximum) = (end(&asked.minimum)?, end(&asked.maximum)?);
            if let (Some(a), Some(b)) = (minimum, maximum) {
                if a > b {
                    return Err(Refused::Because("minimumAboveMaximum"));
                }
            }
            Some((minimum, maximum))
        }
    };

    // The default value each cell is given (`None` in the list: taken away), by position.
    let given: Vec<((usize, usize), Option<Default>)> = match asked {
        None => Vec::new(),
        Some(Asked::None) => places.iter().map(|&at| (at, None)).collect(),
        Some(Asked::Typed { text }) => {
            // Each cell reads the text as typed into it: one already showing what it brings, or text, brings none.
            if !text.is_empty() {
                brought.extend(places.iter().map(|&at| typing::typed_change(workbook, s, ids(at), &text).1));
            }
            let mut given = Vec::new();
            for &at in &places {
                given.push((at, Some(typed(workbook, s, ids(at), &text)?)));
            }
            given
        }
        Some(Asked::WhatEachCellHolds) => held(workbook, s, &places)?,
    };

    // Each cell's default value and limits once given, together; a cell with a control is not held to its limits.
    let given_at: hashbrown::HashMap<(usize, usize), &Option<Default>> = given.iter().map(|(at, d)| (*at, d)).collect();
    for &at in places.iter().filter(|&&at| control_of(sheet, ids(at)).is_none()) {
        let default = match given_at.get(&at) {
            Some(default) => (*default).clone(),
            None => default_at(workbook, sheet, ids(at)),
        };
        let cell_limits = limits.or_else(|| limits_at(sheet, ids(at))).unwrap_or((None, None));
        if default.is_some_and(|d| !default_within(&d, cell_limits)) {
            return Err(Refused::Because("defaultValueOutsideLimits"));
        }
    }

    let mut ops = Vec::new();
    // The default values of the cells whose own change.
    let none = Leaf::DefaultValue.default_value();
    let changed: Vec<(LineId, LineId, Json)> = given
        .iter()
        .filter_map(|(at, default)| {
            let value = default.as_ref().map_or_else(|| none.clone(), Default::to_json);
            let (r, c) = ids(*at);
            (sheet.formats.value(Leaf::DefaultValue, (r, c)) != value).then_some((r, c, value))
        })
        .collect();
    if !changed.is_empty() {
        let cells = changed.iter().map(|(r, c, v)| (Leaf::DefaultValue, (*r, *c), v));
        ops.push(formats_op(&workbook.bases, sheet, cells));
    }
    // The limits of every cell of the block, when any cell's change.
    if let Some(limits) = limits {
        let value = limits_json(limits);
        if places.iter().any(|&at| sheet.formats.value(Leaf::ValueLimits, ids(at)) != value) {
            let cells = places.iter().map(|&at| (Leaf::ValueLimits, ids(at), &value));
            ops.push(formats_op(&workbook.bases, sheet, cells));
        }
    }
    // The pattern every text typed brings, to the cells that show numbers as General does; none when a cell holds a
    // number or has a control.
    let pattern = match brought.split_first() {
        Some((Some(first), rest)) if rest.iter().all(|p| p.as_ref() == Some(first)) => Some(first.clone()),
        _ => None,
    };
    let is_kept = |at| holds_a_number(workbook, sheet, ids(at)) || control_of(sheet, ids(at)).is_some();
    if let Some(pattern) = pattern.filter(|_| !places.iter().any(|&at| is_kept(at))) {
        let value = json!({"pattern": pattern});
        let general: Vec<(LineId, LineId)> = places
            .iter()
            .map(|&at| ids(at))
            .filter(|&at| sheet.formats.get(Leaf::NumberFormat, at).is_none())
            .collect();
        if !general.is_empty() {
            ops.push(formats_op(&workbook.bases, sheet, general.into_iter().map(|at| (Leaf::NumberFormat, at, &value))));
        }
    }
    Ok(Made::ops(ops))
}

/// A setCellFormats of one leaf over cells, in blocks.
fn formats_op<'a>(bases: &Bases, sheet: &Sheet, cells: impl Iterator<Item = (Leaf, (LineId, LineId), &'a Json)>) -> Op {
    let formats = blocks(bases, cells)
        .into_iter()
        .map(|(rows, columns, format)| CellsToFormat { rows, columns, format })
        .collect();
    Op::SetCellFormats { sheet_id: sheet.id.clone(), formats }
}

/// Whether a cell holds a number, or a formula that comes to one.
fn holds_a_number(workbook: &Workbook, sheet: &Sheet, at: (LineId, LineId)) -> bool {
    match sheet.cells.get(&at).map(|cell| &cell.input) {
        Some(Input::Number { .. }) => true,
        Some(Input::Formula { .. }) => {
            workbook.outcome(&sheet.id, at.0, at.1).is_some_and(|o| matches!(o.value, Value::Number(_)))
        }
        _ => false,
    }
}

/// A default value typed into a cell, as it reads there: an option of its dropdown, a boolean of its checkbox.
fn typed(workbook: &Workbook, s: usize, at: (LineId, LineId), text: &str) -> Result<Default, Refused> {
    let sheet = &workbook.sheets[s];
    let (input, _) = typing::typed_change(workbook, s, at, text);
    if matches!(input, Some(Input::Formula { .. })) {
        return Err(Refused::Because("defaultValueNotPlain"));
    }
    match control_of(sheet, at) {
        Some("dropdown") => {
            if text.is_empty() {
                return Ok(Default::Blank);
            }
            let wanted = typing::option_named(workbook, text);
            let options = typing::dropdown_of(sheet, at).unwrap_or_default();
            let option = options.iter().find(|o| o.label.to_lowercase() == wanted);
            let option = option.ok_or(Refused::Because("defaultValueIsNoOption"))?;
            Ok(Default::Option { option_id: option.option_id.clone(), label: option.label.clone() })
        }
        Some("checkbox") => match input {
            Some(Input::Boolean { value }) => Ok(Default::Boolean(value)),
            _ => Err(Refused::Because("defaultValueIsNoOption")),
        },
        _ => match input {
            None => Ok(Default::Blank),
            Some(Input::Number { value }) => Ok(Default::Number(value)),
            Some(Input::Boolean { value }) => Ok(Default::Boolean(value)),
            Some(Input::Text { value }) if value.chars().count() > LONGEST_DEFAULT_TEXT => {
                Err(Refused::Because("defaultValueTooLong"))
            }
            Some(Input::Text { value }) => Ok(Default::Text(value)),
            Some(_) => Err(Refused::Because("defaultValueNotPlain")),
        },
    }
}

/// The default values what each cell holds gives: the cells that hold a plain value (a number, a boolean, an
/// option, a text short enough) are given it, the others left as they are; when none does, every cell is given
/// blank if all are empty, else it is refused.
fn held(workbook: &Workbook, s: usize, places: &[(usize, usize)]) -> Result<Vec<((usize, usize), Option<Default>)>, Refused> {
    let sheet = &workbook.sheets[s];
    let spilled = spilled_into(workbook, sheet);
    let mut given = Vec::new();
    let mut is_empty = true;
    for &(r, c) in places {
        let at = (sheet.rows.line(r).expect("a live row"), sheet.columns.line(c).expect("a live column"));
        // An empty text is nothing.
        let input = sheet.cells.get(&at).map(|cell| &cell.input).filter(|i| !matches!(i, Input::Text { value } if value.is_empty()));
        let default = match input {
            None => {
                is_empty &= !spilled.contains(&(r, c));
                continue;
            }
            Some(Input::Number { value }) => Default::Number(*value),
            Some(Input::Boolean { value }) => Default::Boolean(*value),
            Some(Input::Text { value }) if value.chars().count() <= LONGEST_DEFAULT_TEXT => Default::Text(value.clone()),
            Some(Input::DropdownOption { option_id, label }) => {
                Default::Option { option_id: option_id.clone(), label: label.clone() }
            }
            Some(_) => {
                is_empty = false;
                continue;
            }
        };
        given.push(((r, c), Some(default)));
    }
    if !given.is_empty() {
        return Ok(given);
    }
    if !is_empty {
        return Err(Refused::Because("defaultValueNotPlain"));
    }
    Ok(places.iter().map(|&at| (at, Some(Default::Blank))).collect())
}

/// The positions of a sheet an array spills into (its formula's own cell left out).
fn spilled_into(workbook: &Workbook, sheet: &Sheet) -> hashbrown::HashSet<(usize, usize)> {
    let mut out = hashbrown::HashSet::new();
    for ((sheet_id, r, c), outcome) in &workbook.outcomes {
        let Some(crate::calculate::SpillOutcome::Fills { array, .. }) = &outcome.spill else { continue };
        if *sheet_id != sheet.id {
            continue;
        }
        let Some((row, column)) = sheet.rows.position(*r).zip(sheet.columns.position(*c)) else { continue };
        for ((i, j), _) in array.entries() {
            if (i, j) != (0, 0) {
                out.insert((row + i, column + j));
            }
        }
    }
    out
}

/// The limits a paste or fill gives (`limits`, a copied cell's) to cells (by ids) of the sheet it lands on: only to
/// those without any. As limits are kept, a run of columns one after the other by id whose limits are the same
/// (in every row, deleted or not) is one block; the blocks by their columns' ids.
pub(super) fn limits_given(bases: &Bases, sheet: &Sheet, rows: &[LineId], columns: &[LineId], limits: &Json) -> Vec<CellsToFormat> {
    let mut columns: Vec<LineId> = columns.iter().copied().filter(|&c| sheet.columns.contains(c)).collect();
    columns.sort_by(|a, b| id_order(bases, *a, *b));
    columns.dedup();
    // Each column's limits, by row.
    let wanted: hashbrown::HashSet<LineId> = columns.iter().copied().collect();
    let mut held: hashbrown::HashMap<LineId, Vec<(String, u32, String)>> = hashbrown::HashMap::new();
    for (leaf, (r, c), v) in sheet.formats.iter() {
        if leaf == Leaf::ValueLimits && wanted.contains(&c) {
            held.entry(c).or_default().push((bases.name(r.base).to_owned(), r.n, v.to_string()));
        }
    }
    held.values_mut().for_each(|rows| rows.sort_unstable());
    let mut found: Vec<(Vec<LineId>, LineId, Vec<LineId>)> = Vec::new();
    for c in columns {
        let given: Vec<LineId> = rows.iter().copied().filter(|&r| sheet.formats.get(Leaf::ValueLimits, (r, c)).is_none()).collect();
        if given.is_empty() {
            continue;
        }
        match found.last_mut() {
            Some((_, last, run)) if last.base == c.base && last.n + 1 == c.n && held.get(last) == held.get(&c) => {
                *last = c;
                run.push(c);
            }
            _ => found.push((given, c, vec![c])),
        }
    }
    found
        .into_iter()
        .map(|(mut rows, _, mut columns)| CellsToFormat {
            rows: sorted_runs(bases, &mut rows),
            columns: sorted_runs(bases, &mut columns),
            format: json!({"valueLimits": limits}),
        })
        .collect()
}

/// Whether an edit's cells are held to their limits once it is made: typing, pasting and filling, people added or
/// taken away, and an interactive's writes; not moving, sorting, clearing or ticking a line of a list.
pub(super) fn is_held_to_limits(edit: &super::Edit) -> bool {
    use super::{cells, clipboard, interactive, Edit};
    match edit {
        Edit::Cells(edit) => !matches!(edit, cells::Edit::ClearCells(_) | cells::Edit::ListLine(_)),
        Edit::Clipboard(edit) => !matches!(edit, clipboard::Edit::MoveCells(_)),
        Edit::Interactive(edit) => matches!(edit, interactive::Edit::WriteFromInteractive { .. }),
        _ => false,
    }
}

/// An edit's operations as they are checked once applied: those that give a cell with limits (neither a
/// checkbox's nor a dropdown's) a value other than a number within them or a formula are taken back
/// (`valueOutsideLimits`), what they touched told with the next changes all the same. The cells are held to the
/// limits they had before.
pub(super) fn limits_kept(workbook: &Workbook, made: Made) -> Result<Made, Refused> {
    for op in &made.ops {
        let Op::SetCells { sheet_id, cells, .. } = op else { continue };
        let Some(s) = workbook.sheet_index(sheet_id) else { continue };
        let sheet = &workbook.sheets[s];
        for cell in cells {
            let Some(input) = &cell.input else { continue };
            let Some(at) = workbook.bases.parse(&cell.r).zip(workbook.bases.parse(&cell.c)) else { continue };
            let Some(limits) = limits_at(sheet, at) else { continue };
            if control_of(sheet, at).is_some() {
                continue;
            }
            let kept = match input {
                Input::Formula { .. } => true,
                Input::Number { value } => within(*value, limits),
                _ => false,
            };
            if !kept {
                return Err(Refused::Tried("valueOutsideLimits", made.ops));
            }
        }
    }
    Ok(made)
}
