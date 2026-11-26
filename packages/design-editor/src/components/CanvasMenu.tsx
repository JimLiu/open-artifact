/**
 * The canvas context menu (right-click): edit actions for the selected
 * elements, artboards or notes, with their shortcuts.
 */

import { ContextMenu } from '@base-ui/react/context-menu';
import type { ReactElement } from 'react';
import { cn } from '@open-artifact/ui';
import { boardsOnPage, notesOnPage, unlockedObjects } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import {
  copyProperties,
  deleteSelection,
  detachSelection,
  detachSelectionRefusal,
  duplicateSelection,
  flipSelection,
  groupSelectedNotes,
  hasCopiedProperties,
  noteGroupingFor,
  hasPropertiesToCopy,
  NO_PROPERTIES,
  pasteProperties,
  selectAllSiblings,
  selectionIsPositioned,
  unwrapSelection,
  wrapSelection,
} from '../services/commands.ts';
import { canPasteHere, copyToSystem, pasteFromSystem, pasteHere, pasteIntoLocked } from '../services/clipboard.ts';
import { toggleSelectionLock, useSelectionLock } from '../services/locks.ts';
import { LOCKED_REASON, UNLOCKABLE_REASON } from '../lib/locks.ts';
import { canCaptureSelection, canCopyAs, copyAs } from '../services/capture.ts';
import { armScale } from '../services/scale.ts';
import { swapSelectionPaint } from '../services/paint.ts';
import { StackingItems } from './StackingItems.tsx';
import { ChromeMenuItem, ChromeMenuSeparator, menuFit, POPUP } from '@open-artifact/editor-kit/react';

