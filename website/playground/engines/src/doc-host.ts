/**
 * The `doc` capability in the browser: the real Docs host (packages/type-server/src/docs/host.ts) over an in-memory
 * folder, answering what the server's DOC_API routes answer (server.ts `handleDoc`), with hosted mode's limits (no PDF
 * export, which prints in Chrome; no PDF import).
 */
import { ArtifactError, type DocCapability, type DocExportedFile, type DocExportQuery, type Viewer } from '@open-artifact/runtime/capabilities';
import type { DocFrame } from '@open-artifact/runtime/doc-api';
import { DocHost, DocRequestError } from '../../../../packages/type-server/src/docs/host.ts';
import { formatOf } from '../../../../packages/type-server/src/docs/import.ts';
import { DocTransferError, exportDocFile, importDocFile } from '../../../../packages/type-server/src/docs/transfer.ts';
import { filesOf, folderWith, type Seed, wire } from './memfs.ts';

export interface DocCapabilityOptions {
  /** Who the page is (default: the owner). */
  viewer?: Viewer;
  /** The doc's owner, who the agent's edits are made for (default: {id: 'owner', name: 'You'}). */
  owner?: { id: string; name: string };
  /** The host's log lines (default: console.debug). */
  log?: (line: string) => void;
}

export interface BrowserDoc {
  /** What `window.openartifact.use('doc')` resolves to. */
  capability: DocCapability;
  /** The artifact folder as it stands now: artifact-relative path → bytes. */
  files(): Record<string, Uint8Array>;
  /** The host itself, for the agent's calls (`host.agentCall`) and inspection. */
  host: DocHost;
  /** Where the folder is in the bundle's memory file system. */
  root: string;
}

const OWNER: Viewer = { id: 'owner', name: 'You', role: 'owner' };

/** A refusal of the host as the HTTP client would reject it (server.ts maps DocRequestError the same way). */
function rejection(error: unknown): unknown {
  if (error instanceof DocRequestError) {
    const code = error.code === 'guard_mismatch' ? 'conflict' : error.code === 'not_writer' ? 'not_writer' : error.status === 404 ? 'not_found' : 'invalid';
    return new ArtifactError(code, error.message);
  }
  if (error instanceof DocTransferError) return new ArtifactError(error.status === 404 ? 'not_found' : 'invalid', error.message);
  return error;
}

/** Runs one request as the server would: the answer goes over the wire (a copy), a refusal as an ArtifactError. */
async function answer<T>(fn: () => T | Promise<T>, raw = false): Promise<T> {
  try {
    const value = await fn();
    return raw ? value : wire(value);
  } catch (error) {
    throw rejection(error);
  }
}

/** The doc of `seed` (its `doc/doc.json` and `doc/tabs/*.json`, any other artifact files beside them). */
export function createDocCapability(seed: Seed, options: DocCapabilityOptions = {}): BrowserDoc {
  const owner = options.owner ?? { id: OWNER.id, name: OWNER.name };
  const viewer = options.viewer ?? { ...OWNER, ...owner };
  const log = options.log ?? ((line: string) => console.debug(`[doc] ${line}`));
  const root = folderWith(seed, 'doc');
  const listeners = new Set<(frame: DocFrame) => void>();
  // The page's connection id: the host keeps one writing session per connection.
  const client = `page-${crypto.randomUUID()}`;
  // Frames go out after the call's answer, as an event stream's would.
  const deliver = (frame: DocFrame): void => {
    const copy = wire(frame);
    queueMicrotask(() => {
      for (const listener of [...listeners]) listener(copy);
    });
  };
  const host = new DocHost({
    root,
    owner,
    emit: (frame, except) => {
      if (except !== client) deliver(frame);
    },
    log,
  });
  // One task at a time, as the server's `artifact.run` keeps them.
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => T | Promise<T>, raw = false): Promise<T> => {
    const next = queue.then(() => answer(fn, raw));
    queue = next.catch(() => undefined);
    return next;
  };

  const capability: DocCapability = {
    session: () => run(() => host.session(client, viewer)),
    read: (tab) => run(() => host.read(tab, viewer)),
    call: (request) => run(() => host.call(wire(request), client, viewer)),
    history: (tab) => run(() => host.history(tab)),
    version: (tab, rev) => run(() => host.version(tab, Number(rev))),
    restore: (request) => run(() => host.restore(request.tab, Number(request.rev), typeof request.ifRev === 'number' ? request.ifRev : undefined, viewer)),
    importFile: (name, bytes, tabName) =>
      run(async () => {
        if (viewer.role !== 'owner' && viewer.role !== 'editor') throw new ArtifactError('not_writer', 'Only editors can import a file.');
        let pdf = false;
        try {
          pdf = formatOf(name.trim(), bytes) === 'pdf';
        } catch {
          pdf = false;
        }
        if (pdf) throw new ArtifactError('invalid', 'Importing a PDF is not available in the browser playground.');
        const query = new URLSearchParams({ name, ...(tabName ? { tabName } : {}) });
        return importDocFile(host, query, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      }),
    exportFile: (query: DocExportQuery) =>
      run(async () => {
        // The notes go as the server's header sends them ({code, what, count}: docs-core's ExportNote), cast as
        // local-provider.ts casts them; DocExportedFile declares {code, message, count?}, a mismatch in the contract.
        // A PDF prints in Chrome on the server's computer (server.ts refuses it hosted too).
        if (query.format === 'pdf') throw new ArtifactError('invalid', 'A PDF export is not available in the browser playground.');
        const file = await exportDocFile(host.store, owner, { format: query.format, ...(query.tab ? { tab: query.tab } : {}), ...(query.paper ? { paper: query.paper } : {}) });
        return { name: file.name, mime: file.mime, bytes: new Uint8Array(file.bytes), notes: wire(file.notes) as unknown as DocExportedFile['notes'] };
      }, true),
    onFrame: (listener) => {
      listeners.add(listener);
      // A stream's first frame (server.ts attachClient): the page reads what it holds again.
      queueMicrotask(() => listeners.has(listener) && listener({ kind: 'stream' } as DocFrame));
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { capability: Object.freeze(capability), files: () => filesOf(root), host, root };
}

export { ArtifactError };
