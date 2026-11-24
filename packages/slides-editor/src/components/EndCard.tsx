/**
 * The card at the stage's top-right corner: Present, then the
 * properties-panel toggle, the zoom readout with its menu (which also holds
 * undo and redo) and the sync dot.
 */

import { localize } from '@open-artifact/runtime';
import { type ReactNode } from 'react';
import { BookText, ChevronDown, History, Play, SlidersHorizontal } from 'lucide-react';
import { ZOOM_PRESETS } from '@open-artifact/canvas-engine/camera';
import { cn } from '@open-artifact/ui';
import { present, zoomStep } from '../keyboard.ts';
import { useDeck } from '../state/deck.ts';
import { stageScale, useView } from '../state/view.ts';
import { redo, undo } from '../services/commands.ts';
import { slideHistory } from '../services/history.ts';
import { retryNow } from '../services/sync.ts';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator, MOD, SHIFT, Tip, useShellDraw } from '@open-artifact/editor-kit/react';
import { session } from '../services/session.ts';

const ICON = { className: 'size-5', strokeWidth: 1.5 } as const;
const SMALL = { className: 'size-4', strokeWidth: 1.5 } as const;

/** ▷ Present: from this slide, from the start, or with the speaker window. */
function PresentMenu(): ReactNode {
  const hasSlides = useDeck((s) => s.index.order.length > 0);
  const hasNotes = useDeck((s) => Object.values(s.slides).some((entry) => Boolean(entry.slide.notes.trim())));
  return (
    <ChromeMenu
      align="end"
      tip={{ label: localize('Present', '放映'), shortcut: `${MOD}↵` }}
      trigger={
        <ChromeButton size="lg" square aria-label={localize('Present', '放映')} disabled={!hasSlides}>
          <Play {...ICON} />
        </ChromeButton>
      }
    >
      <ChromeMenuItem icon={<Play {...SMALL} />} shortcut={`${MOD}↵`} onSelect={() => present('current')}>
        {localize('Present', '放映')}
      </ChromeMenuItem>
      <ChromeMenuItem shortcut={`${SHIFT}${MOD}↵`} onSelect={() => present('start')}>
        {localize('From the start', '从头放映')}
      </ChromeMenuItem>
      <ChromeMenuItem
        icon={<BookText {...SMALL} />}
        disabled={!hasNotes}
        title={hasNotes ? undefined : localize('No slide has speaker notes. Add some under View › Speaker notes.', '所有幻灯片均无演讲者备注。可在「视图 › 演讲者备注」中添加。')}
        onSelect={() => present('current', true)}
      >
        {localize('Present with speaker notes', '使用演讲者备注放映')}
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** "32% ⌄": the zoom readout and its menu (with undo and redo). */
function ZoomMenu(): ReactNode {
  const zoom = useView((s) => s.zoom);
  const fitScale = useView((s) => s.fitScale);
  const setZoom = useView((s) => s.setZoom);
  const canUndo = useDeck((s) => s.undo.length > 0 && !s.readOnly);
  const canRedo = useDeck((s) => s.redo.length > 0 && !s.readOnly);
  const scale = stageScale({ zoom, fitScale });
  const percent = Math.round(scale * 100);
  const preset = ZOOM_PRESETS.find((z) => zoom === z);
  return (
    <ChromeMenu
      align="end"
      tip={{ label: localize('Zoom', '缩放'), shortcut: `${MOD}+ / ${MOD}− / ${MOD}0` }}
      trigger={
        <ChromeButton aria-label={localize('Zoom', '缩放')} size="lg" className="min-w-[68px] justify-between gap-0.5 pl-2 pr-1 tabular-nums">
          {percent}%
          <ChevronDown className="size-4 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      <ChromeMenuItem shortcut={`${MOD}+`} closeOnClick={false} onSelect={() => zoomStep(1)}>
        {localize('Zoom in', '放大')}
      </ChromeMenuItem>
      <ChromeMenuItem shortcut={`${MOD}−`} closeOnClick={false} onSelect={() => zoomStep(-1)}>
        {localize('Zoom out', '缩小')}
      </ChromeMenuItem>
      <ChromeMenuItem checked={zoom === 'fit'} shortcut={`${MOD}0`} onSelect={() => setZoom('fit')}>
        {localize('Fit the slide', '适应幻灯片')}
      </ChromeMenuItem>
      <ChromeMenuSeparator />
      {zoom !== 'fit' && preset === undefined ? <ChromeMenuLabel>{localize('Now', '当前')} {percent}%</ChromeMenuLabel> : null}
      {ZOOM_PRESETS.map((z) => (
        <ChromeMenuItem key={z} checked={zoom === z} onSelect={() => setZoom(z)}>
          {z * 100}%
        </ChromeMenuItem>
      ))}
      <ChromeMenuSeparator />
      <ChromeMenuItem shortcut={`${MOD}Z`} disabled={!canUndo} closeOnClick={false} onSelect={undo}>
        {localize('Undo', '撤销')}
      </ChromeMenuItem>
      <ChromeMenuItem shortcut={`${SHIFT}${MOD}Z`} disabled={!canRedo} closeOnClick={false} onSelect={redo}>
        {localize('Redo', '重做')}
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** The sync dot: saving, couldn't save (click to retry), or all saved. */
function SyncDot(): ReactNode {
  const save = useDeck((s) => s.save);
  if (save === 'readonly') return null;
  const offline = save === 'offline';
  const busy = save === 'saving' || save === 'dirty';
  const label = offline ? localize('Couldn’t sync — click to retry', '同步失败，点击重试') : busy ? localize('Syncing…', '正在同步…') : localize('All changes synced', '所有更改均已同步');
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={!offline}
        onClick={retryNow}
        className="flex h-8 w-[22px] shrink-0 items-center justify-center rounded-[6px] outline-none enabled:hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent"
      >
        <span
          className={cn(
            'size-1.5 rounded-full transition-colors',
            offline ? 'bg-danger' : busy ? 'animate-pulse bg-chrome-muted' : 'bg-success',
          )}
        />
      </button>
    </Tip>
  );
}

/** Props of {@link EndCard}. */
export interface EndCardProps {
  /** A slide is on stage: the properties toggle is live and the zoom shows. */
  onStage: boolean;
}

/** The card. */
export function EndCard({ onStage }: EndCardProps): ReactNode {
  const showProperties = useView((s) => s.showProperties);
  const readOnly = useDeck((s) => s.readOnly);
  const historyAvailable = slideHistory.store(s => s.available);
  const label = showProperties ? localize('Hide the properties panel', '隐藏属性面板') : localize('Show the properties panel', '显示属性面板');
  // In a Shell its Share panel's Export tab lists the formats and its bar shows the save state.
  const shellSaved = useShellDraw(session().shell, 'saved');
  return (
    <Card className="h-10 gap-1 px-1 py-px">
      {!session().shell && historyAvailable ? <Tip label={localize('Version history', '版本历史')}>
        <ChromeButton size="lg" square aria-label={localize('Version history', '版本历史')} onClick={() => slideHistory.toggle(true)}><History {...ICON} /></ChromeButton>
      </Tip> : null}
      <PresentMenu />
      {!readOnly ? (
        <>
          <ChromeDivider />
          <Tip label={onStage ? label : localize('Open a slide to edit its properties', '打开一张幻灯片以编辑属性')} shortcut={onStage ? `${MOD}\\` : undefined}>
            <ChromeButton size="lg" square pressed={showProperties && onStage} disabled={!onStage} aria-label={localize('Properties', '属性')} onClick={() => useView.getState().toggle('showProperties')}>
              <SlidersHorizontal {...ICON} />
            </ChromeButton>
          </Tip>
        </>
      ) : null}
      {onStage ? (
        <>
          <ChromeDivider />
          <ZoomMenu />
        </>
      ) : null}
      {shellSaved ? null : <SyncDot />}
    </Card>
  );
}
