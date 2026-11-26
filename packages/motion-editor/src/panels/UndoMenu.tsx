import type { ReactElement } from 'react';
import { Undo2 } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { Menu, MenuItem } from '@open-artifact/ui';
import { redo, undo, useUndo } from '../engine/undo.ts';
import { NOTHING_TO_REDO, NOTHING_TO_UNDO, REDO, UNDO } from '../engine/words.ts';
import { UNDO_OR_REDO } from './words.ts';

/** On a touch screen, where there is no Cmd+Z, the panel's head offers Undo and Redo; elsewhere it is left out. */
export function UndoMenu(): ReactElement {
  const canUndo = useUndo((s) => s.canUndo);
  const canRedo = useUndo((s) => s.canRedo);
  return (
    <span className="hidden pointer-coarse:contents" data-video-undo-menu="">
      <Menu align="end" trigger={<ToolButton label={UNDO_OR_REDO} size="md" icon={<Undo2 />} />}>
        <MenuItem disabled={!canUndo} onSelect={undo}>
          {canUndo ? UNDO : NOTHING_TO_UNDO}
        </MenuItem>
        <MenuItem disabled={!canRedo} onSelect={redo}>
          {canRedo ? REDO : NOTHING_TO_REDO}
        </MenuItem>
      </Menu>
    </span>
  );
}
