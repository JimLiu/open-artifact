/**
 * Vendors the built-in types with one shared type server, for the bundles that carry the daemon (the skill, so the
 * plugins and @open-artifact/cli, and the DSH plugin):
 *
 *   vendor/type-server/                       the built server (scripts/build.mjs's dist/server/): cli.mjs, every
 *                                             editor, support.js, sheets.wasm, motion-tools.html, the PDF reader, the Shell
 *   vendor/artifact-types/<type>/             each type's own files (manifest, SKILL.md, references), without scripts/
 *   vendor/artifact-types/<type>/scripts/cli.mjs
 *                                             a few lines that run the shared server's CLI (not for a page type:
 *                                             frame-host, vendored beside the daemon, runs its artifacts)
 *
 * In the repository each type's scripts/ is a whole copy of dist/server/, so a type folder works on its own once
 * installed; every copy carries every editor, as one background server serves every type. Seven such copies made the
 * bundles over 300 MB, so here they share one. The server finds its editors and engines beside its own file
 * (import.meta.url), and starts its background server from that file, so the shared copy serves every type.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** Reads `BUILTIN_TYPE_IDS` from `packages/protocol/src/type-authoring.ts` as the single source of truth. */
export function readBuiltinTypeIds(repo) {
  const file = join(repo, 'packages', 'protocol', 'src', 'type-authoring.ts');
  const match = /BUILTIN_TYPE_IDS[^=]*=\s*(?:Object\.freeze\()?(\[[^\]]*\])/.exec(readFileSync(file, 'utf8'));
  if (!match) throw new Error(`Could not read BUILTIN_TYPE_IDS from ${relative(repo, file)}`);
  return JSON.parse(match[1].replace(/'/g, '"'));
}

/** Whether the type folder is a page type: its artifact-type.json says openArtifact.style "page". */
export function isPageType(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8'))?.openArtifact?.style === 'page';
  } catch {
    return false;
  }
}

/** The built-in types served by `type-server/` (every non-page built-in type). */
export function serverTypeIds(repo, types = readBuiltinTypeIds(repo)) {
  return types.filter((type) => !isPageType(join(repo, 'artifact-types', type)));
}

/** Every file and folder `dist/server/` (and `vendor/type-server/`) must carry for all server-backed types to work. */
export function requiredTypeServerEntries(serverTypes) {
  return [
    { path: 'cli.mjs', kind: 'file' },
    { path: 'support.js', kind: 'file' },
    { path: 'sheets.wasm', kind: 'file' },
    { path: 'motion-tools.html', kind: 'file' },
    { path: 'pdf-reader.mjs', kind: 'file' },
    { path: 'pdf-cmaps', kind: 'dir' },
    { path: 'shell/index.html', kind: 'file' },
    ...serverTypes.map((type) => ({ path: `editors/${type}/index.html`, kind: 'file' })),
  ];
}

/** Paths missing from a built type server directory (`dist/server/` or `vendor/type-server/`). */
export function missingTypeServerFiles(serverDir, serverTypes) {
  return requiredTypeServerEntries(serverTypes)
    .filter(({ path, kind }) => (kind === 'dir' ? !isDir(join(serverDir, path)) : !isFile(join(serverDir, path))))
    .map(({ path }) => path);
}

/** Paths missing from a built skill folder (`skills/open-artifact/`) before it can be packaged or shipped. */
export function missingSkillVendorFiles(skillDir, { repo, types = readBuiltinTypeIds(repo) }) {
  const serverTypes = serverTypeIds(repo, types);
  const required = [
    { path: 'scripts/open-artifact.mjs', kind: 'file' },
    { path: 'vendor/open-artifact.mjs', kind: 'file' },
    { path: 'vendor/runtime.json', kind: 'file' },
    { path: 'vendor/shell/index.html', kind: 'file' },
    { path: 'vendor/home/index.html', kind: 'file' },
    { path: 'vendor/frame-host/frame-host.mjs', kind: 'file' },
    { path: 'vendor/harnesses', kind: 'dir' },
    ...requiredTypeServerEntries(serverTypes).map(({ path, kind }) => ({ path: `vendor/type-server/${path}`, kind })),
    ...types.map((type) => ({ path: `vendor/artifact-types/${type}/artifact-type.json`, kind: 'file' })),
    ...serverTypes.map((type) => ({ path: `vendor/artifact-types/${type}/scripts/cli.mjs`, kind: 'file' })),
  ];
  return required
    .filter(({ path, kind }) => (kind === 'dir' ? !isDir(join(skillDir, path)) : !isFile(join(skillDir, path))))
    .map(({ path }) => path);
}

/** Fails fast when a built skill folder is missing any daemon, Shell, frame-host, editor or type file. */
export function assertSkillVendorComplete(skillDir, { repo, types = readBuiltinTypeIds(repo), label = 'build' }) {
  const missing = missingSkillVendorFiles(skillDir, { repo, types });
  if (missing.length > 0) {
    throw new Error(
      `${label}: ${relative(repo, skillDir) || skillDir} is incomplete (missing ${missing.join(', ')}). Run npm run build, then node scripts/build-skill.mjs.`,
    );
  }
}

/** What a type's scripts/cli.mjs says: run the shared server's CLI (vendor/type-server/cli.mjs). */
const SHIM = `#!/usr/bin/env node
// The built-in types share one type server, ../../../type-server/ (its editors, engines and pages), instead of a copy
// each. Written by scripts/vendor-types.mjs; do not edit.
import { main } from '../../../type-server/cli.mjs';

try {
  const code = await main(process.argv.slice(2));
  if (code >= 0) process.exit(code);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
`;

/**
 * Copies the built server once into `<vendor>/type-server/` and each type of `types` into
 * `<vendor>/artifact-types/<type>/` with a scripts/cli.mjs that runs it.
 *
 * Refuses an incomplete `dist/server/` (for example, a partial or interrupted editor build) by default so
 * packaged skills and plugins can never ship with missing editors.
 */
export function vendorTypes({ repo, vendor, types, warn = console.warn, log = () => {}, strict = true }) {
  const server = join(repo, 'dist', 'server');
  const shared = join(vendor, 'type-server');
  const serverTypes = serverTypeIds(repo, types);
  rmSync(shared, { recursive: true, force: true });
  const missingBefore = missingTypeServerFiles(server, serverTypes);
  const built = missingBefore.length === 0;
  if (built) {
    cpSync(server, shared, { recursive: true });
    // Re-check after copying to catch a concurrent build emptying an editor folder mid-copy.
    const missingAfter = missingTypeServerFiles(shared, serverTypes);
    if (missingAfter.length > 0) {
      rmSync(shared, { recursive: true, force: true });
      const message = `the type server (${relative(repo, server)}) changed during copy (missing ${missingAfter.join(', ')}); wait for npm run build to finish and retry.`;
      if (strict) throw new Error(message);
      warn(message);
      return;
    }
    log('vendor/type-server/');
  } else {
    const message = `the type server (${relative(repo, server)}) is incomplete (missing ${missingBefore.join(', ')}); run npm run build first.`;
    if (strict) throw new Error(message);
    warn(`${message} The types' pages will not open.`);
  }

  for (const type of types) {
    const from = join(repo, 'artifact-types', type);
    const to = join(vendor, 'artifact-types', type);
    if (!isDir(from)) {
      const message = `the ${type} type: ${relative(repo, from)} is not there.`;
      if (strict) throw new Error(message);
      warn(`${message} Skipped.`);
      continue;
    }
    rmSync(to, { recursive: true, force: true });
    const ownScripts = join(from, 'scripts') + sep;
    cpSync(from, to, {
      recursive: true,
      filter: (path) => basename(path) !== 'node_modules' && !(path + sep).startsWith(ownScripts),
    });
    // A page type (openArtifact.style "page") has no CLI of its own: frame-host runs its artifacts.
    if (built && !isPageType(from)) {
      mkdirSync(join(to, 'scripts'), { recursive: true });
      writeFileSync(join(to, 'scripts', 'cli.mjs'), SHIM, { mode: 0o755 });
    }
  }
}
