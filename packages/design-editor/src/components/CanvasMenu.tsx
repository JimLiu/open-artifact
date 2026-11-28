/**
 * The canvas context menu (right-click): edit actions for the selected
 * elements, artboards or notes, with their shortcuts.
 */

import { ContextMenu } from '@base-ui/react/context-menu';
import { useMemo, type ReactElement } from 'react';
import { cn } from '@open-artifact/ui';
import { boardsOnPage, notesOnPage, unlockedObjects } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView, type Selection } from '../state/view.ts';
import {
  deleteSelection,
  detachSelection,
  detachSelectionRefusal,
  duplicateSelection,
  flipSelection,
  groupSelectedNotes,
  noteGroupingFor,
  renameBoardOnCanvas,
  selectAllSiblings,
  selectionIsPositioned,
  wrapSelection,
} from '../services/commands.ts';
import { canPasteHere, copyToSystem, menuPasteRefusal, pasteFromSystem, pasteHere, pasteIntoLocked } from '../services/clipboard.ts';
import { toggleSelectionLock, useDeleteLockedWhy, useSelectionLock } from '../services/locks.ts';
import { LOCKED_REASON, UNLOCKABLE_REASON } from '../lib/locks.ts';
import { canCaptureSelection, canCopyAs, copyAs } from '../services/capture.ts';
import { armScale } from '../services/scale.ts';
import { swapSelectionPaint } from '../services/paint.ts';
import { copyProperties, copyPropertiesRefusal, pasteProperties, pastePropertiesRefusal } from '../services/properties.ts';
import { StackingItems } from './StackingItems.tsx';
import { ChromeMenuItem, ChromeMenuSeparator, menuFit, POPUP } from '@open-artifact/editor-kit/react';
import { groupSelection, ungroupSelection } from '../services/structure.ts';
import { resolveElement } from '@open-artifact/dc';
import { templateOf } from '../services/agent.ts';
import { describeElement } from '../lib/outline.ts';

/** Why a piece's Rename is off. */
const LOOSE_PIECE_RENAME = 'A loose piece shows no title on the canvas. Rename it in Layers.';

