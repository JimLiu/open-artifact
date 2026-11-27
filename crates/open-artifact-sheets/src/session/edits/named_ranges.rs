//! Named ranges: saving one (`saveNamedRange`, new when its id is `null`) and removing one (`removeNamedRange`), each
//! one `setNamedRanges`.
//!
//! A saved one is looked at in this order: its sheet (`unknownSheet`), its id (`unknownNamedRange`), or for a new one
//! how many there are (`tooManyNamedRanges`), its address, typed as a formula on that sheet would be and one reference
//! to cells and nothing else (`addressOfNamedRangeNamesNoCells`; a sheet's name in it names its sheet, `$` is let go),
//! and its name, trimmed (`nameOfNamedRangeNotAllowed`, then `nameOfNamedRangeTaken` by another whatever its case).
//! One saved as it is changes nothing.

use serde::Deserialize;
use serde_json::Value as Json;

use super::{Made, Refused};
use crate::workbook::load::Op;
use crate::workbook::named_ranges::{name_is_allowed, CellsOfANamedRange, NamedRange, NamedRangeToSet, MOST_NAMED_RANGES};
use crate::workbook::Workbook;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    #[serde(rename_all = "camelCase")]
    SaveNamedRange {
        #[serde(deserialize_with = "crate::workbook::layout::written::maybe_null")]
        named_range_id: Option<String>,
        name: String,
        sheet_id: String,
        address: String,
    },
    #[serde(rename_all = "camelCase")]
    RemoveNamedRange { named_range_id: String },
}

pub fn read(edit: &Json) -> Option<Edit> {
    serde_json::from_value(edit.clone()).ok()
}

pub fn make(workbook: &Workbook, edit: Edit, code: &str) -> Result<Made, Refused> {
    let (named_range_id, named_range) = match edit {
        Edit::RemoveNamedRange { named_range_id } => {
            if workbook.named_range(&named_range_id).is_none() {
                return Err(Refused::Because("unknownNamedRange"));
            }
            (named_range_id, None)
        }
        Edit::SaveNamedRange { named_range_id, name, sheet_id, address } => {
            let sheet = workbook.sheet_index(&sheet_id).ok_or(Refused::Because("unknownSheet"))?;
            let before = match &named_range_id {
                Some(id) => Some(workbook.named_range(id).ok_or(Refused::Because("unknownNamedRange"))?),
                None if workbook.named_ranges.len() >= MOST_NAMED_RANGES => {
                    return Err(Refused::Because("tooManyNamedRanges"));
                }
                None => None,
            };
            let cells = cells_of(workbook, sheet, &address).ok_or(Refused::Because("addressOfNamedRangeNamesNoCells"))?;
            let name = name.trim();
            if !name_is_allowed(name) {
                return Err(Refused::Because("nameOfNamedRangeNotAllowed"));
            }
            if workbook.named_range_named(name).is_some_and(|id| Some(id) != named_range_id.as_deref()) {
                return Err(Refused::Because("nameOfNamedRangeTaken"));
            }
            let range = NamedRange { name: name.to_owned(), cells };
            if before == Some(&range) {
                return Ok(Made::nothing());
            }
            (named_range_id.unwrap_or_else(|| format!("nrg_{code}.0")), Some(range))
        }
    };
    Ok(Made::ops(vec![Op::SetNamedRanges { named_ranges: vec![NamedRangeToSet { named_range_id, named_range }] }]))
}

/// The cells an address names, typed on a sheet: one reference and nothing around it but spaces.
fn cells_of(workbook: &Workbook, sheet: usize, address: &str) -> Option<CellsOfANamedRange> {
    let stored = crate::typing::typed_formula(workbook, sheet, &format!("={}", address.trim()));
    match (stored.text_between_references.as_slice(), stored.references.as_slice()) {
        ([before, after], [reference]) if before == "=" && after.is_empty() => CellsOfANamedRange::of_reference(reference),
        _ => None,
    }
}
