/**
 * Node editing of the one selected line, arrow or path note: its anchors
 * (squares) and, on paths, their bezier handles (circles) are drawn over the
 * canvas and can be dragged. Between anchors a small dot splits the segment.
 *
 * - drag an anchor or handle (Alt on a handle: move it alone, breaking the
 *   symmetry);
 * - Alt-click an anchor of a path: toggle corner / smooth;
 * - double-click an anchor: remove it (two are always kept).
 *
 * A drag is one undo step (a canvas gesture). Freehand (Pencil) strokes have
 * no nodes and keep the ordinary resize box.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { isLockedObject, type CanvasNote } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { announce } from '../services/announce.ts';
import { bezierPathData, dragNode, editableNodes, notePatchForNodes, removeNode, splitSegment, toggleSmooth, type BezierNode, type NodePart } from '../lib/bezier.ts';

/** The note being node-edited, if the selection is exactly one editable note (locked ones have no nodes to drag). */
function useEditedNote(): { id: string; note: CanvasNote; nodes: BezierNode[] } | null {
  const id = useView((s) => (s.selection.kind === 'objects' && s.selection.boards.length === 0 && s.selection.notes.length === 1 && s.tool === 'select' && !s.noteEdit ? s.selection.notes[0]! : null));
  const note = useDocument((s) => (id && !s.readOnly ? s.canvas.notes[id] : undefined));
  if (!id || !note || isLockedObject(note)) return null;
  const nodes = editableNodes(note);
  return nodes ? { id, note, nodes } : null;
}

function writeNodes(id: string, nodes: BezierNode[]): void {
  useDocument.getState().updateCanvas((canvas) => {
    const note = canvas.notes[id];
    if (!note) return canvas;
    return { ...canvas, notes: { ...canvas.notes, [id]: { ...note, ...notePatchForNodes(note, nodes) } } };
  });
}

export function NodeEditor() {
  const camera = useView((s) => s.camera);
  const edited = useEditedNote();
  const drag = useRef<{ index: number; part: NodePart; x: number; y: number; start: BezierNode[]; moved: boolean } | null>(null);
  if (!edited) return null;
  const { id, note, nodes } = edited;
  const closed = note.closed === true;
  const path = note.kind === 'pen';
  const at = (x: number, y: number) => ({ x: (note.x + x) * camera.zoom + camera.x, y: (note.y + y) * camera.zoom + camera.y });

  const begin = (index: number, part: NodePart) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (part === 'anchor' && event.altKey && path) {
      writeNodes(id, toggleSmooth(nodes, index, closed));
      announce(nodes[index]?.in || nodes[index]?.out ? 'Corner point' : 'Smooth point');
      return;
    }
    const doc = useDocument.getState();
    doc.beginGesture();
    const zoom = camera.zoom;
    drag.current = { index, part, x: event.clientX, y: event.clientY, start: nodes, moved: false };
    const move = (e: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      d.moved = true;
      writeNodes(id, dragNode(d.start, d.index, d.part, (e.clientX - d.x) / zoom, (e.clientY - d.y) / zoom, e.altKey));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      drag.current = null;
      useDocument.getState().endGesture();
      useView.getState().tick();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const segments = closed && nodes.length > 2 ? nodes.length : nodes.length - 1;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" role="group" aria-label="Path points">
      <path d={bezierPathData(nodes, closed, at)} fill="none" stroke="var(--color-accent)" strokeWidth={1} />
      {/* Segment midpoints: click to add a point. */}
      {Array.from({ length: segments }, (_, i) => {
        const a = nodes[i]!;
        const b = nodes[(i + 1) % nodes.length]!;
        const mid = splitSegment([a, b], 0)[1]!;
        const p = at(mid.x, mid.y);
        return (
          <circle
            key={`m${i}`}
            role="button"
            aria-label="Add a point here"
            cx={p.x}
            cy={p.y}
            r={3}
            className="pointer-events-auto cursor-copy"
            fill="var(--color-accent)"
            fillOpacity={0.5}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              writeNodes(id, splitSegment(nodes, i, closed));
              announce('Point added');
            }}
          />
        );
      })}
      {nodes.map((node, i) => {
        const p = at(node.x, node.y);
        return (
          <g key={i}>
            {(['in', 'out'] as const).map((part) => {
              const handle = node[part];
              if (!handle || !path) return null;
              const h = at(node.x + handle[0], node.y + handle[1]);
              return (
                <g key={part}>
                  <line x1={p.x} y1={p.y} x2={h.x} y2={h.y} stroke="var(--color-accent)" strokeWidth={1} />
                  <circle role="slider" aria-label={`Point ${i + 1} ${part === 'in' ? 'incoming' : 'outgoing'} handle`} aria-valuenow={0} cx={h.x} cy={h.y} r={4} fill="white" stroke="var(--color-accent)" strokeWidth={1.5} className="pointer-events-auto cursor-move" onPointerDown={begin(i, part)} />
                </g>
              );
            })}
            <rect
              role="slider"
              aria-label={`Point ${i + 1}`}
              aria-valuenow={0}
              x={p.x - 4.5}
              y={p.y - 4.5}
              width={9}
              height={9}
              fill="white"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              className="pointer-events-auto cursor-move"
              onPointerDown={begin(i, 'anchor')}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (nodes.length <= 2) return;
                writeNodes(id, removeNode(nodes, i));
                announce('Point removed');
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
