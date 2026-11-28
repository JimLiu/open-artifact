/**
 * Cropping an image or video note: the whole picture shows, dimmed outside
 * the frame; the frame's eight handles shrink it, the picture's corner dots
 * (shown after a press on the picture outside the frame) zoom it, a drag
 * anywhere moves it, ⌘/Ctrl + wheel or a pinch zooms at the pointer. The
 * draft is in services/note-crop.ts, which writes it on confirm.
 */

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { useLiveCamera } from '../services/camera-frame.ts';
import { endNoteCrop, patchNoteCrop, setCropDrag, useNoteCrop, zoomNoteCrop, type CropDraft } from '../services/note-crop.ts';
import { dragFrameEdge, EDGE_LABELS, intoNote, panPicture, ZOOM_LABELS, zoomFromCorner, type Box, type Corner, type Edge } from '../lib/note-crop.ts';

/** Presses on these do not end cropping: they handle it themselves (the bar's Crop button, its fold button). */
export const KEEPS_CROP = '[data-keeps-crop]';

const EDGES: Edge[] = ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw'];
const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];
const CURSOR: Record<Edge, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
/** Handle sizes in screen pixels: length, thickness, and the area that takes a press. */
const HANDLE = 12;
const THICK = 3;
const HIT = 20;
const SHORT_EDGE = 44;

