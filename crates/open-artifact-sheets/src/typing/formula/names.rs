//! The names of named ranges in a typed formula, each made a reference to its named range (format 51).
//!
//! Only a formula that reads (`formula::parse`) has its names looked at, and only those that are names where it
//! reads them: not a call's name (`SUM(`, `Zed (`), not TRUE or FALSE, nothing in a text. A name is the named
//! range's whatever its case (as `to_lowercase` has it), unless a LET or a LAMBDA around it gives it a value, as far
//! as their names, in capitals, tell:
//!
//! - LET's arguments are looked at in order: one of the first, third, … but its last that is a name alone (`,` after
//!   it, spaces aside) is given the value after it, from the argument after that on; any other such argument is a
//!   formula like the rest. The last is what LET comes to.
//! - LAMBDA's arguments are looked at in order: one but its last that is a name alone is a parameter, given from the
//!   argument after it on; any other is a formula like the rest.
//!
//! `_xlfn.LET` and `_xlfn.LAMBDA` give nothing. A name a LET or a LAMBDA gives a value to is no reference where it
//! is given. (The parser is not changed: the formula's names are found again here, as its lexer finds them, and
//! taken in the order the formula has them.)

use std::rc::Rc;

use crate::formula::parse::{parse, Expr};
use crate::formula::{Reference, StoredFormula};
use crate::value::CellError;
use crate::workbook::Workbook;

/// A name where the formula reads one: in piece `piece`, its characters `start..end`.
struct Name {
    piece: usize,
    start: usize,
    end: usize,
    text: String,
    /// Whether `,` comes next, spaces aside.
    is_alone: bool,
}

/// The formula with each name of a named range made a reference to it.
pub fn named(workbook: &Workbook, formula: StoredFormula) -> StoredFormula {
    if workbook.named_ranges.is_empty() {
        return formula;
    }
    let Ok(expr) = parse(&formula.text_between_references) else { return formula };
    let names = names_in(&formula.text_between_references);
    let mut free = Vec::with_capacity(names.len());
    walk(&expr, &names, &mut Vec::new(), &mut free, &mut |_, _| {});
    if free.len() != names.len() {
        return formula;
    }
    let found: Vec<(&Name, &str)> = names
        .iter()
        .zip(&free)
        .filter(|(_, &is_free)| is_free)
        .filter_map(|(name, _)| Some((name, workbook.named_range_named(&name.text)?)))
        .collect();
    if found.is_empty() {
        return formula;
    }
    let StoredFormula { text_between_references: pieces, references } = formula;
    let (mut new_pieces, mut new_references) = (Vec::new(), Vec::new());
    let mut references = references.into_iter();
    let mut found = found.into_iter().peekable();
    for (i, piece) in pieces.iter().enumerate() {
        let chars: Vec<char> = piece.chars().collect();
        let mut from = 0;
        while let Some((name, id)) = found.next_if(|(name, _)| name.piece == i) {
            new_pieces.push(chars[from..name.start].iter().collect());
            new_references.push(Reference::NamedRange { named_range_id: id.to_owned() });
            from = name.end;
        }
        new_pieces.push(chars[from..].iter().collect());
        if let Some(reference) = references.next() {
            new_references.push(reference);
        }
    }
    StoredFormula { text_between_references: new_pieces, references: new_references }
}

/// The references of a stored formula to named ranges whose names a LET or a LAMBDA around them gives a value to
/// (by their index): written as their names they would not be read as the named ranges again.
pub fn shadowed(workbook: &Workbook, formula: &StoredFormula) -> Vec<usize> {
    if !formula.references.iter().any(|r| matches!(r, Reference::NamedRange { .. })) {
        return Vec::new();
    }
    let Ok(expr) = parse(&formula.text_between_references) else { return Vec::new() };
    let names = names_in(&formula.text_between_references);
    let mut shadowed = Vec::new();
    walk(&expr, &names, &mut Vec::new(), &mut Vec::with_capacity(names.len()), &mut |i, scope| {
        if let Some(Reference::NamedRange { named_range_id }) = formula.references.get(i) {
            let name = workbook.named_range(named_range_id).map(|range| range.name.to_uppercase());
            if name.is_some_and(|name| scope.iter().any(|n| **n == *name)) {
                shadowed.push(i);
            }
        }
    });
    shadowed
}

