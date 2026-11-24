/**
 * "+ Add slide" and the View menu. They head the slide rail; with the rail
 * hidden, and in the grid and canvas views, they float at the top-left of
 * the stage instead.
 *
 * Add slide opens the layout picker. The View menu switches between one
 * slide, grid and canvas, and shows or hides the slide thumbnails and the
 * speaker notes.
 */

import { localize } from '@open-artifact/runtime';
import { type ReactNode } from 'react';
import { ChevronDown, Keyboard, Plus } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { useDeck } from '../state/deck.ts';
import { useUi } from '../state/ui.ts';
import { useView, type ViewMode } from '../state/view.ts';
import { canChange } from '../services/commands.ts';
import { Card, ChromeButton, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, MOD, Tip } from '@open-artifact/editor-kit/react';

const VIEWS: [ViewMode, string][] = [
  ['edit', localize('One slide', '单张幻灯片')],
  ['grid', localize('Grid', '网格')],
  ['canvas', localize('Canvas', '画布')],
];

/** "+ Add slide": opens the layout picker. */
export function AddSlideButton(): ReactNode {
  return (
    <Tip label={localize('Add slide', '添加幻灯片')} shortcut={`${MOD}M`}>
      <ChromeButton className="gap-1 pl-1 pr-2" onClick={() => useUi.getState().open('newSlide')}>
        <Plus className="size-5" strokeWidth={1.5} />
        {localize('Add slide', '添加幻灯片')}
      </ChromeButton>
    </Tip>
  );
}

/** "View ⌄": one slide, grid or canvas, and what shows. */
export function ViewMenu(): ReactNode {
  const mode = useView((s) => s.mode);
  const showRail = useView((s) => s.showRail);
  const showNotes = useView((s) => s.showNotes);
  const view = useView.getState;
  return (
    <ChromeMenu
      tip={{ label: localize('Choose what to show', '选择要显示的内容') }}
      trigger={
        <ChromeButton className="gap-0.5 pl-2 pr-1" aria-label={localize('View', '视图')}>
          {localize('View', '视图')}
          <ChevronDown className="size-4 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      {VIEWS.map(([m, label]) => (
        <ChromeMenuItem key={m} checked={mode === m} onSelect={() => view().setMode(m)}>
          {label}
        </ChromeMenuItem>
      ))}
      <ChromeMenuSeparator />
      <ChromeMenuItem checked={showRail} disabled={mode !== 'edit'} closeOnClick={false} onSelect={() => view().toggle('showRail')}>
        {localize('Slide thumbnails', '幻灯片缩略图')}
      </ChromeMenuItem>
      <ChromeMenuItem checked={showNotes} closeOnClick={false} onSelect={() => view().toggle('showNotes')}>
        {localize('Speaker notes', '演讲者备注')}
      </ChromeMenuItem>
      <ChromeMenuSeparator />
      <ChromeMenuItem icon={<Keyboard className="size-4" />} shortcut="?" onSelect={() => useUi.getState().open('shortcuts')}>
        {localize('Keyboard shortcuts', '键盘快捷键')}
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** The two controls in a row (the rail header, or the floating card). */
export function StartControls({ className }: { className?: string }): ReactNode {
  const editable = useDeck((s) => !s.readOnly) && canChange();
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {editable ? <AddSlideButton /> : null}
      <ViewMenu />
    </div>
  );
}

/** The floating card at the stage's top-left. */
export function StartCard(): ReactNode {
  return (
    <Card className="h-10 px-1 py-px">
      <StartControls />
    </Card>
  );
}
