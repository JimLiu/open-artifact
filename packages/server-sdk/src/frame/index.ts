/**
 * frame-host: serves an original artifact type (a folder whose index.html
 * declares itself in an inline `// artifact.json` block) so its page runs as
 * it would in its first home.
 *
 * Three windows take part:
 *
 *     the outer Shell (the daemon's /a/<id>)
 *       └─ embeds ─▶ the inner shell (this server, /f/<token>/, Site.page)
 *            └─ embeds ─▶ the original page on its own origin
 *                 (http://<id>.frame.localhost:<port>/_f/<ver>/, Site.content)
 *
 * The page gets `window.openartifact` from the Frame Runtime this server injects
 * first in its <head> (client/runtime.ts). Every capability call is a
 * `__frame_cap` postMessage to the inner shell (client/shell.ts), which
 * carries it here over HTTP and pushes events (db changes, room, file and
 * comment changes, rewiring) back from one event stream.
 *
 * Backends live in the artifact folder: db/ (db.ts), comments.json
 * (comments.ts), the files the page publishes and _blobs/ (files.ts). An
 * agent's edits land on disk; a watcher sends them to open pages.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { ServerResponse, type IncomingMessage } from 'node:http';
import * as nodeModule from 'node:module';
import { userInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { hostedFrameContext, type ArtifactRef, type ServerAction, type Site, type SiteContext, type StreamResponse } from '../serve.ts';
import { AGENT_AUTHOR, COMMENTS_FILE, CommentStore, agentView, type Author, type Thread } from './comments.ts';
import { DbStore, docPathsOf } from './db.ts';
import { readDeclaration, type Declaration } from './declaration.ts';
import { BlobStore, FileStore, FrameError, cleanPath, contentTypeOf, reservedPath, typePath, type FileWrite, type PublishResult } from './files.ts';
import {
  STALE_GEN_MESSAGE,
  UNDECLARED_MESSAGE,
  type CapErrorBody,
  type CapReply,
  type FrameBoot,
  type FrameEvent,
  type FrameSession,
  type LocalUser,
  type Peer,
} from './wire.ts';

export { parseDeclaration, readDeclaration, DECLARATION_LINE, type Declaration } from './declaration.ts';
export { FrameError } from './files.ts';
export type * from './wire.ts';

/** The Frame Runtime contract reported to pages. */
export const CONTRACT = '0.2.92';

/**
 * Where the browser scripts and the shell page are: `$OPEN_ARTIFACT_FRAME_CLIENT_DIR`,
 * else `client/` beside this module (src/frame/client from source, or
 * dist/daemon/frame-host/client beside the bundle).
 */
export const CLIENT_DIR = process.env.OPEN_ARTIFACT_FRAME_CLIENT_DIR || join(dirname(fileURLToPath(import.meta.url)), 'client');

/** Capabilities with a local backend; a declared one is granted. `artifact` (self) and `permissions` always are. */
const BACKED = new Set(['db', 'artifact', 'assets', 'downloads', 'comments', 'user', 'room', 'permissions']);
/** Declared capabilities that answer, but only with an error code: nothing here can serve them. */
const STUBBED: Record<string, string> = { mcp: 'server_not_connected', sample: 'tools_unavailable', tts: 'capability_disabled', paste: 'capability_disabled' };
/** Caps whose stale-generation reply is `unavailable`; `user` answers null; others use the fallback error code. */
const STALE_UNAVAILABLE = new Set(['db', 'downloads', 'files', 'paste', 'reads']);
const BODY_MAX = 64 * 1024 * 1024;
const UPLOAD_MAX = 21 * 1024 * 1024;
const WATCH_DEBOUNCE_MS = 300;

const PALETTE = ['#785ee8', '#dc3c3d', '#019c7f', '#fbb315', '#ce447d', '#10a122', '#257de0'];
const ROOM_LIMITS = { maxBytes: 4096, presenceHz: 30, keepaliveMs: 20_000, silenceMs: 150_000, maxPeers: 256, maxRooms: 0 };

/** What {@link mountFrameSite} takes: serve()'s context, plus the type folder. */
export interface FrameSiteContext extends SiteContext {
  /** The type folder (default `OPEN_ARTIFACT_TYPE_DIR`, else the working directory). */
  typeDir?: string;
}

type Args = Record<string, unknown>;

interface Client {
  send(event: FrameEvent): void;
  presence: Record<string, unknown>;
  end(): void;
}

function colorOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length] ?? '#c7c9d1';
}

function localUser(): LocalUser {
  let name = 'You';
  try {
    name = userInfo().username || name;
  } catch {
    // no passwd entry
  }
  return { id: 'local', name, avatarUrl: null, color: colorOf('local'), email: null, isOwner: true, canEdit: true };
}

