import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceDirectory } from '../src/workspace-files.ts';

test('a checked target resolves inside the authorized workspace and supports new files', () => {
  const base = mkdtempSync(join(tmpdir(), 'oa-workspace-policy-'));
  const work = join(base, 'task');
  mkdirSync(join(work, 'documents'), { recursive: true });
  symlinkSync(join(work, 'documents'), join(work, 'current'), 'junction');

  const canonical = realpathSync(work);
  const files = new WorkspaceDirectory(work);
  assert.equal(files.resolve('drafts/new.md'), join(canonical, 'drafts', 'new.md'));
  assert.equal(files.resolve('current/new.md'), join(canonical, 'documents', 'new.md'));
  assert.throws(() => files.resolve(join(base, 'another-task', 'draft.md')), { code: 'not_granted' });
});

test('a file operation stays bound to its authorized directory', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oa-workspace-identity-')));
  const work = join(base, 'task');
  mkdirSync(work);
  const files = new WorkspaceDirectory(work);
  renameSync(work, join(base, 'existing'));
  mkdirSync(work);
  assert.throws(() => files.resolve('draft.md'), { code: 'not_granted' });
});

test('replacing an entry preserves the meaning of an authorized in-workspace link', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'oa-workspace-entry-')));
  const target = join(work, 'original');
  const alias = join(work, 'alias');
  mkdirSync(target);
  symlinkSync(target, alias, 'junction');
  const files = new WorkspaceDirectory(work);
  assert.equal(files.resolve('alias'), target);
  assert.equal(files.resolve('alias', false), alias);
});

test('a workspace rebuilt from its identity takes a path spelled through a link to it, and still refuses one outside', () => {
  // The link stands in for macOS's /var -> /private/var: a daemon is told the spelled path, the identity holds the real one.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oa-workspace-spelled-')));
  const work = join(base, 'real', 'task');
  mkdirSync(join(work, 'deck'), { recursive: true });
  mkdirSync(join(base, 'real', 'other'));
  symlinkSync(join(base, 'real'), join(base, 'spelled'), 'junction');
  const spelled = join(base, 'spelled', 'task');
  const files = new WorkspaceDirectory(spelled);
  const rebuilt = new WorkspaceDirectory(files.identity.root, files.identity);
  assert.equal(rebuilt.resolve(join(spelled, 'deck')), join(work, 'deck'));
  assert.equal(rebuilt.resolve(join(spelled, 'deck', 'new', 'slide.md')), join(work, 'deck', 'new', 'slide.md'));
  assert.throws(() => rebuilt.resolve(join(base, 'spelled', 'other')), { code: 'not_granted' });
  assert.throws(() => rebuilt.resolve(join(base, 'spelled', 'missing', 'x')), { code: 'not_granted' });
});
