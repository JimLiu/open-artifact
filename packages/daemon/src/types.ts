/**
 * The type registry: the Artifact Types in the type roots.
 *
 * Roots, highest precedence first: the workspace's project root (runs code
 * only when trusted), the user root, the extra roots from settings, and the
 * built-in root (the repository's `artifact-types/`, limited to
 * {@link BUILTIN_TYPE_IDS}). A type id found in a higher root shadows the
 * same id below it.
 */

import { EventEmitter } from 'node:events';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TYPE_ID,
  entryLocation,
  isLoopbackHost,
  isServerEntry,
  isUrlEntry,
  type ArtifactTypeManifest,
  type ManifestHostHints,
  type ManifestI18n,
  type ManifestTemplate,
  type OpenArtifactSettings,
  type ResolvedEntry,
  type TypeLocation,
  type TypeRuntime,
  type TypeScope,
} from '@open-artifact/protocol';
import { readJson } from './paths.ts';

/** Type ids the built-in root may provide in this release. */
export const BUILTIN_TYPE_IDS: readonly string[] = ['design', 'design-system', 'whiteboard', 'slides', 'data', 'sheets', 'docs', 'motion'];

/**
 * The built-in type root: `$OPEN_ARTIFACT_BUILTIN_TYPES`, else the repository's
 * `artifact-types/` folder resolved from this module's location.
 */
export function defaultBuiltinTypesDir(): string {
  return process.env.OPEN_ARTIFACT_BUILTIN_TYPES || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'artifact-types');
}

/** One type root. */
export interface TypeRoot {
  root: string;
  scope: TypeScope;
  /** Its types may run code (start servers). */
  trusted: boolean;
  /** When set, only these ids are read from the root. */
  allow?: readonly string[];
}

/** A type folder as the registry read it. */
export interface TypeInfo {
  id: string;
  /** The type folder (absolute). */
  dir: string;
  /** The root it was found in. */
  root: string;
  scope: TypeScope;
  trusted: boolean;
  name: string;
  title: string;
  description: string;
  summary: string | null;
  category: string | null;
  version: string | null;
  command: string;
  intents: string[];
  when: string | null;
  i18n: ManifestI18n;
  /** Icon file, relative to {@link dir}. */
  icon: string | null;
  artifactTitle: string | null;
  templates: ManifestTemplate[];
  flags: Record<string, boolean>;
  hasSkill: boolean;
  skillFile: string | null;
  entry: ResolvedEntry | null;
  runtime: TypeRuntime;
  runnable: boolean;
  dependencies: string[];
  detect: string[];
  titleFrom: string | null;
  /** Document store the type keeps, from `openArtifact.store`. */
  store: string | null;
  /** Formats the page exports, from `openArtifact.exports`. */
  exports: string[];
  /** Types whose artifacts this one builds on, from `openArtifact.uses`. */
  uses: string[];
  /** When an agent may offer the type unasked, from `openArtifact.offer`. */
  offer: string | null;
  openArtifact: ManifestHostHints;
  problems: string[];
}

/** A type as {@link TypeRegistry.list} returns it. */
export interface ListedType extends TypeInfo {
  enabled: boolean;
  /** Scope of the root whose type of the same id wins over this one. */
  shadowedBy: TypeScope | null;
}

/** The frontmatter of a `SKILL.md`: a small YAML subset (key: value, folded / literal blocks, quoted strings). */
export function readFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    const key = kv[1]!;
    let value = kv[2]!;
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      value = value.startsWith('>') ? block.join(' ') : block.join('\n');
    } else if (/^["'].*["']$/.test(value)) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    out[key] = value;
  }
  return out;
}

const stripFrontmatter = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** True for a loopback http(s) URL (templates allowed): only those may carry `{root}` or be a server's address. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value.replace(/\{[a-z]+\}/g, 'x'));
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a type lives on another computer, and where: a URL entry that is not loopback (`entryLocation`). What is
 * sent to such a type leaves this computer, whatever `effect` its actions declare.
 */
export function typeLocation(type: Pick<TypeInfo, 'entry'> | null | undefined): TypeLocation {
  return entryLocation(type?.entry);
}

