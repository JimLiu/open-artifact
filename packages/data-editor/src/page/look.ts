import type { AppliedLook, LookSize } from '@open-artifact/data-core';
import { applyDashboardLook, parseDashboardLook } from '@open-artifact/data-core';

export type StyleTextSize = 'small' | 'large';

/**
 * The style tweaks kept in `dash/look` as `tweaks` over the look the agent wrote: a chart palette (a built-in palette's
 * name, or "own" for the type's standard colors), a white light-mode page, corners in px, a font and a text size.
 */
export interface StyleTweaks {
  palette?: string;
  page?: 'white';
  corners?: number;
  font?: string;
  size?: StyleTextSize;
}

export type StyleTweakKey = keyof StyleTweaks;

export interface ChartPalette {
  light: readonly string[];
  dark: readonly string[];
}

export const STYLE_TWEAK_KEYS: readonly StyleTweakKey[] = ['palette', 'page', 'corners', 'font', 'size'];

export const CHART_PALETTES: Readonly<Record<string, ChartPalette>> = {
  Clay: {
    light: ['#d97757', '#3d3929', '#c2b280', '#788c5d', '#6a9bcc', '#8b5d7d', '#c9952b', '#5f6b73'],
    dark: ['#e08363', '#c9c2b3', '#b98e5a', '#93a877', '#7eaddb', '#a97a9b', '#d8a747', '#8d9aa3'],
  },
  Ocean: {
    light: ['#1d4e89', '#2a78d6', '#1b9aaa', '#62b6e6', '#7fd1ae', '#7a4fb8', '#7a8b99', '#d9c8a0'],
    dark: ['#608fcc', '#2f7fe8', '#49b2c2', '#81cffe', '#9deac8', '#a58be8', '#93a3b1', '#edddb6'],
  },
  Meadow: {
    light: ['#2d6a4f', '#52b788', '#a3b43c', '#7a5c3e', '#d99a2b', '#2b8c8c', '#8a8f85', '#a8415b'],
    dark: ['#488166', '#72d0a2', '#d8e983', '#917356', '#f1b454', '#4ea4a4', '#a3a79e', '#c05c73'],
  },
};

export const STYLE_FONTS: Readonly<Record<string, string>> = {
  Serif: 'Georgia, Times New Roman, serif',
  Monospace: 'ui-monospace, Menlo, Consolas, monospace',
};

export const TEXT_SIZE_SCALES: Readonly<Record<StyleTextSize, number>> = { small: 0.9, large: 1.15 };
export const BASE_TEXT_SIZES: Readonly<Record<LookSize, number>> = { caption: 12, body: 14, heading: 15, title: 22 };

/** The type's own colors, standing under the tweaks of a page with no look of its own. */
export const DEFAULT_LIGHT_LOOK: Readonly<Record<string, string>> = {
  ground: '#f9f9f9',
  card: '#ffffff',
  text: '#1a1a1a',
  muted: '#888888',
  border: '#ebebeb',
  good: '#006c10',
  warning: '#794c02',
  bad: '#a42528',
};