export function NoteCropOverlay() {
  const draft = useNoteCrop((s) => s.draft);
  const note = useDocument((s) => (draft ? s.canvas.notes[draft.note] : undefined));
  const camera = useLiveCamera(draft !== null);
  const root = useRef<HTMLDivElement>(null);
  const grabbing = useRef(false);

  // A press anywhere else confirms the crop.
  useEffect(() => {
    if (!draft) return;
    const down = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (root.current?.contains(target) || target?.closest(KEEPS_CROP)) return;
      endNoteCrop('confirm');
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘/Ctrl + wheel and a trackpad pinch (Safari's gesture events) zoom at the pointer.
  useEffect(() => {
    const element = root.current;
    if (!draft || !element) return;
    const at = (clientX: number, clientY: number) => {
      const current = useNoteCrop.getState().draft;
      const n = current && useDocument.getState().canvas.notes[current.note];
      if (!n) return null;
      const z = useView.getState().camera.zoom;
      const rect = element.getBoundingClientRect();
      const local = intoNote(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2), n.rotate, z);
      return { x: (n.w ?? 320) / 2 + local.dx, y: (n.h ?? 240) / 2 + local.dy };
    };
    const wheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const point = at(event.clientX, event.clientY);
      if (point) zoomNoteCrop(Math.min(2, Math.max(0.5, Math.exp(-event.deltaY * 0.005))), point);
    };
    let lastScale = 1;
    const gesture = (event: Event): void => {
      const g = event as Event & { scale?: number; clientX?: number; clientY?: number };
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'gesturestart') lastScale = 1;
      const scale = g.scale ?? 1;
      const point = at(g.clientX ?? 0, g.clientY ?? 0);
      if (point && scale > 0) zoomNoteCrop(Math.min(2, Math.max(0.5, scale / lastScale)), point);
      lastScale = scale;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', gesture);
    element.addEventListener('gesturechange', gesture);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', gesture);
      element.removeEventListener('gesturechange', gesture);
    };
  }, [draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft || !note) return null;
  const z = camera.zoom;
  const w = note.w ?? 320;
  const h = note.h ?? 240;
  const { frame, picture } = draft;
  const s = (box: Box) => ({ left: box.x * z, top: box.y * z, width: box.w * z, height: box.h * z });

  /** Follows a drag of the pointer, in the note's space, until release; cancel puts the draft back. */
  const follow = (event: ReactPointerEvent, move: (dx: number, dy: number, start: CropDraft) => void, handle = true): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = useNoteCrop.getState().draft!;
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic press has no pointer to capture.
    }
    const x0 = event.clientX;
    const y0 = event.clientY;
    const onMove = (e: PointerEvent): void => {
      const d = intoNote(e.clientX - x0, e.clientY - y0, note.rotate, useView.getState().camera.zoom);
      move(d.dx, d.dy, start);
    };
    const stop = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', restore);
      grabbing.current = false;
      root.current?.style.setProperty('cursor', 'grab');
      setCropDrag(null);
    };
    const restore = (): void => {
      patchNoteCrop({ frame: start.frame, picture: start.picture });
      stop();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', restore);
    if (handle) setCropDrag(restore);
  };

  const pan = (event: ReactPointerEvent): void => {
    const rect = root.current!.getBoundingClientRect();
    const p = intoNote(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2), note.rotate, z);
    const x = w / 2 + p.dx;
    const y = h / 2 + p.dy;
    const inFrame = x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h;
    patchNoteCrop({ zoomHandles: !inFrame });
    grabbing.current = true;
    root.current?.style.setProperty('cursor', 'grabbing');
    follow(event, (dx, dy, start) => patchNoteCrop({ picture: panPicture(start.picture, start.frame, dx, dy) }), false);
  };

  const edgeAt = (edge: Edge) => {
    const x = edge.includes('w') ? frame.x : edge.includes('e') ? frame.x + frame.w : frame.x + frame.w / 2;
    const y = edge.includes('n') ? frame.y : edge.includes('s') ? frame.y + frame.h : frame.y + frame.h / 2;
    return { x: x * z, y: y * z };
  };

  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{
        transform: `translate(${note.x * z + camera.x}px, ${note.y * z + camera.y}px)`,
      }}
    >
      <div
        ref={root}
        role="group"
        aria-label="Crop"
        data-note-crop={draft.note}
        className="pointer-events-auto absolute left-0 top-0 touch-none"
        style={{ width: w * z, height: h * z, transform: note.rotate ? `rotate(${note.rotate}deg)` : undefined, cursor: 'grab' }}
        onPointerDown={pan}
      >
        {/* The whole picture, dimmed; the frame shows its part at full strength. */}
        <img src={draft.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ ...s(picture), opacity: 0.35 }} />
        <div className="pointer-events-none absolute overflow-hidden" style={s(frame)}>
          <img src={draft.src} alt="" draggable={false} className="absolute max-w-none select-none" style={s({ ...picture, x: picture.x - frame.x, y: picture.y - frame.y })} />
        </div>
        {draft.zoomHandles ? <div className="pointer-events-none absolute outline outline-1 outline-accent" style={s(picture)} /> : null}
        <div className="pointer-events-none absolute outline outline-2 outline-accent" style={s(frame)} />
        {EDGES.map((edge) => {
          const corner = edge.length === 2;
          const across = edge === 'n' || edge === 's';
          const along = edge === 'e' || edge === 'w';
          // An edge too short on screen keeps only its corners.
          if ((across && frame.w * z < SHORT_EDGE) || (along && frame.h * z < SHORT_EDGE)) return null;
          const p = edgeAt(edge);
          const long = corner ? HANDLE : HANDLE * 1.5;
          return (
            <div
              key={edge}
              role="img"
              aria-label={EDGE_LABELS[edge]}
              title="Drag to crop."
              data-crop-edge={edge}
              className="absolute"
              style={{ left: p.x - HIT / 2, top: p.y - HIT / 2, width: HIT, height: HIT, cursor: CURSOR[edge] }}
              onPointerDown={(event) => {
                patchNoteCrop({ zoomHandles: false });
                follow(event, (dx, dy, start) => patchNoteCrop({ frame: dragFrameEdge(start.frame, start.picture, edge, dx, dy) }));
              }}
            >
              {corner ? (
                <>
                  <span className="absolute bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]" style={{ width: HANDLE, height: THICK, top: HIT / 2 - THICK / 2, left: edge.includes('w') ? HIT / 2 - THICK / 2 : HIT / 2 - HANDLE + THICK / 2 }} />
                  <span className="absolute bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]" style={{ width: THICK, height: HANDLE, left: HIT / 2 - THICK / 2, top: edge.includes('n') ? HIT / 2 - THICK / 2 : HIT / 2 - HANDLE + THICK / 2 }} />
                </>
              ) : (
                <span className="absolute bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]" style={{ width: across ? long : THICK, height: across ? THICK : long, left: HIT / 2 - (across ? long : THICK) / 2, top: HIT / 2 - (across ? THICK : long) / 2 }} />
              )}
            </div>
          );
        })}
        {draft.zoomHandles
          ? CORNERS.map((corner) => {
              const x = (corner.includes('w') ? picture.x : picture.x + picture.w) * z;
              const y = (corner.includes('n') ? picture.y : picture.y + picture.h) * z;
              return (
                <div
                  key={corner}
                  role="img"
                  aria-label={ZOOM_LABELS[corner]}
                  title="Drag to zoom."
                  data-crop-zoom={corner}
                  className="absolute flex items-center justify-center"
                  style={{ left: x - HIT / 2, top: y - HIT / 2, width: HIT, height: HIT, cursor: CURSOR[corner] }}
                  onPointerDown={(event) =>
                    follow(event, (dx, dy, start) => {
                      const from = start.picture;
                      const px = (corner.includes('w') ? from.x : from.x + from.w) + dx;
                      const py = (corner.includes('n') ? from.y : from.y + from.h) + dy;
                      patchNoteCrop({ picture: zoomFromCorner(from, start.frame, start.natural, corner, px, py) });
                    })
                  }
                >
                  <span className="size-2.5 rounded-full border border-accent bg-white" />
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}
