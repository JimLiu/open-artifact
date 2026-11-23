/**
 * The live board: the sync engine bound to the board codec, with helpers to
 * read and change the board's content and title.
 */

import { BOARD_INKS_PATH, BOARD_RECORD_CODEC, inksToRecord, type DocumentValue, type OrderCarry } from '../codec.ts';
import { persistedElementByDerived } from '../derived.ts';
import type { ElementMeasures } from '../geometry.ts';
import { canonicalValuesEqual, isPlainRecord } from '../json.ts';
import { normalizeBoardInks, parseBoardContent } from '../normalize.ts';
import { MAX_BOARD_INKS, type Board, type BoardContent, type BoardElement, type BoardInk, type HexColor } from '../schema.ts';
import { followStickerHosts, rebindStickersToHosts, unmarkFollowedStickers } from '../sticker-hosts.ts';
import { createLiveStore, type LiveCache, type LiveCodec, type LiveStore } from './engine.ts';
import { SYSTEM_TIMERS, type SyncTimers, type SyncTransport } from './transport.ts';

/**
 * After someone else moves a sticker's host, the stickers that followed it
 * on this page are written back after about this long (times 1–3, so pages
 * rarely write together).
 */
export const STICKER_FOLLOW_WRITE_DELAY_MS = 1000;

/**
 * `next` with every part that equals `previous` replaced by the previous
 * object (elements, timer, inks, claims), so renders and memoized geometry
 * keep their identity. Returns `previous` itself when nothing changed.
 */
export function shareUnchangedContent(previous: BoardContent, next: BoardContent): BoardContent {
  if (previous === next) return previous;
  const before = new Map(previous.elements.map((element) => [element.id, element]));
  let sameElements = previous.elements.length === next.elements.length;
  const elements = next.elements.map((element, index): BoardElement => {
    const old = before.get(element.id);
    // A derived element equals its old copy only when both store the same twin.
    const kept =
      old !== undefined &&
      (old === element ||
        (canonicalValuesEqual(old, element) && canonicalValuesEqual(persistedElementByDerived.get(old), persistedElementByDerived.get(element))))
        ? old
        : element;
    if (kept !== previous.elements[index]) sameElements = false;
    return kept;
  });
  const share = <V>(a: V | undefined, b: V | undefined): V | undefined => (a === b || (a !== undefined && b !== undefined && canonicalValuesEqual(a, b)) ? a : b);
  const timer = share(previous.timer, next.timer);
  const inks = share(previous.inks, next.inks);
  const claimed = share(previous.claimed, next.claimed);
  if (sameElements && timer === previous.timer && inks === previous.inks && claimed === previous.claimed) return previous;
  return {
    elements: sameElements ? previous.elements : elements,
    ...(timer !== undefined ? { timer } : {}),
    ...(inks !== undefined ? { inks } : {}),
    ...(claimed !== undefined ? { claimed } : {}),
  };
}

/** {@link shareUnchangedContent} for a whole board. */
export function shareUnchangedBoard(previous: Board, next: Board): Board {
  const content = shareUnchangedContent(previous.content, next.content);
  return content === previous.content && next.title === previous.title ? previous : { title: next.title, content };
}

function normalizedInks(doc: DocumentValue): BoardInk[] {
  const { content } = BOARD_RECORD_CODEC.compose(new Map([[BOARD_INKS_PATH, doc]]));
  return normalizeBoardInks(content.inks ?? []);
}

const compareInks = (a: BoardInk, b: BoardInk) => a.at - b.at || (a.color < b.color ? -1 : a.color > b.color ? 1 : 0);

/** The first later editor time reachable with a whole-millisecond increment. */
export function nextTimestampAfter(latestAt: number, now = Date.now()): number {
  if (!Number.isFinite(latestAt) || now > latestAt) return now;
  let step = 1;
  while (Number.isFinite(latestAt + step) && latestAt + step <= latestAt) step *= 2;
  const next = latestAt + step;
  return Number.isFinite(next) ? next : Number.MAX_VALUE;
}

