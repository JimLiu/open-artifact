//! The tables a sheet's cells make, as they are recognized (readTablesOfSheet): the cell tables it declares,
//! then the blocks of its content (cut apart by blank rows and columns), each read as a table with a header over its
//! records when one proves itself, or else assumed one with the reason it is not recognized.

use serde_json::{json, Value as Json};

use super::grid::{Grid, Kind};
use super::{HeaderRows, Table};
use super::super::live::Role as TableRole;
use super::runs::{push_run as push_table_run, Run as TableRun};
use crate::workbook::{Sheet as WorkbookSheet, Workbook};

mod blocks;
mod body;
mod check;
mod driver;
mod header;
mod sheet;

use sheet::Sheet;

/// Why a table is assumed rather than recognized, in this order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(super) enum Reason {
    OneColumn,
    NoHeadings,
    ColumnWithoutAHeading,
    TwoColumnsOfOneName,
    MergedCellsAmongRecords,
    RowUnderTheTotal,
    SumOfSomeRecords,
    SumRunsOverHeadings,
    FewerThanTwoRecords,
    LabelsPastABlankColumn,
    HeadingComesAgain,
    MayBeLabelsAndValues,
    NothingProvesTheHeader,
    EitherOfTwoRowsMayBeTheHeader,
}

impl Reason {
    fn name(self) -> &'static str {
        match self {
            Reason::OneColumn => "oneColumn",
            Reason::NoHeadings => "noHeadings",
            Reason::ColumnWithoutAHeading => "columnWithoutAHeading",
            Reason::TwoColumnsOfOneName => "twoColumnsOfOneName",
            Reason::MergedCellsAmongRecords => "mergedCellsAmongRecords",
            Reason::RowUnderTheTotal => "rowUnderTheTotal",
            Reason::SumOfSomeRecords => "sumOfSomeRecords",
            Reason::SumRunsOverHeadings => "sumRunsOverHeadings",
            Reason::FewerThanTwoRecords => "fewerThanTwoRecords",
            Reason::LabelsPastABlankColumn => "labelsPastABlankColumn",
            Reason::HeadingComesAgain => "headingComesAgain",
            Reason::MayBeLabelsAndValues => "mayBeLabelsAndValues",
            Reason::NothingProvesTheHeader => "nothingProvesTheHeader",
            Reason::EitherOfTwoRowsMayBeTheHeader => "eitherOfTwoRowsMayBeTheHeader",
        }
    }
}

/// What a table is taken from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Basis {
    Recognized,
    Assumed(Reason),
    Declared(String),
}

impl Basis {
    pub(super) fn in_json(&self) -> Json {
        match self {
            Basis::Recognized => json!({"kind": "recognized"}),
            Basis::Assumed(reason) => json!({"kind": "assumed", "whyNotRecognized": reason.name()}),
            Basis::Declared(id) => json!({"kind": "declared", "cellTableId": id}),
        }
    }
}

/// The part a run of a table's body plays, in this order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(super) enum Role {
    Record,
    SectionLabel,
    Subtotal,
    Blank,
}

impl Role {
    fn name(self) -> &'static str {
        match self {
            Role::Record => "record",
            Role::SectionLabel => "sectionLabel",
            Role::Subtotal => "subtotal",
            Role::Blank => "blank",
        }
    }
}

/// A run of a table's body: its first and last rows and its part.
#[derive(Clone, Copy, Debug)]
pub(super) struct Run {
    pub first: usize,
    pub last: usize,
    pub role: Role,
}

/// Adds a run to a body: one of the part of the last run lengthens it.
pub(super) fn push_run(runs: &mut Vec<Run>, first: usize, last: usize, role: Role) {
    if let Some(prev) = runs.last_mut() {
        if prev.role == role {
            prev.last = last;
            return;
        }
    }
    runs.push(Run { first, last, role });
}

/// A table found in a sheet, by positions.
#[derive(Clone, Debug)]
pub(super) struct Found {
    pub header: (usize, usize),
    pub columns: (usize, usize),
    pub body: Vec<Run>,
    pub footer: Option<(usize, usize)>,
    pub basis: Basis,
    /// The body its header is proved over, when not its own: an assumed table read at a cell is proved over the
    /// records found on the sheet, not over the blocks below its reading runs on through.
    pub proved_over: Option<Vec<Run>>,
}

