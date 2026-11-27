//! Working out one formula's expression.
//!
//! What an expression works out to is an [`Operand`]: one value, a range (a place on a sheet, read when needed),
//! or an array. Arrays come in two kinds, and the difference shows at the top of a formula: an array written in
//! the formula (`{1,2}`) or answered by a function that answers arrays (TRANSPOSE, FILTER, …) spills there, while
//! one worked out cell by cell by an operator (`A1:A3*2`) or taken out of an argument (INDEX, XLOOKUP) must be one
//! value there and is #VALUE! when it is more. In a function's argument that takes several cells, both are read
//! cell by cell: `SUM(A1:A3*2)`.
//!
//! IF, IFERROR, IFNA, IFS, SWITCH, CHOOSE and LET are worked out here: they answer one of their arguments as it came
//! (a range stays a range), or, given several cells where they pick by one value, pick cell by cell (`lifted`). An
//! argument left out that they answer is blank.
//!
//! Working an expression out also leaves what number format it brings (`Calculation::brought`, see [`brought`]).

pub(crate) mod lambda;
mod elements;
mod lifted;
pub(crate) use lifted::Several;
pub(crate) mod pivot;

use std::rc::Rc;

use crate::brought::{self, Brought};
use crate::calculate::{Calculation, Slot, SpillFormats};
use crate::coerce;
use crate::formula::{BinaryOp, Expr, UnaryOp};
use crate::functions::{self, Arg, CallContext, Cells, ErrorInIt, FunctionId, Shape, Takes};
use crate::locale::Locale;
use crate::number_format::Kind;
use crate::value::{Array, CellError, Value};

/// A rectangle of cells on a sheet, by position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Place {
    pub sheet: usize,
    pub top: usize,
    pub left: usize,
    pub bottom: usize,
    pub right: usize,
}

impl Place {
    pub fn rows(&self) -> usize {
        self.bottom - self.top + 1
    }

    pub fn columns(&self) -> usize {
        self.right - self.left + 1
    }

    pub fn is_single(&self) -> bool {
        self.top == self.bottom && self.left == self.right
    }

    /// Part of this place: `rows` × `columns` from (`top`, `left`), counted from its corner.
    pub fn part(&self, top: usize, left: usize, rows: usize, columns: usize) -> Place {
        Place {
            sheet: self.sheet,
            top: self.top + top,
            left: self.left + left,
            bottom: self.top + top + rows - 1,
            right: self.left + left + columns - 1,
        }
    }
}

/// What an expression works out to.
#[derive(Clone, Debug)]
pub enum Operand {
    Value(Value),
    Range(Place),
    /// An array that spills at the top of a formula.
    Array(Rc<Array>),
    /// An array worked out cell by cell, or part of an argument: at the top of a formula, only one value.
    Values(Rc<Array>),
}

impl Operand {
    pub fn error(e: CellError) -> Operand {
        Operand::Value(Value::Error(e))
    }
}

/// One value, or an array, as operators work on them.
enum Grid {
    One(Value),
    Many(Rc<Array>),
}

impl Calculation {
    /// What an expression works out to; what it brings is left in `self.brought`.
    pub(crate) fn eval(&mut self, f: usize, expr: &Expr) -> Operand {
        self.brought = None;
        self.link = None;
        match expr {
            Expr::Number(n) => Operand::Value(Value::number(*n)),
            Expr::Text(s) => Operand::Value(Value::Text(s.clone())),
            Expr::Boolean(b) => Operand::Value(Value::Boolean(*b)),
            Expr::Error(e) => Operand::error(*e),
            Expr::Missing => Operand::Value(Value::Blank),
            Expr::Reference(i) => match self.formulas[f].places.get(*i).copied().flatten() {
                Some(place) => {
                    self.brought = self.range_brought(place);
                    Operand::Range(place)
                }
                None => Operand::error(self.gone_or_not_held(f, *i)),
            },
            Expr::Name(name) => match self.scopes.iter().rev().find(|(n, ..)| n == name) {
                Some((_, operand, brought, link)) => {
                    let operand = operand.clone();
                    self.brought = brought.clone();
                    self.link = link.clone();
                    operand
                }
                None => Operand::error(CellError::Name),
            },
            Expr::Array(a) => Operand::Array(a.clone()),
            Expr::Call { name, arguments, .. } if name.as_ref() == "PIVOT" => self.pivot(f, arguments),
            Expr::Call { function: None, .. } => Operand::error(CellError::Name),
            Expr::Call { function: Some(id), arguments, index, .. } => self.call(f, *id, arguments, *index),
            Expr::Unary(op, operand) => {
                let x = self.eval(f, operand);
                // A sign keeps what the number brings, but a minus a date's or a time's; a percent sign keeps none.
                let keeps = |b: &Brought| match op {
                    UnaryOp::Plus => true,
                    UnaryOp::Negate => !matches!(b.kind, Kind::Date | Kind::Time | Kind::DateAndTime),
                    UnaryOp::Percent => false,
                };
                let brought = self.brought.take();
                let elements = self.elements(&x, &brought);
                let grid = self.grid(x);
                self.brought = brought.filter(keeps);
                self.link = None;
                let locale = self.locale;
                let operand = self.map(grid, |v| unary(*op, v, locale));
                if let Operand::Values(a) = &operand {
                    self.bring_each(a, &[&elements], |at| at[0].clone().filter(keeps));
                }
                operand
            }
            Expr::Binary(op, a, b) => {
                let x = self.eval(f, a);
                let p = self.brought.take();
                let ex = self.elements(&x, &p);
                let x = self.grid(x);
                let y = self.eval(f, b);
                let q = self.brought.take();
                let ey = self.elements(&y, &q);
                let y = self.grid(y);
                self.brought = brought::of_operator(*op, p.as_ref(), q.as_ref());
                self.link = None;
                let operand = broadcast(x, y, |p, q| binary(*op, p, q, self.locale));
                if let Operand::Values(a) = &operand {
                    self.bring_each(a, &[&ex, &ey], |at| brought::of_operator(*op, at[0].as_ref(), at[1].as_ref()));
                }
                operand
            }
        }
    }

