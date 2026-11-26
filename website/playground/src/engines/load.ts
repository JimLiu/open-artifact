/**
 * The Docs and Sheets engines, loaded only by their own demos. Each is the real server-side engine from
 * `packages/type-server` bundled for the browser (`engines/build.mjs` → `bundles/docHost.js`, `bundles/sheetHost.js`)
 * over an in-memory folder; Vite makes each a chunk of its own behind these dynamic imports, so the other demos never
 * fetch them.
 *
 * The Sheets store compiles the same WebAssembly the sheets editor's worker loads: the editor's own hashed copy
 * (`editors/sheets/assets/open_artifact_sheets_bg-*.wasm`, named at build time by `vite.config.ts`), so the page and
 * the worker share one download through the HTTP cache. Each still compiles its own module.
 */

import type { Viewer } from '@open-artifact/runtime';
import { playgroundRoot } from '../root.ts';
import type { BrowserDoc } from './bundles/docHost.js';
import type { BrowserSheet } from './bundles/sheetHost.js';

export type { BrowserDoc, DocHostApi } from './bundles/docHost.js';
export type { BrowserSheet } from './bundles/sheetHost.js';

declare const __SHEETS_WASM__: string;

/** Artifact-relative path → bytes. */
export type EngineSeed = Record<string, Uint8Array>;

/** The sheets editor's copy of the engine, as a URL of this site. */
export function sheetsWasmUrl(): string {
  return new URL(__SHEETS_WASM__, playgroundRoot()).href;
}

// Each load is measured (`performance.getEntriesByName('playground:docs-engine')`, `…sheets-engine`): the import, and
// for sheets the engine's compile and the edit log's replay.

/** The doc of `seed`, its owner (and the page's viewer) `viewer`. */
export async function loadDocEngine(seed: EngineSeed, viewer: Viewer): Promise<BrowserDoc> {
  const started = performance.now();
  const { createDocCapability } = await import('./bundles/docHost.js');
  const doc = createDocCapability(seed, { viewer, owner: { id: viewer.id, name: viewer.name }, log: () => undefined });
  performance.measure('playground:docs-engine', { start: started });
  return doc;
}

/** The workbook of `seed`, its owner (and the page's viewer) `viewer`. */
export async function loadSheetEngine(seed: EngineSeed, viewer: Viewer): Promise<BrowserSheet> {
  const started = performance.now();
  const { createSheetCapability } = await import('./bundles/sheetHost.js');
  const sheet = await createSheetCapability(seed, sheetsWasmUrl(), { viewer: { id: viewer.id, name: viewer.name, canEdit: true, isOwner: true }, log: () => undefined });
  performance.measure('playground:sheets-engine', { start: started });
  return sheet;
}
