//! What each value of an array worked out brings: an operator's (`=ARRAYFORMULA(A1:A6+1)` gives each value
//! what its cell and 1 make, a date beside a date, a percent beside a percent), a call's worked out cell by cell
//! (`=ARRAYFORMULA(ABS(A1:A6))`, `=ARRAYFORMULA(DATE(2020,1,B1:B6))`), and the values IF, CHOOSE, SWITCH, IFS, IFERROR
//! and IFNA pick cell by cell, each what the value it picks brings. A range's value brings what its cell does, an
//! array's what it was given (none for one written or one SEQUENCE fills), and one value what its expression does,
//! wherever it stretches. The array brings, as one, what its first value does (`=SUM(A1:A3+0)` over a blank A1
//! brings nothing).

use std::rc::Rc;

use super::{Operand, Place};
use crate::brought::Brought;
use crate::calculate::{Calculation, SpillFormats};
use crate::value::Array;

/// What the values of an operand bring, kept as it is worked out.
#[derive(Clone)]
pub(super) enum Elements {
    /// One value, which brings this wherever it stretches.
    One(Option<Brought>),
    /// A range's cells, each what it brings.
    Range(Place),
    /// An array's values, each what it was given (none when nothing was), of so many rows and columns.
    Array(Option<SpillFormats>, usize, usize),
}

impl Elements {
    /// Whether no value brings anything.
    fn bring_nothing(&self) -> bool {
        matches!(self, Elements::One(None) | Elements::Array(None, ..))
    }
}

impl Calculation {
    /// What the values of an operand bring, the operand's expression bringing `brought`.
    pub(super) fn elements(&self, operand: &Operand, brought: &Option<Brought>) -> Elements {
        match operand {
            Operand::Range(place) if !place.is_single() => Elements::Range(*place),
            Operand::Array(a) | Operand::Values(a) if !a.is_single() => {
                let formats = self.array_formats.get(&Rc::as_ptr(a)).map(|(_, formats)| formats.clone());
                Elements::Array(formats, a.rows(), a.columns())
            }
            _ => Elements::One(brought.clone()),
        }
    }

    /// What the value at (row, column) of an operand stretched brings.
    pub(super) fn element(&mut self, elements: &Elements, r: usize, c: usize) -> Option<Brought> {
        match elements {
            Elements::One(brought) => brought.clone(),
            Elements::Range(p) => {
                let rr = if p.rows() == 1 { 0 } else { r };
                let cc = if p.columns() == 1 { 0 } else { c };
                self.cell_brought(p.sheet, p.top + rr, p.left + cc)
            }
            Elements::Array(None, ..) => None,
            Elements::Array(Some(formats), rows, columns) => {
                let rr = if *rows == 1 { 0 } else { r };
                let cc = if *columns == 1 { 0 } else { c };
                formats.get(*columns, (rr, cc)).cloned()
            }
        }
    }

    /// What each value of an array worked out from operands brings, `each` making it from what theirs at the same
    /// place bring; the array brings what its first value does.
    pub(super) fn bring_each(
        &mut self,
        array: &Rc<Array>,
        operands: &[&Elements],
        each: impl Fn(&[Option<Brought>]) -> Option<Brought>,
    ) {
        if operands.iter().all(|e| e.bring_nothing()) {
            self.brought = each(&vec![None; operands.len()]);
            if self.brought.is_some() {
                let formats = vec![self.brought.clone(); array.rows() * array.columns()];
                self.keep_formats(array, formats);
            }
            return;
        }
        let mut formats = Vec::with_capacity(array.rows() * array.columns());
        let mut at = Vec::with_capacity(operands.len());
        for r in 0..array.rows() {
            for c in 0..array.columns() {
                at.clear();
                for e in operands {
                    at.push(self.element(e, r, c));
                }
                formats.push(each(&at));
            }
        }
        self.keep_formats(array, formats);
    }

    /// An array's values bring these, and it brings, as one, what its first value does.
    pub(super) fn keep_formats(&mut self, array: &Rc<Array>, formats: Vec<Option<Brought>>) {
        self.brought = formats.first().cloned().flatten();
        if formats.iter().any(Option::is_some) {
            self.array_formats.insert(Rc::as_ptr(array), (array.clone(), SpillFormats::Dense(formats.into())));
        }
    }
}
