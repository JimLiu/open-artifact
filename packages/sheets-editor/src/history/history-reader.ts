import { createWorkbookNodeClient, failureOf } from '../store/workbook-node.ts';
import { syncRetryDelayMs } from '../store/workbook-sync.ts';
import {
  editsThatTakeBackRequest,
  readEditsThatTakeBack,
  whyRevisionNotLoaded,
  versionsRequest,
  readVersions,
  cellHistoryRequest,
  readCellHistory,
  rowHistoryRequest,
  readRowHistory,
  versionsWithChangesRequest,
  readVersionsWithChanges,
  setVersionNameRequest,
  versionNameOutcome,
  VERSIONS_PAGE_SIZE,
  type VersionNameOutcome,
  type VersionWithChanges,
} from './requests.ts';
import { versionKey } from './version-history.ts';
import { cleanTextForAgent, isPromptDataTooLong } from '../agent/prompt-text.ts';
import { taggedJson, type AgentPrompt } from '../format/conditional/agent-prompts.ts';
import type { AgentSampler } from '../agent/sampling.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { loadAtRevisionRequest, readLoadedOps, type LoadedOps } from '../store/requests.ts';
import type { StoreCall, StoreOutcome } from '../store/sheet-stream.ts';
import type { OpenedNode, ViewOnlyVersion } from '../store/sheet-connection.ts';
import { reportErrorSoftly } from '../engine/loader.ts';
import type { BrowserSide } from '../state/controller.ts';
import type { VersionOfWorkbook } from '../state/initial-state.ts';
import type {
  CellHistoryOutcome,
  EditsThatTakeBackOutcome,
  VersionsReadOutcome,
  WhyVersionNotShown,
} from '../state/event-reducer.ts';
import type { TakeBack, VersionsBefore } from './requests.ts';

/** An earlier version opened to be looked at, or why it was not. */
export type EarlierVersionOpened = { kind: 'read'; version: ViewOnlyVersion } | { kind: 'notRead'; why: WhyVersionNotShown };

/** The versions before a version with their changes, or why they were not read: no answer, or refused. */
export type ChangesOfVersions = VersionWithChanges[] | 'noAnswer' | 'refused';
/** The reads of the history the page asks of the store, the earlier versions it opens, and the names it gives versions. */
export type VersionHistoryReader = BrowserSide['versionHistory'] & {
  workbookOpened(node: OpenedNode): void;
  asItWas(revision: number, isStillWanted: () => boolean): Promise<EarlierVersionOpened>;
  changesOf(before: VersionsBefore | null, limit: number): Promise<ChangesOfVersions>;
  setName(revision: number, name: string | null): Promise<VersionNameOutcome>;
};
/** The one-line summary of a version: asked for, none to be had, or written. */
export type VersionSummary = { kind: 'awaited' } | { kind: 'none' } | { kind: 'written'; text: string };
/** The summaries of the unnamed versions in the history pane, by versionKey. */
export interface VersionSummaries {
  askAbout(read: Promise<VersionsReadOutcome>, before: VersionsBefore | null): Promise<void>;
  now(): ReadonlyMap<string, VersionSummary>;
  onChanged(listener: () => void): () => void;
  forgetAll(): void;
}
/** A version as it is told to the agent to be summed up. */
type VersionToSummarize = Pick<VersionWithChanges, 'revision' | 'firstRevision' | 'changes'>;

/** Any read of the history: of the versions, of edits that take back, or of the changes of a cell or row. */
type HistoryRead = VersionsReadOutcome | EditsThatTakeBackOutcome | CellHistoryOutcome;

