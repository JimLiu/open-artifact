//! AGGREGATE(function code, skip code, ranges…, [position or fraction]).

use std::rc::Rc;

use crate::functions::{math, number, statistical, Answer, Arg, CallContext, Cells};
use crate::value::{Array, CellError, Value};

/// The function code (cut to a whole number) picks the function: 1 to 13 total ranges (AVERAGE, COUNT, COUNTA,
/// MAX, MIN, PRODUCT, STDEV.S, STDEV.P, SUM, VAR.S, VAR.P, MEDIAN, MODE.SNGL), 14 to 19 take one range and a
/// position or fraction (LARGE, SMALL, PERCENTILE.INC, QUARTILE.INC, PERCENTILE.EXC, QUARTILE.EXC). The skip code,
/// 0 to 7, skips errors when it is 2, 3, 6 or 7; the odd ones, which skip hidden rows, are #VALUE! of a range
/// (an array has no hidden rows: `=AGGREGATE(14,7,{1,2;3,#N/A},1)` is 3).
/// The ranges 1 to 13 total must be written as ranges (not arrays or values), else #VALUE!; 14 to 19 take an array
/// or a value too (`=AGGREGATE(14,0,{1,2},1)` is 2).
pub fn aggregate(args: &[Arg], cx: &mut CallContext) -> Answer {
    let locale = cx.locale;
    let code = args[0].number(locale)?.trunc();
    let skip = args[1].number(locale)?.trunc();
    if !(1.0..=19.0).contains(&code) || !(0.0..=7.0).contains(&skip) {
        return Err(CellError::Value);
    }
    let skips_hidden_rows = skip % 2.0 == 1.0;
    let skip_errors = matches!(skip as u8, 2 | 3 | 6 | 7);
    let rest = &args[2..];
    let code = code as usize;
    if code >= 14 {
        let [range, position] = rest else {
            return Err(CellError::Value);
        };
        let range = cells_or_array_of(range, skip_errors)?;
        if skips_hidden_rows && range.is_range() {
            return Err(CellError::Value);
        }
        let range = Arg::Cells(range);
        let k = match position {
            Arg::Missing | Arg::Place(_) => return Err(CellError::Value),
            Arg::Value(v) => v.clone(),
            Arg::Cells(cells) if cells.array.is_single() => cells.get(0, 0).clone(),
            Arg::Cells(_) => return Err(CellError::Value),
        };
        let k = crate::coerce::to_number(&k, locale)?;
        let pair = [range, Arg::Value(Value::Number(k))];
        return match code {
            14 => statistical::call("LARGE", &pair, cx).unwrap(),
            15 => statistical::call("SMALL", &pair, cx).unwrap(),
            16 => statistical::call("PERCENTILE.INC", &pair, cx).unwrap(),
            17 => statistical::call("QUARTILE.INC", &pair, cx).unwrap(),
            18 => percentile_exc(numbers(&pair[0])?, k),
            _ => quartile_exc(numbers(&pair[0])?, k),
        };
    }
    if skips_hidden_rows {
        return Err(CellError::Value);
    }
    let ranges = rest.iter().map(|r| cells_of(r, skip_errors).map(Arg::Cells)).collect::<Result<Vec<Arg>, _>>()?;
    let name = [
        "AVERAGE", "COUNT", "COUNTA", "MAX", "MIN", "PRODUCT", "STDEV.S", "STDEV.P", "SUM", "VAR.S", "VAR.P", "MEDIAN",
        "MODE.SNGL",
    ][code - 1];
    let answer = match name {
        "PRODUCT" | "SUM" => math::call(name, &ranges, cx),
        _ => statistical::call(name, &ranges, cx),
    };
    answer.expect("AGGREGATE's functions are all present")
}

/// A range AGGREGATE totals, its errors made blank when they are skipped.
fn cells_of(arg: &Arg, skip_errors: bool) -> Result<Cells, CellError> {
    match arg {
        Arg::Cells(cells) if cells.is_range() => Ok(skipped(cells.clone(), skip_errors)),
        _ => Err(CellError::Value),
    }
}

/// A range, an array or a value AGGREGATE takes a position or fraction of, its errors made blank when they are
/// skipped; left out, #VALUE!.
fn cells_or_array_of(arg: &Arg, skip_errors: bool) -> Result<Cells, CellError> {
    let cells = match arg {
        Arg::Cells(cells) => cells.clone(),
        Arg::Value(v) => Cells { array: Rc::new(Array::single(v.clone())), place: None },
        Arg::Missing | Arg::Place(_) => return Err(CellError::Value),
    };
    Ok(skipped(cells, skip_errors))
}

/// Cells with their errors made blank when they are skipped.
fn skipped(cells: Cells, skip_errors: bool) -> Cells {
    if !skip_errors || !cells.values().any(Value::is_error) {
        return cells;
    }
    let array = cells.array.map(|v| if v.is_error() { Value::Blank } else { v.clone() });
    Cells { array: Rc::new(array), place: cells.place }
}

/// The numbers of a range; an error in it is the answer.
fn numbers(arg: &Arg) -> Result<Vec<f64>, CellError> {
    let mut out = Vec::new();
    for v in arg.cells().values() {
        match v {
            Value::Number(n) => out.push(*n),
            Value::Error(e) => return Err(*e),
            _ => {}
        }
    }
    Ok(out)
}

/// PERCENTILE.EXC: the number at rank p·(n + 1) of the sorted numbers, between two in proportion; a rank below 1
/// or past n is #NUM!.
fn percentile_exc(mut n: Vec<f64>, p: f64) -> Answer {
    let count = n.len() as f64;
    if n.is_empty() || p <= 0.0 || p >= 1.0 {
        return Err(CellError::Number);
    }
    let rank = p * (count + 1.0);
    if rank < 1.0 || rank > count {
        return Err(CellError::Number);
    }
    n.sort_by(f64::total_cmp);
    let low = rank.floor();
    let i = low as usize;
    if i >= n.len() {
        return number(n[n.len() - 1]);
    }
    number(n[i - 1] + (rank - low) * (n[i] - n[i - 1]))
}

/// QUARTILE.EXC: the quarter mark cut to a whole number, 1 to 3, as [`percentile_exc`] of a quarter of it.
fn quartile_exc(n: Vec<f64>, q: f64) -> Answer {
    let q = q.trunc();
    if !(1.0..=3.0).contains(&q) {
        return Err(CellError::Number);
    }
    percentile_exc(n, q / 4.0)
}
