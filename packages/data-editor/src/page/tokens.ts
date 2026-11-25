import { DASH_CLAUDE_TOKEN_ALIASES, DASH_ROOT_SELECTOR, dashChartToken } from '@open-artifact/data-core';

type TokenTheme = Readonly<Record<string, string>>;

export const DEFAULT_FONT_SANS =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const DEFAULT_FONT_SERIF = "ui-serif, Georgia, 'Times New Roman', serif";
export const DEFAULT_FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const LIGHT_CHARTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DARK_CHARTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];

const chartTokens = (colors: readonly string[]): Record<string, string> =>
  Object.fromEntries(colors.map((color, index) => [dashChartToken(index + 1), color]));

/** The tokens that do not change with the theme. */
export const PAGE_BASE_TOKENS: TokenTheme = {
  '--font-sans': DEFAULT_FONT_SANS,
  '--font-serif': DEFAULT_FONT_SERIF,
  '--font-mono': DEFAULT_FONT_MONO,
  '--dash-radius': '0.5rem',
  '--dash-font-size-caption': '0.75rem',
  '--dash-font-size-body': '0.875rem',
  '--dash-font-size-heading': '0.9375rem',
  '--dash-font-size-title': '1.375rem',
  '--dash-font-weight-medium': '500',
  '--dash-gap-xs': '0.5rem',
  '--dash-gap-sm': '0.75rem',
  '--dash-gap-md': '1rem',
  '--dash-gap-lg': '1.75rem',
  '--dash-gap-xl': '2.5rem',
  '--dash-pad-xs': '0.375rem',
  '--dash-pad-sm': '0.5rem',
  '--dash-pad-md': '0.75rem',
  '--dash-pad-lg': '1rem',
  '--dash-pad-xl': '1.5rem',
  '--dash-dur-fast': '60ms',
  '--dash-dur-slow': '0.45s',
  '--dash-ease-out': 'cubic-bezier(0.165, 0.84, 0.44, 1)',
};

export const PAGE_LIGHT_TOKENS: TokenTheme = {
  '--color-bg': '#f9f9f7',
  '--color-panel': '#ffffff',
  '--color-fg': '#0b0b0b',
  '--color-fg-muted': '#898781',
  '--color-fg-secondary': '#52514e',
  '--color-border-line': 'rgb(11 11 11 / 0.1)',
  '--color-ok': '#006300',
  '--color-warn': '#734500',
  '--color-bad': '#8e2626',
  '--dash-page-bg': '#f9f9f7',
  '--dash-surface-panel': '#ffffff',
  '--dash-surface-popover': '#ffffff',
  '--dash-text-primary': '#0b0b0b',
  '--dash-text-secondary': '#52514e',
  '--dash-text-muted': '#898781',
  '--dash-text-success': '#006300',
  '--dash-text-warning': '#734500',
  '--dash-text-danger': '#8e2626',
  '--dash-border': 'rgb(11 11 11 / 0.1)',
  '--dash-shadow-popover': '0 8px 24px #0000001f, 0 2px 6px #00000014',
  '--dash-chart-axis': '#c3c2b7',
  '--dash-chart-grid': 'rgb(11 11 11 / 0.1)',
  '--dash-chart-muted': '#c3c2b7',
  '--dash-chart-reference': '#898781',
  '--dash-chart-critical': '#d03b3b',
  ...chartTokens(LIGHT_CHARTS),
};

export const PAGE_DARK_TOKENS: TokenTheme = {
  '--color-bg': '#0b0b0b',
  '--color-panel': '#1a1a19',
  '--color-fg': '#f0efec',
  '--color-fg-muted': '#898781',
  '--color-fg-secondary': '#c3c2b7',
  '--color-border-line': 'rgb(255 255 255 / 0.1)',
  '--color-ok': '#0ca30c',
  '--color-warn': '#db9300',
  '--color-bad': '#ec7e7e',
  '--dash-page-bg': '#0b0b0b',
  '--dash-surface-panel': '#1a1a19',
  '--dash-surface-popover': '#20201f',
  '--dash-text-primary': '#f0efec',
  '--dash-text-secondary': '#c3c2b7',
  '--dash-text-muted': '#898781',
  '--dash-text-success': '#0ca30c',
  '--dash-text-warning': '#db9300',
  '--dash-text-danger': '#ec7e7e',
  '--dash-border': 'rgb(255 255 255 / 0.1)',
  '--dash-shadow-popover': '0 8px 24px #00000052, 0 2px 6px #0003',
  '--dash-chart-axis': '#383835',
  '--dash-chart-grid': 'rgb(255 255 255 / 0.1)',
  '--dash-chart-muted': '#5f5e5a',
  '--dash-chart-reference': '#97958d',
  '--dash-chart-critical': '#d03b3b',
  ...chartTokens(DARK_CHARTS),
};