/** Wraps the canvas root, which becomes the menu's trigger. */
export function CanvasMenu({ children }: { children: ReactElement<Record<string, unknown>> }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={children} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-[1000]">
          <MenuPopup />
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MenuPopup() {
  const selection = useView((s) => s.selection);
  // Read when it opens: the layer names come from the artboard file.
  const sources = useDocument((s) => s.boards);
  const title = useMemo(() => menuTitle(selection), [selection, sources]);
  return (
    <ContextMenu.Popup className={cn(POPUP, 'min-w-[220px]')} style={menuFit()} aria-label={title}>
      <MenuItems />
    </ContextMenu.Popup>
  );
}

/** What the menu is called: the element's layer name, or what kind of thing it acts on. */
export function menuTitle(selection: Selection): string {
  if (selection.kind === 'elements' && selection.items[0]) {
    const item = selection.items[0];
    const source = useDocument.getState().boards[selection.board]?.source;
    const element = source ? resolveElement(templateOf(source), item.tid, item.path) : null;
    if (element) return `${describeElement(element).name} actions`;
  }
  return selection.kind === 'none' ? 'Canvas actions' : 'Object actions';
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
  // Delete skips locked artboards and notes; it is off only when all are locked.
  const deleteLocked = useDeleteLockedWhy() ?? undefined;
  const pasteLocked = pasteIntoLocked();
  const pasteOff = pasteLocked ? LOCKED_REASON : menuPasteRefusal();
  const mixed = selection.kind === 'mixed';

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
      <ChromeMenuItem shortcut="⌘V" disabled={readOnly || Boolean(pasteOff)} title={pasteOff ?? undefined} onSelect={() => void pasteFromSystem(true)}>
        Paste
      </ChromeMenuItem>
      {here ? (
        <ChromeMenuItem disabled={readOnly} onSelect={() => void pasteHere()}>
          Paste here
        </ChromeMenuItem>
      ) : null}
    </>
  );

  const copyWhy = copyPropertiesRefusal();
  const pasteWhy = pastePropertiesRefusal();
  const propertyItems = (
    <>
      <ChromeMenuItem shortcut="⌥⌘C" disabled={readOnly || Boolean(copyWhy)} title={copyWhy ?? undefined} onSelect={copyProperties}>
        Copy properties
      </ChromeMenuItem>
      <ChromeMenuItem shortcut="⌥⌘V" disabled={readOnly || Boolean(pasteWhy)} title={pasteWhy ?? undefined} onSelect={pasteProperties}>
        Paste properties
      </ChromeMenuItem>
    </>
  );

  // Elements of several artboards with or without canvas objects: what
  // each file does for its own part, as one undo step.
  if (mixed) {
    const blockedMixed = readOnly || Boolean(lockedWhy);
    return (
      <>
        {paste}
        <ChromeMenuItem shortcut="⌘D" disabled={readOnly} onSelect={duplicateSelection}>
          Duplicate
        </ChromeMenuItem>
        <ChromeMenuItem shortcut="⌘L" disabled={readOnly || !lock.lockable} title={lock.lockable ? undefined : UNLOCKABLE_REASON} onSelect={toggleSelectionLock}>
          {lock.next === false ? 'Unlock' : 'Lock'}
        </ChromeMenuItem>
        <ChromeMenuSeparator />
        {propertyItems}
        <ChromeMenuSeparator />
        <StackingItems disabled={blockedMixed} reason={lockedWhy} />
        <ChromeMenuItem shortcut="⇧H" disabled={blockedMixed} title={lockedWhy} onSelect={() => flipSelection('x')}>
          Flip horizontal
        </ChromeMenuItem>
        <ChromeMenuItem shortcut="⇧V" disabled={blockedMixed} title={lockedWhy} onSelect={() => flipSelection('y')}>
          Flip vertical
        </ChromeMenuItem>
        <ChromeMenuSeparator />
        <ChromeMenuItem shortcut="⌫" danger disabled={readOnly || Boolean(deleteLocked)} title={deleteLocked} onSelect={deleteSelection}>
          Delete
        </ChromeMenuItem>
      </>
    );
  }

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
  const detachable = elements && detachSelectionRefusal() === null;
  // Canvas notes group among themselves; the menu offers only what applies.
  const canGroupNotes = objects && noteGroupingFor('group');
  const canUngroupNotes = objects && noteGroupingFor('ungroup');
  // Locked artboards and notes stay in place when restacking; with all of them locked there is nothing to do.
  const free = selection.kind === 'objects' ? unlockedObjects(useDocument.getState().canvas, selection.boards, selection.notes) : null;
  const objectsLocked = objects && free !== null && !free.boards.length && !free.notes.length;
  const blocked = readOnly || Boolean(lockedWhy);
  // One artboard: its title can be renamed in place. A piece has no title on the canvas: the layers list renames it.
  const loneBoard = selection.kind === 'objects' && selection.boards.length === 1 && selection.notes.length === 0 ? selection.boards[0]! : null;
  const loosePiece = loneBoard !== null && Boolean(useDocument.getState().canvas.boards[loneBoard]?.frameless);
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
      {loneBoard ? (
        <>
          <ChromeMenuSeparator />
          <ChromeMenuItem disabled={readOnly || loosePiece} title={loosePiece ? LOOSE_PIECE_RENAME : undefined} onSelect={() => renameBoardOnCanvas(loneBoard)}>
            Rename
          </ChromeMenuItem>
        </>
      ) : null}
      {copyAsItems || elements ? <ChromeMenuSeparator /> : null}
      {copyAsItems}
      {objects ? (
        <>
          <ChromeMenuSeparator />
          {propertyItems}
          <ChromeMenuSeparator />
          <StackingItems disabled={readOnly || objectsLocked} reason={objectsLocked ? LOCKED_REASON : undefined} />
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
          {propertyItems}
          <ChromeMenuSeparator />
          <ChromeMenuItem shortcut="⇧X" disabled={readOnly} onSelect={swapSelectionPaint}>
            Swap fill and stroke
          </ChromeMenuItem>
          <ChromeMenuSeparator />
          <StackingItems disabled={blocked} reason={lockedWhy} flow={!positioned} />
          <ChromeMenuSeparator />
          <ChromeMenuItem shortcut="⌘G" disabled={blocked} title={lockedWhy} onSelect={groupSelection}>
            Group
          </ChromeMenuItem>
          <ChromeMenuItem shortcut="⇧⌘G" disabled={blocked} title={lockedWhy} onSelect={ungroupSelection}>
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
      <ChromeMenuItem shortcut="⌫" danger disabled={readOnly || Boolean(deleteLocked)} title={deleteLocked} onSelect={deleteSelection}>
        Delete
      </ChromeMenuItem>
    </>
  );
}
