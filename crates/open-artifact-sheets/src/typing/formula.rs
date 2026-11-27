//! A typed formula as a cell keeps it: its text written the en-US way, cut at its references, each reference naming
//! its sheet, rows and columns by id.
//!
//! A reference is a cell (`A1`, `$A$1`), a range of two cells (`A1:B2`), columns (`A:B`, `A2:B` from a row down),
//! or rows (`2:3`, `B2:3` from a column right), with a sheet's name before it (`Other!A1`, `'My Sheet'!A1:B2`,
//! capitals aside) or on the formula's own sheet. It must be in the sheet: past its last row or column it is no
//! reference, and neither is anything on a sheet the workbook doesn't have, nor a name followed by `(` (a call).
//! The ends of a range are put in order, each keeping its `$`. A number with an end glued to it, and what `:` joins
//! to that end (`99.A1:A3`), is no reference either. Everything else stays as typed.

pub(crate) mod names;

use crate::formula::{
    column_index, column_letters, CellPoint, ColumnPoint, Reference, RowPoint, StoredFormula, TableColumns, TableRows,
};
use crate::locale::{DecimalSign, Locale};
use crate::workbook::{Sheet, Workbook};

#[derive(Clone, Debug, PartialEq)]
enum Token {
    /// Characters up to the next punctuation or space: a name, a number, a reference.
    Word(String),
    /// A sheet's name in single quotes, as it reads unquoted.
    Quoted(String),
    /// A text in double quotes.
    Text,
    Punctuation(char),
    Space,
}

/// Characters that end a word.
fn is_punctuation(c: char) -> bool {
    matches!(
        c,
        '=' | '(' | ')' | ',' | ';' | ':' | '-' | '+' | '*' | '/' | '^' | '&' | '<' | '>' | '@' | '#' | '?' | '\\'
            | '{' | '}' | '[' | ']' | '|' | '~' | '`' | '%' | '!' | '"' | '\''
    ) || (c.is_ascii_control() && !is_space(c))
}

/// Characters between words: a call's name may have them before its `(`. Other spaces (no-break ones, say) are
/// part of a word.
fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

