//! How the texts of an imported column read under a reading (`readTextsUnderAColumnReading`), how well each of
//! several readings fits them (`readFitOfColumnReadings`), and the labels a dropdown column would offer
//! (`readLabelsOfADropdownColumn`).
//!
//! A reading says how the file writes its values: numbers with a point or a comma before the decimals, money with
//! a symbol, percentages, dates in an order, times of day, or labels to pick from. Each text then fits the reading,
//! doesn't, or is blank. The texts are read the same in every locale, but for the names of months and the locale's
//! own ways of writing a date with one.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value as Json};

use crate::dates;
use crate::locale::Locale;

/// The characters trimmed from around a text before it is read.
pub(crate) const SPACES: [char; 4] = ['\t', ' ', '\u{a0}', '\u{202f}'];

/// The most a dropdown label may be, in characters, and how many labels a column gives at most.
const LONGEST_LABEL: usize = 100;
const MOST_LABELS: usize = 101;

/// How many indexes of texts that don't fit a fit lists.
const MOST_NOT_FITTING_LISTED: usize = 5;

/// How a column's texts are to be read.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ColumnReading {
    /// The characters as they are.
    Text {},
    #[serde(rename_all = "camelCase")]
    Number { decimal_sign: DecimalSign, decimal_places: DecimalPlaces, groups_thousands: bool },
    #[serde(rename_all = "camelCase")]
    Currency { decimal_sign: DecimalSign, decimal_places: DecimalPlaces, symbol: CurrencySymbol },
    #[serde(rename_all = "camelCase")]
    Percent { decimal_sign: DecimalSign, decimal_places: DecimalPlaces, number_alone_is: NumberAloneIs },
    #[serde(rename_all = "camelCase")]
    Date { order: DateOrder, shown_as: DateShownAs },
    #[serde(rename_all = "camelCase")]
    DateAndTime { order: DateOrder, shown_as: DateShownAs },
    TimeOfDay {},
    #[serde(rename_all = "camelCase")]
    Dropdown { is_colored: bool },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DecimalSign {
    Point,
    Comma,
}

/// What a number with no `%` means in a percent column: `23` for 23% (`percents`) or `0.23` (`aShareOfOne`).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NumberAloneIs {
    Percents,
    AShareOfOne,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DateOrder {
    YearMonthDay,
    DayMonthYear,
    MonthDayYear,
}

/// How the dates of a column are shown: `yyyy-mm-dd`, or the locale's date with the month named for short.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DateShownAs {
    YearMonthDay,
    MonthNameDayYear,
}

/// Decimal places shown, 0 to 6.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct DecimalPlaces(pub u8);

impl<'de> Deserialize<'de> for DecimalPlaces {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let places = u8::deserialize(deserializer)?;
        if places > 6 {
            return Err(serde::de::Error::custom("too many decimal places"));
        }
        Ok(DecimalPlaces(places))
    }
}

/// A currency's symbol as the cells write it: one to four letters and currency signs (`$`, `€`, `EUR`, `R$`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct CurrencySymbol(pub String);

impl<'de> Deserialize<'de> for CurrencySymbol {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let symbol = String::deserialize(deserializer)?;
        let count = symbol.chars().count();
        if count == 0 || count > 4 || !symbol.chars().all(|c| c.is_alphabetic() || is_currency_sign(c)) {
            return Err(serde::de::Error::custom("not a currency symbol"));
        }
        Ok(CurrencySymbol(symbol))
    }
}

/// A currency sign: Unicode's `Sc`, with the whole Currency Symbols block (U+20A0–U+20CF, signs not yet assigned
/// included).
pub(crate) fn is_currency_sign(c: char) -> bool {
    matches!(c,
        '$' | '\u{a2}'..='\u{a5}' | '\u{58f}' | '\u{60b}' | '\u{7fe}' | '\u{7ff}' | '\u{9f2}' | '\u{9f3}' | '\u{9fb}'
        | '\u{af1}' | '\u{bf9}' | '\u{e3f}' | '\u{17db}' | '\u{20a0}'..='\u{20cf}' | '\u{a838}' | '\u{fdfc}'
        | '\u{fe69}' | '\u{ff04}' | '\u{ffe0}' | '\u{ffe1}' | '\u{ffe5}' | '\u{ffe6}' | '\u{11fdd}'..='\u{11fe0}'
        | '\u{1e2ff}' | '\u{1ecb0}')
}

/// How one text reads.
#[derive(Clone, Debug, PartialEq)]
pub enum Read {
    Number(f64),
    Text(String),
    DoesNotFit,
    Blank,
}

impl Read {
    fn to_json(&self) -> Json {
        match self {
            Read::Number(n) => json!({"kind": "fits", "input": {"kind": "number", "value": n}, "numberFormat": null}),
            Read::Text(t) => json!({"kind": "fits", "input": {"kind": "text", "value": t}, "numberFormat": null}),
            Read::DoesNotFit => json!({"kind": "doesNotFit"}),
            Read::Blank => json!({"kind": "blank"}),
        }
    }
}