/**
 * The board codec as the engine needs it. `parseContent` normalizes the
 * composed content (the editor may add steps, such as moving stickers with
 * their hosts).
 */
export function createBoardLiveCodec(parseContent: (raw: unknown) => BoardContent = parseBoardContent): LiveCodec<Board, OrderCarry> {
  const explicitInkRemovals = new Map<HexColor, number>();
  return {
    collections: BOARD_RECORD_CODEC.collections,
    metaPath: BOARD_RECORD_CODEC.metaPath,
    decompose: (board, previous, carry) => BOARD_RECORD_CODEC.decompose(board, previous, carry),
    compose(documents) {
      const composed = BOARD_RECORD_CODEC.compose(documents);
      return { value: { title: composed.title, content: parseContent(composed.content) }, carry: composed.carry };
    },
    replaceOnly: BOARD_RECORD_CODEC.replaceOnly,
    mergeOnCreate: path => path === BOARD_INKS_PATH,
    noteServer(path, server, hasLocalEdits) {
      if (path !== BOARD_INKS_PATH || explicitInkRemovals.size === 0) return;
      if (!hasLocalEdits || !server) {
        explicitInkRemovals.clear();
        return;
      }
      const present = new Map(normalizedInks(server).map(ink => [ink.color, ink.at]));
      for (const [color, at] of explicitInkRemovals) {
        if (present.get(color) !== at) explicitInkRemovals.delete(color);
      }
    },
    noteCommit(path, previous, next) {
      if (path !== BOARD_INKS_PATH) return;
      if (!next) { explicitInkRemovals.clear(); return; }
      const prevInks = previous ? normalizedInks(previous) : [], nextInks = normalizedInks(next);
      const prevColors = new Set(prevInks.map(ink => ink.color));
      const nextColors = new Set(nextInks.map(ink => ink.color));
      for (const color of nextColors) explicitInkRemovals.delete(color);
      const added = nextInks.filter(ink => !prevColors.has(ink.color)).length;
      const evicted = nextInks.length < MAX_BOARD_INKS ? 0 : Math.max(0, prevInks.length + added - MAX_BOARD_INKS);
      for (const ink of prevInks.slice(evicted)) {
        if (!nextColors.has(ink.color)) explicitInkRemovals.set(ink.color, ink.at);
      }
    },
    normalizeDocument(path, doc) {
      if (path !== BOARD_INKS_PATH) return doc;
      return { ...inksToRecord(normalizedInks(doc)) };
    },
    rebaseDocument(path, previousBase, nextBase, patch) {
      if (path !== BOARD_INKS_PATH) return undefined;
      const currInks = normalizedInks(nextBase);
      if (!isPlainRecord(patch.colors)) return { ...inksToRecord(currInks) };
      const prevInks = previousBase ? normalizedInks(previousBase) : [];
      const prevMap = new Map(prevInks.map(ink => [ink.color, ink.at]));
      const currMap = new Map(currInks.map(ink => [ink.color, ink.at]));
      const additions = normalizedInks({ colors: patch.colors }).filter(ink => prevMap.get(ink.color) !== ink.at);
      const addedUnique = additions.filter(ink => !prevMap.has(ink.color)).length;
      const autoEvictedCount = Math.max(0, prevInks.length + addedUnique - MAX_BOARD_INKS);
      const autoEvicted = new Set(prevInks.slice(0, autoEvictedCount).map(ink => ink.color));
      const explicitRemovals = new Set<HexColor>();
      for (const [hex, value] of Object.entries(patch.colors)) {
        const color: HexColor = `#${hex}`;
        const at = prevMap.get(color);
        if (value === null && at !== undefined && currMap.get(color) === at &&
            (!autoEvicted.has(color) || explicitInkRemovals.get(color) === at)) {
          explicitRemovals.add(color);
        }
      }

      const ownMap = new Map(additions.map(ink => [ink.color, ink.at]));
      const merged = currInks.filter(ink => !explicitRemovals.has(ink.color)).map(ink => {
        const ownAt = ownMap.get(ink.color);
        return ownAt === undefined ? ink : { ...ink, at: Math.max(ink.at, ownAt) };
      });
      merged.push(...additions.filter(ink => !currMap.has(ink.color)));
      const excess = merged.length - MAX_BOARD_INKS;
      if (excess <= 0) return { ...inksToRecord(normalizeBoardInks(merged)) };

      // Evict unchanged inks from the original palette before either editor's additions.
      const oldSurvivors: BoardInk[] = [], peerPostBase: BoardInk[] = [], ownInks: BoardInk[] = [];
      for (const ink of merged.sort(compareInks)) {
        if (ownMap.has(ink.color)) ownInks.push(ink);
        else if (prevMap.get(ink.color) === ink.at) oldSurvivors.push(ink);
        else peerPostBase.push(ink);
      }
      const peerEvict = peerPostBase.length + ownInks.length - MAX_BOARD_INKS;
      if (peerEvict > 0 && peerEvict <= peerPostBase.length && ownInks.length > 0 && compareInks(ownInks[0]!, peerPostBase[peerEvict - 1]!) <= 0) {
        // After full turnover, keep a slow clock from making this retry evict its own additions.
        let cursor = peerPostBase[peerPostBase.length - 1]!.at;
        for (const [i, ink] of ownInks.entries()) {
          cursor = nextTimestampAfter(cursor, ink.at);
          ownInks[i] = { ...ink, at: cursor };
        }
      }
      return { ...inksToRecord(normalizeBoardInks([...oldSurvivors.slice(excess), ...peerPostBase, ...ownInks])) };
    },
    sameDocument(previous, current, pendingPush) {
      const prevInks = normalizedInks(previous), currInks = normalizedInks(current);
      if (!prevInks.length) return true;
      if (!currInks.length) return false;
      const currMap = new Map(currInks.map(ink => [ink.color, ink.at]));
      const sameInk = (ink: BoardInk) => currMap.get(ink.color) === ink.at;
      const firstKept = prevInks.findIndex(sameInk);
      if (firstKept < 0) {
        return pendingPush === true && prevInks.length === 1 && currInks.length === 1 && prevInks[0]!.color === currInks[0]!.color;
      }
      if (pendingPush) {
        let kept = 0;
        for (const ink of prevInks) if (sameInk(ink)) kept++;
        const dropped = prevInks.length - kept;
        const added = currInks.length - kept;
        return dropped === 0 || (dropped === 1 && added <= 1);
      }
      if (!prevInks.slice(firstKept).every(sameInk)) return false;
      if (firstKept === 0) return true;
      if (currInks.length < MAX_BOARD_INKS) return false;
      if (prevInks.length >= MAX_BOARD_INKS) {
        const prevColors = new Set(prevInks.map(ink => ink.color));
        if (!currInks.some(ink => !prevColors.has(ink.color))) return false;
      }
      return compareInks(prevInks[firstKept - 1]!, currInks[0]!) < 0;
    },
    refuse: BOARD_RECORD_CODEC.refuse,
    share: shareUnchangedBoard,
  };
}

