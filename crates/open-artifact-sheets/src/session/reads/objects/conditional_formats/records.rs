//! The records the conditional formats of some cells are suggested for, and what each of their columns holds.
//!
//! The records are those of the cell table the sheet declares that the cells meet, else of the one classified table
//! the cells meet, when it has a body; else the cells themselves when they meet two declared ones. Else they are
//! guessed: the block of cells showing something within the cells, grown a column at a time down its rows while a
//! cell of the next column shows something beside one of its edge, short of declared cell tables (else the cells
//! themselves). A single cell showing nothing can pick up a table immediately above or below it.
//!
//! A column tells its name, how many of its records show something, how many numbers and how many nothing, the texts
//! that come most (whatever their capitals), the smallest number, the middle one and the largest, and its kind as the
//! guess at a table tells it. The columns told are 50 at most, from the one the suggestions are about on, or the
//! last 50.

use std::collections::{BTreeMap, BTreeSet};
use hashbrown::{HashMap, HashSet};
use std::rc::Rc;

use serde_json::{json, Value as Json};

use crate::calculate::SpillOutcome;
use crate::number_format::{Kind as FormatKind, NumberFormat};
use crate::session::reads::tables::{declared_areas, tables_for_formatting, TableForFormatting};
use crate::value::Value;
use crate::workbook::formats::Leaf;
use crate::workbook::layout::merged_boxes;
use crate::workbook::{Input, Sheet, Workbook};

/// The most columns told.
const MOST_COLUMNS: usize = 50;
/// The most texts told as a column's commonest.
const MOST_COMMONEST: usize = 8;
/// The most characters of a column's name, and of a text counted among a column's.
const MOST_CHARACTERS: usize = 100;
/// A column with this many different texts or more holds texts, not few words.
const MANY_TEXTS: usize = 9;

/// What a cell shows: a text (not empty), a number, a boolean or an error.
enum Shown {
    Text(Rc<str>),
    Number(f64),
    Boolean(bool),
    Error,
}

impl Shown {
    fn of(value: &Value) -> Option<Shown> {
        match value {
            Value::Blank => None,
            Value::Text(t) if t.is_empty() => None,
            Value::Text(t) => Some(Shown::Text(t.clone())),
            Value::Number(n) => Some(Shown::Number(*n)),
            Value::Boolean(b) => Some(Shown::Boolean(*b)),
            Value::Error(_) => Some(Shown::Error),
        }
    }
}

/// Cells from a top row to a bottom one, across columns from a left one to a right one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Block {
    pub top: usize,
    pub left: usize,
    pub bottom: usize,
    pub right: usize,
}

impl Block {
    fn meets(&self, other: &Block) -> bool {
        other.top <= self.bottom && self.top <= other.bottom && other.left <= self.right && self.left <= other.right
    }

    fn of((top, left, bottom, right): (usize, usize, usize, usize)) -> Block {
        Block { top, left, bottom, right }
    }

    /// The smallest block that holds both.
    fn spanning(&self, other: &Block) -> Block {
        Block {
            top: self.top.min(other.top),
            left: self.left.min(other.left),
            bottom: self.bottom.max(other.bottom),
            right: self.right.max(other.right),
        }
    }

    /// How many rows it takes.
    pub fn rows(&self) -> usize {
        (self.bottom - self.top).saturating_add(1)
    }
}

/// The records suggestions are made for: where they are, how many of their rows are spacers, and the names of their
/// columns.
pub(super) struct Records {
    pub table: Block,
    pub block: Block,
    pub gaps: usize,
    pub non_records: Vec<(Block, &'static str)>,
    pub footer: Option<Block>,
    pub names: BTreeMap<usize, String>,
}

impl Records {
    /// Records of just some cells: no spacers, no names.
    pub fn of(block: Block) -> Records {
        Records { table: block, block, gaps: 0, non_records: Vec::new(), footer: None, names: BTreeMap::new() }
    }

