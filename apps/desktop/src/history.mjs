/**
 * Back and forward over the tabs the person went to, like a browser's history over pages: each tab selected is an
 * entry; going back and forward moves along them; selecting a tab after going back drops what was ahead. A closed tab's
 * entries go (with any two same entries that then meet), so back and forward always land on a tab that is open.
 * Pure: the tests check it without Electron.
 */
export class TabHistory {
  constructor(first) {
    this.entries = [first];
    this.at = 0;
  }

  get current() {
    return this.entries[this.at];
  }

  get canBack() {
    return this.at > 0;
  }

  get canForward() {
    return this.at < this.entries.length - 1;
  }

  /** The person went to `id` (not by back or forward). */
  visit(id) {
    if (this.current === id) return;
    this.entries.splice(this.at + 1);
    this.entries.push(id);
    this.at = this.entries.length - 1;
  }

  /** The entry back; null when there is none. Moves to it. */
  back() {
    if (!this.canBack) return null;
    return this.entries[--this.at];
  }

  forward() {
    if (!this.canForward) return null;
    return this.entries[++this.at];
  }

  /** A tab closed: its entries go. `fallback` is the entry kept when none would be left. */
  remove(id, fallback) {
    const kept = [];
    let at = 0;
    this.entries.forEach((entry, index) => {
      if (entry === id) {
        if (index <= this.at) at = Math.max(0, kept.length - 1);
        return;
      }
      if (kept[kept.length - 1] === entry) {
        if (index <= this.at) at = kept.length - 1;
        return;
      }
      kept.push(entry);
      if (index <= this.at) at = kept.length - 1;
    });
    this.entries = kept.length ? kept : [fallback];
    this.at = Math.min(at, this.entries.length - 1);
  }
}