impl Found {
    /// The table as its header is proved: over the body found on the sheet.
    pub(super) fn as_proved(&self) -> Found {
        match &self.proved_over {
            Some(body) => Found { body: body.clone(), proved_over: None, ..self.clone() },
            None => self.clone(),
        }
    }

    /// The range a table takes: its header's first row to its footer's last, or else its body's, or else its
    /// header's.
    pub(super) fn area(&self) -> sheet::Rect {
        let bottom = match (self.footer, self.body.last()) {
            (Some((_, last)), _) => last,
            (None, Some(run)) => run.last,
            (None, None) => self.header.1,
        };
        let (first, last) = self.columns;
        sheet::Rect { top: bottom.min(self.header.0), left: last.min(first), bottom: bottom.max(self.header.0), right: last.max(first) }
    }

    /// The row under a table: its footer's first, or else the row under its last record when that shows something
    /// in its columns as the recognizer reads them, cells a merged range hides left out.
    pub(super) fn row_under(&self, grid: &Grid) -> Option<usize> {
        self.footer.map(|(first, _)| first).or_else(|| {
            let under = self.last_record()?.saturating_add(1);
            Sheet::of(grid).has_content(under, self.columns.0, self.columns.1).then_some(under)
        })
    }

    /// The row under a table as it is read: the first of the section titles its reading leaves out at its end,
    /// or else the row under its body.
    pub(super) fn row_under_reading(&self, grid: &Grid, table: Option<&Table>) -> Option<usize> {
        match table {
            Some(t) if self.last_record().is_some_and(|last| t.to < last) => self.first_left_out(t.to),
            // Rows carried down by a merged range end the body past its last record; the row under them counts
            // when it shows something a merged range does not hide.
            Some(t) if self.footer.is_none() && self.last_record().is_some_and(|last| t.to > last) => {
                let under = t.to.saturating_add(1);
                let filled = grid.filled_columns(under, self.columns.0, self.columns.1);
                filled.into_iter().any(|c| !grid.is_hidden(under, c)).then_some(under)
            }
            _ => self.row_under(grid),
        }
    }

    pub(super) fn last_record(&self) -> Option<usize> {
        self.body.iter().rev().find(|r| r.role != Role::Blank).map(|r| r.last)
    }

    /// The first row past a reading's last that is not blank: the first of the section titles it leaves out.
    pub(super) fn first_left_out(&self, to: usize) -> Option<usize> {
        self.body.iter().find(|r| r.role != Role::Blank && r.last > to).map(|r| r.first.max(to.saturating_add(1)))
    }

    /// The other tables an assumed table read at a cell stops short of: all but the assumed ones with no headings,
    /// of fewer than two records, or with a header that typed records under it do not prove, that lie within the
    /// columns of its header, the tables joined to it taken in, which it is read on through, and
    /// those meeting its header. One reaching past those columns, to the left or the right, bounds it.
    fn neighbors(&self, grid: &Grid, all: &[Found], own: &sheet::Rect) -> Vec<sheet::Rect> {
        let few = |t: &Found| {
            let records: usize = t.body.iter().filter(|r| r.role == Role::Record).map(|r| r.last - r.first + 1).sum();
            records < 2
        };
        let within = |t: &Found| {
            let a = t.area();
            own.left <= a.left && a.right <= own.right
        };
        let unproved = |t: &Found| {
            t.basis == Basis::Assumed(Reason::NoHeadings) || few(t) || !Sheet::of(grid).assumed_header_is_typed(&t.as_proved())
        };
        let loose = |t: &Found| matches!(t.basis, Basis::Assumed(_)) && unproved(t) && within(t);
        all.iter()
            .filter(|t| !std::ptr::eq(*t, self) && !loose(t))
            .map(Found::area)
            .filter(|a| !a.meets(own))
            .collect()
    }