impl ColumnReading {
    /// How a text reads under this reading.
    pub fn read(&self, text: &str, locale: &Locale) -> Read {
        if let ColumnReading::Text {} = self {
            return if text.trim_matches(SPACES).is_empty() { Read::Blank } else { Read::Text(text.to_owned()) };
        }
        let t = text.trim_matches(SPACES);
        if t.is_empty() {
            return Read::Blank;
        }
        let number = match self {
            ColumnReading::Text {} => unreachable!(),
            ColumnReading::Dropdown { .. } => {
                return if is_label(t) { Read::Text(t.to_owned()) } else { Read::DoesNotFit };
            }
            ColumnReading::Number { decimal_sign, .. } => read_amount(t, *decimal_sign, None, None),
            ColumnReading::Currency { decimal_sign, symbol, .. } => {
                read_amount(t, *decimal_sign, Some(&symbol.0), None)
            }
            ColumnReading::Percent { decimal_sign, number_alone_is, .. } => {
                read_amount(t, *decimal_sign, None, Some(*number_alone_is))
            }
            ColumnReading::Date { order, .. } => {
                read_date(t, *order, locale).map(|(y, m, d)| dates::serial_from_date(y, m, d) as f64)
            }
            ColumnReading::DateAndTime { order, .. } => read_date_and_time(t, *order, locale),
            ColumnReading::TimeOfDay {} => read_time(t),
        };
        match number {
            // No negative zero.
            Some(n) => Read::Number(if n == 0.0 { 0.0 } else { n }),
            None => Read::DoesNotFit,
        }
    }

    /// The pattern the column's cells get (`#,##0.00`, `[$€]#,##0.00`, `0%`, `yyyy-mm-dd`), if any.
    pub fn pattern(&self, locale: &Locale) -> Option<String> {
        let decimals = |places: DecimalPlaces| {
            if places.0 == 0 {
                String::new()
            } else {
                format!(".{}", "0".repeat(places.0 as usize))
            }
        };
        let date = |shown_as: DateShownAs| match shown_as {
            DateShownAs::YearMonthDay => "yyyy-mm-dd".to_owned(),
            DateShownAs::MonthNameDayYear => {
                locale.patterns_of_dates_with_the_month_named.with_the_month_for_short.to_owned()
            }
        };
        Some(match self {
            ColumnReading::Text {} => "@".to_owned(),
            ColumnReading::Dropdown { .. } => return None,
            ColumnReading::Number { decimal_places, groups_thousands, .. } => {
                format!("{}{}", if *groups_thousands { "#,##0" } else { "0" }, decimals(*decimal_places))
            }
            ColumnReading::Currency { decimal_places, symbol, .. } => {
                let symbol = &symbol.0;
                let before = if symbol == "$" {
                    "$".to_owned()
                } else if symbol.chars().all(char::is_alphabetic) {
                    format!("[${symbol}] ")
                } else {
                    format!("[${symbol}]")
                };
                format!("{before}#,##0{}", decimals(*decimal_places))
            }
            ColumnReading::Percent { decimal_places, .. } => format!("0{}%", decimals(*decimal_places)),
            ColumnReading::Date { shown_as, .. } => date(*shown_as),
            ColumnReading::DateAndTime { shown_as, .. } => format!("{} hh:mm", date(*shown_as)),
            ColumnReading::TimeOfDay {} => "hh:mm".to_owned(),
        })
    }
}

/// How well a reading fits a column's texts. Blank texts count for neither.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fit {
    pub fitting: usize,
    pub not_fitting: usize,
    /// The first few texts that don't fit, by index.
    pub first_not_fitting: Vec<usize>,
    /// For a dropdown, how many different labels the texts give.
    pub options: Option<usize>,
    /// The first reading of the same kind before this one that reads every text the same.
    pub same_as_reading: Option<usize>,
}

/// How each text reads under a reading.
pub fn texts_under_a_column_reading(reading: &ColumnReading, texts: &[String], locale: &Locale) -> Vec<Read> {
    texts.iter().map(|t| reading.read(t, locale)).collect()
}

/// How each of several readings fits the texts.
pub fn fit_of_column_readings(readings: &[ColumnReading], texts: &[String], locale: &Locale) -> Vec<Fit> {
    let reads: Vec<Vec<Read>> = readings.iter().map(|r| texts_under_a_column_reading(r, texts, locale)).collect();
    readings
        .iter()
        .enumerate()
        .map(|(i, reading)| {
            let read = &reads[i];
            let not_fitting: Vec<usize> =
                read.iter().enumerate().filter(|(_, r)| **r == Read::DoesNotFit).map(|(i, _)| i).collect();
            let fitting = read.iter().filter(|r| matches!(r, Read::Number(_) | Read::Text(_))).count();
            let options = match reading {
                ColumnReading::Dropdown { .. } => {
                    let mut seen = hashbrown::HashSet::new();
                    for r in read {
                        if let Read::Text(t) = r {
                            seen.insert(t.to_lowercase());
                        }
                    }
                    Some(seen.len())
                }
                _ => None,
            };
            Fit {
                fitting,
                not_fitting: not_fitting.len(),
                first_not_fitting: not_fitting.into_iter().take(MOST_NOT_FITTING_LISTED).collect(),
                options,
                same_as_reading: (0..i).find(|&j| {
                    std::mem::discriminant(&readings[j]) == std::mem::discriminant(reading) && reads[j] == *read
                }),
            }
        })
        .collect()
}

/// `readTextsUnderAColumnReading`'s answer.
pub fn texts_under_a_column_reading_json(reading: &ColumnReading, texts: &[String], locale: &Locale) -> String {
    let read: Vec<Json> = texts_under_a_column_reading(reading, texts, locale).iter().map(Read::to_json).collect();
    let pattern = reading.pattern(locale).map(|pattern| json!({"pattern": pattern}));
    json!({"kind": "textsUnderAColumnReading", "read": read, "numberFormat": pattern}).to_string()
}

