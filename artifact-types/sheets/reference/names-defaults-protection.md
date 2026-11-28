## Sheets: named ranges, default values, protection and hidden sheets

Four more things a workbook keeps beside its cells. Each is set with edits of an `applyEdits` and shown by reads, next to the ones in core.md. A sheet is named by its name, in any capitals, and what you set holds for everyone who opens the Sheet.

```
open-artifact update <root> '{"kind":"applyEdits","base":1,"edits":[
  {"kind":"writeCells","sheet":"Plan","topLeft":"A1","rows":[["Price","Seats"],[40,8],[55,3]]},
  {"kind":"saveNamedRange","name":"Prices","sheet":"Plan","range":"A2:A3"},
  {"kind":"setDefaultValues","sheet":"Plan","range":"B2:B3","defaultValue":4,"limits":{"minimum":1,"maximum":20}},
  {"kind":"saveProtection","sheet":"Plan","range":"A1:B1"}]}'
  → {"revision":2}
open-artifact read <root> '{"kind":"readSheets"}'
  → {"revision":2,"sheets":[{"name":"Plan",…,"protections":[{"protectionId":"…","protects":"A1:B1","editors":["…"]}]}],
     "namedRanges":[{"name":"Prices","address":"Plan!A2:A3"}],…}
open-artifact read <root> '{"kind":"readCellsChangedFromTheirDefaults","sheet":"Plan"}'
  → {"revision":2,"sheet":"Plan","cells":[{"cell":"B2","holds":"8","defaultValue":"4"},{"cell":"B3","holds":"3","defaultValue":"4"}]}
```

### Named ranges

- `saveNamedRange {name, sheet, range}` names some cells, and a formula can then use the name where it would use their address: `=SUM(Prices)`. `range` is cells (`A2:A9`), whole columns (`A:B`) or whole rows (`2:3`), never with a sheet name or `$` signs.
- A FORMULA ONLY FINDS A NAME THAT ALREADY EXISTS. Save the name first: earlier in the same `applyEdits`, or in an update before it. A formula written before its name shows `#NAME?`, and keeps showing it after the name is saved until the formula is written again.
- Capitals do not tell two names apart. To point a name at other cells, or to rename it, send `saveNamedRange` with `"inPlaceOf"` set to the name it has now. A formula holds the name itself, not its words, so after a rename the formulas that used it read the new name and go on working: leave them as they are.
- `removeNamedRange {name}` deletes a name, and every formula that used it then reads `#REF!` where the name was and shows `#REF!`. Saving a name of the same words again does not mend them: they must be written again. If you know of such formulas, say which before you delete it.
- `readNamedRanges {}` gives each name and the address it stands for now; `readSheets` lists them as well, under `namedRanges`, if the workbook has any. A `null` address means the cells it stood for were deleted.
- A name the workbook does not have is refused with `namedRangeIsGone`, and the refusal says which names it does have.
- In the page, people see and edit the names in the Named ranges pane.

### Default values and limits

- `setDefaultValues {sheet, range, defaultValue?, limits?}` gives every cell of `range` a value it can return to, `defaultValue` (a number, or text written the way a person types it into the cell), and the smallest and largest number it accepts, `limits` (`{"minimum":0,"maximum":100}`, where either may be `null`). Give one of the two or both; `null` for either removes it.
- Limits make a cell turn away any number below the minimum or above the maximum, whether you write it (`valueOutsideLimits`) or a person types it. A default value that falls outside the limits is refused with `defaultValueOutsideLimits`.
- `resetToDefaultValues {sheet, range?}` puts the default values back in those cells, or across the whole sheet when there is no `range`. A cell with no default value keeps what it holds.
- `readCellsChangedFromTheirDefaults {sheet}` gives each cell whose content is not its default value: the cells a reset would change.
- An interactive panel's Save as default and Reset buttons in the page work on these same default values.

### Protection

- `saveProtection {sheet, range?, open?, editors?}` lets only `editors` change some cells; to everyone else they are read-only. Given a `range`, it guards those cells. Without one, it keeps the whole sheet except the ranges listed in `open` (`["B2:C9","5:6"]`), which anyone may still edit. Give `range` or `open`, not both.
- `editors` lists person ids, the way `readSheets` gives them under a protection's `editors`. Without it, only the person you act for may edit. Whoever sets a protection is always one of its editors, so a list without them is refused with `protectionLeavesOutWhoeverSetsIt`.
- Changing a protection means sending `saveProtection` again, with its `protectionId` from `readSheets` and the whole of the new protection, not only what changes. `removeProtection {sheet, protectionId}` deletes it. A `protectionId` the sheet does not have is refused with `protectionIsGone`.
- In `readSheets`, each of a sheet's `protections` gives `protects` (`"sheet"`, or the range it keeps), `open` (for a whole sheet, the ranges left open) and `editors`.
- Protect only what the person asked you to, and tell them who can still edit it.

### Hidden sheets

- `setSheetSettings` with `"settings":{"isHidden":true}` takes a sheet's tab out of view for everyone; `false` brings it back. Formulas go on reading a hidden sheet, and `readSheets` marks it `"isHidden":true`.
- At least one sheet stays in view: hiding the last one that shows is refused with `noShownSheetLeft`.
