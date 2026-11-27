//! The newer functions that are called as other functions are: SEQUENCE, TEXTSPLIT and
//! NUMBERVALUE. (MAP, BYROW, BYCOL and LAMBDA, added with them, are worked out by the evaluator: `evaluate/lambda.rs`.)

use std::rc::Rc;

use crate::coerce;
use crate::evaluate::Operand;
use crate::functions::{array, number, Answer, Arg, CallContext};
use crate::locale::Locale;
use crate::value::{Array, CellError, Value};

/// Calls one of these functions by name; `None` for another.
pub fn call(name: &str, args: &[Arg], cx: &mut CallContext) -> Option<Answer> {
    let locale = cx.locale;
    Some(match name {
        "SEQUENCE" => sequence(args, locale),
        "TEXTSPLIT" => text_split(args, locale),
        "NUMBERVALUE" => number_value(args, locale),
        _ => return None,
    })
}

/// How these functions read their arguments early (see `functions::early_reads`): SEQUENCE its rows and columns as
/// numbers of 1 or more (else #VALUE!), and its start as a number.
pub fn early_reads(name: &str) -> Option<&'static str> {
    Some(match name {
        "SEQUENCE" => "11n",
        _ => return None,
    })
}

/// Whether an optional argument is not given or left out.
fn left_out(arg: Option<&Arg>) -> bool {
    matches!(arg, None | Some(Arg::Missing))
}

// SEQUENCE

/// The most numbers SEQUENCE fills: `SEQUENCE(100000)` and `SEQUENCE(316,316)` are filled, `SEQUENCE(100001)` and
/// `SEQUENCE(317,317)` are #VALUE!.
const MOST_NUMBERS: f64 = 100_000.0;

/// SEQUENCE(rows, [columns], [start], [step]): rows and columns (1 each when left out, cut toward zero) of numbers,
/// row by row, from the start (1) in steps (1): the kth is the start plus k steps, added as `+` adds. A number too
/// big for a cell is #NUM! there; more than `MOST_NUMBERS` in all, #VALUE!.
fn sequence(args: &[Arg], locale: &Locale) -> Answer {
    let count = |arg: Option<&Arg>| -> Result<f64, CellError> {
        if left_out(arg) {
            return Ok(1.0);
        }
        let n = arg.map_or(Ok(1.0), |a| a.number(locale))?.trunc();
        if n < 1.0 {
            return Err(CellError::Value);
        }
        Ok(n)
    };
    let rows = count(args.first())?;
    let columns = count(args.get(1))?;
    let start = if left_out(args.get(2)) { 1.0 } else { args[2].number(locale)? };
    let step = if left_out(args.get(3)) { 1.0 } else { args[3].number(locale)? };
    if rows * columns > MOST_NUMBERS {
        return Err(CellError::Value);
    }
    let (rows, columns) = (rows as usize, columns as usize);
    let values = (0..rows * columns).map(|k| Value::number(coerce::add(start, step * k as f64))).collect();
    array(Array::new(rows, columns, values))
}

// TEXTSPLIT

/// A character as compared in any case, as TEXTAFTER compares them: its lowercase when that is one character.
fn folded(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

/// The separators an argument gives: each of its values as text, the empty ones left out.
fn separators(arg: Option<&Arg>, locale: &Locale) -> Result<Vec<Vec<char>>, CellError> {
    let mut out = Vec::new();
    let mut add = |v: &Value| -> Result<(), CellError> {
        let t = coerce::to_text(v, locale)?;
        if !t.is_empty() {
            out.push(t.chars().collect());
        }
        Ok(())
    };
    match arg {
        None | Some(Arg::Missing) | Some(Arg::Place(_)) => {}
        Some(Arg::Value(v)) => add(v)?,
        Some(Arg::Cells(cells)) => {
            for v in cells.values() {
                add(v)?;
            }
        }
    }
    Ok(out)
}

/// Text cut at its separators, from the start: at each place, the longest separator that matches there.
fn split(text: &[char], separators: &[Vec<char>], ignore_case: bool) -> Vec<String> {
    let same = |a: char, b: char| if ignore_case { folded(a) == folded(b) } else { a == b };
    let matches_at =
        |i: usize, s: &[char]| i + s.len() <= text.len() && s.iter().enumerate().all(|(j, &c)| same(text[i + j], c));
    let mut pieces = Vec::new();
    let (mut from, mut i) = (0, 0);
    while i < text.len() {
        let longest = separators.iter().filter(|s| matches_at(i, s)).map(Vec::len).max();
        match longest {
            Some(len) => {
                pieces.push(text[from..i].iter().collect());
                i += len;
                from = i;
            }
            None => i += 1,
        }
    }
    pieces.push(text[from..].iter().collect());
    pieces
}

/// TEXTSPLIT(text, column separator, [row separator], [skip empty], [ignore case], [fill with]): the text cut into
/// rows at the row separators, then each row into columns at the column separators (each argument a value, or cells
/// of several; empty ones are passed over, and with none left the call is #VALUE!). Empty pieces are dropped when
/// asked (an empty row, and empty columns of a row); rows shorter than the longest are filled out with `fill with`
/// (blank when left out, #N/A when not given). Empty text, or nothing left, is #VALUE!.
///
/// Given both separators, the array does not spill (as an operator's does not): `=TEXTSPLIT("a,b;c",",",";")` is
/// #VALUE!, where `=TAKE(TEXTSPLIT("a,b;c",",",";"),9)` spills.
fn text_split(args: &[Arg], locale: &Locale) -> Answer {
    let text: Vec<char> = args[0].text(locale)?.chars().collect();
    let column_separators = separators(args.get(1), locale)?;
    let row_separators = separators(args.get(2), locale)?;
    let flag = |i: usize| -> Result<bool, CellError> {
        match args.get(i) {
            None => Ok(false),
            Some(arg) => arg.boolean(),
        }
    };
    let skip_empty = flag(3)?;
    let ignore_case = flag(4)?;
    let fill = match args.get(5) {
        None => Value::Error(CellError::NotAvailable),
        Some(arg) => arg.value()?,
    };
    if column_separators.is_empty() && row_separators.is_empty() {
        return Err(CellError::Value);
    }
    if text.is_empty() {
        return Err(CellError::Value);
    }
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in split(&text, &row_separators, ignore_case) {
        if skip_empty && row.is_empty() {
            continue;
        }
        let row: Vec<char> = row.chars().collect();
        let mut columns = split(&row, &column_separators, ignore_case);
        if skip_empty {
            columns.retain(|c| !c.is_empty());
        }
        rows.push(columns);
    }
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return Err(CellError::Value);
    }
    let height = rows.len();
    let mut values = Vec::with_capacity(height * width);
    for row in rows {
        let given = row.len();
        values.extend(row.into_iter().map(|piece| Value::Text(piece.into())));
        values.extend(std::iter::repeat_n(fill.clone(), width - given));
    }
    let answer = Array::new(height, width, values);
    let both_given = !left_out(args.get(1)) && !left_out(args.get(2));
    if both_given && !answer.is_single() {
        return Ok(Operand::Values(Rc::new(answer)));
    }
    array(answer)
}

