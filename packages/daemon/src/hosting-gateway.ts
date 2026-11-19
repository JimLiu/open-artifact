import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import type { Duplex } from 'node:stream';
import { guestRequestHeaders, publicGuestCookie, type GuestShareTarget } from './hosting-shares.ts';


export interface HostedArtifact {
  pageUrl: string;
  /** SDK content host, e.g. http://art_ID.frame.localhost:port/. Never an API server. */
  contentUrl?: string;
  /** Extra shared asset paths on the type server, never control or API paths. */
  assetPaths?: string[];
}
export interface HostingGatewayOptions {
  shellOrigin: string;
  /** HTTPS origin template with exactly one {id} hostname label. */
  frameOrigin: string;
  listenHost: string;
  port: number;
  stateFile: string;
  shellUpstream: string;
  resolveArtifact(id: string): Promise<HostedArtifact | null>;
  /** Native sharing listener; must already be validated as a local non-loopback target. */
  resolveGuest?(id: string): Promise<GuestShareTarget | null>;
  /** Transform shell HTML/JSON boot data. Never return daemon bearer credentials. */
  rewriteShellBody?(body: string, contentType: string): string | Promise<string>;
}
const ID = /^art_[a-z0-9]+$/;
const OWNER = '__Host-oa_owner';
const FRAME = '__Host-oa_frame';
const CONTENT = '__Host-oa_content';
type Identity = { id: string | null; content: boolean; guest?: boolean; external: string };
type Route = Identity & { target: URL; broker: boolean; guestTarget?: GuestShareTarget };
function contentPath(path: string): boolean {
  return path === '/' || (/^\/_f\/[A-Za-z0-9_-]{1,128}\//.test(path) && !path.split('/').includes('_api')) || path === '/_runtime/open-artifact-frame.js' || /^\/_blob\/[0-9a-f]{32}$/.test(path);
}
const blocked = /^\/(?:__hub|__harness|mcp|__open-artifact)(?:[/.]|$)|^\/api\/open-artifact\.type\./;
const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function origin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Public origins must be HTTPS origins');
  return url;
}
function localTarget(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !/^art_[a-z0-9]+\.frame\.localhost$/.test(url.hostname) || url.username || url.password) throw new Error('Upstream must be local HTTP');
  return url;
}
function cookie(req: IncomingMessage, name: string): string | undefined {
  const values = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined;
}
function cleanPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\r\n\0]/.test(value)) throw new Error('Invalid path');
  const path = decodeURIComponent(value.split('?')[0]!);
  if (/[\\\0]/.test(path) || path.split('/').some(part => part === '.' || part === '..') || /%[0-9a-f]{2}/i.test(path)) throw new Error('Invalid path');
  return path;
}
function reply(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(message);
}

