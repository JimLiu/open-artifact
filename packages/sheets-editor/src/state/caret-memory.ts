import type { PressesHeardAtStart } from '../app/sheet-page.tsx';
/** Finds the storage of this tab, which may throw where storage is blocked. */
export type StorageOf = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function takeStoredCaretPlace(storageOf: StorageOf, pageStartMs: number, wallNowMs: number, keepsPlaceLeft?: boolean): StoredCaretPlace | null {
  try {
    let storage = storageOf();
    let raw = storage.getItem('sheets-caret');
    storage.removeItem('sheets-caret');
    if (raw === null) return null;
    let stored: unknown = JSON.parse(raw);
    if (!isPlainObjectValue(stored)) return 'outsideCells';
    let { isInCells, isInEntry, leftAtMs, leftAtWallMs } = stored;
    let placeIfLeft: StoredCaretPlace = isInEntry === true ? 'inEntry' : 'outsideCells';
    // Asked to keep it: a place left outside the cells stays stored for the next page.
    if (isInCells === false && keepsPlaceLeft) return (storage.setItem('sheets-caret', raw), placeIfLeft);
    if (isInCells === false && typeof leftAtWallMs === 'number') return leftAtWallMs + 1000 < wallNowMs ? null : placeIfLeft;
    if (isInCells === false) return placeIfLeft;
    if (isInCells !== true) return 'outsideCells';
    if (leftAtMs === undefined) return 'inCells';
    if (typeof leftAtMs !== 'number') return 'outsideCells';
    return leftAtMs >= pageStartMs ? 'inCells' : null;
  } catch {
    return 'outsideCells';
  }
}
export function forgetStoredCaretPlace(storageOf: StorageOf): void {
  try {
    storageOf().removeItem('sheets-caret');
  } catch {}
}
export function keepCaretPlaceStored(storageOf: StorageOf, afterEvents: (run: () => void) => void, page: PageOfCaret): () => void {
  let isStopped: boolean = false;
  let isInCells: boolean | null = null;
  let isInEntry: boolean = false;
  let storedWithoutLeaving: string | null = null;
  let keptBy = Math.random();
  let store = (leftAt?: CaretLeftAt) => {
    if (isInCells === null) return;
    let stored = JSON.stringify({
      isInCells,
      isInEntry,
      ...leftAt,
      keptBy,
    });
    storedWithoutLeaving = leftAt === undefined ? stored : null;
    try {
      storageOf().setItem('sheets-caret', stored);
    } catch {}
  };
  let isStillStored = (stored: string) => {
    try {
      return storageOf().getItem('sheets-caret') === stored;
    } catch {
      return false;
    }
  };
  let storeLeaving = () =>
    store({
      leftAtMs: page.nowMs(),
      leftAtWallMs: page.wallNowMs(),
    });
  let update = () => {
    let isInCellsNow = isStopped ? null : page.isInCells();
    if (isInCellsNow === null) return;
    isInCells = isInCellsNow;
    isInEntry = page.isInEntry();
    store();
  };
  let unsubscribers = [
    page.onMoved((isSettled) => (isSettled ? update() : afterEvents(update))),
    page.onLeftPage(storeLeaving),
    page.onPageEnds(() => {
      if (isInCells === false && storedWithoutLeaving !== null && isStillStored(storedWithoutLeaving)) storeLeaving();
    }),
    page.onCameBackToPage(() => afterEvents(() => (isInCells === null ? undefined : update()))),
    page.onEntryOpenedOrEnded(() => afterEvents(() => (isInCells === null ? undefined : update()))),
  ];
  return () => {
    isStopped = true;
    for (let unsubscribe of unsubscribers) unsubscribe();
  };
}
/** What a key does on a page just opened: F2 opens the entry, Tab and F6 are claimed. */
export function keyActOnOpenedPage(
  keyEvent: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  mayOpenEntry: boolean,
): 'caretToEntry' | 'claimed' | 'nothing' {
  let isPlain = !(keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.shiftKey);
  if (keyEvent.key === 'F2' && isPlain && mayOpenEntry) return 'caretToEntry';
  return CARET_TAB_OR_F6_PATTERN.test(keyEvent.key) ? 'claimed' : 'nothing';
}
export function storeCaretInCells(storageOf: StorageOf): void {
  try {
    storageOf().setItem(
      'sheets-caret',
      JSON.stringify({
        isInCells: true,
        isInEntry: false,
      }),
    );
  } catch {}
}
export const isPlainObjectValue = (candidate: unknown): candidate is Partial<Record<string, unknown>> => typeof candidate === 'object' && candidate !== null;
export const doCellsTakeCaretOnOpen = (storedPlace: CaretAtStart | null, wasHotRestarted: boolean, takesCaretFromOutside: boolean): boolean =>
  storedPlace === 'inSpreadsheetTakenOff' ||
  storedPlace === 'inCells' ||
  storedPlace === 'inEntry' ||
  (storedPlace === 'outsideCells' && takesCaretFromOutside) ||
  (storedPlace === null && !wasHotRestarted);
