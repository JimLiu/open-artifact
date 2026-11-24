/**
 * Banners above the stage: why the deck is read-only, unsaved changes found
 * from an earlier visit, a slide changed elsewhere at the same time (mine /
 * theirs / keep both; changes to different lines merge without asking),
 * versions set aside by such a choice, a save made at the same moment that
 * replaced this tab's (compare / bring back), and a slide held read-only by
 * errors in its file.
 */

import { localize } from '@open-artifact/runtime';
import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { AlertTriangle, Bot, Columns2, History, Lock, RotateCcw, Undo2 } from 'lucide-react';
import { newSlideId } from '@open-artifact/slides-core';
import { Button, Dialog, cn } from '@open-artifact/ui';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useOrder } from '../state/outline.ts';
import { useView } from '../state/view.ts';
import { askAgentToFix, useAgent } from '../services/agent.ts';
import { clearRecovery, restoreRecovery, type Recovery } from '../services/recovery.ts';
import { schedule } from '../services/sync.ts';
import { SlideThumb } from './SlideThumb.tsx';

/** "Compare": this tab's overwritten version beside the slide as it is now. */
function CompareDialog({ position, onClose }: { position: number; onClose: () => void }): ReactNode {
  const item = useDeck((s) => s.kept[position]);
  const now = useDeck((s) => (item ? s.slides[item.id]?.slide : undefined));
  if (!item) return null;
  const bringBack = (): void => {
    useDeck.getState().bringBack(position);
    useView.getState().showSlide(item.id);
    schedule(0);
    onClose();
  };
  return (
    <Dialog
      closeLabel={localize('Close', '关闭')}
      open
      onOpenChange={(open) => !open && onClose()}
      title={localize('Compare versions', '比较版本')}
      description={localize('Your version was replaced by a save made at the same moment.', '同时发生的另一次保存覆盖了你的版本。')}
      className="w-[min(52rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {localize('Keep current', '保留当前版本')}
          </Button>
          <Button variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={bringBack} disabled={!now}>
            {localize('Bring back yours', '恢复你的版本')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <figure className="flex flex-col gap-1.5">
          <figcaption className="text-xs text-fg-muted">{localize('Yours', '你的版本')}</figcaption>
          <div className="overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]">
            <SlideThumb slide={item.slide} />
          </div>
        </figure>
        <figure className="flex flex-col gap-1.5">
          <figcaption className="text-xs text-fg-muted">{localize('Current', '当前版本')}</figcaption>
          <div className="overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]">{now ? <SlideThumb slide={now} /> : <div className="aspect-video bg-surface-2" />}</div>
        </figure>
      </div>
    </Dialog>
  );
}

/** Unsaved changes found at boot, waiting for the person's choice. */
export const useRecoveryOffer = create<{ offer: Recovery | null; set(offer: Recovery | null): void }>()((set) => ({
  offer: null,
  set(offer) {
    set({ offer });
  },
}));

/** One banner row. */
function Banner({ tone, icon, children, actions }: { tone: 'info' | 'warning' | 'danger'; icon: ReactNode; children: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs',
        tone === 'info' && 'border-line bg-surface-2 text-fg',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-fg',
        tone === 'danger' && 'border-danger/30 bg-danger/10 text-fg',
      )}
    >
      <span className={cn('shrink-0', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger', tone === 'info' && 'text-fg-muted')}>{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
    </div>
  );
}

/** "about 5 minutes ago" for a timestamp. */
function minutesAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return localize('moments ago', '刚刚');
  if (minutes < 60) return localize(`about ${minutes} minute${minutes === 1 ? '' : 's'} ago`, `约 ${minutes} 分钟前`);
  const hours = Math.round(minutes / 60);
  if (hours < 48) return localize(`about ${hours} hour${hours === 1 ? '' : 's'} ago`, `约 ${hours} 小时前`);
  return localize(`${Math.round(hours / 24)} days ago`, `${Math.round(hours / 24)} 天前`);
}

