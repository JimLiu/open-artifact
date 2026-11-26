/**
 * The artifact folder in the bundle's in-memory file system: `node:fs` is aliased (build.mjs) to the Cloudflare host's
 * replacement file system (packages/host-cloudflare/src/fs), whose unmounted paths are plain memory. Each bundle has its
 * own copy of that file system.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Artifact-relative path → bytes (or text). */
export type Seed = Record<string, Uint8Array | string>;

let made = 0;

// Exports and imports make scratch folders in `os.tmpdir()` (the shim's `/tmp`), as on a computer.
fs.mkdirSync('/tmp', { recursive: true });

/** A fresh folder for one artifact, holding `seed`. */
export function folderWith(seed: Seed, name = 'artifact'): string {
  const root = `/artifacts/${name}-${++made}`;
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, data] of Object.entries(seed)) {
    if (rel.startsWith('/') || rel.split('/').includes('..')) throw new Error(`Not an artifact path: ${rel}`);
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }
  return root;
}

/** Every file under `root`, artifact-relative path → a copy of its bytes, sorted by path. */
export function filesOf(root: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(at);
      else if (entry.isFile()) out[path.relative(root, at)] = new Uint8Array(fs.readFileSync(at));
    }
  };
  walk(root);
  return out;
}

/** A JSON round trip: what crosses the wire on a real host (so a page never shares objects with the store). */
export const wire = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
