/**
 * Loading, autosave and changes made elsewhere, the shared part. An editor
 * keeps its project as an index file plus item files under `project/`; this
 * module owns the mechanics around them:
 *
 * - Load: the listing, the named files and every item file ({@link readProject}).
 * - Save: a debounced save after each local change, one at a time (a change
 *   during a save saves again after it), one publish batch with `ifMatch` on
 *   every file. A conflict reads the files that lost the race and lets the
 *   editor merge, then retries (a bounded number of times). Offline: backoff.
 * - Remote changes: pushed by the host, read and handed to the editor. A file
 *   held by a text edit waits until the edit ends.
 * - Catching up: when the host's change stream starts again (`resync`), the
 *   changes it carried while it was down are lost; the listing is compared with
 *   what this tab holds and the difference is merged like a pushed change.
 *
 * What a batch holds, what a save marks saved and how a change is merged
 * are the editor's ({@link ProjectSyncOptions}).
 */

import { isArtifactError, type ArtifactCapability, type ConflictPath, type PublishBatch } from '@open-artifact/runtime';

/** The save states the engine sets (an editor's badge may know more). */
export type ProjectSaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'readonly';

/** How the editor takes one changed file (see {@link ProjectSyncOptions.remote}). */
export interface RemoteFile {
  /** The hash this tab holds; a change to the same hash is skipped (unless forced). `undefined`: never skipped. */
  hash: string | null | undefined;
  /** A text edit holds the file: the change waits until it ends (unless forced). */
  held?: boolean;
  /** Takes their version (`text` null: deleted or unreadable). */
  apply(text: string | null, hash: string | null): void;
}

/** What {@link createProjectSync} drives. `Sent` is what one batch sent; `Run` is one pass of remote changes. */
export interface ProjectSyncOptions<Sent, Run> {
  /** The artifact capability (read when used, so it may come from a session set up later). */
  artifact(): Pick<ArtifactCapability, 'readText' | 'publish' | 'onChange'> & Partial<Pick<ArtifactCapability, 'list'>>;
  /** Delay between the last change and the save, ms. */
  saveDelay: number;
  /** Conflict retries per save (default 4). */
  maxRetries?: number;

  readOnly(): boolean;
  /** True when something has not reached the server. */
  isDirty(): boolean;
  save(): string;
  setSave(save: ProjectSaveState): void;

  /** Builds the next batch. */
  collect(): { batch: PublishBatch; sent: Sent };
  /** The batch went through; `hashes` as the host returned them (artifact paths). */
  acknowledge(sent: Sent, hashes: Record<string, string | null>): void;
  /** The batch was empty (nothing to publish). */
  unsent?(sent: Sent): void;
  /** Everything is saved (after the badge says so). */
  saved?(): void;
  /** The host refused the write (`not_writer`): go read-only and tell the person. */
  lostWriteAccess(): void;

  /** Remote changes, one pass at a time: `begin`, `file` per changed path (`undefined`: ignored), `end`. */
  remote: {
    begin(): Run;
    file(path: string, hash: string | null, run: Run): RemoteFile | undefined;
    end(run: Run): void;
  };
  /**
   * The artifact paths this tab holds files for. Catching up treats one the
   * listing no longer has as deleted (without it, deletions wait for the next push).
   */
  known?(): Iterable<string>;

  /** Calls `changed` after each local change (the store's revision moved). */
  watchChanges(changed: () => void): void;
  /** Calls `ended` when a text edit ends. */
  watchTextEdit(ended: () => void): void;
  /** Before a flush on unload with unsaved work. */
  beforeUnload?(): void;

  /** Timers (tests inject fakes). */
  timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** Where `beforeunload` is listened to (default `window`; none in node). */
  window?: Pick<Window, 'addEventListener'> | null;
}

/** A running sync (see {@link createProjectSync}). */
export interface ProjectSync {
  /** Listens to remote changes, local changes, text edits and unload. Call once, after loading. */
  start(): void;
  /** Schedules a save (default: the save delay). */
  schedule(delay?: number): void;
  /** Saves now (coalescing with a save already running). */
  flush(): Promise<void>;
  /**
   * Resolves once nothing is left unsaved: waits for a save already running,
   * then saves what is still dirty. Stops early when offline or read-only.
   */
  settle(): Promise<void>;
  /** Retries a failed save now, resetting the backoff. */
  retryNow(): void;
  /** Applies changes made elsewhere (path → new hash, `null`: deleted). `force` re-reads even known hashes and ignores text edits. */
  applyRemote(changes: Record<string, string | null>, options?: RemoteOptions): Promise<void>;
  /**
   * Merges what changed while this tab heard nothing: compares the listing with
   * the hashes it holds, reads every changed file, then merges them as pushed
   * changes. Saves wait meanwhile, so a save that has written but not returned
   * is never taken for someone else's change. A failed listing or read leaves
   * the project as it is. Runs by itself when the change stream starts again.
   */
  catchUp(): Promise<void>;
}

