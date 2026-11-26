/**
 * The `sheet` capability in the browser: the real Sheets store (packages/type-server/src/sheets/store.ts) over an
 * in-memory folder, its edit log replayed through the Rust/WASM engine, answering what the server's SHEET_API routes
 * answer (server.ts `handleSheet`) and streaming the frames its event stream carries.
 */
import { ArtifactError, type SheetCapability } from '@open-artifact/runtime/capabilities';
import type { SheetFrame } from '@open-artifact/runtime/sheet-api';
import { SheetStore, type Viewer as SheetViewer } from '../../../../packages/type-server/src/sheets/store.ts';
import { prepareSheetsEngine } from '../shims/wasm-sheets.ts';
import { filesOf, folderWith, type Seed, wire } from './memfs.ts';

export interface SheetCapabilityOptions {
  /** Who the page is (default: the owner, "You", who may edit). */
  viewer?: SheetViewer;
  /** The store's log lines (default: console.debug). */
  log?: (line: string) => void;
}

export interface BrowserSheet {
  /** What `window.openartifact.use('sheet')` resolves to. */
  capability: SheetCapability;
  /** The artifact folder as it stands now: artifact-relative path → bytes. */
  files(): Record<string, Uint8Array>;
  /** The agent's read (readSheets, readCells, …) of the workbook with its formulas worked out, as `open-artifact sheets read`. */
  agentRead(payload: unknown, atRevision?: number): unknown;
  /** The workbook as .xlsx or one sheet as .csv (the Export menu). */
  exportFile(format: 'xlsx' | 'csv', options?: { sheet?: string }): { filename: string; bytes: Uint8Array; notCarriedOver: string[] };
  /** The store itself (agentUpdate, agentBatch, …). */
  store: SheetStore;
  root: string;
}

const OWNER: SheetViewer = { id: 'owner', name: 'You', canEdit: true, isOwner: true };

/**
 * The workbook of `seed` (its `sheet/sheet.json` and `sheet/edits.jsonl`; an empty seed makes a new Sheet). `wasm` is
 * the engine: the URL of open_artifact_sheets_bg.wasm (compiled with streaming), a compiled `WebAssembly.Module`, or
 * its bytes. The engine is compiled once per realm; later calls reuse it whatever they pass.
 */
export async function createSheetCapability(seed: Seed, wasm: string | URL | WebAssembly.Module | BufferSource, options: SheetCapabilityOptions = {}): Promise<BrowserSheet> {
  await prepareSheetsEngine(wasm);
  const viewer = options.viewer ?? OWNER;
  // The page's viewer owns the workbook (the playground's one visitor).
  const log = options.log ?? ((line: string) => console.debug(`[sheet] ${line}`));
  const root = folderWith(seed, 'sheet');
  const store = new SheetStore({
    root,
    ownerId: viewer.isOwner ? viewer.id : OWNER.id,
    ownerName: viewer.isOwner ? viewer.name : OWNER.name,
    // The only writer: no other process appends to the log, so no poll.
    watch: 'events',
    // No agent in the playground: "Import from Excel" keeps the file and says it was not handed over.
    sendToAgent: () => false,
    log,
  });
  const guard = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    try {
      return wire(await fn());
    } catch (error) {
      throw error instanceof ArtifactError ? error : new ArtifactError('invalid', error instanceof Error ? error.message : String(error));
    }
  };
  // Sends are answered one at a time, in the order the page made them (as local-provider.ts sends them).
  let sending: Promise<unknown> = Promise.resolve();

  const capability: SheetCapability = {
    read: ((request) => guard(() => store.read(wire(request), viewer))) as SheetCapability['read'],
    send: (request) => {
      const next = sending.then(() => guard(() => store.send(wire(request), viewer)));
      sending = next.catch(() => undefined);
      return next;
    },
    widget: (request) => guard(() => store.widget(wire(request), viewer)),
    importFile: async (file, name) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return guard(() => store.importFile(name, bytes));
    },
    onFrame: (listener) => {
      let close: (() => void) | null = null;
      let open = true;
      // The stream opens as an EventSource's would, after the page subscribed: a snapshot and the clock first.
      queueMicrotask(() => {
        if (!open) return;
        close = store.open(viewer, (frame: SheetFrame) => {
          const copy = wire(frame);
          queueMicrotask(() => open && listener(copy));
        });
      });
      return () => {
        open = false;
        close?.();
      };
    },
    // Walkthroughs come from the agent; there is none here.
    onWalkthrough: () => () => undefined,
  };
  return {
    capability: Object.freeze(capability),
    files: () => filesOf(root),
    agentRead: (payload, atRevision) => wire(store.agentRead(payload, atRevision)),
    exportFile: (format, opts) => store.exportFile(format, opts),
    store,
    root,
  };
}

export { ArtifactError };
