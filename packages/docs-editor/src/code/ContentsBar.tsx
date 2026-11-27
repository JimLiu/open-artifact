/** The bar on a selected table of contents: a menu with what can be done to it (take it out). */
import { Card, ChromeMenu, ChromeMenuItem, TipButton } from '@open-artifact/editor-kit/react';
import { Ellipsis, Trash2 } from 'lucide-react';
import { type MouseEvent, type ReactNode, useState } from 'react';
import { CONTENTS_ACTIONS, CONTENTS_DELETE } from './contents.ts';

/** Keeps the editor's selection (and its keyboard) while a button of the bar is pressed. */
const keepSelection = (event: MouseEvent) => event.preventDefault();

export function ContentsBar({ onDelete }: { onDelete(): void }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Card className="contents-bar p-1" role="toolbar" aria-label={CONTENTS_ACTIONS} onMouseDown={keepSelection} data-contents-bar="">
      <ChromeMenu
        open={open}
        onOpenChange={setOpen}
        align="end"
        trigger={
          <TipButton tip="More actions" aria-label="More actions" square pressed={open}>
            <Ellipsis className="size-4" strokeWidth={1.75} />
          </TipButton>
        }
      >
        <ChromeMenuItem danger icon={<Trash2 className="size-4" />} onSelect={onDelete}>
          {CONTENTS_DELETE}
        </ChromeMenuItem>
      </ChromeMenu>
    </Card>
  );
}
