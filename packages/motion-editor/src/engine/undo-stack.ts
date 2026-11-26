/** A change made by hand that can be taken back: `undo` and `redo` each write the record as it was or will be. */
export interface UndoEntry {
  label: string;
  /**
   * Each may decline by returning an {@link UndoDeclined}: it then says why, and the entry stays to try again (`keep`)
   * or is dropped. Anything else it returns is ignored.
   */
  undo(): unknown;
  redo(): unknown;
}

/** An undo or redo that changed nothing: what to say instead, and whether the entry stays where it was. */
export interface UndoDeclined {
  said: string;
  keep: boolean;
}

export const MAX_UNDO = 100;

const declinedBy = (result: unknown): UndoDeclined | null =>
  typeof result === 'object' && result !== null && typeof (result as UndoDeclined).said === 'string' ? (result as UndoDeclined) : null;

/** The page's undo history: a new change clears what could be redone. Pure. */
export class UndoStack {
  #done: UndoEntry[] = [];
  #undone: UndoEntry[] = [];
  #declined: UndoDeclined | null = null;
  readonly #max: number;

  constructor(max = MAX_UNDO) {
    this.#max = max;
  }

  push(entry: UndoEntry): void {
    this.#done.push(entry);
    if (this.#done.length > this.#max) this.#done.shift();
    this.#undone = [];
  }

  get canUndo(): boolean {
    return this.#done.length > 0;
  }

  get canRedo(): boolean {
    return this.#undone.length > 0;
  }

  /** Takes back the last change; its entry, or `null` when there is none. */
  undo(): UndoEntry | null {
    const entry = this.#done.pop();
    if (entry === undefined) return null;
    this.#declined = declinedBy(entry.undo());
    if (this.#declined === null) this.#undone.push(entry);
    else if (this.#declined.keep) this.#done.push(entry);
    return entry;
  }

  redo(): UndoEntry | null {
    const entry = this.#undone.pop();
    if (entry === undefined) return null;
    this.#declined = declinedBy(entry.redo());
    if (this.#declined === null) this.#done.push(entry);
    else if (this.#declined.keep) this.#undone.push(entry);
    return entry;
  }

  /** What the last undo or redo said when it declined, else `null`. */
  get declined(): UndoDeclined | null {
    return this.#declined;
  }

  clear(): void {
    this.#done = [];
    this.#undone = [];
  }
}