/// `readFitOfColumnReadings`'s answer.
pub fn fit_of_column_readings_json(readings: &[ColumnReading], texts: &[String], locale: &Locale) -> String {
    let fits: Vec<Json> = fit_of_column_readings(readings, texts, locale)
        .into_iter()
        .map(|f| {
            json!({
                "fitting": f.fitting,
                "notFitting": f.not_fitting,
                "firstNotFitting": f.first_not_fitting,
                "options": f.options,
                "sameAsReading": f.same_as_reading,
            })
        })
        .collect();
    json!({"kind": "fitOfColumnReadings", "fits": fits}).to_string()
}

/// Whether a trimmed text may be a dropdown's label: not empty, at most 100 characters, no control characters.
fn is_label(t: &str) -> bool {
    !t.is_empty() && t.chars().count() <= LONGEST_LABEL && !t.chars().any(char::is_control)
}

/// The labels a dropdown column offers: each text trimmed, once whatever its capitals (the first one met), leaving
/// out what can't be a label; at most 101, so that a column with too many shows it.
pub fn labels_of_a_dropdown_column(texts: &[String]) -> Vec<String> {
    let mut seen = hashbrown::HashSet::new();
    let mut labels = Vec::new();
    for text in texts {
        let t = text.trim_matches(SPACES);
        if !is_label(t) || !seen.insert(t.to_lowercase()) {
            continue;
        }
        labels.push(t.to_owned());
        if labels.len() == MOST_LABELS {
            break;
        }
    }
    labels
}

fn trim_start(s: &str) -> &str {
    s.trim_start_matches(SPACES)
}

fn trim_end(s: &str) -> &str {
    s.trim_end_matches(SPACES)
}

fn strip_sign(s: &str) -> Option<(bool, &str)> {
    if let Some(rest) = s.strip_prefix('-').or_else(|| s.strip_prefix('\u{2212}')) {
        Some((true, rest))
    } else {
        s.strip_prefix('+').map(|rest| (false, rest))
    }
}

fn strip_parens(s: &str) -> Option<&str> {
    s.strip_prefix('(').and_then(|s| s.strip_suffix(')')).map(|s| s.trim_matches(SPACES))
}

/// A signed amount with an optional currency symbol (before or after) or percent sign (after): `-1,234.5`,
/// `(5)`, `5-`, `$ -5`, `5 €`, `(5%)`. In a percent column (`percent` says what a number alone is) a percentage is
/// read with its point moved two places left, so that `-0.07%` is exactly `-0.0007`.
fn read_amount(t: &str, sign: DecimalSign, symbol: Option<&str>, percent: Option<NumberAloneIs>) -> Option<f64> {
    let mut negative = false;
    let mut signed = false;
    let mut s = t;
    if let Some(inner) = strip_parens(s) {
        negative = true;
        signed = true;
        s = inner;
    }
    if let Some((minus, rest)) = strip_sign(s) {
        if signed {
            return None;
        }
        negative = minus;
        signed = true;
        s = rest;
    }
    let mut with_symbol = false;
    if let Some(symbol) = symbol {
        if let Some(rest) = s.strip_prefix(symbol) {
            s = trim_start(rest);
            with_symbol = true;
            if !signed {
                if let Some((minus, rest)) = strip_sign(s) {
                    negative = minus;
                    signed = true;
                    s = rest;
                }
            }
        } else if let Some(rest) = s.strip_suffix(symbol) {
            s = trim_end(rest);
            with_symbol = true;
        }
        if with_symbol && !signed {
            if let Some(inner) = strip_parens(s) {
                negative = true;
                signed = true;
                s = inner;
            }
        }
    }
    let mut shift = 0;
    if let Some(alone) = percent {
        if let Some(rest) = s.strip_suffix('%') {
            s = trim_end(rest);
            shift = -2;
        } else if alone == NumberAloneIs::Percents {
            shift = -2;
        }
    }
    if !signed {
        if let Some(rest) = s.strip_suffix('-').or_else(|| s.strip_suffix('\u{2212}')) {
            negative = true;
            s = rest;
        }
    }
    let n = read_decimal(s, sign, shift)?;
    Some(if negative { -n } else { n })
}

