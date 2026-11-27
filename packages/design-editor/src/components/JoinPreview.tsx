/**
 * While notes or pieces are dragged over an artboard they can join: the
 * artboard glows, each dragged thing gets a ring, and a line shows where a
 * single one would go in flow.
 */

import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { useJoin } from '../services/join.ts';

export function JoinPreview() {
  const preview = useJoin((s) => s.preview);
  const camera = useView((s) => s.camera);
  const entry = useDocument((s) => (preview ? s.canvas.boards[preview.target] : undefined));
  if (!preview || !entry) return null;
  const at = (x: number, y: number) => ({ x: x * camera.zoom + camera.x, y: y * camera.zoom + camera.y });
  const box = at(entry.x, entry.y);
  const { drop } = preview;
  const a = drop?.line ? at(drop.line.x1, drop.line.y1) : null;
  const b = drop?.line ? at(drop.line.x2, drop.line.y2) : null;
  const outline = drop?.outline;
  const into = outline ? at(outline.x, outline.y) : null;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" data-join-target={preview.target}>
      <rect
        x={box.x - 3}
        y={box.y - 3}
        width={entry.w * camera.zoom + 6}
        height={entry.h * camera.zoom + 6}
        rx={4}
        fill="none"
        stroke="var(--color-accent)"
        strokeOpacity={0.45}
        strokeWidth={6}
      />
      {preview.rings.map((ring, index) => {
        const corner = at(ring.x, ring.y);
        return <rect key={index} x={corner.x} y={corner.y} width={ring.w * camera.zoom} height={ring.h * camera.zoom} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />;
      })}
      {outline && into && !a ? <rect x={into.x} y={into.y} width={outline.w * camera.zoom} height={outline.h * camera.zoom} fill="none" stroke="var(--color-accent)" strokeDasharray="4 3" strokeWidth={1} /> : null}
      {a && b ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="round" /> : null}
    </svg>
  );
}
