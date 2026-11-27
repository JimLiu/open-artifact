import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, afterEach, before, describe, it } from 'node:test';
import {
  EMPTY_DASHBOARD_CONTENT,
  SHARED_DRAFT_ID,
  draftDocumentPath,
  draftHeadPath,
  toDraftHeadRecord,
  type DashboardContent,
  type DraftHead,
  type PastDraftHead,
  type SharedDraftHead,
  type UnknownRecord,
} from '@open-artifact/data-core';
import type { DbDocument, DbWrite, JsonRecord } from '@open-artifact/runtime';
import { describeDraftChanges, listDraftChanges, DRAFT_UNCHANGED_TITLE } from '../src/history/describe.ts';

// The flow's toasts come from the ui package, whose components the test runner can't load: a stub keeps them.
const stub = new URL('./toast-stub.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@open-artifact/ui') return { url: stub, shortCircuit: true };
    return next(specifier, context);
  },
});

type Flow = typeof import('../src/drafts/shared-flow.ts');
type Drafts = typeof import('../src/state/drafts.ts');
type Words = typeof import('../src/drafts/words.ts');
let flow: Flow;
let drafts: Drafts;
let words: Words;
let toasts: { title?: string; actionProps?: { onClick?: () => void } }[];
let provideSession: typeof import('../src/services/session.ts').provideSession;
let useDocument: typeof import('../src/state/document.ts').useDocument;
let useAgentActivity: typeof import('../src/platform/agent-activity.ts').useAgentActivity;
let contentHash: typeof import('../src/drafts/draft-state.ts').contentHash;

before(async () => {
  flow = await import('../src/drafts/shared-flow.ts');
  drafts = await import('../src/state/drafts.ts');
  words = await import('../src/drafts/words.ts');
  ({ toasts } = await import('./toast-stub.ts'));
  ({ provideSession } = await import('../src/services/session.ts'));
  ({ useDocument } = await import('../src/state/document.ts'));
  ({ useAgentActivity } = await import('../src/platform/agent-activity.ts'));
  ({ contentHash } = await import('../src/drafts/draft-state.ts'));
});

/** A document store in memory, as the host's `db` answers. */
function memoryDb(seed: Record<string, UnknownRecord> = {}) {
  const docs = new Map<string, JsonRecord>(Object.entries(seed) as [string, JsonRecord][]);
  const merge = (base: UnknownRecord, patch: UnknownRecord): UnknownRecord => {
    const out: UnknownRecord = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete out[key];
      else if (typeof value === 'object' && !Array.isArray(value)) out[key] = merge((out[key] as UnknownRecord | undefined) ?? {}, value as UnknownRecord);
      else out[key] = value;
    }
    return out;
  };
  return {
    docs,
    async get(path: string): Promise<JsonRecord | null> {
      return docs.get(path) ?? null;
    },
    async list(collection: string): Promise<DbDocument[]> {
      const prefix = `${collection}/`;
      return [...docs]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([path, data]) => ({ path, data }) as DbDocument);
    },
    async write(writes: DbWrite[]): Promise<void> {
      for (const write of writes) {
        if (write.op === 'set') docs.set(write.path, write.data);
        else if (write.op === 'delete') docs.delete(write.path);
        else if (write.op === 'update') docs.set(write.path, merge(docs.get(write.path) ?? {}, write.patch as UnknownRecord) as JsonRecord);
      }
    },
    onChange: () => () => {},
  };
}

type MemoryDb = ReturnType<typeof memoryDb>;

const live: DashboardContent = { ...EMPTY_DASHBOARD_CONTENT, files: [{ name: 'index.html', text: '<main>Live</main>' }] };
const sales = { title: 'Sales', source: { kind: 'inline', rows: [] } };

function useStore(db: MemoryDb, heads: DraftHead[], content: DashboardContent = live): void {
  provideSession({
    db,
    viewer: { id: 'me', name: 'Me', role: 'editor' },
    peerId: 'me',
    canEdit: true,
    canRestore: true,
    canComment: true,
    canRemoveComments: true,
    canAsk: true,
    canSaveToHost: true,
    mcp: null,
    comments: null,
    assets: null,
    agent: null,
    room: null,
    downloads: null,
    history: null,
    shell: null,
  } as unknown as Parameters<typeof provideSession>[0]);
  for (const head of heads) db.docs.set(draftHeadPath(head.id), toDraftHeadRecord(head) as unknown as JsonRecord);
  drafts.useDrafts.setState({ heads, loaded: true });
  useDocument.setState({ status: 'ready', content, canWrite: true, documents: new Map([['files/index.html', { text: '<main>Live</main>' }]]) });
}

