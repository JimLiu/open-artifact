import { stableStringify } from '@open-artifact/live-store/json';
import type { DashboardContent, DashboardFile, Dataset, Parameters, UnknownRecord } from './types.ts';
import type { DocumentWritePlan } from './versions.ts';
import { DASHBOARD_FORMS, findDashboardFormKey, type DashboardForm } from './forms.ts';
import {
  DASHBOARD_ENTRY_PATH,
  DASH_PARAMS_PATH,
  DRAFT_COLLECTIONS,
  DRAFT_ID_PATTERN,
  DRAFTS_COLLECTION,
  datasetPath,
  filePath,
  getCollectionPath,
  isDraftDocumentPath,
} from './paths.ts';
import { composeDashboardDocuments } from './records.ts';
import { fillDatasetParameters, prepareDashboardContent } from './fill.ts';

/** One of the dashboard type's own formats a draft can be remixed into. */
export type RemixForm = DashboardForm;

/** What every draft head has. */
interface DraftHeadCommon {
  id: string;
  by: string;
  at: number;
  /** The artifact the draft was made for; drafts of other artifacts are not shown. */
  artifact?: string;
  /** Hash of the dashboard the draft was made from ("" until known). */
  base: string;
  saved?: true;
}

/** A remix: a draft in another format, asked for by one person. */
export interface RemixDraftHead extends DraftHeadCommon {
  kind: 'remix';
  form: string;
}

/** The shared draft (`drafts/shared`): every editor's and the agent's changes waiting to be published. */
export interface SharedDraftHead extends DraftHeadCommon {
  kind: 'edit';
  /** Who changed it since it was last published or discarded. */
  editors?: string[];
  /** The agent changed it too. */
  agent?: true;
  /** Held back from publishing by itself (a publish failed, or someone undid a change). */
  held?: true;
  /** When it last changed, ms. */
  changed?: number;
}

/** A published or discarded shared draft, kept for History (`drafts/<id>`, its documents beside it when discarded). */
export interface PastDraftHead extends DraftHeadCommon {
  kind: 'past';
  what: 'saved' | 'discarded';
  editors?: string[];
  agent?: true;
  /** Someone changed the draft while it was published or discarded, so their changes stayed in it. */
  left?: true;
  /** The size of the kept documents (0 when published). */
  bytes: number;
}

/** A parsed `drafts/<id>` record. */
export type DraftHead = RemixDraftHead | SharedDraftHead | PastDraftHead;
export type DraftHeadRecord = Omit<RemixDraftHead, 'id'> | Omit<SharedDraftHead, 'id' | 'editors'> | Omit<PastDraftHead, 'id' | 'editors'>;
export type StoredDraftHead = DraftHeadRecord & { v: 1; editors?: Record<string, true> };
/** A draft's documents by path under `drafts/<id>/`. */
export type DraftDocs = Map<string, UnknownRecord>;
/** A draft composed into dashboard parts; `setsParams` when it has its own `dash/params`. */
export interface DraftComposition {
  params: Parameters;
  datasets: Dataset[];
  files: DashboardFile[];
  setsParams: boolean;
}
/**
 * The selection shown with a remix request: a chip naming the format, the text the agent reads, and the draft the
 * agent writes to (`drafts/<id>`).
 */
export interface RemixSelection {
  label: string;
  chip: { about: 'remix'; form: string };
  text: string;
  writeTo: string;
}

export const REMIX_REFERENCE_PATH = 'reference/remix.md';
export const REMIX_FORM_KEYS: readonly string[] = ['dashboard', 'scroll-story', 'visual-short', 'visual-analysis'];
/** The formats a remix offers, in `REMIX_FORM_KEYS` order. */
export const REMIX_FORMS: readonly RemixForm[] = REMIX_FORM_KEYS.flatMap(
  (key) => DASHBOARD_FORMS.find((form) => form.key === key) ?? [],
);

export function draftText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A new draft id: twelve random base-36 characters. */
export function newDraftId(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(12))): string {
  return [...bytes].map((byte) => (byte % 36).toString(36)).join('');
}

/** Plain code-unit order, the same everywhere. */
export function compareDraftKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function listRemixForms(): RemixForm[] {
  return [...REMIX_FORMS];
}

