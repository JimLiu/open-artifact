//! Why a call comes to #VALUE!, from what the call itself tells (see `crate::told`), and why a SUBTOTAL or an
//! AGGREGATE does.
//!
//! - Ranges read together that are not of one size (`rangesOfDifferentSizes`, of whatever error the call comes to:
//!   `=SUMPRODUCT(B1:B2,B1:B3)` #VALUE!, `=CHISQ.TEST(B1:B2,B1:B3)` #N/A, `=LINEST(B1:B2,B1:B3)` #REF!).
//! - A cell given for one value that holds text the call reads as a number, which does not read as one
//!   (`holdsTextWhereANumberIsNeeded`: `=ABS(C1)`, `=FIND("a","b",C1)`). Text a call reads as text and parses
//!   itself is no such cell (`=NUMBERVALUE(C1)`, `=DATEVALUE(C1)`), nor is text of some arguments read
//!   without telling (`READ_UNTOLD`).
//! - SORT's or SORTN's column past its range's columns, cut to a whole number (`noSuchColumnToSortBy`:
//!   `=SORT(B1:B2,3)`), and an order of SORT, SORTN or SORTBY that is not 1, 0 or -1 (`sortOrderIsNotRead`), the
//!   first the call reads.
//! - SUBTOTAL's function code 101 to 111, and AGGREGATE's odd skip code, which skip hidden rows
//!   (`functionCodeSkipsHiddenRows`, with the code that counts them); a range of SUBTOTAL, or one AGGREGATE totals
//!   with a code 1 to 13, given no reference (`argumentIsNoReference`); one with a formula that calls SUBTOTAL or
//!   AGGREGATE (`holdsANestedSubtotal`, the first such cell row by row), which AGGREGATE reads only with a skip code
//!   of 0 or 2. SUBTOTAL tells of its code first, then of its ranges in order; AGGREGATE tells of its ranges, then
//!   of its skip code. A code of neither function's tells nothing.

use std::rc::Rc;

use serde_json::{json, Value as Json};

use super::Finder;
use crate::coerce;
use crate::evaluate::Operand;
use crate::formula::Expr;
use crate::functions::{self, Description, Takes};
use crate::told::{self, Told};
use crate::value::{CellError, Value};

/// The arguments (by position, from 0) whose text is read as a number without telling it holds text where
/// a number is needed: `=CEILING.MATH(2,C1)`, `=SORT(B1:B2,C1)`, `=TAKE(B1:B2,C1)` tell nothing, where
/// `=CEILING.MATH(2,1,C1)`, `=SORTN(B1:B2,1,C1)` and `=DROP(B1:B2,C1)` tell C1.
const READ_UNTOLD: [(&str, &[usize]); 10] = [
    ("ADDRESS", &[2, 3]),
    ("CEILING.MATH", &[1]),
    ("FIXED", &[1, 2]),
    ("FLOOR.MATH", &[1]),
    ("SORT", &[1, 2]),
    ("SORTBY", &[2, 4, 6]),
    ("SORTN", &[1, 3, 4]),
    ("TAKE", &[1, 2]),
    ("TEXTAFTER", &[2, 3]),
    ("TEXTBEFORE", &[2, 3]),
];

impl<'a> Finder<'a> {
    /// Why a call comes to its error, from what it tells (only ranges of different sizes, of an error other than
    /// #VALUE!), or of SUBTOTAL's and AGGREGATE's.
    pub(super) fn told_by_the_call(
        &mut self,
        call: &Expr,
        description: &Description,
        arguments: &[Expr],
        slots: &[&functions::Argument],
    ) -> Option<Json> {
        let value = self.error == CellError::Value;
        match description.name {
            "SUBTOTAL" if value => return self.subtotal(arguments),
            "AGGREGATE" if value => return self.aggregate(arguments),
            _ => {}
        }
        // The cells given for one value that hold text, but for arguments whose text is not told.
        let untold = READ_UNTOLD.iter().find(|(name, _)| *name == description.name).map_or(&[][..], |(_, at)| *at);
        let mut cells = Vec::new();
        for (i, (expr, slot)) in arguments.iter().zip(slots).enumerate() {
            if slot.takes != Takes::OneValue || matches!(expr, Expr::Missing) || untold.contains(&i) {
                continue;
            }
            let Operand::Range(place) = self.calculation.eval(self.f, expr) else {
                continue;
            };
            if !place.is_single() {
                continue;
            }
            let (sheet, r, c) = (place.sheet, place.top, place.left);
            if let Value::Text(text) = self.calculation.cell_value(sheet, r, c) {
                cells.push((sheet, r, c, text));
            }
        }
        let calculation = &mut self.calculation;
        let f = self.f;
        let (_, all) = told::watching(|| calculation.eval(f, call));
        for told in all {
            match told {
                Told::RangesOfDifferentSizes => {
                    // CHITEST and TTEST are told as the functions they are another name of.
                    let function = match description.name {
                        "CHITEST" => "CHISQ.TEST",
                        "TTEST" => "T.TEST",
                        name => name,
                    };
                    return Some(json!({"kind": "rangesOfDifferentSizes", "function": function}));
                }
                _ if !value => {}
                Told::TextNotANumber(text) => {
                    if let Some((sheet, r, c, _)) = cells.iter().find(|(.., t)| Rc::ptr_eq(t, &text)) {
                        return Some(json!({"kind": "holdsTextWhereANumberIsNeeded", "cell": self.cell(*sheet, *r, *c)}));
                    }
                }
                Told::NoSuchColumnToSortBy { argument, columns, column } => {
                    return Some(json!({
                        "kind": "noSuchColumnToSortBy",
                        "function": description.name,
                        "range": slots[argument].name,
                        "columns": columns,
                        "column": column as i64,
                    }));
                }
                Told::SortOrderIsNotRead { argument } => {
                    return Some(json!({
                        "kind": "sortOrderIsNotRead",
                        "function": description.name,
                        "order": slots[argument].name,
                    }));
                }
            }
        }
        None
    }