    /// Read at a cell, a table with tables of its header beside it, a blank column apart and with headings: read as
    /// one table, the blank columns without a heading; but not across another table, nor where two columns of the
    /// tables joined are named alike (case aside), in one table too.
    fn joined(&self, grid: &Grid, all: &[Found]) -> Option<Found> {
        let joins = |t: &Found| {
            matches!(t.basis, Basis::Assumed(r) if r != Reason::NoHeadings) || t.basis == Basis::Recognized
        };
        let sheet_of = Sheet::of(grid);
        let names = |t: &Found| -> Vec<String> {
            (t.header.0..=t.header.1)
                .flat_map(|row| sheet_of.cells_in(row, t.columns.0, t.columns.1).iter())
                .filter_map(|c| match c.value {
                    sheet::Value::Text(text) => Some(text.chars().flat_map(char::to_lowercase).collect()),
                    _ => None,
                })
                .collect()
        };
        let mut named = names(self);
        let mut joined: Vec<&Found> = vec![self];
        let mut span = self.area();
        loop {
            let next = all.iter().find(|t| {
                joins(t)
                    && t.header == self.header
                    && (t.columns.1.saturating_add(2) == span.left || t.columns.0 == span.right.saturating_add(2))
            });
            let Some(t) = next else { break };
            let a = t.area();
            let wider = sheet::Rect {
                top: span.top.min(a.top),
                left: span.left.min(a.left),
                bottom: span.bottom.max(a.bottom),
                right: span.right.max(a.right),
            };
            let across = all
                .iter()
                .any(|o| !std::ptr::eq(o, t) && !joined.iter().any(|j| std::ptr::eq(*j, o)) && o.area().meets(&wider));
            // Nor when a column's name comes twice among them, in one table too.
            let mut both = named.clone();
            both.extend(names(t));
            let alike = both.iter().enumerate().any(|(i, n)| both[..i].contains(n));
            if across || alike {
                break;
            }
            named = both;
            joined.push(t);
            span = wider;
        }
        let (left, right) = (span.left, span.right);
        if (left, right) == self.columns {
            return None;
        }
        // Its header is proved over the records the tables hold.
        let records: std::collections::BTreeSet<usize> = joined
            .iter()
            .flat_map(|t| t.body.iter().filter(|r| r.role == Role::Record).flat_map(|r| r.first..=r.last))
            .collect();
        let mut proved = Vec::new();
        if let (Some(&first), Some(&last)) = (records.first(), records.last()) {
            for row in first..=last {
                let role = if records.contains(&row) { Role::Record } else { Role::Blank };
                push_run(&mut proved, row, row, role);
            }
        }
        let own = sheet::Rect { top: self.header.0, left, bottom: self.header.1, right };
        let neighbors = self.neighbors(grid, all, &own);
        Some(Found {
            basis: Basis::Assumed(Reason::ColumnWithoutAHeading),
            proved_over: Some(proved),
            ..Sheet::of(grid).read_declaration(self.header, (left, right), None, &neighbors, Basis::Recognized)
        })
    }

    /// The table as it is read at a cell: an assumed one with a header has its body read as a declared table's,
    /// down through the blocks under it that go on from it, short of the other tables of the sheet with headings;
    /// tables of its header a blank column apart are read with it as one.
    pub(super) fn at_cell(&self, grid: &Grid, sheet: &WorkbookSheet, all: &[Found]) -> Found {
        self.read_at_cell(grid, sheet, all, true)
    }

    /// The table as conditional-format suggestions read it at a cell: as at a cell, but not joined to the tables
    /// beside it.
    pub(super) fn at_cell_alone(&self, grid: &Grid, sheet: &WorkbookSheet, all: &[Found]) -> Found {
        self.read_at_cell(grid, sheet, all, false)
    }

