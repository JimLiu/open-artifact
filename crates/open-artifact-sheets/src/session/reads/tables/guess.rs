//! The page's guess at the table around a cell (readTableAtCell): the block of cells around it, its header (the row
//! that best names columns of one kind of value), the blocks above and below that read as more of it, and the part
//! each row of its body plays; then its columns' names and kinds. The modules go from the sheet as the guess reads
//! it (`grid`) up to the table around a cell (`around`) and its columns (`columns`).

use std::collections::BTreeMap;

use serde_json::{json, Value as Json};

use super::live::Role;
use crate::workbook::{Sheet, Workbook};

mod around;
mod block;
mod cell_tables;
mod columns;
mod grid;
mod header;
mod profile;
mod recognize;
mod rows;
mod runs;
mod table;

pub(super) use cell_tables::{cell_table_at, cell_table_declared_as, cell_tables};
pub(in crate::session::reads) use recognize::tables_of_sheet;
use grid::Grid;
use recognize::Basis;
use runs::{HeaderRows, Table};

/// A table of a sheet as it is read, by positions: its header's first row, its body's first and last rows, and its
/// columns (first to last). Only tables read with a header.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TableBody {
    pub header_first: usize,
    pub header_last: usize,
    pub from: usize,
    pub to: usize,
    pub columns: (usize, usize),
}

/// The tables of a sheet, declared or guessed, that are read with a header (what insertRows grows references by).
pub(crate) fn bodies_of_tables(workbook: &Workbook, sheet: &Sheet) -> Vec<TableBody> {
    let grid = Grid::of(workbook, sheet);
    let tables = recognize::found_tables(&grid, sheet);
    tables
        .iter()
        .filter_map(|found| {
            let table = found.reading(&grid)?;
            let header = table.header?;
            let read = found.body_read(&grid, &table)?;
            // A body that ends higher read at a cell, over the footer that reading finds, ends there too.
            let at = found.at_cell(&grid, sheet, &tables);
            let to = match at.reading(&grid) {
                Some(t) if at.header == found.header => table.to.min(t.to).max(table.from),
                _ => table.to,
            }
            .min(read)
            .max(table.from);
            Some(TableBody {
                header_first: header.first,
                header_last: header.last,
                from: table.from,
                to,
                columns: (table.first_column, table.last_column),
            })
        })
        .collect()
}

/// The table guessed around a cell, with its columns: null when there is none.
pub(super) fn read_at(workbook: &Workbook, sheet: &Sheet, row: usize, column: usize) -> Json {
    let grid = Grid::of(workbook, sheet);
    let tables = recognize::found_tables(&grid, sheet);
    let Some(found) = tables.iter().map(|t| t.at_cell(&grid, sheet, &tables)).find(|t| t.area().holds(row, column)) else {
        return Json::Null;
    };
    let Some(table) = found.reading(&grid) else { return Json::Null };
    read_table(workbook, sheet, &grid, &found.basis_at(&grid, &table), &table, found.row_under_reading(&grid, Some(&table)))
}

fn read_table(workbook: &Workbook, sheet: &Sheet, grid: &Grid, basis: &Basis, table: &Table, under: Option<usize>) -> Json {
    let columns = columns_in_ids(workbook, sheet, grid, table, matches!(basis, Basis::Declared(_)));
    json!({"basis": basis.in_json(), "table": table_in_ids(workbook, sheet, table, under), "columns": columns})
}

type Span = (usize, usize);
type Area = (usize, usize, usize, usize);