/** Slide numbers as "slide 3" / "slides 2, 5 and 7". */
function slideList(ids: readonly string[], order: readonly string[]): string {
  const numbers = ids.map((id) => order.indexOf(id) + 1).filter((n) => n > 0).sort((a, b) => a - b);
  if (numbers.length === 0) return localize('the outline', '大纲');
  if (numbers.length === 1) return localize(`slide ${numbers[0]}`, `第 ${numbers[0]} 张幻灯片`);
  return localize(`slides ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`, `第 ${numbers.join('、')} 张幻灯片`);
}

/** The banners. */
export function Banners(): ReactNode {
  const readOnly = useDeck((s) => s.readOnly);
  const status = useDeck((s) => s.status);
  const indexError = useDeck((s) => s.indexError);
  const kept = useDeck((s) => s.kept);
  const current = useView((s) => s.current);
  const entry = useDeck((s) => (current ? s.slides[current] : undefined));
  const conflicts = useDeck((s) => s.slides);
  const offer = useRecoveryOffer((s) => s.offer);
  const agent = useAgent((s) => s.status);
  const order = useOrder();
  const [comparing, setComparing] = useState<number | null>(null);
  if (status !== 'ready') return null;

  const conflicted = Object.keys(conflicts).filter((id) => conflicts[id]!.conflict);
  const out: ReactNode[] = [];

  if (readOnly) {
    out.push(
      <Banner key="ro" tone="info" icon={<Lock className="size-3.5" />}>
        {indexError && /newer/i.test(indexError) ? localize('This presentation was saved by a newer version of Slides and opens read-only here.', '此演示文稿由较新版本的幻灯片编辑器保存，当前以只读方式打开。') : localize("View only. You don't have permission to edit this presentation.", '仅供查看。你没有编辑此演示文稿的权限。')}
      </Banner>,
    );
  } else if (indexError) {
    out.push(
      <Banner key="index" tone="warning" icon={<AlertTriangle className="size-3.5" />}>
        {localize(`The outline file can't be read (${indexError}). Slides can still be edited; the slide order and sections are read-only.`, `无法读取大纲文件（${indexError}）。仍可编辑幻灯片，顺序和分节为只读。`)}
      </Banner>,
    );
  }

  if (offer && !readOnly) {
    const ids = Object.keys(offer.slides);
    out.push(
      <Banner
        key="recovery"
        tone="warning"
        icon={<History className="size-3.5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                restoreRecovery(offer);
                useRecoveryOffer.getState().set(null);
                schedule(0);
              }}
            >
              {localize('Restore', '恢复')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearRecovery();
                useRecoveryOffer.getState().set(null);
              }}
            >
              {localize('Discard', '丢弃')}
            </Button>
          </>
        }
      >
        {localize(`Found unsaved changes to ${slideList(ids, order)} from ${minutesAgo(offer.at)}. Restore them?`, `发现${minutesAgo(offer.at)}对${slideList(ids, order)}所做的未保存更改。要恢复吗？`)}
      </Banner>,
    );
  }

  for (const id of conflicted) {
    const conflict = conflicts[id]!.conflict!;
    const n = order.indexOf(id) + 1;
    const resolve = (choice: 'mine' | 'theirs' | 'copy'): void => {
      const state = useDeck.getState();
      const copyId = choice === 'copy' ? newSlideId(new Set([...Object.keys(state.slides), ...Object.keys(state.trash)])) : undefined;
      state.resolveConflict(id, choice, copyId);
      if (copyId) useView.getState().showSlide(copyId);
      schedule(0);
    };
    out.push(
      <Banner
        key={`conflict-${id}`}
        tone="danger"
        icon={<AlertTriangle className="size-3.5" />}
        actions={
          conflict.reason === 'deleted' ? (
            <>
              <Button size="sm" variant="primary" onClick={() => resolve('mine')}>
                {localize('Keep my version', '保留我的版本')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve('theirs')}>
                {localize('Delete it', '删除这张幻灯片')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={() => resolve('mine')}>
                {localize('Use mine', '使用我的版本')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve('theirs')}>
                {localize('Use theirs', '使用对方的版本')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resolve('copy')}>
                {localize('Save mine as a copy', '将我的版本另存为副本')}
              </Button>
            </>
          )
        }
      >
        {conflict.reason === 'deleted'
          ? localize(`Slide ${n} was deleted elsewhere while you were editing it.`, `你编辑时，其他人删除了第 ${n} 张幻灯片。`)
          : localize(`Slide ${n} was changed elsewhere at the same time as you. Choose which version to keep.`, `你编辑第 ${n} 张幻灯片时，其他人也修改了它。请选择要保留的版本。`)}
        {id !== current ? (
          <button type="button" className="ml-1 text-accent hover:underline" onClick={() => useView.getState().showSlide(id)}>
            {localize('Show it', '查看幻灯片')}
          </button>
        ) : null}
      </Banner>,
    );
  }

  kept.slice(0, 3).forEach((item, position) => {
    if (item.reason === 'overwritten') {
      const n = Math.max(1, deckOrder(useDeck.getState()).indexOf(item.id) + 1);
      out.push(
        <Banner
          key={`kept-${item.at}-${item.id}`}
          tone="warning"
          icon={<Undo2 className="size-3.5" />}
          actions={
            <>
              <Button size="sm" variant="ghost" icon={<Columns2 className="size-3.5" />} onClick={() => setComparing(position)}>
                {localize('Compare', '比较')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw className="size-3.5" />}
                disabled={readOnly}
                onClick={() => {
                  useDeck.getState().bringBack(position);
                  useView.getState().showSlide(item.id);
                  schedule(0);
                }}
              >
                {localize('Bring back', '恢复')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => useDeck.getState().dismissKept(position)}>
                {localize('Dismiss', '关闭')}
              </Button>
            </>
          }
        >
          {localize(`A save made at the same moment replaced your changes to slide ${n}.`, `同时发生的另一次保存覆盖了你对第 ${n} 张幻灯片的更改。`)}
        </Banner>,
      );
      return;
    }
    const number = Math.max(1, deckOrder(useDeck.getState()).indexOf(item.id) + 1);
    const version = item.reason === 'mine-chosen' ? localize('The other version', '对方的版本') : localize('Your version', '你的版本');
    out.push(
      <Banner
        key={`kept-${item.at}-${item.id}`}
        tone="info"
        icon={<Undo2 className="size-3.5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => {
                const state = useDeck.getState();
                const newId = newSlideId(new Set([...Object.keys(state.slides), ...Object.keys(state.trash)]));
                state.restoreKept(position, newId);
                useView.getState().showSlide(newId);
                schedule(0);
              }}
            >
              {localize('Restore as new slide', '恢复为新幻灯片')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => useDeck.getState().dismissKept(position)}>
              {localize('Dismiss', '关闭')}
            </Button>
          </>
        }
      >
        {localize(`${version} of slide ${number} was set aside.`, `已暂存第 ${number} 张幻灯片的另一版本（${version}）。`)}
      </Banner>,
    );
  });

  if (entry?.held) {
    out.push(
      <Banner
        key="held"
        tone="warning"
        icon={<AlertTriangle className="size-3.5" />}
        actions={
          agent.available && !readOnly ? (
            <Button size="sm" variant="ghost" icon={<Bot className="size-3.5" />} onClick={() => void askAgentToFix([current!])}>
              {localize(`Ask ${agent.name} to fix`, `请 ${agent.name} 修复`)}
            </Button>
          ) : null
        }
      >
        {localize('This slide\'s file has errors, so it\'s read-only here:', '此幻灯片文件包含错误，当前以只读方式打开：')} {entry.held}
      </Banner>,
    );
  }

  if (!out.length) return null;
  return (
    <div className="flex shrink-0 flex-col">
      {out}
      {comparing !== null ? <CompareDialog position={comparing} onClose={() => setComparing(null)} /> : null}
    </div>
  );
}
