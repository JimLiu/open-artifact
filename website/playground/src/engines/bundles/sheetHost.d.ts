/**
 * The types of `sheetHost.js` (built by `engines/build.mjs` from `engines/src/sheet-host.ts`, which has the full
 * story): the real Sheets store and its WebAssembly engine over an in-memory folder. Declared by hand so the
 * playground's TypeScript does not take in the type server's sources.
 */
import type { SheetCapability } from '@open-artifact/runtime';

/** Artifact-relative path → bytes (or text). */
export type Seed = Record<string, Uint8Array | string>;

/** Who the page is to the store (`packages/type-server/src/sheets/store.ts`, `Viewer`). */
export interface SheetViewer {
  id: string;
  name: string;
  canEdit: boolean;
  isOwner: boolean;
}

export interface SheetCapabilityOptions {
  viewer?: SheetViewer;
  log?: (line: string) => void;
}

/** The part of the Sheets store the playground's agent uses. */
export interface SheetStoreApi {
  readonly revision: number;
  /** The agent's applyEdits (`{kind: 'applyEdits', base, edits}`): one revision by the agent; the pages hear it. */
  agentUpdate(payload: unknown): unknown;
}

export interface BrowserSheet {
  capability: SheetCapability;
  files(): Record<string, Uint8Array>;
  agentRead(payload: unknown, atRevision?: number): unknown;
  exportFile(format: 'xlsx' | 'csv', options?: { sheet?: string }): { filename: string; bytes: Uint8Array; notCarriedOver: string[] };
  store: SheetStoreApi;
  root: string;
}

export function createSheetCapability(seed: Seed, wasm: string | URL | WebAssembly.Module | BufferSource, options?: SheetCapabilityOptions): Promise<BrowserSheet>;
