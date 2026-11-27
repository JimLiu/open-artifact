//! MAP, BYROW and BYCOL, and the LAMBDA they apply.
//!
//! A LAMBDA is read only where it is written as the last argument of MAP, BYROW or BYCOL (in parentheses or not):
//! its arguments but the last are names, and the last a formula worked out once for each cell (MAP), row (BYROW) or
//! column (BYCOL), with the names given what that one is. Anywhere else, kept in a LET or picked by IF, a LAMBDA is
//! #VALUE! (#N/A with fewer than two arguments, #NAME? with names that are not), and `LAMBDA(x,x)(1)` does not read.
//!
//! The call works out, in order:
//! - a last argument that is no LAMBDA: #VALUE!, or the error it is when it is one value (`MAP(1,1/0)`, not
//!   `MAP(1,A4)`, `MAP(1,{#N/A})`);
//! - a LAMBDA with fewer than two arguments: #N/A; one whose names are not names (a value, a cell's address, a name
//!   twice): #NAME?; one with more or fewer names than the call gives it values (MAP one per array; BYROW and BYCOL
//!   one): #N/A;
//! - MAP's arrays, each a range, an array or one value (an error in them is a value like any other), worked out as an
//!   argument that takes several cells is; they must be of one size, but a side of one stretches across the others'
//!   (`MAP({1,2},{1;2},…)` is 2 by 2); else #VALUE!;
//! - the formula for each cell, row by row (a range's cell is given as that cell, so `ROW(x)` reads it; a row or
//!   column of a range as that range): what it comes to is the cell's value, blank kept blank, an error kept as the
//!   cell's; several cells are #VALUE! for the whole call.
//!
//! The answer is an array, which spills, each value bringing what its formula brings. More than `MOST_VALUES` values
//! made in all (MAP's arrays that are not ranges, and its answer) are #VALUE!.

use std::rc::Rc;

use crate::brought::Brought;
use crate::calculate::{Calculation, SpillFormats};
use crate::formula::parse::looks_like_a_cell;
use crate::formula::Expr;
use crate::value::{Array, CellError, Value};

use super::{Operand, Place};

/// The most values MAP, BYROW or BYCOL makes, its arrays' (other than ranges) and its answer's together:
/// `MAP(SEQUENCE(100000),LAMBDA(x,x))` is worked out, `MAP(SEQUENCE(446),SEQUENCE(1,446),LAMBDA(x,y,x))` too, and
/// `MAP(SEQUENCE(447),SEQUENCE(1,447),LAMBDA(x,y,x))` is #VALUE!.
const MOST_VALUES: usize = 200_000;

/// How MAP, BYROW or BYCOL walks its arrays.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Walk {
    /// MAP: cell by cell.
    Cells,
    /// BYROW: row by row.
    Rows,
    /// BYCOL: column by column.
    Columns,
}

impl Walk {
    pub(crate) fn of(name: &str) -> Option<Walk> {
        match name {
            "MAP" => Some(Walk::Cells),
            "BYROW" => Some(Walk::Rows),
            "BYCOL" => Some(Walk::Columns),
            _ => None,
        }
    }
}

/// Why MAP, BYROW or BYCOL answers no array, in the order the call finds out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// The last argument is no LAMBDA (#VALUE!).
    NoLambda,
    /// The last argument is no LAMBDA but an error, which is the answer (`MAP(1,1/0)` is #DIV/0!).
    IsAnError(CellError),
    /// The LAMBDA has fewer than two arguments (#N/A).
    LambdaIsShort,
    /// The LAMBDA's names are not all names, or one is written twice (#NAME?).
    NotNames,
    /// The LAMBDA has fewer names than the values it is given (#N/A).
    TooFewNames,
    /// The LAMBDA has more names than the values it is given (#N/A).
    TooManyNames,
    /// MAP's arrays are not of one size (#VALUE!).
    SizesDiffer,
    /// The formula came to several cells for one (#VALUE!, of the whole formula).
    SeveralCells,
    /// More values than `MOST_VALUES` (#VALUE!).
    TooManyValues,
}

impl Refusal {
    pub(crate) fn error(self) -> CellError {
        match self {
            Refusal::IsAnError(e) => e,
            Refusal::LambdaIsShort | Refusal::TooFewNames | Refusal::TooManyNames => CellError::NotAvailable,
            Refusal::NotNames => CellError::Name,
            _ => CellError::Value,
        }
    }
}

/// A LAMBDA written as an argument: its arguments, when it is one (in parentheses or not).
pub(crate) fn lambda_of(expr: &Expr) -> Option<&[Expr]> {
    match expr {
        Expr::Call { name, function: Some(_), arguments, .. } if name.as_ref() == "LAMBDA" => Some(arguments),
        _ => None,
    }
}

