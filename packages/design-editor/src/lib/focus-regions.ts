/**
 * F6 moves the focus between the editor's regions, ⇧F6 back; past the last
 * it wraps to the first. Escape in the selection bar brings the focus home
 * to the canvas. Pure: the page says which regions are showing and where
 * the focus is.
 */

/** The regions in order: the top cards, the tools, the canvas (home), the selection bar, find, the agent composer, the side panel. */
export const REGION_ORDER = ['top', 'tools', 'canvas', 'selection', 'find', 'composer', 'panel'] as const;
export type RegionId = (typeof REGION_ORDER)[number];

/** Where the focus goes home to. */
export const HOME_REGION: RegionId = 'canvas';

/** The attribute that marks a region's root. */
export const REGION_ATTRIBUTE = 'data-focus-region';

export interface RegionPress {
  key: string;
  /** ⌘ or Ctrl. */
  meta: boolean;
  shift: boolean;
  alt: boolean;
  repeat?: boolean;
}

/** F6 steps forward, ⇧F6 back (Alt does not matter; a held key steps once). */
export function regionStepOf(press: RegionPress): 'forward' | 'back' | null {
  if (press.key !== 'F6' || press.meta || press.repeat) return null;
  return press.shift ? 'back' : 'forward';
}

/**
 * The region after (or before) `current` among those `showing`, wrapping
 * around; from outside every region, the one after home. `null` when none
 * other is showing.
 */
export function nextRegion(showing: ReadonlySet<RegionId>, current: RegionId | null, step: 'forward' | 'back'): RegionId | null {
  const from = REGION_ORDER.indexOf(current ?? HOME_REGION);
  const count = REGION_ORDER.length;
  const by = step === 'forward' ? 1 : -1;
  for (let i = 1; i <= count; i++) {
    const id = REGION_ORDER[(from + by * i + count * 2) % count]!;
    if (showing.has(id) && id !== current) return id;
  }
  return null;
}

/**
 * True when Escape brings the focus home: a bare Escape in the selection
 * bar, not in a field and not on a control whose list is open.
 */
export function escapeGoesHome(press: RegionPress, at: { region: RegionId | null; inField: boolean; expanded: boolean }): boolean {
  if (press.key !== 'Escape' || press.meta || press.shift || press.alt) return false;
  return at.region === 'selection' && !at.inField && !at.expanded;
}
