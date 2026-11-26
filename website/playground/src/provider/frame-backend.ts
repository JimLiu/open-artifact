/**
 * The page demo's backend: what frame-host (`packages/server-sdk/src/frame/core.ts`) answers its inner shell, over the
 * same in-memory artifact as every other demo. A page artifact has no editor: frame-host's inner shell (`shell.js`,
 * with its comment views, `comments.js`) frames the artifact's own `index.html` with the page runtime (`runtime.js`)
 * first in its <head>. Those three run here unchanged; this answers the inner shell's HTTP API (`api/frame/session`,
 * `cap`, `activity`, `agent`, `title`) and its event stream (`api/frame/events`), and composes the page document.
 *
 * Here: the page runs on the playground's origin (in a `srcdoc` frame), where frame-host gives every artifact an origin
 * of its own; the db is a subset of frame-host's (get, set, update, delete, add, query with where / orderBy / limit);
 * no room peers, no uploads, no live leases.
 */

import type { CommentThread, JsonRecord, JsonValue } from '@open-artifact/runtime';
import type { FrameEvent, FrameSession } from '../../../../packages/server-sdk/src/frame/wire.ts';
import type { DemoArtifact } from './demo-provider.ts';
import { VISITOR } from './demo-provider.ts';
import { channel, randomId } from './events.ts';

/** The frame runtime contract frame-host reports (`CONTRACT` in frame/core.ts). */
export const FRAME_CONTRACT = '0.2.92';
/** The artifact's page, in the store. */
const INDEX = 'project/index.html';
const GRANTS = ['comments', 'db', 'user'];

type Args = Record<string, unknown>;

/** A capability error as frame-host answers it (`{error: {code, message}}`). */
class FrameError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The value at a dot path of `data`. */
function fieldOf(data: JsonRecord, field: string): unknown {
  let at: unknown = data;
  for (const part of field.split('.')) {
    if (!isObject(at)) return undefined;
    at = at[part];
  }
  return at;
}

/** Orders two field values as frame-host's db does (numbers, then strings, then the rest by their JSON). */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = typeof a === 'string' ? a : JSON.stringify(a);
  const y = typeof b === 'string' ? b : JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function matches(id: string, data: JsonRecord, where: { field: string; op: string; value: unknown }): boolean {
  const v = where.field === '__name__' || where.field === 'id' ? id : fieldOf(data, where.field);
  switch (where.op) {
    case '==':
      return v !== undefined && same(v, where.value);
    case '!=':
      return v !== undefined && !same(v, where.value);
    case '<':
      return v !== undefined && compare(v, where.value) < 0;
    case '<=':
      return v !== undefined && compare(v, where.value) <= 0;
    case '>':
      return v !== undefined && compare(v, where.value) > 0;
    case '>=':
      return v !== undefined && compare(v, where.value) >= 0;
    case 'in':
      return Array.isArray(where.value) && where.value.some((x) => same(x, v));
    case 'not-in':
      return v !== undefined && Array.isArray(where.value) && !where.value.some((x) => same(x, v));
    case 'array-contains':
      return Array.isArray(v) && v.some((x) => same(x, where.value));
    default:
      return false;
  }
}

/** `update` data applied to a document: each key a dot path, set in place. */
function updated(doc: JsonRecord, patch: Record<string, unknown>): JsonRecord {
  const out = structuredClone(doc);
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split('.');
    let at: Record<string, unknown> = out;
    for (const part of parts.slice(0, -1)) {
      if (!isObject(at[part])) at[part] = {};
      at = at[part] as Record<string, unknown>;
    }
    at[parts.at(-1)!] = value;
  }
  return out;
}