    fn grid(&mut self, operand: Operand) -> Grid {
        match operand {
            Operand::Value(v) => Grid::One(v),
            Operand::Range(place) if place.is_single() => Grid::One(self.cell_value(place.sheet, place.top, place.left)),
            Operand::Range(place) => Grid::Many(Rc::new(self.range_values(place))),
            Operand::Array(a) | Operand::Values(a) if a.is_single() => Grid::One(a.get(0, 0).clone()),
            Operand::Array(a) | Operand::Values(a) => Grid::Many(a),
        }
    }

    fn map(&mut self, grid: Grid, f: impl Fn(&Value) -> Value) -> Operand {
        match grid {
            Grid::One(v) => Operand::Value(f(&v)),
            Grid::Many(a) => Operand::Values(Rc::new(a.map(f))),
        }
    }

    /// An operand as one value: a range or array of one cell is that cell's value; of more, #VALUE!.
    pub(crate) fn one_value(&mut self, operand: Operand) -> Value {
        match self.grid(operand) {
            Grid::One(v) => v,
            Grid::Many(_) => Value::Error(CellError::Value),
        }
    }

    /// An operand's cells, for an argument that takes several.
    fn cells(&mut self, operand: Operand) -> Arg {
        match operand {
            Operand::Value(v) => Arg::Value(v),
            Operand::Range(place) => Arg::Cells(Cells { array: Rc::new(self.range_values(place)), place: Some(place) }),
            Operand::Array(a) | Operand::Values(a) => Arg::Cells(Cells { array: a, place: None }),
        }
    }

    /// The error of a reference with no place: #N/A when it reads records not held, #REF! when its cells are gone.
    fn gone_or_not_held(&self, f: usize, i: usize) -> CellError {
        match self.formulas[f].records_not_held.get(i) {
            Some(true) => CellError::NotAvailable,
            _ => CellError::Reference,
        }
    }

    fn place_of(&mut self, f: usize, expr: &Expr) -> Arg {
        let operand = match expr {
            Expr::Reference(i) => match self.formulas[f].places.get(*i).copied().flatten() {
                Some(place) => Operand::Range(place),
                None => Operand::error(self.gone_or_not_held(f, *i)),
            },
            other => self.lifting_eval(f, other),
        };
        match operand {
            Operand::Range(place) => Arg::Place(Shape { rows: place.rows(), columns: place.columns(), place: Some(place) }),
            Operand::Array(a) | Operand::Values(a) => Arg::Place(Shape { rows: a.rows(), columns: a.columns(), place: None }),
            Operand::Value(v) => Arg::Value(v),
        }
    }

    fn call(&mut self, f: usize, id: FunctionId, arguments: &[Expr], index: u32) -> Operand {
        // A call that makes the whole formula #VALUE! tells so (no argument named), unless a call inside it told
        // something first.
        let aborted = self.aborted;
        let operand = crate::told::in_a_call(|| self.call_of(f, id, arguments, index));
        if self.aborted && !aborted {
            self.tell(id.description().name, None);
        }
        operand
    }

    /// A call with a number of arguments the function does not take is #N/A, its arguments worked out all the same:
    /// one for one value (by its position) given several cells makes the whole formula #VALUE! (`=LEN(A1:A2,1)`,
    /// `=IF(A1:A2)`), where one past those the function takes does not (`=LEN(A1,A1:A2)` is #N/A).
    fn miscounted(&mut self, f: usize, description: &'static functions::Description, arguments: &[Expr]) -> Operand {
        let mut several = None;
        for (i, expr) in arguments.iter().enumerate() {
            let slot = description.arguments.get(i);
            let operand = match slot.map(|a| a.takes) {
                Some(Takes::AName) => continue,
                Some(Takes::SeveralCells | Takes::OnlyThePlace) => self.lifting_eval(f, expr),
                _ => self.eval(f, expr),
            };
            if let (Some(slot), Grid::Many(_)) = (slot.filter(|a| a.takes == Takes::OneValue), self.grid(operand)) {
                several.get_or_insert(slot.name);
            }
        }
        self.brought = None;
        self.link = None;
        match several {
            Some(argument) => {
                self.tell(description.name, Some(argument));
                self.abort()
            }
            None => Operand::error(CellError::NotAvailable),
        }
    }