/// The tokens of a text, each with the range of characters it takes.
fn lex(chars: &[char]) -> Vec<(Token, usize, usize)> {
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let start = i;
        let c = chars[i];
        let token = match c {
            '"' | '\'' => {
                let mut inside = String::new();
                i += 1;
                while i < chars.len() {
                    if chars[i] == c {
                        if chars.get(i + 1) == Some(&c) {
                            inside.push(c);
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    inside.push(chars[i]);
                    i += 1;
                }
                if c == '"' {
                    Token::Text
                } else {
                    Token::Quoted(inside)
                }
            }
            c if is_space(c) => {
                while i < chars.len() && is_space(chars[i]) {
                    i += 1;
                }
                Token::Space
            }
            c if is_punctuation(c) => {
                i += 1;
                Token::Punctuation(c)
            }
            _ => {
                while i < chars.len() && !is_punctuation(chars[i]) && !is_space(chars[i]) {
                    i += 1;
                }
                Token::Word(chars[start..i].iter().collect())
            }
        };
        tokens.push((token, start, i));
    }
    tokens
}

/// One end of a reference as written: a cell, a column or a row, each part with its `$`.
#[derive(Clone, Copy, Debug)]
enum End {
    Cell { column: (usize, bool), row: (usize, bool) },
    Column(usize, bool),
    Row(usize, bool),
}

fn end_of(word: &str) -> Option<End> {
    let (column_absolute, rest) = match word.strip_prefix('$') {
        Some(rest) => (true, rest),
        None => (false, word),
    };
    let letters = rest.bytes().take_while(u8::is_ascii_alphabetic).count();
    let (column, rest) = rest.split_at(letters);
    let (row_absolute, digits) = match rest.strip_prefix('$') {
        Some(d) => (true, d),
        None => (false, rest),
    };
    let row = if digits.is_empty() {
        None
    } else {
        if !digits.bytes().all(|b| b.is_ascii_digit()) || digits.starts_with('0') {
            return None;
        }
        Some(digits.parse::<usize>().ok()?.checked_sub(1)?)
    };
    match (column.is_empty(), row) {
        (false, Some(row)) => Some(End::Cell { column: (column_index(column)?, column_absolute), row: (row, row_absolute) }),
        (false, None) if !row_absolute => Some(End::Column(column_index(column)?, column_absolute)),
        (true, Some(row)) if !column_absolute || !row_absolute => {
            // `$2` is a row; `$$2` is nothing.
            Some(End::Row(row, column_absolute || row_absolute))
        }
        _ => None,
    }
}

/// Whether an end is in the sheet.
fn fits(end: End, sheet: &Sheet) -> bool {
    let (rows, columns) = (sheet.rows.len(), sheet.columns.len());
    match end {
        End::Cell { column, row } => column.0 < columns && row.0 < rows,
        End::Column(c, _) => c < columns,
        End::Row(r, _) => r < rows,
    }
}

/// What starts at a token.
enum Found {
    /// No reference.
    Nothing,
    /// Something written as a reference that isn't one, up to the token given: a call (`A1(2)`), or cells that
    /// aren't there (on a sheet the workbook doesn't have, past the sheet's last row or column, a range with its
    /// ends on two sheets). It stays text.
    Text(usize),
    /// A reference, up to the token given.
    One(Reference, usize),
}

/// The formula's text the en-US way and its references, names of named ranges among them (`names`).
pub fn stored(text: &str, workbook: &Workbook, sheet: usize, locale: &Locale) -> StoredFormula {
    let text = from_locale(text, locale);
    let chars: Vec<char> = text.chars().collect();
    let tokens = lex(&chars);
    let mut pieces = Vec::new();
    let mut references = Vec::new();
    let mut last = 0;
    let mut i = 0;
    while i < tokens.len() {
        let found = match table_reference_at(&chars, &tokens, i, workbook) {
            Found::Nothing => reference_at(&tokens, i, workbook, sheet),
            found => found,
        };
        match found {
            Found::Nothing => i += 1,
            Found::Text(next) => i = next,
            Found::One(reference, next) => {
                let (start, end) = (tokens[i].1, tokens[next - 1].2);
                pieces.push(chars[last..start].iter().collect());
                references.push(reference);
                last = end;
                i = next;
            }
        }
    }
    pieces.push(chars[last..].iter().collect());
    names::named(workbook, StoredFormula { text_between_references: pieces, references })
}

/// A reference to a connected table at token `i`: its name (capitals aside), alone (its records) or with what of it
/// is taken between brackets: `[]` (its records), `[Id]` (a column's records), `[#Headers]`, `[#Data]`, `[#All]`,
/// or a list of those and a column or two columns joined by `:` (`[[#All],[Id]:[Name]]`). A name followed by
/// brackets that take nothing it has (`Customers[Nope]`, `Customers[#Totals]`) is text, brackets and all.
fn table_reference_at(chars: &[char], tokens: &[(Token, usize, usize)], i: usize, workbook: &Workbook) -> Found {
    let name = match &tokens[i].0 {
        Token::Word(w) => w,
        Token::Quoted(q) if chars.get(tokens[i].2) == Some(&'[') => q,
        _ => return Found::Nothing,
    };
    if i > 0 && tokens[i - 1].0 == Token::Punctuation('[') {
        return Found::Nothing;
    }
    // The token that starts where the brackets end, when one does.
    let token_at = |end: usize| tokens.iter().position(|t| t.1 >= end).unwrap_or(tokens.len());
    let fits = |k: usize, end: usize| k == tokens.len() && tokens.last().is_some_and(|t| t.2 == end) || tokens.get(k).is_some_and(|t| t.1 == end);
    let at = tokens[i].2;
    let lower = name.to_lowercase();
    let Some(sheet) = workbook.sheets.iter().find(|s| s.connected.table.is_some() && s.name.to_lowercase() == lower) else {
        // A word right before brackets, a cell's name too (`A1[x]`), is a name no table has: text, brackets and all;
        // not one after a sheet's name or `:`, nor one with a `$`.
        let after_sheet_or_colon = i > 0 && matches!(tokens[i - 1].0, Token::Punctuation('!' | ':'));
        if matches!(tokens[i].0, Token::Word(_)) && !name.contains('$') && !after_sheet_or_colon && chars.get(at) == Some(&'[') {
            if let Some(end) = closing_bracket(chars, at).filter(|&end| fits(token_at(end), end)) {
                return Found::Text(token_at(end));
            }
        }
        return Found::Nothing;
    };
    let sheet_id = sheet.id.clone();
    if chars.get(at) != Some(&'[') {
        let is_token = |k: Option<usize>, token: Token| k.and_then(|k| tokens.get(k)).is_some_and(|t| t.0 == token);
        // A name of letters alone beside `:` is read as a column's letters (see `reference_at`).
        let beside_colon = is_token(i.checked_sub(1), Token::Punctuation(':')) || is_token(Some(i + 1), Token::Punctuation(':'));
        if !matches!(tokens[i].0, Token::Word(_))
            || calls(tokens, i + 1)
            || is_token(Some(i + 1), Token::Punctuation('!'))
            || (beside_colon && name.bytes().all(|b| b.is_ascii_alphabetic()))
        {
            return Found::Nothing;
        }
        // Brackets after spaces take nothing of it: the name and they are text.
        if is_token(Some(i + 1), Token::Space) && chars.get(tokens[i + 1].2) == Some(&'[') {
            let k = closing_bracket(chars, tokens[i + 1].2).map_or(i + 1, |end| {
                tokens.iter().position(|t| t.1 >= end).filter(|&k| tokens[k].1 == end).unwrap_or(i + 1)
            });
            return Found::Text(k.max(i + 1));
        }
        return Found::One(Reference::TablePart { sheet_id, columns: None, rows: TableRows::Records }, i + 1);
    }
    match table_part(chars, at, workbook, sheet) {
        Some((reference, end)) => {
            let k = token_at(end);
            if !fits(k, end) {
                return Found::Nothing;
            }
            Found::One(reference(sheet_id), k)
        }
        None => match closing_bracket(chars, at) {
            Some(end) if fits(token_at(end), end) => Found::Text(token_at(end)),
            _ => Found::Nothing,
        },
    }
}

/// Whether a word is letters alone, too many of them for a column's.
fn is_past_the_sheet(word: &str) -> bool {
    word.len() > 7 && word.bytes().all(|b| b.is_ascii_alphabetic())
}

/// The character past the bracket that closes the one at `at`, brackets inside counted.
fn closing_bracket(chars: &[char], at: usize) -> Option<usize> {
    let mut depth = 0;
    let mut k = at;
    while k < chars.len() {
        match chars[k] {
            '\'' => k += 1,
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(k + 1);
                }
            }
            _ => {}
        }
        k += 1;
    }
    None
}