const sharedHead = (extra: Partial<SharedDraftHead> = {}): SharedDraftHead => ({ id: SHARED_DRAFT_ID, kind: 'edit', by: 'me', at: 1, base: '', ...extra });
const inShared = (path: string): string => draftDocumentPath(SHARED_DRAFT_ID, path);
const storedHead = (db: MemoryDb, id = SHARED_DRAFT_ID): UnknownRecord | undefined => db.docs.get(draftHeadPath(id)) as UnknownRecord | undefined;

async function until(check: () => boolean, what: string, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  drafts.useDrafts.setState({ heads: [], loaded: false, id: null, docs: new Map(), heard: false, shared: new Map(), sharedHeard: false });
  useAgentActivity.setState({ activity: 'unknown' });
  toasts.length = 0;
});

describe('settling the shared draft', () => {
  it('takes published changes out of the draft and keeps a past head without its documents', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    useStore(db, [sharedHead({ base: 'b1', editors: ['me'], agent: true })]);
    const shown = new Map<string, UnknownRecord>([['datasets/sales', sales]]);
    const settled = await drafts.settleSharedDraft(shown, { id: 'p1', what: 'saved', by: 'me' }, { base: 'b2' });
    assert.equal(settled?.left, false);
    assert.equal(db.docs.has(inShared('datasets/sales')), false);
    assert.equal(db.docs.has(draftDocumentPath('p1', 'datasets/sales')), false, 'a publish keeps no copy');
    const head = storedHead(db)!;
    assert.equal(head.base, '');
    assert.equal(head.agent, undefined);
    assert.deepEqual(head.editors ?? {}, {});
    assert.equal(settled?.past?.what, 'saved');
    assert.equal(settled?.past?.bytes, 0);
    assert.equal(storedHead(db, 'p1')?.what, 'saved');
  });

  it('keeps discarded changes under the past head, to restore', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    useStore(db, [sharedHead({ base: 'b1' })]);
    const settled = await drafts.settleSharedDraft(new Map([['datasets/sales', sales]]), { id: 'p2', what: 'discarded', by: 'me' });
    assert.deepEqual(db.docs.get(draftDocumentPath('p2', 'datasets/sales')), sales);
    assert.equal(db.docs.has(inShared('datasets/sales')), false);
    assert.ok((settled?.past?.bytes ?? 0) > 0);
    assert.equal(settled?.past?.base, 'b1');
  });

  it('leaves what changed after it was shown, and says so', async () => {
    const newer = { ...sales, title: 'Newer' };
    const db = memoryDb({ [inShared('datasets/sales')]: newer, [inShared('dash/params')]: { region: 'west' } });
    useStore(db, [sharedHead({ base: 'b1', editors: ['me', 'other'] })]);
    const shown = new Map<string, UnknownRecord>([
      ['datasets/sales', sales],
      ['dash/params', { region: 'west' }],
    ]);
    const settled = await drafts.settleSharedDraft(shown, { id: 'p3', what: 'saved', by: 'me' }, { base: 'b2' });
    assert.equal(settled?.left, true);
    assert.deepEqual(db.docs.get(inShared('datasets/sales')), newer, 'the newer change stays');
    assert.equal(db.docs.has(inShared('dash/params')), false);
    const head = storedHead(db)!;
    assert.equal(head.base, 'b2', 'what is left now builds on what was published');
  });

  it('keeps no past head when quiet', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    useStore(db, [sharedHead({ base: 'b1' })]);
    const settled = await drafts.settleSharedDraft(new Map([['datasets/sales', sales]]), { id: 'p4', what: 'discarded', by: 'me' }, { quiet: true });
    assert.equal(settled?.past, null);
    assert.equal(storedHead(db, 'p4'), undefined);
  });
});

