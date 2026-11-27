import type { Dataset, DashboardFile } from './types.ts';
import { stripColumnNamespace } from './tables.ts';

export interface PresenceEntry {
  id: string;
  kind?: string;
  label?: string;
}
export type PresenceScalar = string | number | boolean | null;
/** A point (`x`, `y`) or box (`x`, `y`, `w`, `h`) of safe integers, kept in both contexts. */
export type PresenceRect = Record<string, number>;
export type PresenceContext = Record<string, PresenceScalar | string[] | PresenceEntry[] | PresenceRect>;
/** The context in full, and lean: without labels and entries, for when the full one is too big. */
export interface PresenceContextPair {
  full: PresenceContext;
  lean: PresenceContext;
}
/** The element ids and `data-field` names the page files hold. */
export interface PagePresenceHooks {
  ids: Set<string>;
  fields: Set<string>;
}
export type PresenceHook = string | { text: string } | null;
/** What the viewer points at on the page: element ids, the sources marked there and a field. */
export interface PresenceSelectionPoint {
  at: string[];
  sources: string[];
  field: string;
}
/** Each dataset's last run as the run report holds it (only `status` is read). */
export interface PresenceRunReport {
  datasets: Record<string, { status: string }>;
}
export interface DashboardPresenceOptions {
  /** Data mode (the sources) is shown, not the page. */
  data: boolean;
  /** The edit mode holds unsaved hand edits. */
  dirty: boolean;
  /** The page's location fragment (an element id). */
  place: string;
  pointed: PresenceSelectionPoint | null;
  /** The source open in the sources panel. */
  shown: string | null;
  filters: string[];
  /** The format told to the agent (null leaves it out of the context). */
  form: string | null;
  /** The shown draft's id, null when the stored dashboard is shown. */
  draft: string | null;
  /** What the page shows when it isn't the dashboard itself (`drafts/<id>`, or `history/<n>` for an earlier version); null or left out for the dashboard. */
  showing?: string | null;
  /** The draft the viewer's changes are written to (`drafts/<id>`); null or left out for the dashboard itself. */
  writeTo?: string | null;
}
/** A box in the shown view's state: x and y within ±1e9, w and h 1–1e9. */
export interface ViewArea {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** The view context a data page publishes: what the viewer has on screen and selected. */
export type DataViewContext = PresenceContext;

export const MAX_PRESENCE_CONTEXT_BYTES = 3072;
export const MAX_PRESENCE_ARRAY_ITEMS = 20;
export const MAX_PRESENCE_FAILURES = 5;
export const MAX_PRESENCE_LABEL_CHARACTERS = 60;
export const PRESENCE_DEBOUNCE_MS = 400;
export const MAX_PRESENCE_ID_CHARACTERS = 256;
/** The most JSON a received view context may be. */
export const MAX_VIEW_CONTEXT_BYTES = 32768;
export const MAX_VIEW_COORDINATE = 1e9;
export const PRESENCE_FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** Fields the reporter sets itself. */
export const RESERVED_PRESENCE_FIELDS: readonly string[] = ['edits'];
export const PRESENCE_ID_PATTERN = /^(?:[A-Za-z0-9_./#:@+!~*'()-]|%[0-9A-Fa-f]{2})*$/;
export const UNSAFE_PRESENCE_ID_PATTERN = /[\p{Cc}\p{Co}\p{Cs}]|[^\P{Cf}\u200C\u200D]|["`<>\\\p{Zl}\p{Zp}]/u;
export const UNSAFE_PRESENCE_LABEL_PATTERN =
  /[<>"`\\]|[^\P{Cf}\u200C\u200D]|[\p{Co}\u034F\u115F\u1160\u17B4\u17B5\u2065\u2800\u3164\uFFA0\uFFFC\uFFFD\u{16FE4}\u{1D159}]/u;
export const EMPTY_PRESENCE_LABEL_PATTERN = /^[ \u200C\u200D\p{Variation_Selector}]*$/u;
export const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
export const HTML_ID_ATTRIBUTE_PATTERN = /(?<![\w-])id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/g;
export const HTML_FIELD_ATTRIBUTE_PATTERN = /(?<![\w-])data-field\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/g;
export const SHORT_PRESENCE_HOOK_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** An id safe to show the agent: URL-safe characters (or %-escapes) that decode to nothing hidden or markup-like. */
export function isSafePresenceId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_PRESENCE_ID_CHARACTERS || !PRESENCE_ID_PATTERN.test(value)) return false;
  try {
    return !UNSAFE_PRESENCE_ID_PATTERN.test(decodeURIComponent(value).normalize('NFKD'));
  } catch {
    return false;
  }
}

function normalizeSingleCodePoint(char: string): string {
  const normalized = char.normalize('NFKD');
  return [...normalized].length === 1 ? normalized : char;
}

function isEmojiTagCodePoint(code: number | undefined): boolean {
  return code !== undefined && code >= 0xe0020 && code <= 0xe007f;
}

function isUnsafePresenceCodePoint(code: number): boolean {
  return (
    (code >= 0xd800 && code <= 0xdfff) ||
    (code & 0xfffe) === 0xfffe ||
    (code >= 0xfdd0 && code <= 0xfdef) ||
    (code >= 0xfff0 && code <= 0xfff8) ||
    (code >= 0xe0000 && code <= 0xe0fff)
  );
}

/**
 * A label safe to show the agent: hidden, private-use and markup characters dropped, runs of space as one, at most
 * `max` characters (cut with "…"); empty when nothing visible is left.
 */
export function sanitizePresenceLabel(input: string, max: number = MAX_PRESENCE_LABEL_CHARACTERS): string {
  let text = '';
  let count = 0;
  let pendingSpace = false;
  const add = (char: string, next: string): boolean => {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 32 || (code >= 127 && code <= 160) || /\s/u.test(char)) {
      pendingSpace = text !== '';
      return false;
    }
    if (isUnsafePresenceCodePoint(code) || UNSAFE_PRESENCE_LABEL_PATTERN.test(char)) return false;
    if (
      UNSAFE_PRESENCE_LABEL_PATTERN.test(normalizeSingleCodePoint(char)) ||
      (isEmojiTagCodePoint(next.codePointAt(0)) && EMOJI_PATTERN.test(char))
    ) {
      pendingSpace = text !== '';
      return false;
    }
    if (pendingSpace) {
      text += ' ';
      count += 1;
      pendingSpace = false;
    }
    text += char;
    count += 1;
    return count > max;
  };
  let held = '';
  for (const char of input.normalize('NFC')) {
    if (held !== '' && add(held, char)) {
      held = '';
      break;
    }
    held = char;
  }
  if (held !== '') add(held, '');
  if (EMPTY_PRESENCE_LABEL_PATTERN.test(text)) return '';
  if (count <= max) return text;
  return [...text].slice(0, max - 1).join('').trimEnd() + '…';
}

/** A list of `{id, kind?, label?}` entries with safe ids, the last `MAX_PRESENCE_FAILURES` of them. */
export function sanitizePresenceEntries(input: readonly unknown[]): PresenceEntry[] {
  return input
    .filter(
      (item): item is { id: string; kind?: unknown; label?: unknown } =>
        typeof item === 'object' && item !== null && isSafePresenceId((item as { id?: unknown }).id),
    )
    .slice(-MAX_PRESENCE_FAILURES)
    .map(({ id, kind, label }) => {
      const entry: PresenceEntry = { id };
      if (isSafePresenceId(kind)) entry.kind = kind;
      const text = typeof label === 'string' ? sanitizePresenceLabel(label) : '';
      if (text !== '') entry.label = text;
      return entry;
    });
}

/** A point `{x, y}` or box `{x, y, w, h}` of safe integers, else `undefined`. */
export function sanitizePresenceRect(input: object): PresenceRect | undefined {
  const keys = Object.keys(input).sort().join();
  return (keys === 'x,y' || keys === 'h,w,x,y') && Object.values(input).every(Number.isSafeInteger)
    ? { ...(input as PresenceRect) }
    : undefined;
}

/**
 * A reported context made safe to publish: field names checked, scalars kept, ids and labels sanitized, lists cut.
 * `lean` leaves out entries and labels.
 */
export function sanitizePresenceContext(input: Record<string, unknown>): PresenceContextPair {
  const full: PresenceContext = {};
  const lean: PresenceContext = {};
  for (const key of Object.keys(input)) {
    if (
      !PRESENCE_FIELD_NAME_PATTERN.test(key) ||
      key === 'prototype' ||
      key in Object.prototype ||
      RESERVED_PRESENCE_FIELDS.includes(key)
    )
      continue;
    const value = input[key];
    if (typeof value === 'boolean' || value === null) full[key] = lean[key] = value;
    else if (typeof value === 'number') full[key] = lean[key] = Number.isSafeInteger(value) ? value : null;
    else if (Array.isArray(value)) {
      const items: unknown[] = value;
      if (items.some((item) => typeof item === 'object' && item !== null)) full[key] = sanitizePresenceEntries(items);
      else full[key] = lean[key] = items.filter(isSafePresenceId).slice(-MAX_PRESENCE_ARRAY_ITEMS);
    } else if (typeof value === 'object') {
      const rect = sanitizePresenceRect(value);
      const label = 'text' in value && typeof value.text === 'string' ? sanitizePresenceLabel(value.text) : '';
      if (rect !== undefined) full[key] = lean[key] = rect;
      else if (label !== '') full[key] = label;
    } else full[key] = lean[key] = isSafePresenceId(value) ? value : null;
  }
  return { full, lean };
}

/** The context to publish: the full one with the edit count, else the lean one with it, else the lean one; `null` when none fits. */
export function choosePresenceContext(
  pair: PresenceContextPair,
  edits = 0,
): { view: PresenceContext | null; json: string } {
  const withEdits = (context: PresenceContext): PresenceContext => (edits > 0 ? { ...context, edits } : context);
  for (const view of [withEdits(pair.full), withEdits(pair.lean), pair.lean]) {
    const json = JSON.stringify(view);
    if (new TextEncoder().encode(json).length <= MAX_PRESENCE_CONTEXT_BYTES) return { view, json };
  }
  return { view: null, json: '' };
}

function collectFileAttributeValues(files: readonly DashboardFile[], pattern: RegExp): Set<string> {
  return new Set(
    files.flatMap((file) => [...file.text.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? '')),
  );
}

/** The `id`s and `data-field`s written in the page files. */
export function collectPagePresenceHooks(files: readonly DashboardFile[]): PagePresenceHooks {
  return {
    ids: collectFileAttributeValues(files, HTML_ID_ATTRIBUTE_PATTERN),
    fields: collectFileAttributeValues(files, HTML_FIELD_ATTRIBUTE_PATTERN),
  };
}

/** A location hash without its `#`, decoded when it can be. */
export function decodeLocationFragment(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

/** A short id as it is, a longer one as `{text}` (when not too long), else `null`. */
export function formatPresenceHook(value: string | undefined): PresenceHook {
  if (value === undefined) return null;
  if (SHORT_PRESENCE_HOOK_PATTERN.test(value)) return value;
  return [...value].length <= MAX_PRESENCE_LABEL_CHARACTERS ? { text: value } : null;
}

/** A run the report counts as failed: anything not ok and not running. */
export function isReportableRunFailure(run: { status: string }): boolean {
  return run.status !== 'ok' && run.status !== 'running';
}

/**
 * What a dashboard tells the agent of the viewer's screen: mode, selection, place, filters, format, what it shows and
 * where changes go (`showing`, `writeTo`, `draft`), and failures.
 */
export function buildDashboardPresenceContext(
  report: PresenceRunReport | null,
  pageHooks: PagePresenceHooks,
  sourcesById: ReadonlyMap<string, Dataset>,
  { data, dirty, place, pointed, shown, filters, form, draft, showing = null, writeTo = null }: DashboardPresenceOptions,
): Record<string, unknown> {
  const failures =
    report === null
      ? []
      : Object.entries(report.datasets).filter(([id, run]) => sourcesById.has(id) && isReportableRunFailure(run));
  const selectedSources = (pointed?.sources ?? []).filter((id) => sourcesById.has(id));
  const selectedField = pointed?.field ?? '';
  return {
    mode: data ? 'data' : 'page',
    dirty,
    selected:
      selectedSources.length > 0 ? selectedSources : shown !== null && sourcesById.has(shown) ? [shown] : [],
    place: formatPresenceHook(pageHooks.ids.has(place) ? place : undefined),
    at: formatPresenceHook(pointed?.at.find((id) => pageHooks.ids.has(id))),
    field: formatPresenceHook([selectedField, stripColumnNamespace(selectedField)].find((name) => pageHooks.fields.has(name))),
    filters: filters.slice(0, MAX_PRESENCE_ARRAY_ITEMS),
    ...(form === null ? {} : { form }),
    ...(showing === null ? {} : { showing }),
    ...(writeTo === null ? {} : { writeTo }),
    ...(draft === null ? {} : { draft }),
    ...(report === null
      ? {}
      : {
          failed: failures.length,
          failures: failures
            .slice(0, MAX_PRESENCE_FAILURES)
            .map(([id]) => ({ id, label: sourcesById.get(id)?.title || id })),
        }),
  };
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && value >= min && value <= max;
}

/** A box `{x, y, w, h}`: x and y within ±1e9, w and h 1–1e9; else `undefined`. */
export function sanitizeViewArea(value: unknown): ViewArea | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { x, y, w, h } = value as Record<string, unknown>;
  return isNumberInRange(x, -MAX_VIEW_COORDINATE, MAX_VIEW_COORDINATE) &&
    isNumberInRange(y, -MAX_VIEW_COORDINATE, MAX_VIEW_COORDINATE) &&
    isNumberInRange(w, 1, MAX_VIEW_COORDINATE) &&
    isNumberInRange(h, 1, MAX_VIEW_COORDINATE)
    ? { x, y, w, h }
    : undefined;
}

/**
 * A view context received from a data page, made safe as the page makes it before publishing (the full form, with
 * its edit count); `null` for anything but a plain object of at most `MAX_VIEW_CONTEXT_BYTES` of JSON.
 */
export function validateDataViewContext(value: unknown): DataViewContext | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (json === undefined || new TextEncoder().encode(json).length > MAX_VIEW_CONTEXT_BYTES) return null;
  const record = value as Record<string, unknown>;
  const { full } = sanitizePresenceContext(record);
  const edits = record.edits;
  return typeof edits === 'number' && Number.isSafeInteger(edits) && edits > 0 ? { ...full, edits } : full;
}
