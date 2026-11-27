/**
 * "+ Add slide" and the View menu. View heads the slide rail; with the rail
 * hidden, and in the grid and canvas views, it sits at the top-left of the
 * stage instead. Add slide sits at the top-right, before Present (see
 * EndCard).
 *
 * Add slide opens the layout picker. The View menu switches between one
 * slide, grid and canvas, and shows or hides the slide thumbnails and the
 * speaker notes.
 */

import { type ReactNode } from 'react';
import { ChevronDown, Keyboard, Plus } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { useUi } from '../state/ui.ts';
import { railWanted, useView, type ViewMode } from '../state/view.ts';
import { ChromeButton, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, MOD, Tip } from '@open-artifact/editor-kit/react';

const VIEWS: [ViewMode, string][] = [
  ['edit', 'One slide'],
  ['grid', 'Grid'],
  ['canvas', 'Canvas'],
];

/** "+ Add slide": opens the layout picker. */
export function AddSlideButton(): ReactNode {
  return (
    <Tip label="Add slide" shortcut={`${MOD}M`}>
      <ChromeButton size="lg" className="gap-1 pl-1.5 pr-2.5" onClick={() => useUi.getState().open('newSlide')}>
        <Plus className="size-5" strokeWidth={1.5} />
        Add slide
      </ChromeButton>
    </Tip>
  );
}

/** "View ⌄": one slide, grid or canvas, and what shows. */
export function ViewMenu(): ReactNode {
  const mode = useView((s) => s.mode);
  const showRail = useView(railWanted);
  const showNotes = useView((s) => s.showNotes);
  const view = useView.getState;
  return (
    <ChromeMenu
      tip={{ label: 'Choose what to show' }}
      trigger={
        <ChromeButton className="gap-0.5 pl-2 pr-1" aria-label="View">
          View
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
        Slide thumbnails
      </ChromeMenuItem>
      <ChromeMenuItem checked={showNotes} closeOnClick={false} onSelect={() => view().toggle('showNotes')}>
        Speaker notes
      </ChromeMenuItem>
      <ChromeMenuSeparator />
      <ChromeMenuItem icon={<Keyboard className="size-4" />} shortcut="?" onSelect={() => useUi.getState().open('shortcuts')}>
        Keyboard shortcuts
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** View at the top-left: the rail's header, or over the stage when the rail is hidden. */
export function StartControls({ className }: { className?: string }): ReactNode {
  return (
    <div className={cn('flex h-10 items-center', className)}>
      <ViewMenu />
    </div>
  );
}
