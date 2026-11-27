//! Values as numbers, text and booleans, and how values compare: the rules operators and functions share.

use std::cmp::Ordering;
use std::rc::Rc;

use crate::locale::Locale;
use crate::typed_text;
use crate::value::{number_text_in, CellError, Value};

/// A value as a number: text is read as a person would type it in the workbook's locale (`"1,000"`, `"50%"`,
/// `"1/2/2024"` in en-US; `"1.000"`, `"1,5"`, `"1.2.2024"` in de-DE), `TRUE` is 1, blank is 0. Text that does
/// not read as a number is #VALUE!.
pub fn to_number(v: &Value, locale: &Locale) -> Result<f64, CellError> {
    match v {
        Value::Blank => Ok(0.0),
        Value::Number(n) => Ok(*n),
        Value::Boolean(b) => Ok(if *b { 1.0 } else { 0.0 }),
        Value::Text(s) => typed_text::number_of_text_in(s, locale).ok_or_else(|| {
            crate::told::tell(|| crate::told::Told::TextNotANumber(s.clone()));
            CellError::Value
        }),
        Value::Error(e) => Err(*e),
    }
}

/// A value as text: numbers as [`number_text_in`] writes them in the workbook's locale (`1,5` in de-DE), booleans
/// as `TRUE` and `FALSE` in every locale, blank as "".
pub fn to_text(v: &Value, locale: &Locale) -> Result<Rc<str>, CellError> {
    match v {
        Value::Blank => Ok("".into()),
        Value::Number(n) => Ok(number_text_in(*n, locale).into()),
        Value::Boolean(b) => Ok(if *b { "TRUE" } else { "FALSE" }.into()),
        Value::Text(s) => Ok(s.clone()),
        Value::Error(e) => Err(*e),
    }
}

/// A value as a boolean: a number is true when it is not 0, text must say `TRUE` or `FALSE`, blank is false.
pub fn to_boolean(v: &Value) -> Result<bool, CellError> {
    match v {
        Value::Blank => Ok(false),
        Value::Number(n) => Ok(*n != 0.0),
        Value::Boolean(b) => Ok(*b),
        Value::Text(s) => {
            if s.eq_ignore_ascii_case("TRUE") {
                Ok(true)
            } else if s.eq_ignore_ascii_case("FALSE") {
                Ok(false)
            } else {
                Err(CellError::Value)
            }
        }
        Value::Error(e) => Err(*e),
    }
}

/// `a + b`: two whole numbers below 2⁵³ add exactly; otherwise a result that is only what is left
/// of rounding (less than 2⁻⁴⁸ of the smaller operand) is 0. `0.1 + 0.2 - 0.3` is 0, `1E15 - 999999999999999` is 1.
pub fn add(a: f64, b: f64) -> f64 {
    let r = a + b;
    let whole = |x: f64| x.abs() < 9_007_199_254_740_992.0 && x == x.trunc();
    if whole(a) && whole(b) {
        r
    } else if r.abs() < a.abs().min(b.abs()) * TINY {
        0.0
    } else {
        r
    }
}

const TINY: f64 = 1.0 / 281_474_976_710_656.0; // 2⁻⁴⁸

/// A number to 15 significant digits, as comparisons see it: `0.1 + 0.2 = 0.3`.
pub fn compared_number(n: f64) -> f64 {
    if n == 0.0 || !n.is_finite() {
        return n;
    }
    format!("{n:.14e}").parse().unwrap_or(n)
}

/// How two numbers compare, to 15 significant digits.
pub fn compare_numbers(a: f64, b: f64) -> Ordering {
    compared_number(a).partial_cmp(&compared_number(b)).unwrap_or(Ordering::Equal)
}

/// How two texts compare: in any case, character by character.
pub fn compare_texts(a: &str, b: &str) -> Ordering {
    let mut x = a.chars().flat_map(char::to_lowercase);
    let mut y = b.chars().flat_map(char::to_lowercase);
    loop {
        match (x.next(), y.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(p), Some(q)) => match p.cmp(&q) {
                Ordering::Equal => {}
                other => return other,
            },
        }
    }
}

/// The order of kinds of values: numbers, then text, then booleans.
fn rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Boolean(_) => 2,
        Value::Blank | Value::Error(_) => 3,
    }
}

/// How two values compare, as `<` and `=` do: numbers before text before booleans; blank is 0, "" or FALSE, as
/// the other value is. Neither value is an error.
pub fn compare(a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Blank, Value::Blank) => Ordering::Equal,
        (Value::Blank, other) => compare(&blank_as(other), other),
        (other, Value::Blank) => compare(other, &blank_as(other)),
        (Value::Number(x), Value::Number(y)) => compare_numbers(*x, *y),
        (Value::Text(x), Value::Text(y)) => compare_texts(x, y),
        (Value::Boolean(x), Value::Boolean(y)) => x.cmp(y),
        _ => rank(a).cmp(&rank(b)),
    }
}

/// Blank as a value of another value's kind.
fn blank_as(other: &Value) -> Value {
    match other {
        Value::Text(_) => Value::Text("".into()),
        Value::Boolean(_) => Value::Boolean(false),
        _ => Value::Number(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snaps_tiny_differences() {
        assert_eq!(add(add(0.1, 0.2), -0.3), 0.0);
        assert_eq!(add(1.0, -(1.0 - 3e-15)), 0.0);
        assert_ne!(add(1.0, -(1.0 - 3.6e-15)), 0.0);
        assert_eq!(add(1.0, -0.9), 0.09999999999999998);
    }

    #[test]
    fn compares() {
        assert_eq!(compare_numbers(0.1 + 0.2, 0.3), Ordering::Equal);
        assert_eq!(compare_numbers(1.0 + 5e-15, 1.0), Ordering::Greater);
        assert_eq!(compare_numbers(1.000000000000004, 1.000000000000006), Ordering::Less);
        assert_eq!(compare(&Value::text("a"), &Value::text("B")), Ordering::Less);
        assert_eq!(compare(&Value::text("10"), &Value::Number(9.0)), Ordering::Greater);
        assert_eq!(compare(&Value::Boolean(true), &Value::text("z")), Ordering::Greater);
        assert_eq!(compare(&Value::Blank, &Value::Boolean(false)), Ordering::Equal);
        assert_eq!(compare(&Value::text("Ä"), &Value::text("ä")), Ordering::Equal);
    }
}