/// Digits with groups of three, a decimal sign and an exponent: `1,234.5`, `1 234,5`, `1'234`, `.5`, `1e3`; times
/// ten to the `shift`.
fn read_decimal(s: &str, sign: DecimalSign, shift: i64) -> Option<f64> {
    let (point, groups): (char, &[char]) = match sign {
        DecimalSign::Point => ('.', &[',', ' ', '\u{a0}', '\u{202f}', '\'', '\u{2019}']),
        DecimalSign::Comma => (',', &['.', ' ', '\u{a0}', '\u{202f}', '\'', '\u{2019}']),
    };
    let (mantissa, exponent) = match s.find(['e', 'E']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let (int, frac) = match mantissa.split_once(point) {
        Some((i, f)) => (i, Some(f)),
        None => (mantissa, None),
    };
    if int.is_empty() && frac.is_none_or(str::is_empty) {
        return None;
    }
    let mut digits = String::new();
    if int.contains(groups) {
        let mut parts = int.split(groups);
        let first = parts.next()?;
        if first.is_empty() || first.len() > 3 || !first.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        digits.push_str(first);
        for part in parts {
            if part.len() != 3 || !part.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            digits.push_str(part);
        }
    } else {
        if !int.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        digits.push_str(int);
    }
    if digits.is_empty() {
        digits.push('0');
    }
    if let Some(f) = frac {
        if !f.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        digits.push('.');
        digits.push_str(f);
        digits.push('0');
    }
    let mut power = shift;
    if let Some(e) = exponent {
        let body = e.strip_prefix(['+', '-']).unwrap_or(e);
        if body.is_empty() || !body.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        // An exponent too long for an i64 is as good as infinite.
        let size = body.parse::<i64>().unwrap_or(i64::MAX / 2).min(i64::MAX / 2);
        power += if e.starts_with('-') { -size } else { size };
    }
    if power != 0 {
        digits.push_str(&format!("e{power}"));
    }
    let n: f64 = digits.parse().ok()?;
    n.is_finite().then_some(n)
}

/// `12:30`, `12:30:15`, `12:30:15.5`, `1:30 PM`, `1:30pm`, `12 PM`, as a fraction of a day.
pub(crate) fn read_time(t: &str) -> Option<f64> {
    let lower = t.to_ascii_lowercase();
    let (clock, half) = if let Some(rest) = lower.strip_suffix("am") {
        (trim_end(rest), Some(false))
    } else if let Some(rest) = lower.strip_suffix("pm") {
        (trim_end(rest), Some(true))
    } else {
        (lower.as_str(), None)
    };
    let parts: Vec<&str> = clock.split(':').collect();
    if (parts.len() == 1 && half.is_none()) || parts.len() > 3 {
        return None;
    }
    let mut hour = digits(parts[0], 1, 2)?;
    let minute = match parts.get(1) {
        Some(m) => digits(m, 2, 2)?,
        None => 0,
    };
    let (second, millisecond) = match parts.get(2) {
        Some(s) => {
            let (whole, frac) = match s.split_once('.') {
                Some((w, f)) => (w, Some(f)),
                None => (*s, None),
            };
            let mut ms = 0;
            if let Some(f) = frac {
                if f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                ms = format!("{:0<3}", &f[..f.len().min(3)]).parse::<u32>().ok()?;
            }
            (digits(whole, 2, 2)?, ms)
        }
        None => (0, 0),
    };
    if minute > 59 || second > 59 {
        return None;
    }
    match half {
        Some(pm) => {
            if !(1..=12).contains(&hour) {
                return None;
            }
            hour %= 12;
            if pm {
                hour += 12;
            }
        }
        None if hour > 23 => return None,
        None => {}
    }
    Some((((hour * 60 + minute) * 60 + second) as f64 * 1000.0 + millisecond as f64) / 86_400_000.0)
}

/// Between `min` and `max` ASCII digits, as a number.
pub(crate) fn digits(s: &str, min: usize, max: usize) -> Option<u32> {
    if s.len() < min || s.len() > max || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// A year of two digits (00–49 is 20xx, 50–99 is 19xx) or four.
pub(crate) fn year(s: &str, two_digits: bool) -> Option<i64> {
    match s.len() {
        2 if two_digits => {
            let y = digits(s, 2, 2)? as i64;
            Some(if y < 50 { 2000 + y } else { 1900 + y })
        }
        4 => digits(s, 4, 4).map(i64::from),
        _ => None,
    }
}

/// A real day in years 1 to 9999.
pub(crate) fn day(year: i64, month: u32, day: u32) -> Option<(i64, u32, u32)> {
    ((1..=9999).contains(&year) && dates::is_date(year, month, day)).then_some((year, month, day))
}

pub(crate) const ENGLISH_MONTHS: [&str; 12] =
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/// A month named in English (in full, by its first three letters, or `Sept`) or in the locale's language, in any
/// capitals. Strictly, as a typed day takes it, an English name has no point after it and a locale's name is as it
/// is written or without its point (`Jan.` or `Jan` in de-DE, `ene` but not `ene.` in es-ES); else a point after
/// any name may be there or not.
pub(crate) fn month_named(word: &str, locale: &Locale, strict: bool) -> Option<u32> {
    let lower = word.to_lowercase();
    let english = if strict { lower.as_str() } else { lower.strip_suffix('.').unwrap_or(&lower) };
    if english.is_empty() {
        return None;
    }
    if english == "sept" {
        return Some(9);
    }
    if let Some(i) =
        ENGLISH_MONTHS.iter().position(|m| *m == english || (english.len() == 3 && m.starts_with(english)))
    {
        return Some(i as u32 + 1);
    }
    for list in &MonthNames::of(locale).lists {
        for (i, name) in list.iter().enumerate() {
            if if strict { lower == name.lower || lower == name.lower_bare } else { english == name.lower_bare } {
                return Some(i as u32 + 1);
            }
        }
    }
    None
}

/// A locale's month names as dates read them, with their cases made once: the lists of its names that have any (in
/// full, short, and the two for a date that shows the day), in that order.
pub(crate) struct MonthNames {
    lists: Vec<Vec<MonthName>>,
    /// Whether a name holds a space or a dash (`tháng 5`, `1-р сар`).
    pub(crate) any_spaced: bool,
}

struct MonthName {
    /// In lower case, and so without a point after it ([`month_named`]).
    lower: String,
    lower_bare: String,
    /// As written, and without the sign that ends it short when it has one (`ינו׳`), to find in any capitals
    /// ([`month_starting`]).
    starts: Vec<Capitals>,
}

/// A text with its two cases made, to find at the start of others in any capitals, and the two cases of its first
/// character alone.
struct Capitals {
    text: &'static str,
    lower: String,
    upper: String,
    first: (Option<char>, Option<char>),
}

impl MonthNames {
    /// The locale's month names, made the first time they are asked for.
    pub(crate) fn of(locale: &Locale) -> &'static MonthNames {
        use std::cell::RefCell;
        thread_local! {
            static MADE: RefCell<Vec<(&'static str, &'static MonthNames)>> = const { RefCell::new(Vec::new()) };
        }
        MADE.with(|made| {
            if let Some((_, month_names)) = made.borrow().iter().find(|(tag, _)| *tag == locale.tag) {
                return *month_names;
            }
            let names = locale.names();
            let lists = [names.long, names.short, names.long_with_day, names.short_with_day];
            let any_spaced = lists.iter().any(|list| list.contains([' ', '-']));
            let lists = lists.iter().filter(|list| !list.is_empty()).map(|list| {
                let name = |written: &'static str| {
                    let lower = written.to_lowercase();
                    let lower_bare = lower.strip_suffix('.').unwrap_or(&lower).to_owned();
                    let bare = written.strip_suffix(['.', '\u{5f3}', '\u{970}']).unwrap_or(written);
                    // Without the sign it is the same name when it has none.
                    let starts = [written, bare].into_iter().enumerate().filter(|(i, s)| !s.is_empty() && (*i == 0 || *s != written));
                    let starts = starts.map(|(_, text)| {
                        let (lower, upper) = (text.to_lowercase(), text.to_uppercase());
                        let first = text.chars().next().map(|c| (c.to_lowercase().next(), c.to_uppercase().next()));
                        Capitals { text, lower, upper, first: first.unwrap_or_default() }
                    });
                    MonthName { lower, lower_bare, starts: starts.collect() }
                };
                list.split('|').map(name).collect()
            });
            let month_names: &'static MonthNames = Box::leak(Box::new(MonthNames { lists: lists.collect(), any_spaced }));
            made.borrow_mut().push((locale.tag, month_names));
            month_names
        })
    }
}

