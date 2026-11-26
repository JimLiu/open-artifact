/**
 * `@open-artifact/wasm-sheets/node` for the browser bundle (build.mjs aliases that specifier here), as
 * packages/host-cloudflare/src/wasm/sheets.ts is for workerd.
 *
 * Node reads the module from disk and compiles it synchronously; a browser main thread refuses to compile a module
 * this size synchronously, so the bytes are compiled and instantiated asynchronously first (`prepareSheetsEngine`,
 * which the sheet capability awaits before it makes the store) and `sheetsEngine()` hands that engine over.
 */
import { loadSheetsEngine, type SheetsEngine } from '../../../../packages/wasm-sheets/src/index.ts';

export type { EngineSession, PackedCellBlock, SheetsEngine } from '../../../../packages/wasm-sheets/src/index.ts';

let engine: SheetsEngine | null = null;
let preparing: Promise<SheetsEngine> | null = null;

/**
 * Compiles and instantiates the engine once per realm: from a URL (streaming compile, the HTTP cache keeps the bytes),
 * a compiled `WebAssembly.Module` (one already compiled elsewhere, e.g. posted from another worker), or the bytes.
 */
export function prepareSheetsEngine(source: string | URL | WebAssembly.Module | BufferSource): Promise<SheetsEngine> {
  preparing ??= (async () => {
    // The glue's async init takes a URL or a compiled module (it then instantiates with `WebAssembly.instantiate`,
    // never the synchronous `new WebAssembly.Instance` that a main thread may refuse for a module this size).
    const from = typeof source === 'string' || source instanceof URL || source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
    engine = await loadSheetsEngine(from as string);
    return engine;
  })();
  return preparing;
}

/** The engine, once {@link prepareSheetsEngine} finished. */
export function sheetsEngine(): SheetsEngine {
  if (!engine) throw new Error('The Sheets engine is not loaded yet: await prepareSheetsEngine(wasmUrl) first.');
  return engine;
}