    /// A code argument as a number cut to a whole one; a cell given for it that holds text that is no number is
    /// the cause (`Err`).
    fn code(&mut self, expr: Option<&Expr>) -> Result<Option<f64>, Json> {
        let Some(expr) = expr else {
            return Ok(None);
        };
        let operand = self.calculation.eval(self.f, expr);
        let value = match operand {
            Operand::Value(v) => v,
            Operand::Range(p) if p.is_single() => {
                let value = self.calculation.cell_value(p.sheet, p.top, p.left);
                if matches!(value, Value::Text(_)) && coerce::to_number(&value, self.calculation.locale).is_err() {
                    return Err(json!({"kind": "holdsTextWhereANumberIsNeeded", "cell": self.cell(p.sheet, p.top, p.left)}));
                }
                value
            }
            Operand::Array(a) | Operand::Values(a) if a.is_single() => a.get(0, 0).clone(),
            _ => return Ok(None),
        };
        Ok(coerce::to_number(&value, self.calculation.locale).ok().map(f64::trunc))
    }

    /// Of ranges in order, the first given no reference, or (when `nested`) with a formula that calls SUBTOTAL or
    /// AGGREGATE.
    fn subtotal_ranges(&mut self, function: &str, ranges: &[Expr], nested: bool) -> Option<Json> {
        for expr in ranges {
            let Operand::Range(place) = self.calculation.eval(self.f, expr) else {
                return Some(json!({"kind": "argumentIsNoReference", "function": function, "argument": "range"}));
            };
            if nested {
                if let Some((r, c)) = self.calculation.nested_subtotal_in(place) {
                    return Some(json!({"kind": "holdsANestedSubtotal", "cell": self.cell(place.sheet, r, c)}));
                }
            }
        }
        None
    }

    fn subtotal(&mut self, arguments: &[Expr]) -> Option<Json> {
        let code = match self.code(arguments.first()) {
            Ok(code) => code?,
            Err(cause) => return Some(cause),
        };
        if (101.0..=111.0).contains(&code) {
            return Some(json!({
                "kind": "functionCodeSkipsHiddenRows",
                "function": "SUBTOTAL",
                "functionCode": code as i64,
                "codeThatCountsHiddenRows": code as i64 - 100,
            }));
        }
        if !(1.0..=11.0).contains(&code) {
            return None;
        }
        self.subtotal_ranges("SUBTOTAL", &arguments[1..], true)
    }

    fn aggregate(&mut self, arguments: &[Expr]) -> Option<Json> {
        let code = match self.code(arguments.first()) {
            Ok(code) => code,
            Err(cause) => return Some(cause),
        };
        let skip = match self.code(arguments.get(1)) {
            Ok(skip) => skip?,
            Err(cause) => return Some(cause),
        };
        let code = code?;
        if !(1.0..=19.0).contains(&code) || !(0.0..=7.0).contains(&skip) {
            return None;
        }
        let skips_hidden_rows = skip % 2.0 == 1.0;
        let nested = skip < 4.0 && !skips_hidden_rows;
        if code < 14.0 {
            if let Some(cause) = self.subtotal_ranges("AGGREGATE", &arguments[2..], nested) {
                return Some(cause);
            }
        } else if let Some(range) = arguments.get(2) {
            match self.calculation.eval(self.f, range) {
                // An array or a value has no hidden rows.
                Operand::Range(_) => {}
                _ => return None,
            }
            if let Some(cause) = self.subtotal_ranges("AGGREGATE", std::slice::from_ref(range), nested) {
                return Some(cause);
            }
        }
        skips_hidden_rows.then(|| {
            json!({
                "kind": "functionCodeSkipsHiddenRows",
                "function": "AGGREGATE",
                "functionCode": skip as i64,
                "codeThatCountsHiddenRows": skip as i64 - 1,
            })
        })
    }
}
