/**
 * A canvas note's `css`: the style keys a note takes, how each value is
 * checked, and how a border set to sit at the centre of the edge or outside
 * it is drawn. Reading `canvas.json` keeps only what passes; `check` names
 * what it would drop.
 */

/** Every key a note's `css` takes. */
export const NOTE_CSS_KEYS = [
  // Fill and see-through.
  'background',
  'background-color',
  'opacity',
  // The border: one style, colour and width, a width per side, and where it sits on the edge.
  'border-color',
  'border-position',
  'border-style',
  'border-width',
  'border-bottom-width',
  'border-left-width',
  'border-right-width',
  'border-top-width',
  // Corners: all at once, or one each.
  'border-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  // Effects.
  'backdrop-filter',
  'box-shadow',
  'filter',
  // An image note's picture in its box.
  'object-fit',
  'object-position',
  // A drawn line.
  'stroke',
  'stroke-dasharray',
  'stroke-width',
] as const;

export type NoteCssKey = (typeof NOTE_CSS_KEYS)[number];
export type NoteCss = Partial<Record<NoteCssKey, string>>;

const KEYS = new Set<string>(NOTE_CSS_KEYS);

/** Letters, digits, `# % ( ) , . / + -` and spaces, 1–1200 of them: no `;`, braces, quotes or colons. */
const SAFE = /^[A-Za-z0-9#%(),./ +-]{1,1200}$/;

/** The functions a value may call: colours, gradients and filters. No `url(`, `var(` or `calc(`. */
const FUNCTIONS = new Set([
  // Colours.
  'color', 'color-mix', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'light-dark', 'oklab', 'oklch', 'rgb', 'rgba',
  // Gradients.
  'conic-gradient', 'linear-gradient', 'radial-gradient', 'repeating-conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient',
  // Filters.
  'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia',
]);

const CHOICES: Partial<Record<NoteCssKey, readonly string[]>> = {
  'border-style': ['none', 'solid', 'dashed', 'dotted', 'double'],
  'border-position': ['center', 'outside'],
  'object-fit': ['fill', 'contain', 'cover', 'none', 'scale-down'],
};

/** Every `(` follows the name of a function a note's style may call. */
function callsOnlyKnownFunctions(value: string): boolean {
  for (let at = value.indexOf('('); at !== -1; at = value.indexOf('(', at + 1)) {
    const name = /([A-Za-z-]+)$/.exec(value.slice(0, at))?.[1]?.toLowerCase();
    if (!name || !FUNCTIONS.has(name)) return false;
  }
  return true;
}

/** The value `key` keeps (trimmed, and for some keys rewritten), or null when the note drops it. */
export function noteCssValue(key: string, raw: unknown): string | null {
  if (!KEYS.has(key) || typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!SAFE.test(value)) return null;
  const choices = CHOICES[key as NoteCssKey];
  if (choices) return choices.includes(value) ? value : null;
  switch (key) {
    case 'opacity': {
      if (/^\d{1,3}(\.\d{1,3})?%$/.test(value)) return value;
      if (!/^(\d{1,3}(\.\d{1,6})?|\.\d{1,6})$/.test(value)) return null;
      return Number(value) > 1 ? '1' : value;
    }
    case 'stroke-width': {
      const match = /^(\d{1,3}(?:\.\d+)?)(px)?$/.exec(value);
      return match ? `${Math.round(Number(match[1]) * 100) / 100}${match[2] ?? ''}` : null;
    }
    case 'stroke-dasharray':
      return /^\d{1,3}( \d{1,3}){0,3}$/.test(value) ? value : null;
    case 'stroke':
      if (/^none$/i.test(value) || /gradient\(/i.test(value)) return null;
      return callsOnlyKnownFunctions(value) ? value : null;
    default:
      return callsOnlyKnownFunctions(value) ? value : null;
  }
}

/** What a note keeps of `css`: the valid keys only, or undefined when none is. */
export function cleanNoteCss(css: unknown): NoteCss | undefined {
  if (!css || typeof css !== 'object' || Array.isArray(css)) return undefined;
  const kept: NoteCss = {};
  for (const [key, raw] of Object.entries(css)) {
    const value = noteCssValue(key, raw);
    if (value !== null) kept[key as NoteCssKey] = value;
  }
  return Object.keys(kept).length ? kept : undefined;
}

/** The keys of `css` a note drops, with why: for `check`. */
export function droppedNoteCss(css: unknown): { key: string; why: string }[] {
  if (!css || typeof css !== 'object' || Array.isArray(css)) return [];
  return Object.entries(css).flatMap(([key, raw]) =>
    noteCssValue(key, raw) !== null ? [] : [{ key, why: KEYS.has(key) ? 'its value is not one a note takes' : 'a note does not take this key' }],
  );
}

/* ------------------------------ border alignment ------------------------------ */

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const KEYWORD_WIDTHS: Record<string, number> = { thin: 1, medium: 3, thick: 5 };

/** A border width a uniform outline can take: a px/pt/em/rem length or a keyword, not zero. */
function outlineWidth(value: string): { text: string; amount: number; unit: string } | null {
  const keyword = KEYWORD_WIDTHS[value];
  if (keyword !== undefined) return { text: value, amount: keyword, unit: 'px' };
  const match = /^(\d*\.?\d+)(px|pt|em|rem)$/.exec(value);
  if (!match || Number(match[1]) === 0) return null;
  return { text: value, amount: Number(match[1]), unit: match[2]! };
}

/** One colour, not one per side: no space outside parentheses. */
function singleColor(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ' ' && depth === 0) return false;
  }
  return true;
}

/**
 * How a note's border is drawn, as CSS declarations: a border set to sit at
 * the centre of the edge or outside it, the same on all four sides, becomes
 * an outline (`outline-offset` 0 outside, minus half the width at the
 * centre); any other border is drawn inside, as a CSS border is.
 */
export function noteBorderDeclarations(css: NoteCss): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(css)) if (key.startsWith('border-') && !key.endsWith('radius') && key !== 'border-position') out[key] = value;
  const position = css['border-position'];
  const style = css['border-style'];
  if (!position || !style || style === 'none') return out;
  const fallback = css['border-width'] ?? 'medium';
  const widths = SIDES.map((side) => css[`border-${side}-width`] ?? fallback);
  if (!widths.every((w) => w === widths[0])) return out;
  const width = outlineWidth(widths[0]!);
  const color = css['border-color'];
  if (!width || (color !== undefined && !singleColor(color))) return out;
  const offset = position === 'outside' ? '0' : `${-Math.round((width.amount / 2) * 1000) / 1000}${width.unit}`;
  return { outline: `${width.text} ${style}${color ? ` ${color}` : ''}`, 'outline-offset': offset };
}
