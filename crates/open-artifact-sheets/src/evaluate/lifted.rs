//! Several cells where one value goes, worked out cell by cell (lifted), wherever the call is: `=ROWS(LEN(C1:C3))`
//! is 3 and `=SUM(LEN(C1:C3))` adds the lengths up, while at the top of a formula `=LEN(C1:C3)` is #VALUE!, as an
//! operator's array is there. Functions that answer an array (TAKE, SEQUENCE, SPLIT, …) and HYPERLINK are not lifted:
//! several cells for one of their values is #VALUE!.
//!
//! The arrays stretch together as an operator's do (a single row or column across the other's rows or columns);
//! two sides of other different sizes make the whole formula #VALUE!, whatever it is inside (`IFERROR` does not
//! catch it): `=COUNTA(ROUND(A1:A2,A1:A3))` is #VALUE!. (Of an operator they are one #VALUE!:
//! `=COUNTA({1,2}+{1,2,3})` is 1.)
//!
//! IF lifts its test, CHOOSE its position, SWITCH its value and cases, IFS its tests (IFS only inside an argument
//! that takes several cells, a LET's value or a LAMBDA's: `=ISERROR(IFS(A1:A2,1))` is TRUE, where
//! `=ROWS(ISERROR(IFS(A1:A2,1)))` is 2); each cell picks from the
//! arguments beside it (all of them worked out, each stretched to the size of all), and an argument left out is
//! blank. IFERROR and IFNA lift the value given several cells; see `Calculation::lifted_if_error`. Each value brings
//! what the value it picks brings (`=ARRAYFORMULA(IF({FALSE;TRUE},2,DATE(2020,1,1)))` a date's format beneath a 2),
//! and nothing when it is not picked from one (an error of a test, #N/A, …); see `elements`.
//!
//! The first call given several cells for one value tells `readCauseOfError` so (`Several`), once all its arguments
//! are worked out: outside an argument that takes several cells, the function and the first such argument (IF its
//! test, CHOOSE its position and IFERROR its value before the rest are worked out, SWITCH its value after them);
//! inside one, only a call whose arrays do not fit, with no argument named. A function that is not lifted tells its
//! argument wherever it is, and makes the whole formula #VALUE!.

use std::rc::Rc;

use super::elements::Elements;
use super::{same_value, Grid, Operand};
use crate::calculate::{Calculation, Slot};
use crate::coerce;
use crate::formula::Expr;
use crate::functions::{self, Answers, Cells, Description};
use crate::value::{Array, CellError, Value};

/// What the first call in a formula given several cells for one value told: the function and the argument, or
/// (where the cells make no cause) nothing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Several {
    Told { function: &'static str, argument: Option<&'static str> },
    Untold,
}

/// Whether a function given several cells for one value is worked out cell by cell.
pub(super) fn lifts(description: &Description) -> bool {
    description.answers != Answers::AnArray && description.name != "HYPERLINK"
}

/// The size arrays stretch to together: on each side, the one size more than 1 they have; `None` when two have
/// different sizes more than 1 on a side.
pub(super) fn stretched<'a>(arrays: impl Iterator<Item = &'a Array>) -> Option<(usize, usize)> {
    let size = |m: usize, n: usize| match (m, n) {
        (1, n) => Some(n),
        (m, 1) => Some(m),
        (m, n) if m == n => Some(m),
        _ => None,
    };
    arrays.into_iter().try_fold((1, 1), |(rows, columns), a| Some((size(rows, a.rows())?, size(columns, a.columns())?)))
}

/// A stretched array's value at (row, column), of a size `stretched` gave.
pub(super) fn stretched_at(a: &Array, r: usize, c: usize) -> Value {
    let rr = if a.rows() == 1 { 0 } else { r };
    let cc = if a.columns() == 1 { 0 } else { c };
    a.get(rr, cc).clone()
}

/// A grid as an array: one value is an array of one.
pub(super) fn as_array(grid: Grid) -> Rc<Array> {
    match grid {
        Grid::One(v) => Rc::new(Array::single(v)),
        Grid::Many(a) => a,
    }
}

impl Calculation {
    /// ISFORMULA given several cells: of a range, whether each holds a formula; of an array, #VALUE! for each.
    pub(super) fn is_formula_cells(&self, cells: &Cells) -> Operand {
        let (rows, columns) = (cells.array.rows(), cells.array.columns());
        let values = match cells.place {
            Some(p) => (p.top..=p.bottom)
                .flat_map(|r| (p.left..=p.right).map(move |c| (r, c)))
                .map(|at| Value::Boolean(matches!(self.grids[p.sheet].slots.get(&at), Some(Slot::Formula(_)))))
                .collect(),
            None => vec![Value::Error(CellError::Value); rows * columns],
        };
        Operand::Values(Rc::new(Array::new(rows, columns, values)))
    }

