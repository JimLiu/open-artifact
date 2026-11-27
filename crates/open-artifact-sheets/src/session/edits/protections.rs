//! Saving and removing a sheet's protections (`saveProtection`, `removeProtection`), as one
//! `setProtections`. A protection saved with no id is new, as `prt_<code>.0`.
//!
//! Refused, in this order: a sheet not there (`unknownSheet`); a row or column a range names that is not a live one
//! of the sheet (`unknownRow`, `unknownColumn`); an id not among the sheet's protections (`unknownProtection`); the
//! same protection again is nothing to change; a new one past the 200 of the workbook (`tooManyProtections`); more
//! than 40 editors (`tooManyEditorsOfProtection`) or 50 open ranges (`tooManyOpenRangesInProtection`); a protection
//! there held against the person, saved or removed (`protectionNotTheirsToChange`); one saved that leaves out the
//! person saving it, anyone but the owner (`protectionLeavesOutWhoeverSetsIt`). Editors not well formed, or one
//! named twice, make the edit unreadable.

use serde::Deserialize;
use serde_json::Value as Json;

use super::{Context, Made, Refused};
use crate::session::person::Person;
use crate::workbook::layout::id_key;
use crate::workbook::load::Op;
use crate::workbook::protections::{are_well_formed, Protection, ProtectionToSet, Protects};
use crate::workbook::Workbook;

/// The most protections a workbook holds.
const MOST_PROTECTIONS: usize = 200;
/// The most editors of a protection.
const MOST_EDITORS: usize = 40;
/// The most open ranges of a sheet's protection.
const MOST_OPEN_RANGES: usize = 50;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    SaveProtection {
        sheet_id: String,
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        protection_id: Option<String>,
        protection: Protection,
    },
    #[serde(rename_all = "camelCase")]
    RemoveProtection { sheet_id: String, protection_id: String },
}

pub fn read(edit: &Json) -> Option<Edit> {
    let edit: Edit = serde_json::from_value(edit.clone()).ok()?;
    if let Edit::SaveProtection { protection, .. } = &edit {
        let entry = ProtectionToSet { protection_id: String::new(), protection: Some(protection.clone()) };
        if !are_well_formed(std::slice::from_ref(&entry)) {
            return None;
        }
    }
    Some(edit)
}

pub fn make(workbook: &Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let (sheet_id, protection_id, protection) = match edit {
        Edit::SaveProtection { sheet_id, protection_id, protection } => (sheet_id, protection_id, Some(protection)),
        Edit::RemoveProtection { sheet_id, protection_id } => (sheet_id, Some(protection_id), None),
    };
    let index = workbook.sheet_index(&sheet_id).ok_or(Refused::Because("unknownSheet"))?;
    let sheet = &workbook.sheets[index];
    let bases = &workbook.bases;
    if let Some(given) = &protection {
        let live = |axis: &crate::ids::Axis, id: &str| bases.parse(id).is_some_and(|l| axis.contains(l));
        for range in given.ranges() {
            let (rows, columns) = range.ends();
            let (rows, columns) = (rows.map(|(a, b)| [a, b]), columns.map(|(a, b)| [a, b]));
            // A range of cells is named corner by corner: row, then column.
            let named: Vec<(bool, &str)> = match (rows, columns) {
                (Some([t, b]), Some([l, r])) => vec![(true, t), (false, l), (true, b), (false, r)],
                (Some([a, b]), None) => vec![(true, a), (true, b)],
                (None, Some([a, b])) => vec![(false, a), (false, b)],
                (None, None) => vec![],
            };
            for (is_row, id) in named {
                if is_row && !live(&sheet.rows, id) {
                    return Err(Refused::Because("unknownRow"));
                }
                if !is_row && !live(&sheet.columns, id) {
                    return Err(Refused::Because("unknownColumn"));
                }
            }
        }
    }
    let before = match &protection_id {
        Some(id) => Some(&sheet.protections.get(&id_key(id)).ok_or(Refused::Because("unknownProtection"))?.1),
        None => None,
    };
    if let (Some(before), Some(given)) = (before, &protection) {
        if before == given {
            return Ok(Made::nothing());
        }
    }
    if let Some(given) = &protection {
        let held: usize = workbook.sheets.iter().map(|s| s.protections.len()).sum();
        if before.is_none() && held >= MOST_PROTECTIONS {
            return Err(Refused::Because("tooManyProtections"));
        }
        if given.editors.len() > MOST_EDITORS {
            return Err(Refused::Because("tooManyEditorsOfProtection"));
        }
        if matches!(&given.protects, Protects::Sheet { open_ranges } if open_ranges.len() > MOST_OPEN_RANGES) {
            return Err(Refused::Because("tooManyOpenRangesInProtection"));
        }
    }
    if before.is_some_and(|p| Person::is_kept_out(context.person, &p.editors)) {
        return Err(Refused::Because("protectionNotTheirsToChange"));
    }
    if protection.as_ref().is_some_and(|p| Person::is_kept_out(context.person, &p.editors)) {
        return Err(Refused::Because("protectionLeavesOutWhoeverSetsIt"));
    }
    let protection_id = protection_id.unwrap_or_else(|| format!("prt_{}.0", context.code));
    Ok(Made::ops(vec![Op::SetProtections {
        sheet_id,
        protections: vec![ProtectionToSet { protection_id, protection }],
    }]))
}

