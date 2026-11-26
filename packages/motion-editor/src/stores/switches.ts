/** On/off choices this browser keeps between visits, each under its own key. Reads fall back when storage is off. */

export function parseSwitch(text: string | null, fallback: boolean): boolean {
  return text === 'on' ? true : text === 'off' ? false : fallback;
}

export function readSwitch(key: string, fallback: boolean): boolean {
  try {
    return parseSwitch(globalThis.localStorage?.getItem(key) ?? null, fallback);
  } catch {
    return fallback;
  }
}

export function writeSwitch(key: string, on: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, on ? 'on' : 'off');
  } catch {
    // Storage off or full: the choice lasts this visit only.
  }
}