describe('restoring a discarded draft', () => {
  const past = (extra: Partial<PastDraftHead> = {}): PastDraftHead => ({ id: 'p5', kind: 'past', what: 'discarded', by: 'other', at: 5, base: 'b0', bytes: 10, editors: ['other'], ...extra });

  it('puts its changes back into an empty draft, built on what it began from', async () => {
    const db = memoryDb({ [draftDocumentPath('p5', 'datasets/sales')]: sales });
    useStore(db, [sharedHead({ base: '' }), past()]);
    assert.equal(await drafts.restorePastDraft(past(), 'now', false, 'me'), 'done');
    const restored = db.docs.get(inShared('datasets/sales')) as UnknownRecord;
    assert.equal(restored.title, 'Sales');
    assert.equal((restored.edit as UnknownRecord).by, 'me');
    const head = storedHead(db)!;
    assert.equal(head.base, 'b0');
    assert.equal(head.held, true, 'a restored draft waits to be published by hand');
    assert.deepEqual(head.editors, { other: true });
    await until(() => !db.docs.has(draftHeadPath('p5')), 'the past draft to be dropped');
  });

  it('asks before replacing newer changes to the same documents', async () => {
    const db = memoryDb({ [draftDocumentPath('p5', 'datasets/sales')]: sales, [inShared('datasets/sales')]: { ...sales, title: 'Mine' } });
    useStore(db, [sharedHead({ base: 'b1' }), past()]);
    assert.equal(await drafts.restorePastDraft(past(), 'b1', false, 'me'), 'clash');
    assert.equal((db.docs.get(inShared('datasets/sales')) as UnknownRecord).title, 'Mine');
    assert.equal(await drafts.restorePastDraft(past(), 'b1', true, 'me'), 'done');
    assert.equal((db.docs.get(inShared('datasets/sales')) as UnknownRecord).title, 'Sales');
    assert.equal(storedHead(db)!.base, 'b1', 'a draft that holds changes keeps its base');
  });

  it('says when nothing of it is left', async () => {
    const db = memoryDb();
    useStore(db, [sharedHead(), past()]);
    assert.equal(await drafts.restorePastDraft(past(), 'b1', false, 'me'), 'gone');
  });
});