export function createVersionHistoryReader(deps: { newOpId: () => string; wait: (ms: number) => Promise<void> }): VersionHistoryReader {
  let workbookNode: OpenedNode | null = null;
  // Each queue holds the last read asked for, so the next waits for it; what it came to is not looked at.
  let changesQueue: Promise<CellHistoryOutcome | void> = Promise.resolve();
  let asItWasQueue: Promise<EarlierVersionOpened | void> = Promise.resolve();
  let cachedVersions = new Map<number, LoadedOps>();
  let keepVersion = (revision: number, loaded: LoadedOps): void => {
    cachedVersions.delete(revision);
    cachedVersions.set(revision, loaded);
    for (let oldRevision of [...cachedVersions.keys()].slice(0, -MAX_CACHED_VERSION_BODIES)) cachedVersions.delete(oldRevision);
  };
  let askNode = async <Read extends HistoryRead>(
    requestFor: () => StoreCall,
    readReply: (reply: StoreOutcome) => Read,
    isStillWanted: () => boolean = () => true,
    attempt: number = 0,
  ): Promise<Read> => {
    if (workbookNode === null)
      return readReply({
        kind: 'notSent',
      });
    let { call, noteFailure } = workbookNode;
    let reply = await call(requestFor());
    let answer = readReply(reply);
    let isAnswerFine = answer.kind === 'read' || answer.why === 'changedSince' || answer.why === 'cellIsGone';
    let failure = isAnswerFine && answer.kind === 'notRead' ? null : failureOf(reply, isAnswerFine);
    if (failure !== null)
      noteFailure({
        ...failure,
        action: 'readHistory',
      });
    if (!(answer.kind === 'notRead' && answer.why === 'busy') || attempt + 1 === MAX_HISTORY_READ_TRIES) return answer;
    await deps.wait(syncRetryDelayMs(attempt));
    return isStillWanted() ? askNode(requestFor, readReply, isStillWanted, attempt + 1) : answer;
  };
  let collectEditsThatTakeBack = (takeBack: TakeBack): Promise<EditsThatTakeBackOutcome> =>
    askNode(() => editsThatTakeBackRequest(takeBack), readEditsThatTakeBack);
  let openAsItWas = async (revision: number, isStillWanted: () => boolean): Promise<EarlierVersionOpened> => {
    let node = workbookNode;
    if (node === null)
      return {
        kind: 'notRead',
        why: 'noAnswer',
      };
    if (node.openViewOnly === undefined)
      return {
        kind: 'notRead',
        why: 'notOffered',
      };
    let { call, noteFailure } = node;
    let isStillCurrent = () => isStillWanted() && workbookNode === node;
    let whyNotRead: WhyVersionNotShown = 'notOffered';
    let version = await node.openViewOnly(revision, {
      async loadOps() {
        if (!isStillCurrent()) return null;
        let cached = cachedVersions.get(revision);
        if (cached !== undefined) {
          keepVersion(revision, cached);
          return cached;
        }
        let reply = await call(loadAtRevisionRequest(revision));
        let loaded = readLoadedOps(reply);
        let ops = loaded !== null && typeof loaded === 'object' && 'ops' in loaded && loaded.revision === revision ? loaded : null;
        if (ops === null) whyNotRead = whyRevisionNotLoaded(reply);
        else keepVersion(revision, ops);
        let failure = failureOf(reply, ops !== null);
        if (failure !== null)
          noteFailure({
            ...failure,
            action: 'readHistory',
          });
        return loaded === 'pageOutOfDate' ? loaded : ops;
      },
      save: () =>
        Promise.resolve({
          kind: 'notSent',
        }),
      loadSliceOfTableFile: createWorkbookNodeClient(call, noteFailure).loadSliceOfTableFile,
      askRevision: () => Promise.resolve(revision),
    });
    if (!isStillCurrent()) version?.end();
    if (!isStillCurrent())
      return {
        kind: 'notRead',
        why: 'calledOff',
      };
    return version === null
      ? {
          kind: 'notRead',
          why: whyNotRead,
        }
      : {
          kind: 'read',
          version,
        };
  };
  let asItWas = (revision: number, isStillWanted: () => boolean): Promise<EarlierVersionOpened> => {
    let opened: Promise<EarlierVersionOpened> = asItWasQueue
      .then(
        (): Promise<EarlierVersionOpened> | EarlierVersionOpened =>
          isStillWanted()
            ? openAsItWas(revision, isStillWanted)
            : {
                kind: 'notRead',
                why: 'calledOff',
              },
      )
      .catch(
        (error: unknown) => (
          reportErrorSoftly(error, 'versionHistory'),
          {
            kind: 'notRead',
            why: 'refused',
          }
        ),
      );
    asItWasQueue = opened;
    return opened;
  };
  let queueChangesRead = (
    requestFor: () => StoreCall,
    readReply: (reply: StoreOutcome) => CellHistoryOutcome,
    isStillWanted: () => boolean,
  ): Promise<CellHistoryOutcome> => {
    let changesRead = changesQueue.then(
      () =>
        isStillWanted()
          ? askNode(requestFor, readReply, isStillWanted)
          : readReply({
              kind: 'notSent',
            }),
    );
    changesQueue = changesRead;
    return changesRead;
  };
  return {
    workbookOpened(node) {
      workbookNode = node;
      cachedVersions.clear();
    },
    asItWas,
    versions: (before) => askNode(() => versionsRequest(before ?? null), readVersions),
    async changesOf(before, limit) {
      if (workbookNode === null) return 'noAnswer';
      let { call, noteFailure } = workbookNode;
      let reply = await call(versionsWithChangesRequest(before, limit));
      let read = readVersionsWithChanges(reply);
      let failure = reply.kind === 'answered' ? failureOf(reply, read.kind === 'read') : null;
      if (failure !== null)
        noteFailure({
          ...failure,
          action: 'readHistory',
        });
      if (read.kind === 'read') return read.versions;
      return reply.kind === 'answered' ? 'refused' : 'noAnswer';
    },
    editsThatTakeBack: (takeBack) => collectEditsThatTakeBack(takeBack),
    async setName(revision, name) {
      if (workbookNode === null) return 'noAnswer';
      let { call, noteFailure } = workbookNode;
      let reply = await call(setVersionNameRequest(revision, name ?? ''));
      let failure = failureOf(reply, true);
      if (failure !== null)
        noteFailure({
          ...failure,
          action: 'nameVersion',
        });
      return versionNameOutcome(reply);
    },
    changesOfCell: (cell, isStillWanted) =>
      queueChangesRead(
        () => cellHistoryRequest(cell),
        (reply) => readCellHistory(reply, cell.columnId),
        isStillWanted,
      ),
    changesOfRow: (row, isStillWanted) =>
      queueChangesRead(() => rowHistoryRequest(row), readRowHistory, isStillWanted),
  };
}
// As many versions as fit go in one ask, and the summaries come back as one JSON object by version id.
export function summaryAskOf(versions: readonly VersionToSummarize[]): { asked: AgentPrompt; count: number } {
  let asked: AgentPrompt = {
    words: VERSION_SUMMARY_PROMPT,
    data: '',
  };
  let count = 0;
  for (let version of versions) {
    let next = {
      ...asked,
      data: `${asked.data}${versionTaggedForSummary(version)}
`,
    };
    if (count > 0 && isPromptDataTooLong(next)) break;
    asked = next;
    count += 1;
  }
  return {
    asked,
    count,
  };
}
export function summaryOfVersion(answer: unknown, revision: number): string | null {
  let written = isNonNullObject(answer) ? answer[String(revision)] : null;
  if (typeof written !== 'string') return null;
  let text = cleanTextForAgent(written.replaceAll(/\s+/g, ' '), MOST_SUMMARY_LENGTH).replace(/\.$/, '');
  return text === '' ? null : text;
}
// The one-line summaries of the unnamed versions in the history pane, written by the agent when it may be asked.
export function createVersionSummaries(deps: {
  agent: Pick<AgentSampler, 'askIfAllowed' | 'stop'>;
  canAskAgent: () => Promise<boolean>;
  changesOf: (before: VersionsBefore | null, limit: number) => Promise<ChangesOfVersions>;
  report: (error: unknown) => void;
}): VersionSummaries {
  let summaries = new Map<string, VersionSummary>();
  let listeners = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve();
  let sitting = {
    asksInVain: 0,
  };
  let change = (entries: readonly (readonly [string, VersionSummary | null])[]): void => {
    let next = new Map(summaries);
    for (let [key, summary] of entries)
      if (summary === null) next.delete(key);
      else next.set(key, summary);
    summaries = next;
    for (let listener of listeners) listener();
  };
  let isAwaited = (version: VersionToSummarize): boolean => summaries.get(versionKey(version))?.kind === 'awaited';
  let wantsSummary = (version: VersionOfWorkbook): boolean => version.name === undefined && !summaries.has(versionKey(version));
  let takeAnswer = (answer: unknown, versions: readonly VersionToSummarize[]): void => {
    let written = versions.filter(isAwaited).flatMap((version): [string, VersionSummary][] => {
      let text = summaryOfVersion(answer, version.revision);
      return text === null
        ? []
        : [
            [
              versionKey(version),
              {
                kind: 'written',
                text,
              },
            ],
          ];
    });
    if (written.length > 0) change(written);
  };
  let askInTurns = async (versions: readonly VersionToSummarize[], isStillWanted: () => boolean): Promise<void> => {
    if (versions.length === 0 || !isStillWanted()) return;
    let { asked, count } = summaryAskOf(versions);
    let askedAbout = versions.slice(0, count);
    let reply = await deps.agent.askIfAllowed(asked, (partial: unknown) => {
      if (isStillWanted()) takeAnswer(partial, askedAbout);
    });
    if (reply.kind !== 'answered' || !isStillWanted()) return;
    takeAnswer(reply.answer, askedAbout);
    await askInTurns(versions.slice(count), isStillWanted);
  };
  return {
    async askAbout(read, before) {
      let sittingAsked = sitting;
      let isStillWanted = () => sitting === sittingAsked;
      let [versionsRead, canAsk] = await Promise.all([read, deps.canAskAgent()]);
      if (versionsRead.kind === 'notRead' || !canAsk || !isStillWanted()) return;
      if (sittingAsked.asksInVain >= MOST_SUMMARY_ASKS_IN_VAIN) return;
      let { versions } = versionsRead;
      let [first, last] = [versions.findIndex(wantsSummary), versions.findLastIndex(wantsSummary)];
      if (first === -1) return;
      let keys = versions.filter(wantsSummary).map(versionKey);
      change(
        keys.map((key) => [
          key,
          {
            kind: 'awaited',
          },
        ]),
      );
      let isAnswered = true;
      let ask = async (): Promise<void> => {
        if (!isStillWanted()) return;
        let limit = Math.min(last - first + 2, VERSIONS_PAGE_SIZE);
        let changes = await deps.changesOf(versions[first - 1] ?? before, limit);
        isAnswered = changes !== 'noAnswer';
        if (!isStillWanted() || typeof changes === 'string') return;
        let asked = changes.filter((version) => keys.includes(versionKey(version)));
        let withNoActs = asked.filter((version) => hasActsToSummarize(version) === false);
        change(
          withNoActs.map((version) => [
            versionKey(version),
            {
              kind: 'none',
            },
          ]),
        );
        await askInTurns(
          asked.filter((version) => hasActsToSummarize(version) === true),
          isStillWanted,
        );
      };
      queue = queue
        .then(ask)
        .catch(deps.report)
        .finally(() => {
          if (!isStillWanted()) return;
          let stillAwaited = keys.filter((key) => summaries.get(key)?.kind === 'awaited');
          if (isAnswered && stillAwaited.length === keys.length) sittingAsked.asksInVain += 1;
          if (stillAwaited.length > 0) change(stillAwaited.map((key) => [key, null]));
        });
    },
    now: () => summaries,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    forgetAll() {
      sitting = {
        asksInVain: 0,
      };
      queue = Promise.resolve();
      deps.agent.stop();
      change([...summaries.keys()].map((key) => [key, null]));
    },
  };
}
export const MAX_CACHED_VERSION_BODIES = 4;
export const MAX_HISTORY_READ_TRIES = 3;
export const MOST_SUMMARY_LENGTH = 100;
export const VERSION_SUMMARY_PROMPT = `You write the one-line summaries in a spreadsheet's version history. The data lists versions, the newest first, each between <version> marks. A version is a run of edits. In its changes, "acts" counts what was done, by kind and sheet, with a few of the names, row labels and column headers concerned. "areActsLeftOut" says that more was done. "cells" is a small sample of the cells that were filled in, with what each holds. What a cell held before is not known. Names are as they are now, and renameSheet gives the new name. "isFirst" marks the version that made the spreadsheet.

For each version write what a colleague would need to pick it out of the list: what changed, in terms of what the sheet is about.
- 45 characters or fewer. Start with a verb in the past tense. Sentence case, no period, and "and" rather than "&".
- Name the column, row, sheet or chart by its label, as in: Updated prices for Ink and Pens. Deleted the Notes column. Sorted Orders by date. Give a cell's address only where there is no label.
- Lead with what matters most: what was deleted, new sheets and columns, changed values and formulas. Mention formatting only if little else was done.
- Where setCells counts more cells than the sample shows, speak of the columns or the data as a whole, and not of the rows in the sample.
- Name the sheet only where the versions are about more than one.
- No counts and no "all", since you see a sample. Say nothing that the data does not show, such as why, or that a number went up or down.
- Name no person, and do not name the agent.
- Write in the language of the sheet's own text.

Answer with one JSON object and nothing else: each version's id as a key, in the order given, and its summary as the value.`;
export const versionTaggedForSummary = ({ revision, firstRevision, changes }: VersionToSummarize): string =>
  taggedJson('version', {
    id: String(revision),
    ...(firstRevision === 1 && {
      isFirst: true,
    }),
    changes,
  });
export const hasActsToSummarize = ({ changes }: VersionToSummarize): boolean | null =>
  isNonNullObject(changes) && Array.isArray(changes.acts) ? changes.acts.length > 0 : null;
export const MOST_SUMMARY_ASKS_IN_VAIN = 2;
