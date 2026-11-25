/** `dash/look`: a design system's colors, type and corners, read leniently and applied to `#dash-root` as CSS custom properties. */

export type LookTheme = 'light' | 'dark';
export type LookStatus = 'good' | 'warning' | 'bad';
export type LookSize = 'caption' | 'body' | 'heading' | 'title';

/** One theme's colors after the contrast checks: every value a `#rrggbb` hex. */
export interface LookTone {
  ground: string;
  card: string;
  text: string;
  secondary: string;
  muted: string;
  border: string;
  status: Partial<Record<LookStatus, string>>;
  /** Series colors; a color too faint or too close to an earlier kept one is left out (undefined). */
  charts: (string | undefined)[];
}

export interface DashboardLook {
  tones: Partial<Record<LookTheme, LookTone>>;
  corners?: string;
  sizes: Partial<Record<LookSize, string>>;
  fonts: { text?: string; display?: string };
}

export interface AppliedLook {
  css: string;
  /** The look as applied; `null` when it has no usable ground. */
  look: DashboardLook | null;
  /** The design system's name (`system.name` in `dash/look`). */
  system: string | null;
  /** How many chart colors the page offers: eight, or more when the look sets more. */
  colors: number;
}

export type CssDeclaration = [property: string, value: string | undefined];

export const LOOK_THEMES: readonly LookTheme[] = ['light', 'dark'];
export const LOOK_STATUSES: readonly LookStatus[] = ['good', 'warning', 'bad'];
/** The px range each text size is held to. */
export const LOOK_SIZE_RANGES: Readonly<Record<LookSize, readonly [min: number, max: number]>> = {
  caption: [9, 18],
  body: [11, 22],
  heading: [12, 32],
  title: [16, 64],
};
/** The chart colors a page always offers. */
export const MAX_LOOK_CHARTS = 8;
/** How many `charts` entries of a tone are read at most. */
export const MAX_LOOK_CHART_VALUES = 64;
export const MAX_LOOK_CORNERS = 32;
export const MAX_FONT_FAMILIES = 12;
export const MAX_FONT_STACK_LENGTH = 200;
export const GROUND_LUMINANCE: Readonly<Record<LookTheme, number>> = { light: 0.82, dark: 0.04 };
export const CARD_LUMINANCE: Readonly<Record<LookTheme, number>> = { light: 0.6, dark: 0.08 };
export const DEFAULT_LOOK_TEXT: Readonly<Record<LookTheme, string>> = { light: '#000000', dark: '#ffffff' };
export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;
export const CHART_CONTRAST = 1.5;
export const MIN_CHART_DISTANCE = 7;
export const MIN_BORDER_DISTANCE = 2;
/** The element a look's custom properties are set on. */
export const DASH_ROOT_SELECTOR = '#dash-root';

/**
 * The custom properties a dashboard page reads, which `dash/look` sets: the type's `--color-*` tokens and the
 * dashboard's own `--dash-*` tokens (`--dash-chart-N` for the N-th series color).
 */
export const DASH_PAGE_TOKENS: readonly string[] = [
  '--color-bg',
  '--color-panel',
  '--color-fg',
  '--color-fg-muted',
  '--color-fg-secondary',
  '--color-border-line',
  '--color-ok',
  '--color-warn',
  '--color-bad',
  '--font-sans',
  '--font-serif',
  '--font-mono',
  '--dash-page-bg',
  '--dash-surface-panel',
  '--dash-surface-popover',
  '--dash-text-primary',
  '--dash-text-secondary',
  '--dash-text-muted',
  '--dash-text-success',
  '--dash-text-warning',
  '--dash-text-danger',
  '--dash-border',
  '--dash-radius',
  '--dash-font-size-caption',
  '--dash-font-size-body',
  '--dash-font-size-heading',
  '--dash-font-size-title',
  '--dash-chart-axis',
  '--dash-chart-grid',
  '--dash-chart-muted',
  '--dash-chart-reference',
  '--dash-chart-critical',
];

/** The CSS variable of the N-th (1-based) chart series color. */
export function dashChartToken(index: number): string {
  return `--dash-chart-${index}`;
}

