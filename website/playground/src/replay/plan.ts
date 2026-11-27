/**
 * What a replay's steps take from the seed, and what the artifact holds before the first of them: the seed without the
 * taken entries, with the script's `start` files in place of the seed's, and its `order` list cut to the entries that
 * are there.
 */

import type { JsonRecord } from '@open-artifact/runtime';
import type { ReplayOrder, ReplayScript, SeedFile, SeedManifest } from '../seeds/manifest.ts';

/** The seed entry of each id in the order list, in the list's order. */
function listed(seed: SeedManifest, order: ReplayOrder): string[] {
  const file = seed.files[order.path];
  if (!file || !('text' in file)) throw new Error(`replay: no ${order.path} in the seed`);
  const ids = (JSON.parse(file.text) as JsonRecord)[order.field];
  if (!Array.isArray(ids)) throw new Error(`replay: ${order.path} has no list "${order.field}"`);
  return ids.map((id) => order.entry.replace('{id}', String(id)));
}

/**
 * The seed entries each step writes, in the order they land. A pattern ending in `*` takes what is left under it (in
 * the order list's order where there is one); nothing is taken twice.
 */
export function stepTakes(seed: SeedManifest, script: ReplayScript): string[][] {
  const paths = Object.keys(seed.files);
  const rank = new Map((script.order ? listed(seed, script.order) : []).map((path, i) => [path, i]));
  const named = new Set(script.steps.flatMap((step) => (step.take ?? []).filter((p) => !p.endsWith('*'))));
  const taken = new Set<string>();
  return script.steps.map((step) => {
    const out: string[] = [];
    for (const pattern of step.take ?? []) {
      const rest = pattern.endsWith('*');
      const found = rest ? paths.filter((p) => p.startsWith(pattern.slice(0, -1)) && !named.has(p)) : paths.filter((p) => p === pattern);
      if (!found.length) throw new Error(`replay: the seed has no ${pattern}`);
      if (rest) found.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
      for (const path of found) {
        // The order list is kept in step with what exists: never taken whole.
        if (taken.has(path) || path === script.order?.path) continue;
        taken.add(path);
        out.push(path);
      }
    }
    return out;
  });
}

/** The order file's content with its list cut to the ids whose entries `has` says exist. */
export function orderValue(seed: SeedManifest, order: ReplayOrder, has: (path: string) => boolean): JsonRecord {
  const file = seed.files[order.path] as { text: string };
  const data = JSON.parse(file.text) as JsonRecord;
  const ids = data[order.field] as unknown[];
  return { ...data, [order.field]: ids.filter((id) => has(order.entry.replace('{id}', String(id)))) } as JsonRecord;
}

/** What the artifact holds before the replay's first step. */
export function startSeed(seed: SeedManifest): SeedManifest {
  const script = seed.replay;
  if (!script) return seed;
  const files: Record<string, SeedFile> = { ...seed.files };
  for (const path of stepTakes(seed, script).flat()) delete files[path];
  for (const [path, text] of Object.entries(script.start ?? {})) files[path] = { text };
  const order = script.order;
  if (order) {
    files[order.path] = { text: `${JSON.stringify(orderValue(seed, order, (path) => path in files), null, 2)}\n` };
  }
  return { ...seed, files };
}
