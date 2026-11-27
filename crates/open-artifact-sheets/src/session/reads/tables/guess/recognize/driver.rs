//! The recognizer's run over a sheet: the cell tables it declares first, each read down to its body's
//! end; then the blocks of its content top down, each recognized as a table when it proves one (a block meeting a
//! table already found cut around it, rows above its first wide row cut off); then the blocks left, each assumed a
//! table with the reason it is not recognized.

use std::collections::BTreeMap;

use super::blocks::{blocks, Block};
use super::body::{Body, Frame};
use super::check::Refusal;
use super::sheet::{Cell, Rect, Sheet, Skip, Value};
use super::super::cell_tables::{declared_places, holds_input};
use super::{Basis, Found, Reason, Role};
use crate::workbook::Sheet as WorkbookSheet;

/// The most columns the assumed tables of a sheet take together.
const MOST_ASSUMED_COLUMNS: usize = 10_000;
/// The most columns of a table counted against that.
const MOST_COLUMNS: usize = 500;

/// Blocks by their top left, as a queue taken from the top left.
type Queue = BTreeMap<(usize, usize), Block>;

fn queue(found: Vec<Block>) -> Queue {
    let mut entries: Vec<((usize, usize), Block)> = found.into_iter().map(|b| ((b.area.top, b.area.left), b)).collect();
    entries.sort_by_key(|e| e.0);
    // Of blocks at one top left, the last one is kept.
    entries.into_iter().collect()
}

fn requeue(q: &mut Queue, found: Vec<Block>) {
    for b in found {
        q.insert((b.area.top, b.area.left), b);
    }
}

/// A block's pieces cut into the parts of the block around a range: above it, below it, and left and right of it
/// across its rows; a part meeting the range still cut again strip by strip.
fn around(block: &Block, rect: &Rect) -> Vec<Block> {
    let b = block.area;
    let (left, right) = (b.left.min(b.right), b.left.max(b.right));
    let (top, bottom) = (rect.top.min(rect.bottom), rect.top.max(rect.bottom));
    let strips: Vec<Rect> = [
        (b.top < rect.top).then(|| Rect { top: b.top, left, bottom: rect.top - 1, right }),
        (b.bottom > rect.bottom).then(|| Rect { top: rect.bottom + 1, left, bottom: b.bottom, right }),
        (b.left < rect.left).then(|| Rect { top, left: b.left, bottom, right: rect.left - 1 }),
        (b.right > rect.right).then(|| Rect { top, left: rect.right + 1, bottom, right: b.right }),
    ]
    .into_iter()
    .flatten()
    .collect();
    let clipped = |pieces: &[Rect]| -> Vec<Vec<Rect>> { strips.iter().map(|s| clip(pieces, s)).collect() };
    let mut out = Vec::new();
    for found in blocks(clipped(&block.pieces).concat()) {
        if found.area.meets(rect) {
            for part in clipped(&found.pieces) {
                out.extend(blocks(part));
            }
        } else {
            out.push(found);
        }
    }
    out
}

/// The parts of pieces within a range.
fn clip(pieces: &[Rect], area: &Rect) -> Vec<Rect> {
    pieces
        .iter()
        .filter(|p| p.meets(area))
        .map(|p| Rect {
            top: p.top.max(area.top),
            left: p.left.max(area.left),
            bottom: p.bottom.min(area.bottom),
            right: p.right.min(area.right),
        })
        .collect()
}

/// A block from a row down, the rows above cut off.
fn from_row(block: &Block, row: usize) -> Vec<Block> {
    let b = block.area;
    let area = Rect { top: b.bottom.min(row), left: b.left.min(b.right), bottom: b.bottom.max(row), right: b.left.max(b.right) };
    blocks(clip(&block.pieces, &area))
}

