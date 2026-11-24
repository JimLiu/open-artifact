/**
 * The slide menu (right-click on a thumbnail in the rail, grid or canvas):
 * clipboard, duplicate, delete, skip, cover, sections, moves and links.
 */

import { localize } from '@open-artifact/runtime';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, CopyPlus, Eye, EyeOff, Image, Link, ListPlus, Plus, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { MenuItem, MenuSeparator } from '@open-artifact/ui';
import { maybeSession } from '../services/session.ts';
import { useDeck } from '../state/deck.ts';
import { askAgentToFix, useAgent } from '../services/agent.ts';
import { copySlidesToMemory, hasMemory, pasteFromMemory } from '../services/clipboard.ts';
import {
  addSlide,
  canChange,
  copySlideLink,
  deleteSlides,
  duplicateSlides,
  nudgeSlides,
  setCoverSlide,
  setSlidesHidden,
  slidesToNewSection,
  startSectionAt,
} from '../services/commands.ts';
import { MOD } from '@open-artifact/editor-kit';

/** Menu items acting on `ids` (in deck order). */
export function SlideMenuItems({ ids }: { ids: readonly string[] }): ReactNode {
  const deck = useDeck.getState();
  const editing = canChange();
  const agent = useAgent.getState().status.available;
  if (ids.length === 0) return null;
  const single = ids.length === 1 ? ids[0]! : null;
  const allHidden = ids.every((id) => deck.slides[id]?.slide.hidden);
  const held = ids.filter((id) => deck.slides[id]?.held);
  const startsSection = single ? Object.values(deck.index.sections).some((s) => s.start === single) : false;
  const many = ids.length > 1 ? localize(` ${ids.length} slides`, ` ${ids.length} 张幻灯片`) : '';
  return (
    <>
      <MenuItem icon={<Copy className="size-4" />} shortcut={`${MOD}C`} onSelect={() => copySlidesToMemory(ids)}>
        {localize('Copy', '复制')}{many}
      </MenuItem>
      {editing ? (
        <>
          <MenuItem
            icon={<Scissors className="size-4" />}
            shortcut={`${MOD}X`}
            onSelect={() => {
              copySlidesToMemory(ids);
              deleteSlides(ids);
            }}
          >
            {localize('Cut', '剪切')}{many}
          </MenuItem>
          <MenuItem icon={<ClipboardPaste className="size-4" />} shortcut={`${MOD}V`} disabled={!hasMemory()} onSelect={() => pasteFromMemory()}>
            {localize('Paste', '粘贴')}
          </MenuItem>
          <MenuItem icon={<CopyPlus className="size-4" />} shortcut={`${MOD}D`} onSelect={() => duplicateSlides(ids)}>
            {localize('Duplicate', '复制一份')}{many}
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-4" />} shortcut="⌫" danger onSelect={() => deleteSlides(ids)}>
            {localize('Delete', '删除')}{many}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={allHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} onSelect={() => setSlidesHidden(ids, !allHidden)}>
            {allHidden ? localize('Don’t skip', '取消跳过') : localize('Skip when presenting', '放映时跳过')}
          </MenuItem>
          {single ? (
            <MenuItem icon={<Image className="size-4" />} disabled={deck.index.cover === single} onSelect={() => setCoverSlide(single)}>
              {localize('Use as cover thumbnail', '设为封面缩略图')}
            </MenuItem>
          ) : null}
          <MenuItem icon={<ListPlus className="size-4" />} onSelect={() => slidesToNewSection(ids)}>
            {localize('Move to new section', '移到新节')}
          </MenuItem>
          {single && !startsSection ? (
            <MenuItem icon={<ListPlus className="size-4" />} onSelect={() => startSectionAt(single)}>
              {localize('Start a section here', '在此创建节')}
            </MenuItem>
          ) : null}
          <MenuItem icon={<Plus className="size-4" />} onSelect={() => addSlide('blank', ids[ids.length - 1]!)}>
            {localize('Add slide after', '在后面添加幻灯片')}
          </MenuItem>
          <MenuItem icon={<ArrowUp className="size-4" />} onSelect={() => nudgeSlides(-1, ids)}>
            {localize('Move up', '上移')}
          </MenuItem>
          <MenuItem icon={<ArrowDown className="size-4" />} onSelect={() => nudgeSlides(1, ids)}>
            {localize('Move down', '下移')}
          </MenuItem>
        </>
      ) : null}
      {single && maybeSession()?.shell ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<Link className="size-4" />} shortcut={`⌥${MOD}L`} onSelect={() => void copySlideLink(single)}>
            {localize('Copy link to slide', '复制幻灯片链接')}
          </MenuItem>
        </>
      ) : null}
      {held.length && agent && editing ? (
        <MenuItem icon={<Sparkles className="size-4" />} onSelect={() => void askAgentToFix(held)}>
          {localize('Ask agent to fix', '请 Agent 修复')}
        </MenuItem>
      ) : null}
    </>
  );
}