/// Three numbers with `/`, `-` or `.` between them; between points spaces may follow each, and a point may end it:
/// `1/2/2020`, `1. 2. 2020`, `2020. 1. 2.`.
pub(crate) fn numbers_of_a_date(t: &str) -> Option<([&str; 3], char)> {
    let separator = t.chars().find(|c| !c.is_ascii_digit())?;
    if !matches!(separator, '/' | '-' | '.') {
        return None;
    }
    let pointed = separator == '.';
    let t = if pointed { t.strip_suffix('.').unwrap_or(t) } else { t };
    let parts: Vec<&str> = t.split(separator).collect();
    if parts.len() != 3 {
        return None;
    }
    let parts =
        if pointed { [parts[0], trim_start(parts[1]), trim_start(parts[2])] } else { [parts[0], parts[1], parts[2]] };
    parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())).then_some((parts, separator))
}

/// A date in a column read in an order: numbers (a year of four digits first is always year, month, day); one of
/// the locale's ways with the month named; or three words with a month named first (`Jan 2, 2020`, the year of four
/// digits) or between (`2 Jan 20`, and `20 Jan 2` in the year-first order).
fn read_date(t: &str, order: DateOrder, locale: &Locale) -> Option<(i64, u32, u32)> {
    if let Some(([a, b, c], _)) = numbers_of_a_date(t) {
        if a.len() == 4 {
            return day(year(a, false)?, digits(b, 1, 2)?, digits(c, 1, 2)?);
        }
        return match order {
            DateOrder::MonthDayYear => day(year(c, true)?, digits(a, 1, 2)?, digits(b, 1, 2)?),
            DateOrder::DayMonthYear => day(year(c, true)?, digits(b, 1, 2)?, digits(a, 1, 2)?),
            DateOrder::YearMonthDay => day(year(a, true)?, digits(b, 1, 2)?, digits(c, 1, 2)?),
        };
    }
    if let Some(d) = date_by_template(t, locale) {
        return Some(d);
    }
    let words: Vec<&str> =
        t.split(|c: char| SPACES.contains(&c) || matches!(c, ',' | '-' | '.' | '/')).filter(|w| !w.is_empty()).collect();
    let [a, b, c] = words[..] else { return None };
    // The month first: the year last, of four digits.
    if let Some(month) = month_named(a, locale, false) {
        return day(year(c, false)?, month, digits(b, 1, 2)?);
    }
    // The month between: the year is the number of four digits, else first in the year-first order and last in the
    // others.
    let month = month_named(b, locale, false)?;
    if a.len() == 4 || (c.len() != 4 && order == DateOrder::YearMonthDay) {
        day(year(a, true)?, month, digits(c, 1, 2)?)
    } else {
        day(year(c, true)?, month, digits(a, 1, 2)?)
    }
}