/// What of a connected table the brackets at `at` take, and the character past them.
#[allow(clippy::type_complexity)]
fn table_part(chars: &[char], at: usize, workbook: &Workbook, sheet: &Sheet) -> Option<(Box<dyn Fn(String) -> Reference>, usize)> {
    #[derive(Clone, Copy, PartialEq)]
    enum Item {
        Rows(TableRows, bool),
        Columns(usize, usize),
    }
    // A column's name between brackets (`'` takes the character after it as it is), and the character past them.
    let column = |k: usize| -> Option<(usize, usize)> {
        if chars.get(k) != Some(&'[') {
            return None;
        }
        let mut name = String::new();
        let mut k = k + 1;
        loop {
            match *chars.get(k)? {
                '\'' => {
                    name.push(*chars.get(k + 1)?);
                    k += 2;
                }
                ']' => break,
                '[' | '#' => return None,
                c => {
                    name.push(c);
                    k += 1;
                }
            }
        }
        let lower = name.to_lowercase();
        let p = sheet.columns.lines().iter().position(|l| {
            sheet.connected.columns.get(l).is_some_and(|c| c.name.to_lowercase() == lower)
        })?;
        Some((p, k + 1))
    };
    let keyword = |k: usize| -> Option<(Item, usize)> {
        if chars.get(k) != Some(&'[') || chars.get(k + 1) != Some(&'#') {
            return None;
        }
        let end = (k + 2..chars.len()).find(|&e| chars[e] == ']')?;
        let word: String = chars[k + 2..end].iter().collect::<String>().to_lowercase();
        let item = match word.as_str() {
            "headers" => Item::Rows(TableRows::Heading, false),
            "data" => Item::Rows(TableRows::Records, true),
            "all" => Item::Rows(TableRows::HeadingAndRecords, false),
            _ => return None,
        };
        Some((item, end + 1))
    };
    // A column, or two joined by `:`.
    let columns = |k: usize| -> Option<(Item, usize)> {
        let (a, k) = column(k)?;
        let mut colon = k;
        while chars.get(colon).is_some_and(|&c| is_space(c)) {
            colon += 1;
        }
        if chars.get(colon) == Some(&':') {
            let mut k = colon + 1;
            while chars.get(k).is_some_and(|&c| is_space(c)) {
                k += 1;
            }
            let (b, k) = column(k)?;
            return Some((Item::Columns(a.min(b), a.max(b)), k));
        }
        Some((Item::Columns(a, a), k))
    };
    let spaces = |mut k: usize| {
        while chars.get(k).is_some_and(|&c| is_space(c)) {
            k += 1;
        }
        k
    };
    let mut items = Vec::new();
    let end = match chars.get(at + 1)? {
        ']' => at + 2,
        '#' => {
            let (item, k) = keyword(at)?;
            items.push(item);
            k
        }
        // A list between brackets: spaces may stand around its items, its `,` and its `:`.
        _ if chars.get(spaces(at + 1)) == Some(&'[') => {
            let mut k = spaces(at + 1);
            loop {
                let (item, next) = keyword(k).or_else(|| columns(k))?;
                items.push(item);
                k = spaces(next);
                match chars.get(k)? {
                    ',' => k = spaces(k + 1),
                    ']' => break k + 1,
                    _ => return None,
                }
            }
        }
        _ => {
            let (p, k) = column(at)?;
            items.push(Item::Columns(p, p));
            k
        }
    };
    // The rows first, `#Headers` and `#Data` together or one of the three alone, then the columns, once.
    let (spanned, kinds) = match items.split_last() {
        Some((&Item::Columns(a, b), kinds)) => (Some((a, b)), kinds),
        _ => (None, &items[..]),
    };
    let kinds: Vec<TableRows> =
        kinds.iter().map(|item| match item { Item::Rows(rows, _) => Some(*rows), Item::Columns(..) => None }).collect::<Option<_>>()?;
    let rows = match kinds[..] {
        [] | [TableRows::Records] => TableRows::Records,
        [TableRows::Heading] => TableRows::Heading,
        [TableRows::HeadingAndRecords] | [TableRows::Heading, TableRows::Records] => TableRows::HeadingAndRecords,
        _ => return None,
    };
    let id = |p: usize| workbook.bases.text(sheet.columns.line(p).expect("a column"));
    let reference: Box<dyn Fn(String) -> Reference> = match spanned {
        None => Box::new(move |sheet_id| Reference::TablePart { sheet_id, columns: None, rows }),
        Some((a, b)) if a == b && rows != TableRows::Heading => {
            let c = id(a);
            let has_its_heading = rows == TableRows::HeadingAndRecords;
            Box::new(move |sheet_id| Reference::TableColumn { sheet_id, c: c.clone(), has_its_heading })
        }
        Some((a, b)) => {
            let columns = TableColumns { left: id(a), right: id(b) };
            Box::new(move |sheet_id| Reference::TablePart { sheet_id, columns: Some(columns.clone()), rows })
        }
    };
    Some((reference, end))
}