/** How {@link ProjectSync.applyRemote} reads. */
export interface RemoteOptions {
  /** Re-read even known hashes and ignore text edits. */
  force?: boolean;
  /** Texts already read, by path (read again otherwise). */
  contents?: ReadonlyMap<string, string>;
}

/** First offline retry delay, ms (doubles up to {@link OFFLINE_MAX_MS}). */
export const OFFLINE_FIRST_MS = 2_000;
/** Longest offline retry delay, ms. */
export const OFFLINE_MAX_MS = 30_000;

/** Creates the save and remote-change engine of one project. */
export function createProjectSync<Sent, Run>(options: ProjectSyncOptions<Sent, Run>): ProjectSync {
  const maxRetries = options.maxRetries ?? 4;
  const timers = options.timers ?? { set: (run: () => void, ms: number) => setTimeout(run, ms), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  let timer: unknown = null;
  let running = false;
  let again = false;
  /** The save in progress, if any. */
  let current: Promise<void> | null = null;
  let offlineDelay = OFFLINE_FIRST_MS;
  /** Paths whose remote change waits for a text edit to end. */
  const deferred = new Map<string, string | null>();
  /** A catch-up is running (saves wait for it); `catchUpAgain`: another was asked for meanwhile. */
  let catching: Promise<void> | null = null;
  let catchUpAgain = false;

  function schedule(delay = options.saveDelay): void {
    if (options.readOnly()) return;
    if (options.isDirty()) options.setSave(options.save() === 'offline' ? 'offline' : 'dirty');
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void flush();
    }, delay);
  }

  function flush(): Promise<void> {
    if (running || catching) {
      again = true;
      return Promise.resolve();
    }
    const run = saveNow();
    current = run;
    const done = () => {
      if (current === run) current = null;
    };
    run.then(done, done);
    return run;
  }

  async function settle(): Promise<void> {
    for (let round = 0; round <= maxRetries; round++) {
      if (catching) {
        await catching;
        continue;
      }
      if (current) {
        await current.catch(() => undefined);
        continue;
      }
      if (options.readOnly() || !options.isDirty()) return;
      await flush();
      if (options.save() === 'offline') return;
    }
  }

  async function saveNow(): Promise<void> {
    running = true;
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const { batch, sent } = options.collect();
        if (Object.keys(batch).length === 0) {
          options.unsent?.(sent);
          break;
        }
        options.setSave('saving');
        try {
          const result = await options.artifact().publish(batch);
          options.acknowledge(sent, result.hashes);
          offlineDelay = OFFLINE_FIRST_MS;
          break;
        } catch (error) {
          if (isArtifactError(error, 'conflict') && attempt < maxRetries) {
            await resolveConflicts(error.paths ?? []);
            continue;
          }
          if (isArtifactError(error, 'not_writer')) {
            options.lostWriteAccess();
            return;
          }
          // Offline or host error: keep the edits and retry with backoff.
          options.setSave('offline');
          offlineDelay = Math.min(offlineDelay * 2, OFFLINE_MAX_MS);
          schedule(offlineDelay);
          return;
        }
      }
    } finally {
      running = false;
    }
    const dirty = options.isDirty();
    if (again || dirty) {
      again = false;
      schedule(dirty ? options.saveDelay : 0);
    } else {
      options.setSave('saved');
      options.saved?.();
    }
  }

  /** Reads the files that lost a race and merges ours on top. */
  async function resolveConflicts(paths: readonly ConflictPath[]): Promise<void> {
    const changes: Record<string, string | null> = {};
    for (const conflict of paths) changes[conflict.path] = conflict.actual;
    await applyRemote(changes, { force: true });
  }

  async function applyRemote(changes: Record<string, string | null>, { force = false, contents }: RemoteOptions = {}): Promise<void> {
    const artifact = options.artifact();
    const run = options.remote.begin();
    for (const [path, hash] of Object.entries(changes)) {
      const file = options.remote.file(path, hash, run);
      if (!file) continue;
      if (!force && hash === file.hash) continue;
      if (!force && file.held) {
        deferred.set(path, hash);
        continue;
      }
      const text = hash === null ? null : contents?.get(path) ?? await artifact.readText(path).catch(() => null);
      file.apply(text, hash);
    }
    options.remote.end(run);
  }

  function catchUp(): Promise<void> {
    if (catching) {
      catchUpAgain = true;
      return catching;
    }
    const run = (async () => {
      try {
        do {
          catchUpAgain = false;
          await catchUpOnce();
        } while (catchUpAgain);
      } finally {
        catching = null;
        // Saves asked for meanwhile waited for this.
        if (again || options.isDirty()) {
          again = false;
          schedule(0);
        }
      }
    })();
    catching = run;
    return run;
  }

  async function catchUpOnce(): Promise<void> {
    // A save that has written but not returned still holds the old hashes here: wait it out.
    while (current) await current.catch(() => undefined);
    const artifact = options.artifact();
    if (!artifact.list) return;
    const probe = options.remote.begin();
    /** The hash this tab holds for a path (`undefined`: unknown), or `false` when the editor ignores the path. */
    const held = (path: string, hash: string | null): string | null | undefined | false => {
      const file = options.remote.file(path, hash, probe);
      return file ? file.hash : false;
    };
    let listing: Awaited<ReturnType<NonNullable<typeof artifact.list>>>;
    try {
      listing = await artifact.list();
    } catch {
      return; // Still unreachable: the next start of the stream tries again.
    }
    const changes: Record<string, string | null> = {};
    const before = new Map<string, string | null | undefined>();
    for (const path of new Set([...Object.keys(listing), ...(options.known?.() ?? [])])) {
      const hash = listing[path]?.sha256 ?? null;
      const ours = held(path, hash);
      // Ignored paths, files held at this hash, and absent files never had.
      if (ours === false || ours === hash || (hash === null && (ours === null || ours === undefined))) continue;
      changes[path] = hash;
      before.set(path, ours);
    }
    if (!Object.keys(changes).length) return;
    // Read everything first: a failed read must leave the project as it is.
    const contents = new Map<string, string>();
    try {
      for (const [path, hash] of Object.entries(changes)) if (hash !== null) contents.set(path, await artifact.readText(path));
    } catch {
      return;
    }
    // A pushed change that landed while reading is newer than what was read.
    for (const path of Object.keys(changes)) if (held(path, changes[path]!) !== before.get(path)) delete changes[path];
    await applyRemote(changes, { contents });
  }

  function start(): void {
    options.artifact().onChange((event) => {
      if (event.resync) void catchUp();
      else void applyRemote(event.changes);
    });
    options.watchChanges(() => schedule());
    // Merge deferred remote changes once a text edit ends.
    options.watchTextEdit(() => {
      if (!deferred.size) return;
      const changes = Object.fromEntries(deferred);
      deferred.clear();
      void applyRemote(changes);
    });
    const target = options.window === undefined ? globalThis.window : options.window;
    target?.addEventListener('beforeunload', (event) => {
      if (options.isDirty()) {
        options.beforeUnload?.();
        void flush();
        event.preventDefault();
      }
    });
  }

  return {
    start,
    schedule,
    flush,
    settle,
    retryNow() {
      offlineDelay = OFFLINE_FIRST_MS;
      schedule(0);
    },
    applyRemote,
    catchUp,
  };
}