/// A date written as one of the locale's patterns with the month named (`yyyy"年"m"月"d"日"`, `d. mmmm yyyy`,
/// `yyyy"년" mmmm d"일"`), in any capitals. Months are named as [`month_named`] takes them strictly, or by a name of
/// the locale's as a whole ([`month_starting`]), and what a pattern writes after its last number may be left out
/// (`9. sij 2020` for `d. mmm yyyy.` in hr-HR, `2020年1月9`).
pub(crate) fn date_by_template(t: &str, locale: &Locale) -> Option<(i64, u32, u32)> {
    Templates::of(locale).dates.iter().find_map(|p| match match_template(t, p, locale)? {
        (Some(y), m, d, _) => day(y, m, d),
        _ => None,
    })
}

/// Whether a text is written as one of the locale's patterns with the month named, its ending and all.
pub(crate) fn date_by_whole_template(t: &str, locale: &Locale) -> bool {
    let dates = &Templates::of(locale).dates;
    dates.iter().any(|p| matches!(match_template(t, p, locale), Some((Some(y), m, d, true)) if day(y, m, d).is_some()))
}

/// Whether a text is a month and a day written as one of the locale's patterns with the month named: its pattern for
/// the two (`Jan 2` in en-US, `2. Jan.` in de-DE, `1월 2일` or `Jan 2` in ko-KR), or one for a date without the year
/// and what joins it on (`2 de enero` in es-ES, `ಜನ 2` in kn-IN); in English, `Jan 2` everywhere. The 29th of
/// February too.
pub(crate) fn month_and_day_by_template(t: &str, locale: &Locale) -> bool {
    let months_and_days = &Templates::of(locale).months_and_days;
    months_and_days.iter().any(|p| matches!(match_template(t, p, locale), Some((None, m, d, _)) if day(2000, m, d).is_some()))
}

/// A locale's patterns with the month named as [`match_template`] walks them, made once: of a date (in full, then
/// for short), and of a month and a day ([`month_and_day_by_template`]).
struct Templates {
    dates: [Vec<char>; 2],
    months_and_days: Vec<Vec<char>>,
}

impl Templates {
    /// The locale's patterns, made the first time they are asked for (each locale is the table's, one a tag).
    fn of(locale: &Locale) -> &'static Templates {
        use std::cell::RefCell;
        thread_local! {
            static MADE: RefCell<Vec<(&'static str, &'static Templates)>> = const { RefCell::new(Vec::new()) };
        }
        MADE.with(|made| {
            if let Some((_, templates)) = made.borrow().iter().find(|(tag, _)| *tag == locale.tag) {
                return *templates;
            }
            let named = locale.patterns_of_dates_with_the_month_named;
            let chars = |p: &str| p.chars().collect::<Vec<char>>();
            let english = locale.tag.starts_with("en-").then_some("mmm d");
            let months_and_days = [named.with_the_month_in_full, named.with_the_month_for_short]
                .into_iter()
                .map(without_the_year)
                .chain([named.month_and_day.to_owned()])
                .chain(english.map(str::to_owned))
                .map(|p| chars(&p));
            let dates = [chars(named.with_the_month_in_full), chars(named.with_the_month_for_short)];
            let templates: &'static Templates =
                Box::leak(Box::new(Templates { dates, months_and_days: months_and_days.collect() }));
            made.borrow_mut().push((locale.tag, templates));
            templates
        })
    }
}

/// A pattern of a date without its year, and the text between the year and the month or day next to it (`d "de"
/// mmmm` for `d "de" mmmm "de" yyyy`, `m"月"d"日"` for `yyyy"年"m"月"d"日"`).
fn without_the_year(pattern: &str) -> String {
    // Pieces: a run of one field letter, a quoted text, an escaped character, or any other character.
    let mut pieces: Vec<&str> = Vec::new();
    let mut rest = pattern;
    while let Some(c) = rest.chars().next() {
        let n = match c {
            'y' | 'm' | 'd' => rest.len() - rest.trim_start_matches(c).len(),
            '"' => rest[1..].find('"').map_or(rest.len(), |end| end + 2),
            '\\' => 1 + rest[1..].chars().next().map_or(0, char::len_utf8),
            _ => c.len_utf8(),
        };
        pieces.push(&rest[..n]);
        rest = &rest[n..];
    }
    let field = |p: &&str| p.starts_with(['m', 'd']);
    let Some(year) = pieces.iter().position(|p| p.starts_with('y')) else { return pattern.to_owned() };
    let before = pieces[..year].iter().rposition(field);
    let after = pieces[year..].iter().position(field).map(|i| year + i);
    match (before, after) {
        (Some(b), _) => pieces[..=b].concat() + &after.map_or(String::new(), |a| pieces[a..].concat()),
        (None, Some(a)) => pieces[a..].concat(),
        (None, None) => String::new(),
    }
}

