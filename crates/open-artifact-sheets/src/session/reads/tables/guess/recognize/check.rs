//! Whether a block proves a table: a header, a body of two records or more under it, no labels left
//! of it past a blank column, no heading coming again; then something that proves the header is one: a column whose
//! records are typed values under a heading, five records or more in two columns, the sheet's frozen rows ending at
//! it, or a bold or filled header over records that are not.

use std::collections::BTreeMap;

use super::blocks::Block;
use super::body::Frame;
use super::sheet::{Rect, Sheet, Skip, Value};
use super::{Basis, Found, Reason, Role};
use crate::workbook::Input;

/// The kinds of the records of a column, in this order.
const PLAIN_TEXT: u8 = 0;
const PICKED_TEXT: u8 = 1;
const COMPUTED_TEXT: u8 = 2;
const NUMBER: u8 = 3;
const BOOLEAN: u8 = 4;
const MIXED: u8 = 6;
const NO_CELL: u8 = 7;

/// A kind's family: texts, numbers or booleans.
fn family(kind: u8) -> u8 {
    if kind > 2 {
        kind - 3
    } else {
        2
    }
}

/// Why a block is not recognized, and the header it is assumed to have when that is not its top's.
#[derive(Clone, Copy, Debug)]
pub(super) struct Refusal {
    pub reason: Reason,
    pub header: Option<(usize, usize)>,
}

