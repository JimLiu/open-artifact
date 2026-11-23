/**
 * The MCP App: an artifact's live page inside the conversation, for MCP clients that show MCP Apps
 * (the `io.modelcontextprotocol/ui` extension).
 *
 * A client that declares the extension in `initialize` (the `open-artifact mcp` bridge then sends
 * {@link MCP_HEADERS}`.ui` with every request) gets:
 * - the `ShowArtifact {url}` tool, whose `_meta.ui.resourceUri` is {@link VIEW_URI};
 * - the view resource: a bar with the artifact's title, Full screen, Open in browser and Send comments, over a frame
 *   of the artifact's page (the Shell on the daemon's loopback origin, which its CSP `frameDomains` allows);
 * - a note in the instructions saying when to call it.
 * Other clients see none of this: their tools and instructions stay as they were.
 */

/** The MCP Apps extension id. */
export const MCP_APP_EXTENSION = 'io.modelcontextprotocol/ui';
/** MCP Apps' HTML resource type. */
export const MCP_APP_MIME = 'text/html;profile=mcp-app';
/** The view's resource. */
export const VIEW_URI = 'ui://open-artifact/view.html';
/** The MCP Apps protocol version the view speaks. */
const APP_PROTOCOL = '2026-01-26';

/** Whether an `initialize` request's client capabilities show MCP Apps. */
export function clientShowsApps(capabilities: unknown): boolean {
  const extensions = (capabilities as { extensions?: Record<string, unknown> } | null | undefined)?.extensions;
  const ui = extensions?.[MCP_APP_EXTENSION] as { mimeTypes?: unknown } | undefined;
  if (!ui || typeof ui !== 'object') return false;
  return !Array.isArray(ui.mimeTypes) || ui.mimeTypes.includes(MCP_APP_MIME);
}

/** What the agent is told when its app shows MCP Apps. */
export const MCP_APP_NOTE = [
  'This app shows MCP Apps in the conversation:',
  '- Call ShowArtifact {url} to show the artifact\'s live page right in the conversation, where the person can look, edit and comment, go full screen or open it in a browser. Call it once the artifact is filled and checked — or right after the first playable batch when the type\'s instructions ask to show progress live (such as motion\'s rough cut), since the page updates live on every write. ShowArtifact does not open a browser tab by itself: always include view_url in your final reply, and if your app does not visibly render MCP Apps cards inline, also call Artifact {action: "open", url} once.',
  '- When the person presses "Send comments" there, a message asks you to read the comments: read them with ArtifactComments {action: "read", url}, handle them and reply.',
].join('\n');

/** The `ShowArtifact` tool. */
export const SHOW_TOOL = {
  name: 'ShowArtifact',
  title: 'Show artifact',
  description:
    "Show an Open Artifact in the conversation: its live page, where the person can look, edit and comment without leaving the chat, with buttons to go full screen, open it in a browser and send their comments back to you. Call it once an artifact is filled and checked, or right after the first playable batch when the type asks to show progress live (the page updates live on every write). ShowArtifact does not open a browser tab by itself — always include view_url in your final reply too (and call Artifact {action: \"open\", url} if no preview opened visibly).",
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'The artifact: open-artifact://artifact/<id>.' } },
    required: ['url'],
    additionalProperties: false,
  },
  annotations: { title: 'Show artifact', readOnlyHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: VIEW_URI } },
} as const;

/** The view's `_meta.ui`: it frames pages from the daemon's origin and fetches nothing itself. */
function viewMeta(origin: string): Record<string, unknown> {
  return { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [origin] } } };
}

/** `resources/list`'s entry. */
export function viewListing(origin: string): Record<string, unknown> {
  return { uri: VIEW_URI, name: 'open-artifact-view', title: 'Open Artifact', mimeType: MCP_APP_MIME, _meta: viewMeta(origin) };
}

/** `resources/read`'s contents. */
export function viewContents(origin: string, version: string): Record<string, unknown> {
  return { uri: VIEW_URI, mimeType: MCP_APP_MIME, text: VIEW_HTML.replace('__OPEN_ARTIFACT_VERSION__', () => JSON.stringify(version)), _meta: viewMeta(origin) };
}

/**
 * The view. It speaks the MCP Apps messages: `ui/initialize` (theme and display modes from the host context),
 * `ui/notifications/tool-result` (the artifact to show), `ui/request-display-mode`, `ui/open-link`, `ui/message`
 * and `ui/notifications/size-changed`.
 */