    fn read_at_cell(&self, grid: &Grid, sheet: &WorkbookSheet, all: &[Found], join: bool) -> Found {
        // A table with no header takes a row of headings two rows above it as its header, a block of one row
        // proving fewer than two records; its rows are all records, under the blank row.
        if self.basis == Basis::Assumed(Reason::NoHeadings) {
            let tables: Vec<sheet::Rect> = all.iter().map(Found::area).collect();
            if let Some(row) = Sheet::of(grid).headings_above(self.header.0, self.columns, &tables) {
                let top = self.header.0;
                let mut body = vec![Run { first: row + 1, last: row + 1, role: Role::Blank }];
                push_run(&mut body, top, self.header.1, Role::Record);
                for run in &self.body {
                    push_run(&mut body, run.first, run.last, run.role);
                }
                return Found {
                    header: (row, row),
                    columns: self.columns,
                    body,
                    footer: None,
                    basis: Basis::Assumed(Reason::FewerThanTwoRecords),
                    proved_over: None,
                };
            }
        }
        // A table assumed for having one column whose header shows no text, as a number merged across columns, has
        // no headings at a cell: its header's rows are records. One whose header of more than one row shows nothing
        // in its columns keeps it.
        if self.basis == Basis::Assumed(Reason::OneColumn) {
            let sheet_of = Sheet::of(grid);
            let cells = || (self.header.0..=self.header.1).flat_map(|row| sheet_of.cells_in(row, self.columns.0, self.columns.1).iter());
            if (self.header.0 == self.header.1 || cells().next().is_some()) && !cells().any(|c| c.is_text()) {
                return Found { basis: Basis::Assumed(Reason::NoHeadings), ..self.clone() };
            }
        }
        let joins = join && (matches!(self.basis, Basis::Assumed(r) if r != Reason::NoHeadings)
            || (self.basis == Basis::Recognized && self.footer.is_none()));
        if let Some(found) = joins.then(|| self.joined(grid, all)).flatten() {
            return found;
        }
        match self.basis {
            Basis::Assumed(reason) if reason != Reason::NoHeadings => {
                let own = sheet::Rect { top: self.header.0, left: self.columns.0, bottom: self.header.1, right: self.columns.1 };
                let neighbors = self.neighbors(grid, all, &own);
                let mut read = Sheet::of(grid).read_assumed_at_cell(self.header, self.columns, &neighbors);
                // Not where a merged range across columns showing something meets the rows that reading has under
                // its header: the table is read as it is found.
                let under = sheet::Rect { top: self.header.1 + 1, bottom: read.area().bottom, ..read.area() };
                let across = under.top <= under.bottom && Sheet::of(grid).merges_meeting(under).any(|m| m.left < m.right);
                if across {
                    return self.clone();
                }
                // The rows of unticked checkboxes only that a declared table's body ends in are not an assumed
                // table's.
                let sheet_of = Sheet::of(grid);
                let (c0, c1) = read.columns;
                let unticked = |row: usize| !sheet_of.unticked_in(row, c0, c1).is_empty() && !sheet_of.has_content(row, c0, c1);
                if let Some(run) = read.body.last_mut().filter(|run| run.role == Role::Blank) {
                    while run.last >= run.first && unticked(run.last) {
                        if run.last == run.first {
                            read.body.pop();
                            break;
                        }
                        run.last -= 1;
                    }
                }
                // A record that sums the records above it, where that reading finds no footer, keeps the body as
                // found: it does not run on. So does a record that reading runs on to that sums a
                // range of its own column, if the last or if the range starts over something above the header.
                let end = self.body.last().map_or(self.header.1, |run| run.last);
                let frame = body::Frame { header: self.header, columns: self.columns };
                let last = read.body.last().map_or(end, |run| run.last);
                if read.footer.is_none()
                    && (sheet_of.sums_the_records_above(&frame, self.header.1.saturating_add(1), end)
                        || sheet_of.sums_past(&frame, self.header.1.saturating_add(1), last, end))
                {
                    return self.clone();
                }
                // Its header is proved over the body found on the sheet, down to the footer that reading ends in.
                let mut proved = self.body.clone();
                if let Some((first, _)) = read.footer {
                    proved.retain_mut(|run| {
                        run.last = run.last.min(first.saturating_sub(1));
                        run.first < first
                    });
                }
                Found { basis: self.basis.clone(), proved_over: Some(proved), ..read }
            }
            Basis::Recognized if self.footer.is_none() => self.run_on(grid, sheet, all),
            _ => self.clone(),
        }
    }

    /// A recognized table at a cell runs on through the rows past its body that its reading as a declared cell
    /// table of its header and columns runs on through, to the last record of that reading,
    /// short of the other tables an assumed one read at a cell stops short of.
    pub(super) fn run_on(&self, grid: &Grid, sheet: &WorkbookSheet, all: &[Found]) -> Found {
        let own = sheet::Rect { top: self.header.0, left: self.columns.0, bottom: self.header.1, right: self.columns.1 };
        let read = read_declaration_short_of(grid, sheet, self.header, self.columns, None, &self.neighbors(grid, all, &own));
        let end = self.body.last().map_or(self.header.1, |run| run.last);
        let Some(last) = read.last_record().filter(|&last| last > end && read.columns == self.columns) else {
            return self.clone();
        };
        let mut body = self.body.clone();
        for run in read.body.iter().filter(|run| run.last > end && run.first <= last) {
            push_run(&mut body, run.first.max(end + 1), run.last.min(last), run.role);
        }
        Found { body, ..self.clone() }
    }