/// The classified table around a conditional-format selection.
pub(in crate::session::reads) struct TableForFormatting {
    /// Where it is as read.
    pub cells: Area,
    /// Where it is as the sheet's tables tell it, before it is read at a cell: the cells meet it there or where it
    /// is read.
    pub own: Area,
    pub records: Option<Area>,
    /// Whether it is a cell table the sheet declares.
    pub declared: bool,
    pub footer: Option<Span>,
    pub non_records: Vec<(Span, &'static str)>,
    pub names: BTreeMap<usize, String>,
}

pub(in crate::session::reads) fn tables_for_formatting(
    workbook: &Workbook,
    sheet: &Sheet,
    (top, left, bottom, right): Area,
    adjacent: bool,
) -> Vec<TableForFormatting> {
    let grid = Grid::of(workbook, sheet);
    let classified = recognize::found_tables(&grid, sheet);
    // A table the cells meet, as classified, is read as the table at its top left cell: the first that holds it as
    // read at a cell, a recognized one running on and one with no headings taking its header for records, but none
    // joined to the tables beside it unless the cells meet more than one table. Tables read as the
    // same one are that one.
    let near = usize::from(adjacent);
    let apart = |(t, l, b, r): Area| top > b.saturating_add(near) || t > bottom.saturating_add(near) || left > r || l > right;
    // The cells meet it as classified or as read at a cell.
    let meets = |classified: &recognize::Found, read: &recognize::Found| {
        let (a, b) = (classified.area(), read.area());
        !apart((a.top, a.left, a.bottom, a.right)) || !apart((b.top, b.left, b.bottom, b.right))
    };
    let alone: Vec<_> = classified.iter().map(|t| t.at_cell_alone(&grid, sheet, &classified)).collect();
    let several = classified.iter().zip(&alone).filter(|(c, a)| meets(c, a)).count() > 1;
    let at = if several { classified.iter().map(|t| t.at_cell(&grid, sheet, &classified)).collect() } else { alone };
    let mut read = Vec::new();
    classified.iter().enumerate().filter_map(|(i, classified)| {
        let area = classified.area();
        if !meets(classified, &at[i]) {
            return None;
        }
        let j = at.iter().position(|t| t.area().holds(area.top, area.left)).unwrap_or(i);
        if read.contains(&j) {
            return None;
        }
        read.push(j);
        Some(((area.top, area.left, area.bottom, area.right), &at[j]))
    }).collect::<Vec<_>>().into_iter().map(|(own, found)| {
        let area = found.area();
        let table = found.reading(&grid);
        // Blank rows at the end of its body, which its reading leaves out, are among its records, told as blank, but not after titles the reading ends above.
        let trailing = table.as_ref().filter(|t| found.last_record().is_none_or(|last| last <= t.to))
            .and_then(|t| found.body.last().filter(|run| run.role == recognize::Role::Blank && run.last > t.to));
        let non_records = table.as_ref().into_iter().flat_map(|t| &t.runs).filter_map(|r| {
            match r.role {
                Role::Spacer => Some(((r.first, r.last), "blank")),
                Role::Section | Role::HeaderAgain => Some(((r.first, r.last), "sectionLabel")),
                Role::Subtotal => Some(((r.first, r.last), "subtotal")),
                Role::Record => None,
            }
        }).chain(trailing.map(|run| ((run.first, run.last), "blank"))).collect();
        let names = table.as_ref().into_iter().flat_map(|t| grid.columns_of(t, matches!(found.basis, Basis::Declared(_)))).filter_map(|c| Some((c.column, c.name?))).collect();
        TableForFormatting {
            own,
            cells: (area.top, area.left, area.bottom, area.right),
            // The records are those of the table read at a cell: titles at the end, which its reading leaves out,
            // are its footer here.
            records: table.as_ref().map(|t| (t.from, area.left, trailing.map_or(t.to, |run| t.to.max(run.last)), area.right)),
            declared: matches!(found.basis, Basis::Declared(_)),
            footer: found.footer.or_else(|| {
                let t = table.as_ref()?;
                let last = found.last_record().filter(|&last| last > t.to && trailing.is_none())?;
                Some((found.first_left_out(t.to)?, last))
            }),
            non_records,
            names,
        }
    }).collect()
}

/// Where the cell tables a sheet declares are, as read: those that give way left out.
pub(in crate::session::reads) fn declared_areas(workbook: &Workbook, sheet: &Sheet) -> Vec<Area> {
    let grid = Grid::of(workbook, sheet);
    recognize::found_tables(&grid, sheet)
        .into_iter()
        .filter(|found| matches!(found.basis, Basis::Declared(_)))
        .map(|found| {
            let area = found.area();
            (area.top, area.left, area.bottom, area.right)
        })
        .collect()
}

/// A table's columns by ids, each with its name and kind; a declared table's header keeps a last row of units.
fn columns_in_ids(workbook: &Workbook, sheet: &Sheet, grid: &Grid, table: &Table, declared: bool) -> Vec<Json> {
    let id = |c: usize| sheet.columns.line(c).map(|l| workbook.bases.text(l));
    grid.columns_of(table, declared).into_iter().map(|c| json!({"c": id(c.column), "name": c.name, "kind": c.kind.name()})).collect()
}

/// A role as the page names it.
fn role_name(role: Role) -> &'static str {
    match role {
        Role::Record => "record",
        Role::Spacer => "spacer",
        Role::Section => "section",
        Role::Subtotal => "subtotal",
        Role::HeaderAgain => "headerAgain",
    }
}

/// A guessed table by ids, with the row under its body.
fn table_in_ids(workbook: &Workbook, sheet: &Sheet, table: &Table, under: Option<usize>) -> Json {
    let row = |r: usize| sheet.rows.line(r).map(|l| workbook.bases.text(l));
    let column = |c: usize| sheet.columns.line(c).map(|l| workbook.bases.text(l));
    let header = table.header.map(|h| json!({"firstRow": row(h.first), "lastRow": row(h.last), "isSure": h.is_sure}));
    let runs: Vec<Json> = table
        .runs
        .iter()
        .map(|r| json!({"firstRow": row(r.first), "lastRow": row(r.last), "role": role_name(r.role)}))
        .collect();
    json!({
        "sheetId": sheet.id,
        "header": header,
        "firstColumn": column(table.first_column),
        "lastColumn": column(table.last_column),
        "firstRowOfBody": row(table.from),
        "lastRowOfBody": row(table.to),
        "rowUnderTheBody": under.and_then(row),
        "runs": runs,
    })
}