impl Sheet<'_> {
    /// A block recognized as a table, or why it is not; other tables' ranges bound its body. A header with no
    /// heading over the first column, or one missing a column's heading or naming two alike, gives way to the row under it, when that one has a heading
    /// over every column and would be recognized: either row may be the header, and the lower one is assumed.
    pub(super) fn recognize(&self, block: &Block, taken: &[Rect]) -> Result<Found, Refusal> {
        let rect = block.area;
        let err = match self.recognize_from(&rect, taken) {
            Ok(found) => return Ok(found),
            Err(reason) => reason,
        };
        let lower = match self.header(&rect) {
            Ok(h) if h.headings.contains_key(&rect.left) => None,
            Ok(h) => Some(h.last.saturating_add(1)),
            Err(Reason::NoHeadings) => None,
            Err(_) => Some(rect.top.saturating_add(1)),
        };
        let lower = lower.filter(|&row| row < rect.bottom).and_then(|row| {
            let area = Rect { top: row, ..rect };
            let header = self.header(&area).ok().filter(|h| h.headings.contains_key(&rect.left))?;
            self.recognize_from(&area, taken).ok()?;
            Some((header.first, header.last))
        });
        Err(match lower {
            Some(header) => Refusal { reason: Reason::EitherOfTwoRowsMayBeTheHeader, header: Some(header) },
            None => Refusal { reason: err, header: None },
        })
    }

    /// A range recognized as a table from its top row, or why it is not.
    fn recognize_from(&self, rect: &Rect, taken: &[Rect]) -> Result<Found, Reason> {
        let rect = *rect;
        let header = self.header(&rect)?;
        if header.last == rect.bottom {
            return Err(Reason::FewerThanTwoRecords);
        }
        let (c0, c1) = (rect.left, rect.right);
        let hl = header.last;
        let frame = Frame { header: (header.first, hl), columns: (c0, c1) };
        let limit = self.limit(&frame, taken);
        let body = self.recognized_body(&frame, rect.bottom, limit, false)?;
        let record_runs: Vec<(usize, usize)> =
            body.runs.iter().filter(|r| r.role == Role::Record).map(|r| (r.first, r.last)).collect();
        let record_rows = || record_runs.iter().flat_map(|&(a, b)| a..=b);

        // Labels two columns left, past a blank column, on the header's row and every record's.
        let passes = |row: usize| {
            !(c0 >= 2 && self.has_content(row, c0 - 2, c0 - 2) && !(c0 >= 3 && self.has_content(row, c0 - 3, c0 - 3)))
        };
        if !passes(hl) && (body.runs.is_empty() || !record_rows().any(passes)) {
            return Err(Reason::LabelsPastABlankColumn);
        }
        // A record repeating its column's heading.
        let repeats = |row: usize| {
            self.cells_in(row, c0, c1).iter().any(|cell| {
                let (Value::Text(t), Some(Value::Text(h))) = (cell.value, header.headings.get(&cell.column).map(|h| h.value)) else {
                    return false;
                };
                t.chars().flat_map(char::to_lowercase).eq(h.chars().flat_map(char::to_lowercase))
            })
        };
        if record_rows().any(repeats) {
            return Err(Reason::HeadingComesAgain);
        }

        // Each column's kind over its records, and whether it has two cells or more.
        let rows: Vec<usize> = record_rows().collect();
        let kinds = self.kinds_of(&rows, c0, c1);

        let first_kind = kinds.get(&c0).map_or(NO_CELL, |v| v.1);
        let two_columns = c0.saturating_add(1) == c1;
        let few = !(record_runs.iter().any(|&(a, b)| b > a) || record_runs.len() >= 2);
        let exempt = !two_columns && first_kind == PLAIN_TEXT && kinds.values().any(|v| v.1 == NUMBER);
        if few && !exempt {
            return Err(Reason::FewerThanTwoRecords);
        }
        if header.headings.values().any(|h| !h.is_text()) && first_kind > 2 {
            return Err(Reason::NoHeadings);
        }
        let typed = self.typed(&kinds, |col| header.headings.get(&col).map(|h| (h.row, h.column)));
        let found = || Found {
            header: (header.first, hl),
            columns: (c0, c1),
            body: body.runs.clone(),
            footer: body.footer,
            basis: Basis::Recognized,
            proved_over: None,
        };
        let mut nothing_proves = !typed;
        if !two_columns || first_kind > 2 || body.subtotals {
            if typed {
                return Ok(found());
            }
        } else if record_rows().count() >= 5 {
            let some_first_not_bold = record_rows()
                .flat_map(|r| self.cells_in(r, c0, c1).iter())
                .any(|c| c.column == c0 && !self.grid.is_bold(c.row, c.column));
            if some_first_not_bold {
                if typed {
                    return Ok(found());
                }
                nothing_proves = true;
            }
        }

        let first_steady = kinds.get(&c0).is_some_and(|v| v.1 != MIXED && (few || v.0));
        let left = c0 > 0 && self.has_content(hl, 0, c0 - 1);
        if !left && self.grid.last_frozen_row() == Some(hl) {
            return Ok(found());
        }
        if first_steady {
            let styled = |k: usize, row: usize, column: usize| {
                if k == 0 {
                    self.grid.is_bold(row, column)
                } else {
                    self.grid.is_filled(row, column)
                }
            };
            let header_styled = [0, 1].into_iter().any(|k| {
                header.headings.values().all(|h| styled(k, h.row, h.column))
                    && !record_rows().any(|row| self.cells_in(row, c0, c1).iter().all(|c| styled(k, c.row, c.column)))
            });
            if header_styled {
                return Ok(found());
            }
        }
        // Nothing proves the header, but the first record would as the header: it is a row of headings, and the
        // records under it are typed.
        let second_proves = || {
            rows.len() > 2
                && self.is_heading_row(rows[0], c0, c1, None, Skip::Texts)
                && self.kinds_of(&rows[1..], c0, c1).iter().any(|(&col, &(several, kind))| {
                    several && matches!(kind, NUMBER | BOOLEAN) && !self.cells_in(rows[0], col, col).is_empty()
                })
        };
        Err(if few {
            Reason::FewerThanTwoRecords
        } else if nothing_proves && second_proves() {
            Reason::EitherOfTwoRowsMayBeTheHeader
        } else if nothing_proves {
            Reason::NothingProvesTheHeader
        } else {
            Reason::MayBeLabelsAndValues
        })
    }

    /// Whether some column with a heading has two records or more of one type: numbers, booleans, or picked or
    /// computed texts under a heading typed as a value.
    pub(super) fn typed(&self, kinds: &BTreeMap<usize, (bool, u8)>, heading: impl Fn(usize) -> Option<(usize, usize)>) -> bool {
        kinds.iter().any(|(&col, &(several, kind))| {
            let Some((row, column)) = heading(col) else { return false };
            several
                && match kind {
                    NUMBER | BOOLEAN => true,
                    PLAIN_TEXT | MIXED => false,
                    _ => self.grid.input(row, column).is_some_and(|input| {
                        !matches!(input, Input::Formula { .. } | Input::DropdownOption { .. } | Input::User { .. } | Input::Users { .. })
                    }),
                }
        })
    }

    /// Whether a record's cell is merged across columns where the header's last row has no merged range of those
    /// columns.
    fn merged_among(&self, rows: &[usize], hl: usize, (c0, c1): (usize, usize)) -> bool {
        rows.iter().any(|&row| {
            self.cells_in(row, c0, c1).iter().any(|cell| {
                let (lo, hi) = self.merge_columns(row, cell.column);
                let area = Rect { top: hl, left: lo, bottom: hl, right: hi };
                lo < hi && !self.merges_meeting(area).find(|m| m.left == lo).is_some_and(|m| m.right == hi)
            })
        })
    }

    /// Whether an assumed table's header row is proved by typed records under its headings, none summing a range of
    /// its column from the header or over all its cells above it, the last not summing some records, none merged
    /// across columns and none repeating its heading. Headings not all texts over a first column whose records are no
    /// texts do not prove it, as they give no headings when it is recognized.
    pub(super) fn assumed_header_is_typed(&self, found: &Found) -> bool {
        let (c0, c1) = found.columns;
        let hl = found.header.1;
        let rows: Vec<usize> =
            found.body.iter().filter(|r| r.role == Role::Record).flat_map(|r| r.first..=r.last).collect();
        let kinds = self.kinds_of(&rows, c0, c1);
        if self.cells_in(hl, c0, c1).iter().any(|c| !c.is_text()) && kinds.get(&c0).map_or(NO_CELL, |v| v.1) > 2 {
            return false;
        }
        let headings: BTreeMap<usize, usize> = self.cells_in(hl, c0, c1).iter().map(|c| (c.column, c.row)).collect();
        let Some(last) = found.body.last().map(|r| r.last) else { return false };
        let frame = Frame { header: found.header, columns: found.columns };
        self.typed(&kinds, |col| headings.get(&col).map(|&row| (row, col)))
            && !self.sums_from_the_header(&frame, hl + 1, last)
            && !self.last_record_sums(&frame, hl + 1, last)
            && !self.sums_its_cells_above(&frame, hl + 1, last)
            && !self.merged_among(&rows, hl, found.columns)
            && !self.repeats_heading(found)
    }

    /// Whether a record of a table repeats its column's heading, case aside, even the only one.
    fn repeats_heading(&self, found: &Found) -> bool {
        let (c0, c1) = found.columns;
        let headings: BTreeMap<usize, &str> = self
            .cells_in(found.header.1, c0, c1)
            .iter()
            .filter_map(|c| match c.value {
                Value::Text(t) => Some((c.column, t)),
                _ => None,
            })
            .collect();
        let rows = found.body.iter().filter(|r| r.role == Role::Record).flat_map(|r| r.first..=r.last);
        rows.into_iter().any(|row| {
            self.cells_in(row, c0, c1).iter().any(|cell| match (cell.value, headings.get(&cell.column)) {
                (Value::Text(t), Some(h)) => t.chars().flat_map(char::to_lowercase).eq(h.chars().flat_map(char::to_lowercase)),
                _ => false,
            })
        })
    }

    /// Why an assumed table whose header nothing proves is not recognized, read again at a cell: a record repeating
    /// its heading, fewer than two records, the first record proved as a header by typed records under it, or
    /// nothing proving the header.
    pub(super) fn reason_unproved(&self, found: &Found) -> Reason {
        let (c0, c1) = found.columns;
        let runs: Vec<(usize, usize)> =
            found.body.iter().filter(|r| r.role == Role::Record).map(|r| (r.first, r.last)).collect();
        // A record repeating its column's heading, case aside, even the only one.
        let repeats = self.repeats_heading(found);
        if repeats {
            return Reason::HeadingComesAgain;
        }
        if !(runs.iter().any(|&(a, b)| b > a) || runs.len() >= 2) {
            return Reason::FewerThanTwoRecords;
        }
        let rows: Vec<usize> =
            runs.iter().flat_map(|&(a, b)| a..=b).filter(|&row| !self.cells_in(row, c0, c1).is_empty()).collect();
        let Some((&first, rest)) = rows.split_first() else { return Reason::NothingProvesTheHeader };
        let headings: BTreeMap<usize, usize> = self.cells_in(first, c0, c1).iter().map(|c| (c.column, c.row)).collect();
        // The first record proves it only as a row of headings.
        if rest.len() >= 2
            && self.is_heading_row(first, c0, c1, None, Skip::Texts)
            && self.typed(&self.kinds_of(rest, c0, c1), |col| headings.get(&col).map(|&row| (row, col)))
        {
            Reason::EitherOfTwoRowsMayBeTheHeader
        } else {
            Reason::NothingProvesTheHeader
        }
    }

    /// Each column's kind over these records, and whether it has two cells or more.
    pub(super) fn kinds_of(&self, rows: &[usize], c0: usize, c1: usize) -> BTreeMap<usize, (bool, u8)> {
        let mut kinds: BTreeMap<usize, (bool, u8)> = BTreeMap::new();
        let cells = rows
            .iter()
            .flat_map(|&r| self.cells_in(r, c0, c1).iter())
            .chain(rows.iter().flat_map(|&r| self.unticked_in(r, c0, c1).iter()));
        for cell in cells {
            let prev = kinds.get(&cell.column).map(|v| v.1);
            if matches!(cell.value, Value::Error) || prev == Some(MIXED) {
                continue;
            }
            let new = match cell.value {
                Value::Number(_) => NUMBER,
                Value::Boolean => BOOLEAN,
                _ => match self.grid.input(cell.row, cell.column) {
                    None | Some(Input::Formula { .. }) => COMPUTED_TEXT,
                    Some(Input::DropdownOption { .. } | Input::User { .. } | Input::Users { .. }) => PICKED_TEXT,
                    Some(_) => PLAIN_TEXT,
                },
            };
            let kind = match prev {
                None => new,
                Some(p) if cell.is_text() && p <= 2 => {
                    if p == PLAIN_TEXT || new == p {
                        p
                    } else {
                        PLAIN_TEXT
                    }
                }
                Some(p) => {
                    if family(p) != family(new) {
                        MIXED
                    } else if family(p) != 2 || p == new {
                        new
                    } else {
                        MIXED
                    }
                }
            };
            kinds.insert(cell.column, (prev.is_some(), kind));
        }
        kinds
    }
}