/** A thread as a page and the inner shell see it (frame core's `pageThread`): the anchor as the page gave it. */
function pageThread(t: CommentThread): Record<string, unknown> {
  let anchor: unknown = isObject(t.location) && 'custom' in t.location ? t.location.custom : undefined;
  if (anchor === undefined) {
    try {
      anchor = JSON.parse(t.anchor);
    } catch {
      anchor = t.anchor;
    }
  }
  return {
    id: t.id,
    anchor,
    label: t.label,
    ...(t.detail !== undefined ? { detail: t.detail } : {}),
    resolved: t.status === 'resolved',
    status: t.status,
    agent: t.agent ?? null,
    messages: t.messages.map((m) => ({ id: m.id, author: { kind: m.author.kind === 'person' ? 'user' : m.author.kind, name: m.author.name }, text: m.text, at: m.at })),
  };
}

export class FrameBackend {
  /** The page's files version (frame-host's manifest version): a files change reloads the page at the next one. */
  private ver = 1;
  readonly events = channel<FrameEvent>();

  constructor(
    private readonly demo: DemoArtifact,
    /** The playground's origin: the inner shell's, and here the page's too. */
    private readonly origin: string,
    /** The page runtime's address (`frame-host/runtime.js`). */
    private readonly runtimeUrl: string,
  ) {
    const { store, comments } = demo;
    // Someone else changed the files (the agent): the inner shell loads the page again.
    store.files.on((event) => {
      this.ver += 1;
      this.events.emit({ t: 'files', ver: String(this.ver), paths: Object.keys(event.changes) });
    });
    store.db.on((event) => this.events.emit({ t: 'db', paths: Object.keys(event.changes) }));
    comments.changes.on((threads) => this.events.emit({ t: 'comments', count: openCount(threads) }));
  }

  session(): FrameSession {
    const { store, agent } = this.demo;
    return {
      id: store.id,
      title: store.title,
      key: null,
      ver: String(this.ver),
      contract: FRAME_CONTRACT,
      contentOrigin: this.origin,
      shellOrigin: this.origin,
      outerOrigins: [this.origin],
      brokerGen: 1,
      grants: [...GRANTS],
      stubs: {},
      configs: { comments: {}, db: {}, user: { id: VISITOR.id, color: '#2f6f4f', owner: true, canEdit: true, profile: true, email: false } },
      capabilities: { comments: true, db: true, user: true },
      flags: {},
      readyTimeoutS: 60,
      me: { id: VISITOR.id, name: VISITOR.name, avatarUrl: null, color: '#2f6f4f', email: null, isOwner: true, canEdit: true },
      comments: { available: true, count: openCount(this.demo.comments.list()) },
      agent: { available: agent.status().available, name: agent.status().name ?? 'Agent' },
    };
  }

  /** The event stream's first message (frame-host's `hello`). */
  hello(): FrameEvent {
    return { t: 'hello', ver: String(this.ver), brokerGen: 1, peers: [], count: openCount(this.demo.comments.list()) };
  }

  /** The page document: the artifact's index.html with the frame boot and the page runtime first in its <head>. */
  pageDocument(): string {
    let html: string;
    try {
      html = this.demo.store.readText(INDEX);
    } catch {
      html = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
    }
    const boot = { shellOrigin: this.origin, id: this.demo.store.id, key: null, grants: [...GRANTS], stubs: [], contract: FRAME_CONTRACT };
    const safe = (v: unknown): string => JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const inject =
      `<script>window.__FRAME_PREAMBLE=${safe({ origins: [this.origin] })};window.__OPEN_ARTIFACT_FRAME=${safe(boot)};</script>` +
      `<script src="${this.runtimeUrl.replace(/"/g, '&quot;')}"></script>`;
    const head = /<head\b[^>]*>/i.exec(html);
    return head ? html.slice(0, head.index + head[0].length) + inject + html.slice(head.index + head[0].length) : inject + html;
  }