/** Private local upstreams; capability-authenticated public origins behind a TLS terminator. */
export class HostingGateway {
  private readonly options: HostingGatewayOptions;
  private readonly shell: URL;
  private readonly key: Buffer;
  private readonly tickets = new Map<string, number>();
  private readonly sockets = new Set<Duplex>();
  private readonly server = createServer((req, res) => { void this.handle(req, res).catch(() => { if (!res.headersSent) reply(res, 502, 'Artifact upstream unavailable'); else res.destroy(); }); });
  constructor(options: HostingGatewayOptions) {
    this.options = options;
    this.shell = origin(options.shellOrigin);
    if ((options.frameOrigin.match(/\{id\}/g) || []).length !== 1 || !options.frameOrigin.includes('://{id}.')) throw new Error('Frame origin requires an isolated {id} hostname label');
    const frame = origin(options.frameOrigin.replace('{id}', 'art_test'));
    if (frame.host === this.shell.host) throw new Error('Frame and shell origins must be isolated');
    if (!isIP(options.listenHost) || ['0.0.0.0', '::', '::1'].includes(options.listenHost) || options.listenHost.startsWith('127.')) throw new Error('Gateway requires a concrete non-loopback listen address');
    localTarget(options.shellUpstream);
    mkdirSync(dirname(options.stateFile), { recursive: true });
    try { this.key = Buffer.from(readFileSync(options.stateFile, 'utf8'), 'hex'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.key = randomBytes(32);
      writeFileSync(options.stateFile, this.key.toString('hex'), { mode: 0o600, flag: 'wx' });
    }
    if (this.key.length !== 32) throw new Error('Invalid hosting capability state');
    this.server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    this.server.on('upgrade', (req, socket, head) => { void this.upgrade(req, socket, head).catch(() => socket.destroy()); });
  }
  private sign(value: string): string { return createHmac('sha256', this.key).update(value).digest('base64url'); }
  private equal(a: string | undefined, b: string): boolean { const left = Buffer.from(a || ''); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
  ownerUrl(path = '/'): string {
    cleanPath(path);
    return `${this.shell.origin}/__hosting/owner/${this.sign('owner-link')}?next=${encodeURIComponent(path)}`;
  }
  frameOrigin(id: string): string { if (!ID.test(id)) throw new Error('Invalid artifact id'); return origin(this.options.frameOrigin.replace('{id}', id.replace('art_', 'art-'))).origin; }
  guestOrigin(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid artifact id');
    return origin(this.options.frameOrigin.replace('{id}', `guest-${id.replace('art_', 'art-')}`)).origin;
  }
  guestUrl(id: string, token: string): string {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new Error('Invalid guest token');
    return `${this.guestOrigin(id)}/s/${token}`;
  }
  contentOrigin(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid artifact id');
    return origin(this.options.frameOrigin.replace('{id}', `content-${id.replace('art_', 'art-')}`)).origin;
  }
  /** Reusable read-only artifact capability: cached SDK frame sessions outlive bootstrap tickets. */
  contentUrl(id: string, path = '/'): string {
    cleanPath(path);
    if (!contentPath(cleanPath(path))) throw new Error('Invalid content destination');
    return `${this.contentOrigin(id)}/__hosting/content/${this.sign(`content-link:${id}`)}?next=${encodeURIComponent(path)}`;
  }
  contentBootstrapUrl(id: string): string {
    return this.contentUrl(id).split('?')[0]!;
  }
  /** Call only when rendering authenticated shell boot data, never in an anonymous response. */
  frameUrl(id: string, path = '/'): string {
    return this.bootstrapUrl(id, path, false);
  }
  private bootstrapUrl(id: string, path: string, content: boolean): string {
    const external = content ? this.contentOrigin(id) : this.frameOrigin(id);
    cleanPath(path);
    const nonce = randomBytes(24).toString('base64url');
    const expires = Date.now() + 60_000;
    for (const [ticket, at] of this.tickets) if (at < Date.now()) this.tickets.delete(ticket);
    this.tickets.set(`${content ? 'content' : 'frame'}:${id}:${nonce}`, expires);
    return `${external}/__hosting/${content ? 'content' : 'frame'}/${nonce}?next=${encodeURIComponent(path)}`;
  }
  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.options.port, this.options.listenHost, () => { this.server.off('error', reject); resolve(); }); });
    return (this.server.address() as { port: number }).port;
  }
  async close(): Promise<void> { for (const socket of this.sockets) socket.destroy(); await new Promise<void>(resolve => this.server.close(() => resolve())); }
  private identity(req: IncomingMessage): Identity | null {
    const host = req.headers.host;
    if (host === this.shell.host) return { id: null, content: false, external: this.shell.origin };
    const template = origin(this.options.frameOrigin.replace('{id}', 'art_test')).host;
    const suffix = template.slice('art_test'.length);
    if (!host?.endsWith(suffix)) return null;
    const label = host.slice(0, -suffix.length);
    const content = label.startsWith('content-');
    const guest = label.startsWith('guest-');
    const publicId = content ? label.slice('content-'.length) : guest ? label.slice('guest-'.length) : label;
    const id = publicId.replace(/^art-/, 'art_');
    if (publicId !== id.replace('art_', 'art-')) return null;
    return ID.test(id) ? { id, content, guest, external: content ? this.contentOrigin(id) : guest ? this.guestOrigin(id) : this.frameOrigin(id) } : null;
  }
  private authorized(req: IncomingMessage, who: Identity): boolean { return this.equal(cookie(req, who.id ? who.content ? CONTENT : FRAME : OWNER), this.sign(who.id ? `${who.content ? 'content' : 'frame'}:${who.id}` : 'owner-cookie')); }
  private headers(req: IncomingMessage, target: URL): OutgoingHttpHeaders {
    const headers: OutgoingHttpHeaders = {};
    const connection = new Set(String(req.headers.connection || '').toLowerCase().split(',').map(v => v.trim()));
    for (const [name, value] of Object.entries(req.headers)) {
      if (!hop.has(name) && !connection.has(name) && !['host', 'cookie', 'authorization', 'origin', 'referer', 'accept-encoding', 'forwarded'].includes(name) && !name.startsWith('x-forwarded-')) headers[name] = value;
    }
    headers.host = target.host;
    if (req.headers.origin !== undefined) headers.origin = target.origin;
    headers['accept-encoding'] = 'identity';
    return headers;
  }
  private async route(req: IncomingMessage, preflight = false): Promise<Route | null> {
    const who = this.identity(req);
    if (!who) return null;
    if (who.guest && who.id) {
      if (req.headers.origin !== undefined && req.headers.origin !== who.external) return null;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && req.headers.origin !== who.external) return null;
      const path = cleanPath(req.url || '/');
      if (blocked.test(path)) return null;
      const guest = await this.options.resolveGuest?.(who.id);
      if (!guest || guest.id !== who.id) return null;
      const upstream = new URL(guest.upstream);
      const address = upstream.hostname.replace(/^\[|\]$/g, '');
      if (upstream.protocol !== 'http:' || !isIP(address) || address.startsWith('127.') || ['::1', '0.0.0.0', '::'].includes(address) || address.toLowerCase().startsWith('::ffff:') || upstream.username || upstream.password) return null;
      const join = /^\/s\/[A-Za-z0-9_-]{16,64}$/.test(path);
      if (!join && !path.startsWith(guest.pagePath) && !/^\/_blob\/[A-Za-z0-9_-]+(?:\.[a-z0-9]+)?$/.test(path)) return null;
      return { ...who, target: new URL(req.url!, upstream), broker: false, guestTarget: guest };
    }
    if (!preflight && !this.authorized(req, who)) return null;
    const broker = !who.guest && !who.content && who.id !== null && req.headers.origin === this.shell.origin;
    if (req.headers.origin !== undefined && req.headers.origin !== who.external && !broker) return null;
    const path = cleanPath(req.url || '/');
    if (blocked.test(path)) return null;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && req.headers.origin !== who.external && !broker) return null;
    if (!who.id) {
      if (!(path === '/' || path === '/index.html' || path === '/favicon.ico' || /^\/a\/art_[a-z0-9]+\/?$/.test(path) || path.startsWith('/_open-artifact/shell/') || path.startsWith('/_open-artifact/home/') || /^\/api\/open-artifact\.(?!type\.)[a-zA-Z0-9.-]+$/.test(path))) return null;
      return { ...who, broker, target: new URL(req.url!, localTarget(this.options.shellUpstream)) };
    }
    const artifact = await this.options.resolveArtifact(who.id);
    if (!artifact) return null;
    if (who.content) {
      if (!artifact.contentUrl || !['GET', 'HEAD'].includes(req.method || '') || !contentPath(path)) return null;
      const upstream = localTarget(artifact.contentUrl);
      if (upstream.hostname !== `${who.id}.frame.localhost` || upstream.pathname !== '/') return null;
      return { ...who, broker: false, target: new URL(req.url!, upstream) };
    }
    const page = localTarget(artifact.pageUrl);
    const prefix = page.pathname.endsWith('/') ? page.pathname : page.pathname.slice(0, page.pathname.lastIndexOf('/') + 1);
    if (path !== '/' && !path.startsWith(prefix) && !(artifact.assetPaths || []).some(p => p !== '/' && path.startsWith(p))) return null;
    if (broker && (!path.startsWith(`${prefix}_api/`) || !['GET', 'HEAD', 'POST', 'OPTIONS'].includes(req.method || ''))) return null;
    const target = new URL(req.url!, page.origin);
    if (path === '/') { target.pathname = page.pathname; target.search = page.search + (target.search ? `${page.search ? '&' : '?'}${target.search.slice(1)}` : ''); }
    return { ...who, target, broker };
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const who = this.identity(req);
    if (!who) return reply(res, 421, 'Misdirected request');
    let path: string;
    try { path = cleanPath(req.url || '/'); } catch { return reply(res, 400, 'Invalid path'); }
    const broker = !who.guest && !who.content && who.id !== null && req.headers.origin === this.shell.origin;
    if (req.headers.origin !== undefined && req.headers.origin !== who.external && !broker) return reply(res, 403, 'Cross-origin request refused');
    if (req.method === 'OPTIONS' && broker) {
      const method = req.headers['access-control-request-method'];
      const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      const route = await this.route(req, true);
      if (!route?.broker || !['GET', 'HEAD', 'POST'].includes(String(method)) || requested.some(name => name !== 'content-type')) return reply(res, 403, 'Preflight not granted');
      res.writeHead(204, {
        'Access-Control-Allow-Origin': this.shell.origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
        'Cache-Control': 'no-store'
      }).end();
      return;
    }
    const owner = /^\/__hosting\/owner\/([\w-]+)$/.exec(path);
    const frame = /^\/__hosting\/frame\/([\w-]+)$/.exec(path);
    const content = /^\/__hosting\/content\/([\w-]+)$/.exec(path);
    if (!who.guest && ((owner && !who.id) || (frame && who.id && !who.content) || (content && who.content))) {
      if (broker) return reply(res, 403, 'Cross-origin bootstrap refused');
      if (req.method !== 'GET') return reply(res, 405, 'GET required');
      const ticket = `${who.content ? 'content' : 'frame'}:${who.id}:${(content || frame)?.[1]}`;
      const valid = owner ? this.equal(owner[1], this.sign('owner-link')) : content ? this.equal(content[1], this.sign(`content-link:${who.id}`)) : (this.tickets.get(ticket) || 0) > Date.now();
      if (!valid) return reply(res, 403, 'Invalid capability');
      if (frame || content) this.tickets.delete(ticket);
      const next = new URL(req.url!, who.external).searchParams.get('next') || '/';
      try { if (who.content && !contentPath(cleanPath(next))) throw new Error('Invalid content destination'); cleanPath(next); } catch { return reply(res, 400, 'Invalid destination'); }
      res.writeHead(303, { Location: next, 'Set-Cookie': `${who.id ? who.content ? CONTENT : FRAME : OWNER}=${this.sign(who.id ? `${who.content ? 'content' : 'frame'}:${who.id}` : 'owner-cookie')}; Path=/; Secure; HttpOnly; SameSite=${who.id ? 'None' : 'Strict'}; Max-Age=31536000`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end();
      return;
    }
    const route = await this.route(req);
    if (!route) return reply(res, 403, 'Not granted');
    const requestHeaders = route.guestTarget ? guestRequestHeaders(route.guestTarget, req.headers, route.external) : this.headers(req, route.target);
    if (!route.guest && /^\/f\/[^/]+\//.test(route.target.pathname) && req.headers.origin !== undefined) requestHeaders.origin = route.external;
    const upstream = request(route.target, { method: req.method, headers: requestHeaders, ...route.guest ? {} : { hostname: '127.0.0.1', family: 4 } }, response => {
      const headers: OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(response.headers)) if (!hop.has(name) && name !== 'set-cookie' && !name.startsWith('access-control-')) headers[name] = value;
      if (route.guestTarget) {
        const cookies = (response.headers['set-cookie'] || []).map(value => publicGuestCookie(route.guestTarget!, value)).filter((value): value is string => value !== null);
        if (cookies.length) headers['set-cookie'] = cookies;
      }
      if (route.broker) {
        headers['access-control-allow-origin'] = this.shell.origin;
        headers['access-control-allow-credentials'] = 'true';
        headers.vary = [headers.vary, 'Origin'].filter(Boolean).join(', ');
        headers['access-control-expose-headers'] = 'Content-Disposition';
      }
      headers['cache-control'] = 'no-store';
      headers['referrer-policy'] = route.guestTarget ? 'same-origin' : 'no-referrer';
      if (response.headers.location) {
        const location = new URL(response.headers.location, route.target);
        if (location.origin !== route.target.origin || route.guestTarget && !location.pathname.startsWith(route.guestTarget.pagePath)) { response.resume(); reply(res, 502, 'External redirect refused'); return; }
        headers.location = `${route.external}${location.pathname}${location.search}${location.hash}`;
      }
      const type = String(response.headers['content-type'] || '');
      if (!route.id && this.options.rewriteShellBody && /(?:text\/html|application\/json)/.test(type)) {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) { response.destroy(); res.destroy(); } else chunks.push(chunk); });
        response.on('end', () => { void Promise.resolve(this.options.rewriteShellBody!(Buffer.concat(chunks).toString(), type)).then(body => { delete headers['content-length']; delete headers['content-encoding']; res.writeHead(response.statusCode || 502, headers).end(body); }).catch(() => res.destroy()); });
      } else { res.writeHead(response.statusCode || 502, headers); response.pipe(res); }
      response.on('error', () => res.destroy());
    });
    upstream.on('error', () => { if (!res.headersSent) reply(res, 502, 'Artifact upstream unavailable'); else res.destroy(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }
  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const route = await this.route(req);
    if (!route || !route.id || route.content || (req.headers.origin !== route.external && !route.broker) || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const headers = route.guestTarget ? guestRequestHeaders(route.guestTarget, req.headers, route.external) : this.headers(req, route.target);
    if (!route.guest && /^\/f\/[^/]+\//.test(route.target.pathname)) headers.origin = route.external;
    headers.connection = 'Upgrade'; headers.upgrade = 'websocket';
    const upstream = request(route.target, { headers, ...route.guest ? {} : { hostname: '127.0.0.1', family: 4 } });
    upstream.on('upgrade', (response, peer, first) => {
      this.sockets.add(peer);
      peer.on('close', () => { this.sockets.delete(peer); socket.destroy(); });
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).filter(([name]) => ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol'].includes(name)).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (first.length) socket.write(first);
      if (head.length) peer.write(head);
      peer.pipe(socket); socket.pipe(peer);
      socket.on('close', () => peer.destroy()); peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy());
    });
    upstream.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.end();
  }
}