    /// The basis a table is read on at a cell: a table assumed for having one column, spanning more than one or with
    /// a header nothing proves, is told why its header is not proved instead.
    pub(super) fn basis_at(&self, grid: &Grid, table: &Table) -> Basis {
        match self.basis {
            Basis::Assumed(Reason::OneColumn) if !table.header.is_some_and(|h| h.is_sure) => {
                Basis::Assumed(Sheet::of(grid).reason_unproved(&self.as_proved()))
            }
            ref basis => basis.clone(),
        }
    }

    /// A table's body as read, from its header down to its last row, as the recognizer reads one (f235), its rows
    /// given their parts: the row its reading ends on, above a footer it may end in; none when it can't be a
    /// table's.
    pub(super) fn body_read(&self, grid: &Grid, table: &Table) -> Option<usize> {
        let header = table.header?;
        let frame = body::Frame { header: (header.first, header.last), columns: (table.first_column, table.last_column) };
        let declared = matches!(self.basis, Basis::Declared(_));
        let body = Sheet::of(grid).recognized_body(&frame, table.to, table.to, declared).ok()?;
        let read = Found { body: body.runs, footer: body.footer, proved_over: None, ..self.clone() };
        Some(read.reading(grid).map_or(table.to, |t| t.to))
    }

    /// The header and runs as the page tells them for an individual table.
    pub(super) fn reading(&self, grid: &Grid) -> Option<Table> {
        let (first_column, last_column) = self.columns;
        // Blank rows after the last record that show what a merged range carries down are the body's too.
        // A body of blank rows only, as a declared table's over its footer, is read through its last.
        let last = match self.last_record() {
            Some(last) => last,
            None => self.body.last()?.last,
        };
        // A merged range shows in a row wherever its left column is.
        let mut to = last;
        'runs: for run in self.body.iter().filter(|r| r.first > last) {
            if run.role != Role::Blank {
                break;
            }
            for row in run.first..=run.last {
                if grid.rows_showing(row, row, first_column, last_column).is_empty() {
                    break 'runs;
                }
                to = row;
            }
        }
        let header = match self.basis {
            // A header the first record could stand for as well is not sure.
            Basis::Assumed(Reason::NoHeadings) => None,
            Basis::Assumed(reason) => Some(HeaderRows {
                first: self.header.0,
                last: self.header.1,
                is_sure: reason != Reason::EitherOfTwoRowsMayBeTheHeader && Sheet::of(grid).assumed_header_is_typed(&self.as_proved()),
            }),
            _ => Some(HeaderRows { first: self.header.0, last: self.header.1, is_sure: true }),
        };
        let from = header.map_or(self.header.0, |h| h.last.saturating_add(1));
        if from > to {
            return None;
        }
        let rows = grid.owned_rows(from, to, first_column, last_column);
        // A section's title is a text in the table's first column with nothing else in its row, in a table of more
        // than one column, whether or not it has a header; cells a merged range hides, or carries
        // down from a row above, do not count.
        let is_section_title = |row: usize| {
            let mut filled = grid.filled_columns(row, first_column, last_column);
            filled.retain(|&c| !grid.is_hidden(row, c) && !grid.is_carried(row, c));
            first_column < last_column && filled == [first_column] && grid.kind(row, first_column) == Kind::Text
        };
        // Lone texts are sections' titles only when the records outnumber them, and never in a declared table.
        let declared = matches!(self.basis, Basis::Declared(_));
        let record_rows = || {
            let runs: Vec<&Run> = self.body.iter().filter(|r| r.role == Role::Record).collect();
            rows.iter().copied().filter(move |&row| row <= to && runs.iter().any(|r| r.first <= row && row <= r.last))
        };
        let titles = record_rows().filter(|&row| is_section_title(row)).count();
        let sections = !declared && titles < record_rows().count() - titles;
        let split_sections = |run: &Run, runs: &mut Vec<TableRun>| {
            if !sections {
                push_table_run(runs, run.first.max(from), run.last, TableRole::Record);
                return;
            }
            let mut next = run.first.max(from);
            let first = rows.partition_point(|&row| row < next);
            for &row in rows[first..].iter().take_while(|&&row| row <= run.last) {
                if is_section_title(row) {
                    if next < row {
                        push_table_run(runs, next, row - 1, TableRole::Record);
                    }
                    push_table_run(runs, row, row, TableRole::Section);
                    next = row.saturating_add(1);
                }
            }
            if next <= run.last {
                push_table_run(runs, next, run.last, TableRole::Record);
            }
        };
        let mut runs = Vec::new();
        if let Some(first) = self.body.first().map(|r| r.first).filter(|&first| from < first) {
            push_table_run(&mut runs, from, first - 1, TableRole::Record);
        }
        for run in self.body.iter().filter(|r| from <= r.last && r.first <= to) {
            let role = match run.role {
                Role::Record => {
                    split_sections(run, &mut runs);
                    continue;
                }
                Role::SectionLabel => TableRole::Section,
                Role::Subtotal => TableRole::Subtotal,
                Role::Blank => TableRole::Spacer,
            };
            push_table_run(&mut runs, run.first.max(from), run.last.min(to), role);
        }
        // Section titles with no records after them end the body above them, with the rows a merged range carries
        // down from them and the blank rows before them that show nothing: the first is the row under it. Over a
        // footer they stay, but a body of titles and blank rows with no record is no table's.
        let kept = runs.iter().rposition(|r| r.role != TableRole::Section && r.role != TableRole::Spacer);
        if self.footer.is_some() {
            if kept.is_none() && runs.iter().any(|r| r.role == TableRole::Section) {
                return None;
            }
        } else if let Some(title) = runs.iter().skip(kept.map_or(0, |k| k + 1)).position(|r| r.role == TableRole::Section) {
            runs.truncate(kept.map_or(0, |k| k + 1) + title);
            let shows_nothing = |row: usize| grid.rows_showing(row, row, first_column, last_column).is_empty();
            while let Some(run) = runs.last_mut().filter(|r| kept.is_some() && r.role == TableRole::Spacer && shows_nothing(r.last)) {
                if run.first == run.last {
                    runs.pop();
                } else {
                    run.last -= 1;
                }
            }
        }
        let to = runs.last()?.last;
        Some(Table { header, first_column, last_column, from, to, runs })
    }
}

