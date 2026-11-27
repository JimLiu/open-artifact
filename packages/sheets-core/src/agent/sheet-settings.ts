/**
 * setSheetSettings as the agent sends it: a sheet's frozen rows and columns, its gridlines, and whether its tab is
 * hidden. Rows and columns come as the agent writes them (a row number, a column's letters) and go to the engine as
 * ids; the engine keeps one sheet in view and refuses to hide the last (noShownSheetLeft).
 */

import { type EngineMessage, isObject } from './engine.ts';
import { AgentError } from './errors.ts';
import { checkKeys, type SheetView } from './workbook.ts';

/** How each setting reads its value: the engine's value, or a throw that says what the setting takes. */
const SETTING_READERS: Readonly<Record<string, (value: unknown, view: SheetView) => unknown>> = {
  lastFrozenRow: (value, view) => {
    if (value === null) return null;
    const row = typeof value === 'number' && Number.isInteger(value) ? view.rowIds[value - 1] : undefined;
    if (row === undefined) throw new AgentError('unreadableEdit', 'lastFrozenRow is a row number, or null to unfreeze.');
    return row;
  },
  lastFrozenColumn: (value, view) => (value === null ? null : view.columnIds[view.columns(value, 'lastFrozenColumn')[0]]),
  areGridlinesHidden: (value) => trueOrFalse(value, 'areGridlinesHidden'),
  isHidden: (value) => trueOrFalse(value, 'isHidden'),
};

const SETTING_NAMES = Object.keys(SETTING_READERS).join(', ');

function trueOrFalse(value: unknown, name: string): boolean {
  if (value === true || value === false) return value;
  throw new AgentError('unreadableEdit', `${name} is true or false.`);
}

/** The engine's setSheetSettings for this edit of the sheet that `sheetOf` picks (once the edit's keys are checked). */
export function sheetSettingsEdit(edit: EngineMessage, sheetOf: () => SheetView): EngineMessage {
  checkKeys(edit, ['sheet', 'settings']);
  const view = sheetOf();
  const given = edit.settings;
  if (!isObject(given)) {
    throw new AgentError('unreadableEdit', 'settings is {"lastFrozenRow"?: number|null, "lastFrozenColumn"?: "A"|null, "areGridlinesHidden"?: true|false, "isHidden"?: true|false}.');
  }
  const names = Object.keys(given);
  if (names.length === 0) throw new AgentError('unreadableEdit', `settings names at least one of ${SETTING_NAMES}.`);
  const settings: EngineMessage = {};
  for (const name of names) {
    const reader = Object.hasOwn(SETTING_READERS, name) ? SETTING_READERS[name] : undefined;
    if (!reader) throw new AgentError('unreadableEdit', `settings takes no "${name}": ${SETTING_NAMES}.`);
    settings[name] = reader(given[name], view);
  }
  return { kind: 'setSheetSettings', sheetId: view.sheetId, settings };
}
