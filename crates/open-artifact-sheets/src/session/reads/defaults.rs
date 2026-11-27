//! Reading default values and limits (`session/edits/defaults.rs`).
//!
//! - `readDefaultValueAndLimits`: a cell's default value as its control takes it (`null` for none) and
//!   its least and most number (`null` for no end), each as the cell's format shows it and as it is edited.
//! - `readCellsChangedFromTheirDefaults`: the cells of a sheet that hold something else than their default value
//!   (an option of the same id is the same), row by row: each with its address, the text it shows and the default
//!   value as shown. Of the cells with a default value, the first 1000 as they are kept are looked at
//!   (`looked_at`).

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::edited;
use crate::ids::LineId;
use crate::locale::{self, Locale};
use crate::number_format::Room;
use crate::session::edits::defaults::{default_at, is_changed, limits_at, looked_at, Default};
use crate::shown::{shown, ShownValue};
use crate::value::Value;
use crate::workbook::formats::Leaf;
use crate::workbook::load::Refusal;
use crate::workbook::{Input, Sheet, Workbook};

pub const KINDS: &[&str] = &["readDefaultValueAndLimits", "readCellsChangedFromTheirDefaults"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CellAt {
    r: String,
    c: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    #[serde(rename_all = "camelCase")]
    ReadDefaultValueAndLimits { sheet_id: String, cell: CellAt },
    #[serde(rename_all = "camelCase")]
    ReadCellsChangedFromTheirDefaults { sheet_id: String },
}

pub fn answer(workbook: &Workbook, request: &Json) -> String {
    let Ok(request) = Request::deserialize(request) else {
        return super::unreadable();
    };
    match answered(workbook, request) {
        Ok(answer) => answer.to_string(),
        Err(refusal) => json!({"kind": "refused", "refusal": refusal}).to_string(),
    }
}

fn answered(workbook: &Workbook, request: Request) -> Result<Json, Refusal> {
    let locale = locale::find(&workbook.locale).unwrap_or_else(locale::en_us);
    Ok(match request {
        Request::ReadDefaultValueAndLimits { sheet_id, cell } => {
            let s = workbook.sheet_index(&sheet_id).ok_or(Refusal::UnknownSheet)?;
            let sheet = &workbook.sheets[s];
            let r = workbook.bases.parse(&cell.r).filter(|&l| sheet.rows.contains(l)).ok_or(Refusal::UnknownRow)?;
            let c = workbook.bases.parse(&cell.c).filter(|&l| sheet.columns.contains(l)).ok_or(Refusal::UnknownColumn)?;
            let at = (r, c);
            let default = default_at(workbook, sheet, at).map(|d| shown_default(sheet, at, &d, locale));
            let (minimum, maximum) = limits_at(sheet, at).unwrap_or((None, None));
            let end = |n: Option<f64>| n.map(|n| json!({"shown": shown_number(sheet, at, n, locale), "textToEdit": number_edited(sheet, at, n, locale)}));
            json!({"kind": "defaultValueAndLimits", "defaultValue": default, "minimum": end(minimum), "maximum": end(maximum)})
        }
        Request::ReadCellsChangedFromTheirDefaults { sheet_id } => {
            let s = workbook.sheet_index(&sheet_id).ok_or(Refusal::UnknownSheet)?;
            let sheet = &workbook.sheets[s];
            let mut cells: Vec<((usize, usize), (LineId, LineId), Default)> = looked_at(&workbook.bases, sheet)
                .into_iter()
                .filter_map(|at| Some(((sheet.rows.position(at.0)?, sheet.columns.position(at.1)?), at, default_at(workbook, sheet, at)?)))
                .collect();
            cells.sort_by_key(|&(place, ..)| place);
            let changed: Vec<Json> = cells
                .into_iter()
                .filter_map(|((r, c), at, default)| {
                    is_changed(sheet, at, &default).then(|| {
                        json!({
                            "r": workbook.bases.text(at.0),
                            "c": workbook.bases.text(at.1),
                            "address": format!("{}{}", crate::formula::column_letters(c), r + 1),
                            "held": held(workbook, sheet, at, locale),
                            "defaultValue": shown_default(sheet, at, &default, locale)["shown"],
                        })
                    })
                })
                .collect();
            json!({"kind": "cellsChangedFromTheirDefaults", "cells": changed})
        }
    })
}

fn pattern_of(sheet: &Sheet, at: (LineId, LineId)) -> Option<&str> {
    sheet.formats.get(Leaf::NumberFormat, at).and_then(|f| f.get("pattern")?.as_str())
}

fn text_of(value: &Value, pattern: Option<&str>, locale: &Locale) -> String {
    match shown(value, pattern, Room::AsText, locale) {
        Ok(ShownValue::Text { text, .. }) => text,
        _ => match shown(value, None, Room::AsText, locale) {
            Ok(ShownValue::Text { text, .. }) => text,
            _ => String::new(),
        },
    }
}

fn shown_number(sheet: &Sheet, at: (LineId, LineId), n: f64, locale: &Locale) -> String {
    text_of(&Value::Number(n), pattern_of(sheet, at), locale)
}

fn number_edited(sheet: &Sheet, at: (LineId, LineId), n: f64, locale: &Locale) -> String {
    edited::number_edited_as(n, pattern_of(sheet, at).unwrap_or("General"), locale)
}

/// A default value as the cell's format shows it, and as it is edited.
pub(crate) fn shown_default(sheet: &Sheet, at: (LineId, LineId), default: &Default, locale: &Locale) -> Json {
    let (shown, to_edit) = match default {
        Default::Blank => (String::new(), String::new()),
        Default::Number(n) => (shown_number(sheet, at, *n, locale), number_edited(sheet, at, *n, locale)),
        Default::Text(t) => {
            let to_edit = if edited::text_is_edited_after_the_mark(t, locale) { format!("'{t}") } else { t.clone() };
            (text_of(&Value::Text(t.as_str().into()), pattern_of(sheet, at), locale), to_edit)
        }
        Default::Boolean(b) => {
            let b = if *b { "TRUE" } else { "FALSE" };
            (b.to_owned(), b.to_owned())
        }
        Default::Option { option_id, label } => {
            let label = sheet.dropdown_option(option_id).map_or(label, |o| &o.label);
            (label.clone(), label.clone())
        }
    };
    json!({"shown": shown, "textToEdit": to_edit})
}

/// The text a cell holds: its value as its format shows it; a formula as it is edited (not what it came to); an
/// option's label now; people's and rich text's text.
fn held(workbook: &Workbook, sheet: &Sheet, at: (LineId, LineId), locale: &Locale) -> String {
    let Some(cell) = sheet.cells.get(&at) else { return String::new() };
    let own = pattern_of(sheet, at);
    match &cell.input {
        Input::Number { value } => text_of(&Value::Number(*value), own, locale),
        Input::Text { value } => text_of(&Value::Text(value.as_str().into()), own, locale),
        Input::Boolean { value } => if *value { "TRUE" } else { "FALSE" }.to_owned(),
        Input::DropdownOption { option_id, label } => sheet.dropdown_option(option_id).map_or(label, |o| &o.label).clone(),
        Input::Formula { .. } => workbook
            .sheet_index(&sheet.id)
            .and_then(|s| workbook.cell_contents(s, at, cell, locale, false).formula_text)
            .unwrap_or_default(),
        input => input.reads_as_text().unwrap_or_default(),
    }
}
