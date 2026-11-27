//! The sheet edits: adding, renaming, moving and deleting sheets, and the workbook's locale and time zone.
//!
//! A new sheet's id comes from the edit's `newIdCode`: the sheet is `sht_<code>.0`, its rows `row_<code>.<n>` and its
//! columns `col_<code>.<n>`.

use serde::Deserialize;

use super::{Context, Made, Refused};
use crate::ids::IdRun;
use crate::session::place::Place;
use crate::workbook::load::{Op, SheetMove, SheetName};
use crate::workbook::Workbook;

/// Rows and columns a new sheet starts with.
const NEW_SHEET_ROWS: u32 = 1000;
const NEW_SHEET_COLUMNS: u32 = 26;
/// The longest a sheet's name may be, in characters.
const LONGEST_SHEET_NAME: usize = 100;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    AddSheet { after_sheet: Option<String>, name_stem: String },
    #[serde(rename_all = "camelCase")]
    RenameSheet { sheet_id: String, name: String },
    #[serde(rename_all = "camelCase")]
    MoveSheet { sheet_id: String, after_sheet: Option<String> },
    #[serde(rename_all = "camelCase")]
    DeleteSheet { sheet_id: String },
    SetLocale { locale: String },
    #[serde(rename_all = "camelCase")]
    SetTimeZone { time_zone: String },
}

/// The edit as the session reads it, before anything else about it: an edit that is not one, or names a locale or a
/// time zone there is none of, is unreadable.
pub fn read(edit: &serde_json::Value) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    match &edit {
        Edit::SetLocale { locale } => crate::locale::find(locale).map(|_| ())?,
        Edit::SetTimeZone { time_zone } => crate::time_zone::named(time_zone).map(|_| ())?,
        _ => (),
    };
    Some(edit)
}

pub fn make(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let code = context.code;
    match edit {
        Edit::AddSheet { after_sheet, name_stem } => add_sheet(workbook, after_sheet, &name_stem, code),
        Edit::RenameSheet { sheet_id, name } => rename_sheet(workbook, sheet_id, name, context),
        Edit::MoveSheet { sheet_id, after_sheet } => move_sheet(workbook, sheet_id, after_sheet, context),
        Edit::DeleteSheet { sheet_id } => {
            workbook.sheet_index(&sheet_id).ok_or(Refused::Because("unknownSheet"))?;
            let ops = vec![Op::DeleteSheet { sheet_id: sheet_id.clone() }];
            // No other sheet left with a row and a column: none left to show. No other sheet not hidden: none shown.
            // A protection of the sheet refuses before either. A connected sheet's rows are those it shows, its heading
            // and its records.
            if !workbook.with_tables().sheets.iter().any(|s| s.id != sheet_id && s.rows.len() > 0 && s.columns.len() > 0) {
                return Err(super::protected::refuse(workbook, context, &ops, "noSheetLeft"));
            }
            if !workbook.sheets.iter().any(|s| s.id != sheet_id && !s.is_hidden) {
                return Err(super::protected::refuse(workbook, context, &ops, "noShownSheetLeft"));
            }
            Ok(Made { ops, place: Some(Place::Nowhere) })
        }
        Edit::SetLocale { locale } => {
            if crate::locale::find(&locale).is_none() {
                return Err(Refused::Unreadable);
            }
            if workbook.locale == locale {
                return Ok(Made::nothing());
            }
            Ok(Made::ops(vec![Op::SetLocale { locale }]))
        }
        Edit::SetTimeZone { time_zone } => {
            let zone = crate::time_zone::named(&time_zone).ok_or(Refused::Unreadable)?;
            if workbook.time_zone.as_deref().and_then(crate::time_zone::named) == Some(zone) {
                return Ok(Made::nothing());
            }
            Ok(Made::ops(vec![Op::SetTimeZone { time_zone: Some(zone.to_owned()) }]))
        }
    }
}

/// Whether a name may be a sheet's: not empty, not too long, no control characters.
fn is_allowed_sheet_name(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= LONGEST_SHEET_NAME && !name.chars().any(char::is_control)
}

/// Whether another sheet than `but` has the name, as names are compared: whatever their case.
fn is_sheet_name_taken(workbook: &Workbook, name: &str, but: Option<&str>) -> bool {
    let name = name.to_lowercase();
    workbook.sheets.iter().any(|s| Some(s.id.as_str()) != but && s.name.to_lowercase() == name)
}

/// A new sheet, named its stem and the first number from one more than there are sheets that no sheet has.
fn add_sheet(workbook: &Workbook, after: Option<String>, stem: &str, code: &str) -> Result<Made, Refused> {
    // A sheet may follow a deleted one: it goes where that one was.
    if after.as_ref().is_some_and(|after| !workbook.sheet_order.contains(after)) {
        return Err(Refused::Because("unknownSheet"));
    }
    let mut n = workbook.sheets.len() + 1;
    let name = loop {
        let name = format!("{stem}{n}");
        if !is_sheet_name_taken(workbook, &name, None) {
            break name;
        }
        n += 1;
    };
    if !is_allowed_sheet_name(&name) {
        return Err(Refused::Because("sheetNameNotAllowed"));
    }
    let sheet_id = format!("sht_{code}.0");
    Ok(Made::ops(vec![
        Op::InsertSheet { sheet_id: sheet_id.clone(), name, after },
        Op::InsertRows {
            sheet_id: sheet_id.clone(),
            after: None,
            rows: IdRun { base: format!("row_{code}"), first: 0, count: NEW_SHEET_ROWS },
        },
        Op::InsertColumns {
            sheet_id,
            after: None,
            columns: IdRun { base: format!("col_{code}"), first: 0, count: NEW_SHEET_COLUMNS },
        },
    ]))
}

fn rename_sheet(workbook: &Workbook, sheet_id: String, name: String, context: &Context) -> Result<Made, Refused> {
    let i = workbook.sheet_index(&sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    if workbook.sheets[i].name == name {
        return Ok(Made::nothing());
    }
    if !is_allowed_sheet_name(&name) {
        return Err(Refused::Because("sheetNameNotAllowed"));
    }
    let ops = vec![Op::SetSheetNames { names: vec![SheetName { sheet_id: sheet_id.clone(), name: name.clone() }] }];
    if is_sheet_name_taken(workbook, &name, Some(&sheet_id)) {
        return Err(super::protected::refuse(workbook, context, &ops, "sheetNameTaken"));
    }
    Ok(Made::ops(ops))
}

fn move_sheet(workbook: &Workbook, sheet_id: String, after: Option<String>, context: &Context) -> Result<Made, Refused> {
    let i = workbook.sheet_index(&sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    if let Some(after) = &after {
        workbook.sheet_index(after).ok_or(Refused::Because("unknownSheet"))?;
    }
    // Where it is now: after the sheet before it.
    let now_after = i.checked_sub(1).map(|j| workbook.sheets[j].id.clone());
    if after == now_after || after.as_deref() == Some(sheet_id.as_str()) {
        return Ok(Made::nothing());
    }
    context.may_move()?;
    Ok(Made::ops(vec![Op::MoveSheets { moves: vec![SheetMove { sheet_ids: vec![sheet_id], after }] }]))
}