/// A LAMBDA's names (all its arguments but the last), when they are names: none a value or a cell's address (one
/// past the sheet's end too), none written twice; `None` else.
pub(crate) fn names_of(lambda: &[Expr]) -> Option<Vec<Rc<str>>> {
    let mut names: Vec<Rc<str>> = Vec::new();
    for expr in &lambda[..lambda.len().saturating_sub(1)] {
        match expr {
            Expr::Name(n) if !names.contains(n) && !looks_like_a_cell(n) => names.push(n.clone()),
            _ => return None,
        }
    }
    Some(names)
}

/// What a MAP, BYROW or BYCOL is given, checked: its LAMBDA's names and formula, and its arrays as worked out.
pub(crate) struct Given<'e> {
    pub(crate) names: Vec<Rc<str>>,
    pub(crate) formula: &'e Expr,
    pub(crate) arrays: Vec<(Operand, Option<Brought>)>,
    /// The answer's rows and columns.
    pub(crate) rows: usize,
    pub(crate) columns: usize,
}

/// The rows and columns of an operand.
fn size_of(operand: &Operand) -> (usize, usize) {
    match operand {
        Operand::Value(_) => (1, 1),
        Operand::Range(place) => (place.rows(), place.columns()),
        Operand::Array(a) | Operand::Values(a) => (a.rows(), a.columns()),
    }
}

impl Calculation {
    /// A LAMBDA where it is not read: #NAME? when its names are not names, else #VALUE! (too few arguments are
    /// #N/A before this, as for any call).
    pub(super) fn lambda_alone(&mut self, arguments: &[Expr]) -> Operand {
        self.brought = None;
        self.link = None;
        match names_of(arguments) {
            None => Operand::error(CellError::Name),
            Some(_) => Operand::error(CellError::Value),
        }
    }

    /// MAP, BYROW or BYCOL.
    pub(super) fn apply_lambda(&mut self, f: usize, walk: Walk, arguments: &[Expr]) -> Operand {
        let answer = self.given(f, walk, arguments).and_then(|given| self.applied(f, walk, &given));
        self.link = None;
        match answer {
            Ok((array, formats)) => {
                self.brought = formats.first().cloned().flatten();
                let array = Rc::new(array);
                if formats.iter().any(Option::is_some) {
                    self.array_formats.insert(Rc::as_ptr(&array), (array.clone(), SpillFormats::Dense(formats.into())));
                }
                Operand::Array(array)
            }
            // Several cells where the LAMBDA answers one makes the whole formula #VALUE! (IFERROR does not catch it).
            Err(Refusal::SeveralCells) => self.abort(),
            Err(refusal) => {
                self.brought = None;
                Operand::error(refusal.error())
            }
        }
    }