/**
 * The claude.ai names of the tokens, each set to its token here. Written once on the root: `var()` resolves there,
 * after the theme and `dash/look` have set the token, so an alias follows both.
 */
export const PAGE_ALIAS_TOKENS: TokenTheme = Object.fromEntries(
  Object.entries(DASH_CLAUDE_TOKEN_ALIASES).map(([alias, token]) => [alias, `var(${token})`]),
);

const declarations = (tokens: TokenTheme): string =>
  Object.entries(tokens)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');

const rule = (selector: string, body: string): string => `${selector}{${body}}`;

/**
 * The default tokens on `#dash-root`: light unless the mode (or, with no mode, the system) is dark, light in print.
 * `dash/look` (written after these) overrides them with rules of the same reach.
 */
export function getDefaultTokenCss(): string {
  const root = DASH_ROOT_SELECTOR;
  const dark = declarations(PAGE_DARK_TOKENS);
  return (
    rule(root, `${declarations(PAGE_BASE_TOKENS)};${declarations(PAGE_LIGHT_TOKENS)};${declarations(PAGE_ALIAS_TOKENS)};color-scheme:light`) +
    `@media screen{${rule(`html[data-mode="dark"] ${root}`, `${dark};color-scheme:dark`)}}` +
    `@media screen and (prefers-color-scheme:dark){${rule(`html:not([data-mode]) ${root}`, `${dark};color-scheme:dark`)}}`
  );
}

/** The page's own base rules: its text, its gutter, link underlines on one-writer pages, skeletons, and the notes. */
export const PAGE_BASE_CSS = [
  `${DASH_ROOT_SELECTOR}{color:var(--color-fg);font-family:var(--font-sans);font-size:var(--dash-font-size-body,14px);line-height:1.45}`,
  `:where(${DASH_ROOT_SELECTOR}:not(:empty)){padding:var(--dash-gutter,clamp(var(--dash-pad-md),4%,var(--dash-pad-xl)))}`,
  `${DASH_ROOT_SELECTOR} [data-step],${DASH_ROOT_SELECTOR} [data-size]{--dash-radius:inherit;--dash-pad-xs:inherit;--dash-pad-sm:inherit;--dash-pad-md:inherit;--dash-pad-lg:inherit;--dash-pad-xl:inherit;--dash-font-size-caption:inherit;--dash-font-size-body:inherit}`,
  `:where(${DASH_ROOT_SELECTOR}[data-dash-one-writer] a[href]:not([role])){text-underline-offset:.15em;text-decoration:underline}`,
  `.dash-select{appearance:none;border:1px solid var(--color-border-line);border-radius:var(--dash-radius);background:var(--color-panel) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 20 20'%3E%3Cpath fill='%23808080' d='M14.128 7.165a.502.502 0 0 1 .744.67l-4.5 5-.078.07a.5.5 0 0 1-.666-.07l-4.5-5-.06-.082a.501.501 0 0 1 .729-.656l.075.068L10 11.752z'/%3E%3C/svg%3E") no-repeat right .5em center;max-width:100%;color:var(--color-fg);font:inherit;text-overflow:ellipsis;padding:.35em 2em .35em .75em}`,
  '.dash-select:disabled{opacity:.55}',
  '.dash-skeleton{-webkit-text-fill-color:transparent!important}',
  '.dash-skeleton,.dash-skeleton:before{background-image:linear-gradient(color-mix(in srgb,currentColor 13%,transparent) 0 0)!important}',
  '.dash-skeleton>*{visibility:hidden!important}',
  '.dash-skeleton:empty:before{content:"";width:3ch;display:inline-block}',
  '.dash-skeleton:not(:empty,:has(>:not(span,small,b,strong,em,i,sup,sub))){background-image:none!important}',
  '.dash-skeleton:not(:empty,:has(>:not(span,small,b,strong,em,i,sup,sub))):before{vertical-align:-.1em;border-radius:.3em;width:5ch;height:.9em;margin-inline-end:-1em;content:""!important;display:inline-block!important}',
  '.dash-notes{flex-direction:column;gap:4px;padding:8px 16px 12px;display:flex}',
  '.dash-note{overflow-wrap:anywhere;color:var(--color-fg-muted);font-size:12px;line-height:16px;margin:0}',
].join('');

/** The default tokens and the page's base rules, as one `<style>` text. */
export function getPageStyleCss(): string {
  return getDefaultTokenCss() + PAGE_BASE_CSS;
}
