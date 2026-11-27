import type { CellWrittenFromAnInteractive } from '@open-artifact/sheets-core';
import type { ChartInputs } from '../chart-frame/messages.ts';
import type { InteractiveRawWrite, InteractiveToPage, PageKeyFromInteractive, PageToInteractive } from '../interactive-frame/messages.ts';
import { parseChartFrameReply } from './frame-messages.ts';

/** What the page gives the writes of one interactive: its port to the frame, the write to the sheet, and a timer. */
export interface InteractiveWritesHost {
  tellFrame(message: PageToInteractive): void;
  /**
   * Writes the cells, made by the person's press numbered `press`; `whenWritten` is called once the sheet has taken
   * them (or turned them down).
   */
  write(cells: CellWrittenFromAnInteractive[], press: number, whenWritten: () => void): void;
  later(act: () => void, ms: number): void;
}

export interface InteractiveWrites {
  inputsAre(next: ChartInputs): void;
  write(cells: InteractiveRawWrite[], nth: number, press?: number): void;
  /** Keeps a write until the press that made it is known to be the person's own, or for a while at most. */
  hold(cells: InteractiveRawWrite[], nth: number, press?: number): void;
  release(): void;
  /** Calls `then` once every write asked for so far has been answered. */
  afterWrites(then: () => void): void;
  end(): void;
}

export const interactiveCellKey = ([input, row, column]: InteractiveRawWrite): string =>
  `${input} ${row} ${column}`;
export const PAGE_KEYS_FROM_INTERACTIVE: readonly PageKeyFromInteractive[] = [
  'leave',
  'nextPart',
  'previousPart',
  'undo',
  'redo',
];
export const MAX_INTERACTIVE_WRITES = 1000;
export const MAX_INTERACTIVE_INDEX = 1e4;
export const MAX_INTERACTIVE_TEXT_LENGTH = 32767;
export const isInteractiveText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_INTERACTIVE_TEXT_LENGTH;
export const isInteractiveIndex = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < MAX_INTERACTIVE_INDEX;

export function isInteractiveWrite(write: unknown): write is InteractiveRawWrite {
  if (!Array.isArray(write)) return false;
  let [input, row, column, value]: unknown[] = write;
  let isValue =
    value === null ||
    typeof value === 'boolean' ||
    isInteractiveText(value) ||
    Number.isFinite(value);
  return (
    isInteractiveText(input) &&
    isInteractiveIndex(row) &&
    isInteractiveIndex(column) &&
    isValue
  );
}

export const areInteractiveWrites = (writes: unknown): writes is InteractiveRawWrite[] =>
  Array.isArray(writes) &&
  writes.length <= MAX_INTERACTIVE_WRITES &&
  Array.from(writes).every(isInteractiveWrite);

export function parseInteractiveFrameReply(reply: unknown): InteractiveToPage | null {
  if (typeof reply !== 'object' || reply === null || !('kind' in reply))
    return null;
  switch (reply.kind) {
    case 'here':
    case 'keyboardLost':
    case 'cellsOffered':
      return {
        kind: reply.kind,
      };
    case 'pressed':
      return 'at' in reply &&
        typeof reply.at === 'number' &&
        Number.isFinite(reply.at)
        ? {
            kind: 'pressed',
            at: reply.at,
          }
        : null;
    case 'keyForPage': {
      let key = PAGE_KEYS_FROM_INTERACTIVE.find(
        (one) => 'key' in reply && one === reply.key,
      );
      return key === undefined
        ? null
        : {
            kind: 'keyForPage',
            key,
          };
    }
    case 'cellShown': {
      let [input, row, column] = [
        'input' in reply && reply.input,
        'row' in reply && reply.row,
        'column' in reply && reply.column,
      ];
      return isInteractiveText(input) &&
        isInteractiveIndex(row) &&
        isInteractiveIndex(column)
        ? {
            kind: 'cellShown',
            input,
            row,
            column,
          }
        : null;
    }
    case 'write': {
      let [cells, nth] = [
        'cells' in reply && reply.cells,
        'nth' in reply && reply.nth,
      ];
      let press = 'press' in reply && reply.press;
      return typeof nth === 'number' &&
        typeof press === 'number' &&
        areInteractiveWrites(cells)
        ? {
            kind: 'write',
            cells: cells.map(
              ([input, row, column, value]): InteractiveRawWrite => [
                input,
                row,
                column,
                value,
              ],
            ),
            nth,
            press,
          }
        : null;
    }
    default:
      return parseChartFrameReply(reply);
  }
}

export const INTERACTIVE_WRITE_SPACING_MS = 250;
export const INTERACTIVE_HELD_WRITE_MS = 1e4;
/** A new sitting of the person's writes in an interactive, for undoing them together: when it starts, and its id if it does. */
export const newInteractiveSitting = (): { atMs: number; idIfSittingStarts: string } => ({
  atMs: Date.now(),
  idIfSittingStarts: crypto.randomUUID(),
});

export function interactiveCellWrite([input, row, column, value]: InteractiveRawWrite): CellWrittenFromAnInteractive {
  let cell = {
    input,
    row,
    column,
  };
  if (value === null)
    return {
      ...cell,
      value,
    };
  if (typeof value === 'number')
    return {
      ...cell,
      value: {
        kind: 'number',
        value,
      },
    };
  if (typeof value === 'boolean')
    return {
      ...cell,
      value: {
        kind: 'boolean',
        value,
      },
    };
  return {
    ...cell,
    value: {
      kind: 'text',
      value,
    },
  };
}

export function createInteractiveWrites(inputs: ChartInputs, host: InteractiveWritesHost): InteractiveWrites {
  let inputsNow = inputs;
  let waiting = new Map<string, InteractiveRawWrite>();
  let isWriting = false;
  let [asked, answered, press] = [0, 0, 0];
  let isEnded = false;
  let afterAllWritten: (() => void)[] = [];
  let tellInputs = (): void => {
    if (!isEnded)
      host.tellFrame({
        kind: 'inputsChanged',
        inputs: inputsNow,
        answered,
      });
    if (answered === asked)
      for (let then of afterAllWritten.splice(0)) then();
  };
  let writeWaiting = (): void => {
    if (isWriting || answered === asked) return;
    let [cells, nth] = [[...waiting.values()], asked];
    waiting.clear();
    if (cells.length === 0) {
      answered = nth;
      tellInputs();
      return;
    }
    isWriting = true;
    let stepsLeft = 2;
    let stepDone = (): void => {
      stepsLeft -= 1;
      isWriting = stepsLeft > 0;
      writeWaiting();
    };
    host.later(stepDone, INTERACTIVE_WRITE_SPACING_MS);
    host.write(cells.map(interactiveCellWrite), press, () => {
      answered = nth;
      tellInputs();
      stepDone();
    });
  };
  let held: [cells: InteractiveRawWrite[], nth: number, press?: number] | null = null;
  let write = (
    cells: InteractiveRawWrite[],
    nth: number,
    pressOfWrite: number = press,
  ): void => {
    held = null;
    press = pressOfWrite;
    for (let cell of cells) waiting.set(interactiveCellKey(cell), cell);
    asked = nth;
    writeWaiting();
  };
  return {
    inputsAre(next) {
      inputsNow = next;
      tellInputs();
    },
    write,
    hold(...hold) {
      held = hold;
      host.later(
        () => held === hold && write([], hold[1]),
        INTERACTIVE_HELD_WRITE_MS,
      );
    },
    release: () => void (held !== null && write(...held)),
    afterWrites: (then) =>
      void (answered === asked ? then() : afterAllWritten.push(then)),
    end() {
      isEnded = true;
    },
  };
}
