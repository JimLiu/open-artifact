/**
 * The ChatGPT connector (`open-artifact chatgpt`): the daemon's MCP tools over Streamable HTTP for ChatGPT on the
 * web, which reaches MCP servers only over HTTPS. ChatGPT desktop runs local plugins (the Codex plugin) and needs none
 * of this.
 *
 * It is its own small server, so the daemon's `/mcp` stays what it is (loopback, the daemon token, no Origin): this
 * one listens on loopback too, answers only at `/mcp/<secret>` (the secret kept in `$OPEN_ARTIFACT_HOME/chatgpt.json`),
 * refuses browser Origins other than ChatGPT's, and calls the daemon as harness `chatgpt` for one workspace. The
 * person puts it behind an HTTPS tunnel (OpenAI's Secure MCP Tunnel or any other) and adds the tunnel's URL, with the
 * secret path, as a custom MCP server in ChatGPT, with no authentication: the secret path is the key.
 *
 * On top of the daemon's tools it adds:
 * - `ShowArtifact {url}`: an MCP Apps card (`ui://open-artifact/card.html`) in the conversation, with "Open" and
 *   "Send comments to ChatGPT", which puts a message in the conversation for ChatGPT to read the comments; ChatGPT
 *   cannot be woken from outside a turn, so that button is how "Send to agent" reaches it;
 * - a note in the instructions: ChatGPT has no file tools here, so files go through `Artifact` publish and read.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { DaemonState } from '@open-artifact/protocol';
import { openArtifactHome, writeJson } from './paths.ts';

/** The card's resource. */
export const CARD_URI = 'ui://open-artifact/card.html';
/** MCP Apps' HTML resource type. */
const CARD_MIME = 'text/html;profile=mcp-app';
/** The largest request accepted (a publish carries whole files), bytes. */
const MAX_BODY = 32 * 1024 * 1024;
/** Browser Origins let in; ChatGPT's own servers send none. */
const ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);

/** What ChatGPT is told on top of the daemon's instructions. */
export const CHATGPT_NOTE = [
  'In ChatGPT:',
  '- You have no file tools on the computer the artifacts live on. Write an artifact\'s files with Artifact {action: "publish", url, files: {"<path in root>": "<text>"}} and read them with Artifact {action: "read", url, path}; where the instructions say to write files into root, do that.',
  '- Artifact {action: "open"} cannot show the page in ChatGPT. Once the artifact is filled and checked, call ShowArtifact {url}: it shows a card with an Open button. Also give the view_url link.',
  '- The person comments on the page. Their comments reach you in the messages of your next Open Artifact call, or as a message when they press "Send comments to ChatGPT" on the card: then read them with ArtifactComments {action: "read", url}, handle them and reply.',
].join('\n');

/** The connector's own tool. */
const SHOW_TOOL = {
  name: 'ShowArtifact',
  title: 'Show artifact',
  description:
    'Show an Open Artifact as a card in the conversation, with an Open button for its page and a button that sends the comments people left on it back to you. Call it once an artifact is filled and checked.',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'The artifact: open-artifact://artifact/<id>.' } },
    required: ['url'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  _meta: {
    ui: { resourceUri: CARD_URI },
    'openai/outputTemplate': CARD_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': 'Showing the artifact…',
    'openai/toolInvocation/invoked': 'Artifact shown',
  },
};

/** The secret path segment, made on first use and kept. */
export function chatgptSecret(rotate = false): string {
  const file = join(openArtifactHome(), 'chatgpt.json');
  if (!rotate && existsSync(file)) {
    try {
      const secret = (JSON.parse(readFileSync(file, 'utf8')) as { secret?: string }).secret;
      if (secret && /^[A-Za-z0-9_-]{24,}$/.test(secret)) return secret;
    } catch {
      // made again below
    }
  }
  const secret = randomBytes(24).toString('base64url');
  writeJson(file, { secret });
  return secret;
}

