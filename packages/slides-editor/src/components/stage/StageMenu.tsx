/**
 * The stage's right-click menu: element commands when something is
 * selected, otherwise paste, select all and the slide's own commands.
 */

import { localize } from '@open-artifact/runtime';
import { useState, type ReactNode } from 'react';
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  Crop,
  Group,
  ImageUp,
  MessageCircle,
  Paintbrush,
  Scissors,
  SendToBack,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react';
import { isTextual, nodeAt, rotationOf, samePath, type NodePath, type TableNode } from '@open-artifact/slides-core';
import { MenuItem, MenuSeparator, toast } from '@open-artifact/ui';
import { useView } from '../../state/view.ts';
import { tableTarget } from '../../lib/table-target.ts';
import { hasMemory, pasteFromMemory } from '../../services/clipboard.ts';
import { replaceImage, pickFiles } from '../../services/assets.ts';
import { canComment, elementAnchor, requestAnchoredComment } from '../../services/comments.ts';
import {
  copyStyle,
  currentSlide,
  deleteSelection,
  duplicateSelection,
  editableEntry,
  enterSelection,
  groupSelection,
  pasteStyle,
  reorderSelection,
  selectAll,
  selectedPaths,
  ungroupSelection,
  editTable,
  tableAddRefusal,
  tableRemoveRefusal,
} from '../../services/commands.ts';
import { SlideMenuItems } from '../SlideMenu.tsx';
import { MOD } from '@open-artifact/editor-kit';

const ALT = MOD === '⌘' ? '⌥' : 'Alt+';
const SHIFT = MOD === '⌘' ? '⇧' : 'Shift+';

/** Runs the browser's copy / cut so the document clipboard handlers write the payload. */
function clipboardCommand(command: 'copy' | 'cut'): void {
  // A menu click is a user gesture: the browser fires the copy / cut event.
  if (!document.execCommand(command)) toast.add({ title: localize(`Use ${MOD}${command === 'copy' ? 'C' : 'X'} to ${command}`, `按 ${MOD}${command === 'copy' ? 'C' : 'X'} ${command === 'copy' ? '复制' : '剪切'}`) });
}