    /// An expression worked out as an argument that takes several cells is (see `Calculation::lifting`).
    pub(crate) fn lifting_eval(&mut self, f: usize, expr: &Expr) -> Operand {
        let lifting = std::mem::replace(&mut self.lifting, true);
        let operand = self.eval(f, expr);
        self.lifting = lifting;
        operand
    }

    /// What a call given several cells for one value tells, unless one before it told something.
    pub(super) fn tell(&mut self, function: &'static str, argument: Option<&'static str>) {
        self.several.get_or_insert(Several::Told { function, argument });
    }

    /// A call given several cells for its first argument tells so, outside an argument that takes several cells.
    pub(super) fn tell_first(&mut self, function: &'static str) {
        if !self.lifting {
            let argument = functions::description_of(function).and_then(|d| d.arguments.first()).map(|a| a.name);
            self.several.get_or_insert(Several::Told { function, argument });
        }
    }

    /// The formula being worked out is #VALUE!, whatever this is inside.
    pub(super) fn abort(&mut self) -> Operand {
        self.aborted = true;
        self.brought = None;
        self.link = None;
        Operand::error(CellError::Value)
    }

    /// An argument of a lifted IF, CHOOSE, SWITCH or IFS as an array, with what its values bring; left out, blank.
    fn lifted_argument(&mut self, f: usize, expr: Option<&Expr>) -> (Rc<Array>, Elements) {
        match expr {
            None | Some(Expr::Missing) => (Rc::new(Array::single(Value::Blank)), Elements::One(None)),
            Some(e) => {
                let operand = self.eval(f, e);
                let brought = self.brought.take();
                let elements = self.elements(&operand, &brought);
                let grid = self.grid(operand);
                (as_array(grid), elements)
            }
        }
    }

    /// Arrays (each with what its values bring) worked out cell by cell: `pick` gives, of each cell's values in the
    /// order given, which one is the answer there, or the answer it makes. An array of values, each bringing what
    /// the value picked brings (see `elements`), which is no link.
    fn picked(&mut self, arrays: &[(Rc<Array>, Elements)], pick: impl Fn(&[Value]) -> Result<usize, Value>) -> Operand {
        let Some((rows, columns)) = stretched(arrays.iter().map(|(a, _)| a.as_ref())) else {
            return self.abort();
        };
        let mut values = Vec::with_capacity(rows * columns);
        let mut formats = Vec::with_capacity(rows * columns);
        let mut cell = Vec::with_capacity(arrays.len());
        for r in 0..rows {
            for c in 0..columns {
                cell.clear();
                cell.extend(arrays.iter().map(|(a, _)| stretched_at(a, r, c)));
                match pick(&cell) {
                    Ok(i) => {
                        values.push(cell[i].clone());
                        formats.push(self.element(&arrays[i].1, r, c));
                    }
                    Err(made) => {
                        values.push(made);
                        formats.push(None);
                    }
                }
            }
        }
        self.link = None;
        let array = Rc::new(Array::new(rows, columns, values));
        self.keep_formats(&array, formats);
        Operand::Values(array)
    }

    /// IF given several tests: each test picks the value beside it (FALSE when the third argument is not given).
    pub(super) fn lifted_if(&mut self, f: usize, tests: Rc<Array>, arguments: &[Expr]) -> Operand {
        let yes = self.lifted_argument(f, arguments.get(1));
        let no = match arguments.get(2) {
            None => (Rc::new(Array::single(Value::Boolean(false))), Elements::One(None)),
            Some(e) => self.lifted_argument(f, Some(e)),
        };
        self.picked(&[(tests, Elements::One(None)), yes, no], |cell| match coerce::to_boolean(&cell[0]) {
            Err(e) => Err(Value::Error(e)),
            Ok(true) => Ok(1),
            Ok(false) => Ok(2),
        })
    }

    /// CHOOSE given several positions: each picks its choice (cut toward zero; out of range #VALUE!).
    pub(super) fn lifted_choose(&mut self, f: usize, positions: Rc<Array>, arguments: &[Expr]) -> Operand {
        let mut arrays = vec![(positions, Elements::One(None))];
        for e in &arguments[1..] {
            arrays.push(self.lifted_argument(f, Some(e)));
        }
        let locale = self.locale;
        let choices = arguments.len() - 1;
        self.picked(&arrays, |cell| match coerce::to_number(&cell[0], locale) {
            Err(e) => Err(Value::Error(e)),
            Ok(n) => {
                let n = n.trunc();
                if n < 1.0 || n > choices as f64 {
                    Err(Value::Error(CellError::Value))
                } else {
                    Ok(n as usize)
                }
            }
        })
    }

