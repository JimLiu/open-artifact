#!/usr/bin/env node
// Builds the playground's seed manifests: for every `demos/<id>.demo.json`, walks its `source` artifact folder (the
// files git tracks there: the artifact, not this machine's `_agent/`, `history/` or `.artifact*` state) and writes
// `src/seeds/generated/<id>.json` = the demo definition plus `files: {path: {text} | {base64}}`.
//
//   node website/playground/scripts/make-seeds.mjs [id…]   # every demo, or the ones named
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND = path.dirname(HERE);
const REPO = path.resolve(PLAYGROUND, '..', '..');
const DEMOS = path.join(PLAYGROUND, 'demos');
const OUT = path.join(PLAYGROUND, 'src', 'seeds', 'generated');

/** Machine state an artifact folder may hold that is not the artifact (mirrors the folders' own .gitignore). */
const NOT_ARTIFACT = /^(?:_agent\/|history\/|\.artifact|\.sharing\.json$|\.gitignore$|.*\.(?:log|tmp)$|.*\.DS_Store$)/;
const TEXT = /\.(?:json|html?|css|md|txt|svg|js|mjs|csv|tsv|xml|ya?ml)$/i;

/** Artifact-relative paths of the folder's files: the ones git tracks or would (not what it ignores), else a walk. */
function filesOf(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], { cwd: root, encoding: 'utf8' });
    const listed = out.split('\0').filter(Boolean);
    if (listed.length) return listed.filter((rel) => !NOT_ARTIFACT.test(rel)).sort();
  } catch {
    // Not a git checkout: walk the folder instead.
  }
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${rel}/`);
      else if (!NOT_ARTIFACT.test(rel)) found.push(rel);
    }
  };
  walk(root, '');
  return found.sort();
}

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const name of fs.readdirSync(DEMOS).filter((f) => f.endsWith('.demo.json') && (!only.length || only.includes(f.replace(/\.demo\.json$/, '')))).sort()) {
  const demo = JSON.parse(fs.readFileSync(path.join(DEMOS, name), 'utf8'));
  const root = path.join(REPO, demo.source);
  if (!fs.existsSync(root)) throw new Error(`${name}: no folder ${demo.source}`);
  const files = {};
  let bytes = 0;
  // `omit`: files the demo leaves out (and, for whiteboard elements, out of the board's order too).
  const omit = new Set(demo.omit ?? []);
  // `prefix`: where the folder's files go in the artifact (a page's own folder is its `project/`).
  const prefix = demo.prefix ?? '';
  for (const rel of filesOf(root)) {
    if (omit.has(rel)) continue;
    const data = fs.readFileSync(path.join(root, rel));
    bytes += data.length;
    files[prefix + rel] = TEXT.test(rel) ? { text: data.toString('utf8') } : { base64: data.toString('base64') };
  }
  // `add`: files the demo puts in or replaces (a string is the file's text; anything else is written as JSON).
  for (const [rel, value] of Object.entries(demo.add ?? {})) {
    const text = typeof value === 'string' ? value : `${JSON.stringify(value)}\n`;
    bytes += Buffer.byteLength(text);
    files[rel] = { text };
  }
  const meta = files['db/board/meta.json'];
  if (meta && 'text' in meta && omit.size) {
    const gone = new Set([...omit].map((rel) => /^db\/elements\/(.+)\.json$/.exec(rel)?.[1]).filter(Boolean));
    const board = JSON.parse(meta.text);
    if (Array.isArray(board.order)) board.order = board.order.filter((id) => !gone.has(id));
    meta.text = `${JSON.stringify(board, null, 2)}\n`;
  }
  const { omit: _omit, add: _add, prefix: _prefix, ...manifest } = demo;
  const out = path.join(OUT, `${demo.id}.json`);
  fs.writeFileSync(out, `${JSON.stringify({ ...manifest, files })}\n`);
  console.log(`${path.relative(REPO, out)}: ${Object.keys(files).length} files, ${(bytes / 1024).toFixed(1)} KB from ${demo.source}`);
}