/** Items of the stage menu. */
export function StageMenuItems(): ReactNode {
  const view = useView.getState();
  const slide = currentSlide();
  const editable = editableEntry(view.current) !== null;
  const paths = selectedPaths();
  if (!slide || !view.current) return null;

  if (paths.length === 0) {
    return (
      <>
        {editable ? (
          <MenuItem icon={<ClipboardPaste className="size-4" />} shortcut={`${MOD}V`} disabled={!hasMemory()} onSelect={() => pasteFromMemory()}>
            {localize('Paste', '粘贴')}
          </MenuItem>
        ) : null}
        <MenuItem shortcut={`${MOD}A`} onSelect={selectAll}>
          {localize('Select all', '全选')}
        </MenuItem>
        {canComment() ? (
          <MenuItem icon={<MessageCircle className="size-4" />} onSelect={() => requestAnchoredComment(elementAnchor(slide, null))}>
            {localize('Comment on slide', '评论此幻灯片')}
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <SlideMenuItems ids={[view.current]} />
      </>
    );
  }

  const single = paths.length === 1 ? paths[0]! : null;
  const node = single ? nodeAt(slide, single) : undefined;
  const isGroup = node?.kind === 'box' && node.group;
  return (
    <>
      {editable ? (
        <MenuItem icon={<Scissors className="size-4" />} shortcut={`${MOD}X`} onSelect={() => clipboardCommand('cut')}>
          {localize('Cut', '剪切')}
        </MenuItem>
      ) : null}
      <MenuItem icon={<Copy className="size-4" />} shortcut={`${MOD}C`} onSelect={() => clipboardCommand('copy')}>
        {localize('Copy', '复制')}
      </MenuItem>
      {editable ? (
        <>
          <MenuItem icon={<ClipboardPaste className="size-4" />} shortcut={`${MOD}V`} disabled={!hasMemory()} onSelect={() => pasteFromMemory()}>
            {localize('Paste', '粘贴')}
          </MenuItem>
          <MenuItem shortcut={`${MOD}D`} onSelect={duplicateSelection}>
            {localize('Duplicate', '复制一份')}
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-4" />} shortcut="⌫" danger onSelect={deleteSelection}>
            {localize('Delete', '删除')}
          </MenuItem>
          <MenuSeparator />
          {node && isTextual(node) ? (
            <MenuItem icon={<Type className="size-4" />} shortcut="↵" onSelect={enterSelection}>
              {localize('Edit text', '编辑文本')}
            </MenuItem>
          ) : null}
          {node?.kind === 'image' && node.src ? (
            <MenuItem
              icon={<Crop className="size-4" />}
              onSelect={() => {
                if (rotationOf(node)) toast.add({ title: localize('Straighten the picture to crop it', '将图片旋转角度归零后即可裁剪') });
                else useView.getState().setCropping(single);
              }}
            >
              {localize('Crop', '裁剪')}
            </MenuItem>
          ) : null}
          {node?.kind === 'image' && single ? (
            <MenuItem
              icon={<ImageUp className="size-4" />}
              onSelect={() => {
                void pickFiles('image/png,image/jpeg,image/gif,image/webp,image/svg+xml', false).then((files) => {
                  if (files[0]) void replaceImage(single, files[0]);
                });
              }}
            >
              {localize('Replace picture…', '替换图片…')}
            </MenuItem>
          ) : null}
          {node?.kind === 'table' && single ? <TableMenuItems table={node} path={single} /> : null}
          <MenuItem icon={<BringToFront className="size-4" />} shortcut="]" onSelect={() => reorderSelection('front')}>
            {localize('Bring to front', '置于顶层')}
          </MenuItem>
          <MenuItem shortcut={`${MOD}]`} onSelect={() => reorderSelection('forward')}>
            {localize('Bring forward', '上移一层')}
          </MenuItem>
          <MenuItem shortcut={`${MOD}[`} onSelect={() => reorderSelection('backward')}>
            {localize('Send backward', '下移一层')}
          </MenuItem>
          <MenuItem icon={<SendToBack className="size-4" />} shortcut="[" onSelect={() => reorderSelection('back')}>
            {localize('Send to back', '置于底层')}
          </MenuItem>
          <MenuSeparator />
          {paths.length > 1 ? (
            <MenuItem icon={<Group className="size-4" />} shortcut={`${MOD}G`} onSelect={groupSelection}>
              {localize('Group', '组合')}
            </MenuItem>
          ) : null}
          {isGroup ? (
            <MenuItem icon={<Ungroup className="size-4" />} shortcut={`${SHIFT}${MOD}G`} onSelect={ungroupSelection}>
              {localize('Ungroup', '取消组合')}
            </MenuItem>
          ) : null}
          <MenuItem icon={<Paintbrush className="size-4" />} shortcut={`${ALT}${MOD}C`} onSelect={copyStyle}>
            {localize('Copy style', '复制样式')}
          </MenuItem>
          <MenuItem shortcut={`${ALT}${MOD}V`} disabled={!view.styleClipboard} onSelect={pasteStyle}>
            {localize('Paste style', '粘贴样式')}
          </MenuItem>
        </>
      ) : null}
      {canComment() && single ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<MessageCircle className="size-4" />} onSelect={() => requestAnchoredComment(elementAnchor(slide, single))}>
            {localize('Comment', '评论')}
          </MenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * Rows and columns of a selected table: around the cell being typed in, or
 * at the end (adding) and the last one (removing) otherwise. The table and
 * cell are taken as the menu opens; the commands check them when chosen.
 */
function TableMenuItems({ table, path }: { table: TableNode; path: NodePath }): ReactNode {
  const [opened] = useState(() => {
    const { textEdit: edit, current } = useView.getState();
    return tableTarget(current ?? '', path, table, edit?.cell && samePath(edit.path, path) ? edit.cell : undefined);
  });
  const cell = opened.cell ?? null;
  const addRow = tableAddRefusal(table, 'row');
  const addColumn = tableAddRefusal(table, 'column');
  const removeRow = tableRemoveRefusal(table, 'row');
  const removeColumn = tableRemoveRefusal(table, 'column');
  return (
    <>
      {cell ? (
        <>
          <MenuItem disabled={addRow !== null} onSelect={() => editTable(opened.path, 'addRow', cell[0], opened)}>
            {localize('Insert row above', '在上方插入行')}
          </MenuItem>
          <MenuItem disabled={addRow !== null} onSelect={() => editTable(opened.path, 'addRow', cell[0] + 1, opened)}>
            {localize('Insert row below', '在下方插入行')}
          </MenuItem>
          <MenuItem disabled={addColumn !== null} onSelect={() => editTable(opened.path, 'addColumn', cell[1], opened)}>
            {localize('Insert column left', '在左侧插入列')}
          </MenuItem>
          <MenuItem disabled={addColumn !== null} onSelect={() => editTable(opened.path, 'addColumn', cell[1] + 1, opened)}>
            {localize('Insert column right', '在右侧插入列')}
          </MenuItem>
          <MenuItem disabled={removeRow !== null} onSelect={() => editTable(opened.path, 'removeRow', cell[0], opened)}>
            {localize('Delete row', '删除行')}
          </MenuItem>
          <MenuItem disabled={removeColumn !== null} onSelect={() => editTable(opened.path, 'removeColumn', cell[1], opened)}>
            {localize('Delete column', '删除列')}
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem disabled={addRow !== null} onSelect={() => editTable(opened.path, 'addRow', undefined, opened)}>
            {localize('Add a row', '添加一行')}
          </MenuItem>
          <MenuItem disabled={addColumn !== null} onSelect={() => editTable(opened.path, 'addColumn', undefined, opened)}>
            {localize('Add a column', '添加一列')}
          </MenuItem>
          <MenuItem disabled={removeRow !== null} onSelect={() => editTable(opened.path, 'removeRow', undefined, opened)}>
            {localize('Remove the last row', '移除最后一行')}
          </MenuItem>
          <MenuItem disabled={removeColumn !== null} onSelect={() => editTable(opened.path, 'removeColumn', undefined, opened)}>
            {localize('Remove the last column', '移除最后一列')}
          </MenuItem>
        </>
      )}
      <MenuSeparator />
    </>
  );
}
