//! Edits: what the page asks to change (`queueEdit`'s `edit`), worked out into operations on the workbook as it is
//! shown. An edit that would change nothing is no operations (`nothingToChange`).
//!
//! There are 64 kinds of edit. Each family of them has a module of its own, with the same three parts: its
//! `Edit` (the kinds it reads), `read` (the edit as the session reads it before anything else,
//! `None` when it is unreadable) and `make` (the edit worked out on the workbook shown). `read` here sends each kind
//! to its family.

use serde_json::Value as Json;

use super::place::Place;
use crate::workbook::load::Op;

mod cells;
mod clipboard;
mod connected;
pub(crate) mod defaults;
mod formats;
pub(super) mod interactive;
mod named_ranges;
mod named_views;
mod pivot;
pub(super) mod protected;
mod protections;
pub(super) mod lines;
pub(super) mod objects;
mod seen;
mod sheets;
pub(crate) mod tables;

pub use clipboard::moved_from;

/// What an edit is worked out with besides the workbook shown.
#[allow(dead_code)] // until the families that read them are written
pub struct Context<'a> {
    /// The edit's `newIdCode`: what the ids of what it adds are made of (`sht_<code>.0`, `row_<code>.<n>`, …).
    pub code: &'a str,
    /// The page's time zone, when it sent one (`timeZoneOfTheBrowser`).
    pub browser_zone: Option<&'a str>,
    /// What the page says the person was shown (`shownToThePerson`): the texts no cell shows of an earlier
    /// `toBeShownFirst`. None (null or left out): the edit shows nothing first.
    pub shown_to_the_person: Option<&'a [crate::typing::TextThatNoCellShows]>,
    /// The order the person sees a sheet's rows in (`ownRowOrder`), when they put them in one of their own.
    pub own_row_order: Option<&'a super::OwnRowOrder>,
    /// The order the edit is made in, of the sheet it is on (`seen`): set for the families while they make it.
    pub seen: Option<&'a seen::Seen>,
    /// Who makes the edit, when the page told it (`receivePerson`): the protections held against them refuse it.
    pub person: Option<&'a super::person::Person>,
    /// Whether the edit is one of several queued together (`editsBefore`, `editsThatGoAlong`): rows, columns or a
    /// sheet it would move are refused (`moveAmongSeveralEdits`) as soon as it is known that they move, before
    /// anything else is looked at.
    pub is_among_several: bool,
}

impl Context<'_> {
    /// Refuses a move among several edits (`is_among_several`), once the move is known to change something.
    pub fn may_move(&self) -> Result<(), Refused> {
        if self.is_among_several { Err(Refused::Because("moveAmongSeveralEdits")) } else { Ok(()) }
    }
}

/// An edit worked out: its operations, and the place it changed when that is not where the operations change.
pub struct Made {
    pub ops: Vec<Op>,
    pub place: Option<Place>,
}

impl Made {
    pub fn ops(ops: Vec<Op>) -> Made {
        Made { ops, place: None }
    }

    pub fn nothing() -> Made {
        Made { ops: Vec::new(), place: None }
    }
}

