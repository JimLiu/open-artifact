/**
 * The Motion type on the type server: detection by its marker, the scaffold,
 * the check (code parsed as the player runs it) and the writes it refuses.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { detectType, main } from '../src/index.ts';
import { TYPES } from '../src/types.ts';
import { motionHistoryIgnores, motionSyntaxError, motionUploadNext, motionUploadProblem } from '../src/motion.ts';

const none = (): unknown => undefined;

describe('motion type', () => {
  it('scaffolds the marker and is detected by it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oa-motion-'));
    try {
      const files = TYPES.motion.scaffold('Fox', join(root, 'db'));
      assert.deepEqual(Object.keys(files), ['film/meta.json']);
      await mkdir(join(root, 'db', 'film'), { recursive: true });
      await writeFile(join(root, 'db', 'film', 'meta.json'), files['film/meta.json']!);
      assert.equal(await detectType(root), 'motion');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parses code as the player runs it, with the line of the error', () => {
    assert.equal(motionSyntaxError('window.CUT = kit.scenes();', 'cut.js'), null);
    assert.equal(motionSyntaxError('const kit = 1;', 'cut.js')?.message.includes('kit'), true);
    assert.equal(motionSyntaxError('let a = 1;\nlet b = (;', 'cut.js')?.line, 2);
    // A classic script, as the player runs it (no `node:vm`: the same on a host without it).
    assert.equal(motionSyntaxError('(;', 'cut.js')?.line, 1);
    assert.notEqual(motionSyntaxError('await thing;', 'cut.js'), null);
    assert.notEqual(motionSyntaxError('return 1;', 'cut.js'), null);
    assert.equal(motionSyntaxError('const f = async () => { await 1; };\nclass A { #x = 1 }\nlet y = a?.b ?? 2n;', 'cut.js'), null);
    assert.doesNotMatch(motionSyntaxError('let b = (;', 'cut.js')!.message, /\(\d+:\d+\)/);
    const findings = TYPES.motion.check(new Map([['film/script', JSON.stringify({ code: 'window.CUT = (' })]]));
    assert.ok(findings.some((finding) => finding.file === 'db/film/script.json' && /does not parse/.test(finding.message)));
  });

  it('refuses page-only records, also when the data comes from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oa-motion-writes-'));
    try {
      const file = join(dir, 'module.json');
      await writeFile(file, JSON.stringify({ kind: 'js' }));
      const refuse = TYPES.motion.writesProblem!;
      assert.equal(refuse([{ op: 'set', path: 'modules/retouched.json', data: { v: 1, layers: [] } }], none)?.code, 'READ_ONLY_PATH');
      assert.match(refuse([{ op: 'set', path: 'modules/a.js', file_path: file }], none)?.message ?? '', /modules\/a\.js needs/);
      assert.equal(refuse([{ op: 'set', path: 'modules/a.js', data: { kind: 'js', text: '' } }], none), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves people’s own documents out of the history', () => {
    assert.equal(motionHistoryIgnores('data/users/owner/x'), true);
    assert.equal(motionHistoryIgnores('modules/recut.json'), false);
  });
});

describe('motion uploads', () => {
  /** Runs the CLI, keeping what it printed. */
  async function run(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (line: unknown) => void out.push(String(line));
    console.error = (line: unknown) => void err.push(String(line));
    try {
      return { code: await main(argv), out, err };
    } finally {
      console.log = log;
      console.error = error;
    }
  }

  it('refuses a video over 20 MiB, and only a video', () => {
    assert.match(motionUploadProblem('long.mp4', 'video/mp4', 20 * 1024 * 1024 + 1) ?? '', /^FILE_TOO_LARGE: long\.mp4 is 20\.0 MB/);
    assert.equal(motionUploadProblem('clip.mp4', 'video/mp4', 20 * 1024 * 1024), null);
    assert.equal(motionUploadProblem('song.mp3', 'audio/mpeg', 30 * 1024 * 1024), null);
    assert.match(motionUploadNext('clip.mp4', 'video/mp4', '/_blob/abc') ?? '', /"ref": "\/_blob\/abc".*"note"/);
    assert.equal(motionUploadNext('logo.png', 'image/png', '/_blob/abc'), null);
  });

  it('says so from the CLI, and tells the agent to write a note after a video upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oa-motion-upload-'));
    try {
      const files = TYPES.motion.scaffold('Clip', join(root, 'db'));
      await mkdir(join(root, 'db', 'film'), { recursive: true });
      await writeFile(join(root, 'db', 'film', 'meta.json'), files['film/meta.json']!);
      await writeFile(join(root, 'big.mp4'), Buffer.alloc(20 * 1024 * 1024 + 10));
      await writeFile(join(root, 'clip.mp4'), Buffer.from('not really a video'));
      const big = await run('upload', root, join(root, 'big.mp4'));
      assert.notEqual(big.code, 0);
      assert.ok([...big.out, ...big.err].some((line) => line.includes('FILE_TOO_LARGE')));
      const small = await run('upload', root, join(root, 'clip.mp4'));
      assert.equal(small.code, 0, small.err.join('\n'));
      assert.match(small.out[0] ?? '', /^\/_blob\/[0-9a-f]+\tvideo\/mp4\t\d+\tclip\.mp4$/);
      assert.equal(small.out.length, 1);
      assert.ok(small.err.some((line) => line.includes('"note"')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