    fn call_of(&mut self, f: usize, id: FunctionId, arguments: &[Expr], index: u32) -> Operand {
        let description = id.description();
        let Some(slots) = functions::match_arguments(description, arguments.len()) else {
            return self.miscounted(f, description, arguments);
        };
        match description.name {
            "IF" => return self.if_(f, arguments),
            "IFERROR" => return self.if_error(f, arguments, false),
            "IFNA" => return self.if_error(f, arguments, true),
            "IFS" => return self.ifs(f, arguments),
            "SWITCH" => return self.switch(f, arguments),
            "CHOOSE" => return self.choose(f, arguments),
            "LET" => return self.let_(f, arguments),
            "LAMBDA" => return self.lambda_alone(arguments),
            name => {
                if let Some(walk) = lambda::Walk::of(name) {
                    return self.apply_lambda(f, walk, arguments);
                }
            }
        }
        let mut args = Vec::with_capacity(arguments.len());
        let mut brought: Vec<Option<Brought>> = Vec::with_capacity(arguments.len());
        // Arguments for one value given several cells, where that works cell by cell.
        let mut lifted: Vec<(usize, Rc<Array>, elements::Elements)> = Vec::new();
        // These read their numbers before they look at errors in their ranges (not an error written as one value).
        let reads_numbers_first = matches!(description.name, "PROB" | "T.TEST" | "TTEST");
        let mut error_in_range = None;
        // Every argument is worked out: the first error that is the answer (by its position) is, unless one after it
        // is several cells for one value, which lifts the call (each cell's answer that error, or an error before
        // it), or for a function that is not lifted makes the whole formula #VALUE! (`=SEQUENCE(1/0,A1:A2)`).
        let mut early: Option<(usize, CellError)> = None;
        let mut refused = None;
        for (i, (expr, &slot)) in arguments.iter().zip(&slots).enumerate() {
            brought.push(None);
            if matches!(expr, Expr::Missing) {
                // Cells whose errors may be passed over must be given.
                if slot.takes == Takes::SeveralCells && slot.error_in_it == ErrorInIt::MayBePassedOver {
                    early.get_or_insert((i, CellError::Value));
                }
                args.push(Arg::Missing);
                continue;
            }
            let answers_errors = slot.error_in_it == ErrorInIt::IsTheAnswer;
            let arg = match slot.takes {
                Takes::OneValue => {
                    let operand = self.eval(f, expr);
                    brought[i] = self.brought.take();
                    let elements = self.elements(&operand, &brought[i]);
                    // Several cells where one value goes are worked out cell by cell (`lifted`), or for a function
                    // that is not make the whole formula #VALUE!.
                    let v = match self.grid(operand) {
                        Grid::One(v) => v,
                        Grid::Many(a) if lifted::lifts(description) => {
                            lifted.push((i, a, elements));
                            args.push(Arg::Missing);
                            continue;
                        }
                        Grid::Many(_) => {
                            refused.get_or_insert(slot.name);
                            args.push(Arg::Missing);
                            continue;
                        }
                    };
                    if early.is_none() {
                        if let (Value::Error(e), true) = (&v, answers_errors) {
                            early = Some((i, *e));
                        } else if let Err(e) = functions::check_early(id, i, &v, self.locale) {
                            early = Some((i, e));
                        }
                    }
                    Arg::Value(v)
                }
                Takes::SeveralCells => {
                    let operand = match self.lifting_eval(f, expr) {
                        // A value a LAMBDA's name is given, picked from an array, is of its value's type.
                        Operand::Array(a) if description.name == "TYPE" && self.picked.contains_key(&Rc::as_ptr(&a)) => {
                            Operand::Value(a.get(0, 0).clone())
                        }
                        operand => operand,
                    };
                    brought[i] = self.brought.take();
                    let arg = self.cells(operand);
                    if early.is_none() {
                        early = self.early_in_cells(id, i, &arg, slot, reads_numbers_first, &mut error_in_range);
                    }
                    arg
                }
                Takes::OnlyThePlace => self.place_of(f, expr),
                Takes::AName => Arg::Missing,
            };
            args.push(arg);
        }
        if let Some(argument) = refused {
            self.tell(description.name, Some(argument));
            return self.abort();
        }
        if let Some((_, e)) = early {
            if lifted.is_empty() {
                return Operand::error(e);
            }
            self.tell_lifted(description, &lifted, &slots);
            return self.lifted_call(f, id, index, args, &lifted, &brought, &slots, early);
        }
        if description.name == "SUBTOTAL" && !self.subtotal_ranges_are_readable(&args[1..]) {
            return Operand::error(CellError::Value);
        }
        if description.name == "AGGREGATE" && !self.aggregate_ranges_are_readable(&args) {
            return Operand::error(CellError::Value);
        }
        if let Some(e) = error_in_range {
            return Operand::error(e);
        }
        // ISFORMULA asks what one cell holds, which the function is not told.
        if description.name == "ISFORMULA" {
            if let Some(Arg::Cells(Cells { place: Some(p), .. })) = args.first() {
                if p.top == p.bottom && p.left == p.right {
                    let held = self.grids[p.sheet].slots.get(&(p.top, p.left));
                    return Operand::Value(Value::Boolean(matches!(held, Some(Slot::Formula(_)))));
                }
            }
            if let Some(Arg::Cells(cells)) = args.first() {
                if !cells.array.is_single() {
                    self.tell_first("ISFORMULA");
                    return self.is_formula_cells(cells);
                }
            }
        }
        if !lifted.is_empty() {
            self.tell_lifted(description, &lifted, &slots);
            return self.lifted_call(f, id, index, args, &lifted, &brought, &slots, None);
        }
        let cell = {
            let fc = &self.formulas[f];
            Place { sheet: fc.sheet, top: fc.row, left: fc.column, bottom: fc.row, right: fc.column }
        };
        let now = self.now;
        let locale = self.locale;
        let mut random = || self.random(f, index);
        let mut cx = CallContext { cell, now, random: &mut random, locale, sources: None };
        let operand = match functions::call(id, &args, &mut cx) {
            Ok(operand) => operand,
            Err(e) => Operand::error(e),
        };
        let sources = cx.sources.take();
        // ROW and COLUMN of several rows or columns answer several cells.
        if matches!(description.name, "ROW" | "COLUMN") && matches!(&operand, Operand::Values(a) if !a.is_single()) {
            self.tell_first(description.name);
        }
        // A function that picks cells of its arguments (SORT, FILTER, …) gives each value what its cell brings.
        let formats: Option<Vec<Option<Brought>>> = match (&operand, sources) {
            (Operand::Value(_) | Operand::Array(_) | Operand::Values(_), Some(from)) => Some(
                from.iter().map(|s| s.and_then(|(k, r, c)| self.brought_in(&args[k], &brought[k], r, c))).collect(),
            ),
            _ => None,
        };
        // A function that answers part of a range (INDEX, XLOOKUP) brings what its first cell brings; one that picks
        // cells, what its first value brings.
        self.brought = match (&operand, formats) {
            (Operand::Range(place), _) => self.cell_brought(place.sheet, place.top, place.left),
            (_, Some(formats)) => {
                let first = formats.first().cloned().flatten();
                if let Operand::Array(a) | Operand::Values(a) = &operand {
                    self.array_formats.insert(Rc::as_ptr(a), (a.clone(), SpillFormats::Dense(formats.into())));
                }
                first
            }
            _ => {
                let first = match args.first() {
                    Some(Arg::Value(Value::Number(n))) => Some(*n),
                    _ => None,
                };
                brought::of_call(description.name, &brought, first, self.locale.pattern_of_a_time_of_day)
            }
        };
        // A HYPERLINK is its link; what any other function answers is none.
        self.link = match (description.name, args.first()) {
            ("HYPERLINK", Some(url)) => url.text(self.locale).ok().filter(|url| !url.is_empty()),
            _ => None,
        };
        operand
    }

