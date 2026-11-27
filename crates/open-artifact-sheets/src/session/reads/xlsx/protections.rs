//! A sheet's protections in the file: `<sheetProtection>` and the ranges anyone may still edit
//! (`<protectedRanges>`, named `Range1`, `Range2`, … in order), after the sheet's cells. The editors of protections are
//! not carried over (`editorsOfProtections`).
//!
//! A sheet with a protection of its own is protected as a whole (`objects` and `scenarios` too); one with only ranges'
//! protections is protected with every action Excel lets a protected sheet allow turned off. A protection whose range
//! has no line left is not written; a sheet with none left is not protected.
//!
//! The cells left editable are those in an open range of every protection of the sheet itself and in no protected
//! range, written as rectangles: first the columns editable from top to bottom, then the rows editable from end to
//! end (each as runs of them), then what is left of the grid that the ranges' first and last lines cut the sheet into,
//! band by band of rows: the pieces of a band side by side make one rectangle, and one goes on down into the next band
//! of rows, right below it, that has a piece just as wide.

use std::fmt::Write;

use crate::formula::column_letters;
use crate::ids::Bases;
use crate::workbook::protections::{Protects, Span};
use crate::workbook::Sheet;

/// The rows and columns of a sheet in the file.
const ROWS: usize = 1_048_576;
const COLUMNS: usize = 16_384;

const OF_THE_SHEET: &str = "<sheetProtection sheet=\"1\" objects=\"1\" scenarios=\"1\"/>";
const OF_RANGES: &str = "<sheetProtection sheet=\"1\" formatCells=\"0\" formatColumns=\"0\" formatRows=\"0\" \
                         insertColumns=\"0\" insertRows=\"0\" insertHyperlinks=\"0\" deleteColumns=\"0\" deleteRows=\"0\" \
                         sort=\"0\" autoFilter=\"0\" pivotTables=\"0\"/>";

/// A span's ends on an axis of the file, first and last.
fn ends(ends: Option<(usize, usize)>, size: usize) -> Option<(usize, usize)> {
    let (a, b) = ends.unwrap_or((0, size - 1));
    (a < size).then(|| (a, b.min(size - 1)))
}

/// A rectangle of the file: top, bottom, left, right.
type Rect = (usize, usize, usize, usize);

fn rect(span: &Span) -> Option<Rect> {
    let (top, bottom) = ends(span.rows, ROWS)?;
    let (left, right) = ends(span.columns, COLUMNS)?;
    Some((top, bottom, left, right))
}

fn holds(&(top, bottom, left, right): &Rect, row: usize, column: usize) -> bool {
    (top..=bottom).contains(&row) && (left..=right).contains(&column)
}

/// Whether any protection of the sheet is written: a sheet's own, or a range's with lines left.
pub fn is_written(bases: &Bases, sheet: &Sheet) -> bool {
    sheet.protections.values().any(|(_, p)| match &p.protects {
        Protects::Range { range } => range.live(bases, sheet).as_ref().and_then(rect).is_some(),
        Protects::Sheet { .. } => true,
    })
}

/// The sheet's protections as the file has them; empty when it is not protected.
pub fn part(bases: &Bases, sheet: &Sheet) -> String {
    let mut ranges: Vec<Rect> = Vec::new();
    // The open ranges of each of the sheet's own protections.
    let mut opens: Vec<Vec<Rect>> = Vec::new();
    for (_, protection) in sheet.protections.values() {
        match &protection.protects {
            Protects::Range { range } => ranges.extend(range.live(bases, sheet).as_ref().and_then(rect)),
            Protects::Sheet { open_ranges } => {
                opens.push(open_ranges.iter().filter_map(|r| r.live(bases, sheet)).filter_map(|s| rect(&s)).collect())
            }
        }
    }
    if ranges.is_empty() && opens.is_empty() {
        return String::new();
    }
    let free = |row: usize, column: usize| {
        opens.iter().all(|open| open.iter().any(|r| holds(r, row, column)))
            && !ranges.iter().any(|r| holds(r, row, column))
    };
    // The bands the rectangles' first and last lines cut each axis into, as (first, last).
    let bands = |cuts: &mut Vec<usize>, size: usize| -> Vec<(usize, usize)> {
        cuts.push(0);
        cuts.push(size);
        cuts.sort_unstable();
        cuts.dedup();
        cuts.windows(2).map(|w| (w[0], w[1] - 1)).collect()
    };
    let all = ranges.iter().chain(opens.iter().flatten());
    let rows = bands(&mut all.clone().flat_map(|&(t, b, _, _)| [t, b + 1]).collect(), ROWS);
    let columns = bands(&mut all.flat_map(|&(_, _, l, r)| [l, r + 1]).collect(), COLUMNS);
    let free_columns: Vec<bool> = columns.iter().map(|&(c, _)| rows.iter().all(|&(r, _)| free(r, c))).collect();
    let free_rows: Vec<bool> = rows.iter().map(|&(r, _)| columns.iter().all(|&(c, _)| free(r, c))).collect();

    let mut out: Vec<Rect> = Vec::new();
    // Runs of bands each free, side by side.
    let runs = |bands: &[(usize, usize)], is_free: &dyn Fn(usize) -> bool| -> Vec<(usize, usize)> {
        let mut runs: Vec<(usize, usize)> = Vec::new();
        for (i, &(first, last)) in bands.iter().enumerate() {
            if !is_free(i) {
                continue;
            }
            match runs.last_mut() {
                Some(run) if run.1 + 1 == first => run.1 = last,
                _ => runs.push((first, last)),
            }
        }
        runs
    };
    out.extend(runs(&columns, &|i| free_columns[i]).into_iter().map(|(l, r)| (0, ROWS - 1, l, r)));
    out.extend(runs(&rows, &|i| free_rows[i]).into_iter().map(|(t, b)| (t, b, 0, COLUMNS - 1)));
    // The grid: the rectangles of the band of rows before, which the next band may carry on.
    let first_of_grid = out.len();
    let mut above: Vec<usize> = Vec::new();
    let mut last_row: Option<usize> = None;
    for (i, &(top, bottom)) in rows.iter().enumerate() {
        if free_rows[i] {
            continue;
        }
        let pieces = runs(&columns, &|j| !free_columns[j] && free(top, columns[j].0));
        let goes_on = last_row.is_some_and(|l| l + 1 == top);
        let mut here = Vec::new();
        for (left, right) in pieces {
            let carried = above.iter().copied().filter(|_| goes_on).find(|&k| out[k].2 == left && out[k].3 == right);
            match carried {
                Some(k) => {
                    out[k].1 = bottom;
                    here.push(k);
                }
                None => {
                    out.push((top, bottom, left, right));
                    here.push(out.len() - 1);
                }
            }
        }
        debug_assert!(here.iter().all(|&k| k >= first_of_grid));
        above = here;
        last_row = Some(bottom);
    }

    let mut xml = String::from(if opens.is_empty() { OF_RANGES } else { OF_THE_SHEET });
    if !out.is_empty() {
        xml.push_str("<protectedRanges>");
        for (n, &(top, bottom, left, right)) in out.iter().enumerate() {
            let from = format!("{}{}", column_letters(left), top + 1);
            let sqref =
                if (top, left) == (bottom, right) { from } else { format!("{from}:{}{}", column_letters(right), bottom + 1) };
            let _ = write!(xml, "<protectedRange sqref=\"{sqref}\" name=\"Range{}\"/>", n + 1);
        }
        xml.push_str("</protectedRanges>");
    }
    xml
}
