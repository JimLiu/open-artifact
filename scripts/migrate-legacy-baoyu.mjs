#!/usr/bin/env node
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const types = {
  slides: { paths: ['project', '_blobs', 'comments.json', 'history'], marker: 'project/deck.json' },
  design: { paths: ['project', '_blobs', 'comments.json', 'history'], marker: 'project/canvas.json' },
  'design-system': { paths: ['project', '_blobs', 'comments.json', 'history'], marker: 'project/design-system.json' },
  data: { paths: ['db', 'src', '_blobs', 'comments.json', 'history'], marker: 'db/dash/meta.json' },
  whiteboard: { paths: ['db', '_blobs', 'comments.json', 'history'], marker: 'db/board/meta.json' },
  docs: { paths: ['doc', 'doc.json', 'tabs', '.sessions.json', '_blobs', 'comments.json', 'history'], marker: 'doc/doc.json' },
  sheets: { paths: ['sheet', 'sheet.json', 'edits.jsonl', 'widgets', '_blobs', 'comments.json', 'history'], marker: 'sheet/sheet.json' },
};
const omitted = new Set(['.artifact.json', '.sharing.json', '.artifact-server.json', '.artifact-server.log', '.git', 'node_modules', 'exports']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (parent, child) => { const rel = relative(parent, child); return !rel || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };

function canonical(path) {
  const full = resolve(path);
  if (existsSync(full)) {
    const actual = realpathSync(full);
    if (actual !== full || lstatSync(full).isSymbolicLink()) throw new Error(`Symlink paths are refused: ${full}`);
    return full;
  }
  const parent = dirname(full);
  if (parent === full) throw new Error(`Cannot resolve path: ${full}`);
  return join(canonical(parent), basename(full));
}

function limitations(type) {
  if (type === 'docs') return ['Docs files are structurally relocated into doc/. Rich-text schema, history and editing compatibility require validation before adoption.'];
  if (type === 'sheets') return ['Sheets files are structurally relocated into sheet/. Workbook schema, widgets, formulas and editing compatibility require validation before adoption.'];
  if (type === 'data') return ['Data db/src files are copied unchanged. Connector credentials, live queries and browser rendering are not migrated or verified.'];
  if (type === 'whiteboard') return ['Whiteboard db files are copied unchanged; schema and editor compatibility require validation.'];
  return ['File conversion only; render, edit and asset-reference validation are required before adoption.'];
}

/** Copies into new folders only; no daemon, catalog or sharing-state writes. */
export function migrate({ catalog, out, apply = false }) {
  if (typeof catalog !== 'string' || typeof out !== 'string' || !catalog.trim() || !out.trim()) throw new Error('--catalog and --out are required');
  catalog = canonical(catalog);
  out = canonical(out);
  if (!lstatSync(catalog).isDirectory()) throw new Error('Catalog must be a directory');
  if (within(catalog, out) || within(out, catalog)) throw new Error('Catalog and output must not overlap');
  if (existsSync(out) && !lstatSync(out).isDirectory()) throw new Error('Output must be a directory');
  const manifestFile = join(out, 'migration-manifest.json');
  if (existsSync(manifestFile)) throw new Error(`Destination collision: ${manifestFile}`);
  const entries = [];
  const plans = [];
  const roots = new Set();
  for (const name of readdirSync(catalog).sort()) {
    if (!name.endsWith('.json')) continue;
    const recordPath = canonical(join(catalog, name));
    if (!lstatSync(recordPath).isFile()) throw new Error(`Catalog record is not a regular file: ${recordPath}`);
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (!record || record.v !== 1 || typeof record.root !== 'string' || !isAbsolute(record.root) || typeof record.skill !== 'string' || !/^claude-[a-z-]+$/.test(record.skill)) throw new Error(`Invalid legacy record: ${recordPath}`);
    const originalRoot = canonical(record.root);
    if (!lstatSync(originalRoot).isDirectory() || originalRoot === dirname(originalRoot)) throw new Error(`Unsafe artifact root: ${originalRoot}`);
    if (within(originalRoot, out) || within(out, originalRoot) || within(originalRoot, catalog)) throw new Error(`Artifact/output/catalog overlap: ${originalRoot}`);
    if (roots.has(originalRoot)) throw new Error(`Duplicate legacy root: ${originalRoot}`);
    roots.add(originalRoot);
    const type = record.skill.slice('claude-'.length).replace(/^dashboard$/, 'data');
    const entry = { originalRoot, type_url: `open-artifact://type/${type}`, title: typeof record.title === 'string' ? record.title : basename(originalRoot), legacy: { recordPath, record }, status: 'unsupported', root: null };
    entries.push(entry);
    if (type === 'motion' || !types[type]) {
      entry.reason = type === 'motion' ? 'Motion has no supported new type/editor. Original left intact; no copy or adoption attempted.' : `Unsupported legacy type: ${type}`;
      continue;
    }
    const slug = basename(originalRoot).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 48) || 'artifact';
    const destination = join(out, `${slug}-${digest(originalRoot).slice(0, 12)}`);
    if (existsSync(destination)) throw new Error(`Destination collision: ${destination}`);
    const files = new Map();
    const add = (source, target) => {
      if (!target || isAbsolute(target) || !within(destination, resolve(destination, target))) throw new Error(`Unsafe destination path: ${target}`);
      const before = files.get(target);
      if (before && !readFileSync(before).equals(readFileSync(source))) throw new Error(`Conflicting files for ${destination}/${target}`);
      files.set(target, source);
    };
    const walk = (source, target) => {
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks are refused: ${source}`);
      if (stat.isDirectory()) {
        for (const child of readdirSync(source).sort()) {
          if (!omitted.has(child) && !child.endsWith('.tmp')) walk(join(source, child), join(target, child));
        }
      } else if (stat.isFile()) add(source, target);
      else throw new Error(`Special files are refused: ${source}`);
    };
    for (const path of types[type].paths) {
      const source = join(originalRoot, path);
      if (!existsSync(source)) continue;
      let target = path;
      if (type === 'docs' && ['doc.json', 'tabs', '.sessions.json', 'history'].includes(path)) target = join('doc', path);
      if (type === 'sheets' && ['sheet.json', 'edits.jsonl', 'widgets'].includes(path)) target = join('sheet', path);
      walk(source, target);
    }
    // Keep content bytes, not old server keys. Move blob files to the new root namespace.
    for (const old of ['project/assets', 'project/_blobs']) {
      for (const [path, source] of [...files]) {
        if (path.startsWith(`${old}/`)) {
          add(source, join('_blobs', path.slice(old.length + 1)));
          files.delete(path);
        }
      }
    }
    if (!files.has(types[type].marker)) throw new Error(`Missing type marker ${types[type].marker}: ${originalRoot}`);
    entry.root = destination;
    entry.status = apply ? 'copied' : 'planned';
    entry.limitations = limitations(type);
    entry.files = files.size;
    plans.push({ destination, files });
  }
  const report = { v: 1, mode: apply ? 'apply' : 'preview', catalog, out, entries, notes: ['Original content and legacy keys are never changed.', 'No .artifact.json is created. Adopt copied roots explicitly using root, type_url and title after validation.', 'Old capability URLs do not migrate; re-share after adoption.'] };
  if (apply) {
    mkdirSync(out, { recursive: true });
    for (const { destination, files } of plans) {
      mkdirSync(destination);
      for (const [path, source] of files) {
        const target = join(destination, path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target, constants.COPYFILE_EXCL);
      }
    }
    writeFileSync(manifestFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--apply') options.apply = true;
      else if (['--catalog', '--out'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
      else throw new Error('Usage: node scripts/migrate-legacy-baoyu.mjs --catalog DSH_HOME/baoyu-design/artifacts --out NEW_DIR [--apply]');
    }
    console.log(JSON.stringify(migrate(options), null, 2));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