/// Whether a word before `!` names a sheet: not with a `$` in it, nor starting with `.`, nor a number (`1`,
/// `1.5`, `1e5`).
fn is_sheet_name(word: &str) -> bool {
    if word.contains('$') || word.starts_with('.') {
        return false;
    }
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit() || b == b'.');
    let number = match word.find(['e', 'E']) {
        Some(e) => digits(&word[..e]) && word.len() > e + 1 && digits(&word[e + 1..]),
        None => digits(word),
    };
    !(word.starts_with(|c: char| c.is_ascii_digit()) && number)
}

/// The sheet named before `!` at token `i`: its index (`None` when the workbook has no such sheet), and the token
/// after the `!`. A quoted name right after a word (`3.'Main'!A1`, `A1'Main'!A1`) names no sheet the workbook has.
fn sheet_named(tokens: &[(Token, usize, usize)], i: usize, workbook: &Workbook) -> Option<(Option<usize>, usize)> {
    let (name, after_word) = match &tokens.get(i)?.0 {
        Token::Word(w) if is_sheet_name(w) => (w.clone(), false),
        Token::Quoted(q) => {
            let after_word = i > 0 && matches!(&tokens[i - 1], (Token::Word(_), _, end) if *end == tokens[i].1);
            (q.clone(), after_word)
        }
        _ => return None,
    };
    if tokens.get(i + 1).map(|t| &t.0) != Some(&Token::Punctuation('!')) {
        return None;
    }
    if after_word {
        return Some((None, i + 2));
    }
    let lower = name.to_lowercase();
    Some((workbook.sheets.iter().position(|s| s.name.to_lowercase() == lower), i + 2))
}

/// Whether the tokens from `i` call something: `(`, spaces aside.
fn calls(tokens: &[(Token, usize, usize)], mut i: usize) -> bool {
    while tokens.get(i).map(|t| &t.0) == Some(&Token::Space) {
        i += 1;
    }
    tokens.get(i).map(|t| &t.0) == Some(&Token::Punctuation('('))
}