    /// The LAMBDA and the arrays of a MAP, BYROW or BYCOL, checked in the order the call checks them.
    pub(crate) fn given<'e>(&mut self, f: usize, walk: Walk, arguments: &'e [Expr]) -> Result<Given<'e>, Refusal> {
        let (arrays, last) = arguments.split_at(arguments.len() - 1);
        let Some(lambda) = lambda_of(&last[0]) else {
            let operand = self.eval(f, &last[0]);
            self.brought = None;
            self.link = None;
            return Err(match operand {
                Operand::Value(Value::Error(e)) => Refusal::IsAnError(e),
                _ => Refusal::NoLambda,
            });
        };
        if lambda.len() < 2 {
            return Err(Refusal::LambdaIsShort);
        }
        let names = names_of(lambda).ok_or(Refusal::NotNames)?;
        let wanted = if walk == Walk::Cells { arrays.len() } else { 1 };
        if names.len() < wanted {
            return Err(Refusal::TooFewNames);
        }
        if names.len() > wanted {
            return Err(Refusal::TooManyNames);
        }
        let mut worked = Vec::with_capacity(arrays.len());
        for expr in arrays {
            let operand = match expr {
                Expr::Missing => {
                    self.brought = None;
                    Operand::Value(Value::Blank)
                }
                expr => self.lifting_eval(f, expr),
            };
            worked.push((operand, self.brought.take()));
        }
        let sizes: Vec<(usize, usize)> = worked.iter().map(|(operand, _)| size_of(operand)).collect();
        let side = |of: fn(&(usize, usize)) -> usize| -> Result<usize, Refusal> {
            let longest = sizes.iter().map(of).max().unwrap_or(1);
            match sizes.iter().map(of).all(|n| n == 1 || n == longest) {
                true => Ok(longest),
                false => Err(Refusal::SizesDiffer),
            }
        };
        let (height, width) = (side(|s| s.0)?, side(|s| s.1)?);
        let (rows, columns) = match walk {
            Walk::Cells => (height, width),
            Walk::Rows => (height, 1),
            Walk::Columns => (1, width),
        };
        let made: usize = worked
            .iter()
            .zip(&sizes)
            .filter(|((operand, _), _)| matches!(operand, Operand::Array(_) | Operand::Values(_)))
            .map(|(_, (r, c))| r * c)
            .sum();
        if made + rows * columns > MOST_VALUES {
            return Err(Refusal::TooManyValues);
        }
        Ok(Given { names, formula: &lambda[lambda.len() - 1], arrays: worked, rows, columns })
    }

    /// What one of the arrays gives the LAMBDA for the answer's cell (row, column): a range's cell, row or column as
    /// a range, an array's as one value or an array; a side of one stretched.
    pub(crate) fn given_at(&mut self, walk: Walk, array: &(Operand, Option<Brought>), r: usize, c: usize) -> (Operand, Option<Brought>) {
        let (operand, brought) = array;
        let (rows, columns) = size_of(operand);
        let (r, c) = (if rows == 1 { 0 } else { r }, if columns == 1 { 0 } else { c });
        let (top, left, height, width) = match walk {
            Walk::Cells => (r, c, 1, 1),
            Walk::Rows => (r, 0, 1, columns),
            Walk::Columns => (0, c, rows, 1),
        };
        match operand {
            Operand::Value(_) => (operand.clone(), brought.clone()),
            Operand::Range(place) => {
                let part: Place = place.part(top, left, height, width);
                let brought = self.range_brought(part);
                (Operand::Range(part), brought)
            }
            Operand::Array(a) | Operand::Values(a) => {
                if (height, width) == (1, 1) {
                    // A value of an array whose function picked its values from cells brings what its cell does; of
                    // another array, what the array brings (`A1:A2+DATE(…)`).
                    let brought = match self.array_formats.get(&Rc::as_ptr(a)) {
                        Some((_, formats)) => formats.get(a.columns(), (top, left)).cloned(),
                        None => brought.clone(),
                    };
                    // It is an array of one value, which a function totals as it does an array (`SUM` of
                    // `{"a"}`'s value is 0), and whose TYPE is its value's.
                    let one = Rc::new(Array::single(a.get(top, left).clone()));
                    self.picked.insert(Rc::as_ptr(&one), one.clone());
                    return (Operand::Array(one), brought);
                }
                let mut values = Vec::with_capacity(height * width);
                for row in top..top + height {
                    for column in left..left + width {
                        values.push(a.get(row, column).clone());
                    }
                }
                (Operand::Array(Rc::new(Array::new(height, width, values))), None)
            }
        }
    }

    /// The formula worked out with each name given its value: the cell's value and what it brings, or several cells.
    pub(crate) fn applied_at(&mut self, f: usize, walk: Walk, given: &Given, r: usize, c: usize) -> Result<(Value, Option<Brought>), Refusal> {
        let depth = self.scopes.len();
        for (name, array) in given.names.iter().zip(&given.arrays) {
            let (operand, brought) = self.given_at(walk, array, r, c);
            self.scopes.push((name.clone(), operand, brought, None));
        }
        let operand = match given.formula {
            Expr::Missing => Operand::Value(Value::Blank),
            formula => self.lifting_eval(f, formula),
        };
        let brought = self.brought.take();
        self.scopes.truncate(depth);
        let value = match operand {
            Operand::Value(v) => v,
            Operand::Range(place) if place.is_single() => self.cell_value(place.sheet, place.top, place.left),
            Operand::Array(a) | Operand::Values(a) if a.is_single() => a.get(0, 0).clone(),
            _ => return Err(Refusal::SeveralCells),
        };
        Ok((value, brought))
    }

    /// The answer of a MAP, BYROW or BYCOL: its values and what each brings, row by row.
    pub(crate) fn applied(&mut self, f: usize, walk: Walk, given: &Given) -> Result<(Array, Vec<Option<Brought>>), Refusal> {
        let (rows, columns) = (given.rows, given.columns);
        let mut values = Vec::with_capacity(rows * columns);
        let mut formats = Vec::with_capacity(rows * columns);
        for r in 0..rows {
            for c in 0..columns {
                let (value, brought) = self.applied_at(f, walk, given, r, c)?;
                values.push(value);
                formats.push(brought);
            }
        }
        Ok((Array::new(rows, columns, values), formats))
    }
}
