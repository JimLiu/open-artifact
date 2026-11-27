/**
 * Loading, autosave and remote changes.
 *
 * - Load: `canvas.json` and every `.dc.html` of the project.
 * - Save: shortly after each local change, one publish batch with `ifMatch`
 *   on every file. A conflict means someone else wrote first: their files are
 *   read, ours are merged on top (canvas: three-way; artboards: pending
 *   operations replayed) and the save retries.
 * - Remote changes: pushed by the host; merged the same way. An artboard
 *   being text-edited is merged when the edit ends. Changes made while the
 *   host's stream was down are caught up when it starts again.
 *
 * The timing, retries and deferral are editor-kit's `createProjectSync`; this
 * file says what a project writes and how its files merge.
 */

import { createProjectSync, readProject, type RemoteFile } from '@open-artifact/editor-kit';
import type { PublishBatch } from '@open-artifact/runtime';
import { serializeCanvas } from '@open-artifact/design-core';
import { toast } from '@open-artifact/ui';
import { boardNeedsWrite, isDirty, useDocument, type SentBatch } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { invalidateAll } from './frames.ts';
import { artifactPath, projectPath, session } from './session.ts';
import { remoteCanvasChanged } from './follow.ts';

/** Delay between the last change and the save, ms. */
const SAVE_DELAY = 600;
const CANVAS_PATH = 'project/canvas.json';

/** One pass of remote changes. */
interface RemoteRun {
  textEdit: ReturnType<typeof useView.getState>['textEdit'];
  changedBoards: string[];
  dropped: number;
}

const sync = createProjectSync<SentBatch, RemoteRun>({
  artifact: () => session().artifact,
  saveDelay: SAVE_DELAY,
  readOnly: () => useDocument.getState().readOnly,
  isDirty: () => isDirty(useDocument.getState()),
  save: () => useDocument.getState().save,
  setSave: (save) => useDocument.getState().setSave(save),
  collect,
  acknowledge(sent, hashes) {
    useDocument.getState().acknowledge(sent, Object.fromEntries(Object.entries(hashes).map(([path, hash]) => [projectPath(path) ?? path, hash])));
  },
  lostWriteAccess() {
    useDocument.setState({ readOnly: true, save: 'readonly' });
    toast.add({ title: 'You can no longer edit this design', description: 'Your changes since the last save were not saved.' });
  },
  known: () => [CANVAS_PATH, ...Object.keys(useDocument.getState().boards).map(artifactPath)],
  remote: {
    begin: () => ({ textEdit: useView.getState().textEdit, changedBoards: [], dropped: 0 }),
    file: remoteFile,
    end({ changedBoards, dropped }) {
      if (changedBoards.length) invalidateAll(changedBoards);
      if (dropped > 0) {
        toast.add({
          title: 'Merged with a newer version',
          description: `${dropped} of your edits no longer applied to the updated artboard and were dropped.`,
        });
      }
    },
  },
  watchChanges(changed) {
    useDocument.subscribe((state, previous) => {
      if (state.revision !== previous.revision) changed();
    });
  },
  watchTextEdit(ended) {
    useView.subscribe((state, previous) => {
      if (previous.textEdit && !state.textEdit) ended();
    });
  },
});

/** Loads the project into the document store. */
export async function loadProject(): Promise<void> {
  const { artifact, canEdit } = session();
  const store = useDocument.getState();
  try {
    const { title, files, items: boards } = await readProject(artifact, {
      files: [CANVAS_PATH],
      item: (path) => (path.endsWith('.dc.html') ? projectPath(path) : undefined),
    });
    const canvas = files[CANVAS_PATH];
    store.load({ title, readOnly: !canEdit, canvas: { text: canvas?.text ?? null, hash: canvas?.hash ?? null }, boards });
  } catch (error) {
    store.fail(error instanceof Error ? error.message : String(error));
    return;
  }
  sync.start();
}

/** Schedules a save. */
export function schedule(delay = SAVE_DELAY): void {
  sync.schedule(delay);
}

/** Saves now (coalescing with a save already running). */
export function flush(): Promise<void> {
  return sync.flush();
}

/** Resolves once every edit so far is saved (waiting out a save already running). */
export function settle(): Promise<void> {
  return sync.settle();
}

/**
 * Applies changes made elsewhere. `changes` maps artifact paths to their new
 * hash (`null`: deleted). Changes we already have are skipped.
 */
export function applyRemote(changes: Record<string, string | null>, options: { force?: boolean } = {}): Promise<void> {
  return sync.applyRemote(changes, options);
}

/** Builds the next publish batch from the store. */
function collect(): { batch: PublishBatch; sent: SentBatch } {
  const state = useDocument.getState();
  const batch: PublishBatch = {};
  const sent: SentBatch = { canvas: null, boards: {}, deleted: [] };
  if (state.canvas !== state.canvasSaved && !state.canvasError) {
    const text = serializeCanvas(state.canvas);
    batch[CANVAS_PATH] = { content: text, ifMatch: state.canvasHash };
    sent.canvas = { canvas: state.canvas, text };
  }
  for (const [path, board] of Object.entries(state.boards)) {
    if (!boardNeedsWrite(state, path, board) || board.source === null) continue;
    // A deleted artboard is only written again once it is back on the canvas.
    if (state.trash.includes(path) && !(path in state.canvas.boards)) continue;
    batch[artifactPath(path)] = { content: board.source, ifMatch: board.hash };
    sent.boards[path] = { source: board.source, pendingCount: board.pending.length };
  }
  for (const path of state.trash) {
    if (path in state.canvas.boards || !state.boards[path]?.hash) continue;
    batch[artifactPath(path)] = null;
    sent.deleted.push(path);
  }
  return { batch, sent };
}

/** How one changed file of the project is taken. */
function remoteFile(path: string, _hash: string | null, run: RemoteRun): RemoteFile | undefined {
  const project = projectPath(path);
  if (!project) return undefined;
  const state = useDocument.getState();
  if (project === 'canvas.json') {
    return {
      hash: state.canvasHash,
      apply(text, hash) {
        useDocument.getState().remoteCanvas(text, hash);
        remoteCanvasChanged();
      },
    };
  }
  if (!project.endsWith('.dc.html')) return undefined;
  return {
    hash: state.boards[project]?.hash,
    held: run.textEdit?.board === project,
    apply(text, hash) {
      run.dropped += useDocument.getState().remoteBoard(project, text, text === null ? null : hash);
      run.changedBoards.push(project);
    },
  };
}
