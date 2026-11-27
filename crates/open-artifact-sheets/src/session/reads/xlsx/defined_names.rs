//! The workbook's named ranges as the file's defined names (`<definedNames>` in `xl/workbook.xml`).

use std::fmt::Write;

use super::formula::{sheet_name, LAST_COLUMN, LAST_ROW};
use super::xml;
use crate::formula::{column_letters, Reference};
use crate::workbook::Workbook;

/// Every named range by its id, each as its name (as given, whether or not a person could type it) and its cells
/// with both ends fixed: `'Data'!$A$1`, `'Data'!$A$1:$B$2`, `'Data'!$B:$C`, `'Data'!$B$3:$C$1048576`,
/// `'Data'!$1:$2`, `'Data'!$D$1:$XFD$2`; `#REF!` once its cells are gone. Nothing when there are none. `names` are
/// the sheets' names in the file.
pub fn defined_names(workbook: &Workbook, names: &[String]) -> String {
    if workbook.named_ranges.is_empty() {
        return String::new();
    }
    let mut out = String::from("<definedNames>");
    for (_, range) in workbook.named_ranges.values() {
        let reference = range.cells.as_reference();
        let cells = match workbook.locate(&reference) {
            None => "#REF!".to_owned(),
            Some(at) => {
                let (top, bottom) = (at.top.0 + 1, at.bottom.0 + 1);
                let (left, right) = (column_letters(at.left.0), column_letters(at.right.0));
                let text = match reference {
                    Reference::Cell { .. } => format!("${left}${top}"),
                    Reference::Range { .. } => format!("${left}${top}:${right}${bottom}"),
                    Reference::Columns { top: None, .. } => format!("${left}:${right}"),
                    Reference::Columns { top: Some(_), .. } => format!("${left}${top}:${right}${LAST_ROW}"),
                    Reference::Rows { left: None, .. } => format!("${top}:${bottom}"),
                    Reference::Rows { left: Some(_), .. } => format!("${left}${top}:${LAST_COLUMN}${bottom}"),
                    Reference::NamedRange { .. } | Reference::TableColumn { .. } | Reference::TablePart { .. } => {
                        unreachable!("a named range's cells are never a named range or a connected table")
                    }
                };
                format!("{}!{text}", sheet_name(&names[at.sheet]))
            }
        };
        let _ = write!(out, "<definedName name=\"{}\">{}</definedName>", xml::attribute(&range.name), xml::text(&cells));
    }
    out.push_str("</definedNames>");
    out
}
