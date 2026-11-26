// Workspace confinement: a real daemon (`open-artifact daemon run`, from source) started with
// OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1, as a sandboxed host (Cindy) runs it: every folder an agent makes, reads or
// writes, and every file an action names, stays in that session's workspace. The built-in types (docs, whiteboard)
// run from the built tree; `note` is a static user type, so the daemon serves its folder itself.
//
//  (a) A folder outside the workspace (absolute, or `..`) and a session with no workspace are refused; nothing is made.
//  (b) A link in an artifact folder that leads out: a publish through it writes nothing outside, a read through it
//      returns nothing from outside, and the static page's `/_root/` does not serve it.
//  (c) Action arguments: a path outside the workspace (upload's `file`, docs `import`'s `file` and `export`'s `out`)
//      never reaches the type's server; the same calls with files in the workspace work.
//  (d) ArtifactData: `file_path` and `out_file` outside the workspace are refused; a stale `if_match` answers
//      `conflict` with `executionStatus: "not_executed"`, and nothing changed.
//  (e) Listing: an artifact made at the workspace's top (`folder: "."`) is listed for another session there; a
//      session in another workspace sees it under neither `mine` nor `all`.
//  (f) A workspace replaced by another folder at the same path (moved away, a new one made): its artifacts are
//      refused (`not_granted`), and neither their pages nor their zips are served.
//
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { api, readDaemon } from '@open-artifact/harness-kit';
import { until } from './lib/http.mjs';
import { repoRoot, target, tmpDir } from './lib/target.mjs';