export interface ChatGptOptions {
  port: number;
  /** The folder new artifacts go under (`<workspace>/artifacts/<title>`), and whose artifacts are this connector's. */
  workspace: string;
  secret: string;
  /** The running daemon (started when none runs). */
  daemon(): Promise<DaemonState>;
  log(line: string): void;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Starts the connector; resolves once it listens. */
export async function serveChatGpt(options: ChatGptOptions): Promise<Server> {
  const path = `/mcp/${options.secret}`;
  let state = await options.daemon();

  const daemonCall = async (message: Rpc): Promise<{ status: number; body: string }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`${state.url}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`,
            'X-Open-Artifact-Harness': 'chatgpt',
            'X-Open-Artifact-Workspace': encodeURIComponent(options.workspace),
          },
          body: JSON.stringify(message),
        });
        return { status: response.status, body: await response.text() };
      } catch (error) {
        if (attempt) throw error;
        state = await options.daemon();
      }
    }
  };

  const toolResult = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { body } = await daemonCall({ jsonrpc: '2.0', id: 'show', method: 'tools/call', params: { name, arguments: args } });
    const reply = JSON.parse(body) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message: string } };
    if (reply.error) throw new Error(reply.error.message);
    const [first, ...rest] = reply.result?.content ?? [];
    const result = JSON.parse(first?.text ?? '{}') as Record<string, unknown>;
    if (rest.length) result.messages = rest.map((c) => c.text ?? '');
    return result;
  };

  /** One message → its answer, or null for a notification. */
  const one = async (message: Rpc): Promise<unknown> => {
    const { id, method, params } = message;
    const reply = (result: unknown): unknown => (id === undefined ? null : { jsonrpc: '2.0', id, result });
    switch (method) {
      case 'resources/list':
        return reply({ resources: [{ uri: CARD_URI, name: 'open-artifact-card', title: 'Open Artifact card', mimeType: CARD_MIME }] });
      case 'resources/templates/list':
        return reply({ resourceTemplates: [] });
      case 'resources/read': {
        if (params?.uri !== CARD_URI) return id === undefined ? null : { jsonrpc: '2.0', id, error: { code: -32002, message: `No resource ${String(params?.uri)}` } };
        return reply({
          contents: [
            {
              uri: CARD_URI,
              mimeType: CARD_MIME,
              text: CARD_HTML,
              _meta: {
                ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
                'openai/widgetPrefersBorder': true,
                'openai/widgetDescription': 'An Open Artifact: its title and type, an Open button for its page, and a button that sends its comments to ChatGPT.',
                'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
              },
            },
          ],
        });
      }
      case 'tools/call': {
        if (params?.name !== SHOW_TOOL.name) break;
        const url = String((params.arguments as { url?: unknown } | undefined)?.url ?? '');
        try {
          const opened = await toolResult('Artifact', { action: 'open', url });
          const listed = await toolResult('Artifact', { action: 'list', scope: 'all', limit: 200 });
          const found = ((listed.artifacts as Array<{ url: string; title?: string; type?: string }> | undefined) ?? []).find((a) => a.url === url);
          const messages = [...((opened.messages as string[] | undefined) ?? []), ...((listed.messages as string[] | undefined) ?? [])];
          const card = { url, title: found?.title ?? opened.title ?? '', type: found?.type ?? opened.type ?? '', view_url: opened.view_url ?? '' };
          return reply({
            content: [
              { type: 'text', text: JSON.stringify({ ...card, note: 'The card is shown. Give the person view_url too.' }, null, 2) },
              ...messages.map((text) => ({ type: 'text', text })),
            ],
            structuredContent: card,
          });
        } catch (error) {
          return reply({ content: [{ type: 'text', text: JSON.stringify({ error: { message: (error as Error).message } }) }], isError: true });
        }
      }
    }
    // Everything else is the daemon's; initialize and tools/list gain the connector's parts.
    const { status, body } = await daemonCall(message);
    if (status === 202 || !body) return null;
    const answer = JSON.parse(body) as { result?: Record<string, unknown> };
    if (answer.result && method === 'initialize') {
      answer.result.capabilities = { ...((answer.result.capabilities as object) ?? {}), resources: {} };
      answer.result.instructions = `${String(answer.result.instructions ?? '')}\n\n${CHATGPT_NOTE}`.trim();
    }
    if (answer.result && method === 'tools/list') {
      answer.result.tools = [...((answer.result.tools as unknown[]) ?? []), SHOW_TOOL];
    }
    return answer;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, value?: unknown, headers: Record<string, string> = {}): void => {
      if (value === undefined) {
        res.writeHead(status, headers).end();
        return;
      }
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(value));
    };
    const url = new URL(req.url ?? '/', 'http://local');
    const given = Buffer.from(url.pathname);
    const wanted = Buffer.from(path);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      req.resume();
      return send(404, { error: 'not found' });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !ORIGINS.has(origin)) {
      req.resume();
      return send(403, { error: 'origin not allowed' });
    }
    if (req.method === 'DELETE') {
      req.resume();
      return send(200);
    }
    if (req.method !== 'POST') {
      req.resume();
      return send(405, undefined, { Allow: 'POST, DELETE' });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) return send(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large.' } });
      chunks.push(chunk as Buffer);
    }
    let body: Rpc | Rpc[];
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Rpc | Rpc[];
    } catch {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const answers = (await Promise.all((Array.isArray(body) ? body : [body]).map(one))).filter((a) => a !== null);
    if (!answers.length) return send(202);
    return send(200, Array.isArray(body) ? answers : answers[0], { 'Mcp-Session-Id': 'open-artifact-chatgpt' });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      options.log(`chatgpt: ${(error as Error)?.stack ?? error}`);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  return server;
}

