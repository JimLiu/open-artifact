//! What a function's call tells of why it is #VALUE!, for the cause of a cell's error: text it read as a number
//! that does not read as one (`=ABS(C1)`), a column to sort by past the range's (`=SORT(B1:B2,3)`), and an order
//! that is not 1, 0 or -1 (`=SORT(B1:B2,1,2)`), ranges read together that are not of one size
//! (`=SUMPRODUCT(B1:B2,B1:B3)`). Nothing is kept unless the cause is being looked for (`watching`),
//! and each thing told is kept with how many calls deep it was told, so that the call looked into is told apart
//! from those in its arguments.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// A thing a call tells.
#[derive(Clone, Debug)]
pub(crate) enum Told {
    /// Text read as a number that does not read as one (the very text, to be told apart from other texts).
    TextNotANumber(Rc<str>),
    /// A column to sort by (as given, cut to a whole number) of a range of so many columns; `argument` is the
    /// range's position among those given.
    NoSuchColumnToSortBy { argument: usize, columns: usize, column: f64 },
    /// An order (at this position among the arguments given) that is not 1, 0 or -1.
    SortOrderIsNotRead { argument: usize },
    /// Ranges read pair by pair, or place by place, that are not of one size.
    RangesOfDifferentSizes,
}

thread_local! {
    static KEPT: RefCell<Option<Vec<(usize, Told)>>> = const { RefCell::new(None) };
    static DEPTH: Cell<usize> = const { Cell::new(0) };
}

/// Keeps what is told, while watching.
pub(crate) fn tell(told: impl FnOnce() -> Told) {
    KEPT.with(|kept| {
        if let Some(kept) = kept.borrow_mut().as_mut() {
            kept.push((DEPTH.with(Cell::get), told()));
        }
    });
}

/// Works out a call, one deeper.
pub(crate) fn in_a_call<T>(work: impl FnOnce() -> T) -> T {
    DEPTH.with(|d| d.set(d.get() + 1));
    let answer = work();
    DEPTH.with(|d| d.set(d.get() - 1));
    answer
}

/// What `work` answers, with what the calls it works out at its top (not those in their arguments) tell, in order.
pub(crate) fn watching<T>(work: impl FnOnce() -> T) -> (T, Vec<Told>) {
    let was = KEPT.with(|kept| kept.borrow_mut().replace(Vec::new()));
    let depth = DEPTH.with(Cell::get);
    let answer = work();
    let kept = KEPT.with(|kept| std::mem::replace(&mut *kept.borrow_mut(), was)).unwrap_or_default();
    let top = kept.into_iter().filter(|(d, _)| *d == depth + 1).map(|(_, told)| told).collect();
    (answer, top)
}
