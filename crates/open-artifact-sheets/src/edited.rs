//! How the page writes a cell for the person to edit, where that is not plainly what the cell holds.
//!
//! A number (`numberIsEditedAs`) is written the way it would be typed into its cell: a percentage as one
//! (`0.015` in `0.00%` is `1.5%`), a date as the locale's short date (`1/2/2020`; `2020-01-02` when the pattern
//! starts `yyyy-mm-dd`), a time of day as `13:45` (`1:45 PM` when the pattern shows AM and PM, and seconds and their
//! decimals only when there are any), a date and time as both; a number of these kinds that can't be written so (a
//! date with a time in a cell for dates, a time of more than a day, or one finer than a millisecond) is written as
//! the number it is. Any other number is given only when it is very small or very large (`0.001`, `1E+20`), which the
//! page would otherwise write in its own way. The digits are the fewest that read back as the number, written out
//! while that takes at most 20 characters (the sign aside), else with an exponent of two digits or more
//! (`5.47800925925926E-05`), with the locale's decimal sign. A time is a whole number of milliseconds when that many,
//! divided back, is the number (`-0.03` is `12/29/1899 23:16:48`).
//!
//! A text (`textIsEditedAfterTheMark`) is written after a `'` when typed again it would not be that text
//! (`123`, `=x`, `TRUE`, `'abc`), or it is a month and a day that other spreadsheets read as a date (`1/2`). So
//! are the people a cell names and text with looks, by the text they read as (`123` with a link).

use crate::dates;
use crate::locale::Locale;
use crate::number_format::{Kind, NumberFormat};
use crate::value::fixed_text;

/// The first and last days a date is written as one: 0001-01-01 and 9999-12-31.
const FIRST_DAY: f64 = -693_593.0;
const LAST_DAY: f64 = dates::LAST_SERIAL as f64;
const MILLISECONDS_IN_A_DAY: f64 = 86_400_000.0;
/// The most characters a number is written out in (its sign aside).
const LONGEST_WRITTEN_OUT: usize = 20;

/// How a number in a cell with this pattern is written to be edited, when the page needs telling.
pub fn number_is_edited_as(n: f64, pattern: &str, locale: &Locale) -> Option<String> {
    let (kind, half_days) = NumberFormat::kind_of(pattern);
    let plain = || written(n, 0, locale);
    match kind {
        Kind::Percent => Some(format!("{}%", written(n, 2, locale))),
        Kind::Date => Some(match day(n) {
            Some(day) if n.fract() == 0.0 => date(day, pattern, locale),
            _ => plain(),
        }),
        Kind::Time | Kind::Duration => {
            let within = milliseconds(n).filter(|ms| (0.0..MILLISECONDS_IN_A_DAY).contains(ms));
            Some(within.map_or_else(plain, |ms| time(ms as u64, half_days, locale)))
        }
        Kind::DateAndTime => {
            let at = milliseconds(n)
                .and_then(|ms| Some((day(n.floor())?, ms.rem_euclid(MILLISECONDS_IN_A_DAY) as u64)));
            Some(match at {
                Some((day, 0)) => date(day, pattern, locale),
                Some((day, ms)) => format!("{} {}", date(day, pattern, locale), time(ms, half_days, locale)),
                None => plain(),
            })
        }
        _ if n != 0.0 && (n.abs() < 0.01 || n.abs() >= 1e20) => Some(plain()),
        _ => None,
    }
}

/// How a number in a cell with this pattern is written to be edited, told to the page or not (`readTextToEdit`).
pub fn number_edited_as(n: f64, pattern: &str, locale: &Locale) -> String {
    number_is_edited_as(n, pattern, locale).unwrap_or_else(|| written(n, 0, locale))
}

/// A whole number of days between the first and last days written as dates.
fn day(n: f64) -> Option<i64> {
    (FIRST_DAY..=LAST_DAY).contains(&n).then_some(n.floor() as i64)
}

/// The milliseconds `n` days are, when they are a whole number: that many, divided back into days, is `n`.
fn milliseconds(n: f64) -> Option<f64> {
    let ms = (n * MILLISECONDS_IN_A_DAY).round();
    (ms / MILLISECONDS_IN_A_DAY == n).then_some(ms)
}

fn date(day: i64, pattern: &str, locale: &Locale) -> String {
    let (y, m, d) = dates::date_from_serial(day);
    if pattern.starts_with("yyyy-mm-dd") {
        format!("{y:04}-{m:02}-{d:02}")
    } else {
        locale.short_date.show(y, m, d)
    }
}