  /** One request of the inner shell's API (`api/frame/<name>`), answered as frame-host would: status and JSON body. */
  async request(name: string, method: string, body: unknown): Promise<{ status: number; body: unknown }> {
    if (name === 'session' && method === 'GET') return { status: 200, body: this.session() };
    if (method !== 'POST') return { status: 405, body: { error: { code: 'invalid', message: 'Method not allowed' } } };
    const args = isObject(body) ? body : {};
    switch (name) {
      case 'cap':
        return { status: 200, body: await this.call(args) };
      case 'activity':
        return { status: 200, body: { working: this.demo.agent.status().busy } };
      case 'agent': {
        const text = typeof args.text === 'string' ? args.text : '';
        if (text.trim()) this.demo.agent.request(text);
        return { status: 200, body: { status: 'delivered', via: 'hook' } };
      }
      case 'title':
        return { status: 200, body: { applied: false } };
      case 'upload':
        return { status: 200, body: { error: { code: 'unavailable', message: 'Uploads are not kept in the playground.' } } };
      default:
        return { status: 404, body: { error: { code: 'not_found', message: 'Not found' } } };
    }
  }

  /** `POST api/frame/cap`: `{result}` or `{error}`. */
  private async call(body: Args): Promise<{ result: unknown } | { error: { code: string; message: string } }> {
    const cap = String(body.cap ?? '') === 'self' ? 'artifact' : String(body.cap ?? '');
    const method = String(body.method ?? '');
    const list = Array.isArray(body.args) ? body.args : [body.args];
    const a: Args = isObject(list[0]) ? list[0] : {};
    try {
      return { result: await this.capability(cap, method, a) };
    } catch (error) {
      const code = error instanceof FrameError ? error.code : ((error as { code?: unknown })?.code as string | undefined) ?? 'upstream_error';
      return { error: { code: String(code), message: error instanceof Error ? error.message : String(error) } };
    }
  }