/** A format's name ("Visual short"), or the key when it isn't one. */
export function remixFormName(form: string): string {
  return DASHBOARD_FORMS.find((item) => item.key === form)?.name ?? form;
}

/** The request sent to the agent to make a remix draft. */
export function remixPrompt(form: string, id: string): string {
  return (
    'Make a ' +
    remixFormName(form) +
    ' draft: write it under ' +
    DRAFTS_COLLECTION +
    '/' +
    id +
    ' and leave the current page as it is. Read ' +
    REMIX_REFERENCE_PATH +
    ' first.'
  );
}

export function remixSelection(form: string, id: string): RemixSelection {
  return {
    label: 'Remix as a ' + remixFormName(form),
    chip: { about: 'remix', form },
    text:
      'From the dashboard’s Design page, to make a draft of it in one of the dashboard type’s own formats. The format picked is ' +
      remixFormName(form) +
      ' (' +
      form +
      '). See ' +
      REMIX_REFERENCE_PATH +
      '.',
    writeTo: DRAFTS_COLLECTION + '/' + id,
  };
}

/** The most editors a head lists. */
export const MAX_DRAFT_EDITORS = 50;
const MAX_EDITOR_ID_CHARACTERS = 128;

/** The ids set to true in a stored `editors` map, sorted and capped. */
function readEditors(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const ids = Object.entries(value as UnknownRecord)
    .filter(([id, on]) => on === true && id !== '' && id.length <= MAX_EDITOR_ID_CHARACTERS)
    .map(([id]) => id);
  return [...new Set(ids)].sort(compareDraftKeys).slice(0, MAX_DRAFT_EDITORS);
}

