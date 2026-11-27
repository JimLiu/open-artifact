//! A table's body as the recognizer reads it: the rows under its header that show something (each with the formula
//! references it makes into the table and the sums among them, f271), the part each plays (f185), and the body of a
//! recognized table with its footer (f235), or the plain body where every row showing something is a record (f2167).

use std::collections::BTreeSet;

use super::super::grid::Spot;
use super::sheet::{Cell, Rect, Sheet, Skip};
use super::{push_run, Reason, Role, Run};

/// A table's header rows and columns, as its body is read under them.
#[derive(Clone, Copy, Debug)]
pub(super) struct Frame {
    pub header: (usize, usize),
    pub columns: (usize, usize),
}

/// A body: its runs, the footer it ends with if any (its first row and the body's last), and whether it has
/// subtotals.
#[derive(Clone, Debug, Default)]
pub(super) struct Body {
    pub footer: Option<(usize, usize)>,
    pub runs: Vec<Run>,
    pub subtotals: bool,
}

/// A range a row's formula reads that meets the table's columns and the rows from its header to the row above: the
/// formula's column, and the range.
#[derive(Clone, Copy, Debug)]
struct RangeRef {
    own: usize,
    top: usize,
    left: usize,
    bottom: usize,
    right: usize,
}

/// A range that totals a column of the records: the column, and the range's first and last rows.
#[derive(Clone, Copy, Debug)]
struct Sum {
    column: usize,
    first: usize,
    last: usize,
}

/// A row under a header that shows something.
struct Rec<'s, 'g> {
    cells: &'s [Cell<'g>],
    row: usize,
    /// The ranges its formulas read over the table above it.
    ranges: Vec<RangeRef>,
    /// The cells its formulas read in the table above it (from the header down): their row, and whether in the
    /// formula's own column.
    above: Vec<(usize, bool)>,
    /// The rows of the cells its formulas read in the table below it.
    below: Vec<usize>,
    sums: Vec<Sum>,
    /// Whether blank rows come right before it.
    gap_before: bool,
}

/// A group of records a subtotal may sum: none (`tag` 2; 3 for the section group), an ordinary one (0), or one
/// restarted after blank rows (1, `row` its first record's row); its first and last records by index.
#[derive(Clone, Copy, Debug)]
struct Group {
    tag: u8,
    row: usize,
    start: usize,
    end: usize,
}

/// What a group's sum reads as starting from.
#[derive(Clone, Copy, Debug)]
struct Kept {
    a: Group,
    b: Group,
    b_lower: usize,
    seen_subtotal: bool,
    fresh_subtotal: bool,
}

/// The parts f185 gives the rows: each row's (in order, up to where it stops), with what it saw.
struct Roles {
    first_merged: Option<usize>,
    kept: Kept,
    rows: Vec<(usize, Role)>,
}

/// The records of a body with what reading their parts asks of them again and again.
struct View<'v, 's, 'g> {
    frame: Frame,
    recs: &'v [Rec<'s, 'g>],
    /// The rows any record reads a cell of above it.
    read_above: BTreeSet<usize>,
    /// For each record, the next one with sums.
    next_with_sums: Vec<Option<usize>>,
    /// For each record, the next one not a lone label.
    next_not_label: Vec<Option<usize>>,
    /// Whether plain records (two cells or more, no references above) already start bold (0) or filled (1).
    styles: [bool; 2],
}

/// The records of a group, by index (none when the indices are off).
fn group_of<'v, 's, 'g>(recs: &'v [Rec<'s, 'g>], g: Group) -> &'v [Rec<'s, 'g>] {
    if g.end >= recs.len() || g.end.saturating_add(1) < g.start {
        &[]
    } else {
        &recs[g.start..=g.end]
    }
}

/// The runs of a body from the parts of its rows: gaps blank, down to a row.
fn runs_of(first: usize, last: usize, rows: &[(usize, Role)]) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut cur = first;
    for &(row, role) in rows {
        if cur < row {
            push_run(&mut runs, cur, row - 1, Role::Blank);
        }
        push_run(&mut runs, row, row, role);
        cur = row.saturating_add(1);
    }
    if cur <= last {
        push_run(&mut runs, cur, last, Role::Blank);
    }
    runs
}

