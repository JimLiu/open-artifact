/**
 * Shortcuts read from the physical key, so they work on any keyboard layout
 * (Shift+1 types `!` on a US layout, `+` on a Swiss one, and a Russian
 * layout puts `с` where C is).
 */

/** What a key press asks of the view, by position on the keyboard. */
export type ZoomKey = 'fit' | 'actual' | 'selection';

interface Press {
  key: string;
  code?: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** Shift+1 fits the page, Shift+0 is 100%, Shift+2 fits the selection. */
export function zoomKeyOf({ key, code, meta, shift, alt }: Press): ZoomKey | null {
  if (meta || alt) return null;
  if (code?.startsWith('Digit')) {
    if (!shift) return null;
    return code === 'Digit1' ? 'fit' : code === 'Digit0' ? 'actual' : code === 'Digit2' ? 'selection' : null;
  }
  return key === '!' ? 'fit' : key === ')' ? 'actual' : key === '@' ? 'selection' : null;
}

/** Shift+Cmd+C (Shift+Ctrl+C): copy the selection as a PNG image. */
export function isCopyPngKey({ key, code, meta, shift, alt }: Press): boolean {
  if (!meta || !shift || alt) return false;
  return code ? code === 'KeyC' : key.toLowerCase() === 'c';
}

/** The letter of a key press: the physical key when it is a letter key. */
const letterOf = ({ key, code }: Pick<Press, 'key' | 'code'>): string => (code?.startsWith('Key') ? code.slice(3).toLowerCase() : key.toLowerCase());

/**
 * ⌘Z undo, ⇧⌘Z redo; elsewhere Ctrl+Y redoes too. By the physical key, so
 * a layout without Latin letters undoes as well; never with Alt.
 */
export function historyShortcutOf(press: Press, apple: boolean): 'undo' | 'redo' | null {
  if (!press.meta || press.alt) return null;
  const letter = letterOf(press);
  if (letter === 'z') return press.shift ? 'redo' : 'undo';
  return letter === 'y' && !press.shift && !apple ? 'redo' : null;
}

/** X takes the fill away, ⇧X swaps fill and stroke (no ⌘, no Alt). */
export function paintKeyOf(press: Press): 'swap' | 'unfill' | null {
  if (press.meta || press.alt || letterOf(press) !== 'x') return null;
  return press.shift ? 'swap' : 'unfill';
}
