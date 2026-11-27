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

/** A parsed `drafts/<id>` record. */
export interface DraftHead {
  id: string;
  kind: 'remix';
  form: string;
  by: string;
  at: number;
  /** The artifact the draft was made for; drafts of other artifacts are not shown. */
  artifact?: string;
  /** Hash of the dashboard the draft was made from. */
  base: string;
  saved?: true;
}
export type DraftHeadRecord = Omit<DraftHead, 'id'> & { v: 1 };
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

/** A `drafts/<id>` record, or `null` when the id or any required field is not valid. */
export function parseDraftHead(id: string, value: unknown): DraftHead | null {
  if (!DRAFT_ID_PATTERN.test(id) || typeof value !== 'object' || value === null) return null;
  const { kind, form, by, at, artifact, base, saved } = value as UnknownRecord;
  const known = findDashboardFormKey(form);
  if (
    kind !== 'remix' ||
    known === undefined ||
    typeof by !== 'string' ||
    by === '' ||
    typeof at !== 'number' ||
    !Number.isFinite(at) ||
    at <= 0
  )
    return null;
  return {
    id,
    kind,
    form: known,
    by,
    at,
    ...(typeof artifact === 'string' && artifact !== '' ? { artifact } : {}),
    base: draftText(base),
    ...(saved === true ? { saved } : {}),
  };
}

export function toDraftHeadRecord({ id: _id, ...rest }: DraftHead): DraftHeadRecord {
  return { v: 1, ...rest };
}

/** The open draft to show: the viewer's newest, else anyone's newest. */
export function pickDraftHead(heads: readonly DraftHead[], viewer: string): DraftHead | null {
  const open = heads
    .filter((head) => head.saved !== true)
    .sort((left, right) => right.at - left.at || compareDraftKeys(right.id, left.id));
  return open.find((head) => head.by === viewer) ?? open[0] ?? null;
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
  return fnv1a(text, 2166136261) + fnv1a(text, 19088743);
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