const SPACE_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/**
 * The names the dashboards on claude.ai give the same tokens (`--cds-*`, `--font-anthropic-*`), each with the token it
 * stands for here. `#dash-root` sets every one to its token, so a page written there draws the same here, in either
 * theme and under a look. Other `--cds-*` names are no token here.
 */
export const DASH_CLAUDE_TOKEN_ALIASES: Readonly<Record<string, string>> = {
  '--font-anthropic-sans': '--font-sans',
  '--font-anthropic-serif': '--font-serif',
  '--font-anthropic-mono': '--font-mono',
  '--cds-page-bg': '--dash-page-bg',
  '--cds-surface-panel': '--dash-surface-panel',
  '--cds-surface-popover': '--dash-surface-popover',
  '--cds-text-primary': '--dash-text-primary',
  '--cds-text-secondary': '--dash-text-secondary',
  '--cds-text-muted': '--dash-text-muted',
  '--cds-text-success': '--dash-text-success',
  '--cds-text-warning': '--dash-text-warning',
  '--cds-text-danger': '--dash-text-danger',
  '--cds-border': '--dash-border',
  '--cds-radius': '--dash-radius',
  '--cds-font-size-caption': '--dash-font-size-caption',
  '--cds-font-size-body': '--dash-font-size-body',
  '--cds-font-size-heading': '--dash-font-size-heading',
  '--cds-font-size-title': '--dash-font-size-title',
  '--cds-font-weight-medium': '--dash-font-weight-medium',
  ...Object.fromEntries(SPACE_SIZES.flatMap((size) => [[`--cds-gap-${size}`, `--dash-gap-${size}`], [`--cds-pad-${size}`, `--dash-pad-${size}`]])),
  '--cds-shadow-popover': '--dash-shadow-popover',
  '--cds-dur-fast': '--dash-dur-fast',
  '--cds-dur-slow': '--dash-dur-slow',
  '--cds-ease-out': '--dash-ease-out',
  '--cds-chart-axis': '--dash-chart-axis',
  '--cds-chart-grid': '--dash-chart-grid',
  '--cds-chart-muted': '--dash-chart-muted',
  '--cds-chart-reference': '--dash-chart-reference',
  '--cds-chart-status-critical': '--dash-chart-critical',
  ...Object.fromEntries(Array.from({ length: MAX_LOOK_CHARTS }, (_, index) => [`--cds-chart-categorical-${index + 1}`, dashChartToken(index + 1)])),
};

const GENERIC_FONT_FAMILY_PATTERN =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|-apple-system|blinkmacsystemfont)$/i;
const HEX_COLOR_PATTERN = /^#([0-9a-f]{6})([0-9a-f]{2})?$/;
const LOOK_LENGTH_PATTERN = /^(\d{1,4}(?:\.\d{1,4})?)(px|rem)$/i;
const REM_PX = 16;
const FONT_FAMILY_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,59}$/u;

function asLookRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getLookField(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));
const unitToHexByte = (value: number): string =>
  Math.round(clampUnit(value) * 255)
    .toString(16)
    .padStart(2, '0');
const linearToSrgb = (value: number): number =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
const srgbToLinear = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const hexToRgbUnits = (color: string): [number, number, number] => [
  parseInt(color.slice(1, 3), 16) / 255,
  parseInt(color.slice(3, 5), 16) / 255,
  parseInt(color.slice(5, 7), 16) / 255,
];

/** A CSS number or percentage (of `scale`); `none` is 0. */
function parseCssNumber(value: string, scale: number): number | undefined {
  if (value === 'none') return 0;
  const match = /^(-?\d*\.?\d+(?:e-?\d+)?)(%?)$/.exec(value);
  if (match === null) return undefined;
  return match[2] === '%' ? (Number(match[1]) / 100) * scale : Number(match[1]);
}

/** A CSS hue in degrees, 0–360. */
function parseCssHue(value: string): number | undefined {
  const match = /^(-?\d*\.?\d+)(deg|rad|grad|turn)?$/.exec(value === 'none' ? '0' : value);
  if (match === null) return undefined;
  const factor = match[2] === 'rad' ? 180 / Math.PI : match[2] === 'grad' ? 0.9 : match[2] === 'turn' ? 360 : 1;
  return (((Number(match[1]) * factor) % 360) + 360) % 360;
}