    /// The first error an argument that takes several cells makes the answer: an error written as one value (not a
    /// range or an array) even where errors in cells may be passed over (COUNTIF(1/0, …), VLOOKUP(1, #N/A, 1)); the
    /// first error in cells whose errors are the answer (for PROB and T.TEST, after their numbers are read); one
    /// value it does not read.
    fn early_in_cells(
        &self,
        id: FunctionId,
        i: usize,
        arg: &Arg,
        slot: &functions::Argument,
        reads_numbers_first: bool,
        error_in_range: &mut Option<CellError>,
    ) -> Option<(usize, CellError)> {
        if let (Arg::Value(Value::Error(e)), ErrorInIt::MayBePassedOver) = (arg, slot.error_in_it) {
            return Some((i, *e));
        }
        if slot.error_in_it == ErrorInIt::IsTheAnswer {
            let first_error = match arg {
                Arg::Value(v) => v.error(),
                Arg::Cells(cells) => cells.values().find_map(Value::error),
                _ => None,
            };
            if let Some(e) = first_error {
                if !reads_numbers_first || matches!(arg, Arg::Value(_)) {
                    return Some((i, e));
                }
                *error_in_range = error_in_range.or(Some(e));
            }
        }
        match arg {
            Arg::Value(v) => functions::check_early(id, i, v, self.locale).err().map(|e| (i, e)),
            _ => None,
        }
    }

    /// A call lifted outside an argument that takes several cells tells so, naming the first argument lifted.
    fn tell_lifted(
        &mut self,
        description: &functions::Description,
        lifted: &[(usize, Rc<Array>, elements::Elements)],
        slots: &[&functions::Argument],
    ) {
        if !self.lifting {
            self.tell(description.name, Some(slots[lifted[0].0].name));
        }
    }