/// The year (if the pattern has one), month and day, and whether the text went on to the pattern's end.
fn match_template(t: &str, p: &[char], locale: &Locale) -> Option<(Option<i64>, u32, u32, bool)> {
    // No field takes a space, and no case of a character is one: but for a name of the locale's that holds one,
    // every space of the text is one the pattern writes.
    let spaces = |chars: &mut dyn Iterator<Item = char>| chars.filter(|&c| c == ' ').count();
    if !MonthNames::of(locale).any_spaced && spaces(&mut t.chars()) > spaces(&mut p.iter().copied()) {
        return None;
    }
    let mut quoted = false;
    let wants_year = p.iter().any(|&c| {
        quoted ^= c == '"';
        !quoted && c == 'y'
    });
    let mut s = t;
    let (mut y, mut m, mut d) = (None, None, None);
    let mut i = 0;
    while i < p.len() {
        let c = p[i];
        if s.is_empty() && (y.is_some() || !wants_year) && m.is_some() && d.is_some() {
            break;
        }
        let run = p[i..].iter().take_while(|&&x| x == c).count();
        match c {
            'y' => {
                let n = s.bytes().take_while(u8::is_ascii_digit).count();
                y = Some(year(&s[..n], run <= 2)?);
                s = &s[n..];
                i += run;
            }
            'd' => {
                let n = s.bytes().take_while(u8::is_ascii_digit).count();
                d = Some(digits(&s[..n], 1, 2)?);
                s = &s[n..];
                i += run;
            }
            'm' if run <= 2 => {
                let n = s.bytes().take_while(u8::is_ascii_digit).count();
                m = Some(digits(&s[..n], 1, 2)?);
                s = &s[n..];
                i += run;
            }
            'm' => {
                // Letters, digits (`1월`) and points.
                let n: usize = s.chars().take_while(|c| c.is_alphanumeric() || *c == '.').map(char::len_utf8).sum();
                let word = &s[..n];
                // A point after the name may be the pattern's own.
                let (word, n) = match (word.strip_suffix('.'), p.get(i + run)) {
                    (Some(w), Some('.')) => (w, n - 1),
                    _ => (word, n),
                };
                // Else one of the locale's names as a whole, which may hold spaces and marks (`Meán Fómhair`,
                // `tháng 1`, `ינו׳`), with or without the sign that ends it short (`ינו`).
                let (month, n) = match month_named(word, locale, true) {
                    Some(month) => (month, n),
                    None => month_starting(s, locale)?,
                };
                m = Some(month);
                s = &s[n..];
                i += run;
            }
            '"' => {
                let end = p[i + 1..].iter().position(|&x| x == '"')? + i + 1;
                let lit: String = p[i + 1..end].iter().collect();
                s = after_in_any_capitals(s, &lit)?;
                i = end + 1;
            }
            '\\' => {
                let lit = *p.get(i + 1)?;
                s = after_in_any_capitals(s, lit.encode_utf8(&mut [0; 4]))?;
                i += 2;
            }
            _ => {
                s = after_in_any_capitals(s, c.encode_utf8(&mut [0; 4]))?;
                i += 1;
            }
        }
    }
    if !s.is_empty() {
        return None;
    }
    Some((y, m?, d?, i >= p.len()))
}

/// The month whose name in the locale's language starts a text (the longest such name), and the bytes it takes.
pub(crate) fn month_starting(t: &str, locale: &Locale) -> Option<(u32, usize)> {
    // The two cases of the text's first character, for every name ([`starting_in_cases`]).
    let a = t.chars().next()?;
    let (a_lower, a_upper) = (a.to_lowercase().next(), a.to_uppercase().next());
    let mut found: Option<(u32, usize)> = None;
    for list in &MonthNames::of(locale).lists {
        for (i, name) in list.iter().enumerate() {
            for start in &name.starts {
                if start.first.0 != a_lower && start.first.1 != a_upper && !t.starts_with(start.text) {
                    continue;
                }
                if let Some(n) = starting_in_cases(t, start.text, Some((&start.lower, &start.upper))) {
                    if found.is_none_or(|(_, longest)| n > longest) {
                        found = Some((i as u32 + 1, n));
                    }
                }
            }
        }
    }
    found
}

/// The bytes at the start of a text that are another text in any capitals (`DE` for `de`, `ΜΑΪ́ΟΥ` for `μαΐου`).
fn starting_in_any_capitals(t: &str, start: &str) -> Option<usize> {
    starting_in_cases(t, start, None)
}

/// The same, given the two cases of the other text when they are made already.
fn starting_in_cases(t: &str, start: &str, cases: Option<(&str, &str)>) -> Option<usize> {
    if t.starts_with(start) {
        return Some(start.len());
    }
    // The first characters are cased alone (a sigma first is never a final one): when neither case of them is the
    // same, no start of the text is (most texts against most names, and without making the cases of either).
    let (Some(a), Some(b)) = (t.chars().next(), start.chars().next()) else { return None };
    if a.to_lowercase().next() != b.to_lowercase().next() && a.to_uppercase().next() != b.to_uppercase().next() {
        return None;
    }
    // Letters of ASCII keep their length in either case, and every other character makes at least one: a start of
    // ASCII matches only as long a start of ASCII, letter for letter.
    if start.is_ascii() {
        match t.as_bytes().get(..start.len()) {
            Some(head) if head.is_ascii() => return head.eq_ignore_ascii_case(start.as_bytes()).then_some(start.len()),
            None if t.is_ascii() => return None,
            _ => {}
        }
    }
    let made;
    let (lower, upper) = match cases {
        Some(cases) => cases,
        None => {
            made = (start.to_lowercase(), start.to_uppercase());
            (made.0.as_str(), made.1.as_str())
        }
    };
    let mut ends = t.char_indices().map(|(i, c)| i + c.len_utf8()).take(start.chars().count() + 2);
    ends.find(|&n| t[..n].to_lowercase() == lower || t[..n].to_uppercase() == upper)
}

/// What follows the start of a text that is another text in any capitals.
fn after_in_any_capitals<'a>(t: &'a str, start: &str) -> Option<&'a str> {
    starting_in_any_capitals(t, start).map(|n| &t[n..])
}