impl<'g> Sheet<'g> {
    /// Whether a cell is bold (0) or filled (1).
    fn styled(&self, k: usize, row: usize, column: usize) -> bool {
        if k == 0 {
            self.grid.is_bold(row, column)
        } else {
            self.grid.is_filled(row, column)
        }
    }

    /// Whether a record from one row to another sums a range of its own column that starts at the header or above.
    pub(super) fn sums_from_the_header(&self, frame: &Frame, from: usize, to: usize) -> bool {
        self.records(frame, from, to).iter().any(|rec| rec.sums.iter().any(|s| s.first <= frame.header.1))
    }

    /// Whether a record from one row to another, but the last, sums its own column over records from the first, or
    /// from the header, down to the row above it.
    pub(super) fn sums_the_records_above(&self, frame: &Frame, from: usize, to: usize) -> bool {
        let recs = self.records(frame, from, to);
        let last = recs.last().map(|rec| rec.row);
        let first = frame.header.1.saturating_add(1);
        recs.iter().any(|rec| {
            Some(rec.row) != last
                && rec.sums.iter().any(|s| s.first <= first && first <= s.last && s.last.saturating_add(1) == rec.row)
        })
    }

    /// Whether a record from one row to another, past a row, sums a range of its own column: the last, a lone label
    /// aside, any such range, and any other one from a cell above the header that shows something on to the header.
    pub(super) fn sums_past(&self, frame: &Frame, from: usize, to: usize, past: usize) -> bool {
        let recs = self.records(frame, from, to);
        let head = frame.header.0;
        let over = |s: &Sum| {
            s.first < head && head <= s.last && self.first_content_row(s.first, head - 1, s.column, s.column).is_some()
        };
        let last = recs.iter().rev().find(|r| !self.is_lone_label(frame, r)).map(|r| r.row);
        recs.iter().any(|r| r.row > past && ((Some(r.row) == last && !r.sums.is_empty()) || r.sums.iter().any(over)))
    }

    /// Whether a record from one row to another sums a range of its own column, ending above it, over every cell of
    /// that column in the records above it, one at least.
    pub(super) fn sums_its_cells_above(&self, frame: &Frame, from: usize, to: usize) -> bool {
        let recs = self.records(frame, from, to);
        recs.iter().any(|rec| {
            rec.sums.iter().any(|s| {
                let mut above = recs.iter().filter(|r| r.row < rec.row && r.cells.iter().any(|c| c.column == s.column));
                let Some(first) = above.next().map(|r| r.row) else { return false };
                let last = above.last().map_or(first, |r| r.row);
                s.last < rec.row && s.first <= first && last <= s.last
            })
        })
    }

    /// Whether the last record from one row to another, a lone label aside, sums a range of its own column.
    pub(super) fn last_record_sums(&self, frame: &Frame, from: usize, to: usize) -> bool {
        let recs = self.records(frame, from, to);
        recs.iter().rev().find(|r| !self.is_lone_label(frame, r)).is_some_and(|r| !r.sums.is_empty())
    }

