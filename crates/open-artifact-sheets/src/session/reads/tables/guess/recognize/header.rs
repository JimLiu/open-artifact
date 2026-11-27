//! A block's header: from its top row down through rows of group headings, to the row of headings
//! over its records, pushed down by merged ranges hanging from it; or why the block has none.

use std::collections::{BTreeMap, BTreeSet};

use super::sheet::{Cell, Rect, Sheet, Skip, Value};
use super::Reason;

/// The most rows from a block's top that can hold group headings.
const MOST_GROUP_ROWS: usize = 19;

/// A block's header rows, and each column's heading: the lowest header cell over it.
#[derive(Clone, Debug)]
pub(super) struct Header<'g> {
    pub first: usize,
    pub last: usize,
    pub headings: BTreeMap<usize, Cell<'g>>,
}

impl<'g> Sheet<'g> {
    /// The header of a block, or why it has none.
    pub(super) fn header(&self, block: &Rect) -> Result<Header<'g>, Reason> {
        self.header_or_rows(block).map_err(|(reason, _)| reason)
    }

    /// The header rows an assumed table takes: its header's, or, where the block's columns miss a heading or name
    /// two alike, the rows it was found over, pushed down by merged ranges as a header's are; else its top row.
    pub(super) fn assumed_header_rows(&self, block: &Rect) -> (usize, usize) {
        match self.header_or_rows(block) {
            Ok(h) => (h.first, h.last),
            Err((_, Some(rows))) => rows,
            Err((_, None)) => (block.top, block.top),
        }
    }

    /// The header of a block, or why it has none with the rows it was found over when it went that far.
    fn header_or_rows(&self, block: &Rect) -> Result<Header<'g>, (Reason, Option<(usize, usize)>)> {
        let Rect { top, left, bottom, right } = *block;
        let mut seen: BTreeSet<usize> = BTreeSet::new();
        let mut names: BTreeMap<String, u32> = BTreeMap::new();
        let mut columns: BTreeMap<usize, Vec<(Cell<'g>, u32)>> = BTreeMap::new();
        let last_group = top.saturating_add(MOST_GROUP_ROWS).min(bottom);
        let mut row = top;
        let last;
        loop {
            let is_group = row < last_group && self.is_label_over_block(row, left, right, &seen);
            for cell in self.cells_in(row, left, right) {
                let (s, e) = self.merge_columns(cell.row, cell.column);
                if s == e {
                    seen.insert(s);
                }
                let key = match cell.value {
                    Value::Text(t) => t.chars().flat_map(char::to_lowercase).collect(),
                    Value::Number(n) => n.to_string(),
                    Value::Boolean | Value::Error => String::new(),
                };
                let len = names.len() as u32;
                let id = *names.entry(key).or_insert(len);
                for c in s..=right.min(e) {
                    columns.entry(c).or_default().push((*cell, id));
                }
            }
            if is_group {
                row = row.saturating_add(1);
                continue;
            }
            let above = (top < row).then(|| row - 1);
            if !self.is_heading_row(row, left, right, above, Skip::Texts) {
                return Err((Reason::NoHeadings, None));
            }
            let area = Rect { top: row.min(top), left: left.min(right), bottom: row.max(top), right: left.max(right) };
            let mut end = row;
            for m in self.merges_meeting(area) {
                end = end.max(m.bottom);
            }
            last = end;
            break;
        }
        if last > bottom {
            return Err((Reason::NoHeadings, None));
        }
        for (&r, cells) in self.cells.range(row.saturating_add(1)..) {
            if r > last {
                break;
            }
            if cells.iter().any(|c| left <= c.column && c.column <= right) {
                return Err((Reason::NoHeadings, None));
            }
        }
        // A date or time under a heading other than a text means no headings, before a column without one does.
        let first_body = last.saturating_add(1);
        let mut under: Vec<&Cell> = Vec::new();
        for v in columns.values() {
            let Some((heading, _)) = v.last() else { continue };
            if heading.is_text() {
                continue;
            }
            under.extend(self.cells_in(first_body, heading.column, heading.column));
        }
        if under.iter().any(|c| self.is_dated(c)) || self.is_time_run(&under) {
            return Err((Reason::NoHeadings, None));
        }
        if (left.saturating_add(1)..=right).any(|c| !columns.contains_key(&c)) {
            return Err((Reason::ColumnWithoutAHeading, Some((top, last))));
        }
        let name_paths: BTreeSet<Vec<u32>> = columns.values().map(|v| v.iter().map(|&(_, id)| id).collect()).collect();
        let cell_paths: BTreeSet<Vec<(usize, usize)>> =
            columns.values().map(|v| v.iter().map(|(c, _)| (c.row, c.column)).collect()).collect();
        if name_paths.len() < cell_paths.len() {
            return Err((Reason::TwoColumnsOfOneName, Some((top, last))));
        }
        let headings = columns.into_iter().filter_map(|(c, v)| Some((c, v.last()?.0))).collect();
        Ok(Header { first: top, last, headings })
    }
}
