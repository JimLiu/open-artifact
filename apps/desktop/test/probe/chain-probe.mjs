/**
 * The no-Node chain, run by Electron's own executable as Node (ELECTRON_RUN_AS_NODE=1), with no `node` on PATH:
 * start the daemon detached the way the app does (the kit's `ensureDaemon`, the runtime the app carries), make a blank
 * artifact of each type with the Library API, open its page so the type server starts, and fetch the Shell, the
 * editor's page and one of its scripts. Prints one JSON line; `test/no-node.test.mjs` runs it and checks it.
 *
 *   ELECTRON_RUN_AS_NODE=1 <Electron> out/test/chain-probe.mjs <runtime dir> <folder for artifacts> <types…>
 */
import http from 'node:http';
import { join } from 'node:path';
import { api, ensureDaemon, runtimeInfo } from '@open-artifact/harness-kit';

const [runtimeDir, folderRoot, ...types] = process.argv.slice(2);
const report = {
  node: process.version,
  electron: process.versions.electron ?? null,
  execPath: process.execPath,
  processType: process.type ?? null,
  types: {},
};

/**
 * GET over loopback. A `*.localhost` name (a frame origin) is sent to 127.0.0.1 with its Host header, as a browser
 * does: Node's resolver does not always answer for those names, which is not what is being checked here.
 */
function get(address) {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: url.port, path: url.pathname + url.search, method: 'GET', headers: { Host: url.host } },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'] ?? '', body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    request.on('error', reject);
    request.setTimeout(30_000, () => request.destroy(new Error(`GET ${address}: timed out`)));
    request.end();
  });
}

try {
  const info = runtimeInfo(runtimeDir);
  if (!info?.version) throw new Error(`no runtime in ${runtimeDir}`);
  report.runtime = { dir: runtimeDir, version: info.version };
  const state = await ensureDaemon({ own: { dir: runtimeDir, version: info.version }, env: process.env, timeoutMs: 60_000 });
  report.daemon = { pid: state.pid, url: state.url, version: state.version };
  if (new URL(state.url).port === '4800') throw new Error(`the daemon listens on 4800 (${state.url}): refusing to go on`);
  // How the daemon runs Node scripts (its type servers), as it says itself.
  report.health = JSON.parse((await get(`${state.url}/__open-artifact/health`)).body);

  for (const type of types) {
    const entry = (report.types[type] = { ok: false });
    try {
      const made = await api(state, 'artifacts.create', { type, title: `No-Node ${type}`, blank: true, folder: join(folderRoot, type) });
      if (!made?.id) throw new Error(`artifacts.create: ${JSON.stringify(made)}`);
      entry.id = made.id;
      entry.root = made.root ?? null;
      const opened = await api(state, 'artifacts.open', { id: made.id, host: false });
      if (!opened?.page_url) throw new Error(`artifacts.open: ${JSON.stringify(opened)}`);
      entry.pageUrl = opened.page_url;
      const shell = await get(`${state.url}/a/${encodeURIComponent(made.id)}`);
      entry.shell = { status: shell.status, type: shell.type, html: /<html/i.test(shell.body) };
      const page = await get(opened.page_url);
      // The editor's page loads its own bundle (<script type="module" src="…/assets/index-….js">).
      const script = /<script[^>]*\ssrc="([^"]*assets\/[^"]+\.js)"/.exec(page.body)?.[1] ?? null;
      entry.page = { status: page.status, type: page.type, html: /<html/i.test(page.body), script };
      if (script) {
        const asset = await get(new URL(script, opened.page_url).href);
        entry.script = { status: asset.status, type: asset.type, bytes: asset.body.length };
      }
      entry.ok =
        shell.status === 200 && entry.shell.html && page.status === 200 && entry.page.html && !!script && entry.script?.status === 200 && /javascript/.test(entry.script.type);
    } catch (error) {
      entry.error = error?.stack ?? String(error);
    }
  }
  report.ok = types.length > 0 && types.every((type) => report.types[type].ok);
} catch (error) {
  report.ok = false;
  report.error = error?.stack ?? String(error);
}
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.ok ? 0 : 1);