/** Wraps the canvas root, which becomes the menu's trigger. */
export function CanvasMenu({ children }: { children: ReactElement<Record<string, unknown>> }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={children} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-[1000]">
          <ContextMenu.Popup className={cn(POPUP, 'min-w-[220px]')} style={menuFit()}>
            <MenuItems />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MenuItems() {
  const selection = useView((s) => s.selection);
  const readOnly = useDocument((s) => s.readOnly);
  const elements = selection.kind === 'elements' && selection.items.length > 0;
  const objects = selection.kind === 'objects' && selection.boards.length + selection.notes.length > 0;
  const here = canPasteHere();
  const lock = useSelectionLock();
  // Changes that move, resize, delete or restructure locked things are disabled.
  const lockedWhy = lock.locked ? LOCKED_REASON : undefined;
  const pasteLocked = pasteIntoLocked();

  const selectAll = () => {
    if (elements) {
      selectAllSiblings();
      return;
    }
    const { canvas } = useDocument.getState();
    const { page } = useView.getState();
    const free = unlockedObjects(canvas, boardsOnPage(canvas, page), notesOnPage(canvas, page));
    useView.getState().select({ kind: 'objects', boards: free.boards, notes: free.notes });
  };

  const paste = (
    <>
      <ChromeMenuItem shortcut="⌘V" disabled={readOnly || pasteLocked} title={pasteLocked ? LOCKED_REASON : undefined} onSelect={() => void pasteFromSystem()}>
        Paste
      </ChromeMenuItem>
      {here ? (
        <ChromeMenuItem disabled={readOnly} onSelect={() => void pasteHere()}>
          Paste here
        </ChromeMenuItem>
      ) : null}
    </>
  );

  if (!elements && !objects) {
    return (
      <>
        {paste}
        <ChromeMenuItem shortcut="⌘A" onSelect={selectAll}>
          Select all
        </ChromeMenuItem>
      </>
    );
  }

  const copyAsItems = canCopyAs() ? (
    <>
      {(['png', 'svg', 'html'] as const).map((format) => (
        <ChromeMenuItem key={format} shortcut={format === 'png' ? '⇧⌘C' : undefined} disabled={!canCaptureSelection()} onSelect={() => void copyAs(format)}>
          {`Copy as ${format.toUpperCase()}`}
        </ChromeMenuItem>
      ))}
    </>
  ) : null;

  const positioned = elements && selectionIsPositioned();
  const single = elements && selection.items.length === 1;
  const detachable = elements && detachSelectionRefusal() === null;
  // Canvas notes group among themselves; the menu offers only what applies.
  const canGroupNotes = objects && noteGroupingFor('group');
  const canUngroupNotes = objects && noteGroupingFor('ungroup');
  // Locked notes stay in place when restacking; with all of them locked there is nothing to do.
  const notesLocked = selection.kind === 'objects' && selection.notes.length > 0 && !unlockedObjects(useDocument.getState().canvas, [], selection.notes).notes.length;
  const blocked = readOnly || Boolean(lockedWhy);
  return (
    <>
      <ChromeMenuItem shortcut="⌘X" disabled={readOnly || Boolean(lockedWhy)} title={lockedWhy} onSelect={() => copyToSystem(true)}>
        Cut
      </ChromeMenuItem>
      <ChromeMenuItem shortcut="⌘C" onSelect={() => copyToSystem(false)}>
        Copy
      </ChromeMenuItem>
      {paste}
      <ChromeMenuItem shortcut="⌘D" disabled={readOnly} onSelect={duplicateSelection}>
        Duplicate
      </ChromeMenuItem>
      <ChromeMenuItem shortcut="⌘L" disabled={readOnly || !lock.lockable} title={lock.lockable ? undefined : UNLOCKABLE_REASON} onSelect={toggleSelectionLock}>
        {lock.next === false ? 'Unlock' : 'Lock'}
      </ChromeMenuItem>
      {copyAsItems || elements ? <ChromeMenuSeparator /> : null}
      {copyAsItems}
      {objects && selection.notes.length ? (
        <>
          <ChromeMenuSeparator />
          <StackingItems disabled={readOnly || notesLocked} reason={notesLocked ? LOCKED_REASON : undefined} />
          <ChromeMenuItem shortcut="⇧X" disabled={readOnly} onSelect={swapSelectionPaint}>
            Swap fill and stroke
          </ChromeMenuItem>
        </>
      ) : null}
      {objects && (canGroupNotes || canUngroupNotes) ? (
        <>
          <ChromeMenuSeparator />
          {canGroupNotes ? (
            <ChromeMenuItem shortcut="⌘G" disabled={readOnly || Boolean(lockedWhy)} title={lockedWhy} onSelect={() => groupSelectedNotes('group')}>
              Group
            </ChromeMenuItem>
          ) : null}
          {canUngroupNotes ? (
            <ChromeMenuItem shortcut="⇧⌘G" disabled={readOnly || Boolean(lockedWhy)} title={lockedWhy} onSelect={() => groupSelectedNotes('ungroup')}>
              Ungroup
            </ChromeMenuItem>
          ) : null}
        </>
      ) : null}
      {elements ? (
        <>
          <ChromeMenuItem shortcut="⌥⌘C" disabled={!hasPropertiesToCopy()} title={hasPropertiesToCopy() ? undefined : NO_PROPERTIES} onSelect={copyProperties}>
            Copy properties
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⌥⌘V" disabled={readOnly || !hasCopiedProperties()} onSelect={pasteProperties}>
            Paste properties
          </ChromeMenuItem>
          <ChromeMenuSeparator />
          <ChromeMenuItem shortcut="⇧X" disabled={readOnly} onSelect={swapSelectionPaint}>
            Swap fill and stroke
          </ChromeMenuItem>
          <ChromeMenuSeparator />
          <StackingItems disabled={blocked} reason={lockedWhy} flow={!positioned} />
          <ChromeMenuSeparator />
          <ChromeMenuItem shortcut="⌘G" disabled={blocked} title={lockedWhy} onSelect={() => wrapSelection('block')}>
            Group
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⇧⌘G" disabled={blocked || !single} title={lockedWhy} onSelect={unwrapSelection}>
            Ungroup
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="K" disabled={blocked} title={lockedWhy} onSelect={armScale}>
            Scale…
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⇧H" disabled={blocked} title={lockedWhy} onSelect={() => flipSelection('x')}>
            Flip horizontal
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⇧V" disabled={blocked} title={lockedWhy} onSelect={() => flipSelection('y')}>
            Flip vertical
          </ChromeMenuItem>
          <ChromeMenuSeparator />
          {detachable ? (
            <ChromeMenuItem disabled={blocked} title={lockedWhy} onSelect={() => void detachSelection()}>
              Detach instance
            </ChromeMenuItem>
          ) : null}
          <ChromeMenuItem shortcut="⇧A" disabled={blocked} title={lockedWhy} onSelect={() => wrapSelection('flex')}>
            Wrap in flex
          </ChromeMenuItem>
          <ChromeMenuItem disabled={blocked} title={lockedWhy} onSelect={() => wrapSelection('grid')}>
            Wrap in grid
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⌘A" onSelect={selectAll}>
            Select all
          </ChromeMenuItem>
        </>
      ) : null}
      <ChromeMenuSeparator />
      <ChromeMenuItem shortcut="⌫" danger disabled={readOnly} onSelect={deleteSelection}>
        Delete
      </ChromeMenuItem>
    </>
  );
}