/// Whether each name of the formula, in the order it has them, is free: no LET or LAMBDA gives it a value there.
/// Each reference is shown the names given values where it is.
fn walk(
    expr: &Expr,
    names: &[Name],
    scope: &mut Vec<Rc<str>>,
    free: &mut Vec<bool>,
    reference: &mut dyn FnMut(usize, &[Rc<str>]),
) {
    let alone = |e: &Expr, free: &Vec<bool>| match e {
        Expr::Name(n) => names.get(free.len()).is_some_and(|name| name.is_alone).then(|| n.clone()),
        _ => None,
    };
    match expr {
        Expr::Name(n) => free.push(!scope.contains(n)),
        Expr::Unary(_, x) => walk(x, names, scope, free, reference),
        Expr::Binary(_, a, b) => {
            walk(a, names, scope, free, reference);
            walk(b, names, scope, free, reference);
        }
        Expr::Call { name, arguments, .. } if &**name == "LET" => {
            let depth = scope.len();
            let mut given = None;
            for (k, argument) in arguments.iter().enumerate() {
                let is_last = k + 1 == arguments.len();
                match alone(argument, free) {
                    Some(n) if !is_last && k % 2 == 0 => {
                        free.push(false);
                        given = Some(n);
                    }
                    _ => {
                        walk(argument, names, scope, free, reference);
                        if k % 2 == 1 {
                            scope.extend(given.take());
                        }
                    }
                }
            }
            scope.truncate(depth);
        }
        Expr::Call { name, arguments, .. } if &**name == "LAMBDA" => {
            let depth = scope.len();
            for (k, argument) in arguments.iter().enumerate() {
                match alone(argument, free).filter(|_| k + 1 < arguments.len()) {
                    Some(n) => {
                        free.push(false);
                        scope.push(n);
                    }
                    None => walk(argument, names, scope, free, reference),
                }
            }
            scope.truncate(depth);
        }
        Expr::Call { arguments, .. } => arguments.iter().for_each(|a| walk(a, names, scope, free, reference)),
        Expr::Reference(i) => reference(*i, scope),
        _ => {}
    }
}

/// The names of a formula's pieces where it reads names, as `formula::parse` lexes them: not a call's, not TRUE
/// or FALSE.
fn names_in(pieces: &[String]) -> Vec<Name> {
    let mut names = Vec::new();
    for (p, piece) in pieces.iter().enumerate() {
        let chars: Vec<char> = piece.chars().collect();
        let mut i = usize::from(p == 0 && chars.first() == Some(&'='));
        let space = |c: char| matches!(c, ' ' | '\t' | '\n' | '\r');
        while i < chars.len() {
            let c = chars[i];
            match c {
                c if space(c) => i += 1,
                '"' => {
                    i += 1;
                    while i < chars.len() {
                        if chars[i] == '"' {
                            if chars.get(i + 1) == Some(&'"') {
                                i += 2;
                                continue;
                            }
                            i += 1;
                            break;
                        }
                        i += 1;
                    }
                }
                '#' => {
                    let rest: String = chars[i..].iter().collect();
                    let error = CellError::ALL
                        .into_iter()
                        .filter(|e| rest.get(..e.text().len()).is_some_and(|head| head.eq_ignore_ascii_case(e.text())))
                        .max_by_key(|e| e.text().len());
                    i += error.map_or(1, |e| e.text().chars().count());
                }
                '0'..='9' | '.' => {
                    let digits = |mut i: usize| {
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                        i
                    };
                    i = digits(i);
                    if chars.get(i) == Some(&'.') {
                        i = digits(i + 1);
                    }
                    if matches!(chars.get(i), Some('e' | 'E')) {
                        let j = i + 1 + usize::from(matches!(chars.get(i + 1), Some('+' | '-')));
                        if chars.get(j).is_some_and(char::is_ascii_digit) {
                            i = digits(j);
                        }
                    }
                }
                c if c.is_ascii_alphabetic() || c == '_' || !c.is_ascii() => {
                    let start = i;
                    let in_name = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '.') || !c.is_ascii();
                    while i < chars.len() && in_name(chars[i]) {
                        i += 1;
                    }
                    let text: String = chars[start..i].iter().collect();
                    let next = chars[i..].iter().find(|&&c| !space(c));
                    let upper = text.to_uppercase();
                    if next != Some(&'(') && upper != "TRUE" && upper != "FALSE" {
                        names.push(Name { piece: p, start, end: i, text, is_alone: next == Some(&',') });
                    }
                }
                _ => i += 1,
            }
        }
    }
    names
}