/** Options of {@link createLiveBoardDocument}. */
export interface LiveBoardOptions {
  transport: SyncTransport;
  /** Keeps a saved copy on the device, shown while the store is out of reach. */
  cache?: LiveCache;
  /** Viewers never write. */
  readOnly?: boolean;
  timers?: SyncTimers;
  formatTime?: (epochMs: number) => string;
  /** The board shown while loading. */
  initial?: Board;
  /** Normalizes composed content (default: `parseBoardContent`); stickers then follow their hosts. */
  parseContent?: (raw: unknown) => BoardContent;
  /** The page's measured sizes, so stickers find their hosts as drawn. */
  measures?: () => ElementMeasures | undefined;
}

/** A live board. */
export interface LiveBoardDocument extends LiveStore<Board> {
  content(): BoardContent;
  title(): string;
  /** Replaces the content (title kept). */
  setContent(content: BoardContent): boolean;
  /** Changes the content with a function of the current one. */
  updateContent(updater: (content: BoardContent) => BoardContent): boolean;
  setTitle(title: string): boolean;
}

/** An empty board. */
export const EMPTY_BOARD: Board = { title: '', content: { elements: [] } };

/** `content` with `elements`, or `content` itself when they are the same array. */
function withElements(content: BoardContent, elements: readonly BoardElement[]): BoardContent {
  return elements === content.elements ? content : { ...content, elements: [...elements] };
}

