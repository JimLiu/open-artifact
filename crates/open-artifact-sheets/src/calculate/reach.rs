//! How far a formula's array may reach, worked out from what is written, before the formula is worked out.
//!
//! Every formula that may spill is given the cells its array could fill at most: an array function's array
//! may be as large as the cells it is given (`UNIQUE(C1:C3)` three rows, whatever it answers; `TRANSPOSE` turned;
//! `HSTACK`/`VSTACK` side by side or one above the other), SPLIT's to the sheet's last column, and an array written
//! in the formula is its size. IF, IFS, SWITCH, IFERROR, IFNA and CHOOSE reach as far as the furthest of the values
//! they may answer, LET as its last argument; TAKE, DROP, ARRAY_CONSTRAIN, SORTBY and ARRAYFORMULA as the array they
//! are given, CHOOSEROWS and CHOOSECOLS as many rows or columns as they are given, TOCOL, TOROW and FLATTEN every cell
//! in a column or a row; INDEX as its range and XLOOKUP as the cells it answers from (when given to an array
//! function). Arithmetic reaches as far as its operands (`C1:C3&D1:F1` three by three), but does not spill; other
//! functions answer one value. A formula spills when its answer is an array function's, or an array
//! written in it, passed on by those that pass a value on, and it may reach past its own cell.

use std::rc::Rc;

use crate::evaluate::Place;
use crate::formula::Expr;
use crate::functions;

/// How many rows and columns an answer may fill, and whether it is an array that spills.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Reach {
    pub rows: usize,
    pub columns: usize,
    pub spills: bool,
}

/// To the sheet's end, however far it goes.
const ALL: usize = usize::MAX / 4;

const ONE: Reach = Reach { rows: 1, columns: 1, spills: false };

impl Reach {
    /// The further of two, spilling when either does.
    fn or(self, other: Reach) -> Reach {
        Reach {
            rows: self.rows.max(other.rows),
            columns: self.columns.max(other.columns),
            spills: self.spills || other.spills,
        }
    }

    /// How many cells it may fill.
    fn cells(&self) -> usize {
        self.rows.saturating_mul(self.columns)
    }

    /// Whether it may fill more than its own cell.
    pub fn is_several(&self) -> bool {
        self.rows > 1 || self.columns > 1
    }
}

/// How far a formula's answer may reach; `places` are where its references point.
pub(crate) fn reach(expr: &Expr, places: &[Option<Place>]) -> Reach {
    Reacher { places, names: Vec::new() }.reach(expr)
}

struct Reacher<'a> {
    places: &'a [Option<Place>],
    /// The names LET gives values, innermost last.
    names: Vec<(Rc<str>, Reach)>,
}

