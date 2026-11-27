/**
 * Why the engine refuses, and why a synced session stops or faults. Every
 * refusal is answered `{"kind": "refused", "refusal": …}`.
 */

/** Why operations are refused (`load`, `apply`, and edits once worked out into operations). */
export type OpRefusal =
  | 'unreadableRequest'
  | 'unknownSheet'
  | 'unknownRow'
  | 'unknownColumn'
  | 'columnNamedTwice'
  | 'rowNamedTwice'
  | 'cellNamedTwice'
  | 'rowMovedTwice'
  | 'columnMovedTwice'
  | 'sheetMovedTwice'
  | 'movedAfterWhatIsMoved'
  | 'twoMovesToOnePlace'
  | 'idAlreadyHeld'
  /** Undeleting what a load deleted: the load did not keep it. */
  | 'deletedCellsNotLoaded'
  | 'numberNotFinite'
  /** `load`, `apply`, `undo` or `replay` on a session that syncs. */
  | 'syncInUse'
  | 'cellFormatSetTwice'
  | 'sheetSettingsSetTwice'
  | 'unknownDropdown'
  | 'dropdownSetTwice'
  | 'dropdownOptionIdInTwoDropdowns'
  | 'dropdownIdTaken'
  | 'dropdownOptionIdTaken'
  | 'dropdownInUse'
  | 'unknownGroup'
  | 'groupNamedTwice'
  | 'unknownConditionalFormat'
  | 'conditionalFormatNamedTwice'
  | 'viewNamedTwice'
  | 'viewInUse'
  | 'unknownView'
  | 'namedViewNamedTwice'
  | 'placementNamedTwice'
  | 'cellTableNamedTwice'
  | 'rangeAlreadyMerged'
  | 'rangeNotMerged'
  | 'unknownDropdownOption'
  | 'cellOfDropdownHoldsNoOption'
  | 'cellCoveredByMergedRange'
  | 'textTooLong'
  | 'formulaTooLong'
  | 'tooMuchThatNoCellShows'
  | 'idNotWellFormed'
  | 'editTooLarge'
  | 'tooManyCellsToEnterIn'
  | 'userIdNotWellFormed'
  | 'tooManyUsersInCell'
  | 'userLabelNotAllowed'
  | 'addressLinkedToTooLong'
  | 'addressLinkedToNotOfTheWeb'
  | 'richTextTooLarge'
  | 'rowNotNamedInTheWay'
  | 'connectedTableNamedTwice'
  | 'namedRangeNamedTwice'
  | 'protectionNamedTwice';

/** Why a reverse (`undo`) or a step taken back is refused. */
export type TakeBackRefusal =
  /** The reverse does not apply to the workbook: it is not one. */
  | 'notAReverse'
  /** What the step did is no longer so. */
  | 'changedSince'
  /** Taking it back would give a sheet a name another sheet has. */
  | 'sheetNameTaken'
  | 'reverseNotAccepted'
  | 'tooMuchToTakeBack'
  | 'builtOnAnotherRevision'
  | 'stepToReverseNotMadeHere'
  | 'reverseOfStepNeverKnown'
  | 'noSheetLeft'
  | 'historyDoesNotMatch';

/** Why a request of syncing about an edit is refused, besides the operations' own refusals. */
export type QueueRefusal =
  /** The session has stopped (`nextStep.kind === 'stop'`). */
  | 'syncStopped'
  /** An edit queued or confirmed already has the op id. */
  | 'opIdInUse'
  /** Rows, columns or sheets moved (by a move or a sort) among other edits of one request. */
  | 'moveAmongSeveralEdits'
  /** The edit would leave the workbook holding more cells than it may (500 000). */
  | 'tooManyCells'
  /** The edit would leave more than 1000 cells with a default value, and more than there were. */
  | 'tooManyCellsWithADefaultValue'
  /** `receiveLinesOfTableFile`: the lines do not read as a table file. */
  | 'tableFileUnreadable';