/// A date and a time of day with its minutes (`3:04 PM`, not `3 PM`), with a space, a `T` or a comma between them.
fn read_date_and_time(t: &str, order: DateOrder, locale: &Locale) -> Option<f64> {
    for (i, c) in t.char_indices().rev() {
        if SPACES.contains(&c) || c == 'T' {
            let date = trim_end(&t[..i]);
            let date = date.strip_suffix(',').unwrap_or(date);
            let after = &t[i + c.len_utf8()..];
            // After a `T` the time comes at once.
            let time = if c == 'T' { after } else { trim_start(after) };
            if !time.contains(':') || time.starts_with(SPACES) {
                continue;
            }
            if let (Some((y, m, d)), Some(time)) = (read_date(date, order, locale), read_time(time)) {
                return Some(dates::serial_from_date(y, m, d) as f64 + time);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locale;

    fn reading(json: &str) -> ColumnReading {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn numbers() {
        let en = locale::en_us();
        let point = reading(r#"{"kind":"number","decimalSign":"point","decimalPlaces":2,"groupsThousands":true}"#);
        let comma = reading(r#"{"kind":"number","decimalSign":"comma","decimalPlaces":0,"groupsThousands":false}"#);
        for (text, n) in [("1,234.5", 1234.5), ("(4)", -4.0), ("5-", -5.0), ("1 234", 1234.0), (".5", 0.5), ("1e3", 1000.0)] {
            assert_eq!(point.read(text, en), Read::Number(n), "{text}");
        }
        for (text, n) in [("1.234,5", 1234.5), ("1,5", 1.5), ("5,", 5.0)] {
            assert_eq!(comma.read(text, en), Read::Number(n), "{text}");
        }
        assert_eq!(point.read("1,5", en), Read::DoesNotFit);
        assert_eq!(point.read("  ", en), Read::Blank);
        assert_eq!(point.pattern(en).as_deref(), Some("#,##0.00"));
        assert_eq!(comma.pattern(en).as_deref(), Some("0"));
    }

    #[test]
    fn money_and_percents() {
        let en = locale::en_us();
        let dollars = reading(r#"{"kind":"currency","decimalSign":"point","decimalPlaces":2,"symbol":"$"}"#);
        for (text, n) in [("$5", 5.0), ("-$5", -5.0), ("$ -5", -5.0), ("5-$", -5.0), ("$(5)", -5.0), ("(5)$", -5.0)] {
            assert_eq!(dollars.read(text, en), Read::Number(n), "{text}");
        }
        for text in ["- $5", "5$-", "$$5", "(-$5)", "€5"] {
            assert_eq!(dollars.read(text, en), Read::DoesNotFit, "{text}");
        }
        let euros = reading(r#"{"kind":"currency","decimalSign":"comma","decimalPlaces":2,"symbol":"EUR"}"#);
        assert_eq!(euros.pattern(en).as_deref(), Some("[$EUR] #,##0.00"));
        let percents = reading(r#"{"kind":"percent","decimalSign":"point","decimalPlaces":0,"numberAloneIs":"percents"}"#);
        assert_eq!(percents.read("5", en), Read::Number(0.05));
        assert_eq!(percents.read("(5%)", en), Read::Number(-0.05));
    }

    #[test]
    fn dates() {
        let en = locale::en_us();
        let mdy = reading(r#"{"kind":"date","order":"monthDayYear","shownAs":"monthNameDayYear"}"#);
        let dmy = reading(r#"{"kind":"date","order":"dayMonthYear","shownAs":"yearMonthDay"}"#);
        assert_eq!(mdy.read("1/2/2020", en), Read::Number(43832.0));
        assert_eq!(dmy.read("1/2/2020", en), Read::Number(43862.0));
        assert_eq!(dmy.read("2020-01-02", en), Read::Number(43832.0));
        assert_eq!(mdy.read("Jan 2, 2020", en), Read::Number(43832.0));
        assert_eq!(mdy.pattern(en).as_deref(), Some("mmm d, yyyy"));
    }

    #[test]
    fn months_and_days() {
        assert_eq!(without_the_year("mmm d,yyyy"), "mmm d");
        assert_eq!(without_the_year(r#"d "de" mmmm "de" yyyy"#), r#"d "de" mmmm"#);
        assert_eq!(without_the_year(r#"yyyy"年"m"月"d"日""#), r#"m"月"d"日""#);
        assert_eq!(without_the_year(r#"d mmm yyyy "г.""#), "d mmm");
        let (en_gb, kn, de) = (locale::find("en-GB").unwrap(), locale::find("kn-IN").unwrap(), locale::find("de-DE").unwrap());
        assert!(month_and_day_by_template("Jan 2", en_gb));
        assert!(month_and_day_by_template("Feb 29", en_gb));
        assert!(!month_and_day_by_template("Feb 30", en_gb));
        assert!(month_and_day_by_template("ಜನ 2", kn));
        assert!(!month_and_day_by_template("ಜನ 2,", kn));
        assert!(month_and_day_by_template("2. Jan.", de));
        assert!(!month_and_day_by_template("Jan 2", de));
    }

    #[test]
    fn labels() {
        let texts: Vec<String> = ["a", " A ", "b", "", "x\u{1}"].iter().map(|s| s.to_string()).collect();
        assert_eq!(labels_of_a_dropdown_column(&texts), ["a", "b"]);
    }
}