/**
 * Creates a live board and starts loading it.
 *
 * Stickers sit on hosts: when someone else moves a host, its stickers
 * follow it on load as derived elements (shown moved, stored unmoved), and
 * a writing page stores the followed positions a moment later. Local edits
 * refresh the stickers' host records.
 */
export function createLiveBoardDocument(options: LiveBoardOptions): LiveBoardDocument {
  const parse = options.parseContent ?? parseBoardContent;
  const measures = options.measures ?? (() => undefined);
  const timers = options.timers ?? SYSTEM_TIMERS;
  const store = createLiveStore<Board>({
    transport: options.transport,
    codec: createBoardLiveCodec((raw) => {
      const parsed = parse(raw);
      return withElements(parsed, followStickerHosts(parsed.elements, measures()));
    }),
    initial: options.initial ?? EMPTY_BOARD,
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
    ...(options.timers !== undefined ? { timers: options.timers } : {}),
    ...(options.formatTime !== undefined ? { formatTime: options.formatTime } : {}),
  });
  const setContent = (content: BoardContent): boolean => {
    const board = store.value();
    if (content === board.content) return store.canEdit();
    return store.commit({ title: board.title, content: withElements(content, rebindStickersToHosts(board.content.elements, content.elements, measures())) });
  };

  // Store the positions of stickers that followed a host someone else moved.
  let settleTimer: unknown;
  let firstRemoteAt: number | undefined;
  const scheduleStickerWrite = (retried = false): void => {
    timers.clearTimeout(settleTimer);
    const delay = STICKER_FOLLOW_WRITE_DELAY_MS * (1 + 2 * timers.random());
    const dueAt = timers.now() + delay;
    settleTimer = timers.setTimeout(() => {
      // The page slept through the delay: wait once more so a waking page does not write stale positions.
      if (!retried && timers.now() - dueAt >= STICKER_FOLLOW_WRITE_DELAY_MS) return scheduleStickerWrite(true);
      firstRemoteAt = undefined;
      if (store.getSnapshot().loadState !== 'live') return;
      const board = store.value();
      const elements = unmarkFollowedStickers(board.content.elements);
      if (elements !== board.content.elements) store.commit({ title: board.title, content: withElements(board.content, elements) });
    }, delay);
  };
  const unsubscribe = store.subscribe((change) => {
    if (!change.remote || !store.canEdit()) return;
    firstRemoteAt ??= timers.now();
    // A steady stream of remote edits must not postpone the write forever.
    if (timers.now() - firstRemoteAt <= 5 * STICKER_FOLLOW_WRITE_DELAY_MS) scheduleStickerWrite();
  });

  return {
    ...store,
    content: () => store.value().content,
    title: () => store.value().title,
    setContent,
    updateContent: (updater) => setContent(updater(store.value().content)),
    setTitle(title) {
      const board = store.value();
      return title === board.title ? store.canEdit() : store.commit({ title, content: board.content });
    },
    dispose() {
      unsubscribe();
      timers.clearTimeout(settleTimer);
      store.dispose();
    },
  };
}