impl Sheet<'_> {
    /// The tables of the sheet, top down and then left to right.
    pub(super) fn tables(&self, sheet: &WorkbookSheet) -> Vec<Found> {
        let mut tables = self.declared(sheet);
        let taken: Vec<Rect> = tables.iter().map(Found::area).collect();

        // Pass 1: the blocks recognized as tables.
        let mut claimed = taken.clone();
        let mut refused: BTreeMap<Rect, Refusal> = BTreeMap::new();
        let mut q = queue(blocks(self.pieces()));
        while let Some((_, block)) = q.pop_first() {
            claimed.retain(|r| r.bottom >= block.area.top);
            let parts = if let Some(r) = claimed.iter().find(|r| r.meets(&block.area)) {
                around(&block, r)
            } else {
                match self.first_wide_row(&block.area) {
                    None => Vec::new(),
                    Some(r) if block.area.top < r => from_row(&block, r),
                    Some(_) => match self.recognize(&block, &taken) {
                        Ok(t) => {
                            let area = t.area();
                            tables.push(t);
                            claimed.push(area);
                            around(&block, &area)
                        }
                        Err(refusal) => {
                            refused.insert(block.area, refusal);
                            Vec::new()
                        }
                    },
                }
            };
            requeue(&mut q, parts);
        }
        tables.sort_by_key(|t| {
            let r = t.area();
            (r.top, r.left)
        });

        // Pass 2: the blocks left, assumed tables.
        let rects: Vec<Rect> = tables.iter().map(Found::area).collect();
        let mut active: Vec<Rect> = Vec::new();
        let mut next = 0;
        let mut room = MOST_ASSUMED_COLUMNS;
        let mut assumed = Vec::new();
        let mut q = queue(blocks(self.pieces()));
        while let Some((_, block)) = q.pop_first() {
            let b = block.area;
            let n = rects[next..].partition_point(|r| r.top < b.top);
            active.extend_from_slice(&rects[next..next + n]);
            next += n;
            active.retain(|r| r.bottom >= b.top);
            let hit = active
                .iter()
                .find(|r| r.meets(&b))
                .or_else(|| rects[next..].iter().take_while(|r| r.top <= b.bottom).find(|r| r.meets(&b)))
                .copied();
            let wide = self.first_wide_row(&b);
            if let Some(r) = wide {
                if b.top < r
                    && self.is_heading_row(r, b.left, b.right, None, Skip::LabelLike)
                    && (self.cells_in(r, b.left, b.right).len() > 2 || self.cells_in(r.saturating_add(1), b.left, b.right).len() >= 2)
                {
                    requeue(&mut q, from_row(&block, r));
                    continue;
                }
            }
            if let Some(t) = hit {
                requeue(&mut q, around(&block, &t));
                continue;
            }
            // A block with no cell of its own, only merged ranges cut off from the cells showing them, is a table
            // only when one of them is cut short of its bottom row too.
            let own = self.cells.range(b.top..=b.bottom).any(|(_, cells)| cells.iter().any(|c| b.left <= c.column && c.column <= b.right));
            if !own && !block.pieces.iter().any(|p| self.merges_meeting(*p).any(|m| m.holds(p.top, p.left) && m.holds(p.bottom, p.right) && p.bottom < m.bottom)) {
                continue;
            }
            let (hf, hl) = self.assumed_header_rows(&b);
            if hl >= b.bottom {
                continue;
            }
            let refusal = match wide {
                None => {
                    let reason = if self.is_heading_row(b.top, b.left, b.right, None, Skip::LabelLike) {
                        Reason::OneColumn
                    } else {
                        Reason::NoHeadings
                    };
                    Refusal { reason, header: None }
                }
                Some(_) => match refused.get(&b) {
                    Some(&refusal) => refusal,
                    None => {
                        let below = b.bottom.saturating_add(1);
                        let sentinel = Rect { top: below, left: b.left.min(b.right), bottom: below, right: b.left.max(b.right) };
                        self.recognize(&block, &[sentinel]).err().unwrap_or(Refusal { reason: Reason::NoHeadings, header: None })
                    }
                },
            };
            let reason = refusal.reason;
            let (hf, hl) = refusal.header.unwrap_or((hf, hl));
            let frame = Frame { header: (hf, hl), columns: (b.left, b.right) };
            let body = self.plain_body(&frame, b.bottom);
            let n = b.right.min(b.left.saturating_add(MOST_COLUMNS - 1)).wrapping_sub(b.left).saturating_add(1);
            if room < n {
                break;
            }
            room -= n;
            assumed.push(Found { header: (hf, hl), columns: (b.left, b.right), body: body.runs, footer: None, basis: Basis::Assumed(reason), proved_over: None });
        }
        tables.append(&mut assumed);
        tables.sort_by_key(|t| {
            let r = t.area();
            (r.top, r.left)
        });
        tables
    }

    /// The cell tables the sheet declares, each read down to its body's end.
    fn declared(&self, sheet: &WorkbookSheet) -> Vec<Found> {
        let mut declared = declared_places(self.grid.workbook(), sheet);
        declared.retain(|(_, header, columns, _)| {
            holds_input(sheet, *header, *columns) || self.first_content_row(header.0, header.1, columns.0, columns.1).is_some()
        });
        let boxes = |header: (usize, usize), columns: (usize, usize), footer: Option<(usize, usize)>| {
            let r0 = footer.map_or(header.1, |f| f.1);
            Rect { top: header.0.min(r0), left: columns.0.min(columns.1), bottom: header.0.max(r0), right: columns.0.max(columns.1) }
        };
        let mut kept: Vec<Rect> = Vec::new();
        declared.retain(|(_, header, columns, footer)| {
            let area = boxes(*header, *columns, *footer);
            let overlaps = kept.iter().any(|k| k.meets(&area));
            if !overlaps {
                kept.push(area);
            }
            !overlaps
        });
        let mut rects: Vec<Rect> = declared.iter().map(|(_, h, c, f)| boxes(*h, *c, *f)).collect();
        let mut tables = Vec::new();
        for (i, (id, header, columns, footer)) in declared.into_iter().enumerate() {
            let table = self.read_declaration(header, columns, footer, &rects, Basis::Declared(id));
            rects[i] = table.area();
            tables.push(table);
        }
        tables
    }

    pub(super) fn read_declaration(
        &self, header: (usize, usize), columns: (usize, usize),
        footer: Option<(usize, usize)>, neighbors: &[Rect], basis: Basis,
    ) -> Found {
        self.read_declared(header, columns, footer, neighbors, neighbors, basis, false)
    }

    /// Read a declaration, its widening bounded by the tables `beside` and its body by its `neighbors`.
    pub(super) fn read_declaration_beside(
        &self, header: (usize, usize), columns: (usize, usize),
        footer: Option<(usize, usize)>, neighbors: &[Rect], beside: &[Rect], basis: Basis,
    ) -> Found {
        self.read_declared(header, columns, footer, neighbors, beside, basis, false)
    }

    /// An assumed table's header and columns read as a declared table's at a cell: its body is not recognized past
    /// the rows its open body reaches when that goes on to no block below.
    pub(super) fn read_assumed_at_cell(&self, header: (usize, usize), columns: (usize, usize), neighbors: &[Rect]) -> Found {
        self.read_declared(header, columns, None, neighbors, neighbors, Basis::Recognized, true)
    }

    fn read_declared(
        &self, header: (usize, usize), (left, mut right): (usize, usize),
        footer: Option<(usize, usize)>, neighbors: &[Rect], beside: &[Rect], basis: Basis, assumed: bool,
    ) -> Found {
        let (first_header, last_header) = header;
        let bottom = footer.map_or(last_header, |(_, last)| last);
        let mut column = right.saturating_add(1);
        while self.has_content(last_header, column, column)
            && !beside.iter().any(|r| r.top <= bottom && first_header <= r.bottom && r.left <= column && column <= r.right)
        {
            right = column;
            column += 1;
        }
        let frame = Frame { header, columns: (left, right) };
        let body = match footer {
            Some((first, last)) => {
                let end = first.saturating_sub(1);
                let mut body = self.footer_body(&frame, end, last).unwrap_or_else(|| self.plain_body(&frame, end));
                body.footer = Some((first, last));
                body
            }
            None => self.open_body(&frame, neighbors, assumed),
        };
        Found { header, columns: frame.columns, body: body.runs, footer: body.footer, basis, proved_over: None }
    }

    /// The row of headings two rows above a table read with no header, over a blank row: cells side by side over
    /// the table's columns, two or more, up to its last and from its first or the one after, that read as headings
    /// (texts, and runs of years or dates), in no table of the sheet; a single column of cells above them does not
    /// make them a table's.
    pub(super) fn headings_above(&self, top: usize, (c0, c1): (usize, usize), tables: &[Rect]) -> Option<usize> {
        let row = top.checked_sub(2)?;
        if !self.cells_in(row + 1, c0, c1).is_empty() {
            return None;
        }
        let cells = self.cells_in(row, c0, c1);
        let side_by_side = cells.windows(2).all(|w| w[0].column + 1 == w[1].column);
        let from_first = cells.first().is_some_and(|c| c.column <= c0.saturating_add(1));
        if cells.len() < 2 || !side_by_side || !from_first || cells.last().map(|c| c.column) != Some(c1) || !self.is_heading_row(row, c0, c1, None, Skip::Texts) {
            return None;
        }
        let headings = Rect { top: row, left: cells[0].column, bottom: row, right: c1 };
        (!tables.iter().any(|t| t.meets(&headings))).then_some(row)
    }

    /// Whether the first row of a block below blank rows goes on from the last row above them: the first cell
    /// each shows is in the same column, and both or neither is a text (a number, a date, a
    /// boolean and an error alike), and the row below shows more than half as many cells. A row
    /// above showing only what a merged range carries down shows no first cell: nothing goes on from it.
    pub(super) fn goes_on(&self, above: usize, below: usize, c0: usize, c1: usize) -> bool {
        let (over, under) = (self.cells_in(above, c0, c1), self.cells_in(below, c0, c1));
        match (over.first(), under.first()) {
            (Some(a), Some(b)) => a.column == b.column && a.is_text() == b.is_text() && 2 * under.len() > over.len(),
            (None, Some(_)) => false,
            _ => true,
        }
    }

    /// The body of a declared table with no footer: down through the blocks under it the heading does not come
    /// again in, each going on from the row above the blank ones before it, then rows of unticked checkboxes
    /// only.
    fn open_body(&self, frame: &Frame, rects: &[Rect], assumed: bool) -> Body {
        let hl = frame.header.1;
        let (c0, c1) = frame.columns;
        let limit = self.limit(frame, rects);
        // The rows right under the header run on while they show something in its columns or the one beside
        // each side, then end at the last that shows something in its columns.
        let wide = self.last_filled_row(hl.saturating_add(1), limit, c0.saturating_sub(1), c1.saturating_add(1));
        let mut end = wide.and_then(|w| (hl + 1..=w).rev().find(|&r| self.has_content(r, c0, c1))).unwrap_or(hl);
        // When another table beside them carries them over blank rows, something beside, not in another table, under
        // the first row of the last block they run on to ends them at the rows right under the header instead.
        let sides = [c0.checked_sub(1), c1.checked_add(1)];
        let under = (hl + 1..=limit).take_while(|&r| self.has_content(r, c0, c1)).last().unwrap_or(hl);
        if end > under {
            let start = (under + 1..=end).rev().take_while(|&r| self.has_content(r, c0, c1)).last().unwrap_or(end);
            let theirs = |r: usize, s: usize| rects.iter().any(|x| x.top <= r && r <= x.bottom && x.left <= s && s <= x.right);
            let carried = (under + 1..start).all(|r| sides.iter().flatten().any(|&s| self.has_content(r, s, s) && theirs(r, s)));
            let beside = (start + 1..=wide.unwrap_or(end))
                .any(|r| sides.iter().flatten().any(|&s| self.has_content(r, s, s) && !theirs(r, s)));
            if carried && beside {
                end = under;
            }
        }
        // Nor past blank rows into a block the heading comes again in, though what is beside runs on over them.
        let mut kept = under;
        while kept < end {
            let Some(first) = self.first_content_row(kept + 1, end, c0, c1) else { break };
            let last = self.last_filled_row(first, end, c0, c1).unwrap_or(first);
            let again = self.heading_again(first, last, c0, c1);
            if first > kept + 1 && again.is_some_and(|x| !self.past_heading_again(frame, kept, x, first, last)) {
                end = kept;
                break;
            }
            kept = last;
        }
        let before = end;
        // Read at a cell, an assumed table whose rows end in a footer (a bold last row) does not go on to the blocks
        // below them.
        let footed = assumed && self.recognized_body(frame, end, end, false).is_ok_and(|body| body.footer.is_some());
        while let Some((again, first, last)) = self.block_below(frame, end, limit).filter(|_| !footed) {
            // Something beside at a corner of the block does not keep it from going on, and a first row holding an
            // unticked checkbox in the table's columns goes on from any row, the heading again in it or not.
            if !self.unticked_in(first, c0, c1).is_empty() {
                end = last;
                continue;
            }
            // A block the heading comes again in goes on only from records.
            if again.is_some_and(|x| !(end > hl && self.past_heading_again(frame, end, x, first, last))) {
                break;
            }
            // A lone boolean goes on from any row.
            let cells = self.cells_in(first, c0, c1);
            let ok = match cells.len() {
                0 => false,
                1 => matches!(cells[0].value, Value::Boolean),
                _ => end <= hl || self.goes_on(end, first, c0, c1),
            };
            if !ok {
                break;
            }
            end = last;
        }
        // An assumed table read at a cell whose rows go on to no block below does not take the blocks under them
        // that start the heading again either.
        let reach = if assumed && end == before { end } else { limit };
        // A bold last row is a footer, as a recognized table's: its header is not declared.
        let mut body = self.recognized_body(frame, end, reach, !assumed).unwrap_or_else(|_| self.plain_body(frame, end));
        let from = match body.footer {
            Some((_, last)) => last,
            None => body.runs.last().map_or(hl, |r| r.last),
        };
        let s = from.saturating_add(1);
        if s <= limit {
            let (mut any, mut last_ok) = (false, s);
            let mut r = s;
            loop {
                if self.unticked_in(r, c0, c1).is_empty() {
                    break;
                }
                let filled = self.has_content(r, c0, c1);
                if r == limit {
                    if !filled {
                        last_ok = r;
                        any = true;
                    }
                    break;
                }
                if filled {
                    break;
                }
                any = true;
                last_ok = r;
                r += 1;
            }
            if any && body.footer.is_none() {
                match body.runs.last_mut() {
                    Some(l) if l.role == Role::Blank => l.last = last_ok,
                    _ => body.runs.push(super::Run { first: s, last: last_ok, role: Role::Blank }),
                }
            }
        }
        body
    }

    /// The block under a table's rows across its columns, after one blank row or more, when the columns beside it
    /// show nothing along it: the row the heading comes again on in it if it does, its first row and its last; none
    /// when there is none.
    pub(super) fn block_below(&self, frame: &Frame, from: usize, limit: usize) -> Option<(Option<usize>, usize, usize)> {
        let (c0, c1) = frame.columns;
        let start = from.saturating_add(1);
        let first = self.first_content_row(start, limit, c0, c1)?;
        if start >= first {
            return None;
        }
        let last = self.last_filled_row(first, limit, c0, c1)?;
        let sides = [c0.checked_sub(1), (c1 != usize::MAX).then(|| c1 + 1)];
        for r in first..=last {
            if sides.iter().flatten().any(|&s| self.has_content(r, s, s)) {
                return None;
            }
        }
        Some((self.heading_again(first, last, c0, c1), first, last))
    }

    /// Whether a body goes on from a row past a block the heading comes again in on another: when the row shows
    /// texts alone across the table's columns, over the block's or not, the block's records under its headings are
    /// not typed, and its headings are not the table's own, case aside.
    fn past_heading_again(&self, frame: &Frame, row: usize, again: usize, first: usize, last: usize) -> bool {
        let (c0, c1) = frame.columns;
        if !self.texts_over(row, c0, c1) {
            return false;
        }
        let lower = |c: &Cell| match c.value {
            Value::Text(t) => Some(t.chars().flat_map(char::to_lowercase).collect::<String>()),
            _ => None,
        };
        let texts = |r: usize| self.cells_in(r, c0, c1).iter().map(|c| (c.column, lower(c))).collect::<Vec<_>>();
        if texts(again) == texts(frame.header.1) {
            return false;
        }
        let (left, right) = self.shown_columns(first, last, c0, c1);
        let (top, hl) = self.assumed_header_rows(&Rect { top: again, left, bottom: last, right });
        let rows: Vec<usize> = (hl.saturating_add(1)..=last).filter(|&r| self.has_content(r, left, right)).collect();
        let kinds = self.kinds_of(&rows, left, right);
        let heading = |col: usize| (top..=hl).rev().find_map(|r| self.cells_in(r, col, col).first().map(|c| (c.row, c.column)));
        !self.typed(&kinds, heading)
    }

    /// The first and last columns some row of a block shows something in.
    fn shown_columns(&self, first: usize, last: usize, c0: usize, c1: usize) -> (usize, usize) {
        let shown = (first..=last).flat_map(|r| self.cells_in(r, c0, c1)).map(|c| c.column);
        shown.fold((usize::MAX, 0), |(l, r), c| (l.min(c), r.max(c)))
    }

    /// Whether a row shows texts alone across some columns, over a block below it or beside it.
    fn texts_over(&self, row: usize, c0: usize, c1: usize) -> bool {
        self.cells_in(row, c0, c1).iter().all(|c| c.is_text())
    }

    /// The row the heading comes again on in a block of rows across some columns: where a header is found over the
    /// block's own columns from its first wide row, one naming two columns alike too.
    fn heading_again(&self, first: usize, last: usize, c0: usize, c1: usize) -> Option<usize> {
        let area = Rect { top: first.min(last), left: c0.min(c1), bottom: first.max(last), right: c0.max(c1) };
        match self.first_wide_row(&area) {
            Some(x) if x < last => {
                let (left, right) = self.shown_columns(first, last, c0, c1);
                let header = |area: Rect| matches!(self.header(&area), Ok(_) | Err(Reason::TwoColumnsOfOneName));
                (left <= right && header(Rect { top: x, left, bottom: last, right })).then_some(x)
            }
            _ => None,
        }
    }
}