/// Whether a word is a number with a reference's end right after it (`99.A1`, `9.5$B$2`, `99.E`; `1e5` and `1E5` are
/// numbers).
fn is_glued_to_number(word: &str) -> bool {
    let digits = word.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return false;
    }
    let mut rest = &word[digits..];
    if let Some(after) = rest.strip_prefix('.') {
        rest = after.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    if let Some(power) = rest.strip_prefix(['e', 'E']) {
        if !power.is_empty() && power.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    !rest.is_empty() && end_of(rest).is_some()
}

/// After a number glued to a reference's end and `:` (`99.A1:A3`, `99.A1:Other!B5`), the token past the other end:
/// the end is read apart from the number, and the two ends `:` joins are no reference.
fn past_glued_range(tokens: &[(Token, usize, usize)], i: usize) -> Option<usize> {
    let Token::Word(word) = &tokens.get(i)?.0 else { return None };
    if !is_glued_to_number(word) || tokens.get(i + 1)?.0 != Token::Punctuation(':') {
        return None;
    }
    let k = sheet_prefix(tokens, i + 2).unwrap_or(i + 2);
    matches!(tokens.get(k)?.0, Token::Word(_)).then_some(k + 1)
}

/// What starts at token `i`. A range (`A1:B2`, `Other!A:B`, `A1:Main!B2`) is read whole, unless a call follows
/// it; then, or when what follows `:` makes no range with the first end, the first end is read alone.
fn reference_at(tokens: &[(Token, usize, usize)], i: usize, workbook: &Workbook, own: usize) -> Found {
    if let Some(next) = past_glued_range(tokens, i) {
        return Found::Text(next);
    }
    let (sheet, j) = match sheet_named(tokens, i, workbook) {
        Some(found) => found,
        None => (Some(own), i),
    };
    let word = |k: usize| match tokens.get(k).map(|t| &t.0) {
        Some(Token::Word(w)) => end_of(w),
        _ => None,
    };
    // Letters alone, however many, are a column's when `:` joins them: past the sheet's last column when they are
    // too many (`A1:Customers`, `Customers:A1`).
    let letters = |k: usize| match tokens.get(k).map(|t| &t.0) {
        Some(Token::Word(w)) if is_past_the_sheet(w) => Some(End::Column(usize::MAX, false)),
        _ => None,
    };
    let joins = tokens.get(j + 1).map(|t| &t.0) == Some(&Token::Punctuation(':'));
    let Some(first) = word(j).or_else(|| letters(j).filter(|_| joins)) else {
        // A sheet's name and `!` with no reference after them.
        return Found::Nothing;
    };
    if tokens.get(j + 1).map(|t| &t.0) == Some(&Token::Punctuation(':')) {
        // The second end, perhaps after a sheet's name (not one written with a digit first): the first end's
        // sheet, or the range is none.
        let digit_first = matches!(tokens.get(j + 2).map(|t| &t.0), Some(Token::Word(w)) if w.starts_with(|c: char| c.is_ascii_digit()));
        let (other, k) = match sheet_named(tokens, j + 2, workbook).filter(|_| !digit_first) {
            Some((other, k)) => (Some(other), k),
            None => (None, j + 2),
        };
        if let Some(second) = word(k).or_else(|| letters(k)) {
            let next = k + 1;
            // Two ends that make no reference together (`A:1000`) are text, both of them.
            if !joined(first, second) {
                return Found::Text(next);
            }
            if !calls(tokens, next) {
                let target = sheet.filter(|&s| other.is_none_or(|o| o == Some(s))).map(|s| &workbook.sheets[s]);
                return match target {
                    Some(target) if fits(first, target) && fits(second, target) => {
                        Found::One(reference(workbook, target, first, Some(second)), next)
                    }
                    _ => Found::Text(next),
                };
            }
        }
    }
    let next = j + 1;
    if !matches!(first, End::Cell { .. }) {
        return if j != i { Found::Text(next) } else { Found::Nothing };
    }
    if calls(tokens, next) {
        return Found::Text(next);
    }
    match sheet.map(|s| &workbook.sheets[s]) {
        Some(target) if fits(first, target) => Found::One(reference(workbook, target, first, None), next),
        _ => Found::Text(next),
    }
}

/// The most rows and columns a sheet can have, and a reference name (`XFD1048576`): past them a moved reference is
/// `#REF!`.
const MOST_ROWS: usize = 1 << 20;
const MOST_COLUMNS: usize = 1 << 14;

/// A formula's text (the en-US way) moved by rows and columns, as pasting, moving or filling a cell moves it: each
/// reference written in it (`A1`, `A1:B2`, `A:B`, `1:2`, `A2:B`, `B2:3`, even `A:1000`, on any sheet named or none,
/// even one the workbook doesn't have) has its relative rows and columns moved and its `$` ones kept, written in
/// capitals, the sheet's name as it was. A reference moved off the largest sheet there is (above row 1, left of
/// column A, past row 1048576 or column XFD) is `#REF!`, its sheet's name and all. Calls (`A1(2)`) and texts are
/// not references; everything else stays as written.
pub fn moved(text: &str, rows: i64, columns: i64) -> String {
    let chars: Vec<char> = text.chars().collect();
    let tokens = lex(&chars);
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let mut i = 0;
    while i < tokens.len() {
        let Some((ends, next)) = written_reference_at(&tokens, i) else {
            i += 1;
            continue;
        };
        if !ends.is_empty() {
            out.extend(&chars[last..tokens[i].1]);
            let moved: Option<Vec<End>> = ends.iter().map(|&(_, end)| move_end(end, rows, columns)).collect();
            match moved {
                Some(moved) => {
                    let mut from = tokens[i].1;
                    for (&(k, _), end) in ends.iter().zip(moved) {
                        out.extend(&chars[from..tokens[k].1]);
                        out.push_str(&end_text(end));
                        from = tokens[k].2;
                    }
                }
                None => out.push_str("#REF!"),
            }
            last = tokens[next - 1].2;
        }
        i = next;
    }
    out.extend(&chars[last..]);
    out
}

/// The reference written at token `i`, whatever sheet it names: its ends (each with its token) and the token after
/// it. No ends when what is written there is not one to move (a call, a column or a row alone); `None` when nothing
/// starts there.
fn written_reference_at(tokens: &[(Token, usize, usize)], i: usize) -> Option<(Vec<(usize, End)>, usize)> {
    let sheet_name = |k: usize| match tokens.get(k).map(|t| &t.0) {
        Some(Token::Word(w)) if is_sheet_name(w) => tokens.get(k + 1).map(|t| &t.0) == Some(&Token::Punctuation('!')),
        Some(Token::Quoted(_)) => tokens.get(k + 1).map(|t| &t.0) == Some(&Token::Punctuation('!')),
        _ => false,
    };
    let word = |k: usize| match tokens.get(k).map(|t| &t.0) {
        Some(Token::Word(w)) => end_of(w),
        _ => None,
    };
    let j = if sheet_name(i) { i + 2 } else { i };
    let first = word(j)?;
    if tokens.get(j + 1).map(|t| &t.0) == Some(&Token::Punctuation(':')) {
        let digit_first = matches!(
            tokens.get(j + 2).map(|t| &t.0),
            Some(Token::Word(w)) if w.starts_with(|c: char| c.is_ascii_digit())
        );
        let k = if !digit_first && sheet_name(j + 2) { j + 4 } else { j + 2 };
        if let Some(second) = word(k) {
            if !calls(tokens, k + 1) {
                return Some((vec![(j, first), (k, second)], k + 1));
            }
        }
    }
    if !matches!(first, End::Cell { .. }) || calls(tokens, j + 1) {
        return Some((Vec::new(), j + 1));
    }
    Some((vec![(j, first)], j + 1))
}

/// An end moved, `None` when it is moved off the largest sheet.
fn move_end(end: End, rows: i64, columns: i64) -> Option<End> {
    let along = |(p, absolute): (usize, bool), by: i64, most: usize| -> Option<(usize, bool)> {
        let p = if absolute { p as i64 } else { p as i64 + by };
        (0..most as i64).contains(&p).then_some((p as usize, absolute))
    };
    Some(match end {
        End::Cell { column, row } => {
            End::Cell { column: along(column, columns, MOST_COLUMNS)?, row: along(row, rows, MOST_ROWS)? }
        }
        End::Column(c, absolute) => {
            let (c, absolute) = along((c, absolute), columns, MOST_COLUMNS)?;
            End::Column(c, absolute)
        }
        End::Row(r, absolute) => {
            let (r, absolute) = along((r, absolute), rows, MOST_ROWS)?;
            End::Row(r, absolute)
        }
    })
}

/// An end as a reference writes it: `$A$1`, `B`, `$3`.
fn end_text(end: End) -> String {
    let dollar = |absolute: bool| if absolute { "$" } else { "" };
    match end {
        End::Cell { column, row } => {
            format!("{}{}{}{}", dollar(column.1), column_letters(column.0), dollar(row.1), row.0 + 1)
        }
        End::Column(c, absolute) => format!("{}{}", dollar(absolute), column_letters(c)),
        End::Row(r, absolute) => format!("{}{}", dollar(absolute), r + 1),
    }
}

/// Whether two ends make a reference together.
fn joined(a: End, b: End) -> bool {
    matches!(
        (a, b),
        (End::Cell { .. }, End::Cell { .. })
            | (End::Column(..), End::Column(..))
            | (End::Row(..), End::Row(..))
            | (End::Cell { .. }, End::Column(..))
            | (End::Column(..), End::Cell { .. })
            | (End::Cell { .. }, End::Row(..))
            | (End::Row(..), End::Cell { .. })
    )
}

fn reference(workbook: &Workbook, sheet: &Sheet, first: End, second: Option<End>) -> Reference {
    let row = |p: usize| workbook.bases.text(sheet.rows.line(p).expect("a row in the sheet"));
    let column = |p: usize| workbook.bases.text(sheet.columns.line(p).expect("a column in the sheet"));
    let order = |a: (usize, bool), b: (usize, bool)| if b.0 < a.0 { (b, a) } else { (a, b) };
    let sheet_id = sheet.id.clone();
    let point = |(r, ra): (usize, bool), (c, ca): (usize, bool)| CellPoint { r: row(r), is_row_absolute: ra, c: column(c), is_column_absolute: ca };
    match (first, second) {
        (End::Cell { column: c, row: r }, None) => Reference::Cell { sheet_id, cell: point(r, c) },
        (End::Cell { column: c1, row: r1 }, Some(End::Cell { column: c2, row: r2 })) => {
            let (top, bottom) = order(r1, r2);
            let (left, right) = order(c1, c2);
            Reference::Range { sheet_id, top_left: point(top, left), bottom_right: point(bottom, right) }
        }
        (End::Column(a, aa), Some(End::Column(b, ba))) => {
            let (left, right) = order((a, aa), (b, ba));
            Reference::Columns {
                sheet_id,
                left: ColumnPoint { c: column(left.0), is_column_absolute: left.1 },
                right: ColumnPoint { c: column(right.0), is_column_absolute: right.1 },
                top: None,
            }
        }
        (End::Row(a, aa), Some(End::Row(b, ba))) => {
            let (top, bottom) = order((a, aa), (b, ba));
            Reference::Rows {
                sheet_id,
                top: RowPoint { r: row(top.0), is_row_absolute: top.1 },
                bottom: RowPoint { r: row(bottom.0), is_row_absolute: bottom.1 },
                left: None,
            }
        }
        (End::Cell { column: c, row: r }, Some(End::Column(b, ba))) | (End::Column(b, ba), Some(End::Cell { column: c, row: r })) => {
            let (left, right) = order(c, (b, ba));
            Reference::Columns {
                sheet_id,
                left: ColumnPoint { c: column(left.0), is_column_absolute: left.1 },
                right: ColumnPoint { c: column(right.0), is_column_absolute: right.1 },
                top: Some(RowPoint { r: row(r.0), is_row_absolute: r.1 }),
            }
        }
        (End::Cell { column: c, row: r }, Some(End::Row(b, ba))) | (End::Row(b, ba), Some(End::Cell { column: c, row: r })) => {
            let (top, bottom) = order(r, (b, ba));
            Reference::Rows {
                sheet_id,
                top: RowPoint { r: row(top.0), is_row_absolute: top.1 },
                bottom: RowPoint { r: row(bottom.0), is_row_absolute: bottom.1 },
                left: Some(ColumnPoint { c: column(c.0), is_column_absolute: c.1 }),
            }
        }
        _ => unreachable!("ends that make no reference"),
    }
}

/// A formula written the locale's way, written the en-US way (what `formula_text::in_locale` undoes): where the
/// locale writes a decimal comma, `1,5` is `1.5`, `;` between arguments is `,`, and in an array's braces `\`
/// between columns is `,`.
pub fn from_locale(text: &str, locale: &Locale) -> String {
    if locale.decimal_sign == DecimalSign::Point {
        return text.to_owned();
    }
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut in_braces = false;
    let mut after_value = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '"' | '\'' => {
                out.push(c);
                i += 1;
                while i < chars.len() {
                    let d = chars[i];
                    out.push(d);
                    i += 1;
                    if d == c {
                        if chars.get(i) == Some(&c) {
                            out.push(c);
                            i += 1;
                        } else {
                            break;
                        }
                    }
                }
                after_value = true;
            }
            c if is_space(c) => {
                out.push(c);
                i += 1;
            }
            ';' => {
                out.push(if in_braces { ';' } else { ',' });
                i += 1;
                after_value = false;
            }
            '\\' if in_braces => {
                out.push(',');
                i += 1;
                after_value = false;
            }
            ',' if !after_value && chars.get(i + 1).is_some_and(char::is_ascii_digit) => {
                i = number(&chars, i, &mut out);
                after_value = true;
            }
            ',' => {
                out.push(if in_braces { '\\' } else { ';' });
                i += 1;
                after_value = false;
            }
            // A column's name in brackets is copied as it is, and a table reference's list has its separators
            // written `,` (see `formula_text::bracketed`).
            '[' if crate::formula_text::bracketed(&chars, i).is_some() => {
                i = crate::formula_text::copy_bracketed(&chars, i, &mut out);
                after_value = true;
            }
            '{' => {
                in_braces = true;
                out.push(c);
                i += 1;
                after_value = false;
            }
            '}' => {
                in_braces = false;
                out.push(c);
                i += 1;
                after_value = true;
            }
            ')' | ']' | '%' | '!' => {
                out.push(c);
                i += 1;
                after_value = true;
            }
            '0'..='9' => {
                i = number(&chars, i, &mut out);
                after_value = true;
            }
            c if is_punctuation(c) => {
                out.push(c);
                i += 1;
                after_value = false;
            }
            _ => {
                let start = i;
                while i < chars.len() && !is_punctuation(chars[i]) && !is_space(chars[i]) {
                    out.push(chars[i]);
                    i += 1;
                }
                if !chars[start..i].iter().all(|c| c.is_whitespace()) {
                    after_value = true;
                }
            }
        }
    }
    out
}