/** A `drafts/<id>` record, or `null` when the id or any required field is not valid. */
export function parseDraftHead(id: string, value: unknown): DraftHead | null {
  if (!DRAFT_ID_PATTERN.test(id) || typeof value !== 'object' || value === null) return null;
  const record = value as UnknownRecord;
  const { kind, by, at, artifact, base, saved } = record;
  if (typeof by !== 'string' || by === '' || typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  const common: DraftHeadCommon = {
    id,
    by,
    at,
    ...(typeof artifact === 'string' && artifact !== '' ? { artifact } : {}),
    base: draftText(base),
    ...(saved === true ? { saved } : {}),
  };
  if (kind === 'remix') {
    const form = findDashboardFormKey(record.form);
    return form === undefined ? null : { ...common, kind, form };
  }
  if (kind !== 'edit' && kind !== 'past') return null;
  const editors = readEditors(record.editors);
  const people = { ...(editors.length > 0 ? { editors } : {}), ...(record.agent === true ? { agent: true as const } : {}) };
  if (kind === 'edit') {
    const { held, changed } = record;
    return {
      ...common,
      ...people,
      kind,
      ...(held === true ? { held } : {}),
      ...(typeof changed === 'number' && Number.isFinite(changed) && changed > 0 ? { changed } : {}),
    };
  }
  const { what, left, bytes } = record;
  if (what !== 'saved' && what !== 'discarded') return null;
  return {
    ...common,
    ...people,
    kind,
    what,
    ...(left === true ? { left } : {}),
    bytes: typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
  };
}

/** The record stored for a head; editors as a map, so each one can be set by itself. */
export function toDraftHeadRecord(head: DraftHead): StoredDraftHead {
  const { id: _id, ...rest } = head;
  if (rest.kind === 'remix') return { v: 1, ...rest };
  const { editors, ...others } = rest;
  return { v: 1, ...others, ...(editors === undefined ? {} : { editors: Object.fromEntries(editors.map((editor) => [editor, true as const])) }) };
}

/** The open draft to show: the viewer's newest remix, else the shared draft, else anyone's newest. */
export function pickDraftHead(heads: readonly DraftHead[], viewer: string): DraftHead | null {
  const open = heads
    .filter((head) => head.saved !== true && head.kind !== 'past')
    .sort((left, right) => right.at - left.at || compareDraftKeys(right.id, left.id));
  return (
    open.find((head) => head.kind === 'remix' && head.by === viewer) ?? open.find((head) => head.kind === 'edit') ?? open[0] ?? null
  );
}

/** The remix heads among `heads`. */
export function remixHeads(heads: readonly DraftHead[]): RemixDraftHead[] {
  return heads.filter((head): head is RemixDraftHead => head.kind === 'remix');
}

export function isDraftForArtifact(head: DraftHead, artifact: string | null | undefined): boolean {
  return head.artifact === (artifact ?? undefined);
}

/** The draft has an entry page with some text. */
export function draftHasPage(docs: DraftDocs): boolean {
  return draftText(docs.get(DASHBOARD_ENTRY_PATH)?.text) !== '';
}

export function areDraftDocsEqual(docs: DraftDocs, other: DraftDocs): boolean {
  return (
    docs.size === other.size &&
    [...docs].every(([path, data]) => other.has(path) && stableStringify(other.get(path)) === stableStringify(data))
  );
}

/** What a dataset's source is, for telling whether a draft changed it. */
export function draftSourceKey({ source }: Dataset): unknown {
  if (source.kind === 'query')
    return [source.connector, source.tool, source.template ?? source.args, source.rules, ...(source.call ? [true] : [])];
  return source.kind === 'file' ? source.url : source.kind;
}

function fnv1a(text: string, seed: number): string {
  let value = seed;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** Two FNV-1a hashes of `text`, sixteen hex digits. */
export function draftTextHash(text: string): string {
  return fnv1a(text, 2166136261) + fnv1a(text, 19088743);
}

/** Two FNV-1a hashes of the dashboard's filters, sources and page files: what a draft was made from. */
export function dashboardContentHash(content: DashboardContent): string {
  const sources = [...content.datasets]
    .sort((left, right) => compareDraftKeys(left.id, right.id))
    .map((dataset) => [dataset.id, dataset.title, draftSourceKey(dataset)]);
  const text = stableStringify({
    params: content.params,
    sources,
    files: content.files.map((file) => [file.name, file.text]),
  });
  return draftTextHash(text);
}

export function composeDraft(docs: DraftDocs): DraftComposition {
  const kept = new Map([...docs].filter(([path]) => isDraftDocumentPath(path)));
  const { params, datasets, files } = prepareDashboardContent(composeDashboardDocuments(kept).content);
  return { params, datasets, files: [...files], setsParams: kept.has(DASH_PARAMS_PATH) };
}

/** The dashboard with the draft's filters (when it has them), sources replaced or added, and page files. */
export function applyDraftToContent(content: DashboardContent, draft: DraftComposition): DashboardContent {
  const params = draft.setsParams ? draft.params : content.params;
  const byId = new Map(draft.datasets.map((dataset) => [dataset.id, dataset]));
  const ids = new Set(content.datasets.map((dataset) => dataset.id));
  const datasets = [
    ...content.datasets.map((dataset) => byId.get(dataset.id) ?? dataset),
    ...draft.datasets.filter((dataset) => !ids.has(dataset.id)),
  ].map((dataset) => fillDatasetParameters(dataset, params));
  return { ...content, params, datasets, files: draft.files };
}

/** Saving a draft: its documents in order with the entry page last, and the page files it no longer has. */
export function planDraftSave(files: readonly DashboardFile[], docs: DraftDocs): DocumentWritePlan {
  const draft = composeDraft(docs);
  const kept = new Set([
    ...draft.datasets.map((dataset) => datasetPath(dataset.id)),
    ...draft.files.map((file) => filePath(file.name)),
    ...(draft.setsParams ? [DASH_PARAMS_PATH] : []),
  ]);
  const order = (path: string): number => DRAFT_COLLECTIONS.indexOf(getCollectionPath(path));
  const write = [...docs]
    .filter(([path]) => kept.has(path))
    .sort((left, right) => order(left[0]) - order(right[0]) || compareDraftKeys(left[0], right[0]));
  const entry = write.findIndex(([path]) => path === DASHBOARD_ENTRY_PATH);
  if (entry >= 0) write.push(...write.splice(entry, 1));
  return {
    write: write.map(([path, data]): [string, UnknownRecord] => [path, data]),
    remove: files.map((file) => filePath(file.name)).filter((path) => !kept.has(path)),
  };
}