/** Whether the page took the keyboard from the page it was opened from: a place was kept, and nothing was pressed or had the caret since. */
export const isKeyboardHandedOverOnOpen = (storedPlace: CaretAtStart | null, wasHotRestarted: boolean, pressesHeard: PressesHeardAtStart): boolean =>
  wasHotRestarted && storedPlace !== null && pressesHeard.pressesBegun === 0 && !pressesHeard.hasAnythingHadCaret;
export const shouldFocusEntryOnOpen = (storedPlace: CaretAtStart | null, hasAnyActCome: boolean, isFirstEntryStillOpen: boolean): boolean =>
  storedPlace !== 'inSpreadsheetTakenOff' && (hasAnyActCome || storedPlace === 'outsideCells' || (storedPlace === 'inEntry' && !isFirstEntryStillOpen));
export const CARET_ARROW_KEY_PATTERN = /^Arrow(?:Up|Down|Left|Right)$/;
export const CARET_TAB_OR_F6_PATTERN = /^(?:Tab|F6)$/;
export const isKeyForCellsOnOpen = (
  storedPlace: CaretAtStart | null,
  keyEvent: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  isFirstEntryStillOpen: boolean,
  isHandedOver: boolean,
): boolean => {
  let isMovingKey =
    !(keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) &&
    (CARET_TAB_OR_F6_PATTERN.test(keyEvent.key) || (CARET_ARROW_KEY_PATTERN.test(keyEvent.key) && !keyEvent.shiftKey));
  if (isHandedOver) return !isFirstEntryStillOpen && isMovingKey;
  return (storedPlace !== 'inEntry' && storedPlace !== 'outsideCells') || isFirstEntryStillOpen || isMovingKey;
};
/** Where the caret was when this tab last left the spreadsheet: in the cells, in an entry, or elsewhere. */
export type StoredCaretPlace = 'inCells' | 'inEntry' | 'outsideCells';
/** Where the caret goes as the spreadsheet opens: as stored, or into the cells when the spreadsheet took it off a pane. */
export type CaretAtStart = StoredCaretPlace | 'inSpreadsheetTakenOff';
/** When the caret left the page, by the page's clock and the wall clock. */
export interface CaretLeftAt {
  leftAtMs: number;
  leftAtWallMs: number;
}
/** What the page tells of where its caret is, and when that changes. Each `on…` returns a way to stop listening. */
export interface PageOfCaret {
  isInCells(): boolean | null;
  isInEntry(): boolean;
  onMoved(listener: (isSettled: boolean) => void): () => void;
  onLeftPage(listener: () => void): () => void;
  onPageEnds(listener: () => void): () => void;
  onCameBackToPage(listener: () => void): () => void;
  onEntryOpenedOrEnded(listener: () => void): () => void;
  nowMs(): number;
  wallNowMs(): number;
}