/**
 * Why a pivot table edit (`insertPivotTable`, `changePivotTable`) is refused,
 * besides an unknown sheet, row or column. `readValuesToFilterPivotTableBy`
 * refuses with `pivotTableSourceHasNoHeader` and `pivotTableSourceHasNoRecords`.
 */
export type PivotTableRefusal =
  /** The new sheet's name cannot be a sheet's. */
  | 'sheetNameNotAllowed'
  | 'noPivotTableAtTheCell'
  /** No table of the source sheet has its header on the source's header row. */
  | 'pivotTableSourceHasNoHeader'
  | 'pivotTableColumnNotOfSource'
  | 'pivotTableWouldReadItself'
  | 'pivotTableWouldTouchATable'
  /** A cell where the pivot table would go is not empty. */
  | 'pivotTableCellsInTheWay'
  /** It would spill past the sheet's last row or column. */
  | 'tooManyRows'
  | 'tooManyColumns'
  | 'pivotTableFormulaInTheWay'
  | 'pivotTableWouldBeReadByAnother'
  | 'pivotTableTooLarge'
  | 'pivotTableWithColumnsTakesOneValue'
  | 'pivotTableSourceHasNoRecords'
  | 'pivotTableSourceHasSectionsOrSubtotals'
  /** The source's records cannot be told apart (merged cells among them, or the header again). */
  | 'pivotTableSourceRecordsNotClear'
  | 'pivotTableTotalNeedsNumbers'
  | 'pivotTablePeriodNeedsDates'
  | 'pivotTableFilterValueCannotBeWritten';

/** Why an edit is refused for an interactive view, or for a sheet that shows one. */
export type InteractiveRefusal =
  /** No sheet shows the view as an interactive one. */
  | 'unknownInteractive'
  /** A cell written is not one the view keeps a value for. */
  | 'cellIsNotTheInteractives'
  /** A cell written holds more than a plain value. */
  | 'cellHoldsMoreThanAValue'
  | 'valueDoesNotFitCell'
  | 'textTooLong'
  /** Saving the inputs' values would make the view too large. */
  | 'interactiveSavesTooMuch'
  /** An edit would change the grid of a sheet that shows an interactive view. */
  | 'sheetIsAnInteractive'
  /** A placement would show an interactive view: a sheet shows one in place of its grid instead. */
  | 'viewIsAnInteractive'
  /** The sheet setting `interactive` names a view with no interactive element. */
  | 'viewIsNoInteractive'
  /** The sheet setting `interactive` set on a sheet that holds cells. */
  | 'sheetForInteractiveIsNotEmpty';

/** Why `moveColumnsOfCells` is refused, besides an unknown sheet, row or column. */
export type MoveColumnsOfCellsRefusal =
  /** A column moved, or the one to move after, is not among the cells. */
  | 'movedColumnOutsideTheCells'
  | 'mergedRangeAmongMovedColumnsOfCells'
  | 'columnOutOfSightAmongMovedColumnsOfCells'
  | 'spilledValuesAmongMovedColumnsOfCells';

/** Why `saveNamedView` or `removeNamedView` is refused, besides an unknown sheet or column. */
export type NamedViewRefusal =
  | 'nameOfNamedViewNotAllowed'
  | 'nameOfNamedViewTaken'
  | 'tooManyNamedViews'
  | 'unknownNamedView'
  | 'tooManyTestsInNamedView'
  | 'tooManyKeysInNamedView'
  | 'namedViewTooLarge'
  | 'valueInNamedViewNotAllowed';

/** Why `setDefaultValuesAndLimits` is refused, or a cell edit once made. */
export type DefaultsRefusal =
  | 'limitIsNoNumber'
  | 'minimumAboveMaximum'
  /** A default value typed that is not a plain value (a formula, say). */
  | 'defaultValueNotPlain'
  /** A default value for a cell with a dropdown that is none of its options. */
  | 'defaultValueIsNoOption'
  | 'defaultValueTooLong'
  | 'defaultValueOutsideLimits'
  /** A cell with limits given a value that is neither a number within them nor a formula. */
  | 'valueOutsideLimits';

