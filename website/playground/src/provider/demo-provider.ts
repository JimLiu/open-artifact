/**
 * The playground's backend: a {@link CapabilityProvider} over the in-memory artifact, in place of the type server's
 * HTTP API. The demo Shell hands it to its capability broker (`resetBroker`), so the real editor, unchanged in its
 * frame, makes its usual `window.openartifact` calls and they land here.
 *
 * Shapes follow `@open-artifact/runtime`'s `capabilities.ts`; what a static site cannot do is said where it is left
 * out: `mcp` is not offered (no connectors). `doc` (the docs demo) and `sheet` (the sheets demo) are the real Docs host
 * and Sheets store from `packages/type-server`, bundled for the browser and loaded on those demos only
 * (`src/engines/`): their answers and frames reach the editor through the Shell's broker as a type server's would.
 */

import {
  ArtifactError,
  type AgentCapability,
  type ArtifactCapability,
  type AssetsCapability,
  type CapabilityMap,
  type CapabilityName,
  type CapabilityProvider,
  type CommentsCapability,
  type DbCapability,
  type DocCapability,
  type DownloadsCapability,
  type HistoryCapability,
  type RoomCapability,
  type SheetCapability,
  type UserCapability,
  type Viewer,
} from '@open-artifact/runtime';
import { saveInBrowser } from '../../../../packages/shell/src/shell/cloud-provider.ts';
import { seedBlobs, seedDocuments, seedFiles, withBlobUrls, type SeedManifest } from '../seeds/manifest.ts';
import { loadDocEngine, loadSheetEngine } from '../engines/load.ts';
import { CommentStore } from './comments.ts';
import { sha256 } from './events.ts';
import { SimAgent, type DemoEngines } from './sim-agent.ts';
import { DemoStore, PERSON } from './store.ts';

/** The one visitor of a playground page: its owner, so every control is there. */
export const VISITOR: Viewer = { id: PERSON.id, name: PERSON.name, role: 'owner' };

/** An upload, kept for the page's lifetime. */
interface Upload {
  blob: Blob;
  objectUrl: string;
}

export interface DemoArtifact {
  /** The demo's seed, its stored files as this page's `blob:` URLs. */
  seed: SeedManifest;
  store: DemoStore;
  comments: CommentStore;
  agent: SimAgent;
  provider: CapabilityProvider;
  /** Uploads by id (`/_blob/<id>`): kept, but not served (see `assets` below). */
  uploads: Map<string, Upload>;
  /** The docs and sheets demos' engines (null on the other demos). */
  engines: DemoEngines | null;
}

/** How long after the person's last edit through an engine its files are taken in as their version. */
const MIRROR_MS = 1000;

/** The seed's title: the demo's, else the board's or deck's own. */
export function titleOf(seed: SeedManifest): string {
  if (seed.title) return seed.title;
  for (const path of ['db/board/meta.json', 'project/deck.json', 'project/canvas.json', 'project/design-system.json', 'db/dash/meta.json', 'db/film/meta.json', 'doc/doc.json', 'sheet/sheet.json']) {
    const file = seed.files[path];
    if (file && 'text' in file) {
      const named = JSON.parse(file.text) as { title?: unknown; name?: unknown };
      const title = named.title ?? named.name;
      if (typeof title === 'string' && title) return title;
    }
  }
  return seed.typeTitle;
}

/**
 * The demo's artifact and its backend. `startWith` makes what the artifact holds at first from the seed (a replay
 * starts with less, and builds the rest: `src/replay/`); by default the whole seed.
 */