    /// A call given several cells where it reads one value (see `lifted`): the function is called cell by cell, the
    /// arrays stretching together, and answers the array of what each call gives. `=ARRAYFORMULA(LEN(C1:C3))` spills
    /// 3 lengths and `=SUM(LEN(C1:C3))` adds them up, where `=LEN(C1:C3)` is #VALUE!. An error that is the answer in
    /// an argument that is not lifted (`early`) is each cell's, unless a lifted argument before it has one there.
    #[allow(clippy::too_many_arguments)]
    fn lifted_call(
        &mut self,
        f: usize,
        id: FunctionId,
        index: u32,
        args: Vec<Arg>,
        lifted: &[(usize, Rc<Array>, elements::Elements)],
        brought: &[Option<Brought>],
        slots: &[&functions::Argument],
        early: Option<(usize, CellError)>,
    ) -> Operand {
        let Some((rows, columns)) = lifted::stretched(lifted.iter().map(|(_, a, _)| a.as_ref())) else {
            return self.abort();
        };
        let cell = {
            let fc = &self.formulas[f];
            Place { sheet: fc.sheet, top: fc.row, left: fc.column, bottom: fc.row, right: fc.column }
        };
        let (now, locale) = (self.now, self.locale);
        let mut values = Vec::with_capacity(rows * columns);
        let mut formats = Vec::with_capacity(rows * columns);
        let mut at = brought.to_vec();
        let name = id.description().name;
        let time_of_day = self.locale.pattern_of_a_time_of_day;
        let mut one = args;
        for r in 0..rows {
            for c in 0..columns {
                let mut answer = None;
                for (i, _, elements) in lifted {
                    at[*i] = self.element(elements, r, c);
                }
                for (i, a, _) in lifted {
                    if let (Some((k, e)), None) = (early, &answer) {
                        if k < *i {
                            answer = Some(Value::Error(e));
                        }
                    }
                    let v = lifted::stretched_at(a, r, c);
                    let checked = match (&v, slots[*i].error_in_it == ErrorInIt::IsTheAnswer) {
                        (Value::Error(e), true) => Err(*e),
                        _ => functions::check_early(id, *i, &v, locale),
                    };
                    if let (Err(e), None) = (checked, &answer) {
                        answer = Some(Value::Error(e));
                    }
                    one[*i] = Arg::Value(v);
                }
                let value = match answer.or(early.map(|(_, e)| Value::Error(e))) {
                    Some(e) => e,
                    None if !self.total_ranges_are_readable(id.description().name, &one) => Value::Error(CellError::Value),
                    None => {
                        let mut random = || self.random(f, index);
                        let mut cx = CallContext { cell, now, random: &mut random, locale, sources: None };
                        let operand = functions::call(id, &one, &mut cx).unwrap_or_else(Operand::error);
                        self.one_value(operand)
                    }
                };
                values.push(value);
                // Each value brings what the call makes of what its arguments there bring.
                let first = match one.first() {
                    Some(Arg::Value(Value::Number(n))) => Some(*n),
                    _ => None,
                };
                formats.push(brought::of_call(name, &at, first, time_of_day));
            }
        }
        self.link = None;
        let array = Rc::new(Array::new(rows, columns, values));
        self.keep_formats(&array, formats);
        Operand::Values(array)
    }

    /// What the cell (row, column) of an argument brings to a function that picks it: a range's cell what it brings,
    /// a value of an array picked so what it was given, one value what its expression brings.
    fn brought_in(&mut self, arg: &Arg, expression: &Option<Brought>, r: usize, c: usize) -> Option<Brought> {
        match arg {
            Arg::Cells(Cells { place: Some(p), .. }) => self.cell_brought(p.sheet, p.top + r, p.left + c),
            Arg::Cells(Cells { array, place: None }) => {
                self.array_formats.get(&Rc::as_ptr(array))?.1.get(array.columns(), (r, c)).cloned()
            }
            Arg::Value(_) => expression.clone(),
            _ => None,
        }
    }

    /// SUBTOTAL totals ranges only (not arrays or values), and none with a formula that calls SUBTOTAL in it.
    fn subtotal_ranges_are_readable(&self, ranges: &[Arg]) -> bool {
        ranges.iter().all(|arg| match arg {
            Arg::Cells(Cells { place: Some(place), .. }) => self.nested_subtotal_in(*place).is_none(),
            _ => false,
        })
    }

    /// The same checks for one cell of a lifted call (`=ARRAYFORMULA(SUBTOTAL({9,1},I1:I3))`), whose function is
    /// known only by its id there.
    fn total_ranges_are_readable(&self, name: &str, args: &[Arg]) -> bool {
        match name {
            "SUBTOTAL" => self.subtotal_ranges_are_readable(args.get(1..).unwrap_or(&[])),
            "AGGREGATE" => self.aggregate_ranges_are_readable(args),
            _ => true,
        }
    }