    fn in_table(found: TableForFormatting) -> Option<Records> {
        let block = Block::of(found.records?);
        let area = |(top, bottom)| Block { top, bottom, ..block };
        // The blank rows of a table of one column that the sheet does not declare are told, but its blanks count
        // them.
        let one_column = !found.declared && found.cells.1 == found.cells.3;
        let gaps = found.non_records.iter().filter(|(_, kind)| *kind == "blank" && !one_column)
            .map(|&(rows, _)| area(rows).rows()).sum();
        let non_records = found.non_records.into_iter().map(|(rows, kind)| (area(rows), kind)).collect();
        Some(Records {
            table: Block::of(found.cells), block, gaps, non_records, footer: found.footer.map(area), names: found.names,
        })
    }
}

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
    pub fn name(self) -> &'static str {
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

    fn of_format(kind: FormatKind) -> Kind {
        match kind {
            FormatKind::Currency => Kind::Currency,
            FormatKind::Percent => Kind::Percent,
            FormatKind::Date | FormatKind::DateAndTime => Kind::Date,
            _ => Kind::Number,
        }
    }
}

/// What a column of the records holds.
pub(super) struct Column {
    pub column: usize,
    pub name: Option<String>,
    pub kind: Kind,
    pub filled: usize,
    pub numbers: usize,
    pub blank: usize,
    pub commonest: Vec<String>,
    pub smallest: Option<f64>,
    pub middle: Option<f64>,
    pub largest: Option<f64>,
}

impl Column {
    /// The column told, by the id or the letters given.
    pub fn told(&self, c: Json) -> Json {
        json!({
            "c": c,
            "name": self.name,
            "kind": self.kind.name(),
            "filled": self.filled,
            "numbers": self.numbers,
            "blank": self.blank,
            "commonest": self.commonest,
            "smallest": self.smallest,
            "middle": self.middle,
            "largest": self.largest,
        })
    }
}

/// A text of a column counted: how many times it comes, as it first comes, and the first row it is in.
struct Counted {
    times: usize,
    text: Rc<str>,
    row: usize,
}

/// What a column's records show, counted.
#[derive(Default)]
struct Tally {
    filled: usize,
    booleans: usize,
    numbers: Vec<f64>,
    formats: BTreeMap<Kind, usize>,
    /// Each text in small letters, long ones left out.
    texts: BTreeMap<String, Counted>,
    /// Whether a text is over 100 characters long or holds a control character.
    long: bool,
}

impl Tally {
    fn add(&mut self, row: usize, shown: &Shown, format: impl FnOnce() -> FormatKind) {
        self.filled = self.filled.saturating_add(1);
        match shown {
            Shown::Number(n) => {
                self.numbers.push(*n);
                *self.formats.entry(Kind::of_format(format())).or_default() += 1;
            }
            Shown::Boolean(_) => self.booleans += 1,
            Shown::Text(text) => {
                if text.chars().count() > MOST_CHARACTERS || text.chars().any(char::is_control) {
                    self.long = true;
                    return;
                }
                // Each character in small letters on its own: a final sigma is a sigma.
                let lower = text.chars().flat_map(char::to_lowercase).collect();
                let counted = self.texts.entry(lower).or_insert(Counted { times: 0, text: text.clone(), row });
                counted.times = counted.times.saturating_add(1);
                if row < counted.row {
                    (counted.text, counted.row) = (text.clone(), row);
                }
            }
            Shown::Error => {}
        }
    }

    fn kind(&self) -> Kind {
        if self.filled != 0 {
            if self.filled == self.booleans {
                return Kind::Checkbox;
            }
            if self.filled <= self.numbers.len().saturating_mul(2) {
                let commonest = self.formats.iter().fold(None, |best, (&kind, &n)| match best {
                    Some((_, most)) if most >= n => best,
                    _ => Some((kind, n)),
                });
                return commonest.map_or(Kind::Number, |(kind, _)| kind);
            }
        }
        if self.texts.len() >= MANY_TEXTS || self.long || !self.texts.values().any(|t| t.times >= 2) {
            Kind::Text
        } else {
            Kind::FewWords
        }
    }