    /// SWITCH whose value or a case is several cells: each cell's value is matched against its cases in order
    /// (an error in either is the cell's answer), else the default, else #N/A. The arrays are the value, then the
    /// cases and what each gives, then the default.
    pub(super) fn lifted_switch(&mut self, f: usize, mut arrays: Vec<Rc<Array>>, arguments: &[Expr]) -> Operand {
        let rest = &arguments[1..];
        let pairs = rest.len() / 2;
        // The value and the cases are worked out; what each case gives and the default go in beside them.
        let mut all = Vec::with_capacity(arguments.len());
        all.push((arrays.remove(0), Elements::One(None)));
        for (i, case) in arrays.into_iter().enumerate() {
            all.push((case, Elements::One(None)));
            all.push(self.lifted_argument(f, rest.get(2 * i + 1)));
        }
        let default = rest.len() % 2 == 1;
        if default {
            all.push(self.lifted_argument(f, rest.last()));
        }
        // Outside an argument that takes several cells, a value of several cells tells so once all are worked out; a
        // case of several cells makes no cause.
        if !self.lifting {
            if all[0].0.is_single() {
                self.several.get_or_insert(Several::Untold);
            } else {
                self.tell_first("SWITCH");
            }
        }
        self.picked(&all, |cell| {
            if let Value::Error(e) = &cell[0] {
                return Err(Value::Error(*e));
            }
            for i in 0..pairs {
                let case = &cell[1 + 2 * i];
                if let Value::Error(e) = case {
                    return Err(Value::Error(*e));
                }
                if same_value(&cell[0], case) {
                    return Ok(2 + 2 * i);
                }
            }
            if default {
                Ok(cell.len() - 1)
            } else {
                Err(Value::Error(CellError::NotAvailable))
            }
        })
    }

    /// IFS with a test of several cells: each cell's tests in order pick the value beside the first that is TRUE (an
    /// error, or a test that is not TRUE or FALSE, is the cell's answer), else #N/A. The arrays are the tests.
    pub(super) fn lifted_ifs(&mut self, f: usize, tests: Vec<Rc<Array>>, arguments: &[Expr]) -> Operand {
        let mut all = Vec::with_capacity(arguments.len());
        for (i, test) in tests.into_iter().enumerate() {
            all.push((test, Elements::One(None)));
            all.push(self.lifted_argument(f, arguments.get(2 * i + 1)));
        }
        self.picked(&all, |cell| {
            for (i, pair) in cell.chunks(2).enumerate() {
                match coerce::to_boolean(&pair[0]) {
                    Err(e) => return Err(Value::Error(e)),
                    Ok(true) => return Ok(2 * i + 1),
                    Ok(false) => {}
                }
            }
            Err(Value::Error(CellError::NotAvailable))
        })
    }

    /// IFERROR (`only_not_available` false) or IFNA given several cells: a range, an array worked out cell by cell,
    /// or an array that spills with an error it catches in it (one that has none is the answer as it came). Each
    /// cell it catches is the second argument's at that cell (blank when left out), the two stretched together; the
    /// answer spills when the arrays that spill among them are of its size (`{1,#N/A}` with `{5;6}`, or `{1,#N/A;3,4}`
    /// with `A1:A2`), and is an array worked out cell by cell when not (`{1,#N/A}` with `A1:A2`).
    pub(super) fn lifted_if_error(
        &mut self,
        f: usize,
        value: Rc<Array>,
        value_brought: Elements,
        spills: bool,
        arguments: &[Expr],
        only_not_available: bool,
    ) -> Operand {
        let (instead, instead_brought, instead_spills) = match arguments.get(1) {
            None | Some(Expr::Missing) => (Rc::new(Array::single(Value::Blank)), Elements::One(None), false),
            Some(e) => {
                let operand = self.eval(f, e);
                let brought = self.brought.take();
                let elements = self.elements(&operand, &brought);
                let spills = matches!(&operand, Operand::Array(a) if !a.is_single());
                let grid = self.grid(operand);
                (as_array(grid), elements, spills)
            }
        };
        let arrays = [(value, value_brought), (instead, instead_brought)];
        let Some(size) = stretched(arrays.iter().map(|(a, _)| a.as_ref())) else {
            return self.abort();
        };
        let spilling: Vec<&Array> = [(spills, &arrays[0].0), (instead_spills, &arrays[1].0)]
            .into_iter()
            .filter(|(s, _)| *s)
            .map(|(_, a)| a.as_ref())
            .collect();
        let spills = !spilling.is_empty() && stretched(spilling.into_iter()) == Some(size);
        let caught = |v: &Value| match v {
            Value::Error(e) => !only_not_available || *e == CellError::NotAvailable,
            _ => false,
        };
        let answer = self.picked(&arrays, |cell| Ok(if caught(&cell[0]) { 1 } else { 0 }));
        match answer {
            Operand::Values(a) if spills => Operand::Array(a),
            other => other,
        }
    }
}