describe('the shared draft flow', () => {
  let stop: (() => void) | null = null;
  after(() => stop?.());
  afterEach(() => {
    stop?.();
    stop = null;
  });

  async function start(db: MemoryDb, head: SharedDraftHead, content: DashboardContent = live): Promise<void> {
    useStore(db, [head], content);
    stop = flow.startSharedDraft();
    await until(() => flow.useSharedDraft.getState().view.ready, 'the draft to be read');
  }

  /** The agent's turn writes `data` at `path` in the draft; the page hears of it as the store would tell it. */
  async function agentTurn(db: MemoryDb, path: string, data: UnknownRecord): Promise<void> {
    useAgentActivity.setState({ activity: 'working' });
    await until(() => flow.useSharedDraft.getState().turn, 'the turn to begin');
    db.docs.set(inShared(path), data as JsonRecord);
    drafts.useDrafts.setState({ shared: new Map([...drafts.useDrafts.getState().shared, [path, data]]) });
    useAgentActivity.setState({ activity: 'idle' });
  }

  // 2026-11-27: the base was stamped from the artifact before it had loaded, so a draft began on a loading page counted
  // the artifact as changed since and was held instead of published.
  it('takes the draft’s base from the artifact once it has loaded', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    useStore(db, [sharedHead()]);
    useDocument.setState({ status: 'connecting', content: EMPTY_DASHBOARD_CONTENT });
    stop = flow.startSharedDraft();
    await until(() => flow.useSharedDraft.getState().view.ready, 'the draft to be read');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(storedHead(db)?.base, '', 'a base was taken from an artifact still loading');
    assert.equal(flow.useSharedDraft.getState().changedSince, false);
    useDocument.setState({ status: 'ready', content: live });
    await until(() => storedHead(db)?.base === contentHash(live), 'the base to be taken from the loaded artifact');
  });

  it('holds the draft after the turn when it holds another editor’s changes', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    await start(db, sharedHead({ base: contentHash(live), editors: ['other'] }));
    await agentTurn(db, 'dash/params', { region: 'east' });
    await until(() => storedHead(db)?.held === true, 'the draft to be held');
    assert.ok(toasts.some((item) => item.title === words.SHARED_OTHERS_HOLD_MESSAGE));
    assert.ok(!toasts.some((item) => item.title === words.SHARED_PARTLY_PUBLISHED_MESSAGE), 'no publish was tried');
    assert.equal(db.docs.has(inShared('datasets/sales')), true);
    assert.equal(flow.useSharedDraft.getState().steps.undo.length, 1);
  });

  it('holds the draft after the turn when the artifact changed after it began', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    await start(db, sharedHead({ base: 'an older artifact' }));
    assert.equal(flow.useSharedDraft.getState().changedSince, true);
    await agentTurn(db, 'dash/params', { region: 'east' });
    await until(() => storedHead(db)?.held === true, 'the draft to be held');
    assert.ok(!toasts.some((item) => item.title === words.SHARED_OTHERS_HOLD_MESSAGE));
    assert.ok(!toasts.some((item) => item.title === words.SHARED_PARTLY_PUBLISHED_MESSAGE), 'no publish was tried');
  });

  it('publishes by itself after the turn when nothing holds it back', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    await start(db, sharedHead({ base: contentHash(live) }));
    await agentTurn(db, 'dash/params', { region: 'east' });
    // There is no live document here, so the publish is tried and fails: that it was tried is what counts.
    await until(() => toasts.some((item) => item.title === words.SHARED_PARTLY_PUBLISHED_MESSAGE), 'the publish to be tried');
  });

  it('writes a source change into the draft as one step, which undo takes back', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    await start(db, sharedHead({ base: contentHash(live) }), { ...live, autoPublish: false });
    assert.equal(flow.isJointEditing(), true);
    await flow.patchSharedSource('sales', { title: 'Revenue' });
    const written = db.docs.get(inShared('datasets/sales')) as UnknownRecord;
    assert.equal(written.title, 'Revenue');
    assert.equal((written.edit as UnknownRecord).by, 'me');
    await until(() => flow.useSharedDraft.getState().steps.undo.length === 1, 'the step to be kept');
    await until(() => (storedHead(db)?.editors as UnknownRecord | undefined)?.me === true, 'the change to be credited');
    flow.undoShared();
    await until(() => (db.docs.get(inShared('datasets/sales')) as UnknownRecord).title === 'Sales', 'the change to be undone');
  });

  it('writes a source change over the published source when the draft has none', async () => {
    const db = memoryDb({ [inShared('files/index.html')]: { text: '<main>Draft</main>' } });
    await start(db, sharedHead({ base: contentHash(live) }), { ...live, autoPublish: false });
    useDocument.setState({ documents: new Map([['datasets/sales', sales]]) });
    await flow.patchSharedSource('sales', { description: 'By month' });
    const written = db.docs.get(inShared('datasets/sales')) as UnknownRecord;
    assert.equal(written.title, 'Sales');
    assert.equal(written.description, 'By month');
    await assert.rejects(flow.patchSharedSource('gone', { title: 'x' }), /no draft to write to/);
  });

  it('discards with Undo in its notice, which restores the draft', async () => {
    const db = memoryDb({ [inShared('datasets/sales')]: sales });
    await start(db, sharedHead({ base: contentHash(live) }));
    flow.discardShared();
    assert.equal(flow.useSharedDraft.getState().asking, 'discard');
    flow.answerShared(true);
    await until(() => toasts.some((item) => item.title === words.DRAFT_DISCARDED_TOAST), 'the discard notice');
    assert.equal(db.docs.has(inShared('datasets/sales')), false);
    toasts.find((item) => item.title === words.DRAFT_DISCARDED_TOAST)?.actionProps?.onClick?.();
    await until(() => db.docs.has(inShared('datasets/sales')), 'the draft to come back');
    assert.equal(storedHead(db)?.held, true);
  });
});

describe('what publishing the shared draft would change', () => {
  const liveDocs = new Map<string, UnknownRecord>([
    ['datasets/sales', { ...sales, edit: { by: 'other', byAt: 1 } }],
    ['files/index.html', { text: '<main>Live</main>' }],
  ]);

  it('lists the documents that differ by more than their edit stamp, page files last', () => {
    const changes = listDraftChanges(
      [
        ['files/index.html', { text: '<main>Draft</main>' }],
        ['datasets/sales', { ...sales, edit: { by: 'me', byAt: 2 } }],
        ['datasets/costs', { title: 'Costs', source: { kind: 'inline', rows: [] } }],
      ],
      liveDocs,
    );
    assert.deepEqual(
      changes.map((change) => [change.path, change.kind]),
      [
        ['datasets/costs', 'added'],
        ['files/index.html', 'edited'],
      ],
    );
    assert.equal(describeDraftChanges(changes, { titles: { 'datasets/costs': 'Costs' }, pageBefore: true }), 'Edited the page and Costs');
  });

  it('says when nothing would change', () => {
    assert.equal(describeDraftChanges(listDraftChanges([['files/index.html', { text: '<main>Live</main>' }]], liveDocs), { pageBefore: true }), DRAFT_UNCHANGED_TITLE);
  });
});