    fn column(mut self, column: usize, name: Option<String>, rows: usize) -> Column {
        let kind = self.kind();
        self.numbers.sort_by(f64::total_cmp);
        let middle = (!self.numbers.is_empty()).then(|| {
            let h = 0.5 * (self.numbers.len() - 1) as f64;
            let i = h.floor() as usize;
            match self.numbers.get(i + 1) {
                Some(next) => self.numbers[i] + (h - i as f64) * (next - self.numbers[i]),
                None => self.numbers[i],
            }
        });
        let mut texts: Vec<&Counted> = self.texts.values().collect();
        texts.sort_by(|a, b| b.times.cmp(&a.times).then(a.row.cmp(&b.row)));
        Column {
            column,
            name,
            kind,
            filled: self.filled,
            numbers: self.numbers.len(),
            blank: rows.saturating_sub(self.filled),
            commonest: texts.iter().take(MOST_COMMONEST).map(|t| t.text.to_string()).collect(),
            smallest: self.numbers.first().copied(),
            middle,
            largest: self.numbers.last().copied(),
        }
    }
}

/// A sheet's cells as the suggestions read them: what each shows (an array's spilled in), and where.
pub(super) struct Values<'a> {
    sheet: &'a Sheet,
    workbook: &'a Workbook,
    cells: HashMap<(usize, usize), Shown>,
    /// The columns showing something in each row.
    rows: BTreeMap<usize, BTreeSet<usize>>,
    /// The rows showing something in each column.
    columns: BTreeMap<usize, BTreeSet<usize>>,
    formulas: HashSet<(usize, usize)>,
    /// The kinds of number format the numbers arrays spill bring, by the cells.
    spilled_formats: HashMap<(usize, usize), FormatKind>,
}

