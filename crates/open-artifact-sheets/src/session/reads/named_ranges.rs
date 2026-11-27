//! The workbook's named ranges (`readNamedRanges`): each by its name whatever its case, with its address and its
//! cells where they are now (`Workbook::named_ranges_read`).

use serde::Deserialize;
use serde_json::Value as Json;

use crate::workbook::Workbook;

pub const KINDS: &[&str] = &["readNamedRanges"];

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    ReadNamedRanges {},
}

pub fn answer(workbook: &Workbook, request: &Json) -> String {
    match serde_json::from_value(request.clone()) {
        Ok(Request::ReadNamedRanges {}) => workbook.named_ranges_read().to_string(),
        Err(_) => super::unreadable(),
    }
}
