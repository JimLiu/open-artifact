/**
 * Version history on the design: the shared panel and preview frame
 * (`@open-artifact/editor-kit`, HistoryViews.tsx) with what the design draws of a version.
 *
 * The preview draws the version's own canvas.json: its artboards rendered
 * from that version's files (static, no interaction) and its notes, on the
 * page the viewer is on (or the version's first page). Each artboard can
 * be restored on its own; the banner restores the whole version or goes
 * back to the current one.
 */

import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { NoteStill } from './NotePicture.tsx';
import type { BoardBoot } from '@open-artifact/dc';
import { boardsOnPage, notesOnPage, unionRect, type BoardEntry, type Canvas, type CanvasNote } from '@open-artifact/design-core';
import { cn } from '@open-artifact/ui';
import { HistoryAside as SharedAside, VersionPreview } from '@open-artifact/editor-kit/react';
import { frameDocument } from '../lib/frame.ts';
import { DEFAULT_STICKY, dashArray, noteBounds, noteColor } from '../lib/notes.ts';
import { noteRect } from '../lib/scene.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { designHistory, previewSource, restoreBoard, type VersionPreview as DesignVersion } from '../services/history.ts';
import { session } from '../services/session.ts';

/** The history panel, on the right. */
export function HistoryAside(): ReactNode {
  return <SharedAside history={designHistory} viewerId={session().viewer.id} />;
}

/** Absolute URLs the frame document needs (as `BoardFrame`). */
const urls = () => ({ runtime: new URL('support.js', location.href).toString(), project: new URL('project/', location.href).toString() });

/** One artboard of a past version, rendered static. */
function PreviewBoard({ path, source, entry }: { path: string; source: string; entry: BoardEntry }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const boot: BoardBoot = { path, source, mode: 'static', props: {}, load: previewSource, report: () => undefined };
    iframe.__dcBoot = boot;
    iframe.srcdoc = frameDocument(path, source, urls(), { canvas: true });
  }, [path, source]);
  return <iframe ref={ref} title={`${path} (earlier version)`} sandbox="allow-scripts allow-same-origin" className="pointer-events-none block border-0 bg-white" style={{ width: entry.w, height: entry.h }} />;
}

/** A note of a past version: its box, text and stroke, simplified. */
function PreviewNote({ note }: { note: CanvasNote }) {
  const stroke = noteColor(note.color, 'stroke', '#1f1f1f');
  if ((note.kind === 'pen' || note.kind === 'line' || note.kind === 'arrow') && note.points?.length) {
    const b = noteBounds(note);
    const points = note.points.map(([x, y]) => `${note.x + x - b.x},${note.y + y - b.y}`).join(' ');
    return (
      <svg className="pointer-events-none absolute overflow-visible" style={{ left: b.x, top: b.y, width: Math.max(1, b.w), height: Math.max(1, b.h) }}>
        <polyline points={points} fill="none" stroke={stroke} strokeWidth={note.stroke ?? 3} strokeDasharray={dashArray(note.dash, note.stroke ?? 3)} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const r = noteRect(note);
  if (note.kind === 'image' && note.src) {
    const turn = note.rotate || note.flipX || note.flipY ? `rotate(${note.rotate ?? 0}deg) scale(${note.flipX ? -1 : 1},${note.flipY ? -1 : 1})` : undefined;
    return (
      <div className="pointer-events-none absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h, transform: turn }}>
        <NoteStill note={note} />
      </div>
    );
  }
  const shape = note.kind === 'rect' || note.kind === 'oval';
  const title = note.kind === 'title1';
  return (
    <div
      className={cn('pointer-events-none absolute overflow-hidden whitespace-pre-wrap break-words p-2 text-[14px] leading-snug text-[#1f1f1f]', title && 'p-0 text-[28px] font-semibold', note.kind === 'oval' && 'rounded-[50%]')}
      style={{
        left: r.x,
        top: r.y,
        width: r.w,
        minHeight: title ? undefined : r.h,
        background: title ? undefined : shape ? (note.fill ? noteColor(note.fill, 'sticky', 'transparent') : 'transparent') : noteColor(note.fill, 'sticky', DEFAULT_STICKY),
        border: shape ? `2px solid ${stroke}` : undefined,
      }}
    >
      {note.text}
    </div>
  );
}

/** The page of a version to show: the viewer's page if that version has it, else its first. */
function pageIn(canvas: Canvas, viewPage: string | null): string | null {
  return canvas.pages.some((p) => p.id === viewPage) ? viewPage : (canvas.pages[0]?.id ?? null);
}

/** The read-only preview of a past version, over the canvas: that version's artboards and notes on the viewer's page. */
export function HistoryPreview(): ReactNode {
  const readOnly = useDocument((s) => s.readOnly);
  const currentBoards = useDocument((s) => s.canvas.boards);
  const viewPage = useView((s) => s.page);
  const preview = designHistory.store((s) => s.preview);
  const shown = useMemo(() => {
    if (!preview) return { boards: [] as string[], notes: [] as string[] };
    const page = pageIn(preview.canvas, viewPage);
    return { boards: boardsOnPage(preview.canvas, page), notes: notesOnPage(preview.canvas, page) };
  }, [preview, viewPage]);

  return (
    <VersionPreview<DesignVersion>
      history={designHistory}
      readOnly={readOnly}
      fitKey={shown}
      bounds={(p) => unionRect([...shown.boards.map((path) => p.canvas.boards[path]!), ...shown.notes.map((id) => noteRect(p.canvas.notes[id]!))])}
      emptyText={(n) => `This page was empty in version ${n}.`}
      renderWorld={(p) => (
        <>
          {shown.boards.map((path) => {
            const entry = p.canvas.boards[path]!;
            const source = p.boards[path];
            return (
              <div
                key={path}
                className="absolute overflow-hidden bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.06)]"
                style={{ left: entry.x, top: entry.y, width: entry.w, height: entry.h, borderRadius: entry.radius }}
              >
                {source != null ? <PreviewBoard path={path} source={source} entry={entry} /> : <div className="flex size-full items-center justify-center text-xs text-fg-subtle">No file in this version</div>}
              </div>
            );
          })}
          {shown.notes.map((id) => (
            <PreviewNote key={id} note={p.canvas.notes[id]!} />
          ))}
        </>
      )}
      renderOverlay={(p, camera, n, restorable) =>
        shown.boards.map((path) => {
          const entry = p.canvas.boards[path]!;
          return (
            <div key={path} className="absolute flex max-w-[60vw] items-center gap-1.5 text-[12px] text-fg-muted" style={{ left: entry.x * camera.zoom + camera.x, top: entry.y * camera.zoom + camera.y - 24 }}>
              <span className="truncate">{entry.title || path.replace(/\.dc\.html$/, '')}</span>
              {!currentBoards[path] ? <span className="rounded bg-warning/15 px-1 text-[11px] text-warning">deleted since</span> : null}
              {restorable && p.boards[path] != null ? (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void restoreBoard(n, path)}
                >
                  Restore artboard
                </button>
              ) : null}
            </div>
          );
        })
      }
    />
  );
}
