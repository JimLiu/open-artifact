//! The columns of a guessed table (`Column`): the name its header's rows give each, and the kind of value its records
//! hold. A name is the header's texts over the column from the top down (20 rows at most), numbers as their format
//! shows them, a merged range's once, joined by ` · `; a row under the header naming units is left out when the
//! names tell the columns apart as well without it. A kind is told by what the records show: booleans only make a
//! checkbox, numbers in half the cells or more the kind of their commonest format, and texts few words when fewer
//! than nine come, one of them twice or more, none long.

use std::collections::{BTreeMap, BTreeSet};

use super::super::live::Role;
use super::grid::{Grid, Merge, Shown};
use super::runs::Table;
use crate::number_format::Kind as FormatKind;

/// The most columns a table's columns are told for.
const MOST_COLUMNS: usize = 500;
/// The most records read for the kinds of the columns.
const MOST_RECORDS: usize = 5000;
/// The most header rows a name is made of, from the header's last up.
const MOST_HEADER_ROWS: usize = 20;
/// The most characters a name keeps.
const MOST_CHARACTERS_OF_A_NAME: usize = 200;
/// The most rows under the body looked at for one showing something, when telling a row of units.
const MOST_ROWS_UNDER: usize = 10;
/// The most characters of a text in a column of few words.
const MOST_CHARACTERS_OF_A_WORD: usize = 100;
/// A column with this many different texts or more holds texts, not few words.
const MANY_TEXTS: usize = 9;
/// What joins the header's texts over a column.
const JOIN: &str = " · ";

/// The kind of value a column holds, in this order: of two formats as common, the earlier is the column's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Kind {
    Number,
    Currency,
    Percent,
    Date,
    FewWords,
    Checkbox,
    Text,
}

impl Kind {
    pub(super) fn name(self) -> &'static str {
        match self {
            Kind::Number => "number",
            Kind::Currency => "currency",
            Kind::Percent => "percent",
            Kind::Date => "date",
            Kind::FewWords => "fewWords",
            Kind::Checkbox => "checkbox",
            Kind::Text => "text",
        }
    }

    /// What numbers shown in a number format make a column: dates (with a time or not), currencies, percents, or
    /// else plain numbers.
    fn of_format(kind: FormatKind) -> Kind {
        match kind {
            FormatKind::Currency => Kind::Currency,
            FormatKind::Percent => Kind::Percent,
            FormatKind::Date | FormatKind::DateAndTime => Kind::Date,
            _ => Kind::Number,
        }
    }
}

/// A column of a guessed table: its place, its name and its kind.
pub(super) struct Column {
    pub column: usize,
    pub name: Option<String>,
    pub kind: Kind,
}

/// What the records show in a column, counted.
#[derive(Clone, Default)]
struct Tally {
    /// Cells showing something.
    shown: usize,
    booleans: usize,
    numbers: usize,
    /// How many numbers each kind of format shows.
    formats: BTreeMap<Kind, usize>,
    /// How many times each text comes, in small letters (long texts left out).
    texts: BTreeMap<String, usize>,
    /// Whether a text is over 100 characters long or holds a control character.
    long: bool,
}

impl Tally {
    fn add(&mut self, shown: &Shown, format: impl FnOnce() -> FormatKind) {
        self.shown = self.shown.saturating_add(1);
        match shown {
            Shown::Number(_) => {
                self.numbers += 1;
                *self.formats.entry(Kind::of_format(format())).or_default() += 1;
            }
            Shown::Boolean(_) => self.booleans += 1,
            Shown::Text(text) => {
                if text.chars().count() > MOST_CHARACTERS_OF_A_WORD || text.chars().any(char::is_control) {
                    self.long = true;
                } else {
                    *self.texts.entry(text.chars().flat_map(char::to_lowercase).collect()).or_default() += 1;
                }
            }
            Shown::Error(_) => {}
        }
    }

    fn kind(&self) -> Kind {
        if self.shown != 0 {
            if self.shown == self.booleans {
                return Kind::Checkbox;
            }
            if self.shown <= self.numbers.saturating_mul(2) {
                // The commonest format, the earlier of two as common.
                let commonest = self.formats.iter().fold(None, |best, (&kind, &n)| match best {
                    Some((_, most)) if most >= n => best,
                    _ => Some((kind, n)),
                });
                return commonest.map_or(Kind::Number, |(kind, _)| kind);
            }
        }
        if self.texts.len() >= MANY_TEXTS || self.long || !self.texts.values().any(|&n| n >= 2) {
            Kind::Text
        } else {
            Kind::FewWords
        }
    }
}