/// The classified tables of a sheet, in sheet order.
pub(super) fn found_tables(grid: &Grid, sheet: &WorkbookSheet) -> Vec<Found> {
    Sheet::of(grid).tables(sheet)
}

/// Whether a cell table's header shows something in its columns, as the recognizer reads the sheet: a merged range
/// only on its first row.
pub(super) fn header_shows(grid: &Grid, (top, bottom): (usize, usize), (left, right): (usize, usize)) -> bool {
    Sheet::of(grid).first_content_row(top, bottom, left, right).is_some()
}

/// Read an offered declaration against the other tables declared on the sheet, each as it is read. One whose
/// declared rows and columns it meets does not bound its widening.
pub(super) fn read_declaration(
    grid: &Grid, sheet: &WorkbookSheet, header: (usize, usize), columns: (usize, usize),
    footer: Option<(usize, usize)>,
) -> Found {
    read_declaration_short_of(grid, sheet, header, columns, footer, &[])
}

/// A declaration read as `read_declaration` reads it, its body short of some more tables too.
fn read_declaration_short_of(
    grid: &Grid, sheet: &WorkbookSheet, header: (usize, usize), columns: (usize, usize),
    footer: Option<(usize, usize)>, more: &[sheet::Rect],
) -> Found {
    let places = super::cell_tables::declared_places(grid.workbook(), sheet);
    let neighbors = declared_neighbors(&found_tables(grid, sheet), &places, header, columns, footer);
    let own = own_rect(header, columns, footer);
    let beside: Vec<sheet::Rect> = neighbors.iter().filter(|(_, declared)| !declared.meets(&own)).map(|n| n.0).collect();
    let neighbors: Vec<sheet::Rect> = neighbors.into_iter().map(|n| n.0).chain(more.iter().copied()).collect();
    Sheet::of(grid).read_declaration_beside(header, columns, footer, &neighbors, &beside, Basis::Recognized)
}