export const VIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Artifact</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e8;--accent:#2f5bb7;--accent-fg:#fff;color-scheme:light}
:root[data-theme=dark]{--bg:#1f1f22;--fg:#f2f2f4;--muted:#a0a0a8;--line:#36363b;--accent:#7f9fe6;--accent-fg:#111;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#1f1f22;--fg:#f2f2f4;--muted:#a0a0a8;--line:#36363b;--accent:#7f9fe6;--accent-fg:#111;color-scheme:dark}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
body{display:flex;flex-direction:column}
body.full{height:100vh}
.bar{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.icon{width:28px;height:28px;flex:none}
.text{flex:1;min-width:140px}
.title{font-weight:600;overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.actions{display:flex;gap:6px;flex-wrap:wrap}
button{font:inherit;font-size:13px;font-weight:550;border-radius:7px;padding:5px 10px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--fg)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
button:disabled{opacity:.55;cursor:default}
button[hidden]{display:none}
.stage{position:relative;height:560px;flex:none}
body.full .stage{flex:1;height:auto;min-height:0}
.stage p{position:absolute;inset:0;margin:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:var(--muted)}
iframe{position:relative;display:block;border:0;width:100%;height:100%;background:transparent}
iframe:not([src]){display:none}
</style></head><body>
<div class="bar">
<svg class="icon" viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="8" width="30" height="30" rx="6" fill="#2f5bb7"/><rect x="26" y="26" width="30" height="30" rx="6" fill="#6f8fd4" stroke="#fff" stroke-width="3"/><circle cx="41" cy="41" r="6" fill="#fff"/></svg>
<div class="text"><div class="title" id="title">Open Artifact</div><div class="meta" id="meta">Loading…</div></div>
<div class="actions">
<button id="full" hidden>Full screen</button>
<button id="open" disabled title="Open the page in your browser">Open in browser</button>
<button id="send" class="primary" disabled title="Ask the agent to read the comments you left on the page">Send comments</button>
</div>
</div>
<div class="stage" id="stage"><p id="note">The page shows here once the artifact is ready. If it stays empty, use Open in browser.</p><iframe id="page" title="Artifact page" allow="clipboard-read; clipboard-write; fullscreen"></iframe></div>
<script>
(function(){
  var VERSION=__OPEN_ARTIFACT_VERSION__;
  var data=null,nextId=1,pending={},mode='inline',modes=[],told=0;
  var root=document.documentElement,$=function(id){return document.getElementById(id);};
  function post(m){window.parent.postMessage(m,'*');}
  function rpc(method,params){var id=nextId++;post({jsonrpc:'2.0',id:id,method:method,params:params||{}});return new Promise(function(ok,fail){pending[id]={ok:ok,fail:fail};});}
  function notify(method,params){post({jsonrpc:'2.0',method:method,params:params||{}});}
  function size(){
    if(mode!=='inline')return;
    var h=Math.ceil(document.body.getBoundingClientRect().height);
    if(h!==told){told=h;notify('ui/notifications/size-changed',{height:h});}
  }
  function setMode(m){mode=m||'inline';told=0;document.body.classList.toggle('full',mode==='fullscreen');$('full').textContent=mode==='fullscreen'?'Exit full screen':'Full screen';size();}
  function context(c){
    if(!c)return;
    if(c.theme==='light'||c.theme==='dark')root.setAttribute('data-theme',c.theme);
    if(Array.isArray(c.availableDisplayModes))modes=c.availableDisplayModes;
    $('full').hidden=modes.indexOf('fullscreen')<0;
    if(c.displayMode)setMode(c.displayMode);
  }
  function show(d){
    if(!d||!d.url)return;
    data=d;
    $('title').textContent=d.title||'Untitled artifact';
    $('meta').textContent=(d.type?d.type+' · ':'')+(d.view_url||d.url);
    $('open').disabled=!d.view_url;
    $('send').disabled=false;
    if(d.view_url&&$('page').getAttribute('src')!==d.view_url)$('page').setAttribute('src',d.view_url);
    size();
  }
  window.addEventListener('message',function(e){
    if(e.source!==window.parent)return;
    var m=e.data;if(!m||m.jsonrpc!=='2.0')return;
    if(m.method===undefined){var p=pending[m.id];if(p){delete pending[m.id];if(m.error)p.fail(m.error);else p.ok(m.result);}return;}
    if(m.id!==undefined&&m.id!==null){
      if(m.method==='ui/resource-teardown'||m.method==='ping')post({jsonrpc:'2.0',id:m.id,result:{}});
      else post({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found: '+m.method}});
      return;
    }
    if(m.method==='ui/notifications/tool-result'&&m.params)show(m.params.structuredContent);
    else if(m.method==='ui/notifications/host-context-changed')context(m.params);
  });
  rpc('ui/initialize',{appInfo:{name:'open-artifact',version:VERSION},appCapabilities:{availableDisplayModes:['inline','fullscreen']},protocolVersion:'${APP_PROTOCOL}'})
    .then(function(r){context(r&&r.hostContext);notify('ui/notifications/initialized');size();},function(){});
  $('full').onclick=function(){
    rpc('ui/request-display-mode',{mode:mode==='fullscreen'?'inline':'fullscreen'}).then(function(r){if(r&&r.mode)setMode(r.mode);},function(){});
  };
  $('open').onclick=function(){if(data&&data.view_url)rpc('ui/open-link',{url:data.view_url}).catch(function(){});};
  $('send').onclick=function(){
    if(!data)return;
    var text='[Artifact comments sent to agent] Read the comments and requests on the artifact "'+(data.title||data.url)+'" ('+data.url+') with ArtifactComments {action: "read", url: "'+data.url+'"}, handle them, and reply to each.';
    var b=$('send');b.disabled=true;b.textContent='Sent';
    rpc('ui/message',{role:'user',content:[{type:'text',text:text}]}).catch(function(){});
    setTimeout(function(){b.disabled=false;b.textContent='Send comments';},4000);
  };
  window.addEventListener('resize',size);
})();
</script></body></html>`;