impl<'a> Values<'a> {
    pub fn of(workbook: &'a Workbook, sheet: &'a Sheet) -> Values<'a> {
        let mut cells = HashMap::new();
        let mut spilled = Vec::new();
        let mut formulas = HashSet::new();
        // The cells holding something: an array worked out before they were given it does not spill into them.
        let mut held = HashSet::new();
        for (&(r, c), cell) in &sheet.cells {
            let (Some(row), Some(column)) = (sheet.rows.position(r), sheet.columns.position(c)) else { continue };
            held.insert((row, column));
            let value = match &cell.input {
                Input::Number { value } => Value::Number(*value),
                Input::Text { value } => Value::text(value.as_str()),
                Input::Boolean { value } => Value::Boolean(*value),
                Input::DropdownOption { option_id, label } => {
                    Value::text(sheet.dropdown_option(option_id).map_or(label.as_str(), |o| o.label.as_str()))
                }
                Input::User { .. } | Input::Users { .. } | Input::RichText { .. } => {
                    Value::text(cell.input.reads_as_text().unwrap_or_default().as_str())
                }
                Input::Formula { .. } => {
                    formulas.insert((row, column));
                    match workbook.outcome(&sheet.id, r, c) {
                        Some(outcome) => {
                            if let Some(SpillOutcome::Fills { array, formats, .. }) = &outcome.spill {
                                for ((i, j), value) in array.stored_entries().filter(|(position, _)| *position != (0, 0)) {
                                    let brought = formats.as_ref().and_then(|f| f.get(array.columns(), (i, j))).map(|f| f.kind);
                                    spilled.push(((row + i, column + j), value.clone(), brought));
                                }
                            }
                            // A formula that reads an empty cell shows 0.
                            match &outcome.value {
                                Value::Blank => Value::Number(0.0),
                                value => value.clone(),
                            }
                        }
                        None => Value::Blank,
                    }
                }
            };
            if let Some(shown) = Shown::of(&value) {
                cells.insert((row, column), shown);
            }
        }
        let mut spilled_formats = HashMap::new();
        for ((row, column), value, brought) in spilled {
            let live = sheet.rows.line(row).is_some() && sheet.columns.line(column).is_some();
            if !live || held.contains(&(row, column)) {
                continue;
            }
            if let Some(shown) = Shown::of(&value) {
                cells.insert((row, column), shown);
                if let Some(brought) = brought {
                    spilled_formats.insert((row, column), brought);
                }
            }
        }
        let mut rows: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
        let mut columns: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
        for &(row, column) in cells.keys() {
            rows.entry(row).or_default().insert(column);
            columns.entry(column).or_default().insert(row);
        }
        Values { sheet, workbook, cells, rows, columns, formulas, spilled_formats }
    }

    /// Whether a cell shows nothing.
    pub fn is_blank(&self, row: usize, column: usize) -> bool {
        !self.cells.contains_key(&(row, column))
    }

    /// Whether a cell is a checkbox that shows FALSE.
    fn is_unticked(&self, row: usize, column: usize) -> bool {
        let (Some(r), Some(c)) = (self.sheet.rows.line(row), self.sheet.columns.line(column)) else {
            return false;
        };
        matches!(self.cells.get(&(row, column)), Some(Shown::Boolean(false)))
            && self.sheet.formats.get(Leaf::CellControl, (r, c)).is_some_and(|control| control["kind"] == "checkbox")
    }

    /// The kind of number format a cell's number shows in: its own, or else the one its formula or array brings.
    fn format(&self, row: usize, column: usize) -> FormatKind {
        let (Some(r), Some(c)) = (self.sheet.rows.line(row), self.sheet.columns.line(column)) else {
            return FormatKind::General;
        };
        if let Some(format) = self.sheet.formats.get(Leaf::NumberFormat, (r, c)) {
            let text = format.get("pattern").and_then(|p| p.as_str()).unwrap_or("General");
            return NumberFormat::parse(text).map_or(FormatKind::General, |f| f.kind());
        }
        if self.formulas.contains(&(row, column)) {
            let outcome = self.workbook.outcome(&self.sheet.id, r, c);
            return outcome.and_then(|o| o.brought.as_ref()).map_or(FormatKind::General, |b| b.kind);
        }
        self.spilled_formats.get(&(row, column)).copied().unwrap_or(FormatKind::General)
    }

    /// Whether a cell shows something to a block of records: not a cell a merged range hides, all of it but its top
    /// left, nor a checkbox that is not ticked.
    fn showing(&self) -> impl Fn(usize, usize) -> bool + '_ {
        let merged = merged_boxes(&self.workbook.bases, self.sheet);
        move |row, column| {
            !self.is_blank(row, column)
                && !merged.iter().any(|&(t, b, l, r)| t <= row && row <= b && l <= column && column <= r && (row, column) != (t, l))
                && !self.is_unticked(row, column)
        }
    }

    /// The cells showing something within a block, as tight a block as holds them all.
    fn bounds(&self, block: Block) -> Option<Block> {
        let Block { top, left, bottom, right } = block;
        if top > bottom || left > right {
            return None;
        }
        let shows = self.showing();
        let rows = || {
            self.rows.range(top..=bottom).filter(|&(&row, c)| c.range(left..=right).any(|&column| shows(row, column)))
        };
        let columns = || {
            self.columns.range(left..=right).filter(|&(&column, r)| r.range(top..=bottom).any(|&row| shows(row, column)))
        };
        let (top, bottom) = (*rows().next()?.0, *rows().next_back()?.0);
        let (left, right) = (*columns().next()?.0, *columns().next_back()?.0);
        Some(Block { top, left, bottom, right })
    }

    /// A block grown over the cells that show something beside, above or under (in its own columns and the cells'
    /// rows), from those of some cells that do, down the block's own rows, to the columns they reach. None when a cell
    /// reached beside another is a declared cell table's.
    fn grown(&self, block: Block, cells: Block, declared: &[Block]) -> Option<Block> {
        let Block { top, mut left, bottom, mut right } = block;
        let shows = self.showing();
        let in_declared = |row: usize, column: usize| {
            declared.iter().any(|d| d.top <= row && row <= d.bottom && d.left <= column && column <= d.right)
        };
        let mut reached: HashSet<(usize, usize)> = HashSet::new();
        let mut next: Vec<(usize, usize)> = Vec::new();
        // The cells it grows from are those of the cells themselves, not of the merged ranges it spans.
        for (&row, columns) in self.rows.range(cells.top..=cells.bottom) {
            for &column in columns.range(cells.left..=cells.right) {
                if shows(row, column) && reached.insert((row, column)) {
                    next.push((row, column));
                }
            }
        }
        while let Some((row, column)) = next.pop() {
            let beside = [column.checked_sub(1), column.checked_add(1)].into_iter().flatten().map(|c| (row, c, true));
            // Above and under only in the block's own columns and the cells' own rows: a cell reached beside grows
            // on beside it alone.
            let inside = block.left <= column && column <= block.right;
            let over = [row.checked_sub(1).filter(|&r| inside && r >= cells.top), row.checked_add(1).filter(|&r| inside && r <= cells.bottom)];
            for (r, c, is_beside) in beside.chain(over.into_iter().flatten().map(|r| (r, column, false))) {
                if reached.contains(&(r, c)) || !shows(r, c) {
                    continue;
                }
                if is_beside && in_declared(r, c) {
                    return None;
                }
                reached.insert((r, c));
                next.push((r, c));
                left = left.min(c);
                right = right.max(c);
            }
        }
        // Nor when, in a row of the block, a cell of a column it grows to is a declared cell table's and shows
        // something, reached or not.
        for (&row, columns) in self.rows.range(top..=bottom) {
            for &column in columns.range(left..=right) {
                let grown = column > block.right || column < block.left;
                if grown && shows(row, column) && in_declared(row, column) {
                    return None;
                }
            }
        }
        Some(Block { top, left, bottom, right })
    }

    /// The records suggestions for some cells are made for.
    pub fn records(&self, cells: Block) -> Records {
        // A single cell showing nothing (an unticked checkbox, a cell a merged range hides) picks up a table right
        // above or below it.
        let adjacent = cells.top == cells.bottom && cells.left == cells.right && !self.showing()(cells.top, cells.left);
        let candidate_area = (cells.top, cells.left, cells.bottom, cells.right);
        let relevant = tables_for_formatting(self.workbook, self.sheet, candidate_area, adjacent);
        let meets = |t: &TableForFormatting| Block::of(t.cells).meets(&cells) || Block::of(t.own).meets(&cells);
        // A cell table the sheet declares that the cells meet is theirs; of more than one, the only one with a body
        // is, else none.
        let named: Vec<&TableForFormatting> = relevant.iter().filter(|t| t.declared && meets(t)).collect();
        let mut named = match named.len() {
            0 | 1 => named,
            _ => named.into_iter().filter(|t| t.records.is_some()).collect(),
        }.into_iter();
        match (named.next(), named.next()) {
            (Some(first), None) => {
                let known_area = first.cells;
                return relevant.into_iter().find(|t| t.declared && t.cells == known_area)
                    .and_then(Records::in_table).unwrap_or_else(|| Records::of(cells));
            }
            (Some(_), Some(_)) => return Records::of(cells),
            _ => {}
        }
        let mut directly_met = relevant.iter().filter(|t| meets(t));
        let one = match (directly_met.next(), directly_met.next()) {
            (Some(first), None) => Some(first.cells),
            (None, None) if adjacent => relevant.first().map(|t| t.cells),
            // Of more than one, the one taking the most rows (the earliest of those as long) is theirs: when it is
            // the only one wider than a column, or when it is of one column, the first of them, and in the columns
            // of all the others.
            (Some(_), Some(_)) => {
                let met: Vec<&TableForFormatting> = relevant.iter().filter(|t| meets(t)).collect();
                let rows = |t: &TableForFormatting| t.cells.2 - t.cells.0;
                let wide = |t: &TableForFormatting| t.cells.1 != t.cells.3;
                let best = met.iter().copied().fold(met[0], |best, t| if rows(t) > rows(best) { t } else { best });
                let chosen = if wide(best) {
                    met.iter().filter(|t| wide(t)).count() == 1
                } else {
                    let column = best.cells.1;
                    std::ptr::eq(best, met[0]) && !best.declared
                        && met.iter().all(|t| t.cells.1 <= column && column <= t.cells.3)
                };
                chosen.then_some(best.cells)
            }
            _ => None,
        };
        if let Some(one) = one {
            let found = relevant.into_iter().find(|t| t.cells == one);
            let column = found.as_ref().filter(|t| !t.declared && t.cells.1 == t.cells.3).map(|t| t.cells.1);
            if let Some(mut records) = found.and_then(Records::in_table) {
                // A table of one column that the sheet does not declare runs on down to the last of the cells under
                // it that shows something in its column.
                let under = column.filter(|_| cells.bottom > records.table.bottom).and_then(|column| {
                    self.bounds(Block { top: records.table.bottom + 1, left: column, bottom: cells.bottom, right: column })
                });
                if let Some(under) = under {
                    records.table.bottom = under.bottom;
                    records.block.bottom = records.block.bottom.max(under.bottom);
                }
                return records;
            }
        }
        let declared: Vec<Block> = declared_areas(self.workbook, self.sheet).into_iter().map(Block::of).collect();
        // A merged range the cells meet shows across all of it what its top left shows, an unticked checkbox
        // showing nothing; not one meeting a declared cell table.
        let merged = merged_boxes(&self.workbook.bases, self.sheet).into_iter()
            .map(|(top, bottom, left, right)| Block { top, left, bottom, right })
            .filter(|m| m.meets(&cells) && !self.is_blank(m.top, m.left) && !self.is_unticked(m.top, m.left))
            .filter(|m| !declared.iter().any(|d| d.meets(m)));
        let shown = merged.fold(self.bounds(cells), |found, m| Some(found.map_or(m, |f| f.spanning(&m))));
        let loose = shown.map_or(Some(cells), |found| self.grown(found, cells, &declared)).unwrap_or(cells);
        Records::of(loose)
    }

    /// What the columns of records hold, 50 at most: from one column on, or the last 50.
    pub fn columns(&self, records: &Records, from: usize) -> Vec<Column> {
        let Block { top, left, bottom, right } = records.block;
        let start = left.max(from.min(right.saturating_sub(MOST_COLUMNS - 1)));
        let end = start.saturating_add(MOST_COLUMNS - 1).min(right);
        let (first, last) = (start.min(end), start.max(end));
        let mut tallies: Vec<Tally> = (first..=last).map(|_| Tally::default()).collect();
        for (&row, columns) in self.rows.range(top..=bottom) {
            for &column in columns.range(first..=last) {
                let shown = &self.cells[&(row, column)];
                tallies[column - first].add(row, shown, || self.format(row, column));
            }
        }
        let rows = records.block.rows().saturating_sub(records.gaps);
        let name = |c: usize| records.names.get(&c).map(|n| n.chars().take(MOST_CHARACTERS).collect::<String>());
        tallies.into_iter().zip(first..=last).map(|(tally, c)| tally.column(c, name(c), rows)).collect()
    }

    /// How many of some cells are given a dropdown (a checkbox does not count).
    pub fn dropdowns(&self, cells: Block) -> usize {
        let mut controls = 0usize;
        for row in cells.top..=cells.bottom {
            for column in cells.left..=cells.right {
                let (Some(r), Some(c)) = (self.sheet.rows.line(row), self.sheet.columns.line(column)) else { continue };
                let control = self.sheet.formats.get(Leaf::CellControl, (r, c));
                if control.is_some_and(|control| control["kind"] == "dropdown") {
                    controls = controls.saturating_add(1);
                }
            }
        }
        controls
    }
}