/// The rows and columns an offered declaration takes: its header's first row to its footer's last.
fn own_rect(header: (usize, usize), columns: (usize, usize), footer: Option<(usize, usize)>) -> sheet::Rect {
    let bottom = footer.map_or(header.1, |f| f.1).max(header.1);
    sheet::Rect { top: header.0, left: columns.0, bottom, right: columns.1 }
}

/// The areas of the declared tables a sheet reads, as they are read, with the area each declares, but those whose
/// header, over the columns declared, meets the offered one's rows (its header's to its footer's) over its columns:
/// one offered in a declared table's body is bounded by it, and one beside a declared header the table is read
/// wider than is bounded by it too.
fn declared_neighbors(
    found: &[Found], places: &[(String, (usize, usize), (usize, usize), Option<(usize, usize)>)],
    header: (usize, usize), columns: (usize, usize), footer: Option<(usize, usize)>,
) -> Vec<(sheet::Rect, sheet::Rect)> {
    let own = own_rect(header, columns, footer);
    let place = |t: &Found| match &t.basis {
        Basis::Declared(id) => places.iter().find(|p| &p.0 == id),
        _ => None,
    };
    let declared = |t: &Found| {
        let (header, columns, footer) = place(t).map_or((t.header, t.columns, t.footer), |p| (p.1, p.2, p.3));
        let bottom = footer.map_or(header.1, |f| f.1);
        let (top, bottom) = (header.0.min(bottom), header.0.max(bottom));
        sheet::Rect { top, left: columns.0.min(columns.1), bottom, right: columns.0.max(columns.1) }
    };
    let heading = |t: &Found| {
        let declared = place(t).map_or(t.columns, |p| p.2);
        let (left, right) = (declared.0.min(declared.1), declared.0.max(declared.1));
        sheet::Rect { top: t.header.0, left, bottom: t.header.1, right }
    };
    found
        .iter()
        .filter(|t| matches!(t.basis, Basis::Declared(_)) && !heading(t).meets(&own))
        .map(|t| (t.area(), declared(t)))
        .collect()
}

/// The tables of a sheet, as the page reads them.
pub(in crate::session::reads) fn tables_of_sheet(workbook: &Workbook, sheet: &WorkbookSheet) -> Vec<Json> {
    let grid = Grid::of(workbook, sheet);
    let found = found_tables(&grid, sheet);
    found.iter().filter_map(|t| in_ids(workbook, sheet, &grid, t)).collect()
}

/// A table by the ids of its rows and columns, with its columns' names and kinds; none when a row or column it
/// names is gone.
fn in_ids(workbook: &Workbook, sheet: &WorkbookSheet, grid: &Grid, t: &Found) -> Option<Json> {
    let row = |r: usize| sheet.rows.line(r).map(|l| workbook.bases.text(l));
    let column = |c: usize| sheet.columns.line(c).map(|l| workbook.bases.text(l));
    let records: Vec<(usize, usize)> = t.body.iter().filter(|r| r.role == Role::Record).map(|r| (r.first, r.last)).collect();
    let columns = grid.recognized_columns(t.header, t.columns.0, t.columns.1, &records);
    let (h1, h2, c1, c2) = (row(t.header.0)?, row(t.header.1)?, column(t.columns.0)?, column(t.columns.1)?);
    let columns = columns
        .into_iter()
        .map(|c| Some(json!({"c": column(c.column)?, "name": c.name, "kind": c.kind.name()})))
        .collect::<Option<Vec<Json>>>()?;
    let body = t
        .body
        .iter()
        .map(|r| Some(json!({"firstRow": row(r.first)?, "lastRow": row(r.last)?, "role": r.role.name()})))
        .collect::<Option<Vec<Json>>>()?;
    let footer = match t.footer {
        Some((first, last)) => json!({"firstRow": row(first)?, "lastRow": row(last)?}),
        None => Json::Null,
    };
    Some(json!({
        "basis": t.basis.in_json(),
        "headerRows": {"firstRow": h1, "lastRow": h2},
        "firstColumn": c1,
        "lastColumn": c2,
        "columns": columns,
        "body": body,
        "footerRows": footer,
    }))
}