impl Grid<'_> {
    /// The columns of a table, 500 at most: each one's name and kind. A declared table's header rows all name
    /// them, a last row of units too.
    pub(super) fn columns_of(&self, table: &Table, declared: bool) -> Vec<Column> {
        let first = table.first_column;
        let last = if table.last_column > first { table.last_column.min(first.saturating_add(MOST_COLUMNS - 1)) } else { first };
        let names = self.names(table, last, declared);
        let records: Vec<(usize, usize)> = table.runs.iter().filter(|r| r.role == Role::Record).map(|r| (r.first, r.last)).collect();
        self.told(first, last, names, &records)
    }

    /// The columns of a table recognized in a sheet (readTablesOfSheet), 500 at most: the names its header's rows
    /// give them (a row of units kept), and the kinds its records (each run first to last) hold. None when the last
    /// column is before the first.
    pub(super) fn recognized_columns(&self, header: (usize, usize), first: usize, last: usize, records: &[(usize, usize)]) -> Vec<Column> {
        if last < first {
            return Vec::new();
        }
        let last = last.min(first.saturating_add(MOST_COLUMNS - 1));
        let top = header.0.max(header.1.saturating_sub(MOST_HEADER_ROWS - 1));
        let names = HeaderTexts::of(self, top, header.1, first, last).names(header.1, first, last);
        self.told(first, last, names, records)
    }

    /// The columns from one to another, with their names, of the kinds the records hold.
    fn told(&self, first: usize, last: usize, mut names: BTreeMap<usize, String>, records: &[(usize, usize)]) -> Vec<Column> {
        let mut tallies = vec![Tally::default(); last - first + 1];
        let mut left = MOST_RECORDS;
        for &(from, to) in records {
            if left == 0 {
                break;
            }
            let bottom = if to > from { to.min(from.saturating_add(left - 1)) } else { from };
            for row in from..=bottom {
                for (column, shown) in self.owned(row, first, last) {
                    tallies[column - first].add(shown, || self.number_format(row, column).map_or(FormatKind::General, |p| p.kind));
                }
            }
            left = left.saturating_sub(to.saturating_sub(from).saturating_add(1));
        }
        tallies
            .iter()
            .enumerate()
            .map(|(i, tally)| Column { column: first + i, name: names.remove(&(first + i)), kind: tally.kind() })
            .collect()
    }

    /// The names the header's rows give the columns from the table's first to one, by column; those it gives none
    /// left out. A last header row naming units is left out when the names tell as many apart without it.
    fn names(&self, table: &Table, last_column: usize, declared: bool) -> BTreeMap<usize, String> {
        let Some(header) = table.header else { return BTreeMap::new() };
        let (first, last) = (table.first_column, table.last_column);
        let mut under = None;
        let mut row = table.to;
        for _ in 0..MOST_ROWS_UNDER {
            if !self.row_has_any(row.saturating_add(1), first, last) {
                break;
            }
            row += 1;
            under = Some(row);
        }
        let units = !declared && header.first < header.last && self.names_units(header.last, first, last, under.unwrap_or(table.to));
        let top = header.first.max(header.last.saturating_sub(MOST_HEADER_ROWS - 1));
        let texts = HeaderTexts::of(self, top, header.last, first, last_column);
        let names = texts.names(header.last, first, last_column);
        if !units {
            return names;
        }
        let without = texts.names(header.last.saturating_sub(1), first, last_column);
        let distinct = |names: &BTreeMap<usize, String>| names.values().collect::<BTreeSet<_>>().len();
        if distinct(&without) == distinct(&names) {
            without
        } else {
            names
        }
    }
}

/// The texts of a header's rows: what each cell shows itself as text, and the merged ranges meeting the rows.
struct HeaderTexts {
    /// The header's first row looked at.
    top: usize,
    merges: Vec<Merge>,
    /// Each cell's text by its row and column: its words, one space between; a number as its format shows it.
    texts: BTreeMap<(usize, usize), String>,
}

impl HeaderTexts {
    /// The texts from a row to another and from a column to another, and in the merged ranges meeting them.
    fn of(grid: &Grid, top: usize, bottom: usize, first: usize, last: usize) -> HeaderTexts {
        let merges: Vec<Merge> = grid
            .merges()
            .filter(|m| m.top <= bottom && top <= m.bottom && m.left <= last && first <= m.right)
            .copied()
            .collect();
        let (mut up, mut down, mut left, mut right) = (top, bottom, first, last);
        for m in &merges {
            (up, down, left, right) = (up.min(m.top), down.max(m.bottom), left.min(m.left), right.max(m.right));
        }
        let locale = grid.locale();
        let mut texts = BTreeMap::new();
        for row in up..=down {
            for (column, shown) in grid.owned(row, left, right) {
                let text = match shown {
                    Shown::Text(text) => text.split_whitespace().collect::<Vec<_>>().join(" "),
                    Shown::Number(n) => grid.shown_number(row, column, *n, locale).unwrap_or_default(),
                    Shown::Boolean(_) | Shown::Error(_) => continue,
                };
                if !text.is_empty() {
                    texts.insert((row, column), text);
                }
            }
        }
        HeaderTexts { top, merges, texts }
    }

    /// The names of the columns from one to another, the header's rows ending at one.
    fn names(&self, bottom: usize, first: usize, last: usize) -> BTreeMap<usize, String> {
        (first..=last).filter_map(|column| Some((column, self.name(bottom, column)?))).collect()
    }

    /// A column's name: the texts over it from the top down, a merged range's once (its top left's).
    fn name(&self, bottom: usize, column: usize) -> Option<String> {
        let mut cells: Vec<(usize, usize)> = Vec::new();
        for row in self.top..=bottom {
            let held = self.merges.iter().find(|m| m.top <= row && row <= m.bottom && m.left <= column && column <= m.right);
            let cell = held.map_or((row, column), |m| (m.top, m.left));
            if !cells.contains(&cell) {
                cells.push(cell);
            }
        }
        let texts: Vec<&str> = cells.iter().filter_map(|cell| self.texts.get(cell).map(String::as_str)).collect();
        let name = texts.join(JOIN);
        (!name.is_empty()).then(|| name.chars().take(MOST_CHARACTERS_OF_A_NAME).collect())
    }
}