/// The records around some cells, and the cells of theirs suggestions are about: the columns the cells meet (else
/// all), down the rows the cells meet when more than one (else all).
pub(super) struct Around<'a> {
    pub values: Values<'a>,
    pub cells: Block,
    pub records: Records,
    pub about: Block,
    /// Whether the cells suggestions are about reach past the cells, or start outside them.
    pub widened: bool,
}

impl<'a> Around<'a> {
    pub fn of(workbook: &'a Workbook, sheet: &'a Sheet, rows: &[usize], columns: &[usize]) -> Around<'a> {
        let values = Values::of(workbook, sheet);
        let (top, bottom) = (rows[0], rows[rows.len() - 1]);
        let (left, right) = (columns[0], columns[columns.len() - 1]);
        let cells = Block { top, left, bottom, right };
        let records = values.records(cells);
        let r = records.block;
        let (low, high) = (r.left.max(cells.left), r.right.min(cells.right));
        let (left, right) = if low > high { (r.left, r.right) } else { (low, high) };
        let (low, high) = (r.top.max(cells.top), r.bottom.min(cells.bottom));
        let (top, bottom) = if low < high { (low, high) } else { (r.top, r.bottom) };
        let about = Block { top, left, bottom, right };
        let starts_inside = about.left <= cells.right
            && cells.top <= about.top
            && about.top <= cells.bottom
            && cells.left <= about.left;
        let widened = !starts_inside || about.bottom > cells.bottom || about.right > cells.right;
        Around { values, cells, records, about, widened }
    }
}