#[allow(dead_code)]
pub enum Refused {
    /// The edit is not one the session reads.
    Unreadable,
    /// The edit cannot be made: why, as the page reads it (`{"kind": "refused", "refusal": …}`).
    Because(&'static str),
    /// The edit is answered otherwise than queued or refused: the whole answer (`toBeShownFirst`,
    /// `textThatNoCellShows`, …).
    Answer(Json),
    /// The edit is refused once its operations are tried: they are applied, the workbook found broken (`why`)
    /// and they are taken back, and what they touched is told all the same.
    Tried(&'static str, Vec<Op>),
}

impl From<crate::workbook::load::Refusal> for Refused {
    fn from(refusal: crate::workbook::load::Refusal) -> Refused {
        match serde_json::to_value(refusal) {
            Ok(Json::String(s)) => Refused::Because(Box::leak(s.into_boxed_str())),
            _ => Refused::Unreadable,
        }
    }
}

/// An edit of one of the families.
pub enum Edit {
    Sheets(sheets::Edit),
    Cells(cells::Edit),
    Clipboard(clipboard::Edit),
    Formats(formats::Edit),
    Defaults(defaults::Edit),
    Interactive(interactive::Edit),
    NamedViews(named_views::Edit),
    NamedRanges(named_ranges::Edit),
    Lines(lines::Edit),
    Tables(tables::Edit),
    Pivot(pivot::Edit),
    Objects(objects::Edit),
    Connected(connected::Edit),
    Protections(protections::Edit),
}

pub struct EditLimits {
    pub check_cell_count: bool,
    pub send_whole: bool,
}

impl Edit {
    /// Whether the edit measures what cells show, or pastes their values: formulas waiting for `calculate` are worked
    /// out before it is made.
    pub fn measures_values(&self) -> bool {
        matches!(self, Edit::Lines(edit) if edit.measures_values())
            || matches!(self, Edit::Clipboard(edit) if edit.measures_values())
            || matches!(self, Edit::Defaults(defaults::Edit::SetDefaultValuesAndLimits { .. }))
    }

    /// Whether the edit works out the formulas waiting for `calculate` first: one measuring what cells show, one
    /// inserting rows that reads the sheet's tables (to grow references with them), or one copying cells of the
    /// sheet while a formula of the workbook may spill (as a copy read does).
    pub fn works_formulas_out_first(&self, workbook: &crate::workbook::Workbook) -> bool {
        self.measures_values()
            || matches!(self, Edit::Lines(edit) if edit.reads_tables_first(workbook))
            || matches!(self, Edit::Clipboard(edit) if edit.copies_cells())
                && workbook.needs_calculation
                && !crate::calculate::spill_areas(workbook).is_empty()
    }

    /// Whether the edit is held to the most cells a workbook holds (`tooManyCells`): every edit but `enter`, which
    /// gives one cell (found by probing: a workbook at the limit takes one more cell from `enter`, and none from any
    /// other edit).
    pub fn limits(&self) -> EditLimits {
        EditLimits {
            check_cell_count: !matches!(self, Edit::Cells(cells::Edit::Enter(_))),
            // format_cells already enforces its own 240 KiB limit, including values made by checkboxes.
            send_whole: matches!(self, Edit::Formats(formats::Edit::FormatCells { .. })),
        }
    }

    /// What the edit adds once made, as a part of its own after it, worked out on the workbook it leaves: an imported
    /// table's look.
    pub fn follow_up(&self, code: &str) -> Option<FollowUp> {
        match self {
            Edit::Tables(edit) => tables::follow_up(edit, code).map(FollowUp::Tables),
            Edit::Pivot(edit) => Some(FollowUp::Pivot(pivot::follow_up(edit, code))),
            _ => None,
        }
    }
}

/// What an edit adds once made (`Edit::follow_up`).
pub enum FollowUp {
    Tables(tables::FollowUp),
    Pivot(pivot::FollowUp),
}

/// The operations of what an edit adds once made, on the workbook it leaves (none: nothing to add).
pub fn follow_up_ops(workbook: &crate::workbook::Workbook, follow_up: FollowUp) -> Vec<Op> {
    match follow_up {
        FollowUp::Tables(follow_up) => tables::follow_up_ops(workbook, follow_up),
        FollowUp::Pivot(follow_up) => pivot::follow_up_ops(workbook, follow_up),
    }
}

/// The edit as the session reads it, before anything else about it, by its kind.
pub fn read(edit: Json) -> Option<Edit> {
    // Typing keeps the edit as it came (a paste's texts may be many: taken, not copied).
    let typed = matches!(
        edit.get("kind")?.as_str()?,
        "enter" | "enterInCells" | "enterTextWithLooksInCells" | "pasteTexts" | "pasteRowsOfTexts" | "clearCells"
            | "addUserToCell" | "removeUserFromCell" | "setListLineChecked"
    );
    if typed {
        return cells::read(edit).map(Edit::Cells);
    }
    let edit = &edit;
    let kind = edit.get("kind")?.as_str()?;
    Some(match kind {
        "addSheet" | "renameSheet" | "moveSheet" | "deleteSheet" | "setLocale" | "setTimeZone" => {
            Edit::Sheets(sheets::read(edit)?)
        }
        "pasteCopiedCells" | "pasteValuesOfCopiedCells" | "pasteCellsOfAnotherProgram" | "pasteValuesOfCells"
        | "moveCells" | "fillCells" => Edit::Clipboard(clipboard::read(edit)?),
        "insertPivotTable" | "changePivotTable" => Edit::Pivot(pivot::read(edit)?),
        "formatCells" | "setBorders" | "mergeCells" | "unmergeCells" => Edit::Formats(formats::read(edit)?),
        "setDefaultValuesAndLimits" | "resetCellsToDefaultValues" | "resetSheetsToDefaultValues" => {
            Edit::Defaults(defaults::read(edit)?)
        }
        "writeFromInteractive" | "resetInteractive" | "saveDefaultsOfInteractive" => Edit::Interactive(interactive::read(edit)?),
        "saveNamedView" | "removeNamedView" => Edit::NamedViews(named_views::read(edit)?),
        "saveNamedRange" | "removeNamedRange" => Edit::NamedRanges(named_ranges::read(edit)?),
        "saveProtection" | "removeProtection" => Edit::Protections(protections::read(edit)?),
        "setColumnWidths" | "setRowHeights" | "fitColumns" | "setSheetSettings" | "insertRows" | "insertColumns"
        | "deleteRows" | "deleteColumns" | "moveRows" | "moveColumns" | "hideRows" | "hideColumns" | "groupRows"
        | "groupColumns" | "ungroupRows" | "ungroupColumns" | "setRowGroupsCollapsed" | "setColumnGroupsCollapsed"
        | "showRowGroupsToDepth" | "showColumnGroupsToDepth" => Edit::Lines(lines::read(edit)?),
        "sortRows" | "sortCells" | "moveColumnsOfCells" | "declareCellTable" | "changeCellTable" | "removeCellTable"
        | "importTableAsNewSheet" | "importTableIntoSheet" | "duplicateSheet" => Edit::Tables(tables::read(edit)?),
        "addConditionalFormats" | "changeConditionalFormat" | "moveConditionalFormat" | "removeConditionalFormat"
        | "makeDropdown" | "addDropdownOption" | "setDropdownOptions" | "movePlacedView" | "resizePlacedView"
        | "deletePlacedView" | "copyPlacedView" | "addPlacedView" | "replaceWidgetNodeOfPlacedView"
        | "adoptTimeZone" => Edit::Objects(objects::read(edit)?),
        "addConnectedTable" | "setCallOfConnectedTable" | "addColumnToConnectedTable" | "changeColumnOfConnectedTable" => {
            Edit::Connected(connected::read(edit)?)
        }
        _ => return None,
    })
}

/// Whether the edit works the formulas out before anything else (sorts do, to sort by what they come to).
pub fn calculates_first(edit: &Edit) -> bool {
    matches!(edit, Edit::Pivot(_)) || matches!(edit, Edit::Tables(edit) if tables::calculates_first(edit))
}

/// The refusals of the edit after which the page is told everything changed.
pub fn refusals_that_redraw(edit: &Edit) -> &'static [&'static str] {
    match edit {
        Edit::Tables(edit) => tables::refusals_that_redraw(edit),
        _ => &[],
    }
}

/// An edit's operations as they are checked once applied (`typing::options_kept`): those that leave more cells
/// holding none of their dropdown's options are taken back (`cellOfDropdownHoldsNoOption`), what they touched told
/// with the next changes all the same. Typing, pasting, moving and filling cells are checked so; formatting cells is
/// not.
fn options_kept(workbook: &crate::workbook::Workbook, made: Made) -> Result<Made, Refused> {
    match crate::typing::options_kept(workbook, &made.ops) {
        true => Ok(made),
        false => Err(Refused::Tried("cellOfDropdownHoldsNoOption", made.ops)),
    }
}

/// The sheet whose rows an edit lays out in the order the person sees them, when they put them in one of their own
/// (`seen`): fills down or up, pastes, and borders.
fn in_seen_order(workbook: &crate::workbook::Workbook, edit: &Edit) -> Option<String> {
    match edit {
        Edit::Clipboard(edit) => edit.in_seen_order(workbook),
        Edit::Formats(edit) => edit.in_seen_order(),
        Edit::Cells(cells::Edit::PasteRowsOfTexts(edit)) => edit["selected"]["sheetId"].as_str(),
        _ => None,
    }
    .map(str::to_owned)
}

fn made_by_family(workbook: &crate::workbook::Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    match edit {
        Edit::Sheets(edit) => sheets::make(workbook, edit, context),
        Edit::Cells(edit) => cells::make(workbook, edit, context),
        Edit::Clipboard(edit) => clipboard::make(workbook, edit, context),
        Edit::Formats(edit) => formats::make(workbook, edit, context),
        Edit::Defaults(edit) => defaults::make(workbook, edit),
        Edit::Interactive(edit) => interactive::make(workbook, edit),
        Edit::NamedViews(edit) => named_views::make(workbook, edit, context.code),
        Edit::NamedRanges(edit) => named_ranges::make(workbook, edit, context.code),
        Edit::Lines(edit) => lines::make(workbook, edit, context),
        Edit::Tables(edit) => tables::make(workbook, edit, context),
        Edit::Pivot(edit) => pivot::make(workbook, edit, context),
        Edit::Objects(edit) => objects::make(workbook, edit, context),
        Edit::Connected(edit) => connected::make(workbook, edit, context.code),
        Edit::Protections(edit) => protections::make(workbook, edit, context),
    }
}

pub fn make(workbook: &crate::workbook::Workbook, edit: Edit, context: &Context) -> Result<Made, Refused> {
    let interactive_edit = matches!(&edit, Edit::Interactive(_));
    let connected_edit = matches!(&edit, Edit::Connected(_));
    let of_cells = matches!(&edit, Edit::Cells(_));
    let of_clipboard = matches!(&edit, Edit::Clipboard(_));
    // Edits of formats, and sizing rows, find their cells or rows on the workbook as it is read before they are refused.
    let of_formats = matches!(&edit, Edit::Formats(_) | Edit::Lines(lines::Edit::SetRowHeights { .. }));
    let refused_after = match connected::check_edit(workbook, &edit) {
        Err(refused) if of_cells || of_formats => Some(refused),
        Err(refused) => {
            if let Some(op) = connected::rows_inserted(&edit, context.code) {
                protected::check(workbook, &[op], context.person).map_err(Refused::Because)?;
            }
            return Err(refused);
        }
        Ok(()) => None,
    };
    // An edit of cells, of formats or of the clipboard, or another `connected::is_made_as_read` names, is made on the
    // workbook as it is read, with the rows of its connected tables; deleting or hiding rows of one finds its rows there and changes nothing. An edit
    // of cells refused on a connected table's sheet is refused once it is made, when it changes something; an edit of
    // formats or sizing rows, once its cells or rows are found.
    let stored = workbook;
    let shown_tables = workbook.with_tables();
    let rows_of_table = connected::rows_of_table(stored, &edit);
    let sorts_rows_of_table = connected::sorts_rows_of_table(stored, &edit);
    let workbook: &crate::workbook::Workbook =
        if of_cells || of_formats || rows_of_table || connected::is_made_as_read(&edit) { &shown_tables } else { stored };
    let is_held_to_limits = defaults::is_held_to_limits(&edit);
    let order = match (context.own_row_order, in_seen_order(workbook, &edit)) {
        (Some(order), Some(sheet_id)) => seen::read(workbook, order, &sheet_id)?,
        _ => None,
    };
    let made = match order {
        // Made on the workbook as the person sees it, its place by the rows as stored.
        Some((order, lines)) => {
            let shown = seen::shown(workbook, &order, &lines);
            let made = made_by_family(&shown, edit, &Context { seen: Some(&order), ..*context })?;
            Ok(seen::back(made, &shown, workbook, &order))
        }
        None => match made_by_family(workbook, edit, context) {
            // Every row of a table deleted is no rows of the sheet deleted.
            Err(Refused::Because("noRowLeft")) if rows_of_table => Ok(Made::nothing()),
            made => made,
        },
    };
    let made_on = workbook;
    let workbook = stored;
    if sorts_rows_of_table && made.as_ref().is_ok_and(|made| !made.ops.is_empty()) {
        return Err(Refused::Because("unknownRow"));
    }
    // Operations refused once tried are checked against protections first: each is checked before it applies.
    let mut made = match made {
        Err(Refused::Tried(why, ops)) => {
            protected::check(made_on, &ops, context.person).map_err(Refused::Because)?;
            return Err(Refused::Tried(why, ops));
        }
        made => made?,
    };
    if rows_of_table {
        made.ops.clear();
        return Ok(made);
    }
    if of_cells || of_clipboard {
        connected::check_formulas(workbook, &made.ops)?;
    }
    if let Some(refused) = refused_after.filter(|_| of_formats || !made.ops.is_empty()) {
        // A protection refuses it first, as it refuses the operation refused or one before it, its cells found where
        // the edit found them.
        let upto = connected::check_ops(workbook, &made.ops).err().map_or(made.ops.len(), |(i, _)| i + 1);
        protected::check(made_on, &made.ops[..upto], context.person).map_err(Refused::Because)?;
        return Err(refused);
    }
    if is_held_to_limits {
        made = defaults::limits_kept(workbook, made)?;
    }
    if !interactive_edit {
        interactive::check_grid_edits(workbook, &made.ops)?;
    }
    // Each operation is checked against protections, then against a connected table's sheet: one a connected
    // table refuses is refused for a protection first, when one refuses it or an operation before it. The cells of the
    // operations are found where the edit found them.
    if !connected_edit {
        if let Err((i, refused)) = connected::check_ops(workbook, &made.ops) {
            protected::check(made_on, &made.ops[..=i], context.person).map_err(Refused::Because)?;
            return Err(refused);
        }
    }
    protected::check(made_on, &made.ops, context.person).map_err(Refused::Because)?;
    objects::adopt_time_zone(workbook, &mut made, context);
    Ok(made)
}
