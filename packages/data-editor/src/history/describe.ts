/**
 * What the History panel says about a version: when, who, a one-line
 * description of what changed, each change's name, and the two texts a
 * change's line diff compares. Pure, so it can be tested.
 */

import {
  DASH_LOOK_PATH,
  DASH_META_PATH,
  DASH_PARAMS_PATH,
  DASH_SETTINGS_PATH,
  DATASETS_COLLECTION,
  FILES_COLLECTION,
  getCollectionPath,
  getDocumentId,
  type UnknownRecord,
} from '@open-artifact/data-core';

export const VERSIONS_LABEL = 'Versions';
export const NO_VERSIONS_TITLE = 'No versions yet';
export const NO_VERSIONS_MESSAGE = 'Versions are saved automatically as the artifact is edited.';
export const HISTORY_UNREADABLE_MESSAGE = 'History can’t be read right now. Try again.';
export const CURRENT_VERSION_LABEL = 'Current';
export const AGENT_VERSION_LABEL = 'Agent';
export const SOMEONE_LABEL = 'Someone';
export const IS_NOW_MESSAGE = 'This is the artifact as it is now.';
export const RESTORE_LABEL = 'Restore';
export const RESTORING_LABEL = 'Restoring…';
export const RESTORED_MESSAGE = 'Restored.';
export const RESTORE_FAILED_MESSAGE = 'Couldn’t restore this version. Try again.';
export const RESTORE_NOT_ALLOWED_MESSAGE = 'You can’t restore versions of this artifact.';
export const RESTORE_GONE_MESSAGE = 'This version is no longer kept.';
export const RESTORE_EARLIER_TITLE = 'Restore this earlier version?';
export const BACK_TO_VERSIONS_LABEL = 'All versions';
export const BACK_TO_LATEST_LABEL = 'Back to latest';
export const TOO_MUCH_CHANGED_MESSAGE = 'Too much changed to show line by line.';
export const NO_HISTORY_BEFORE_MESSAGE = 'No version history before this one';
export const DRAFT_UNCHANGED_TITLE = 'No changes from the published artifact';
export const VERSION_CHANGE_LABELS: Readonly<Record<VersionChangeKind, string>> = { added: 'Added', removed: 'Removed', edited: 'Edited' };
export const VERSION_MARK_LABELS: Readonly<Record<'+' | '-', string>> = { '+': 'Added:', '-': 'Removed:' };

/** Who made a version (the history capability's author). */
export interface VersionAuthor {
  kind: 'person' | 'agent' | 'system';
  id: string;
  name: string;
}

/** What describing a version reads (the history capability's version). */
export interface DescribedVersion {
  n: number;
  at: string;
  author: VersionAuthor;
  files: readonly { path: string; op: 'added' | 'edited' | 'deleted' }[];
  restoredFrom?: number;
}

export type VersionChangeKind = 'added' | 'removed' | 'edited';

/** One dashboard document a version changed, by its store path (`datasets/x`, `files/index.html`, `dash/meta`). */
export interface VersionChange {
  path: string;
  kind: VersionChangeKind;
}

/** The store path of a history path (`db/datasets/x` → `datasets/x`); `null` for a path outside the store. */
export function storePathOf(historyPath: string): string | null {
  return historyPath.startsWith('db/') ? historyPath.slice(3) : null;
}

/** The history path of a store path. */
export function historyPathOf(storePath: string): string {
  return `db/${storePath}`;
}

export function isPageFilePath(path: string): boolean {
  return getCollectionPath(path) === FILES_COLLECTION;
}

function isDashboardPath(path: string): boolean {
  const collection = getCollectionPath(path);
  return collection === DATASETS_COLLECTION || collection === FILES_COLLECTION || collection === 'dash';
}