/**
 * The card: ChatGPT's `window.openai` when it is there, else the MCP Apps messages (`ui/initialize`,
 * `ui/notifications/tool-result`, `ui/message`, `ui/open-link`) for other MCP Apps hosts. It takes messages from its
 * host frame (`window.parent`) only.
 */
export const CARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e8;--accent:#2f5bb7;--accent-fg:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#1f1f22;--fg:#f2f2f4;--muted:#a0a0a8;--line:#36363b;--accent:#7f9fe6;--accent-fg:#111}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{display:flex;gap:14px;align-items:center;padding:14px 16px;flex-wrap:wrap}
.icon{width:40px;height:40px;flex:none}
.text{flex:1;min-width:160px}.title{font-weight:600;font-size:15px;overflow-wrap:anywhere}.meta{color:var(--muted);font-size:12.5px;margin-top:2px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
button{font:inherit;font-weight:550;border-radius:8px;padding:7px 12px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--fg)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
button:disabled{opacity:.55;cursor:default}
.hint{color:var(--muted);font-size:12.5px;padding:0 16px 12px}
</style></head><body>
<div class="card">
<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)" aria-hidden="true"><path d="M15 9V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h3"/><rect x="9" y="9" width="12" height="12" rx="3"/><circle cx="15" cy="15" r="2" fill="currentColor" stroke="none"/></svg>
<div class="text"><div class="title" id="title">Open Artifact</div><div class="meta" id="meta">Loading…</div></div>
<div class="actions"><button id="open" disabled>Open</button><button id="send" class="primary" disabled>Send comments to ChatGPT</button></div>
</div>
<div class="hint" id="hint">Comment on the page, then press “Send comments to ChatGPT”.</div>
<script>
(function(){
  var data=null, nextId=1, pending={};
  var oa=window.openai;
  function rpc(method,params){var id=nextId++;window.parent.postMessage({jsonrpc:'2.0',id:id,method:method,params:params||{}},'*');return new Promise(function(r){pending[id]=r;});}
  function notify(method,params){window.parent.postMessage({jsonrpc:'2.0',method:method,params:params||{}},'*');}
  function show(d){
    if(!d||!d.url)return; data=d;
    document.getElementById('title').textContent=d.title||'Untitled artifact';
    document.getElementById('meta').textContent=(d.type?d.type+' · ':'')+(d.view_url||d.url);
    document.getElementById('open').disabled=!d.view_url;
    document.getElementById('send').disabled=false;
  }
  window.addEventListener('message',function(e){
    if(e.source!==window.parent)return;
    var m=e.data; if(!m||m.jsonrpc!=='2.0')return;
    if(m.id!=null&&pending[m.id]){pending[m.id](m.result);delete pending[m.id];return;}
    if(m.method==='ui/notifications/tool-result'&&m.params)show(m.params.structuredContent);
  });
  window.addEventListener('openai:set_globals',function(){if(window.openai)show(window.openai.toolOutput);});
  if(oa){show(oa.toolOutput);}else{rpc('ui/initialize',{appInfo:{name:'open-artifact-card',version:'1'},appCapabilities:{},protocolVersion:'2025-11-21'}).then(function(){notify('ui/notifications/initialized');});}
  document.getElementById('open').onclick=function(){
    if(!data||!data.view_url)return;
    if(window.openai&&window.openai.openExternal)window.openai.openExternal({href:data.view_url});
    else if(!window.openai)rpc('ui/open-link',{url:data.view_url});
    else window.open(data.view_url,'_blank','noopener');
  };
  document.getElementById('send').onclick=function(){
    if(!data)return;
    var text='[Artifact comments sent to ChatGPT] Read the comments and requests on the artifact "'+(data.title||data.url)+'" ('+data.url+') with ArtifactComments {action: "read", url: "'+data.url+'"}, handle them, and reply to each.';
    var b=document.getElementById('send'); b.disabled=true; b.textContent='Sent';
    if(window.openai&&window.openai.sendFollowUpMessage)window.openai.sendFollowUpMessage({prompt:text});
    else rpc('ui/message',{role:'user',content:[{type:'text',text:text}]});
    setTimeout(function(){b.disabled=false;b.textContent='Send comments to ChatGPT';},4000);
  };
})();
</script></body></html>`;