function typeConfig(typeDir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(typeDir, 'artifact-type.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** A fingerprint of what the type serves: index.html and artifact-type/ (names, sizes, times). */
function typeFingerprint(typeDir: string): string {
  const hash = createHash('sha256');
  try {
    hash.update(readFileSync(join(typeDir, 'index.html')));
  } catch {
    hash.update('-');
  }
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.')) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path, `${rel}/${e.name}`, depth + 1);
      else if (e.isFile()) {
        try {
          const st = statSync(path);
          hash.update(`\n${rel}/${e.name}\0${st.size}\0${st.mtimeMs}`);
        } catch {
          // gone
        }
      }
    }
  };
  walk(join(typeDir, 'artifact-type'), 'artifact-type', 0);
  return hash.digest('hex').slice(0, 16);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Mounts one artifact folder. Throws when the type folder carries no declaration or the server has no content hosts. */
export async function mountFrameSite(root: string, ctx: FrameSiteContext): Promise<FrameSite> {
  const typeDir = resolve(ctx.typeDir ?? process.env.OPEN_ARTIFACT_TYPE_DIR ?? process.cwd());
  const declaration = readDeclaration(typeDir);
  if (!declaration) throw new FrameError('not_frame_type', `${typeDir}/index.html has no // artifact.json declaration.`, 500);
  if (!ctx.contentOrigin) throw new FrameError('no_content_origin', 'frame-host needs serve({contentHosts: true}) and an art_ artifact id.', 500);
  return new FrameSite(resolve(root), typeDir, declaration, ctx);
}

/** One open artifact of an original type. */
export class FrameSite implements Site {
  readonly root: string;
  readonly typeDir: string;
  readonly id: string;
  readonly page: string;
  readonly contentOrigin: string;
  readonly shellOrigin: string;
  readonly db: DbStore;
  readonly comments: CommentStore;
  readonly files: FileStore;
  readonly blobs: BlobStore;
  /** The broker generation: bumped when the type or the files change under an open page. */
  brokerGen = 1;
  declaration: Declaration;
  title: string;
  ver: string;
  grants: string[] = [];
  stubs: Record<string, string> = {};
  readonly me: LocalUser;

  private readonly ctx: FrameSiteContext;
  private readonly shellOrigins: Set<string>;
  private readonly config: Record<string, unknown>;
  private flagKeys: string[] = [];
  private typeVer: string;
  private readonly clients = new Map<string, Client>();
  private touchTimer: NodeJS.Timeout | null = null;
  private readonly touchPaths = new Set<string>();
  private presenceCache: { at: number; value: unknown } | null = null;
  private watchers: FSWatcher[] = [];
  private watchTimer: NodeJS.Timeout | null = null;
  private typeTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Set<string>();

  constructor(root: string, typeDir: string, declaration: Declaration, ctx: FrameSiteContext) {
    this.root = root;
    this.typeDir = typeDir;
    this.declaration = declaration;
    const hosted = hostedFrameContext(ctx.hosted);
    this.ctx = { ...ctx, ...(hosted ? { hosted } : {}) };
    this.id = ctx.id;
    this.title = ctx.title ?? '';
    this.page = `/f/${randomBytes(18).toString('base64url')}/`;
    this.contentOrigin = ctx.hosted?.contentOrigin ?? ctx.contentOrigin!;
    const port = new URL(ctx.contentOrigin!).port;
    this.shellOrigin = ctx.hosted?.frameOrigin ?? `http://127.0.0.1:${port}`;
    this.shellOrigins = new Set(ctx.hosted ? [ctx.hosted.frameOrigin] : [this.shellOrigin, `http://localhost:${port}`]);
    this.db = new DbStore(root);
    this.comments = new CommentStore(root);
    this.files = new FileStore(root);
    this.blobs = new BlobStore(root);
    this.ver = this.files.manifest().ver;
    this.config = typeConfig(typeDir);
    this.me = localUser();
    this.typeVer = typeFingerprint(typeDir);
    this.applyDeclaration(declaration);
    this.db.on('change', (paths: string[]) => this.broadcast({ t: 'db', paths }));
    this.watch();
  }

  private applyDeclaration(declaration: Declaration): void {
    this.declaration = declaration;
    const caps = declaration.capabilities ?? {};
    this.grants = [...new Set([...Object.keys(caps).filter((c) => BACKED.has(c)), 'artifact', 'permissions'])];
    this.stubs = Object.fromEntries(Object.keys(caps).flatMap((c) => (STUBBED[c] ? [[c, STUBBED[c]]] : [])));
    const flags = caps.flags;
    this.flagKeys = isObject(flags) && Array.isArray(flags.keys) ? flags.keys.filter((k): k is string => typeof k === 'string') : [];
  }

  private log(line: string): void {
    this.ctx.log?.(line);
  }

  close(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.typeTimer) clearTimeout(this.typeTimer);
    if (this.touchTimer) clearTimeout(this.touchTimer);
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        // already closed
      }
    }
    this.watchers = [];
    for (const c of this.clients.values()) c.end();
    this.clients.clear();
  }

  hasBlob(id: string): boolean {
    return !!this.blobs.meta(id);
  }

  // ---- watching the folders ----------------------------------------------------------------------------------------

  private watch(): void {
    try {
      const w = watch(this.root, { recursive: true }, (_event, name) => {
        if (!name) return;
        const rel = String(name).split(sep).join('/');
        if (rel.split('/').some((s) => s.startsWith('.')) || rel.startsWith('_blobs/') || rel.startsWith('history/')) return;
        this.pending.add(rel);
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => this.flushWatch(), WATCH_DEBOUNCE_MS);
      });
      w.on('error', () => {});
      this.watchers.push(w);
    } catch (error) {
      this.log(`watch: ${(error as Error)?.message ?? error}`);
    }
    // The type folder: a new index.html or artifact-type/ under an open page rewires its broker.
    try {
      const w = watch(this.typeDir, { recursive: true }, (_event, name) => {
        if (name && String(name).split(sep).some((s) => s.startsWith('.'))) return;
        if (this.typeTimer) clearTimeout(this.typeTimer);
        this.typeTimer = setTimeout(() => this.typeChanged(), WATCH_DEBOUNCE_MS);
      });
      w.on('error', () => {});
      this.watchers.push(w);
    } catch (error) {
      this.log(`watch type: ${(error as Error)?.message ?? error}`);
    }
  }

  /** Re-reads the type; when what it serves changed, rewires. */
  typeChanged(): boolean {
    const next = typeFingerprint(this.typeDir);
    if (next === this.typeVer) return false;
    this.typeVer = next;
    let declaration: Declaration | null = null;
    try {
      declaration = readDeclaration(this.typeDir);
    } catch (error) {
      this.log(`type: ${(error as Error)?.message ?? error}`);
    }
    if (declaration) this.applyDeclaration(declaration);
    this.rewire('type');
    return true;
  }

  /** A new broker generation: calls stamped with the old one are not run, open shells cut theirs and reload. */
  private rewire(reason: 'type' | 'files'): void {
    this.brokerGen += 1;
    this.broadcast({ t: 'rewired', brokerGen: this.brokerGen, caps: this.grants, reason });
  }

  /** Applies what the folder watcher gathered (exposed for tests: watchers are slow to settle). */
  flushWatch(): void {
    const rels = [...this.pending];
    this.pending.clear();
    const docs = docPathsOf(rels);
    if (docs.length || rels.some((r) => r === 'db' || r.startsWith('db/'))) this.broadcast({ t: 'db', paths: docs });
    if (rels.includes(COMMENTS_FILE)) this.commentsChanged();
    if (rels.some((r) => r !== COMMENTS_FILE && !r.startsWith('db/') && r !== 'db')) this.filesChanged(rels.filter((r) => !reservedPath(r)));
  }

  /** Files changed on disk, not by this page's own publish: a new manifest rewires and reloads open pages. */
  filesChanged(paths: string[] = []): boolean {
    const m = this.files.manifest();
    if (m.ver === this.ver) return false;
    this.ver = m.ver;
    this.rewire('files');
    this.broadcast({ t: 'files', ver: m.ver, paths });
    return true;
  }

  private broadcast(event: FrameEvent): void {
    for (const c of this.clients.values()) c.send(event);
  }

  /** A write from the page: the daemon records it (best effort, gathered). */
  private touched(paths: string[]): void {
    for (const p of paths) this.touchPaths.add(p);
    if (this.touchTimer) return;
    this.touchTimer = setTimeout(() => {
      this.touchTimer = null;
      const list = [...this.touchPaths].slice(0, 100);
      this.touchPaths.clear();
      const daemon = this.ctx.daemon;
      if (daemon?.available) daemon.touch(this.id, { author: 'owner', paths: list }).catch(() => {});
    }, 1000);
    this.touchTimer.unref?.();
  }

  // ---- requests on the inner shell's origin (under Site.page) ------------------------------------------------------

  async handle(req: IncomingMessage, res: ServerResponse | StreamResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    const p = url.pathname;
    if (!(res instanceof ServerResponse)) {
      if (p === '/api/frame/events' && this.ctx.local(req)) return this.events(req, res, url);
      res.writeHead(404);
      res.end();
      return;
    }
    const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(p);
    if (blob) return this.sendBlob(req, res, blob[1]!);
    if (!this.ctx.local(req)) return deny(req, res, 403, 'Frame pages open on this computer only.');
    if (p === '/' || p === '/index.html') return this.sendClientFile(req, res, 'shell.html');
    if (p === '/shell.js' || p === '/shell.css' || p === '/comments.js' || p === '/comments.css') return this.sendClientFile(req, res, p.slice(1));
    if (!p.startsWith('/api/frame/')) return deny(req, res, 404, 'Not found');
    if (!this.sameOrigin(req)) return deny(req, res, 403, 'Not from this page.');
    const name = p.slice('/api/frame/'.length);
    try {
      if (name === 'events' && req.method === 'GET') return this.events(req, res, url);
      if (name === 'session' && req.method === 'GET') return json(res, 200, this.session());
      if (req.method !== 'POST') return deny(req, res, 405, 'Method not allowed');
      if (name === 'upload') {
        const stale = this.gate('assets', numberOrUndefined(url.searchParams.get('gen')));
        if (stale) return json(res, 200, stale);
        const data = await readBody(req, UPLOAD_MAX);
        const out = this.blobs.upload(data, url.searchParams.get('type') ?? req.headers['content-type']);
        this.touched(['_blobs']);
        return json(res, 200, { result: out });
      }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return deny(req, res, 415, 'JSON only.');
      const body = JSON.parse((await readBody(req, BODY_MAX)).toString('utf8') || '{}') as Args;
      if (name === 'cap') return json(res, 200, await this.call(body));
      if (name === 'title') return json(res, 200, await this.proposeTitle(body));
      if (name === 'agent') return json(res, 200, await this.askAgent(body));
      if (name === 'activity') return json(res, 200, await this.activity());
      return deny(req, res, 404, 'Not found');
    } catch (error) {
      if (!res.headersSent) return json(res, (error as FrameError)?.status ?? 500, { error: errorOf(error) });
      res.destroy();
    }
  }

  /** The inner shell's own requests: from its origin, never from a page elsewhere. */
  private sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin !== undefined) return this.shellOrigins.has(origin);
    const site = req.headers['sec-fetch-site'];
    return site === undefined || site === 'same-origin' || site === 'none';
  }

  /** Per-capability config, as `__frame_init.capabilities[cap].config` or a grant carries it. */
  private configs(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const cap of this.grants) {
      if (cap === 'artifact') out[cap] = { id: this.id, key: this.declaration.key, publish: true };
      else if (cap === 'user') {
        
        // for the owner (see runtime.ts).
        out[cap] = { id: this.me.id, color: this.me.color, owner: true, canEdit: true, profile: true, email: false };
      } else if (cap === 'room') out[cap] = { limits: ROOM_LIMITS };
      else out[cap] = {};
    }
    return out;
  }

  session(): FrameSession {
    const flags: Record<string, boolean> = {};
    const openArtifact = isObject(this.config.openArtifact) ? this.config.openArtifact : {};
    const configured = (isObject(openArtifact.flags) ? openArtifact.flags : isObject(this.config.flags) ? this.config.flags : {}) as Record<string, unknown>;
    for (const k of this.flagKeys) flags[k] = configured[k] === true;
    return {
      id: this.id,
      title: this.title,
      key: this.declaration.key,
      ver: this.ver,
      contract: CONTRACT,
      contentOrigin: this.contentOrigin,
      ...(this.ctx.hosted?.contentBootstrapUrl ? { contentBootstrapUrl: this.ctx.hosted.contentBootstrapUrl } : {}),
      shellOrigin: this.shellOrigin,
      brokerGen: this.brokerGen,
      grants: this.grants,
      stubs: this.stubs,
      configs: this.configs(),
      capabilities: this.declaration.capabilities,
      flags,
      readyTimeoutS: Number(this.declaration.monitoring?.readyTimeoutS) || 60,
      me: this.me,
      comments: { available: this.grants.includes('comments'), count: this.comments.openCount() },
      agent: { available: !!this.ctx.daemon?.available, name: this.ctx.agentName ?? null, ...(this.ctx.agentWakesIdle === false ? { wakesIdle: false } : {}) },
    };
  }

  /** The event stream of one inner shell: JSON objects, over a `baoyu-sse` WebSocket or as SSE. */
  private events(req: IncomingMessage, res: ServerResponse | StreamResponse, url: URL): void {
    const client = String(url.searchParams.get('c') ?? '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(client)) {
      res.writeHead(400);
      res.end();
      return;
    }
    const sse = res instanceof ServerResponse;
    if (sse) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    else res.writeHead(200);
    const send = (obj: FrameEvent): void => {
      try {
        res.write(sse ? `data: ${JSON.stringify(obj)}\n\n` : JSON.stringify(obj));
      } catch {
        // closing
      }
    };
    this.clients.get(client)?.end();
    const entry: Client = { send, presence: {}, end: () => res.end() };
    this.clients.set(client, entry);
    const ping = sse ? setInterval(() => res.write(': ping\n\n'), 25_000) : null;
    req.on('close', () => {
      if (ping) clearInterval(ping);
      if (this.clients.get(client) === entry) {
        this.clients.delete(client);
        this.broadcast({ t: 'peers', peers: this.peers() });
      }
    });
    send({ t: 'hello', ver: this.ver, brokerGen: this.brokerGen, peers: this.peers(), count: this.comments.openCount() });
    this.broadcast({ t: 'peers', peers: this.peers() });
  }

  private peers(): Peer[] {
    return [...this.clients.entries()].map(([peer, c]) => ({ peer, by: this.me.id, name: this.me.name, presence: c.presence, kind: 'user' as const }));
  }

  // ---- capabilities ------------------------------------------------------------------------------------------------

  



  gate(cap: string, gen: number | undefined): CapReply | null {
    if (gen !== undefined && gen !== this.brokerGen) {
      if (cap === 'user') return { result: null };
      const code = STALE_UNAVAILABLE.has(cap) ? 'unavailable' : 'upstream_error';
      return { error: { code, message: STALE_GEN_MESSAGE, ...(cap === 'mcp' ? { retryable: true } : {}) } };
    }
    return null;
  }

  /** `POST /api/frame/cap`: one call, answered as `{result}` or `{error}`. */
  async call(body: Args): Promise<CapReply> {
    const cap = String(body.cap ?? '') === 'self' ? 'artifact' : String(body.cap ?? '');
    const method = String(body.method ?? '');
    const gen = typeof body.brokerGen === 'number' ? body.brokerGen : undefined;
    const stale = this.gate(cap, gen);
    if (stale) return stale;
    const args = Array.isArray(body.args) ? body.args : [body.args];
    try {
      return { result: await this.capability(cap, method, isObject(args[0]) ? args[0] : {}, String(body.client ?? '')) };
    } catch (error) {
      this.log(`${cap}.${method}: ${(error as FrameError)?.code ?? 'error'} ${(error as Error)?.message ?? error}`);
      return { error: errorOf(error) };
    }
  }

  private author(): Author & { principal: string } {
    return { kind: 'user', name: this.me.name, principal: this.me.id };
  }

  async capability(cap: string, method: string, a: Args, client: string): Promise<unknown> {
    if (this.stubs[cap]) throw new FrameError(this.stubs[cap]!, `${cap} is not available on this computer.`);
    if (!this.grants.includes(cap)) throw new FrameError('not_granted', `${cap}: ${UNDECLARED_MESSAGE}`);
    const path = (): string => String(a.path ?? '');
    switch (`${cap}.${method}`) {
      case 'db.get': {
        const data = this.db.readDoc(path());
        return data ? { exists: true, data } : { exists: false };
      }
      case 'db.set':
        this.db.set(path(), a.data);
        this.touched([`db/${path()}`]);
        return {};
      case 'db.update':
        this.db.update(path(), a.data);
        this.touched([`db/${path()}`]);
        return {};
      case 'db.delete':
        this.db.delete(path());
        this.touched([`db/${path()}`]);
        return {};
      case 'db.add': {
        const out = this.db.add(path(), a.data);
        this.touched([`db/${out.path}`]);
        return out;
      }
      case 'db.query':
        return { docs: this.db.query(path(), a.spec ?? {}) };
      case 'db.acquire':
        return this.db.acquire(path(), isObject(a.options) ? a.options : {});
      case 'db.release':
        return this.db.release(path(), a.holder);
      case 'artifact.publish':
        if (typeof a.html === 'string') throw new FrameError('read_only_path', "index.html belongs to this artifact's type; publish files instead.", 403);
        return this.publish(isObject(a.files) ? a.files : {}, client);
      case 'artifact.sync':
        return { version: this.ver, files: this.files.manifest().files };
      case 'artifact.metadata': {
        const refs = Array.isArray(a.refs) ? a.refs : [];
        const out: Record<string, unknown> = {};
        for (const ref of refs.slice(0, 100)) {
          if (ref === this.id || ref === 'self') out[String(ref)] = { id: this.id, title: this.title, type: this.declaration.key };
        }
        return out;
      }
      case 'artifact.search':
        return { results: [] };
      case 'artifact.edit':
        throw new FrameError('capability_disabled', 'edit() is for live documents; publish the files instead.');
      case 'assets.list':
        return this.blobs.list();
      case 'assets.delete': {
        const out = this.blobs.delete(a.ref);
        if (out.deleted) this.touched(['_blobs']);
        return out;
      }
      case 'user.me':
      case 'user.profile':
        return { id: this.me.id, name: this.me.name, avatarUrl: this.me.avatarUrl, color: this.me.color };
      case 'user.email':
        return null;
      case 'user.profiles': {
        const ids = Array.isArray(a.ids) ? a.ids : [];
        return Object.fromEntries(
          ids
            .filter((i) => i === this.me.id)
            .map((i) => [i, { id: i, name: this.me.name, avatarUrl: null, color: this.me.color, email: null, isMe: true, guest: false, roles: null }]),
        );
      }
      case 'user.access': {
        const ids = Array.isArray(a.ids) ? a.ids : [];
        return Object.fromEntries(ids.map((i) => [String(i), i === this.me.id ? 'owner' : null]));
      }
      case 'user.search':
        return [];
      case 'comments.list':
        return { threads: this.comments.threads({ all: a.all !== false }).map(pageThread) };
      case 'comments.create': {
        const thread = this.comments.create({
          anchor: a.anchor,
          label: a.label,
          detail: a.detail,
          location: { custom: a.anchor ?? null, ...(typeof a.file === 'string' ? { file: a.file } : {}) },
          text: a.text,
          author: this.author(),
        });
        this.commentsChanged();
        return { threadId: thread.id, commentId: thread.messages[0]!.id, thread: pageThread(thread) };
      }
      case 'comments.reply': {
        const { thread, message } = this.comments.addMessage(a.threadId, this.author(), a.text);
        this.commentsChanged();
        return { threadId: thread.id, commentId: message.id, thread: pageThread(thread) };
      }
      case 'comments.resolve': {
        const thread = this.comments.setResolved(a.threadId, a.resolved !== false, this.author());
        this.commentsChanged();
        return { thread: pageThread(thread) };
      }
      case 'comments.move': {
        const have = this.comments.load().threads.find((t) => t.id === a.threadId);
        const thread = this.comments.move(a.threadId, a.anchor, { ...(have?.location ?? {}), custom: a.anchor ?? null });
        this.commentsChanged();
        return { thread: pageThread(thread) };
      }
      case 'comments.delete': {
        const out = this.comments.remove(a.threadId, a.commentId);
        this.commentsChanged();
        return out;
      }
      case 'comments.sendToAgent':
        return this.sendToAgent(a);
      case 'comments.canSendToAgent':
        return this.canSendToAgent();
      case 'room.emit':
        if (JSON.stringify(a.data ?? null).length > ROOM_LIMITS.maxBytes) throw new FrameError('too_large', `A room message is at most ${ROOM_LIMITS.maxBytes} bytes.`);
        this.broadcast({ t: 'room', topic: String(a.topic ?? ''), data: a.data ?? null, from: client, by: this.me.id });
        return {};
      case 'room.presence': {
        const c = this.clients.get(client);
        if (c) c.presence = { ...c.presence, ...(isObject(a.patch) ? a.patch : {}) };
        this.broadcast({ t: 'peers', peers: this.peers() });
        return {};
      }
      case 'room.peers':
        return this.peers();
      case 'room.sendToAgentSession': {
        const text = typeof a.data === 'string' ? a.data : JSON.stringify(a.data ?? null);
        if (Buffer.byteLength(text) > ROOM_LIMITS.maxBytes) throw new FrameError('too_large', `sendToAgentSession() takes at most ${ROOM_LIMITS.maxBytes} bytes.`);
        const out = await this.ctx.agentHook.request({ label: this.declaration.key ?? 'page', text });
        return { to: out?.via ?? 'agent' };
      }
      case 'room.canSendToAgentSession':
        return (await this.canSendToAgent()) === 'available';
      default:
        throw new FrameError('invalid_request', `${cap}.${method} is not supported here.`);
    }
  }

  /** The page's publish: its wire form (`{text}` | `{b64}` | null | `{delete:true}`, each with an optional ifMatch). */
  publish(files: Record<string, unknown>, client: string): PublishResult {
    const plan: Record<string, FileWrite> = {};
    for (const [p, raw] of Object.entries(files)) {
      const spec = isObject(raw) ? raw : null;
      const guard = spec && 'ifMatch' in spec ? { ifMatch: spec.ifMatch as string | null } : {};
      if (raw === null || spec?.delete === true) {
        plan[p] = { delete: true, ...guard };
        continue;
      }
      let data: Buffer;
      if (typeof spec?.b64 === 'string') data = Buffer.from(spec.b64, 'base64');
      else if (typeof spec?.text === 'string') data = Buffer.from(spec.text, 'utf8');
      else throw new FrameError('invalid_content', `${p}: no content.`);
      plan[p] = { data, ...(typeof spec.contentType === 'string' ? { contentType: spec.contentType } : {}), ...guard };
    }
    const out = this.files.publish(plan);
    if (out.version !== this.ver) {
      // The page's own write: no rewiring (its calls stay valid); other shells reload.
      this.ver = out.version;
      this.broadcast({ t: 'files', ver: out.version, paths: out.changed.map((c) => c.path), from: client });
    }
    if (out.changed.length) this.touched(out.changed.map((c) => c.path));
    return out;
  }

  commentsChanged(): void {
    this.broadcast({ t: 'comments', count: this.comments.openCount() });
  }

  private async presence(): Promise<{ canSend?: boolean; busy?: boolean } | null> {
    const daemon = this.ctx.daemon;
    if (!daemon?.available) return null;
    if (this.presenceCache && Date.now() - this.presenceCache.at < 3000) return this.presenceCache.value as { canSend?: boolean } | null;
    let value: unknown = null;
    try {
      value = await daemon.presence(this.id);
    } catch {
      value = null;
    }
    this.presenceCache = { at: Date.now(), value };
    return value as { canSend?: boolean; busy?: boolean } | null;
  }

  private async canSendToAgent(): Promise<'available' | 'no_session' | 'off'> {
    if (!this.ctx.daemon?.available) return 'off';
    const p = await this.presence();
    if (!p) return 'no_session';
    return p.canSend === false ? 'no_session' : 'available';
  }

  private async sendToAgent(a: Args): Promise<unknown> {
    let threadId = typeof a.threadId === 'string' ? a.threadId : '';
    if (!threadId) {
      threadId = this.comments.create({ anchor: a.anchor, label: a.label, detail: a.detail, location: { custom: a.anchor ?? null }, text: a.text, author: this.author() }).id;
    } else if (typeof a.text === 'string' && a.text.trim()) {
      this.comments.addMessage(threadId, this.author(), a.text);
    }
    this.comments.markSent(threadId);
    this.commentsChanged();
    const thread = this.comments.load().threads.find((t) => t.id === threadId)!;
    let out;
    try {
      out = await this.ctx.agentHook.thread(agentView(thread) as never);
    } catch (error) {
      throw new FrameError('agent_unavailable', (error as Error)?.message ?? 'The agent could not be reached.', 409);
    }
    const marked = this.comments.markDelivered(threadId, out?.via === 'wait' ? 'wait' : 'hook');
    this.commentsChanged();
    return { threadId, status: out?.status ?? 'delivered', thread: pageThread(marked) };
  }

  private async proposeTitle({ title, ifUnnamed }: Args): Promise<{ applied: boolean; title?: string }> {
    if (typeof title !== 'string' || !title.trim()) return { applied: false };
    const clean = title.trim().slice(0, 200);
    if (ifUnnamed && this.title && !/^untitled\b/i.test(this.title)) return { applied: false };
    const daemon = this.ctx.daemon;
    if (!daemon?.available) return { applied: false };
    try {
      await daemon.touch(this.id, { author: 'owner', paths: [], title: clean });
      this.title = clean;
      return { applied: true, title: clean };
    } catch {
      return { applied: false };
    }
  }

  private async askAgent({ text }: Args): Promise<{ status: string; via: string | null }> {
    const out = await this.ctx.agentHook.request({ label: this.declaration.key ?? 'page', text: String(text ?? '').slice(0, 20_000) });
    return { status: out?.status ?? 'delivered', via: out?.via ?? null };
  }

  private async activity(): Promise<{ working: boolean; available: boolean }> {
    const p = await this.presence();
    return { working: !!p?.busy, available: !!p };
  }

  // ---- the page's own origin (Site.content) ------------------------------------------------------------------------

  async content(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(req, res, 405, 'Method not allowed');
    res.on('finish', () => {
      if (res.statusCode >= 400 && !String(req.url).endsWith('/_files.json')) this.log(`content ${req.method} ${req.url} → ${res.statusCode}`);
    });
    const url = new URL(req.url ?? '/', 'http://local');
    const p = url.pathname;
    if (p === '/' || p === '/index.html') {
      res.writeHead(302, { Location: `/_f/${this.ver}/${url.search}`, 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (p === '/_runtime/open-artifact-frame.js') return this.sendScript(req, res, 'runtime');
    const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(p);
    if (blob) return this.sendBlob(req, res, blob[1]!);
    const m = /^\/_f\/([A-Za-z0-9_-]{1,128})\/(.*)$/.exec(p);
    if (!m) return deny(req, res, 404, 'Not found');
    let rel: string;
    try {
      rel = decodeURIComponent(m[2]!);
    } catch {
      return deny(req, res, 400, 'Bad path');
    }
    if (rel === '' || rel === 'index.html') return this.sendIndex(req, res);
    if (rel === '_files.json') {
      const manifest = this.files.manifest();
      // An artifact with no files yet has no listing: the original pages read that 404 as "start empty".
      if (Object.keys(manifest.files).length === 0) return json(res, 404, { code: 'empty', message: 'No files yet.' }, req.method === 'HEAD');
      return json(res, 200, { ver: manifest.ver, files: manifest.files }, req.method === 'HEAD');
    }
    const clean = cleanPath(rel);
    if (!clean || clean.split('/').some((s) => s.startsWith('.'))) return deny(req, res, 404, 'Not found');
    if (clean.startsWith('artifact-type/')) {
      const file = join(this.typeDir, clean);
      if (!file.startsWith(join(this.typeDir, 'artifact-type') + sep)) return deny(req, res, 404, 'Not found');
      return this.sendFile(req, res, file, contentTypeOf(file), true);
    }
    if (typePath(clean)) return deny(req, res, 404, 'Not found');
    const file = this.files.resolve(clean);
    if (!file) return deny(req, res, 404, 'Not found');
    return this.sendFile(req, res, file, contentTypeOf(file));
  }

  contentUpgrade(_req: IncomingMessage, socket: Duplex): void {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  }

  /** The type's index.html with the Frame Runtime first in its <head>. */
  private sendIndex(req: IncomingMessage, res: ServerResponse): void {
    let html: string;
    try {
      html = readFileSync(join(this.typeDir, 'index.html'), 'utf8');
    } catch {
      return deny(req, res, 500, 'The type has no index.html.');
    }
    const boot: FrameBoot = {
      shellOrigin: this.shellOrigin,
      id: this.id,
      key: this.declaration.key,
      grants: this.grants,
      stubs: Object.keys(this.stubs),
      contract: CONTRACT,
      ...(process.env.OPEN_ARTIFACT_FRAME_DEBUG ? { debug: true } : {}),
    };
    const safe = (v: unknown): string => JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const inject =
      `<script>window.__FRAME_PREAMBLE=${safe({ origins: [this.shellOrigin] })};window.__OPEN_ARTIFACT_FRAME=${safe(boot)};</script>` +
      `<script src="/_runtime/open-artifact-frame.js"></script>`;
    const head = /<head\b[^>]*>/i.exec(html);
    const out = head ? html.slice(0, head.index + head[0].length) + inject + html.slice(head.index + head[0].length) : inject + html;
    const body = Buffer.from(out, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      // Every ancestor counts: the inner shell and the Open Artifact Shell around it, both on this computer.
      'Content-Security-Policy': this.ctx.hosted ? `frame-ancestors ${this.shellOrigin} ${this.ctx.hosted.shellOrigin}` : 'frame-ancestors http://127.0.0.1:* http://localhost:*',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  private sendClientFile(req: IncomingMessage, res: ServerResponse, name: string): void {
    if (name === 'shell.js') return this.sendScript(req, res, 'shell');
    if (name === 'comments.js' || name === 'comments.css') {
      return this.sendFile(req, res, builtClientFile(name), name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
    }
    const port = new URL(this.shellOrigin).port;
    if (name === 'shell.html') {
      const body = Buffer.from(readFileSync(join(CLIENT_DIR, name), 'utf8').replace(/<head\b[^>]*>/i, (head) => head + (this.ctx.hosted ? `<meta name="open-artifact-shell-origin" content="${this.ctx.hosted.shellOrigin}">` : '')));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          // The comment views' font (Inter) is inlined as data: URLs in comments.css.
          "font-src 'self' data:",
          this.ctx.hosted ? `connect-src 'self' ${this.shellOrigin.replace('https:', 'wss:')}` : `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
          // CSP host sources cannot spell an id with '_', so: any artifact origin on this server's port.
          this.ctx.hosted ? `frame-src ${this.contentOrigin}` : `frame-src http://*.frame.localhost:${port}`,
          "base-uri 'none'",
          "form-action 'none'",
          ...(this.ctx.hosted ? [`frame-ancestors ${this.ctx.hosted.shellOrigin}`] : []),
        ].join('; '),
        'Referrer-Policy': 'origin',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    return this.sendFile(req, res, join(CLIENT_DIR, name), 'text/css; charset=utf-8');
  }

  /** A browser script: the built `<name>.js`, or, from source, `<name>.ts` with its types stripped. */
  private sendScript(req: IncomingMessage, res: ServerResponse, name: 'runtime' | 'shell'): void {
    const built = join(CLIENT_DIR, `${name}.js`);
    try {
      if (statSync(built).isFile()) return this.sendFile(req, res, built, 'text/javascript; charset=utf-8');
    } catch {
      // not built: from source
    }
    let code: string;
    try {
      code = scriptFromSource(join(CLIENT_DIR, `${name}.ts`));
    } catch (error) {
      this.log(`client ${name}: ${(error as Error)?.message ?? error}`);
      return deny(req, res, 500, `The frame ${name} script is missing.`);
    }
    const body = Buffer.from(code, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  private sendBlob(req: IncomingMessage, res: ServerResponse, id: string): void {
    const meta = this.blobs.meta(id);
    if (!meta) return deny(req, res, 404, 'Not found');
    const extra: Record<string, string> = meta.contentType === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {};
    return this.sendFile(req, res, join(this.blobs.dir, id), meta.contentType, true, { ...extra, 'Cache-Control': 'public, max-age=31536000, immutable' });
  }

  private sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, cacheable = false, extra: Record<string, string> = {}): void {
    let st;
    try {
      st = statSync(file);
      if (!st.isFile()) throw new Error('not a file');
    } catch {
      return deny(req, res, 404, 'Not found');
    }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers: Record<string, string | number> = {
      'Content-Type': type,
      'Cache-Control': cacheable ? 'no-cache' : 'no-store',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  }
}

// ---- helpers -----------------------------------------------------------------------------------------------------------

const stripped = new Map<string, { mtimeMs: number; code: string }>();

/**
 * A client file only a build makes (the comment views, comments.js and
 * comments.css): beside the bundle, or, from source, in the repository's
 * built frame-host client folder.
 */
function builtClientFile(name: string): string {
  const here = join(CLIENT_DIR, name);
  if (existsSync(here)) return here;
  return join(CLIENT_DIR, '..', '..', '..', '..', '..', 'dist', 'daemon', 'frame-host', 'client', name);
}

/** A client .ts as a browser script: types stripped by Node (no bundling: the client files import types only). */
function scriptFromSource(file: string): string {
  const st = statSync(file);
  const have = stripped.get(file);
  if (have && have.mtimeMs === st.mtimeMs) return have.code;
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string, options?: { mode?: string }) => string }).stripTypeScriptTypes;
  if (typeof strip !== 'function') throw new Error('this Node cannot strip TypeScript; build the client scripts (node scripts/build.mjs --only frame).');
  const code = strip(readFileSync(file, 'utf8'), { mode: 'strip' });
  stripped.set(file, { mtimeMs: st.mtimeMs, code });
  return code;
}

const numberOrUndefined = (v: string | null): number | undefined => (v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** A thread as a page sees it. */
function pageThread(t: Thread): Record<string, unknown> {
  let anchor: unknown = t.location?.custom;
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
    resolved: t.status === 'resolved',
    status: t.status,
    agent: t.agent ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: t.messages.map((m) => ({ id: m.id, author: m.author, text: m.text, at: m.at })),
  };
}

function errorOf(error: unknown): CapErrorBody {
  const e = error as Partial<FrameError> | null;
  return { code: typeof e?.code === 'string' ? e.code : 'upstream_error', message: e?.message ?? String(error), ...(e?.extra ?? {}) };
}

function json(res: ServerResponse, status: number, body: unknown, headOnly = false): void {
  const text = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': text.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(headOnly ? undefined : text);
}

function deny(req: IncomingMessage, res: ServerResponse, status: number, message: string): void {
  req.resume?.();
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new FrameError('too_large', `The request is over ${limit} bytes.`, 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---- the agent's actions -------------------------------------------------------------------------------------------

function frameOf(artifact: ArtifactRef): FrameSite {
  const site = artifact.site;
  if (!(site instanceof FrameSite)) throw new FrameError('not_found', `${artifact.id} is not open here.`, 404);
  return site;
}

/**
 * The type's actions (`/__open-artifact/actions/<name>`): `info` for Artifact `call`,
 * and the hidden `open-artifact.db.*` and `open-artifact.comments.*` that ArtifactData and
 * ArtifactComments use, in the shapes `libraryActions` answers.
 */
export const frameActions: Record<string, ServerAction> = {
  info: {
    title: 'What the artifact holds',
    run: (artifact) => {
      const site = frameOf(artifact);
      const manifest = site.files.manifest();
      return {
        info: {
          type: site.declaration.key,
          contract: CONTRACT,
          capabilities: site.grants,
          ver: manifest.ver,
          brokerGen: site.brokerGen,
          files: Object.entries(manifest.files).map(([p, f]) => ({ path: p, size: f.size })),
          db: site.db.listAll().length,
          assets: site.blobs.list().usage,
          comments: { open: site.comments.openCount() },
        },
      };
    },
  },
  'open-artifact.db.read': { hidden: true, run: (artifact, a) => frameOf(artifact).db.readDb(a.path || undefined, { query: a.query, limit: a.limit, cursor: a.cursor }) },
  'open-artifact.db.write': {
    hidden: true,
    run: (artifact, a) => ({ writes: frameOf(artifact).db.writeDb(Array.isArray(a.writes) ? a.writes : [], { requireIfMatch: a.require_if_match === true }) }),
  },
  'open-artifact.comments.read': {
    hidden: true,
    run: (artifact, a) => ({
      threads: frameOf(artifact)
        .comments.threads({ all: !!a.all })
        .map((t, i) => agentView(t, i + 1)),
      // A thread without `agent` was not sent to the agent: the daemon keeps the agent's replies off it.
      sent_tracked: true,
    }),
  },
  'open-artifact.comments.reply': {
    hidden: true,
    run: (artifact, a) => {
      const site = frameOf(artifact);
      const { thread } = site.comments.addMessage(a.thread_id, { ...AGENT_AUTHOR }, a.text, { resolve: !!a.resolve });
      site.commentsChanged();
      return { thread: agentView(thread) };
    },
  },
  'open-artifact.comments.resolve': {
    hidden: true,
    run: (artifact, a) => {
      const site = frameOf(artifact);
      const thread = site.comments.setResolved(a.thread_id, !a.reopen, { ...AGENT_AUTHOR });
      site.commentsChanged();
      return { thread: agentView(thread) };
    },
  },
};