/// Copies a number written with a decimal comma, from `i`, with a point.
fn number(chars: &[char], mut i: usize, out: &mut String) -> usize {
    while i < chars.len() && chars[i].is_ascii_digit() {
        out.push(chars[i]);
        i += 1;
    }
    if chars.get(i) == Some(&',') {
        out.push('.');
        i += 1;
        while i < chars.len() && chars[i].is_ascii_digit() {
            out.push(chars[i]);
            i += 1;
        }
    }
    if matches!(chars.get(i), Some('e' | 'E')) {
        let mut j = i + 1;
        if matches!(chars.get(j), Some('+' | '-')) {
            j += 1;
        }
        if chars.get(j).is_some_and(char::is_ascii_digit) {
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            out.extend(&chars[i..j]);
            i = j;
        }
    }
    i
}

/// A typed formula as typed into a cell `rows` down and `columns` right of the one it was typed in (`enterInCells`):
/// every reference written in it moves with it, its `$` parts aside, whatever sheet it names (a sheet the workbook
/// doesn't have too) and however far it reaches, up to `XFD1048576`. A reference moved off the sheet's top or left,
/// or past `XFD1048576`, is `#REF!` with its sheet's name; one that moves is written again, capitals and all. Calls
/// and texts stay as typed, and so does a reference that doesn't move, and everything when the cell is the one
/// typed in.
pub fn shifted(text: &str, rows: i64, columns: i64) -> String {
    if rows == 0 && columns == 0 {
        return text.to_owned();
    }
    let chars: Vec<char> = text.chars().collect();
    let tokens = lex(&chars);
    let span = |from: usize, to: usize| -> String { chars[from..to].iter().collect() };
    let word = |k: usize| match tokens.get(k).map(|t| &t.0) {
        Some(Token::Word(w)) => end_of(w).filter(|&end| is_within_most(end)),
        _ => None,
    };
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let mut i = 0;
    while i < tokens.len() {
        if let Some(next) = past_glued_range(&tokens, i) {
            i = next;
            continue;
        }
        let j = sheet_prefix(&tokens, i).unwrap_or(i);
        let Some(first) = word(j) else {
            i += 1;
            continue;
        };
        if tokens.get(j + 1).map(|t| &t.0) == Some(&Token::Punctuation(':')) {
            let digit_first = matches!(
                tokens.get(j + 2).map(|t| &t.0),
                Some(Token::Word(w)) if w.starts_with(|c: char| c.is_ascii_digit())
            );
            let k = if digit_first { j + 2 } else { sheet_prefix(&tokens, j + 2).unwrap_or(j + 2) };
            if let Some(second) = word(k) {
                if !joined(first, second) {
                    i = k + 1;
                    continue;
                }
                if !calls(&tokens, k + 1) {
                    if !moves(first, rows, columns) && !moves(second, rows, columns) {
                        i = k + 1;
                        continue;
                    }
                    out.push_str(&span(last, tokens[i].1));
                    match (move_end(first, rows, columns), move_end(second, rows, columns)) {
                        (Some(a), Some(b)) => {
                            out.push_str(&span(tokens[i].1, tokens[j].1));
                            out.push_str(&end_text(a));
                            out.push_str(&span(tokens[j].2, tokens[k].1));
                            out.push_str(&end_text(b));
                        }
                        _ => out.push_str("#REF!"),
                    }
                    last = tokens[k].2;
                    i = k + 1;
                    continue;
                }
            }
        }
        if matches!(first, End::Cell { .. }) && !calls(&tokens, j + 1) && moves(first, rows, columns) {
            out.push_str(&span(last, tokens[i].1));
            match move_end(first, rows, columns) {
                Some(a) => {
                    out.push_str(&span(tokens[i].1, tokens[j].1));
                    out.push_str(&end_text(a));
                }
                None => out.push_str("#REF!"),
            }
            last = tokens[j].2;
        }
        i = j + 1;
    }
    out.push_str(&span(last, chars.len()));
    out
}

