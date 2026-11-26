/**
 * A host accent as custom properties, and what to do when a theme is missing.
 *
 * Platform neutral: no DOM. The Shell and the page runtime both apply {@link hostThemePatch}
 * so a cleared theme cannot leave a previous inline colour behind.
 */

/** Inline custom properties a host accent sets, and that a cleared accent must remove. */
export const HOST_ACCENT_VARS = ['--open-artifact-accent', '--open-artifact-accent-fg', '--open-artifact-accent-soft'] as const;

export type HostAccentVar = (typeof HOST_ACCENT_VARS)[number];

/** `#rrggbb` in lowercase, or `null` when `accent` is missing or not that form. */
export function normalizeHostAccent(accent: string | null | undefined): string | null {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return null;
  return accent.toLowerCase();
}

/**
 * The CSS variables a host accent sets (`--open-artifact-accent`, its text colour and soft tint).
 * Empty when there is no accent or it is not `#rrggbb`: the caller removes {@link HOST_ACCENT_VARS}
 * instead of leaving the previous inline values.
 */
export function accentVars(accent: string | null): Partial<Record<HostAccentVar, string>> {
  const color = normalizeHostAccent(accent);
  if (!color) return {};
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return {
    '--open-artifact-accent': color,
    '--open-artifact-accent-fg': luminance > 0.4 ? '#0b1220' : '#ffffff',
    '--open-artifact-accent-soft': `${color}1f`,
  };
}

/**
 * What a host theme does to the document root. `scheme: null` removes `data-theme`.
 * `remove` is the accent properties that must go: when the theme or the accent is missing this is
 * every {@link HOST_ACCENT_VARS} name, not an empty `set` for the caller to ignore.
 * `light` and `dark` are both real schemes; this never picks light as a fallback.
 */
export interface HostThemePatch {
  scheme: 'light' | 'dark' | null;
  set: Partial<Record<HostAccentVar, string>>;
  remove: readonly HostAccentVar[];
}

/** `theme` omitted, or without a `light` / `dark` scheme, clears the pin. A bad accent clears the three variables. */
export function hostThemePatch(theme: { scheme?: unknown; accent?: unknown } | null | undefined): HostThemePatch {
  if (!theme || (theme.scheme !== 'light' && theme.scheme !== 'dark')) {
    return { scheme: null, set: {}, remove: HOST_ACCENT_VARS };
  }
  const set = accentVars(typeof theme.accent === 'string' ? theme.accent : null);
  return {
    scheme: theme.scheme,
    set,
    remove: HOST_ACCENT_VARS.filter((name) => set[name] === undefined),
  };
}

/** The root the Shell or the page paints. Structural so this module does not call DOM APIs itself. */
export interface HostThemeRoot {
  dataset: { theme?: string };
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

/**
 * Pins or clears `data-theme` and the accent properties. Does not set `color-scheme`: the page
 * keeps supporting light and dark through its own stylesheet.
 */
export function applyHostTheme(root: HostThemeRoot, theme: { scheme?: unknown; accent?: unknown } | null | undefined): void {
  const patch = hostThemePatch(theme);
  if (patch.scheme === null) delete root.dataset.theme;
  else root.dataset.theme = patch.scheme;
  for (const name of patch.remove) root.style.removeProperty(name);
  for (const name of HOST_ACCENT_VARS) {
    const value = patch.set[name];
    if (value !== undefined) root.style.setProperty(name, value);
  }
}