export const DEFAULT_DARK_LOOK: Readonly<Record<string, string>> = {
  ground: '#0b0b0b',
  card: '#1f1f1f',
  text: '#efefef',
  muted: '#797979',
  border: '#282828',
  good: '#53c556',
  warning: '#e49c06',
  bad: '#f17778',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const countStyleTweaks = (tweaks: StyleTweaks): number => STYLE_TWEAK_KEYS.filter((key) => tweaks[key] !== undefined).length;

/** The tweaks stored in `dash/look`, each kept only when it is one on offer. */
export function readStyleTweaks(look: unknown): StyleTweaks {
  const { palette, page, corners, font, size } = asRecord(asRecord(look).tweaks);
  return {
    ...(typeof palette === 'string' && (palette === 'own' || Object.hasOwn(CHART_PALETTES, palette)) ? { palette } : {}),
    ...(page === 'white' ? { page } : {}),
    ...(typeof corners === 'number' && Number.isFinite(corners) ? { corners } : {}),
    ...(typeof font === 'string' && Object.hasOwn(STYLE_FONTS, font) ? { font } : {}),
    ...(size === 'small' || size === 'large' ? { size } : {}),
  };
}

/** `dash/look` without its tweaks: the look as the agent wrote it. */
export function withoutStyleTweaks(look: unknown): Record<string, unknown> {
  const { tweaks: _tweaks, ...rest } = asRecord(look);
  return rest;
}

export const hasOwnLook = (look: unknown): boolean => parseDashboardLook(withoutStyleTweaks(look)) !== null;

/**
 * The look with the tweaks laid over it, as a `dash/look` record: without a usable look of its own the type's default
 * colors stand under the tweaks. With no tweaks, the stored look (or null when it has none).
 */
export function applyStyleTweaks(look: unknown, tweaks: StyleTweaks): Record<string, unknown> | null {
  const own = withoutStyleTweaks(look);
  const hasOwn = hasOwnLook(own);
  if (countStyleTweaks(tweaks) === 0) return hasOwn ? own : null;
  const { palette, page, corners, font, size } = tweaks;
  const light: Record<string, unknown> = { ...(hasOwn ? asRecord(own.light) : DEFAULT_LIGHT_LOOK) };
  const dark: Record<string, unknown> = { ...(hasOwn ? asRecord(own.dark) : DEFAULT_DARK_LOOK) };
  if (palette !== undefined) {
    light.charts = [...(CHART_PALETTES[palette]?.light ?? [])];
    dark.charts = [...(CHART_PALETTES[palette]?.dark ?? [])];
  }
  if (page === 'white') light.ground = '#ffffff';
  const fontStack = font === undefined ? undefined : STYLE_FONTS[font];
  const sizes: Partial<Record<LookSize, string>> = (hasOwn ? parseDashboardLook(own)?.sizes : undefined) ?? {};
  return {
    ...(hasOwn ? own : {}),
    light,
    dark,
    ...(corners === undefined ? {} : { corners }),
    ...(size === undefined
      ? {}
      : {
          sizes: Object.fromEntries(
            (Object.entries(BASE_TEXT_SIZES) as [LookSize, number][]).map(([key, base]) => [
              key,
              `${String(Math.round((Number.parseFloat(sizes[key] ?? '') || base) * TEXT_SIZE_SCALES[size] * 2) / 2)}px`,
            ]),
          ),
        }),
    ...(fontStack === undefined ? {} : { fonts: { text: fontStack, display: fontStack } }),
  };
}

/** `dash/look` as the page applies it: the stored look with its tweaks laid over it. */
export function applyStoredLook(stored: unknown): AppliedLook {
  return applyDashboardLook(applyStyleTweaks(stored, readStyleTweaks(stored)));
}

/** A change to the tweaks: a null clears that tweak. */
export type StyleTweakChange = { [K in keyof StyleTweaks]?: StyleTweaks[K] | null };

/** The tweaks with a change laid over them. */
export function mergeStyleTweaks(base: StyleTweaks, change: StyleTweakChange): StyleTweaks {
  const merged: Record<string, unknown> = { ...base, ...change };
  for (const key of STYLE_TWEAK_KEYS) if (merged[key] === null || merged[key] === undefined) delete merged[key];
  return merged as StyleTweaks;
}

/** The change without what the stored tweaks already say; null when nothing is left. */
export function keepChangedTweaks(change: StyleTweakChange, stored: StyleTweaks): StyleTweakChange | null {
  const changed = Object.entries(change).filter(([key, value]) => (value ?? undefined) !== stored[key as StyleTweakKey]);
  return changed.length === 0 ? null : (Object.fromEntries(changed) as StyleTweakChange);
}

/**
 * What stays unsaved once a style save ends: changes made while it ran are kept. After a save, `current` (the change
 * as it is now) loses what the saved tweaks already say; after a failed one, the change that was being saved comes
 * back under it. `before` is the stored tweaks the save started from.
 */
export function styleAfterSave(current: StyleTweakChange | null, saved: StyleTweakChange, before: StyleTweaks, ok: boolean): StyleTweakChange | null {
  if (ok) return current === null ? null : keepChangedTweaks(current, mergeStyleTweaks(before, saved));
  return keepChangedTweaks({ ...saved, ...current }, before);
}

/** The tweaks the page shows: the stored ones with the unsaved change over them. */
export function shownStyleTweaks(look: unknown, pending: StyleTweakChange | null): StyleTweaks {
  return mergeStyleTweaks(readStyleTweaks(look), pending ?? {});
}

/** `dash/look` as the page previews it: the unsaved tweaks in place of the stored ones. */
export function previewLook(look: unknown, pending: StyleTweakChange | null): unknown {
  if (pending === null) return look;
  return { ...asRecord(look), tweaks: shownStyleTweaks(look, pending) };
}