export async function createDemoArtifact(original: SeedManifest, startWith: (seed: SeedManifest) => SeedManifest = (seed) => seed): Promise<DemoArtifact> {
  // Stored files (`_blobs/`) become `blob:` URLs of this page, and the seed points at those.
  const blobUrls = new Map([...seedBlobs(original)].map(([id, blob]) => [id, URL.createObjectURL(blob)]));
  const seed = withBlobUrls(original, blobUrls);
  const first = startWith(seed);
  const store = new DemoStore(`demo-${seed.id}`, titleOf(seed));
  await store.load(seedFiles(first), seedDocuments(first));
  const comments = new CommentStore({ kind: 'person', name: VISITOR.name });
  const { engines, doc, sheet } = await startEngines(first, store);
  const agent = new SimAgent(seed.agent, store, comments, engines);
  const uploads = new Map<string, Upload>();
  const hasDb = Object.keys(seed.files).some((path) => path.startsWith('db/'));

  const artifact: ArtifactCapability = {
    id: store.id,
    title: async () => store.title,
    list: async () => store.list(),
    readText: async (path) => store.readText(path),
    readBytes: async (path) => store.readBytes(path),
    publish: (batch) => store.publish(batch, 'person'),
    onChange: (listener) => store.files.on(listener),
  };

  const assets: AssetsCapability = {
    // Stored and given the type server's `/_blob/<id>` address, which pages require (slides and whiteboard check the
    // pattern). Nothing serves that address on a static site without a service worker, so a new upload does not
    // show yet; seeded pictures are `data:` URLs and show.
    upload: async (data) => {
      const id = (await sha256(new Uint8Array(await data.arrayBuffer()))).slice(0, 32);
      if (!uploads.has(id)) uploads.set(id, { blob: data, objectUrl: URL.createObjectURL(data) });
      console.info(`[playground] kept upload /_blob/${id} (${data.size} bytes); /_blob/ is not served without a service worker`);
      return { id, url: `/_blob/${id}`, sizeBytes: data.size, contentType: data.type || 'application/octet-stream' };
    },
  };

  const user: UserCapability = { me: async () => ({ ...VISITOR }) };

  const agentCap: AgentCapability = {
    // A request without a click is staged by the broker (`deliver: 'stage'`); the playground has no composer to
    // stage it in, so it runs either way.
    send: async (request) => {
      if (!request || typeof request.text !== 'string') throw new ArtifactError('invalid', 'A request needs text.');
      agent.request(request.text);
      return { status: 'delivered' };
    },
    status: async () => agent.status(),
    onStatus: (listener) => agent.statusChanges.on(listener),
  };

  const room: RoomCapability = {
    self: async () => VISITOR.id,
    presence: async () => undefined,
    peers: async () => [{ id: VISITOR.id, name: VISITOR.name, kind: 'person', state: {} }],
    onPeers: () => () => undefined,
    emit: async () => undefined,
    onMessage: () => () => undefined,
  };

  // Files save as this browser's own downloads, as on a cloud host (`browser: true` reaches the page in the grant).
  const downloads: DownloadsCapability = {
    browser: true,
    save: async (file) => saveInBrowser(file),
    check: async () => undefined,
  };

  const db: DbCapability = {
    get: async (path) => store.getDoc(path),
    list: async (collection) => store.listDocs(collection),
    listing: async (collection) => ({ epoch: store.epoch, seq: store.seq, documents: store.listDocs(collection) }),
    write: (writes) => store.writeDocs(writes, 'person'),
    onChange: (listener) => {
      const stop = store.db.on(listener);
      // Every stream starts with where the store stands (`resync`), as the type server's does on connect.
      setTimeout(() => listener({ changes: {}, epoch: store.epoch, seq: store.seq, resync: true }), 0);
      return stop;
    },
  };

  const commentsCap: CommentsCapability = {
    list: async () => comments.list(),
    create: async (input) => comments.create(input),
    reply: async (threadId, text, options) => comments.reply(threadId, text, options?.to),
    edit: async (threadId, messageId, text, options) => comments.edit(threadId, messageId, text, options?.to),
    react: async (threadId, messageId, emoji, on) => comments.react(threadId, messageId, emoji, on),
    setResolved: async (threadId, resolved) => comments.setResolved(threadId, resolved),
    move: async (threadId, anchor, location) => comments.move(threadId, anchor, location),
    remove: async (threadId, messageId) => comments.remove(threadId, messageId),
    sendToAgent: async (threadId, options) => {
      const thread = comments.markSent(threadId, options?.unasked === true);
      const asked = [...thread.messages].reverse().find((m) => m.author.kind === 'person');
      agent.request(asked?.text ?? '', threadId);
      return thread;
    },
    onChange: (listener) => comments.changes.on(listener),
  };

  const history: HistoryCapability = {
    list: async () => store.history.list(),
    files: async (n) => store.history.files(n),
    read: async (n, path) => new TextDecoder().decode(store.history.readBytes(n, path)),
    readBytes: async (n, path) => store.history.readBytes(n, path),
    diff: async (n, path) => store.history.diff(n, path),
    restore: (n, paths) => store.history.restore(n, paths),
    dismissNotice: async () => undefined,
    onChange: (listener) => store.history.changes.on(listener),
  };

  const namespaces: Partial<CapabilityMap> = {
    artifact,
    assets,
    user,
    agent: agentCap,
    room,
    downloads,
    comments: commentsCap,
    history,
    ...(hasDb ? { db } : {}),
    ...(doc ? { doc } : {}),
    ...(sheet ? { sheet } : {}),
  };

  const provider: CapabilityProvider = {
    get<K extends CapabilityName>(name: K): CapabilityMap[K] | null {
      return (namespaces[name] as CapabilityMap[K] | undefined) ?? null;
    },
  };

  return { seed, store, comments, agent, provider, uploads, engines };
}

/**
 * The docs or sheets demo's engine, over the seed's files, with its capability as the page gets it: the engine's own,
 * plus a version in the artifact's history a moment after the person's writes through it (the editors keep their own
 * version history in the engine; this keeps the artifact's copy of the files and its history in step).
 */
async function startEngines(seed: SeedManifest, store: DemoStore): Promise<{ engines: DemoEngines | null; doc?: DocCapability; sheet?: SheetCapability }> {
  if (seed.type !== 'docs' && seed.type !== 'sheets') return { engines: null };
  const files = Object.fromEntries(seedFiles(seed));
  const prefix = seed.type === 'docs' ? 'doc/' : 'sheet/';
  const engine = seed.type === 'docs' ? { doc: await loadDocEngine(files, VISITOR) } : { sheet: await loadSheetEngine(files, VISITOR) };
  const filesOf = (): Record<string, Uint8Array> => (engine.doc ?? engine.sheet)!.files();
  const engines: DemoEngines = { ...engine, mirror: async (origin) => void (await store.mirror(prefix, filesOf(), origin)) };
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The person wrote: take the files in once they pause. */
  const wrote = <T>(result: Promise<T>): Promise<T> => {
    void result.then(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void engines.mirror('person').catch((error: unknown) => console.warn('[playground] could not take in the engine files', error));
      }, MIRROR_MS);
    }, () => undefined);
    return result;
  };
  if (engine.doc) {
    const cap = engine.doc.capability;
    const doc: DocCapability = {
      ...cap,
      call: (request) => wrote(cap.call(request)),
      restore: (request) => wrote(cap.restore(request)),
      importFile: (name, bytes, tabName) => wrote(cap.importFile(name, bytes, tabName)),
    };
    return { engines, doc };
  }
  const cap = engine.sheet!.capability;
  const sheet: SheetCapability = {
    ...cap,
    send: (request) => wrote(cap.send(request)),
    widget: (request) => wrote(cap.widget(request)),
    importFile: (file, name) => wrote(cap.importFile(file, name)),
  };
  return { engines, sheet };
}
