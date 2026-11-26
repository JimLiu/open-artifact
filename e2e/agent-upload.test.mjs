// An agent puts a picture on a whiteboard through the daemon's tools, the way the board's skill tells it to: a real
// daemon (`open-artifact daemon run`, from source) runs the built whiteboard, and every step is a tool call.
//
//  (a) `publish` with `file_path` and `asset` (no `files`) is refused with `invalid_argument`: the `fix` names the
//      `upload` call, and nothing lands in the board's folder.
//  (b) `call upload` with the picture's absolute path stores it under `_blobs/` byte for byte and returns its
//      `/_blob/<id>` url; an `image` element with that `src` passes `check`, and reading the board gives the same `src`.
//
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { api, readDaemon } from '@open-artifact/harness-kit';
import { until } from './lib/http.mjs';
import { repoRoot, target, tmpDir } from './lib/target.mjs';

const T = { timeout: 120000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const skip = fs.existsSync(path.join(target, 'whiteboard', 'scripts', 'cli.mjs')) ? false : 'not built (npm run build): whiteboard';

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

/** A real PNG: `w`×`h` pixels of one colour. */
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buf => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

describe('an agent uploads a picture to a whiteboard through the daemon', { skip }, () => {
  const ctx = {};
  const tool = (name, args) => api(ctx.state, 'tools.call', { name, arguments: args, caller: ctx.caller });

  before(async () => {
    const root = tmpDir('agent-upload');
    ctx.home = path.join(root, 'home');
    ctx.workspace = path.join(root, 'work');
    fs.mkdirSync(ctx.workspace, { recursive: true });
    ctx.picture = path.join(ctx.workspace, 'hero.png');
    fs.writeFileSync(ctx.picture, png(4, 3, [230, 90, 40]));

    ctx.port = await freePort();
    const env = {
      ...process.env,
      HOME: path.join(root, 'user-home'),
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_BUILTIN_TYPES: target,
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(root, 'type-servers'),
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
    };
    for (const name of ['OPEN_ARTIFACT_USER_TYPES', 'OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY']) delete env[name];
    fs.mkdirSync(env.HOME);
    ctx.log = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(ctx.port)], { env, cwd: ctx.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stop = () => ctx.daemon.exitCode === null && ctx.daemon.kill('SIGKILL');
    process.on('exit', ctx.stop);
    assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.log}`);
    ctx.state = await readDaemon(ctx.home);
    ctx.caller = { harness: 'e2e', session: 'upload-1', workspace: ctx.workspace };

    const board = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Picture board', folder: 'board', open: 'never' });
    assert.equal(board.error, undefined, JSON.stringify(board.error));
    ctx.board = board;
    const meta = await tool('ArtifactData', { action: 'update', url: board.url, path: 'board/meta', data: { title: 'Picture board' } });
    assert.equal(meta.error, undefined, JSON.stringify(meta.error));
  });

  after(async () => {
    if (ctx.daemon?.exitCode === null) {
      const exited = new Promise(resolve => ctx.daemon.once('exit', resolve));
      ctx.daemon.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    ctx.stop?.();
  });

  it('(a) publish with file_path and asset is refused, names the upload call and writes nothing', T, async () => {
    const before = fs.readdirSync(ctx.board.root).sort();
    const refused = await tool('Artifact', { action: 'publish', url: ctx.board.url, file_path: ctx.picture, asset: true });
    assert.equal(refused.error?.code, 'invalid_argument', JSON.stringify(refused));
    assert.match(String(refused.error?.fix), /Artifact \{action: "call", url, name: "upload", args: \{file: "<absolute path>"\}\}/);
    assert.deepEqual(fs.readdirSync(ctx.board.root).sort(), before);
    assert.equal(fs.existsSync(path.join(ctx.board.root, '_blobs')), false, 'no upload was stored');
  });

  it('(b) call upload stores the picture, and an image element shows it by the url it returned', T, async () => {
    const upload = await tool('Artifact', { action: 'call', url: ctx.board.url, name: 'upload', args: { file: ctx.picture } });
    assert.equal(upload.error, undefined, JSON.stringify(upload.error));
    const src = String(upload.upload?.url);
    const id = src.match(/^\/_blob\/([A-Za-z0-9_-]+)$/)?.[1];
    assert.ok(id, `an upload's url is /_blob/<id>: ${JSON.stringify(upload)}`);
    assert.deepEqual(fs.readFileSync(path.join(ctx.board.root, '_blobs', `${id}.png`)), fs.readFileSync(ctx.picture), 'the bytes are kept as sent');

    const wrote = await tool('ArtifactData', {
      action: 'batch',
      url: ctx.board.url,
      writes: [
        { op: 'set', path: 'elements/hero', data: { type: 'image', x: 0, y: 0, w: 320, h: 240, src } },
        { op: 'update', path: 'board/meta', data: { order: ['hero'] } },
      ],
    });
    assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
    const check = await tool('Artifact', { action: 'call', url: ctx.board.url, name: 'check' });
    assert.equal(check.error, undefined, JSON.stringify(check.error));
    assert.equal(check.check?.problems, 0, JSON.stringify(check));
    const read = await tool('ArtifactData', { action: 'get', url: ctx.board.url, path: 'elements/hero' });
    assert.equal(read.data?.src, src);
  });
});