/** What {@link readProject} read. */
export interface ProjectFiles {
  title: string;
  /** Each named file, `null` when absent. */
  files: Record<string, { text: string; hash: string } | null>;
  /** Each item file by its key. */
  items: Record<string, { text: string; hash: string }>;
}

/**
 * Reads the title, the listing, the named `files` and every item file (a path
 * `item` maps to a key; `undefined`: not an item), all at once. Rejects when
 * any read fails.
 */
export async function readProject(
  artifact: Pick<ArtifactCapability, 'title' | 'list' | 'readText'>,
  spec: { files: readonly string[]; item(path: string): string | null | undefined },
): Promise<ProjectFiles> {
  const [title, listing] = await Promise.all([artifact.title(), artifact.list()]);
  const items: ProjectFiles['items'] = {};
  const reads = Object.entries(listing).flatMap(([path, entry]) => {
    const key = spec.item(path);
    if (key === undefined || key === null) return [];
    return [
      (async () => {
        items[key] = { text: await artifact.readText(path), hash: entry.sha256 };
      })(),
    ];
  });
  const named = spec.files.map(async (path) => {
    const entry = listing[path];
    return [path, entry ? { text: await artifact.readText(path), hash: entry.sha256 } : null] as const;
  });
  const [read] = await Promise.all([Promise.all(named), ...reads]);
  return { title, files: Object.fromEntries(read), items };
}