function splitColorFunction(value: string, name: string): string[] | undefined {
  const match = new RegExp(`^${name}\\((.*)\\)$`).exec(value);
  if (match === null) return undefined;
  const parts = (match[1] as string).trim().split(/\s*[,/]\s*|\s+/);
  return parts.length === 3 || parts.length === 4 ? parts : undefined;
}

function oklabToSrgb(l: number, a: number, b: number): [number, number, number] {
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    linearToSrgb(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    linearToSrgb(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  ];
}

function labToSrgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (value: number): number => (value ** 3 > 0.008856451679035631 ? value ** 3 : (116 * value - 16) / 903.2962962962963);
  const x = inverse(fx) * 0.96422;
  const y = l > 8 ? fy ** 3 : l / 903.2962962962963;
  const z = inverse(fz) * 0.82521;
  const x65 = 0.9555766 * x - 0.0230393 * y + 0.0631636 * z;
  const y65 = -0.0282895 * x + 1.0099416 * y + 0.0210077 * z;
  const z65 = 0.0122982 * x - 0.020483 * y + 1.3299098 * z;
  return [
    linearToSrgb(3.2404542 * x65 - 1.5371385 * y65 - 0.4985314 * z65),
    linearToSrgb(-0.969266 * x65 + 1.8760108 * y65 + 0.041556 * z65),
    linearToSrgb(0.0556434 * x65 - 0.2040259 * y65 + 1.0572252 * z65),
  ];
}