const T = { timeout: 120000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const SECRET = 'TOP SECRET: not for the sandbox';

const missing = ['docs', 'whiteboard'].filter(type => !fs.existsSync(path.join(target, type, 'scripts', 'cli.mjs')));
const skip = missing.length ? `not built (npm run build): ${missing.join(', ')}` : false;

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** GET `pathname` on the daemon's port with `Host: host` (a static entry's origin): the status and the body. */
function getAs(port, host, pathname) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathname, headers: { host } }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('workspace confinement: a daemon run with OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1', { skip }, () => {
  const ctx = {};
  /** A tool call as `who` (the workspace's own session by default). */
  const tool = (name, args, who = ctx.caller) => api(ctx.state, 'tools.call', { name, arguments: args, caller: who });
  const idOf = url => String(url).split('/').at(-1);

  before(async () => {
    const root = tmpDir('workspace-confinement');
    ctx.home = path.join(root, 'home');
    ctx.workspace = path.join(root, 'work');
    ctx.outside = path.join(root, 'outside');
    ctx.otherWorkspace = path.join(root, 'other-work');
    const types = path.join(root, 'types');
    for (const dir of [ctx.workspace, ctx.outside, ctx.otherWorkspace, types]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(ctx.outside, 'secret.txt'), SECRET);
    fs.writeFileSync(path.join(ctx.outside, 'notes.md'), `# Outside\n\n${SECRET}\n`);
    fs.writeFileSync(path.join(ctx.outside, 'doc.json'), JSON.stringify({ secret: SECRET }));
    const note = path.join(types, 'note');
    fs.mkdirSync(note);
    fs.writeFileSync(path.join(note, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    fs.writeFileSync(path.join(note, 'index.html'), '<!doctype html><meta charset="utf-8"><title>note</title><h1>A note</h1>\n');

    ctx.port = await freePort();
    const env = {
      ...process.env,
      HOME: path.join(root, 'user-home'),
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: types,
      OPEN_ARTIFACT_BUILTIN_TYPES: target,
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(root, 'type-servers'),
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY: '1',
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION']) delete env[name];
    fs.mkdirSync(env.HOME);
    ctx.log = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(ctx.port)], { env, cwd: ctx.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stop = () => ctx.daemon.exitCode === null && ctx.daemon.kill('SIGKILL');
    process.on('exit', ctx.stop);
    assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.log}`);
    ctx.state = await readDaemon(ctx.home);
    ctx.caller = { harness: 'e2e', session: 'confined-1', workspace: ctx.workspace };
    ctx.peer = { harness: 'e2e', session: 'confined-2', workspace: ctx.workspace };
    ctx.stranger = { harness: 'e2e', session: 'elsewhere-1', workspace: ctx.otherWorkspace };

    /** Makes an artifact of `type` in the workspace; `folder` as given. */
    ctx.make = async (type, title, extra = {}, who = ctx.caller) => {
      const made = await tool('Artifact', { action: 'publish', type_url: `open-artifact://type/${type}`, title, open: 'never', ...extra }, who);
      assert.equal(made.error, undefined, JSON.stringify(made.error));
      return made;
    };
  });

  after(async () => {
    if (ctx.daemon?.exitCode === null) {
      const exited = new Promise(resolve => ctx.daemon.once('exit', resolve));
      ctx.daemon.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    ctx.stop?.();
  });

  it('(a) refuses a folder outside the workspace and a session without one, and makes nothing', T, async () => {
    const make = (folder, who = ctx.caller) => tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/note', title: 'Escape', folder, open: 'never' }, who);
    assert.equal((await make(path.join(ctx.outside, 'made'))).error?.code, 'not_granted');
    assert.equal((await make(path.join('..', 'outside', 'made-too'))).error?.code, 'not_granted');
    assert.equal((await make('inside', { ...ctx.caller, workspace: null })).error?.code, 'not_granted');
    assert.deepEqual(fs.readdirSync(ctx.outside).sort(), ['doc.json', 'notes.md', 'secret.txt']);
    // In the workspace it works, and the record is bound to the workspace's real folder.
    const made = await ctx.make('note', 'Inside', { folder: 'inside' });
    assert.equal(made.root, path.join(ctx.workspace, 'inside'));
  });

  it('(b) a link in the artifact folder that leads out: no write through it, no read, no page', T, async () => {
    const made = await ctx.make('note', 'Linked note', { folder: 'linked' });
    ctx.note = made;
    const written = await tool('Artifact', { action: 'publish', url: made.url, files: { 'index.html': '<!doctype html><h1>Mine</h1>' } });
    assert.equal(written.error, undefined, JSON.stringify(written.error));
    fs.symlinkSync(ctx.outside, path.join(made.root, 'leak'));
    fs.symlinkSync(path.join(ctx.outside, 'secret.txt'), path.join(made.root, 'secret.txt'));

    const through = await tool('Artifact', { action: 'publish', url: made.url, files: { 'leak/planted.txt': 'planted' } });
    assert.ok(through.error, 'a write through the link is refused');
    assert.equal(fs.existsSync(path.join(ctx.outside, 'planted.txt')), false);
    const over = await tool('Artifact', { action: 'publish', url: made.url, files: { 'secret.txt': 'overwritten' } });
    assert.ok(over.error || fs.readFileSync(path.join(ctx.outside, 'secret.txt'), 'utf8') === SECRET, 'the file outside is never overwritten');
    assert.equal(fs.readFileSync(path.join(ctx.outside, 'secret.txt'), 'utf8'), SECRET);

    const read = await tool('Artifact', { action: 'read', url: made.url, paths: ['secret.txt', 'leak/notes.md', 'index.html'] });
    assert.ok(!JSON.stringify(read).includes(SECRET), `a read through a link returns nothing from outside: ${JSON.stringify(read).slice(0, 400)}`);
    assert.match(String(read.files.find(f => f.path === 'index.html')?.content), /Mine/);

    const host = `${idOf(made.url)}.frame.localhost:${ctx.port}`;
    const page = await getAs(ctx.port, host, '/_root/index.html');
    assert.equal(page.status, 200);
    assert.match(page.body, /Mine/);
    for (const rel of ['/_root/secret.txt', '/_root/leak/secret.txt']) {
      const leaked = await getAs(ctx.port, host, rel);
      assert.equal(leaked.status, 404, rel);
      assert.ok(!leaked.body.includes(SECRET), rel);
    }
  });

  it('(c) an action takes files in the workspace only: upload, docs import and export', T, async () => {
    const board = await ctx.make('whiteboard', 'Board', { folder: 'board' });
    ctx.board = board;
    const call = (url, name, args) => tool('Artifact', { action: 'call', url, name, args });

    const upload = await call(board.url, 'upload', { file: path.join(ctx.outside, 'secret.txt') });
    assert.equal(upload.error?.code, 'not_granted', JSON.stringify(upload));
    assert.match(String(upload.error?.message), /outside this session's workspace/);
    fs.writeFileSync(path.join(ctx.workspace, 'picture.txt'), 'a file of the workspace');
    const ok = await call(board.url, 'upload', { file: path.join(ctx.workspace, 'picture.txt') });
    assert.equal(ok.error, undefined, JSON.stringify(ok.error));

    const doc = await ctx.make('docs', 'Doc', { folder: 'doc' });
    const imported = await call(doc.url, 'import', { file: path.join(ctx.outside, 'notes.md') });
    assert.equal(imported.error?.code, 'not_granted', JSON.stringify(imported));
    assert.equal(((await call(doc.url, 'import', { file: `file://${path.join(ctx.outside, 'notes.md')}` })).error?.code), 'not_granted');
    fs.writeFileSync(path.join(ctx.workspace, 'plan.md'), '# Plan\n\nInside the workspace.\n');
    const fine = await call(doc.url, 'import', { file: path.join(ctx.workspace, 'plan.md') });
    assert.equal(fine.error, undefined, JSON.stringify(fine.error));

    const out = path.join(ctx.outside, 'export.md');
    const exported = await call(doc.url, 'export', { format: 'markdown', out });
    assert.equal(exported.error?.code, 'not_granted', JSON.stringify(exported));
    assert.equal(fs.existsSync(out), false);
    // A link in the workspace to the outside folder is outside too.
    fs.symlinkSync(ctx.outside, path.join(ctx.workspace, 'exports-link'));
    const linked = await call(doc.url, 'export', { format: 'markdown', out: path.join(ctx.workspace, 'exports-link', 'linked.md') });
    assert.equal(linked.error?.code, 'not_granted', JSON.stringify(linked));
    assert.equal(fs.existsSync(path.join(ctx.outside, 'linked.md')), false);
    const kept = await call(doc.url, 'export', { format: 'markdown', out: path.join(ctx.workspace, 'exports', 'doc.md') });
    assert.equal(kept.error, undefined, JSON.stringify(kept.error));
    assert.match(fs.readFileSync(path.join(ctx.workspace, 'exports', 'doc.md'), 'utf8'), /Inside the workspace/);
  });

  it('(d) ArtifactData: file_path and out_file stay in the workspace; a stale if_match is not executed', T, async () => {
    const url = ctx.board.url;
    const note = { type: 'note', x: 0, y: 0, text: 'Hello', color: 'yellow' };
    const set = await tool('ArtifactData', { action: 'set', url, path: 'elements/n1', data: note });
    assert.equal(set.error, undefined, JSON.stringify(set.error));
    const got = await tool('ArtifactData', { action: 'get', url, path: 'elements/n1' });
    assert.equal(typeof got.sha256, 'string');

    const stale = await tool('ArtifactData', { action: 'set', url, path: 'elements/n1', data: { ...note, text: 'Changed' }, if_match: 'b'.repeat(64) });
    assert.equal(stale.error?.code, 'conflict', JSON.stringify(stale));
    assert.equal(stale.executionStatus, 'not_executed');
    assert.equal((await tool('ArtifactData', { action: 'get', url, path: 'elements/n1' })).data.text, 'Hello');

    const imported = await tool('ArtifactData', { action: 'batch', url, writes: [{ op: 'set', path: 'elements/n2', file_path: path.join(ctx.outside, 'doc.json') }] });
    assert.equal(imported.error?.code, 'not_granted', JSON.stringify(imported));
    assert.equal((await tool('ArtifactData', { action: 'get', url, path: 'elements/n2' })).exists, false);

    const away = await tool('ArtifactData', { action: 'get', url, path: 'elements/n1', out_file: path.join(ctx.outside, 'dump.json') });
    assert.equal(away.error?.code, 'not_granted', JSON.stringify(away));
    assert.equal((await tool('ArtifactData', { action: 'get', url, path: 'elements/n1', out_file: '../outside/dump.json' })).error?.code, 'not_granted');
    assert.equal(fs.existsSync(path.join(ctx.outside, 'dump.json')), false);
    const saved = await tool('ArtifactData', { action: 'get', url, path: 'elements/n1', out_file: 'out/n1.json' });
    assert.equal(saved.out_file, path.join(ctx.workspace, 'out', 'n1.json'));
    assert.equal(JSON.parse(fs.readFileSync(saved.out_file, 'utf8')).data.text, 'Hello');
  });

  it('(e) an artifact at the workspace top is listed for the workspace, and never for another one', T, async () => {
    const top = await ctx.make('note', 'Workspace top note', { folder: '.' });
    assert.equal(top.root, ctx.workspace);
    const listed = await tool('Artifact', { action: 'list', query: 'workspace top' }, ctx.peer);
    assert.deepEqual(listed.artifacts.map(a => a.url), [top.url], 'another session in the same workspace sees it');
    for (const scope of ['mine', 'all']) {
      const elsewhere = await tool('Artifact', { action: 'list', scope }, ctx.stranger);
      assert.deepEqual(elsewhere.artifacts, [], `a session in another workspace sees nothing of this one (scope ${scope})`);
    }
  });

  it('(f) a replaced workspace: its artifacts are refused and not served', T, async () => {
    const note = ctx.note;
    const host = `${idOf(note.url)}.frame.localhost:${ctx.port}`;
    assert.equal((await getAs(ctx.port, host, '/_root/index.html')).status, 200);
    fs.renameSync(ctx.workspace, `${ctx.workspace}-moved`);
    fs.mkdirSync(path.join(ctx.workspace, 'linked'), { recursive: true });
    fs.writeFileSync(path.join(ctx.workspace, 'linked', 'index.html'), '<!doctype html><h1>Planted</h1>');

    const read = await tool('Artifact', { action: 'read', url: note.url, path: 'index.html' });
    assert.equal(read.error?.code, 'not_granted', JSON.stringify(read));
    const write = await tool('Artifact', { action: 'publish', url: note.url, files: { 'index.html': 'x' } });
    assert.equal(write.error?.code, 'not_granted', JSON.stringify(write));
    assert.equal(fs.readFileSync(path.join(ctx.workspace, 'linked', 'index.html'), 'utf8'), '<!doctype html><h1>Planted</h1>');
    const page = await getAs(ctx.port, host, '/_root/index.html');
    assert.equal(page.status, 404);
    assert.ok(!page.body.includes('Planted'));
    const zip = await fetch(`${ctx.state.url}/api/open-artifact.artifact.archive?id=${idOf(note.url)}`, { headers: { Authorization: `Bearer ${ctx.state.token}` } });
    assert.notEqual(zip.status, 200, 'the zip of a replaced folder is refused');
    const board = await tool('Artifact', { action: 'call', url: ctx.board.url, name: 'check', args: {} });
    assert.equal(board.error?.code, 'not_granted', JSON.stringify(board));
  });
});