/** The dashboard documents a version changed: datasets and settings first, page files last, each by path. */
export function listVersionChanges(version: Pick<DescribedVersion, 'files'>): VersionChange[] {
  return version.files
    .flatMap((file): VersionChange[] => {
      const path = storePathOf(file.path);
      if (path === null || !isDashboardPath(path)) return [];
      return [{ path, kind: file.op === 'deleted' ? 'removed' : file.op }];
    })
    .sort((left, right) => Number(isPageFilePath(left.path)) - Number(isPageFilePath(right.path)) || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** Whether the dashboard had a page before `version`, from every path it left (`after`, history paths). */
export function hadPageBefore(version: Pick<DescribedVersion, 'files'>, after: readonly string[]): boolean {
  const added = new Set(version.files.filter((file) => file.op === 'added').map((file) => file.path));
  const before = [...after.filter((path) => !added.has(path)), ...version.files.filter((file) => file.op === 'deleted').map((file) => file.path)];
  return before.some((path) => {
    const store = storePathOf(path);
    return store !== null && isPageFilePath(store);
  });
}

/** Titles of the datasets a version touched, by store path; a dataset without one is named by its id. */
export type VersionTitles = Readonly<Record<string, string>>;

/** How a change reads: a page file's name, a dataset's title, "Title", "Filters", "Look" or "Settings". */
export function versionChangeName(change: VersionChange, titles: VersionTitles = {}): string {
  const collection = getCollectionPath(change.path);
  if (collection === FILES_COLLECTION) return getDocumentId(change.path);
  if (collection === DATASETS_COLLECTION) return titles[change.path] || getDocumentId(change.path);
  if (change.path === DASH_META_PATH) return 'Title';
  if (change.path === DASH_PARAMS_PATH) return 'Filters';
  if (change.path === DASH_LOOK_PATH) return 'Look';
  if (change.path === DASH_SETTINGS_PATH) return 'Settings';
  return change.path;
}

const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

function sourceCount(count: number): string {
  return count === 1 ? `${count} source` : `${count} sources`;
}

function startOfLocalDay(at: number): number {
  return new Date(at).setHours(0, 0, 0, 0);
}

/** "2:05 PM". */
export function formatVersionTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Nov 3", with the year when it is not `now`'s. */
export function formatVersionDate(at: number, now: number = Date.now()): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "Today", "Yesterday", "Monday" within a week, else "November 3" ("Nov 3, 2025" in another year). */
export function versionDayLabel(at: number, now: number = Date.now()): string {
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(at)) / 86_400_000);
  const date = new Date(at);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(
    undefined,
    date.getFullYear() === new Date(now).getFullYear() ? { month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

/** "Today at 2:05 PM", "Yesterday at …", "Monday at …" within a week, else "November 3 at …" ("Nov 3, 2025 at …" in another year). */
export function formatVersionDay(at: number, now: number = Date.now()): string {
  return `${versionDayLabel(at, now)} at ${formatVersionTime(at)}`;
}

/** "Nov 3, 2:05 PM", with the year when it is not `now`'s. */
export function formatShortDateTime(at: number, now: number = Date.now()): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** The version bar's words while an earlier version is on the page. */
export function viewingVersionMessage(at: number, now: number = Date.now()): string {
  return `You’re viewing an earlier version (${formatShortDateTime(at, now)}) with today’s data.`;
}

/**
 * Who made a version: "Agent", the person's name ("Someone" when it is not
 * known), "{name} + Agent" for a person's version the agent wrote, or ""
 * for the first version (made by no one in particular).
 */
export function versionWho(author: VersionAuthor, options: { withAgent?: boolean } = {}): string {
  if (author.kind === 'agent') return AGENT_VERSION_LABEL;
  if (author.kind === 'system') return '';
  const name = author.name || SOMEONE_LABEL;
  return options.withAgent === true ? `${name} + ${AGENT_VERSION_LABEL}` : name;
}

/** A version row's spoken label: "{when}, current version, {who}" and its shorter forms. */
export function describeVersionRowLabel(when: string, current: boolean, who: string): string {
  if (who === '') return current ? `${when}, current version` : when;
  return current ? `${when}, current version, ${who}` : `${when}, ${who}`;
}

/** The spoken name of a version row's Restore button. */
export function restoreVersionLabel(when: string): string {
  return `Restore the version from ${when}`;
}

/** What the question before restoring from the list says under its title. */
export function restoreEarlierDescription(when: string): string {
  return `${when}. Everyone will see it.`;
}

/** "{who} · {description}", or the description alone when no one is named. */
export function versionByline(who: string, description: string): string {
  return who === '' ? description : `${who} · ${description}`;
}

export interface DescribeVersionOptions {
  /** When the restored version was made (a restore's description names it). */
  restoredAt?: number;
  /** The dashboard had a page before this version; unknown: the entry page was added. */
  pageBefore?: boolean;
  titles?: VersionTitles;
  /** The oldest kept version, made by no one in particular: nothing came before it. */
  oldest?: boolean;
  now?: number;
}

/**
 * The one-line description of a version: "Restored the {time|date} version",
 * "Created the page", "Added / Removed / Edited {name}", "Edited the page",
 * "Edited {count} sources", "Edited the filters", "Edited the title", or
 * "Edited {a}, {b} and {c}" when several kinds of thing changed.
 */
export function describeDataVersion(version: DescribedVersion, options: DescribeVersionOptions = {}): string {
  const now = options.now ?? Date.now();
  const at = Date.parse(version.at);
  if (version.restoredFrom !== undefined && options.restoredAt !== undefined) {
    return formatVersionDate(options.restoredAt, now) === formatVersionDate(at, now)
      ? `Restored the ${formatVersionTime(options.restoredAt)} version`
      : `Restored the ${formatVersionDate(options.restoredAt, now)} version`;
  }
  if (version.restoredFrom !== undefined) return `Restored version ${version.restoredFrom}`;
  if (options.oldest === true && version.author.kind === 'system') return NO_HISTORY_BEFORE_MESSAGE;
  const changes = listVersionChanges(version);
  const sources = changes.filter((change) => getCollectionPath(change.path) === DATASETS_COLLECTION);
  const pageChanges = changes.filter((change) => isPageFilePath(change.path));
  const page = pageChanges.length > 0;
  const pageBefore = options.pageBefore ?? !pageChanges.some((change) => change.kind === 'added' && getDocumentId(change.path) === 'index.html');
  if (page && !pageBefore) return 'Created the page';
  const source = sources.length === 1 ? sources[0] : undefined;
  const named = source === undefined ? undefined : { kind: source.kind, name: versionChangeName(source, options.titles) };
  const changed = (path: string): boolean => changes.some((change) => change.path === path);
  const filters = changed(DASH_PARAMS_PATH);
  const parts: string[] = [];
  if (page) parts.push('the page');
  if (named !== undefined) parts.push(named.name);
  else if (sources.length > 1) parts.push(sourceCount(sources.length));
  if (filters) parts.push('the filters');
  if (changed(DASH_META_PATH)) parts.push('the title');
  if (changed(DASH_LOOK_PATH)) parts.push('the look');
  if (changed(DASH_SETTINGS_PATH)) parts.push('the settings');
  if (parts.length === 0) return 'Edited the artifact';
  if (parts.length > 1) return `Edited ${listFormat.format(parts)}`;
  if (named?.kind === 'added') return `Added ${named.name}`;
  if (named?.kind === 'removed') return `Removed ${named.name}`;
  if (named !== undefined) return `Edited ${named.name}`;
  if (page) return 'Edited the page';
  if (sources.length > 1) return `Edited ${sourceCount(sources.length)}`;
  return `Edited ${parts[0]!}`;
}

/** The spoken label of a folded page-file diff: "{name}: added, 3 lines added, 1 line removed". */
export function describeVersionDiffChange(name: string, kind: VersionChangeKind, tally: { added: number; removed: number } | null): string {
  const change = `${name}: ${kind}`;
  const lines = (count: number, what: string): string | null => (count === 0 ? null : `${count} ${count === 1 ? 'line' : 'lines'} ${what}`);
  const parts = [change, tally === null ? null : lines(tally.added, 'added'), tally === null ? null : lines(tally.removed, 'removed')];
  return parts.filter((part): part is string => part !== null).join(', ');
}

/* ------------------------------ Diff sides ------------------------------ */

type Doc = Record<string, unknown>;

function asDoc(value: unknown): Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Doc) : {};
}

function parseDoc(text: string | null): Doc | undefined {
  if (text === null) return undefined;
  try {
    return asDoc(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Doc)[key])]),
  );
}