/** A CSS color (hex, rgb, hsl, oklch, oklab, lab, lch) as `#rrggbb` or `#rrggbbaa`; `undefined` when it isn't one. */
export function parseCssColor(input: string): string | undefined {
  const value = input.trim().toLowerCase();
  if (value.length > 96) return undefined;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return `#${full.endsWith('ff') && full.length === 8 ? full.slice(0, 6) : full}`;
  }
  const kind = /^(rgba?|hsla?|oklch|oklab|lab|lch)\(/.exec(value)?.[1];
  const parts = kind !== undefined ? splitColorFunction(value, kind) : undefined;
  if (kind === undefined || parts === undefined) return undefined;
  const [first, second, third, fourth] = parts as [string, string, string, string | undefined];
  const alpha = fourth !== undefined ? parseCssNumber(fourth, 1) : 1;
  let rgb: [number, number, number] | undefined;
  if (kind === 'rgb' || kind === 'rgba') {
    const red = parseCssNumber(first, 255);
    const green = parseCssNumber(second, 255);
    const blue = parseCssNumber(third, 255);
    if (red !== undefined && green !== undefined && blue !== undefined) rgb = [red / 255, green / 255, blue / 255];
  } else if (kind === 'hsl' || kind === 'hsla') {
    const hue = parseCssHue(first);
    const saturation = parseCssNumber(second.replace(/%$/, ''), 100);
    const lightness = parseCssNumber(third.replace(/%$/, ''), 100);
    if (hue !== undefined && saturation !== undefined && lightness !== undefined) {
      const s = clampUnit(saturation / 100);
      const l = clampUnit(lightness / 100);
      const channel = (offset: number): number => {
        const k = (offset + hue / 30) % 12;
        return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
      rgb = [channel(0), channel(8), channel(4)];
    }
  } else if (kind === 'oklab' || kind === 'oklch') {
    const l = parseCssNumber(first, 1);
    let a = parseCssNumber(second, 0.4);
    let b = kind === 'oklab' ? parseCssNumber(third, 0.4) : undefined;
    if (kind === 'oklch') {
      const hue = parseCssHue(third);
      if (a !== undefined && hue !== undefined)
        [a, b] = [Math.max(0, a) * Math.cos((hue * Math.PI) / 180), Math.max(0, a) * Math.sin((hue * Math.PI) / 180)];
    }
    if (l !== undefined && a !== undefined && b !== undefined) rgb = oklabToSrgb(clampUnit(l), a, b);
  } else {
    const l = parseCssNumber(first, 100);
    let a = parseCssNumber(second, kind === 'lab' ? 125 : 150);
    let b = kind === 'lab' ? parseCssNumber(third, 125) : undefined;
    if (kind === 'lch') {
      const hue = parseCssHue(third);
      if (a !== undefined && hue !== undefined)
        [a, b] = [Math.max(0, a) * Math.cos((hue * Math.PI) / 180), Math.max(0, a) * Math.sin((hue * Math.PI) / 180)];
    }
    if (l !== undefined && a !== undefined && b !== undefined) rgb = labToSrgb(Math.max(0, Math.min(100, l)), a, b);
  }
  if (rgb === undefined || alpha === undefined || rgb.some((channel) => !Number.isFinite(channel))) return undefined;
  const opaque = `#${unitToHexByte(rgb[0])}${unitToHexByte(rgb[1])}${unitToHexByte(rgb[2])}`;
  return alpha >= 1 ? opaque : opaque + unitToHexByte(alpha);
}

function splitHexAlpha(color: string): { rgb: string; alpha: string } | undefined {
  const match = HEX_COLOR_PATTERN.exec(color.trim().toLowerCase());
  return match === null ? undefined : { rgb: `#${match[1]}`, alpha: match[2] === undefined || match[2] === 'ff' ? '' : match[2] };
}

/** WCAG relative luminance of a `#rrggbb` color. */
export function relativeLuminance(color: string): number {
  const [red, green, blue] = hexToRgbUnits(color);
  return 0.2126 * srgbToLinear(red) + 0.7152 * srgbToLinear(green) + 0.0722 * srgbToLinear(blue);
}

/** A color dark enough that the light theme's text would not read on it. */
export function isDarkColor(color: string): boolean {
  return relativeLuminance(color) < 0.18;
}

/** The WCAG contrast ratio of two `#rrggbb` colors (1–21). */
export function contrastRatio(left: string, right: string): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function hexToOklab(color: string): [number, number, number] {
  const [red, green, blue] = hexToRgbUnits(color).map(srgbToLinear) as [number, number, number];
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

/** Distance between two colors in OKLab, scaled by 100. */
export function colorDistance(left: string, right: string): number {
  const a = hexToOklab(left);
  const b = hexToOklab(right);
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** `from` moved `amount` (0–1) of the way to `to`, in sRGB. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgbUnits(from);
  const b = hexToRgbUnits(to);
  return `#${[0, 1, 2]
    .map((index) =>
      Math.round(((a[index] as number) * (1 - amount) + (b[index] as number) * amount) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** A translucent hex color as the opaque color it shows over `under`. */
export function flattenHexAlpha(color: string, under: string): string {
  const split = splitHexAlpha(color);
  return split === undefined || split.alpha === ''
    ? (split?.rgb ?? color)
    : mixHex(under, split.rgb, parseInt(split.alpha, 16) / 255);
}

/** A look color as opaque `#rrggbb`: a translucent one is flattened over `under`, or refused without it. */
export function parseLookColor(value: unknown, under?: string): string | undefined {
  const color = typeof value === 'string' ? parseCssColor(value) : undefined;
  if (color === undefined || color.length === 7) return color;
  return under === undefined ? undefined : flattenHexAlpha(color, under);
}

function fitsLuminance(color: string, theme: LookTheme, bounds: Readonly<Record<LookTheme, number>>): boolean {
  return theme === 'light' ? relativeLuminance(color) >= bounds.light : relativeLuminance(color) <= bounds.dark;
}

/**
 * One theme's colors: a ground of the theme's side (dark or light), mixed toward black or white until it is in the
 * theme's luminance range, then each color that keeps its contrast.
 */
export function parseLookTone(value: unknown, theme: LookTheme): LookTone | undefined {
  const record = asLookRecord(value);
  const given = parseLookColor(getLookField(record, 'ground'));
  if (given === undefined || isDarkColor(given) !== (theme === 'dark')) return undefined;
  const pole = theme === 'light' ? '#ffffff' : '#000000';
  const ground =
    [0, 0.2, 0.4, 0.6, 0.8].map((amount) => mixHex(given, pole, amount)).find((color) => fitsLuminance(color, theme, GROUND_LUMINANCE)) ??
    pole;
  const cardColor = parseLookColor(getLookField(record, 'card'), ground);
  const card = cardColor !== undefined && fitsLuminance(cardColor, theme, CARD_LUMINANCE) ? cardColor : ground;
  const readable = (color: string | undefined, ratio: number): color is string =>
    color !== undefined && contrastRatio(color, ground) >= ratio && contrastRatio(color, card) >= ratio;
  const field = (key: string): string | undefined => parseLookColor(getLookField(record, key), card);
  const text = [field('text'), DEFAULT_LOOK_TEXT[theme]].find((color) => readable(color, TEXT_CONTRAST)) ?? DEFAULT_LOOK_TEXT[theme];
  const muted = [field('muted'), mixHex(text, ground, 0.35)].find((color) => readable(color, UI_CONTRAST)) ?? text;
  const secondary = [mixHex(muted, text, 0.35)].find((color) => readable(color, UI_CONTRAST)) ?? text;
  const status: Partial<Record<LookStatus, string>> = {};
  for (const key of LOOK_STATUSES) {
    const color = field(key);
    if (readable(color, UI_CONTRAST)) status[key] = color;
  }
  const charts: (string | undefined)[] = [];
  const kept: string[] = [];
  const chartValues = getLookField(record, 'charts');
  for (const item of Array.isArray(chartValues) ? chartValues.slice(0, MAX_LOOK_CHART_VALUES) : []) {
    const color = parseLookColor(item, card);
    const chart =
      readable(color, CHART_CONTRAST) && kept.every((earlier) => colorDistance(earlier, color) >= MIN_CHART_DISTANCE) ? color : undefined;
    charts.push(chart);
    if (chart !== undefined) kept.push(chart);
  }
  const border =
    [field('border')].find(
      (color) =>
        color !== undefined &&
        (ground === given || Math.min(colorDistance(color, ground), colorDistance(color, card)) >= MIN_BORDER_DISTANCE),
    ) ?? mixHex(ground, text, 0.15);
  return { ground, card, text, secondary, muted, border, status, charts };
}

/** A length in px or rem (or a bare number of px), clamped to `min`–`max`, as px. */
export function parseLookLength(value: unknown, min: number, max: number): string | undefined {
  const [, amount, unit] = typeof value === 'string' ? (LOOK_LENGTH_PATTERN.exec(value.trim()) ?? []) : [];
  const px = typeof value === 'number' ? value : Number(amount ?? Number.NaN) * (unit?.toLowerCase() === 'rem' ? REM_PX : 1);
  return Number.isFinite(px) ? `${String(Math.round(Math.min(max, Math.max(min, px)) * 100) / 100)}px` : undefined;
}

export function isGenericFontFamily(name: string): boolean {
  return GENERIC_FONT_FAMILY_PATTERN.test(name);
}

/** A font stack of named families and generic keywords; anything else refuses the whole stack. */
export function parseFontStack(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_FONT_STACK_LENGTH) return undefined;
  const names = value.split(',').map((name) => name.trim().replace(/^(["'])(.*)\1$/, '$2'));
  if (names.length > MAX_FONT_FAMILIES || !names.every((name) => isGenericFontFamily(name) || FONT_FAMILY_NAME_PATTERN.test(name)))
    return undefined;
  return names.map((name) => (isGenericFontFamily(name) ? name.toLowerCase() : `"${name}"`)).join(',');
}

/** `dash/look` as the page applies it, or `null` when neither theme has a usable ground. */
export function parseDashboardLook(value: unknown): DashboardLook | null {
  const record = asLookRecord(value);
  const tones: Partial<Record<LookTheme, LookTone>> = {};
  for (const theme of LOOK_THEMES) {
    const tone = parseLookTone(getLookField(record, theme), theme);
    if (tone !== undefined) tones[theme] = tone;
  }
  if (tones.light === undefined && tones.dark === undefined) return null;
  const sizes: Partial<Record<LookSize, string>> = {};
  const sizeRecord = asLookRecord(getLookField(record, 'sizes'));
  for (const [key, [min, max]] of Object.entries(LOOK_SIZE_RANGES) as [LookSize, readonly [number, number]][]) {
    const size = parseLookLength(getLookField(sizeRecord, key), min, max);
    if (size !== undefined) sizes[key] = size;
  }
  const corners = parseLookLength(getLookField(record, 'corners'), 0, MAX_LOOK_CORNERS);
  const fonts = asLookRecord(getLookField(record, 'fonts'));
  const text = parseFontStack(getLookField(fonts, 'text'));
  const display = parseFontStack(getLookField(fonts, 'display'));
  return {
    tones,
    ...(corners === undefined ? {} : { corners }),
    sizes,
    fonts: { ...(text === undefined ? {} : { text }), ...(display === undefined ? {} : { display }) },
  };
}

function cssRule(selector: string, declarations: CssDeclaration[]): string {
  return `${selector}{${declarations.flatMap(([property, value]) => (value === undefined ? [] : [`${property}:${value}`])).join(';')}}`;
}

/** The custom properties one theme's colors set. */
export function getLookToneDeclarations(tone: LookTone): CssDeclaration[] {
  const groups: [string[], string | undefined][] = [
    [['--color-bg', '--dash-page-bg'], tone.ground],
    [['--color-panel', '--dash-surface-panel', '--dash-surface-popover'], tone.card],
    [['--color-fg', '--dash-text-primary'], tone.text],
    [['--dash-text-secondary'], tone.secondary],
    [['--color-fg-muted', '--dash-text-muted', '--dash-chart-reference'], tone.muted],
    [['--color-border-line', '--dash-border', '--dash-chart-grid'], tone.border],
    [['--dash-chart-axis'], mixHex(tone.ground, tone.text, 0.25)],
    [['--dash-chart-muted'], mixHex(tone.ground, tone.text, 0.28)],
    [['--color-ok', '--dash-text-success'], tone.status.good],
    [['--color-warn', '--dash-text-warning'], tone.status.warning],
    [['--color-bad', '--dash-text-danger', '--dash-chart-critical'], tone.status.bad],
    ...tone.charts.map((color, index): [string[], string | undefined] => [[dashChartToken(index + 1)], color]),
  ];
  return groups.flatMap(([properties, value]) => properties.map((property): CssDeclaration => [property, value]));
}

/** One theme's rules: the light one for light mode, unset mode in a light scheme and print; the dark one on screen. */
export function getLookToneCss(theme: LookTheme, tone: LookTone): string {
  const rules = (scope: string): string =>
    cssRule(`${scope} ${DASH_ROOT_SELECTOR}`, getLookToneDeclarations(tone)) + cssRule(`${scope} body`, [['--t-bg', tone.ground]]);
  if (theme === 'light')
    return `${rules('html[data-mode="light"]')}@media (prefers-color-scheme:light){${rules('html:not([data-mode])')}}@media print{${rules('html')}}`;
  return `@media screen{${rules('html[data-mode="dark"]')}}@media screen and (prefers-color-scheme:dark){${rules('html:not([data-mode])')}}`;
}

/** The `<style>` text of a parsed look. */
export function getDashboardLookCss({ tones, corners, sizes, fonts }: DashboardLook): string {
  return (
    cssRule(`html ${DASH_ROOT_SELECTOR}`, [
      ['--dash-radius', corners],
      ...Object.entries(sizes).map(([key, size]): CssDeclaration => [`--dash-font-size-${key}`, size]),
      ['--font-sans', fonts.text],
      ['--font-serif', fonts.display],
      ['font-family', fonts.text],
      ['font-size', sizes.body],
    ]) +
    (tones.light === undefined ? '' : getLookToneCss('light', tones.light)) +
    (tones.dark === undefined ? '' : getLookToneCss('dark', tones.dark))
  );
}

/** The design system's name the look names (`system.name`), trimmed, or `null`. */
export function getDesignSystemName(look: unknown): string | null {
  const name = asLookRecord(asLookRecord(look).system).name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

/** `dash/look` applied: its `<style>` text, the parsed look, its design system's name and how many chart colors it offers. */
export function applyDashboardLook(look: unknown): AppliedLook {
  const parsed = parseDashboardLook(look);
  if (parsed === null) return { css: '', look: null, system: null, colors: MAX_LOOK_CHARTS };
  const used = (charts: (string | undefined)[] = []): number =>
    charts.reduce((count: number, color, index) => (color === undefined ? count : index + 1), 0);
  return {
    css: getDashboardLookCss(parsed),
    look: parsed,
    system: getDesignSystemName(look),
    colors: Math.max(MAX_LOOK_CHARTS, used(parsed.tones.light?.charts), used(parsed.tones.dark?.charts)),
  };
}
