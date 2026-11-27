/**
 * The points of the artboard path being edited (services/path-edit.ts),
 * drawn over the canvas: drag an anchor or handle (Alt on a handle moves it
 * alone), Alt-click an anchor to make it a corner or smooth, click a
 * segment's dot to add a point, double-click an anchor to remove it.
 * Escape, or a press anywhere else, ends the edit.
 */

import { useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { dragNode, removeNode, splitSegment, toggleSmooth, type NodePart } from '../lib/bezier.ts';
import { applyMatrix, inverseMove, type PathRun } from '../lib/path-points.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { announce } from '../services/announce.ts';
import { endPathEdit, followPathSource, usePathEdit, writePath } from '../services/path-edit.ts';
import { NodePoints } from './NodeEditor.tsx';

export function PathPoints() {
  const edit = usePathEdit((s) => s.edit);
  const camera = useView((s) => s.camera);
  const entry = useDocument((s) => (edit ? s.canvas.boards[edit.board] : undefined));
  const source = useDocument((s) => (edit ? s.boards[edit.board]?.source : undefined));
  const editing = edit !== null;

  useEffect(() => followPathSource(source), [source]);

  useEffect(() => {
    if (!editing) return;
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      endPathEdit();
    };
    const press = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-path-points]')) endPathEdit();
    };
    // Another selection, tool, page or view ends it too.
    const stop = useView.subscribe((state, before) => {
      if (state.selection !== before.selection || state.tool !== before.tool || state.mode !== before.mode || state.page !== before.page) endPathEdit();
    });
    const listening = new AbortController();
    window.addEventListener('keydown', key, { capture: true, signal: listening.signal });
    window.addEventListener('pointerdown', press, { capture: true, signal: listening.signal });
    return () => {
      listening.abort();
      stop();
    };
  }, [editing]);

  if (!edit || !entry) return null;
  const back = inverseMove(edit.matrix);
  if (!back) return null;
  const at = (x: number, y: number) => {
    const p = applyMatrix(edit.matrix, x, y);
    return { x: (entry.x + p.x) * camera.zoom + camera.x, y: (entry.y + p.y) * camera.zoom + camera.y };
  };
  const withRun = (runs: readonly PathRun[], index: number, run: PathRun): PathRun[] => runs.map((r, i) => (i === index ? run : r));

  const grab = (r: number) => (index: number, part: NodePart, event: ReactPointerEvent): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const start = edit.runs;
    const run = start[r]!;
    if (part === 'anchor' && event.altKey) {
      writePath(withRun(start, r, { ...run, nodes: toggleSmooth(run.nodes, index, run.closed) }), `path-points:${Date.now()}`);
      announce(run.nodes[index]?.in || run.nodes[index]?.out ? 'Corner point' : 'Smooth point');
      return;
    }
    const key = `path-points:${Date.now()}`;
    const zoom = camera.zoom;
    const from = { x: event.clientX, y: event.clientY };
    const move = (e: PointerEvent): void => {
      const [dx, dy] = back((e.clientX - from.x) / zoom, (e.clientY - from.y) / zoom);
      writePath(withRun(start, r, { ...run, nodes: dragNode(run.nodes, index, part, dx, dy, e.altKey) }), key);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <svg className="pointer-events-none absolute inset-0 size-full" role="group" aria-label="Path points" data-path-points="">
      {edit.runs.map((run, r) => (
        <NodePoints
          key={r}
          nodes={run.nodes}
          closed={run.closed}
          curves
          at={at}
          onGrab={grab(r)}
          onSplit={(index) => {
            writePath(withRun(edit.runs, r, { ...run, nodes: splitSegment(run.nodes, index, run.closed) }), `path-points:${Date.now()}`);
            announce('Point added');
          }}
          onRemove={(index) => {
            writePath(withRun(edit.runs, r, { ...run, nodes: removeNode(run.nodes, index) }), `path-points:${Date.now()}`);
            announce('Point removed');
          }}
        />
      ))}
    </svg>
  );
}
