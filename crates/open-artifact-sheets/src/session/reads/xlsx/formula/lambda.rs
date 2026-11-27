//! MAP, BYROW, BYCOL and LAMBDA as Excel reads them, and the names LET and LAMBDA give values to.
//!
//! - A LAMBDA is written only as the last argument of MAP, BYROW or BYCOL that takes its names (one per array for
//!   MAP, one for BYROW and BYCOL), as `_xlfn.LAMBDA(_xlpm.X,…)`. A MAP, BYROW or BYCOL whose last argument is not
//!   such a LAMBDA, and a LAMBDA anywhere else, are written as their value; but a LAMBDA with fewer than two
//!   arguments is written as `#N/A`, and one whose names are not (a value, a cell's address, a name twice) as
//!   `#NAME?`, as they work out.
//! - A name a LET or a LAMBDA gives a value to is `_xlpm.NAME`, with `_` after it when Excel would read it as a
//!   reference in its R1C1 style (`_xlpm.R_`, `_xlpm.RC_`, `_xlpm.R1C1_`, `_xlpm.C12R_`).

use super::Writer;
use crate::evaluate::lambda::{lambda_of, names_of, Walk};
use crate::formula::Expr;
use crate::value::CellError;

/// The error a LAMBDA is written as: #N/A with fewer than two arguments, #NAME? when its names are not names.
pub(super) fn fault(arguments: &[Expr]) -> Option<CellError> {
    if arguments.len() < 2 {
        return Some(CellError::NotAvailable);
    }
    names_of(arguments).is_none().then_some(CellError::Name)
}

/// A name a LET or a LAMBDA gives a value to, as Excel reads it.
pub(super) fn parameter(name: &str) -> String {
    if is_r1c1(name) {
        format!("_xlpm.{name}_")
    } else {
        format!("_xlpm.{name}")
    }
}

/// Whether a name (in capitals) reads as a reference in R1C1 style: R or C, then digits, then maybe the other
/// letter and digits.
fn is_r1c1(name: &str) -> bool {
    let bytes = name.as_bytes();
    let digits = |from: usize| from + bytes[from..].iter().take_while(|b| b.is_ascii_digit()).count();
    let other = match bytes.first() {
        Some(b'R') => b'C',
        Some(b'C') => b'R',
        _ => return false,
    };
    let mut i = digits(1);
    if bytes.get(i) == Some(&other) {
        i = digits(i + 1);
    }
    i == bytes.len()
}

impl Writer<'_> {
    /// The arguments of a MAP, BYROW or BYCOL as Excel reads them, its LAMBDA's names given; `None` when it is
    /// written as its value.
    pub(super) fn apply_lambda(&mut self, walk: Walk, arguments: &[Expr]) -> Option<Vec<String>> {
        let (arrays, last) = arguments.split_at(arguments.len() - 1);
        let lambda = lambda_of(&last[0])?;
        if lambda.len() < 2 {
            return None;
        }
        let names = names_of(lambda)?;
        let wanted = if walk == Walk::Cells { arrays.len() } else { 1 };
        if names.len() != wanted {
            return None;
        }
        let mut written = Vec::with_capacity(arguments.len());
        for array in arrays {
            written.push(self.expr(array)?.text);
        }
        let depth = self.scopes.len();
        self.scopes.extend(names.iter().cloned());
        let formula = self.expr(&lambda[lambda.len() - 1]);
        self.scopes.truncate(depth);
        let mut inner: Vec<String> = names.iter().map(|n| parameter(n)).collect();
        inner.push(formula?.text);
        written.push(format!("_xlfn.LAMBDA({})", inner.join(",")));
        Some(written)
    }
}