/// The token after a sheet's name and `!` at token `i`, if one is there (a sheet the workbook has or not).
fn sheet_prefix(tokens: &[(Token, usize, usize)], i: usize) -> Option<usize> {
    match &tokens.get(i)?.0 {
        Token::Word(w) if is_sheet_name(w) => {}
        Token::Quoted(_) => {}
        _ => return None,
    }
    (tokens.get(i + 1).map(|t| &t.0) == Some(&Token::Punctuation('!'))).then_some(i + 2)
}

/// Whether an end names rows and columns a reference may name.
fn is_within_most(end: End) -> bool {
    match end {
        End::Cell { column, row } => column.0 < MOST_COLUMNS && row.0 < MOST_ROWS,
        End::Column(c, _) => c < MOST_COLUMNS,
        End::Row(r, _) => r < MOST_ROWS,
    }
}

/// Whether an end moves: a part of it not fixed by `$` is moved by some rows or columns. A reference neither of
/// whose ends moves stays as typed (`a:aa` moved down, past the sheet's last column).
fn moves(end: End, rows: i64, columns: i64) -> bool {
    match end {
        End::Cell { column, row } => (!column.1 && columns != 0) || (!row.1 && rows != 0),
        End::Column(_, absolute) => !absolute && columns != 0,
        End::Row(_, absolute) => !absolute && rows != 0,
    }
}
