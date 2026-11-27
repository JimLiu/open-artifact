//! Why a MAP, BYROW, BYCOL or LAMBDA comes to the error.
//!
//! - A LAMBDA with fewer than two arguments misses its formula when its one argument is a name (`LAMBDA(x)`), else
//!   its name (`LAMBDA()`, `LAMBDA(1)`); one given more names than values has too many arguments (`most`: one name
//!   per value and the formula), one given fewer misses a name. Names that are not, or a LAMBDA where it is not
//!   read, tell nothing.
//! - A last argument that is no LAMBDA but an error is followed into (`MAP(1,1/0)` divides by a written zero).
//! - MAP's arrays of different sizes are `rangesOfDifferentSizes`; a formula that comes to several cells is
//!   `severalCellsForOneValue` (with no argument named).
//! - A call that answers one cell is followed into its formula, with each name given what the call gives it (its
//!   array, as a LET's names are given their values); an error in an answer of several cells is not told.

use serde_json::{json, Value as Json};

use super::Finder;
use crate::evaluate::lambda::{lambda_of, Refusal, Walk};
use crate::formula::Expr;

/// Why a LAMBDA with fewer than two arguments is #N/A.
pub(super) fn too_short(arguments: &[Expr]) -> Json {
    let argument = match arguments {
        [Expr::Name(_)] => "formula",
        _ => "name",
    };
    json!({"kind": "argumentIsMissing", "function": "LAMBDA", "argument": argument})
}

impl<'a> Finder<'a> {
    /// Why a MAP, BYROW or BYCOL comes to the error.
    pub(super) fn apply_lambda(&mut self, walk: Walk, name: &str, arguments: &'a [Expr]) -> Option<Json> {
        let given = match self.calculation.given(self.f, walk, arguments) {
            Ok(given) => given,
            Err(refusal) => return self.refused(refusal, name, arguments),
        };
        let (rows, columns) = (given.rows, given.columns);
        if let Err(refusal) = self.calculation.applied(self.f, walk, &given) {
            return self.refused(refusal, name, arguments);
        }
        if (rows, columns) != (1, 1) {
            return None;
        }
        let (scopes, bound) = (self.calculation.scopes.len(), self.bound.len());
        for ((name, array), expr) in given.names.iter().zip(&given.arrays).zip(arguments) {
            let (operand, brought) = self.calculation.given_at(walk, array, 0, 0);
            self.calculation.scopes.push((name.clone(), operand, brought, None));
            self.bound.push((name.clone(), expr));
        }
        let formula = given.formula;
        let cause = if self.has_the_error(formula) { self.cause(formula) } else { None };
        self.calculation.scopes.truncate(scopes);
        self.bound.truncate(bound);
        cause
    }

    /// The cause of a refusal, when the call comes to its error.
    fn refused(&mut self, refusal: Refusal, name: &str, arguments: &'a [Expr]) -> Option<Json> {
        if refusal.error() != self.error {
            return None;
        }
        let lambda = arguments.last().and_then(lambda_of).unwrap_or_default();
        match refusal {
            Refusal::LambdaIsShort => Some(too_short(lambda)),
            Refusal::TooFewNames => Some(json!({"kind": "argumentIsMissing", "function": "LAMBDA", "argument": "name"})),
            Refusal::TooManyNames => {
                let wanted = if name == "MAP" { arguments.len() - 1 } else { 1 };
                Some(json!({
                    "kind": "tooManyArguments",
                    "function": "LAMBDA",
                    "most": wanted + 1,
                    "given": lambda.len(),
                    "takesNoFewer": true,
                }))
            }
            Refusal::SizesDiffer => Some(json!({"kind": "rangesOfDifferentSizes", "function": name})),
            Refusal::SeveralCells => Some(json!({"kind": "severalCellsForOneValue", "function": name, "argument": null})),
            Refusal::IsAnError(_) => {
                let last = arguments.last()?;
                if self.has_the_error(last) { self.cause(last) } else { None }
            }
            Refusal::NoLambda | Refusal::NotNames | Refusal::TooManyValues => None,
        }
    }
}