// NUMBERVALUE

/// The spaces NUMBERVALUE passes over, wherever they are in the text.
const SPACES: [char; 6] = [' ', '\t', '\n', '\r', '\u{a0}', '\u{202f}'];

/// A right single quotation mark is read as an apostrophe, in the text and in the separators (`1’234` in de-CH).
fn as_apostrophe(c: char) -> char {
    if c == '\u{2019}' {
        '\''
    } else {
        c
    }
}

/// NUMBERVALUE(text, [decimal separator], [group separator]): text read as a number with the separators given (the
/// first character of each), or the locale's when not given. A separator may not be a digit, `e`, `E`, `+`, `-` or
/// `%`, and the decimal one not a space either; an empty decimal separator is #VALUE!, an empty group separator
/// none, and the two the same #VALUE! (the locale's group separator, when it is the decimal separator given, is
/// none). A value that is not text is read as a number (blank is 0, TRUE 1).
///
/// The spaces in `SPACES` are passed over. What is left is a sign, digits with group separators among them (only
/// before the decimal separator), the decimal separator and more digits, then an exponent (`E`, a sign, digits), and
/// percent signs, each dividing by 100; with at least one digit before the exponent. Empty text is 0; a number too
/// big is #VALUE!.
fn number_value(args: &[Arg], locale: &Locale) -> Answer {
    let is_not_a_separator = |c: char| c.is_ascii_digit() || matches!(c, 'e' | 'E' | '+' | '-' | '%');
    let decimal = match args.get(1) {
        None => locale.decimal_sign.sign(),
        Some(arg) => match arg.text(locale)?.chars().next() {
            None => return Err(CellError::Value),
            Some(c) => as_apostrophe(c),
        },
    };
    if is_not_a_separator(decimal) || SPACES.contains(&decimal) {
        return Err(CellError::Value);
    }
    let group = match args.get(2) {
        None => {
            let sign = locale.group_sign.sign();
            (sign != decimal).then_some(sign)
        }
        Some(arg) => match arg.text(locale)?.chars().next() {
            None => None,
            Some(c) => {
                let c = as_apostrophe(c);
                if is_not_a_separator(c) || c == decimal {
                    return Err(CellError::Value);
                }
                Some(c)
            }
        },
    };
    let text = match args[0].value()? {
        Value::Text(t) => t,
        other => return number(coerce::to_number(&other, locale)?),
    };
    let chars: Vec<char> = text.chars().map(as_apostrophe).filter(|c| !SPACES.contains(c)).collect();
    if chars.is_empty() {
        return number(0.0);
    }
    let mut end = chars.len();
    let mut percents = 0;
    while end > 0 && chars[end - 1] == '%' {
        end -= 1;
        percents += 1;
    }
    let chars = &chars[..end];
    let mut read = String::new();
    let mut i = 0;
    if let Some(&c @ ('+' | '-')) = chars.first() {
        read.push(c);
        i = 1;
    }
    let mut digits = 0;
    let mut after_decimal = false;
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_digit() {
            read.push(c);
            digits += 1;
        } else if c == decimal && !after_decimal {
            read.push('.');
            after_decimal = true;
        } else if Some(c) == group && !after_decimal {
        } else {
            break;
        }
        i += 1;
    }
    if digits == 0 {
        return Err(CellError::Value);
    }
    if i < chars.len() {
        if !matches!(chars[i], 'e' | 'E') {
            return Err(CellError::Value);
        }
        read.push('e');
        i += 1;
        if let Some(&c @ ('+' | '-')) = chars.get(i) {
            read.push(c);
            i += 1;
        }
        let from = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            read.push(chars[i]);
            i += 1;
        }
        if i == from || i < chars.len() {
            return Err(CellError::Value);
        }
    }
    let n: f64 = read.parse().map_err(|_| CellError::Value)?;
    if !n.is_finite() {
        return Err(CellError::Value);
    }
    number((0..percents).fold(n, |n, _| n / 100.0))
}