    /// AGGREGATE with a skip code below 4 reads no range with a formula that calls SUBTOTAL or AGGREGATE in it
    /// (`=AGGREGATE(9,0,I1)`, I1 holding `=SUBTOTAL(9,B1:B2)`, is #VALUE!; `=AGGREGATE(9,4,I1)` totals it). The
    /// ranges are those it totals, or the one it takes a position or fraction of (code 14 to 19).
    fn aggregate_ranges_are_readable(&self, args: &[Arg]) -> bool {
        let number = |arg: Option<&Arg>| match arg {
            Some(Arg::Value(v)) => coerce::to_number(v, self.locale).ok().map(f64::trunc),
            _ => None,
        };
        let (Some(code), Some(skip)) = (number(args.first()), number(args.get(1))) else {
            return true;
        };
        if !(0.0..4.0).contains(&skip) {
            return true;
        }
        let ranges = if code >= 14.0 { args.get(2..3).unwrap_or(&[]) } else { args.get(2..).unwrap_or(&[]) };
        ranges.iter().all(|arg| match arg {
            Arg::Cells(Cells { place: Some(place), .. }) => self.nested_subtotal_in(*place).is_none(),
            _ => true,
        })
    }

    /// The first cell of a range, row by row, whose formula calls SUBTOTAL or AGGREGATE.
    pub(crate) fn nested_subtotal_in(&self, place: Place) -> Option<(usize, usize)> {
        self.grids[place.sheet]
            .slots
            .range((place.top, 0)..=(place.bottom, usize::MAX))
            .find(|(&(_, column), slot)| match slot {
                Slot::Formula(i) => (place.left..=place.right).contains(&column) && self.formulas[*i].calls_subtotal,
                _ => false,
            })
            .map(|(&cell, _)| cell)
    }

    /// An argument that may be left out, as it came; left out, `default` (which brings nothing).
    fn as_it_came(&mut self, f: usize, expr: Option<&Expr>, default: Value) -> Operand {
        match expr {
            None | Some(Expr::Missing) => {
                self.brought = None;
                self.link = None;
                Operand::Value(default)
            }
            Some(e) => self.eval(f, e),
        }
    }

    fn if_(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        let test = self.eval(f, &arguments[0]);
        let test = match self.grid(test) {
            Grid::Many(tests) => {
                self.tell_first("IF");
                return self.lifted_if(f, tests, arguments);
            }
            Grid::One(v) => v,
        };
        match coerce::to_boolean(&test) {
            Err(e) => Operand::error(e),
            Ok(true) => self.as_it_came(f, arguments.get(1), Value::Blank),
            Ok(false) => match arguments.get(2) {
                None => {
                    self.brought = None;
                    self.link = None;
                    Operand::Value(Value::Boolean(false))
                }
                Some(e) => self.as_it_came(f, Some(e), Value::Blank),
            },
        }
    }

    /// IFERROR (`only_not_available` false) and IFNA.
    fn if_error(&mut self, f: usize, arguments: &[Expr], only_not_available: bool) -> Operand {
        let caught = |v: &Value| match v {
            Value::Error(e) => !only_not_available || *e == CellError::NotAvailable,
            _ => false,
        };
        let value = self.as_it_came(f, arguments.first(), Value::Blank);
        let value = match value {
            Operand::Range(place) if place.is_single() => Operand::Value(self.cell_value(place.sheet, place.top, place.left)),
            // Several cells that do not spill: IFERROR tells so, before the rest is worked out (IFNA does not).
            Operand::Range(place) => {
                if !only_not_available {
                    self.tell_first("IFERROR");
                }
                let values = Rc::new(self.range_values(place));
                // A range with no error to catch is the answer as it came.
                if !values.values().any(caught) {
                    return Operand::Range(place);
                }
                self.brought = None;
                return self.lifted_if_error(f, values, elements::Elements::Range(place), false, arguments, only_not_available);
            }
            Operand::Values(a) if !a.is_single() => {
                if !only_not_available {
                    self.tell_first("IFERROR");
                }
                let brought = self.brought.take();
                let elements = self.elements(&Operand::Values(a.clone()), &brought);
                return self.lifted_if_error(f, a, elements, false, arguments, only_not_available);
            }
            // An array that spills with no error to catch is the answer as it came.
            Operand::Array(a) if !a.is_single() && a.values().any(caught) => {
                let brought = self.brought.take();
                let elements = self.elements(&Operand::Values(a.clone()), &brought);
                return self.lifted_if_error(f, a, elements, true, arguments, only_not_available);
            }
            other => other,
        };
        let is_caught = match &value {
            Operand::Value(v) => caught(v),
            Operand::Array(a) | Operand::Values(a) if a.is_single() => caught(a.get(0, 0)),
            _ => false,
        };
        if is_caught {
            self.as_it_came(f, arguments.get(1), Value::Blank)
        } else {
            value
        }
    }