impl Reacher<'_> {
    fn reach(&mut self, expr: &Expr) -> Reach {
        match expr {
            Expr::Reference(i) => match self.places.get(*i).copied().flatten() {
                Some(place) => Reach { rows: place.rows(), columns: place.columns(), spills: false },
                None => ONE,
            },
            Expr::Name(name) => self.names.iter().rev().find(|(n, _)| n == name).map_or(ONE, |(_, reach)| *reach),
            Expr::Array(a) => Reach { rows: a.rows(), columns: a.columns(), spills: true },
            Expr::Unary(_, a) => Reach { spills: false, ..self.reach(a) },
            Expr::Binary(_, a, b) => Reach { spills: false, ..self.reach(a).or(self.reach(b)) },
            Expr::Call { function: Some(id), arguments, .. }
                if functions::match_arguments(id.description(), arguments.len()).is_some() =>
            {
                self.call(id.name(), arguments)
            }
            _ => ONE,
        }
    }

    /// The furthest of some arguments.
    fn furthest<'e>(&mut self, arguments: impl Iterator<Item = &'e Expr>) -> Reach {
        arguments.fold(ONE, |reach, a| reach.or(self.reach(a)))
    }

    fn call(&mut self, name: &str, arguments: &[Expr]) -> Reach {
        let first = |r: &mut Self| arguments.first().map_or(ONE, |a| r.reach(a));
        match name {
            "UNIQUE" | "SORT" | "SORTN" | "FILTER" => Reach { spills: true, ..first(self) },
            "TRANSPOSE" => {
                let r = first(self);
                Reach { rows: r.columns, columns: r.rows, spills: true }
            }
            "HSTACK" | "VSTACK" => {
                let reaches: Vec<Reach> = arguments.iter().map(|a| self.reach(a)).collect();
                let most = |f: fn(&Reach) -> usize| reaches.iter().map(f).max().unwrap_or(1);
                let sum = |f: fn(&Reach) -> usize| reaches.iter().map(f).fold(0, usize::saturating_add).max(1);
                let (rows, columns) = match name {
                    "HSTACK" => (most(|r| r.rows), sum(|r| r.columns)),
                    _ => (sum(|r| r.rows), most(|r| r.columns)),
                };
                Reach { rows, columns, spills: true }
            }
            "SPLIT" => Reach { rows: 1, columns: ALL, spills: true },
            "TAKE" | "DROP" | "ARRAY_CONSTRAIN" | "SORTBY" | "ARRAYFORMULA" => Reach { spills: true, ..first(self) },
            // CHOOSEROWS(array, rows…): a row for each value of the rows written (at least one); CHOOSECOLS so across.
            "CHOOSEROWS" | "CHOOSECOLS" => {
                let chosen = arguments[1..].iter().fold(0, |n: usize, a| n.saturating_add(self.reach(a).cells())).max(1);
                let r = first(self);
                match name {
                    "CHOOSEROWS" => Reach { rows: chosen, columns: r.columns, spills: true },
                    _ => Reach { rows: r.rows, columns: chosen, spills: true },
                }
            }
            // TOCOL and TOROW: every cell of the array in a column or a row; FLATTEN every cell of its arguments.
            "TOCOL" => Reach { rows: first(self).cells(), columns: 1, spills: true },
            "TOROW" => Reach { rows: 1, columns: first(self).cells(), spills: true },
            "FLATTEN" => {
                let cells = arguments.iter().fold(0, |n: usize, a| n.saturating_add(self.reach(a).cells()));
                Reach { rows: cells.max(1), columns: 1, spills: true }
            }
            // TEXTSPLIT reaches to the sheet's last column given column separators and to its last
            // row given row separators (each given when written, whatever they are), and its array does not spill
            // given both (`TAKE` passes it on as one that does); SEQUENCE as `sequence_reach` says; MAP as far as the
            // furthest of its arrays, BYROW down its array's rows and BYCOL across its columns.
            "TEXTSPLIT" => {
                let given = |i: usize| !matches!(arguments.get(i), None | Some(Expr::Missing));
                Reach {
                    rows: if given(2) { ALL } else { 1 },
                    columns: if given(1) { ALL } else { 1 },
                    spills: !(given(1) && given(2)),
                }
            }
            "SEQUENCE" => sequence_reach(arguments),
            "MAP" => Reach { spills: true, ..self.furthest(arguments[..arguments.len() - 1].iter()) },
            "BYROW" => Reach { columns: 1, spills: true, ..first(self) },
            "BYCOL" => Reach { rows: 1, spills: true, ..first(self) },
            "IF" => self.furthest(arguments.iter().skip(1)),
            "IFS" => self.furthest(arguments.iter().skip(1).step_by(2)),
            // SWITCH(value, case, answer, …, otherwise).
            "SWITCH" => {
                let otherwise = (arguments.len() % 2 == 0).then(|| &arguments[arguments.len() - 1]);
                self.furthest(arguments.iter().skip(2).step_by(2).chain(otherwise))
            }
            "IFERROR" | "IFNA" => self.furthest(arguments.iter()),
            "CHOOSE" => self.furthest(arguments.iter().skip(1)),
            "LET" => self.let_(arguments),
            "INDEX" => Reach { spills: false, ..first(self) },
            "XLOOKUP" => Reach { spills: false, ..arguments.get(2).map_or(ONE, |a| self.reach(a)) },
            _ => ONE,
        }
    }

    fn let_(&mut self, arguments: &[Expr]) -> Reach {
        let depth = self.names.len();
        let mut reach = None;
        for i in 0..(arguments.len() - 1) / 2 {
            match &arguments[2 * i] {
                Expr::Name(n) if !self.names[depth..].iter().any(|(m, _)| m == n) => {
                    let value = self.reach(&arguments[2 * i + 1]);
                    self.names.push((n.clone(), value));
                }
                // #NAME?
                _ => reach = Some(ONE),
            }
            if reach.is_some() {
                break;
            }
        }
        let reach = reach.unwrap_or_else(|| self.reach(&arguments[arguments.len() - 1]));
        self.names.truncate(depth);
        reach
    }
}

