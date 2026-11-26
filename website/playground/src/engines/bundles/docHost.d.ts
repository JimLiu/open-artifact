/**
 * The types of `docHost.js` (built by `engines/build.mjs` from `engines/src/doc-host.ts`, which has the full story):
 * the real Docs host over an in-memory folder. Declared by hand so the playground's TypeScript does not take in the
 * type server's sources.
 */
import type { DocCapability, Viewer } from '@open-artifact/runtime';

/** Artifact-relative path → bytes (or text). */
export type Seed = Record<string, Uint8Array | string>;

export interface DocCapabilityOptions {
  viewer?: Viewer;
  owner?: { id: string; name: string };
  log?: (line: string) => void;
}

/** What the agent's call answers (`packages/type-server/src/docs/calls.ts`, `CallOutcome`). */
export interface DocCallOutcome {
  status: number;
  body: Record<string, unknown>;
  changes?: { tabs?: string[]; [key: string]: unknown };
}

/** The tab a page reads (`DocTabResponse`): its blocks as on disk. */
export interface DocTabRead {
  tab: string;
  rev: number;
  doc: { rev?: number; blocks: Array<{ id: string; type: string; inline?: Array<{ text?: string }>; children?: unknown[] }> };
}

/** The part of the Docs host (`packages/type-server/src/docs/host.ts`) the playground's agent uses. */
export interface DocHostApi {
  project(): { id: string; name: string; files: Array<{ id: string; name: string; order: string; rev: number; subtabOf?: string; content: { kind: 'node'; id: string } }> };
  read(tab: string, viewer: Viewer): DocTabRead;
  /** A call by the agent: the open pages hear its edits as the agent's. */
  agentCall(call: unknown): DocCallOutcome;
}

export interface BrowserDoc {
  capability: DocCapability;
  files(): Record<string, Uint8Array>;
  host: DocHostApi;
  root: string;
}

export function createDocCapability(seed: Seed, options?: DocCapabilityOptions): BrowserDoc;