    /// The rows under a header from one row to another that show something, with their references and sums.
    fn records<'s>(&'s self, frame: &Frame, from: usize, to: usize) -> Vec<Rec<'s, 'g>> {
        let (c0, c1) = frame.columns;
        let (cl, ch) = (c0.min(c1), c0.max(c1));
        let mut recs = Vec::new();
        let mut from = from;
        while let Some(r) = self.first_content_row(from, to, c0, c1) {
            let cells = self.cells_in(r, c0, c1);
            let mut rec =
                Rec { cells, row: r, ranges: Vec::new(), above: Vec::new(), below: Vec::new(), sums: Vec::new(), gap_before: from < r };
            let up = r.saturating_sub(1);
            let (lo, hi) = (up.min(frame.header.0), up.max(frame.header.0));
            for cell in cells {
                for spot in self.grid.formula_spots(cell.row, cell.column) {
                    match spot {
                        Spot::Range(top, left, bottom, right) => {
                            if top <= hi && lo <= bottom && left <= ch && cl <= right {
                                rec.ranges.push(RangeRef { own: cell.column, top, left, bottom, right });
                            }
                        }
                        Spot::Cell(row, column) => {
                            if lo <= row && row <= hi && cl <= column && column <= ch {
                                rec.above.push((row, column == cell.column));
                            } else if row > r && c0 <= column && column <= c1 {
                                rec.below.push(row);
                            }
                        }
                    }
                }
            }
            recs.push(rec);
            if r == usize::MAX {
                break;
            }
            from = r + 1;
        }
        for i in 0..recs.len() {
            let sums = self.sums(frame, &recs, i);
            recs[i].sums = sums;
        }
        recs
    }

    /// The ranges of a record that total a column of the records: those not just one more of the same formula as the
    /// nearest record above or below with a cell in the column (the same relative end, and the same start or the same
    /// relative one).
    fn sums(&self, frame: &Frame, recs: &[Rec], i: usize) -> Vec<Sum> {
        let rec = &recs[i];
        let row = rec.row;
        let has = |j: usize, c: usize| recs[j].cells.iter().any(|x| x.column == c) && !self.is_lone_label(frame, &recs[j]);
        rec.ranges
            .iter()
            .filter_map(|range| {
                if !(range.left <= range.own && range.own <= range.right) {
                    return None;
                }
                let (c, first, last) = (range.own, range.top, range.bottom);
                let prev = (0..i).rev().find(|&j| has(j, c));
                let next = if i + 1 >= recs.len() { None } else { (i + 1..recs.len()).find(|&j| has(j, c)) };
                for n in [prev, next].into_iter().flatten() {
                    let n_row = recs[n].row;
                    for t in &recs[n].ranges {
                        if t.own != c || !(t.left <= c && c <= t.right) {
                            continue;
                        }
                        let end_match = (row >= last && n_row >= t.bottom && row - last == n_row - t.bottom)
                            || (row < last && n_row < t.bottom);
                        if !end_match {
                            continue;
                        }
                        if t.top == first {
                            return None;
                        }
                        let start_match = (row >= first && n_row >= t.top && row - first == n_row - t.top)
                            || (row < first && n_row < t.top);
                        if start_match {
                            return None;
                        }
                    }
                }
                Some(Sum { column: c, first, last })
            })
            .collect()
    }

    /// A row of one text in the first column of a table wider than one, with no unticked checkbox.
    fn is_lone_label(&self, frame: &Frame, rec: &Rec) -> bool {
        let (c0, c1) = frame.columns;
        rec.cells.len() == 1
            && rec.cells[0].column == c0
            && c0 < c1
            && rec.cells[0].is_text()
            && self.unticked_in(rec.row, c0, c1).is_empty()
    }

    fn view<'v, 's>(&self, frame: Frame, recs: &'v [Rec<'s, 'g>]) -> View<'v, 's, 'g> {
        let n = recs.len();
        let mut next_with_sums = vec![None; n];
        let mut next_not_label = vec![None; n];
        let (mut s, mut l) = (None, None);
        for j in (0..n).rev() {
            next_with_sums[j] = s;
            next_not_label[j] = l;
            if !recs[j].sums.is_empty() {
                s = Some(j);
            }
            if !self.is_lone_label(&frame, &recs[j]) {
                l = Some(j);
            }
        }
        let read_above = recs.iter().flat_map(|r| r.above.iter().map(|a| a.0)).collect();
        let styles = [0, 1].map(|k| {
            recs.iter().any(|r| {
                r.ranges.is_empty() && r.above.is_empty() && r.cells.len() >= 2 && self.styled(k, r.cells[0].row, r.cells[0].column)
            })
        });
        View { frame, recs, read_above, next_with_sums, next_not_label, styles }
    }

    /// The row a record speaks for: its own, or a lone label's next record not one.
    fn label_target(&self, view: &View, i: usize) -> Option<usize> {
        let rec = &view.recs[i];
        if !self.is_lone_label(&view.frame, rec) {
            return Some(rec.row);
        }
        view.next_not_label[i].map(|j| view.recs[j].row)
    }

    /// Whether records start a heading again: lone labels, then (with no blank rows between) a row filled in three
    /// columns or more and in more than half of a table three columns wide or more, not a row of years or dates.
    fn starts_heading_again(&self, frame: &Frame, recs: &[Rec]) -> bool {
        let (c0, c1) = frame.columns;
        let n = recs.len();
        if n == 0 {
            return false;
        }
        let k = recs.iter().take_while(|r| self.is_lone_label(frame, r)).count();
        let width = c1.saturating_sub(c0).saturating_add(1);
        if !(width >= 3 && k >= 1) {
            return false;
        }
        if recs[1..k].iter().any(|r| r.gap_before) {
            return false;
        }
        if k == n || recs[k].gap_before || recs[k].cells.len() < 3 || recs[k].cells.len() * 2 <= width {
            return false;
        }
        !self.is_heading_row(recs[k].row, c0, c1, None, Skip::LabelLike)
    }

    /// Whether a sum of a record totals a group's records.
    fn sum_covers(&self, rec: &Rec, lower: usize, g: Group, slice: &[Rec]) -> bool {
        for s in &rec.sums {
            if lower > s.first || slice.is_empty() {
                continue;
            }
            let has = |r: &&Rec| r.cells.iter().any(|c| c.column == s.column);
            let f = slice.iter().find(has).unwrap_or(&slice[0]);
            let l = slice.iter().rev().find(has).unwrap_or(&slice[slice.len() - 1]);
            if !(s.first <= f.row && f.row <= s.last && s.first <= l.row && l.row <= s.last) {
                continue;
            }
            if g.tag != 1 || (s.first <= g.row && g.row <= s.last) {
                return true;
            }
        }
        false
    }

    /// Whether a sum of a record totals a group, or (before blank rows) the group but its first or last record.
    fn group_summed(&self, rec: &Rec, lower: usize, g: Group, slice: &[Rec], next_gap: bool) -> bool {
        self.sum_covers(rec, lower, g, slice)
            || (next_gap
                && slice.len() >= 3
                && (self.sum_covers(rec, lower, g, &slice[1..]) || self.sum_covers(rec, lower, g, &slice[..slice.len() - 1])))
    }

    /// The part each record plays down to a row: record, section label, subtotal or blank (f185). It stops at a row
    /// that starts something else; a row under a subtotal that no record reads is why the body is not a table's.
    fn roles(&self, view: &View, end_row: usize) -> Result<Roles, Reason> {
        let recs = view.recs;
        let (c0, c1) = view.frame.columns;
        let hl = view.frame.header.1;
        let none = |tag| Group { tag, row: 0, start: 0, end: 0 };
        let mut first_merged: Option<usize> = None;
        let mut kept = Kept { a: none(2), b: none(3), b_lower: 0, seen_subtotal: false, fresh_subtotal: false };
        let mut rows: Vec<(usize, Role)> = Vec::new();
        let mut lower = 0usize;
        // l18: after a subtotal, until a sum covers the rows; l19: a region a later row may still close; l20: a
        // record or label already seen.
        let (mut after_subtotal, mut open, mut seen) = (false, false, false);
        let mut pending = 3u8;
        let mut saved = kept;
        let mut saved_len = 0usize;
        let (mut first_rec_row, mut last_rec_row) = (0usize, 0usize);
        let mut subtotal_rows: BTreeSet<usize> = BTreeSet::new();
        enum Act {
            Subtotal(bool),
            Section,
            Record,
            Label,
            Blank,
        }
        for (i, rec) in recs.iter().enumerate() {
            if rec.row > end_row {
                break;
            }
            let mut again = false;
            if rec.gap_before || after_subtotal {
                if rec.gap_before {
                    pending = kept.a.tag;
                    saved = kept;
                    saved_len = rows.len();
                }
                if self.starts_heading_again(&view.frame, &recs[i..]) {
                    pending = 3;
                    again = true;
                    open = false;
                    after_subtotal = false;
                } else if after_subtotal && rec.sums.is_empty() {
                    if let Some(r) = self.label_target(view, i) {
                        let covered = view.next_with_sums[i]
                            .is_some_and(|j| recs[j].sums.iter().any(|s| lower <= s.first && s.first <= r && r <= s.last));
                        after_subtotal = !covered;
                        open &= after_subtotal;
                    }
                }
            }
            let next_gap = recs.get(i + 1).map_or(true, |n| n.gap_before);
            let a_sum = kept.a.tag != 2 && self.group_summed(rec, lower, kept.a, group_of(recs, kept.a), next_gap);
            let sums_later = |row: usize, test: &dyn Fn(&Sum) -> bool| {
                view.next_with_sums[i].is_some_and(|j| recs[j].sums.iter().any(|s| test(s) && s.first <= row && row <= s.last))
            };
            let act = if rec.cells.is_empty() {
                Act::Blank
            } else if seen && open {
                let by_sums = !rec.sums.is_empty();
                let evidence = by_sums
                    || rec.above.iter().any(|a| subtotal_rows.contains(&a.0))
                    || rec.ranges.iter().any(|r| {
                        subtotal_rows.contains(&r.top)
                            || subtotal_rows.contains(&r.bottom)
                            || (r.top <= first_rec_row && last_rec_row <= r.bottom)
                    })
                    || view.read_above.contains(&rec.row)
                    || sums_later(rec.row, &|s| subtotal_rows.contains(&s.first));
                // A row tied to the subtotals above is one more of them; one under the first total of the records
                // keeps it the first.
                if evidence {
                    Act::Subtotal(kept.fresh_subtotal || (by_sums && a_sum))
                } else {
                    open = true;
                    if rec.cells.len() == 1 {
                        seen = true;
                        Act::Label
                    } else if pending != 3 {
                        if saved_len <= rows.len() {
                            rows.truncate(saved_len);
                        }
                        kept = saved;
                        kept.a.tag = pending;
                        break;
                    } else if self.is_heading_row(rec.row, c0, c1, None, Skip::LabelLike) {
                        break;
                    } else {
                        let n = recs.len().min(rows.len());
                        let records = rows[..n].iter().filter(|r| r.1 == Role::Record).count();
                        let unread = rows[..n]
                            .iter()
                            .zip(recs)
                            .any(|(r, x)| r.1 == Role::Record && !x.below.contains(&rec.row));
                        if records < 2 || unread {
                            return Err(Reason::RowUnderTheTotal);
                        }
                        pending = 3;
                        seen = true;
                        Act::Label
                    }
                }
            } else {
                let eff_b = if kept.b.tag == 3 { kept.a.tag } else { kept.b.tag };
                let lone = self.is_lone_label(&view.frame, rec);
                if a_sum {
                    Act::Subtotal(!kept.seen_subtotal)
                } else if kept.b.tag != 2
                    && kept.b.tag != 3
                    && self.group_summed(rec, kept.b_lower, kept.b, group_of(recs, kept.b), next_gap)
                {
                    Act::Subtotal(false)
                } else if eff_b != 2
                    && rec.above.iter().any(|a| a.1 && subtotal_rows.contains(&a.0) && !sums_later(a.0, &|_| true))
                {
                    Act::Subtotal(false)
                } else if again {
                    Act::Section
                } else if rec.cells.len() == 1 && {
                    let (lo, hi) = self.merge_columns(rec.row, rec.cells[0].column);
                    c0 < c1 && lo == c0 && hi == c1
                } {
                    Act::Section
                } else if lone && {
                    let cell = rec.cells[0];
                    let next = recs.get(i + 1).filter(|n| !n.gap_before && !n.cells.is_empty()).map(|n| n.cells[0]);
                    [0, 1].into_iter().any(|k| {
                        self.styled(k, cell.row, cell.column)
                            && next.is_some_and(|c| !self.styled(k, c.row, c.column))
                            && !view.styles[k]
                    })
                } {
                    Act::Section
                } else if lone
                    && kept.a.tag == 2
                    && self.label_target(view, i).is_some_and(|r| {
                        view.next_with_sums[i]
                            .is_some_and(|j| recs[j].sums.iter().any(|s| rec.row < s.first && s.first <= r && r <= s.last))
                    })
                {
                    Act::Section
                } else {
                    Act::Record
                }
            };
            let role = match act {
                Act::Blank => Role::Blank,
                Act::Label => Role::SectionLabel,
                Act::Subtotal(fresh) => {
                    after_subtotal = true;
                    kept.seen_subtotal = true;
                    kept.b.tag = 3;
                    kept.a.tag = 2;
                    kept.fresh_subtotal = fresh;
                    subtotal_rows.insert(rec.row);
                    lower = rec.row.saturating_add(1);
                    open = true;
                    Role::Subtotal
                }
                Act::Section => {
                    kept.b.tag = 2;
                    kept.b_lower = rec.row;
                    Role::SectionLabel
                }
                Act::Record => {
                    for cell in rec.cells {
                        let (lo, hi) = self.merge_columns(rec.row, cell.column);
                        if lo < hi {
                            let area = Rect { top: hl, left: lo, bottom: hl, right: hi };
                            let matches = self.merges_meeting(area).find(|m| m.left == lo).is_some_and(|m| m.right == hi);
                            if !matches {
                                first_merged = first_merged.or(Some(rec.row));
                            }
                        }
                    }
                    let step = |g: Group| Group {
                        tag: if pending == 3 {
                            if g.tag == 2 {
                                0
                            } else {
                                g.tag
                            }
                        } else {
                            1
                        },
                        row: if pending == 3 { g.row } else { rec.row },
                        start: if g.tag == 2 { i } else { g.start },
                        end: i,
                    };
                    kept.a = step(kept.a);
                    if kept.b.tag != 3 {
                        kept.b = step(kept.b);
                    }
                    kept.fresh_subtotal = false;
                    last_rec_row = rec.row;
                    if !seen {
                        first_rec_row = rec.row;
                    }
                    pending = 3;
                    seen = true;
                    Role::Record
                }
            };
            rows.push((rec.row, role));
        }
        Ok(Roles { first_merged, kept, rows })
    }

    /// The plain body under a header down to a row: rows holding records, gaps blank (f2167).
    pub(super) fn plain_body(&self, frame: &Frame, last: usize) -> Body {
        let recs = self.records(frame, frame.header.1.saturating_add(1), last);
        let rows: Vec<(usize, Role)> = recs.iter().filter(|r| !r.cells.is_empty()).map(|r| (r.row, Role::Record)).collect();
        Body { footer: None, runs: runs_of(frame.header.1.saturating_add(1), last, &rows), subtotals: false }
    }

    /// The body of a declared table above its footer, its rows given their parts; none when they can't all be.
    pub(super) fn footer_body(&self, frame: &Frame, end: usize, to: usize) -> Option<Body> {
        let start = frame.header.1.saturating_add(1);
        let recs = self.records(frame, start, to);
        let count = recs.partition_point(|r| r.row <= end);
        let view = self.view(*frame, &recs);
        let roles = self.roles(&view, end).ok()?;
        (roles.rows.len() == count).then(|| Body { footer: None, runs: runs_of(start, end, &roles.rows), subtotals: false })
    }

    /// The row a table's body can't reach past: the sheet's last, or above the first of other tables under its
    /// header across its columns (f5790).
    pub(super) fn limit(&self, frame: &Frame, rects: &[Rect]) -> usize {
        let hl = frame.header.1;
        let (c0, c1) = frame.columns;
        let last_row = self.grid.row_count().saturating_sub(1);
        let mut limit = last_row;
        let (lo, hi) = (last_row.min(hl), last_row.max(hl));
        let (cl, ch) = (c0.min(c1), c0.max(c1));
        for r in rects {
            if !(r.top > hi || lo > r.bottom || r.left > ch || cl > r.right || r.top <= hl) {
                limit = limit.min(r.top - 1);
            }
        }
        limit
    }

    /// The body of a recognized table from a block's last row on: through the blocks below the heading does not come
    /// again in, cut at the first one nothing ties to the rows above, its rows given their parts, down to its footer
    /// (f235); or why it can't be a table's. A bold last row is a footer only when the header is not declared.
    pub(super) fn recognized_body(&self, frame: &Frame, from: usize, limit: usize, declared: bool) -> Result<Body, Reason> {
        let (hf, hl) = frame.header;
        let (c0, c1) = frame.columns;
        let mut end = from;
        let mut again: Option<usize> = None;
        let mut last_ok = from;
        while let Some((heading, first, last)) = self.block_below(frame, end, limit) {
            end = last;
            if let Some(x) = heading {
                again = Some(x);
                let _ = first;
                break;
            }
            last_ok = end;
        }
        let mut recs = self.records(frame, hl.saturating_add(1), end);
        let over_headings = |s: &Sum| {
            (hf > 0 && (s.first..hf).any(|r| !self.cells_in(r, s.column, s.column).is_empty()))
                || again.is_some_and(|x| s.first <= last_ok && x <= s.last)
        };
        if recs.iter().any(|r| r.sums.iter().any(over_headings)) {
            return Err(Reason::SumRunsOverHeadings);
        }
        recs.truncate(recs.partition_point(|r| r.row <= last_ok));

        // The blocks below: kept while a sum, a heading again or a reference ties them to the rows above.
        let (mut covered, mut heading_end, mut prev_end) = (from, from, from);
        let mut reading: BTreeSet<usize> = BTreeSet::new();
        let mut a = 0;
        while a < recs.len() {
            let mut b = a + 1;
            while b < recs.len() && !recs[b].gap_before {
                b += 1;
            }
            let chunk = &recs[a..b];
            let chunk_end = chunk[chunk.len() - 1].row;
            if prev_end <= covered && self.starts_heading_again(frame, chunk) {
                covered = covered.max(chunk_end);
                heading_end = heading_end.max(chunk_end);
            } else if chunk.iter().any(|r| r.sums.iter().any(|s| s.first <= covered && hl.saturating_add(1) <= s.last))
                || chunk[0].above.iter().any(|x| x.1 && x.0 <= covered && reading.contains(&x.0))
            {
                covered = covered.max(chunk_end);
            }
            prev_end = chunk_end;
            for r in chunk {
                if r.above.iter().any(|x| reading.contains(&x.0)) || !r.sums.is_empty() {
                    reading.insert(r.row);
                }
            }
            a = b;
        }
        recs.truncate(recs.partition_point(|r| r.row <= covered));

        let view = self.view(*frame, &recs);
        let Roles { first_merged, kept, mut rows } = self.roles(&view, usize::MAX)?;
        if !kept.seen_subtotal {
            rows.retain(|r| r.0 <= heading_end);
            if let Some(r) = recs.iter().rev().find(|r| r.row <= heading_end && !self.is_lone_label(frame, r)) {
                if !r.sums.is_empty() {
                    return Err(Reason::SumOfSomeRecords);
                }
            }
        } else if kept.a.tag != 2 && kept.b.tag == 3 {
            return Err(Reason::RowUnderTheTotal);
        }
        if let (Some(last), Some(m)) = (rows.last(), first_merged) {
            if m <= last.0 {
                return Err(Reason::MergedCellsAmongRecords);
            }
        }
        // Labels at the end are not the table's.
        while let Some(k) = rows.iter().rposition(|r| r.1 != Role::Blank) {
            if rows[k].1 != Role::SectionLabel {
                break;
            }
            rows.truncate(k);
        }
        let last_row = rows.last().map_or(hl, |r| r.0);

        // The last record (but a total, as the footer): the footer is the first row under it not blank.
        let records_before = |row: usize| rows.iter().filter(|r| r.1 == Role::Record && r.0 < row).count() >= 2;
        let refers_to_all = |rec: &Rec| {
            for r in rows.iter().filter(|r| r.1 == Role::Record) {
                if r.0 >= rec.row {
                    return true;
                }
                if !rec.above.contains(&(r.0, true)) {
                    return false;
                }
            }
            true
        };
        let no_bold_record = |rec: &Rec| {
            for r in rows.iter().filter(|r| r.1 == Role::Record) {
                if r.0 >= rec.row {
                    return true;
                }
                let cells = self.cells_in(r.0, c0, c1);
                if cells.iter().all(|c| self.styled(0, c.row, c.column)) {
                    return false;
                }
            }
            true
        };
        let mut found = None;
        for i in (0..recs.len().min(rows.len())).rev() {
            let rec = &recs[i];
            let footer_like = !kept.seen_subtotal
                && rec.row == last_row
                && records_before(last_row)
                && (refers_to_all(rec)
                    || (!declared
                        && rec.cells.len() >= 2
                        && self.cells_in(last_row, c0, c1).iter().all(|c| self.styled(0, c.row, c.column))
                        && no_bold_record(rec)));
            if !footer_like && (!kept.fresh_subtotal || rec.sums.is_empty()) && rows[i].1 == Role::Record {
                found = Some(i);
                break;
            }
        }
        let Some(mut idx) = found else { return Ok(Body { footer: None, runs: Vec::new(), subtotals: false }) };
        if !kept.fresh_subtotal {
            if let Some(j) = rows[idx..].iter().position(|r| r.1 == Role::Subtotal) {
                idx += j;
            }
        }
        let footer = rows[idx + 1..].iter().find(|r| r.1 != Role::Blank).map(|r| r.0);
        let body_end = footer.map_or(last_row, |f| f.saturating_sub(1));
        let runs = runs_of(hl.saturating_add(1), body_end, &rows[..=idx]);
        Ok(Body { footer: footer.map(|f| (f, last_row)), runs, subtotals: kept.seen_subtotal })
    }
}