/** True when the type lives on another computer ({@link typeLocation}). */
export const isRemoteType = (type: Pick<TypeInfo, 'entry'> | null | undefined): boolean => typeLocation(type).remote;

/** Resolves a manifest's `entry`: static, url or server. */
export function entryOf(
  manifest: ArtifactTypeManifest,
  dir: string,
  hasIndex: boolean,
  problems: string[],
): { entry: ResolvedEntry | null; runtime: TypeRuntime } {
  const raw = manifest.entry;
  if (typeof raw === 'string') {
    if (/^https?:\/\//i.test(raw)) return urlEntry(raw, false, false, false, problems);
    const file = resolve(dir, raw);
    if (!file.startsWith(resolve(dir) + sep)) {
      problems.push(`entry ${raw} leaves the type folder.`);
      return { entry: null, runtime: 'static' };
    }
    if (!existsSync(file)) {
      problems.push(`entry ${raw} is not in the type folder.`);
      return { entry: null, runtime: 'static' };
    }
    return { entry: { kind: 'static', file: relative(dir, file).split(sep).join('/') }, runtime: 'static' };
  }
  if (raw && typeof raw === 'object') {
    const flags = { open: raw.open === true, share: raw.share === true, actions: raw.actions === true };
    if (isServerEntry(raw)) {
      const start = raw.start;
      if (typeof start.command !== 'string' || !start.command) {
        problems.push('entry.start.command is missing.');
        return { entry: null, runtime: 'server' };
      }
      if (raw.url !== undefined && (typeof raw.url !== 'string' || !isLoopbackUrl(raw.url))) {
        problems.push('entry.url with entry.start must be a loopback http(s) address.');
        return { entry: null, runtime: 'server' };
      }
      if (!flags.open && !raw.url) problems.push('entry.start needs open: true or a url template.');
      const env = start.env && typeof start.env === 'object' ? Object.fromEntries(Object.entries(start.env).map(([k, v]) => [k, String(v)])) : {};
      return {
        entry: { kind: 'server', start: { command: start.command, args: Array.isArray(start.args) ? start.args.map(String) : [], env }, url: raw.url ?? null, ...flags },
        runtime: 'server',
      };
    }
    if (isUrlEntry(raw)) return urlEntry(raw.url, flags.open, flags.share, flags.actions, problems);
    problems.push('entry needs a url or start.');
    return { entry: null, runtime: 'url' };
  }
  if (hasIndex && hasInlineDeclaration(dir)) {
    const bin = frameHostBin();
    if (!bin) {
      problems.push('An original artifact type: frame-host is not there (build it with node scripts/build.mjs --only frame).');
      return { entry: null, runtime: 'frame' };
    }
    return { entry: { kind: 'server', start: { command: 'node', args: [bin], env: {} }, url: null, open: true, share: false, actions: true }, runtime: 'frame' };
  }
  if (hasIndex) return { entry: { kind: 'static', file: 'index.html' }, runtime: 'static' };
  problems.push('No entry: add "entry" to artifact-type.json or an index.html.');
  return { entry: null, runtime: 'static' };
}

/** The line that opens an original type's inline declaration (as frame-host reads it). */
const DECLARATION_LINE = /(^|\n)[ \t]*\/\/ artifact\.json[ \t]*\r?\n/;

/** True when the folder's index.html declares an original artifact type; only its first 64 KB are read. */
export function hasInlineDeclaration(dir: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(join(dir, 'index.html'), 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return DECLARATION_LINE.test(buf.toString('utf8', 0, n));
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * frame-host's entry script, or `null`: `OPEN_ARTIFACT_FRAME_HOST`; next to this file
 * (`frame-host/frame-host.mjs`: the DSH plugin's vendor/ holds open-artifact.mjs and
 * frame-host/ side by side); then, in the repository, the source bin when
 * the daemon itself runs from source, else the bundle in dist/daemon/.
 */
export function frameHostBin(): string | null {
  if (process.env.OPEN_ARTIFACT_FRAME_HOST) return resolve(process.env.OPEN_ARTIFACT_FRAME_HOST);
  const self = fileURLToPath(import.meta.url);
  const here = dirname(self);
  const source = resolve(here, '..', '..', 'server-sdk', 'bin', 'frame-host.ts');
  const built = resolve(here, '..', '..', '..', 'dist', 'daemon', 'frame-host', 'frame-host.mjs');
  const candidates = [join(here, 'frame-host', 'frame-host.mjs'), ...(self.endsWith('.ts') ? [source, built] : [built, source])];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function urlEntry(url: string, open: boolean, share: boolean, actions: boolean, problems: string[]): { entry: ResolvedEntry | null; runtime: TypeRuntime } {
  if (!/^https?:\/\//i.test(url)) {
    problems.push('entry.url must be an http(s) address.');
    return { entry: null, runtime: 'url' };
  }
  if (url.includes('{root}') && !isLoopbackUrl(url)) {
    problems.push('{root} may only be used in a loopback entry.url.');
    return { entry: null, runtime: 'url' };
  }
  return { entry: { kind: 'url', url, open, share, actions }, runtime: 'url' };
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** Reads one type folder; `null` when it is not a type (no `index.html` and no `artifact-type.json`). */
export function readTypeFolder(dir: string, where: TypeRoot): TypeInfo | null {
  const id = basename(dir);
  if (!TYPE_ID.test(id)) return null;
  const hasIndex = existsSync(join(dir, 'index.html'));
  const manifestFile = join(dir, 'artifact-type.json');
  const hasManifest = existsSync(manifestFile);
  if (!hasIndex && !hasManifest) return null;
  const read = hasManifest ? readJson<ArtifactTypeManifest | null>(manifestFile, null) : {};
  const problems: string[] = [];
  if (hasManifest && (!read || typeof read !== 'object')) problems.push('artifact-type.json is not valid JSON.');
  const m: ArtifactTypeManifest = read && typeof read === 'object' ? read : {};
  const skillName = m.skill === false ? null : typeof m.skill === 'string' ? m.skill : 'SKILL.md';
  const skillFile = skillName ? resolve(dir, skillName) : null;
  let skillText: string | null = null;
  if (skillFile && skillFile.startsWith(resolve(dir) + sep)) {
    try {
      skillText = readFileSync(skillFile, 'utf8');
    } catch {
      skillText = null;
    }
  }
  const fm = skillText ? readFrontmatter(skillText) : {};
  const { entry, runtime } = entryOf(m, dir, hasIndex, problems);
  const iconFile = m.icon?.file;
  const icon =
    typeof iconFile === 'string' && !iconFile.includes('..') && existsSync(join(dir, iconFile)) ? iconFile : existsSync(join(dir, 'icon.svg')) ? 'icon.svg' : null;
  const name = str(m.name) ?? str(m.title) ?? str(fm.name) ?? id;
  return {
    id,
    dir,
    root: where.root,
    scope: where.scope,
    trusted: where.trusted,
    name,
    title: str(m.title) ?? str(m.name) ?? str(fm.name) ?? id,
    description: String(m.description ?? fm.description ?? '').trim(),
    summary: str(m.summary),
    category: str(m.category),
    version: str(m.version),
    command: str(m.command) ?? id,
    intents: Array.isArray(m.intents) ? m.intents.map(String) : [],
    when: str(m.when),
    i18n: m.i18n && typeof m.i18n === 'object' ? m.i18n : {},
    icon,
    artifactTitle: str(m.artifactTitle),
    templates: Array.isArray(m.templates) ? m.templates : [],
    flags: m.flags && typeof m.flags === 'object' ? m.flags : {},
    hasSkill: !!skillText,
    skillFile: skillText ? skillFile : null,
    entry,
    runtime,
    runnable: !!entry,
    dependencies: Array.isArray(m.dependencies) ? m.dependencies.map(String) : [],
    detect: Array.isArray(m.detect) ? m.detect.map(String) : [],
    titleFrom: str(m.titleFrom),
    store: str(m.openArtifact?.store),
    exports: Array.isArray(m.openArtifact?.exports) ? m.openArtifact.exports.filter((f): f is string => typeof f === 'string' && !!f.trim()).map((f) => f.trim().toLowerCase()).slice(0, 20) : [],
    uses: Array.isArray(m.openArtifact?.uses) ? [...new Set(m.openArtifact.uses.filter((t): t is string => typeof t === 'string' && TYPE_ID.test(t.trim())).map((t) => t.trim()))].slice(0, 10) : [],
    offer: str(m.openArtifact?.offer),
    openArtifact: m.openArtifact && typeof m.openArtifact === 'object' ? m.openArtifact : {},
    problems,
  };
}

/** The type's `SKILL.md` without its frontmatter, or `null`. */
export function skillBody(type: TypeInfo | null | undefined): string | null {
  if (!type?.skillFile) return null;
  try {
    return stripFrontmatter(readFileSync(type.skillFile, 'utf8'));
  } catch {
    return null;
  }
}

/** Options of {@link TypeRegistry}. */
export interface TypeRegistryOptions {
  /** The built-in root; `null` turns it off. Default {@link defaultBuiltinTypesDir}. */
  builtinDir?: string | null;
}

/** Reads the type roots and watches them. Emits `changed` (debounced) when a root changes. */
export class TypeRegistry extends EventEmitter<{ changed: [] }> {
  private readonly settings: () => OpenArtifactSettings;
  private readonly builtinDir: string | null;
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(settings: () => OpenArtifactSettings, options: TypeRegistryOptions = {}) {
    super();
    this.settings = settings;
    this.builtinDir = options.builtinDir === undefined ? defaultBuiltinTypesDir() : options.builtinDir;
  }

  /** The roots for a workspace, highest precedence first. */
  roots(workspace?: string | null): TypeRoot[] {
    const s = this.settings();
    const roots: TypeRoot[] = [];
    if (workspace) {
      const project = resolve(workspace, s.typeRoots.project);
      const trusted = process.env.OPEN_ARTIFACT_TRUST_PROJECTS === '1' || (s.trustedProjects ?? []).map((p) => resolve(p)).includes(resolve(workspace));
      roots.push({ root: project, scope: 'project', trusted });
    }
    roots.push({ root: resolve(s.typeRoots.user), scope: 'user', trusted: true });
    for (const extra of s.typeRoots.extra ?? []) roots.push({ root: resolve(extra), scope: 'extra', trusted: true });
    if (this.builtinDir) roots.push({ root: resolve(this.builtinDir), scope: 'builtin', trusted: true, allow: BUILTIN_TYPE_IDS });
    return roots;
  }

  /** The types in one root. */
  scanRoot(where: TypeRoot): TypeInfo[] {
    let names: string[];
    try {
      names = readdirSync(where.root);
    } catch {
      return [];
    }
    this.watch(where.root);
    const out: TypeInfo[] = [];
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue;
      if (where.allow && !where.allow.includes(name)) continue;
      const dir = join(where.root, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const type = readTypeFolder(dir, where);
      if (type) out.push(type);
    }
    return out;
  }

  /** Every type visible from `workspace`; shadowed ones only with `includeShadowed`. */
  list(workspace?: string | null, options: { includeShadowed?: boolean } = {}): ListedType[] {
    const disabled = new Set(this.settings().disabledTypes ?? []);
    const seen = new Map<string, TypeScope>();
    const all: ListedType[] = [];
    for (const where of this.roots(workspace)) {
      for (const type of this.scanRoot(where)) {
        const shadowedBy = seen.get(type.id) ?? null;
        if (!shadowedBy) seen.set(type.id, type.scope);
        if (!shadowedBy || options.includeShadowed) all.push({ ...type, enabled: !disabled.has(type.id), shadowedBy });
      }
    }
    return all;
  }

  /** The visible type of an id, or `null`. */
  get(id: string, workspace?: string | null): ListedType | null {
    return this.list(workspace).find((t) => t.id === id) ?? null;
  }

  private watch(dir: string): void {
    if (this.watchers.has(dir)) return;
    try {
      const watcher = watch(dir, { persistent: false }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.emit('changed'), 300);
        this.timer.unref?.();
      });
      watcher.on('error', () => undefined);
      this.watchers.set(dir, watcher);
    } catch {
      /* a root that is not there yet */
    }
  }

  /** Stops watching. */
  close(): void {
    clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