    fn ifs(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        // Outside an argument that takes several cells, the tests are worked out in order, and one of several cells
        // is #VALUE! (`=IFS(TRUE,1,A1:A2,2)` is 1, `=ISERROR(IFS(A1:A2,1))` TRUE).
        if !self.lifting {
            for pair in arguments.chunks(2) {
                let test = self.eval(f, &pair[0]);
                let test = match self.grid(test) {
                    Grid::One(v) => coerce::to_boolean(&v),
                    Grid::Many(_) => Err(CellError::Value),
                };
                match test {
                    Err(e) => {
                        self.brought = None;
                        self.link = None;
                        return Operand::error(e);
                    }
                    Ok(true) => return self.as_it_came(f, pair.get(1), Value::Blank),
                    Ok(false) => {}
                }
            }
            self.brought = None;
            self.link = None;
            return Operand::error(CellError::NotAvailable);
        }
        // Inside one, the tests are all worked out first: one of several cells makes every cell pick (`lifted_ifs`).
        let mut tests = Vec::with_capacity(arguments.len() / 2);
        for pair in arguments.chunks(2) {
            let test = self.eval(f, &pair[0]);
            tests.push(self.grid(test));
        }
        if tests.iter().any(|t| matches!(t, Grid::Many(_))) {
            let tests = tests.into_iter().map(lifted::as_array).collect();
            return self.lifted_ifs(f, tests, arguments);
        }
        for (pair, test) in arguments.chunks(2).zip(tests) {
            let Grid::One(test) = test else { unreachable!("tests of one value") };
            match coerce::to_boolean(&test) {
                Err(e) => return Operand::error(e),
                Ok(true) => return self.as_it_came(f, pair.get(1), Value::Blank),
                Ok(false) => {}
            }
        }
        self.brought = None;
        self.link = None;
        Operand::error(CellError::NotAvailable)
    }

    fn switch(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        // The value and the cases are all worked out first: one of several cells makes every cell pick
        // (`lifted_switch`).
        let rest = &arguments[1..];
        let pairs = rest.len() / 2;
        let mut grids = Vec::with_capacity(pairs + 1);
        for expr in std::iter::once(&arguments[0]).chain((0..pairs).map(|i| &rest[2 * i])) {
            let operand = self.eval(f, expr);
            grids.push(self.grid(operand));
        }
        if grids.iter().any(|g| matches!(g, Grid::Many(_))) {
            let arrays = grids.into_iter().map(lifted::as_array).collect();
            return self.lifted_switch(f, arrays, arguments);
        }
        let values: Vec<Value> = grids
            .into_iter()
            .map(|g| match g {
                Grid::One(v) => v,
                Grid::Many(_) => unreachable!("values of one value"),
            })
            .collect();
        self.brought = None;
        self.link = None;
        if let Value::Error(e) = &values[0] {
            return Operand::error(*e);
        }
        for i in 0..pairs {
            let case = &values[1 + i];
            if let Value::Error(e) = case {
                return Operand::error(*e);
            }
            if same_value(&values[0], case) {
                return self.as_it_came(f, Some(&rest[2 * i + 1]), Value::Blank);
            }
        }
        if rest.len() % 2 == 1 {
            return self.as_it_came(f, rest.last(), Value::Blank);
        }
        Operand::error(CellError::NotAvailable)
    }

    fn choose(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        let position = self.eval(f, &arguments[0]);
        let position = match self.grid(position) {
            Grid::Many(positions) => {
                self.tell_first("CHOOSE");
                return self.lifted_choose(f, positions, arguments);
            }
            Grid::One(v) => v,
        };
        let n = match coerce::to_number(&position, self.locale) {
            Ok(n) => n.trunc(),
            Err(e) => return Operand::error(e),
        };
        if n < 1.0 || n as usize >= arguments.len() {
            return Operand::error(CellError::Value);
        }
        self.as_it_came(f, Some(&arguments[n as usize]), Value::Blank)
    }

    fn let_(&mut self, f: usize, arguments: &[Expr]) -> Operand {
        let depth = self.scopes.len();
        let pairs = (arguments.len() - 1) / 2;
        let mut names: Vec<Rc<str>> = Vec::with_capacity(pairs);
        let mut answer = None;
        for i in 0..pairs {
            let name = match &arguments[2 * i] {
                // A name written as a cell's address (one past the sheet's end) is not one LET gives a value to.
                Expr::Name(n) if !names.contains(n) && !crate::formula::parse::looks_like_a_cell(n) => n.clone(),
                _ => {
                    answer = Some(Operand::error(CellError::Name));
                    break;
                }
            };
            // A value is worked out as an argument that takes several cells is (IFS given several cells lifts there).
            let lifting = std::mem::replace(&mut self.lifting, true);
            let value = self.as_it_came(f, Some(&arguments[2 * i + 1]), Value::Blank);
            self.lifting = lifting;
            let brought = self.brought.take();
            let link = self.link.take();
            names.push(name.clone());
            self.scopes.push((name, value, brought, link));
        }
        let answer = match answer {
            Some(a) => a,
            None => {
                let operand = self.eval(f, &arguments[arguments.len() - 1]);
                match operand {
                    Operand::Value(Value::Error(e)) => Operand::error(e),
                    other => other,
                }
            }
        };
        self.scopes.truncate(depth);
        answer
    }
}

/// Whether two values are the same, as SWITCH matches its cases: of one kind, and equal.
fn same_value(a: &Value, b: &Value) -> bool {
    let kind = |v: &Value| match v {
        Value::Blank | Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Boolean(_) => 2,
        Value::Error(_) => 3,
    };
    kind(a) == kind(b) && coerce::compare(a, b) == std::cmp::Ordering::Equal
}