/** A document without its edit stamp, which changes on every save. */
function withoutVolatile(doc: Doc): Doc {
  const { edit: _edit, ...rest } = doc;
  return rest;
}

function stable(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function docJson(doc: Doc | undefined): string {
  return doc === undefined ? '' : JSON.stringify(sortKeys(withoutVolatile(doc)), null, 2);
}

/** The before and after text of the one string argument that differs between two query documents, when nothing else does. */
function singleArgumentChange(was: Doc, now: Doc): [string, string] | null {
  const before = asDoc(asDoc(was['source'])['args']);
  const after = asDoc(asDoc(now['source'])['args']);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => stable(before[key] ?? null) !== stable(after[key] ?? null));
  const [key] = changed;
  if (changed.length !== 1 || key === undefined) return null;
  const left = before[key];
  const right = after[key];
  if (typeof left !== 'string' || typeof right !== 'string') return null;
  const rest = (doc: Doc, args: Doc): string => stable({ ...withoutVolatile(doc), source: { ...asDoc(doc['source']), args: { ...args, [key]: '' } } });
  return rest(was, before) === rest(now, after) ? [left, right] : null;
}

/**
 * The two texts a change's diff compares, from the history's before and
 * after JSON (`null`: no document on that side): a page file's text; the
 * same text twice when only the edit stamp changed; a query's one changed
 * string argument (its SQL, say); else the documents as sorted JSON.
 */
