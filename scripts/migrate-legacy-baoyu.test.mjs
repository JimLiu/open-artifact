import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './migrate-legacy-baoyu.mjs';

const temp = mkdtempSync(join(tmpdir(), 'legacy-migration-'));
const catalog = join(temp, 'catalog');
mkdirSync(catalog);
const put = (root, path, value) => { const file = join(root, path); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, value); };
const rootFor = (name, skill, marker) => {
  const root = join(temp, name);
  put(root, marker, JSON.stringify({ title: name }));
  put(root, '.sharing.json', 'old secret keys');
  put(root, '.artifact-server.json', 'old state');
  put(catalog, `${name}.json`, JSON.stringify({ v: 1, root, skill, title: `Original ${name}`, sessionId: 'old-session' }));
  return root;
};
const snapshot = root => {
  const values = {};
  const walk = (dir, rel = '') => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(rel, name.name);
      if (name.isDirectory()) walk(join(dir, name.name), path);
      else values[path] = createHash('sha256').update(readFileSync(join(dir, name.name))).digest('hex');
    }
  };
  walk(root);
  return values;
};
try {
  const slides = rootFor('slides', 'claude-slides', 'project/deck.json');
  const design = rootFor('system', 'claude-design-system', 'project/design-system.json');
  const data = rootFor('data', 'claude-dashboard', 'db/dash/meta.json');
  const motion = rootFor('motion', 'claude-motion', 'db/film/meta.json');
  const docs = rootFor('docs', 'claude-docs', 'doc.json');
  const sheets = rootFor('sheets', 'claude-sheets', 'sheet.json');
  const bytes = Buffer.from([0, 255, 1, 129, 0]);
  put(slides, 'project/assets/image.png', bytes);
  put(design, 'project/_blobs/font.woff2', bytes);
  put(docs, 'tabs/a.json', '{"blocks":[]}');
  put(sheets, 'widgets/a.json', '{}');
  const before = snapshot(temp);
  const out = join(temp, 'copies');
  const preview = migrate({ catalog, out });
  assert.equal(preview.mode, 'preview');
  assert.equal(existsSync(out), false);
  assert.deepEqual(snapshot(temp), before);
  const result = migrate({ catalog, out, apply: true });
  assert.equal(result.entries.length, 6);
  assert.equal(result.entries.find(e => e.originalRoot === motion).status, 'unsupported');
  assert.equal(result.entries.find(e => e.originalRoot === motion).root, null);
  assert.match(result.entries.find(e => e.originalRoot === motion).reason, /no supported new type/);
  for (const original of [slides, design, data, motion, docs, sheets, catalog]) {
    const relative = original.slice(temp.length + 1);
    for (const [path, hash] of Object.entries(snapshot(original))) assert.equal(before[join(relative, path)], hash);
  }
  const copy = original => result.entries.find(e => e.originalRoot === original);
  assert.deepEqual(readFileSync(join(copy(slides).root, '_blobs/image.png')), bytes);
  assert.deepEqual(readFileSync(join(copy(design).root, '_blobs/font.woff2')), bytes);
  assert.equal(existsSync(join(copy(slides).root, 'project/assets/image.png')), false);
  for (const entry of result.entries.filter(e => e.root)) {
    assert.equal(existsSync(join(entry.root, '.sharing.json')), false);
    assert.equal(existsSync(join(entry.root, '.artifact-server.json')), false);
    assert.equal(existsSync(join(entry.root, '.artifact.json')), false);
    assert.equal(entry.legacy.record.sessionId, 'old-session');
    assert.ok(entry.limitations.length);
  }
  assert.equal(copy(data).type_url, 'open-artifact://type/data');
  assert.equal(copy(data).title, 'Original data');
  assert.ok(existsSync(join(copy(docs).root, 'doc/doc.json')));
  assert.ok(existsSync(join(copy(docs).root, 'doc/tabs/a.json')));
  assert.ok(existsSync(join(copy(sheets).root, 'sheet/sheet.json')));
  assert.ok(existsSync(join(copy(sheets).root, 'sheet/widgets/a.json')));
  assert.equal(JSON.parse(readFileSync(join(out, 'migration-manifest.json'))).entries.length, 6);
  assert.throws(() => migrate({ catalog, out, apply: true }), /collision/);
  assert.throws(() => migrate({ catalog, out: join(slides, 'copy') }), /overlap/);
  const collision = join(temp, 'collision');
  mkdirSync(join(collision, copy(slides).root.split('/').at(-1)), { recursive: true });
  assert.throws(() => migrate({ catalog, out: collision, apply: true }), /collision/);
  put(slides, 'project/assets/nested/a.png', bytes);
  symlinkSync(join(slides, 'project/deck.json'), join(slides, 'project/linked.json'));
  const rejected = join(temp, 'rejected');
  assert.throws(() => migrate({ catalog, out: rejected, apply: true }), /Symlinks/);
  assert.equal(existsSync(rejected), false, 'Preflight failure must not create output');
  console.log('PASS: preview has no writes; original hashes unchanged; blobs relocated byte-identically; unsupported Motion; docs/sheets paths; manifest; collisions and symlinks refused');
} finally {
  assert.ok(temp.startsWith(join(tmpdir(), 'legacy-migration-')));
  rmSync(temp, { recursive: true, force: true });
}