/// An operator on two grids, cell by cell: a single value or a single row or column stretches across the other;
/// two of other different sizes are #VALUE! (one value).
fn broadcast(x: Grid, y: Grid, op: impl Fn(&Value, &Value) -> Value) -> Operand {
    match (x, y) {
        (Grid::One(a), Grid::One(b)) => Operand::Value(op(&a, &b)),
        (Grid::One(a), Grid::Many(b)) => Operand::Values(Rc::new(b.map(|q| op(&a, q)))),
        (Grid::Many(a), Grid::One(b)) => Operand::Values(Rc::new(a.map(|p| op(p, &b)))),
        (Grid::Many(a), Grid::Many(b)) => {
            let Some((rows, columns)) = lifted::stretched([a.as_ref(), b.as_ref()].into_iter()) else {
                return Operand::error(CellError::Value);
            };
            let mut values = Vec::with_capacity(rows * columns);
            for r in 0..rows {
                for c in 0..columns {
                    values.push(op(&lifted::stretched_at(&a, r, c), &lifted::stretched_at(&b, r, c)));
                }
            }
            Operand::Values(Rc::new(Array::new(rows, columns, values)))
        }
    }
}

fn unary(op: UnaryOp, v: &Value, locale: &Locale) -> Value {
    match op {
        UnaryOp::Plus => v.clone(),
        UnaryOp::Negate => match coerce::to_number(v, locale) {
            Ok(n) => Value::number(-n),
            Err(e) => Value::Error(e),
        },
        UnaryOp::Percent => match coerce::to_number(v, locale) {
            Ok(n) => Value::number(n / 100.0),
            Err(e) => Value::Error(e),
        },
    }
}

pub fn binary(op: BinaryOp, a: &Value, b: &Value, locale: &Locale) -> Value {
    if let Value::Error(e) = a {
        return Value::Error(*e);
    }
    // Arithmetic reads the left number before the right: `"a"*(1/0)` is #VALUE!.
    let is_arithmetic =
        matches!(op, BinaryOp::Add | BinaryOp::Subtract | BinaryOp::Multiply | BinaryOp::Divide | BinaryOp::Power);
    if let (Value::Error(e), false) = (b, is_arithmetic) {
        return Value::Error(*e);
    }
    let number = |v| coerce::to_number(v, locale);
    let numbers = || -> Result<(f64, f64), CellError> { Ok((number(a)?, number(b)?)) };
    let arithmetic = |f: &dyn Fn(f64, f64) -> Result<f64, CellError>| match numbers().and_then(|(x, y)| f(x, y)) {
        Ok(n) => Value::number(n),
        Err(e) => Value::Error(e),
    };
    let comparison = |f: &dyn Fn(std::cmp::Ordering) -> bool| Value::Boolean(f(coerce::compare(a, b)));
    use std::cmp::Ordering::*;
    match op {
        BinaryOp::Add => arithmetic(&|x, y| Ok(coerce::add(x, y))),
        BinaryOp::Subtract => arithmetic(&|x, y| Ok(coerce::add(x, -y))),
        BinaryOp::Multiply => arithmetic(&|x, y| Ok(x * y)),
        BinaryOp::Divide => arithmetic(&|x, y| if y == 0.0 { Err(CellError::DivideByZero) } else { Ok(x / y) }),
        BinaryOp::Power => arithmetic(&power),
        BinaryOp::Concat => match (coerce::to_text(a, locale), coerce::to_text(b, locale)) {
            // A text longer than 32767 bytes is #VALUE!.
            (Ok(x), Ok(y)) if x.len() + y.len() > crate::functions::text::LONGEST_TEXT_IN_BYTES => {
                Value::Error(CellError::Value)
            }
            (Ok(x), Ok(y)) => Value::Text(format!("{x}{y}").into()),
            (Err(e), _) | (_, Err(e)) => Value::Error(e),
        },
        BinaryOp::Equal => comparison(&|o| o == Equal),
        BinaryOp::NotEqual => comparison(&|o| o != Equal),
        BinaryOp::Less => comparison(&|o| o == Less),
        BinaryOp::LessOrEqual => comparison(&|o| o != Greater),
        BinaryOp::Greater => comparison(&|o| o == Greater),
        BinaryOp::GreaterOrEqual => comparison(&|o| o != Less),
    }
}

/// `x ^ y`: 0^0 is #NUM!; a negative number to a fraction is #NUM! unless the fraction is one over an odd number
/// (an odd root: `(-8)^(1/3)` is -2).
pub fn power(x: f64, y: f64) -> Result<f64, CellError> {
    if x == 0.0 && y == 0.0 {
        return Err(CellError::Number);
    }
    if x == 0.0 && y < 0.0 {
        return Err(CellError::DivideByZero);
    }
    if x < 0.0 && y.fract() != 0.0 {
        let root = 1.0 / y;
        let odd = root.round();
        if coerce::add(root, -odd) == 0.0 && odd % 2.0 != 0.0 {
            return Ok(-(-x).powf(y));
        }
        return Err(CellError::Number);
    }
    Ok(x.powf(y))
}