export function versionDiffSides(path: string, before: string | null, after: string | null): [string, string] {
  const was = parseDoc(before);
  const now = parseDoc(after);
  if (isPageFilePath(path)) {
    const text = (doc: Doc | undefined): string => (typeof doc?.['text'] === 'string' ? doc['text'] : '');
    return [text(was), text(now)];
  }
  if (was !== undefined && now !== undefined) {
    if (stable(withoutVolatile(was)) === stable(withoutVolatile(now))) return [docJson(now), docJson(now)];
    const single = singleArgumentChange(was, now);
    if (single !== null) return single;
  }
  return [docJson(was), docJson(now)];
}

/** A dataset document's title (from its JSON text), or "". */
export function datasetTitleOf(json: string | null): string {
  const title = parseDoc(json)?.['title'];
  return typeof title === 'string' ? title.trim() : '';
}

/* ------------------------------ The shared draft ------------------------------ */

/** A document publishing the shared draft would change, with its JSON now and in the draft (`null`: none). */
export interface DraftChange extends VersionChange {
  before: string | null;
  after: string | null;
}

/**
 * What publishing the shared draft would change: each document it writes (`written`, by store path) that differs
 * from the published one (`live`) by more than its edit stamp, in the order a version lists its changes.
 */
export function listDraftChanges(written: readonly (readonly [string, UnknownRecord])[], live: ReadonlyMap<string, UnknownRecord>): DraftChange[] {
  return written
    .flatMap(([path, data]): DraftChange[] => {
      if (!isDashboardPath(path)) return [];
      const held = live.get(path);
      const before = held === undefined ? null : JSON.stringify(held);
      const after = JSON.stringify(data);
      const [was, now] = versionDiffSides(path, before, after);
      if (held !== undefined && was === now) return [];
      return [{ path, kind: held === undefined ? 'added' : 'edited', before, after }];
    })
    .sort((left, right) => Number(isPageFilePath(left.path)) - Number(isPageFilePath(right.path)) || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** The one-line description of the shared draft's changes, as a version made of them would read. */
export function describeDraftChanges(changes: readonly DraftChange[], options: { titles?: VersionTitles; pageBefore: boolean }): string {
  if (changes.length === 0) return DRAFT_UNCHANGED_TITLE;
  const files = changes.map((change) => ({ path: historyPathOf(change.path), op: change.kind === 'removed' ? ('deleted' as const) : change.kind }));
  return describeDataVersion({ n: 0, at: new Date(0).toISOString(), author: { kind: 'person', id: '', name: '' }, files }, options);
}