  private async capability(cap: string, method: string, a: Args): Promise<unknown> {
    const { store, comments, agent } = this.demo;
    const path = (): string => String(a.path ?? '').replace(/^\/+|\/+$/g, '');
    const write = async (writes: Parameters<typeof store.writeDocs>[0]): Promise<void> => {
      await store.writeDocs(writes, 'person');
      // Every shell hears a write, its own too (its subscriptions run again).
      this.events.emit({ t: 'db', paths: writes.map((w) => w.path) });
    };
    switch (`${cap}.${method}`) {
      case 'db.get': {
        const data = store.getDoc(path());
        return data ? { exists: true, data } : { exists: false };
      }
      case 'db.set':
        if (!isObject(a.data)) throw new FrameError('invalid_argument', 'set() takes an object.');
        await write([{ op: 'set', path: path(), data: a.data as JsonRecord }]);
        return {};
      case 'db.update': {
        const doc = store.getDoc(path());
        if (!doc) throw new FrameError('not_found', `No document ${path()}.`);
        await write([{ op: 'set', path: path(), data: updated(doc, isObject(a.data) ? a.data : {}) }]);
        return {};
      }
      case 'db.delete':
        await write([{ op: 'delete', path: path() }]);
        return {};
      case 'db.add': {
        if (!isObject(a.data)) throw new FrameError('invalid_argument', 'add() takes an object.');
        const id = randomId(10);
        const doc = `${path()}/${id}`;
        await write([{ op: 'set', path: doc, data: a.data as JsonRecord }]);
        return { id, path: doc };
      }
      case 'db.query': {
        const collection = path();
        const spec = isObject(a.spec) ? a.spec : {};
        const where = (Array.isArray(spec.where) ? spec.where : []).filter(isObject).map((w) => ({ field: String(w.field ?? ''), op: String(w.op ?? ''), value: w.value }));
        let docs = store.listDocs(collection).map((d) => ({ id: d.path.slice(collection.length + 1), data: d.data }));
        docs = docs.filter((d) => where.every((w) => matches(d.id, d.data, w)));
        if (isObject(spec.orderBy) && typeof spec.orderBy.field === 'string') {
          const field = spec.orderBy.field;
          const dir = spec.orderBy.dir === 'desc' ? -1 : 1;
          const key = (d: { id: string; data: JsonRecord }): unknown => (field === 'id' || field === '__name__' ? d.id : fieldOf(d.data, field));
          docs.sort((x, y) => {
            const kx = key(x);
            const ky = key(y);
            if (kx === undefined || ky === undefined) return kx === ky ? 0 : kx === undefined ? 1 : -1;
            return compare(kx, ky) * dir;
          });
        }
        const limit = typeof spec.limit === 'number' && spec.limit > 0 ? spec.limit : null;
        return { docs: limit ? docs.slice(0, limit) : docs };
      }
      case 'user.me':
      case 'user.profile':
        return { id: VISITOR.id, name: VISITOR.name, avatarUrl: null, color: '#2f6f4f' };
      case 'user.email':
        return null;
      case 'user.profiles':
        return {};
      case 'user.access':
        return { [VISITOR.id]: 'owner' };
      case 'user.search':
        return [];
      case 'permissions.state':
        return GRANTS.includes(String(a.name)) ? 'granted' : 'unavailable';
      case 'permissions.request': {
        const names = Array.isArray(a.names) ? a.names.map(String) : GRANTS;
        return Object.fromEntries(names.map((n) => [n, GRANTS.includes(n) ? 'granted' : 'unavailable']));
      }
      case 'artifact.metadata':
        return { [store.id]: { id: store.id, title: store.title, type: null } };
      case 'comments.list':
        return { threads: comments.list().filter((t) => a.all !== false || t.status === 'open').map(pageThread) };
      case 'comments.create': {
        const thread = comments.create(this.threadInput(a));
        return { threadId: thread.id, commentId: thread.messages[0]!.id, thread: pageThread(thread) };
      }
      case 'comments.reply': {
        const thread = comments.reply(String(a.threadId), String(a.text ?? ''));
        return { threadId: thread.id, commentId: thread.messages.at(-1)!.id, thread: pageThread(thread) };
      }
      case 'comments.resolve':
        return { thread: pageThread(comments.setResolved(String(a.threadId), a.resolved !== false)) };
      case 'comments.move': {
        const thread = comments.move(String(a.threadId), JSON.stringify(a.anchor ?? null), { custom: (a.anchor ?? null) as JsonValue });
        return { thread: pageThread(thread) };
      }
      case 'comments.delete':
        comments.remove(String(a.threadId), typeof a.commentId === 'string' ? a.commentId : undefined);
        return { deleted: true };
      case 'comments.canSendToAgent':
        return agent.status().available ? 'available' : 'off';
      case 'comments.sendToAgent': {
        let threadId = typeof a.threadId === 'string' ? a.threadId : '';
        if (!threadId) threadId = comments.create(this.threadInput(a)).id;
        else if (typeof a.text === 'string' && a.text.trim()) comments.reply(threadId, a.text);
        const thread = comments.markSent(threadId, false);
        const asked = [...thread.messages].reverse().find((m) => m.author.kind === 'person');
        agent.request(asked?.text ?? '', threadId);
        return { threadId, status: 'delivered', thread: pageThread(thread) };
      }
      case 'room.peers':
        return [];
      case 'room.emit':
      case 'room.presence':
        return {};
      case 'room.canSendToAgentSession':
        return false;
      default:
        throw new FrameError('invalid_request', `${cap}.${method} is not supported here.`);
    }
  }

  private threadInput(a: Args): { anchor: string; label: string; detail?: string; location: JsonRecord; text: string } {
    return {
      anchor: JSON.stringify(a.anchor ?? null),
      label: typeof a.label === 'string' ? a.label : '',
      ...(typeof a.detail === 'string' ? { detail: a.detail } : {}),
      location: { custom: (a.anchor ?? null) as JsonValue },
      text: String(a.text ?? ''),
    };
  }
}

function openCount(threads: CommentThread[]): number {
  return threads.filter((t) => t.status === 'open').length;
}