/// SEQUENCE(rows, [columns], …): a number written for the rows or the columns is that many (cut toward zero, at least
/// one; one when left out), anything else to the sheet's end. More than SEQUENCE's 100000 numbers in those written,
/// or neither of them written, is one value.
fn sequence_reach(arguments: &[Expr]) -> Reach {
    let count = |arg: Option<&Expr>| match arg {
        None | Some(Expr::Missing) => Some(1),
        Some(Expr::Number(n)) => Some((n.trunc().max(1.0)).min(1e12) as usize),
        Some(_) => None,
    };
    let (rows, columns) = (count(arguments.first()), count(arguments.get(1)));
    let written = rows.unwrap_or(1).saturating_mul(columns.unwrap_or(1));
    if (rows.is_none() && columns.is_none()) || written > 100_000 {
        return ONE;
    }
    Reach { rows: rows.unwrap_or(ALL), columns: columns.unwrap_or(ALL), spills: true }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::parse::parse;

    fn of(text: &str, places: &[(usize, usize, usize, usize)]) -> (usize, usize, bool) {
        let pieces: Vec<String> = format!("={text}").split('@').map(str::to_owned).collect();
        let expr = parse(&pieces).expect("a formula that reads");
        let places: Vec<Option<Place>> = places
            .iter()
            .map(|&(top, left, bottom, right)| Some(Place { sheet: 0, top, left, bottom, right }))
            .collect();
        let r = reach(&expr, &places);
        (r.rows, r.columns, r.spills)
    }

    #[test]
    fn reaches() {
        let c1_c3 = (0, 2, 2, 2);
        assert_eq!(of("UNIQUE(@)", &[c1_c3]), (3, 1, true));
        assert_eq!(of("TRANSPOSE(@)", &[c1_c3]), (1, 3, true));
        assert_eq!(of("UNIQUE(@)+0", &[c1_c3]), (3, 1, false));
        assert_eq!(of("IF(TRUE,@,1)", &[c1_c3]), (3, 1, false));
        assert_eq!(of("IF(@,1,2)", &[c1_c3]), (1, 1, false));
        assert_eq!(of("LET(x,UNIQUE(@),x)", &[c1_c3]), (3, 1, true));
        assert_eq!(of("HSTACK(@,@)", &[(0, 2, 1, 2), (0, 2, 1, 2)]), (2, 2, true));
        assert_eq!(of("VSTACK(@,@)", &[(0, 2, 1, 2), (0, 2, 0, 2)]), (3, 1, true));
        assert_eq!(of("SWITCH(1,1,@)", &[c1_c3]), (3, 1, false));
        assert_eq!(of("{1}", &[]), (1, 1, true));
        assert_eq!(of("SUM(@)", &[c1_c3]), (1, 1, false));
        assert_eq!(of("SPLIT(\"a\",\",\")", &[]).0, 1);
        assert_eq!(of("MAP({1,2},@,LAMBDA(x,y,x))", &[c1_c3]), (3, 2, true));
        assert_eq!(of("BYROW(@,LAMBDA(r,r))", &[(0, 2, 1, 4)]), (2, 1, true));
        assert_eq!(of("BYCOL(@,LAMBDA(c,c))", &[(0, 2, 1, 4)]), (1, 3, true));
        assert_eq!(of("TEXTSPLIT(\"a\",\",\")", &[]), (1, ALL, true));
        assert_eq!(of("TEXTSPLIT(\"a\",,\";\")", &[]), (ALL, 1, true));
        assert_eq!(of("TEXTSPLIT(\"a\",\",\",\";\")", &[]), (ALL, ALL, false));
        assert_eq!(of("TAKE(TEXTSPLIT(\"a\",\",\",\";\"),1)", &[]), (ALL, ALL, true));
        assert_eq!(of("SEQUENCE(9)", &[]), (9, 1, true));
        assert_eq!(of("SEQUENCE(2.5,@)", &[c1_c3]), (2, ALL, true));
        assert_eq!(of("SEQUENCE(@,@)", &[c1_c3, c1_c3]), (1, 1, false));
        assert_eq!(of("SEQUENCE(2000,60)", &[]), (1, 1, false));
        assert_eq!(of("CHOOSEROWS(@,1,{1;2})", &[(0, 2, 2, 3)]), (3, 2, true));
        assert_eq!(of("TOCOL(@)", &[(0, 2, 2, 3)]), (6, 1, true));
        assert_eq!(of("FLATTEN(@,5)", &[(0, 2, 2, 3)]), (7, 1, true));
    }
}