/// `13:45`, `9:05:30.25`, or `1:45 PM`.
fn time(ms: u64, half_days: bool, locale: &Locale) -> String {
    let (hours, minutes, seconds, ms) = (ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
    let shown_hours = if half_days { (hours + 11) % 12 + 1 } else { hours };
    let mut out = format!("{shown_hours}:{minutes:02}");
    if seconds > 0 || ms > 0 {
        out.push_str(&format!(":{seconds:02}"));
    }
    if ms > 0 {
        out.push(locale.decimal_sign.sign());
        out.push_str(format!("{ms:03}").trim_end_matches('0'));
    }
    if half_days {
        out.push_str(if hours < 12 { " AM" } else { " PM" });
    }
    out
}

/// A number times 10^`shift`, in the fewest digits that read back as it: written out while that takes at most 20
/// characters, else as `1.5E+20` or `5.4E-05`.
fn written(n: f64, shift: i32, locale: &Locale) -> String {
    if n == 0.0 {
        return "0".into();
    }
    let text = format!("{:e}", n.abs());
    let (mantissa, exponent) = text.split_once('e').expect("an exponent");
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent = exponent.parse::<i32>().expect("an exponent") + shift;
    let sign = if n < 0.0 { "-" } else { "" };
    let out = (-20..20).contains(&exponent).then(|| fixed_text(&digits, exponent));
    let body = out.filter(|t| t.len() <= LONGEST_WRITTEN_OUT).unwrap_or_else(|| {
        let (first, rest) = digits.split_at(1);
        let point = if rest.is_empty() { "" } else { "." };
        format!("{first}{point}{rest}E{}{:02}", if exponent < 0 { '-' } else { '+' }, exponent.abs())
    });
    format!("{sign}{}", body.replace('.', locale.decimal_sign.sign().encode_utf8(&mut [0; 4])))
}

/// Whether a cell's text is written after a `'` to be edited.
pub fn text_is_edited_after_the_mark(text: &str, locale: &Locale) -> bool {
    // An empty text is not: the page writes it as nothing.
    !text.is_empty() && crate::typing::is_read_otherwise(text, locale)
}

/// Whether a cell is under a dropdown (its control): a dropdown option there is picked, not typed.
pub fn has_a_dropdown(sheet: &crate::workbook::Sheet, cell: (crate::ids::LineId, crate::ids::LineId)) -> bool {
    sheet
        .formats
        .get(crate::workbook::formats::Leaf::CellControl, cell)
        .is_some_and(|control| control.get("kind").and_then(|k| k.as_str()) == Some("dropdown"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locale::{en_us, find};

    #[test]
    fn numbers() {
        let en = en_us();
        let de = find("de-DE").unwrap();
        let edited = |n, p| number_is_edited_as(n, p, en);
        assert_eq!(edited(0.015, "0.00%").as_deref(), Some("1.5%"));
        assert_eq!(edited(0.57, "0%").as_deref(), Some("57%"));
        assert_eq!(edited(1e18, "0%").as_deref(), Some("1E+20%"));
        assert_eq!(edited(45000.0, "m/d/yyyy").as_deref(), Some("3/15/2023"));
        assert_eq!(edited(45000.0, "yyyy-mm-ddd").as_deref(), Some("2023-03-15"));
        assert_eq!(edited(45000.5, "m/d/yyyy").as_deref(), Some("45000.5"));
        assert_eq!(edited(-693_593.0, "m/d/yyyy").as_deref(), Some("1/1/0001"));
        assert_eq!(edited(0.1234, "h:mm").as_deref(), Some("2:57:41.76"));
        assert_eq!(edited(0.0, "h:mm AM/PM").as_deref(), Some("12:00 AM"));
        assert_eq!(edited(0.75, "hh:mm A/P").as_deref(), Some("6:00 PM"));
        assert_eq!(edited(0.123456789, "h:mm").as_deref(), Some("0.123456789"));
        assert_eq!(edited(-0.25, "m/d/yyyy h:mm").as_deref(), Some("12/29/1899 18:00"));
        assert_eq!(edited(-0.03, "m/d/yyyy h:mm").as_deref(), Some("12/29/1899 23:16:48"));
        assert_eq!(edited(0.30000000000000004, "m/d/yyyy h:mm").as_deref(), Some("0.30000000000000004"));
        assert_eq!(edited(0.0000547800925925926, "General").as_deref(), Some("5.47800925925926E-05"));
        assert_eq!(edited(0.000098765432109876, "General").as_deref(), Some("0.000098765432109876"));
        assert_eq!(edited(1e-100, "General").as_deref(), Some("1E-100"));
        assert_eq!(edited(45000.0, "m/d/yyyy h:mm").as_deref(), Some("3/15/2023"));
        assert_eq!(edited(0.001, "General").as_deref(), Some("0.001"));
        assert_eq!(edited(1e-19, "General").as_deref(), Some("1E-19"));
        assert_eq!(edited(1e-18, "General").as_deref(), Some("0.000000000000000001"));
        assert_eq!(edited(-1e20, "$#,##0").as_deref(), Some("-1E+20"));
        assert_eq!(edited(0.01, "General"), None);
        assert_eq!(edited(1e19, "General"), None);
        assert_eq!(number_is_edited_as(45000.5, "m/d/yyyy h:mm", de).as_deref(), Some("15.03.2023 12:00"));
        assert_eq!(number_is_edited_as(0.001, "h:mm", de).as_deref(), Some("0:01:26,4"));
        assert_eq!(number_is_edited_as(1.5e-20, "General", de).as_deref(), Some("1,5E-20"));
    }
}
