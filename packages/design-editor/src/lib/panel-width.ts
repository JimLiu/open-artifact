/**
 * The side panel's width presets. A click (or Enter) on the resize grip
 * steps through them: the default width, the widest, the narrowest, then
 * the width last dragged by hand if it is none of those.
 */

export interface PanelWidths {
  default: number;
  min: number;
  max: number;
  /** The width last dragged to, when it was not a preset. */
  custom: number | null;
}

const clampTo = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The preset widths in the order a click steps through them (duplicates dropped). */
export function panelPresets(widths: PanelWidths): number[] {
  const list = [widths.default, widths.max, widths.min];
  if (widths.custom !== null) list.push(widths.custom);
  return [...new Set(list.map((width) => clampTo(Math.round(width), widths.min, widths.max)))];
}

/** The width after `current`; a width that is no preset goes to the widest. */
export function nextPanelWidth(current: number, widths: PanelWidths): number {
  const presets = panelPresets(widths);
  const at = presets.indexOf(Math.round(current));
  if (at < 0) return clampTo(widths.max, widths.min, widths.max);
  return presets[(at + 1) % presets.length]!;
}

/** Whether a dragged width is one of the fixed presets (and so not kept as the custom one). */
export function isFixedPreset(width: number, widths: Omit<PanelWidths, 'custom'>): boolean {
  const rounded = Math.round(width);
  return rounded === widths.default || rounded === Math.round(widths.max) || rounded === widths.min;
}
