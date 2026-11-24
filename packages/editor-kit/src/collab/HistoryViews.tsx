/**
 * Version history on the page, for any editor: the panel (`HistoryPanel`
 * from the UI package) on the right, and the frame of a read-only preview
 * of a past version over the editor: its banner (restore it, back to the
 * latest), a pan-and-zoom surface fitted to what the editor draws, Esc to
 * leave.
 *
 * Editor-agnostic: the editor draws
 * the version's content in world px (`renderWorld`) and anything that
 * follows it on screen (`renderOverlay`).
 */

import { localize } from '@open-artifact/runtime';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { Button, ConfirmDialog, HistoryPanel } from '@open-artifact/ui';
import type { HistoryController } from './history.ts';
import type { Box, Camera } from './pins.ts';

/** The history panel, on the right. */
export function HistoryAside<P>({ history, viewerId }: { history: HistoryController<P>; viewerId: string }): ReactNode {
  const previewing = history.store((s) => s.previewing);
  const capability = history.capability();
  if (!capability) return null;
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface" aria-label={localize('Version history', '版本历史')}>
      <HistoryPanel
        className="min-h-0 flex-1"
        history={capability}
        viewerId={viewerId}
        previewing={previewing}
        onPreview={(n) => void history.preview(n)}
        onClose={() => history.toggle(false)}
      />
    </aside>
  );
}

/** Pixels around the fitted content. */
const FIT_MARGIN = 80;

/** A camera that shows `rect` whole (at most 100%) in a `w` × `h` viewport. */
export function fitCamera(rect: Box | null, w: number, h: number, margin = FIT_MARGIN): Camera {
  if (!rect) return { x: w / 2, y: h / 2, zoom: 1 };
  const zoom = Math.max(0.02, Math.min(1, (w - margin * 2) / Math.max(1, rect.w), (h - margin * 2) / Math.max(1, rect.h)));
  return { zoom, x: w / 2 - (rect.x + rect.w / 2) * zoom, y: h / 2 - (rect.y + rect.h / 2) * zoom };
}

export interface VersionPreviewProps<P> {
  history: HistoryController<P>;
  /** The viewer cannot edit (no restore, no "go back to edit" hint). */
  readOnly: boolean;
  /** World bounds of what the preview shows (fitted when it changes), `null` when empty. */
  bounds(preview: P): Box | null;
  /** The version's content in world px. */
  renderWorld(preview: P): ReactNode;
  /** Screen-space content that follows the camera (labels, per-part restore buttons). */
  renderOverlay?(preview: P, camera: Camera, n: number, restorable: boolean): ReactNode;
  /** A key that refits when it changes (the page shown…). */
  fitKey?: unknown;
  /** What the preview says when there is nothing to draw. */
  emptyText?(n: number): string;
}

/** The read-only preview of a past version, over the editor. */
export function VersionPreview<P>({ history, readOnly, bounds, renderWorld, renderOverlay, fitKey, emptyText }: VersionPreviewProps<P>): ReactNode {
  const previewing = history.store((s) => s.previewing);
  const preview = history.store((s) => s.preview);
  const loading = history.store((s) => s.loading);
  const error = history.store((s) => s.error);
  const canRestore = history.store((s) => s.canRestore);
  const root = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [confirm, setConfirm] = useState(false);
  const fitted = preview ? bounds(preview) : null;

  // Fit when a version arrives.
  useLayoutEffect(() => {
    const element = root.current;
    if (!preview || !element) return;
    setCamera(fitCamera(fitted, element.clientWidth, element.clientHeight));
    // `fitted` is derived from `preview` and `fitKey`.
  }, [preview, fitKey]);

  // Wheel pans; Ctrl/⌘ (and pinch) zooms around the pointer.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : 1;
      const box = element.getBoundingClientRect();
      setCamera((c) => {
        if (event.ctrlKey || event.metaKey) {
          const zoom = Math.min(8, Math.max(0.02, c.zoom * Math.exp(-event.deltaY * unit * 0.0025)));
          const px = event.clientX - box.left;
          const py = event.clientY - box.top;
          return { zoom, x: px - ((px - c.x) / c.zoom) * zoom, y: py - ((py - c.y) / c.zoom) * zoom };
        }
        return { ...c, x: c.x - event.deltaX * unit, y: c.y - event.deltaY * unit };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [previewing]);

  // Esc goes back to the current version.
  useEffect(() => {
    if (previewing === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !confirm) {
        event.stopPropagation();
        void history.preview(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [previewing, confirm, history]);

  if (previewing === null) return null;
  const restorable = canRestore && !readOnly;

  return (
    <div className="absolute inset-0 z-[30] flex flex-col bg-canvas" aria-label={localize(`Version ${previewing}, read-only`, `版本 ${previewing}，只读`)}>
      <div role="status" className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 text-[13px] text-fg">
        <History className="size-4 text-fg-muted" />
        <span className="font-medium">{localize('Version', '版本')} {previewing}</span>
        <span className="text-fg-muted">{localize('Read-only preview', '只读预览')}{readOnly ? '' : localize(' · go back to the latest version to edit', ' · 返回最新版本即可编辑')}</span>
        <span className="flex-1" />
        {restorable ? (
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirm(true)}>
            {localize('Restore this version', '恢复此版本')}
          </Button>
        ) : null}
        <Button size="sm" variant="primary" icon={<X className="size-3.5" />} onClick={() => void history.preview(null)}>
          {localize('Back to latest', '返回最新版本')}
        </Button>
      </div>
      <div
        ref={root}
        className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          const start = { x: event.clientX, y: event.clientY, camera };
          event.currentTarget.setPointerCapture(event.pointerId);
          const move = (e: PointerEvent): void => setCamera({ ...start.camera, x: start.camera.x + e.clientX - start.x, y: start.camera.y + e.clientY - start.y });
          const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        {loading || !preview ? (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-fg-muted">
            {error ? localize(`Version ${previewing} could not be read: ${error}`, `无法读取版本 ${previewing}：${error}`) : <Loader2 className="size-5 animate-spin" aria-label={localize('Loading the version', '正在加载版本')} />}
          </div>
        ) : (
          <>
            <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
              {renderWorld(preview)}
            </div>
            {renderOverlay?.(preview, camera, previewing, restorable)}
            {!fitted ? (
              <div className="absolute inset-0 flex items-center justify-center text-[13px] text-fg-subtle">{emptyText?.(previewing) ?? localize(`Nothing here in version ${previewing}.`, `版本 ${previewing} 没有可预览的内容。`)}</div>
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={localize(`Restore version ${previewing}?`, `恢复版本 ${previewing}？`)}
        description={localize('Every file goes back to how this version left it. The current state stays in the history, so this can be undone by restoring it.', '所有文件都会恢复为此版本的状态。当前状态会保留在版本历史中，也可以恢复。')}
        confirmLabel="Restore"
        onConfirm={() => void history.restore(previewing)}
      />
    </div>
  );
}