/** Why `saveNamedRange` or `removeNamedRange` is refused, besides an unknown sheet. */
export type NamedRangeRefusal =
  | 'unknownNamedRange'
  | 'tooManyNamedRanges'
  /** The address is not one reference to cells. */
  | 'addressOfNamedRangeNamesNoCells'
  | 'nameOfNamedRangeNotAllowed'
  | 'nameOfNamedRangeTaken';

/**
 * Why `saveProtection` or `removeProtection` is refused, and why an edit, an
 * undo or a redo is, under protections held against the person
 * (`receivePerson`).
 */
export type ProtectionRefusal =
  | 'unknownProtection'
  | 'tooManyProtections'
  | 'tooManyEditorsOfProtection'
  | 'tooManyOpenRangesInProtection'
  /** A protection held against the person, saved or removed. */
  | 'protectionNotTheirsToChange'
  /** A protection saved that leaves out the person saving it (anyone but the owner). */
  | 'protectionLeavesOutWhoeverSetsIt'
  /** What changes a protected sheet itself, or deletes, hides or shows it. */
  | 'sheetProtected'
  /** Cells of a protected range, or of a protected sheet outside its open ranges. */
  | 'cellsProtected'
  /** Lines inserted within, deleted from, moved out of or sorted among a protected range's. */
  | 'linesProtected';

/** Why an edit of a connected table, or of its sheet, is refused. */
export type ConnectedTableRefusal =
  | 'notAConnectedTable'
  /** Cells, rows or formats of a connected table's sheet, which come from its records. */
  | 'sheetIsAConnectedTable'
  /** A column added with nothing it shows. */
  | 'columnNotDescribed'
  /** A formula naming a connected table's cells by their address, not by its columns. */
  | 'connectedTableNamedByAddress'
  | 'argumentsNotAJsonObject'
  /** A placeholder other than `{{cursor}}` in a follow-up's texts. */
  | 'placeholderNotAllowed'
  | 'fieldShownTwice'
  | 'fieldReadAsDropdown'
  | 'nameOfColumnNotAllowed'
  | 'nameOfColumnTaken'
  | 'nameOfFieldNotAllowed'
  | 'tooManyConnectedTables';

/** Why hiding a sheet, or deleting lines, would leave none. */
export type NothingLeftRefusal =
  /** Hiding or deleting the last sheet shown. */
  | 'noShownSheetLeft'
  /** Deleting every row, or every column, of a sheet. */
  | 'noRowLeft'
  | 'noColumnLeft';

/**
 * Every refusal the engine is known to answer with. Edits and reads add
 * refusals of their own (`unknownSheet`, `sheetNameTaken`, `noCellsToSort`, …);
 * those are told as plain strings where their kinds are not listed here.
 */
export type Refusal =
  | OpRefusal
  | TakeBackRefusal
  | QueueRefusal
  | PivotTableRefusal
  | InteractiveRefusal
  | MoveColumnsOfCellsRefusal
  | NamedViewRefusal
  | DefaultsRefusal
  | NamedRangeRefusal
  | ProtectionRefusal
  | ConnectedTableRefusal
  | NothingLeftRefusal;

/** A refused request. */
export interface Refused<R extends string = string> {
  kind: 'refused';
  refusal: R;
}

/** Why a synced session stops: it takes no more edits, and its next step stays `stop`. */
export type StopReason =
  /** An edit or load page written in a format version the engine does not know (a newer one). */
  | 'unknownFormatVersion'
  /** A load page written in a format version the engine no longer reads. */
  | 'formatVersionNoLongerTaken'
  /** A load page whose operations cannot be read or applied. */
  | 'unreadableLoad';

/** What went wrong with another's edit: the workbook is loaded again (`fetchLoadPage`). */
export type Fault = 'streamedEditRefused' | 'streamedEditUnreadable';
