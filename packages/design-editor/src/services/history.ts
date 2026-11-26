/**
 * Version history of the design: the Design adapter of the shared history
 * controller (`@open-artifact/editor-kit`, history.ts). A preview of a version is its
 * canvas.json and its artboards' files (drawn by `HistoryPreview`). One
 * artboard can be restored on its own, with its place on the canvas when
 * it is no longer there.
 */

import { normalizeCanvas, type Canvas } from '@open-artifact/design-core';
import { useCapability } from '@open-artifact/runtime';
import { toast } from '@open-artifact/ui';
import { createHistory } from '@open-artifact/editor-kit';
import { useDocument } from '../state/document.ts';
import { artifactPath, session } from './session.ts';
import { settle } from './sync.ts';

/** A version loaded for preview. */
export interface VersionPreview {
  n: number;
  canvas: Canvas;
  /** Artboard sources by project path. */
  boards: Record<string, string>;
}

/** The design's history. */
export const designHistory = createHistory<VersionPreview>({
  noun: 'design',
  notify: (message) => toast.add(message),
  // Edits not written yet go out first: a restore must not be overwritten by them.
  settle,
  async loadPreview(history, n) {
    const files = await history.files(n);
    const canvasText = files['project/canvas.json'] ? await history.read(n, 'project/canvas.json') : null;
    const canvas = normalizeCanvas(canvasText ? JSON.parse(canvasText) : {});
    // Artboards on the canvas of that version (their sources load in parallel).
    const paths = Object.keys(canvas.boards).filter((path) => files[artifactPath(path)]);
    const texts = await Promise.all(paths.map((path) => history.read(n, artifactPath(path)).catch(() => null)));
    const boards: Record<string, string> = {};
    paths.forEach((path, i) => {
      if (texts[i] != null) boards[path] = texts[i]!;
    });
    return { n, canvas, boards };
  },
});

/** The history store. */
export const useHistory = designHistory.store;
/** The history capability, once {@link startHistory} found it. */
export const historyCapability = designHistory.capability;
/** Opens or closes the panel. */
export const toggleHistory = designHistory.toggle;
/** Shows version `n` read-only (`null`: back to the current files). */
export const previewVersion = designHistory.preview;
/** Restores the whole version. */
export const restoreVersion = designHistory.restore;

/** Finds the capability. */
export async function startHistory(): Promise<void> {
  designHistory.start(await useCapability('history'));
}

/** Reads another artboard of the previewed version (`<dc-import>`), else the current one. */
export async function previewSource(path: string): Promise<string> {
  const preview = useHistory.getState().preview;
  const history = historyCapability();
  if (preview?.boards[path] != null) return preview.boards[path]!;
  if (preview && history) {
    try {
      return await history.read(preview.n, artifactPath(path));
    } catch {
      // Not in that version: the current file, if any.
    }
  }
  return session().artifact.readText(artifactPath(path));
}

/**
 * Restores one artboard as version `n` left it: its file, and its place on
 * the canvas when it is no longer there.
 */
export async function restoreBoard(n: number, path: string): Promise<void> {
  const name = path.replace(/\.dc\.html$/, '');
  const changed = await designHistory.restorePaths(n, [artifactPath(path)], 'The artboard');
  if (!changed) return;
  const preview = useHistory.getState().preview;
  const entry = preview?.n === n ? preview.canvas.boards[path] : undefined;
  const doc = useDocument.getState();
  const readd = Boolean(entry && !doc.canvas.boards[path] && !doc.readOnly);
  if (entry && readd) {
    doc.updateCanvas((canvas) => ({
      ...canvas,
      boards: { ...canvas.boards, [path]: { ...entry, ...(entry.page && !canvas.pages.some((p) => p.id === entry.page) ? { page: undefined } : {}) } },
      order: canvas.order.includes(path) ? canvas.order : [...canvas.order, path],
    }));
  }
  toast.add({ title: changed.length || readd ? `Restored ${name} from version ${n}` : `${name} already matches version ${n}` });
}
