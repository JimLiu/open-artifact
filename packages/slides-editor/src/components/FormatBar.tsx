/**
 * The text format strip: a small toolbar that floats next to the selected
 * text element, and stays while it is typed into.
 *
 * It holds the text style, the color, bold / italic / underline, the link,
 * the alignment and the list kind, then Properties; a selected
 * table has its rows and columns instead.
 * the properties panel is closed. While typing with text selected, the marks, the color and the
 * link apply to the selected text (the browser's editing commands, read back
 * by the editor); otherwise they apply to the whole element.
 *
 * It sits 10px above the selection, or below it when there is no room (see
 * `lib/floating.ts`), centered over it and kept inside the visible stage,
 * clear of the floating cards. While the pointer or the focus is in it (or
 * one of its menus is open) it stays where it is, so a selection that grows
 * under it does not pull it away. It hides while the selection is moved,
 * resized or drawn over, and fades while distances show. F6 moves the focus
 * into it.
 *
 * ⌘K while typing opens the strip's link field; while the strip is hidden
 * (the properties panel is open) the same field opens on its own, over the
 * selected text.
 */

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  Bold,
  ChevronDown,
  Ellipsis,
  Italic,
  Link2,
  List,
  ListOrdered,
  PanelRight,
  Underline,
  Unlink,
} from 'lucide-react';
import { LIMITS, isSafeHref, isTextual, nodeHasMark, nodeUniformLink, resizeTable, setListKind, setNodeMark, tableColumns, toggleNodeMark, type NodePath, type SlideNode, type TableNode } from '@open-artifact/slides-core';
import { Popover, cn, isComposingKey } from '@open-artifact/ui';
import { useSelectedNodes } from '../state/selection.ts';
import { useUi } from '../state/ui.ts';
import { useView } from '../state/view.ts';
import { ALIGN_KEYS, alignRefusal, alignSelection, canChange, patchSelectionStyle, selectionLockRefusal, updateSelection, type AlignEdge } from '../services/commands.ts';
import { placeFloatingAcross, placeFloatingToolbar, stripMiddle, type StripSpot } from '../lib/floating.ts';
import { isLinkKey } from '../lib/shortcut-keys.ts';
import { linkPromptBox } from '../lib/link-prompt.ts';
import { activeEditor, editorHasMark, editorSelectionCollapsed, editorSelectionHref, editorSelectionInLink, editorSelectionRange, focusEditor, formatEditor, linkEditorSelection } from './TextEditor.tsx';
import { useStageGesture } from './stage/store.ts';
import { ScaleStrip } from './ScaleStrip.tsx';
import { useScale } from '../services/scale.ts';
import { hasOpenOverlay } from '../lib/open-overlay.ts';
import { ColorPanel, useColorGroups } from './properties/ColorField.tsx';
import { Button, NumberInput, TextInput } from './properties/kit.tsx';
import { updateTable } from './properties/ContentSections.tsx';
import { useTextStyleMenu } from './properties/shared.tsx';
import { CHROME_CARD, CHROME_INSET } from './StageChrome.tsx';
import { isApplePlatform } from '@open-artifact/editor-kit';
import { ALT, ChromeButton, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, FoldDivider, FoldGroup, FoldToolbar, MOD, Tip, useFolded, type FoldBand } from '@open-artifact/editor-kit/react';

/** Height of the strip, px. */
const STRIP_HEIGHT = 40;

/** Room the rotation handle takes above a selected element, px. */
const ROTATE_HANDLE = 36;

/** How far from the strip's ends the rotation handle still counts as under it, px. */
const HANDLE_CLEARANCE = 16;

const ICON = { className: 'size-4', strokeWidth: 1.75 } as const;

const ALIGNS = [
  ['left', 'Align left', AlignLeft],
  ['center', 'Center', AlignCenter],
  ['right', 'Align right', AlignRight],
  ['justify', 'Justify', AlignJustify],
] as const;

type Align = (typeof ALIGNS)[number][0];

/** Aligning several elements to each other, in two rows: across, then down. */
const ITEM_ALIGNS = [
  [
    ['left', 'Align left', AlignStartVertical],
    ['center', 'Align horizontal centers', AlignCenterVertical],
    ['right', 'Align right', AlignEndVertical],
  ],
  [
    ['top', 'Align top', AlignStartHorizontal],
    ['middle', 'Align vertical centers', AlignCenterHorizontal],
    ['bottom', 'Align bottom', AlignEndHorizontal],
  ],
] as const satisfies readonly (readonly (readonly [AlignEdge, string, unknown])[])[];

/** True when a node has text the strip formats. */
function hasText(node: SlideNode): boolean {
  return isTextual(node) || node.kind === 'table';
}

/** True when marks should go to the text selected in the editor. */
function onSelectedText(): boolean {
  return Boolean(activeEditor()) && !editorSelectionCollapsed();
}

/** Puts the focus back into the text being typed after a menu or popover closes. */
function refocusEditor(): void {
  // After the popup has handed the focus back to its trigger.
  setTimeout(() => {
    if (activeEditor()) focusEditor();
  }, 0);
}

/** Buttons of the strip must not take the focus (and the selection) from the text. */
function keepTextFocus(event: MouseEvent): void {
  const target = event.target as Element;
  if (activeEditor() && !target.closest('input, textarea, [contenteditable]')) event.preventDefault();
}

/** Re-renders on caret moves (the B / I / U state follows the caret). */
function useSelectionTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((n) => n + 1);
    document.addEventListener('selectionchange', bump);
    return () => document.removeEventListener('selectionchange', bump);
  }, []);
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                   */
/* -------------------------------------------------------------------------- */

/** The selection's box and the visible band of the stage, in client px. */
interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  band: { left: number; right: number; top: number; bottom: number };
}

function sameAnchor(a: Anchor | null, b: Anchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom && a.band.left === b.band.left && a.band.right === b.band.right && a.band.top === b.band.top && a.band.bottom === b.band.bottom;
}

/** Measures the selected elements (or the editor) against the stage. */
function measureAnchor(paths: readonly NodePath[]): Anchor | null {
  const stage = document.querySelector<HTMLElement>('[data-open-artifact-stage]');
  if (!stage) return null;
  const editor = activeEditor();
  const elements = editor ? [editor] : paths.map((p) => stage.querySelector<HTMLElement>(`[data-open-artifact-path="${p.join('.')}"]`)).filter((el): el is HTMLElement => el !== null);
  if (elements.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
  }
  const s = stage.getBoundingClientRect();
  return {
    left: Math.round(left),
    right: Math.round(right),
    top: Math.round(top),
    bottom: Math.round(bottom),
    // The top cards and the bottom toolbar float over the stage: stay between them.
    band: { left: Math.round(s.left), right: Math.round(s.right), top: Math.round(s.top + CHROME_INSET + CHROME_CARD), bottom: Math.round(s.bottom - CHROME_CARD - CHROME_INSET) },
  };
}

/** Follows the selection on screen (scrolling, zooming, typing, moving) every frame. */
function useAnchor(paths: readonly NodePath[] | null): Anchor | null {
  // Kept with the selection it was measured for: a box left from the previous selection is never returned.
  const [anchor, setAnchor] = useState<{ key: string; box: Anchor } | null>(null);
  const key = paths ? paths.map((p) => p.join('.')).join(',') : null;
  useLayoutEffect(() => {
    if (!paths || key === null) {
      setAnchor(null);
      return;
    }
    let frame = 0;
    const tick = (): void => {
      const next = measureAnchor(paths);
      setAnchor((prev) => (prev?.key === key && sameAnchor(prev.box, next) ? prev : next ? { key, box: next } : null));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
    // `key` stands for `paths` (a new array on every render).
  }, [key]);
  return anchor && anchor.key === key ? anchor.box : null;
}

/** True when the strip should stay put: the pointer is on it (or a finger pressed it), the focus is in it, or a menu, popover or dialog is open anywhere. */
function stripHeld(strip: HTMLElement | null, touched: boolean): boolean {
  if (!strip) return false;
  if (touched || strip.matches(':hover') || hasOpenOverlay()) return true;
  // Menus and popovers render outside the strip but carry its attribute.
  return document.hasFocus() && Boolean(document.activeElement?.closest('[data-open-artifact-format-bar]'));
}

/**
 * The strip's center across, for the selection's box on screen: its
 * middle, unless the strip is held (see `stripMiddle`). Once let go, it
 * goes back to the middle within 200ms.
 */
function useStripMiddle(strip: RefObject<HTMLDivElement | null>, key: string, box: Anchor | null, typing: boolean): number {
  const last = useRef<StripSpot | null>(null);
  const touched = useRef(false);
  const [, recheck] = useState(0);
  const left = box?.left ?? 0;
  const width = box ? box.right - box.left : 0;
  const middle = stripMiddle(last.current, key, left, width, typing || stripHeld(strip.current, touched.current));
  useLayoutEffect(() => {
    // Only a box measured for this selection is a place to stay at.
    last.current = box ? { key, left, width, middle } : null;
  });
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      touched.current = event.pointerType === 'touch' && Boolean(strip.current?.contains(event.target as Node));
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [strip]);
  const away = Math.abs(middle - (left + width / 2)) >= 0.5;
  useEffect(() => {
    if (!away || typing) return;
    const timer = setInterval(() => {
      if (!stripHeld(strip.current, touched.current)) recheck((n) => n + 1);
    }, 200);
    return () => clearInterval(timer);
  }, [away, typing, strip]);
  return middle;
}

/** The caret's box while typing. */
function caretBox(): { top: number; bottom: number } | null {
  const selection = window.getSelection();
  if (!activeEditor() || !selection?.rangeCount) return null;
  const rects = selection.getRangeAt(0).getClientRects();
  const r = rects.length ? rects[rects.length - 1]! : selection.getRangeAt(0).getBoundingClientRect();
  return r.height ? { top: r.top, bottom: r.bottom } : null;
}

/* -------------------------------------------------------------------------- */
/* The strip                                                                   */
/* -------------------------------------------------------------------------- */

/** The floating strip, and the link field ⌘K opens while the strip is hidden. */
export function FormatBar(): ReactNode {
  return (
    <>
      <FormatStrip />
      <LinkPrompt />
    </>
  );
}

/** The floating strip (renders nothing unless text is selected on the stage). */
function FormatStrip(): ReactNode {
  const { slide, paths, nodes, readOnly } = useSelectedNodes();
  const textEdit = useView((s) => s.textEdit);
  const tool = useView((s) => s.tool);
  const cropping = useView((s) => s.cropping);
  const gesturing = useStageGesture((s) => Boolean(s.move || s.draft || s.marquee || s.draw));
  const measuring = useStageGesture((s) => s.measuring);
  //.
  const showProperties = useView((s) => s.showProperties);
  const scaleOn = useScale((s) => s.session !== null);
  const visible = scaleOn || (!readOnly && canChange() && !showProperties && nodes.length > 0 && nodes.every(hasText) && tool === 'select' && !cropping && !gesturing);
  const anchor = useAnchor(visible ? paths : null);
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (strip.current) setWidth(strip.current.offsetWidth);
  });
  // The strip also changes width on its own, when it folds into "More tools" or unfolds: it is placed again then.
  const shown = visible && anchor !== null && Boolean(slide);
  useLayoutEffect(() => {
    const node = strip.current;
    if (!shown || !node) return;
    const observer = new ResizeObserver(() => setWidth(node.offsetWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);
  const spotKey = `${paths.map((p) => p.join('.')).join(',')}|${textEdit?.cell?.join('.') ?? ''}`;
  const middle = useStripMiddle(strip, spotKey, anchor, Boolean(textEdit && !textEdit.cell) || scaleOn);
  // While scaling, the strip stays where it appeared: the preview and the grips move under it.
  const heldTop = useRef<number | null>(null);
  if (!scaleOn) heldTop.current = null;

  if (!visible || !anchor || !slide) return null;
  const { band } = anchor;
  // Scrolled out of view: hide rather than pin to an edge.
  if (!scaleOn && (anchor.bottom < band.top || anchor.top > band.bottom)) return null;
  const left = placeFloatingAcross(middle, width, band.left, band.right);
  //. A selected element
  // (not being typed into) has a rotation handle above its middle: when the
  // strip would cover it, the strip goes above the handle instead.
  const handle = (anchor.left + anchor.right) / 2;
  const lift = !textEdit && nodes.length === 1 && handle >= left - HANDLE_CLEARANCE && handle <= left + width + HANDLE_CLEARANCE ? ROTATE_HANDLE : 0;
  const placed = placeFloatingToolbar({
    selTop: anchor.top - lift,
    selBottom: anchor.bottom,
    menuH: STRIP_HEIGHT,
    bandTop: band.top,
    bandBottom: band.bottom,
    caret: caretBox,
  });
  const top = scaleOn ? (heldTop.current ??= placed.top) : placed.top;
  const fold: StripFold = { foldKey: spotKey, placed: placed.placed, band: { top: band.top, bottom: band.bottom }, limit: band.right - band.left - 16 };

  return (
    <div
      ref={strip}
      data-open-artifact-format-bar
      data-measuring={measuring || undefined}
      className="pointer-events-none fixed z-30 flex"
      style={{ left, top, maxWidth: band.right - band.left - 16 }}
    >
      {scaleOn ? (
        <ScaleStrip />
      ) : nodes.length === 1 && nodes[0]!.kind === 'table' && !textEdit ? (
        <TableStrip table={nodes[0] as TableNode} path={paths[0]!} fold={fold} />
      ) : (
        <Strip nodes={nodes} fold={fold} />
      )}
    </div>
  );
}

/** Where a strip sits, for its "More tools" card: the selection it acts on, its side, the room the card may use and the strip's widest. */
interface StripFold {
  foldKey: string;
  placed: 'above' | 'below';
  band: FoldBand;
  limit: number;
}

/** The controls. */
function Strip({ nodes, fold }: { nodes: SlideNode[]; fold: StripFold }): ReactNode {
  useSelectionTick();
  const editing = useView((s) => s.textEdit !== null);
  const single = nodes.length === 1 ? nodes[0]! : null;
  const textNode = single?.kind === 'text' ? single : null;
  const styleMenu = useTextStyleMenu(textNode);
  const first = nodes[0]!;
  const align = (first.style['text-align'] ?? 'left') as Align;
  const alignSame = nodes.every((n) => (n.style['text-align'] ?? 'left') === align);
  const AlignIcon = ALIGNS.find(([value]) => value === align)?.[2] ?? AlignLeft;
  const listKind = single?.kind === 'list' ? single.tag : null;

  const mark = (key: 'b' | 'i' | 'u'): void => {
    if (onSelectedText()) formatEditor(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
    else updateSelection(key === 'b' ? 'Bold' : key === 'i' ? 'Italic' : 'Underline', (node) => toggleNodeMark(node, key));
  };
  const markOn = (key: 'b' | 'i' | 'u'): boolean =>
    editing && activeEditor() ? editorHasMark(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline') : nodes.every((n) => nodeHasMark(n, key));
  const setList = (kind: 'ul' | 'ol' | null): void => {
    updateSelection('List', (node) => (node.kind === 'text' || node.kind === 'list' ? setListKind(node, kind) : node));
    refocusEditor();
  };

  return (
    <FoldToolbar aria-label="Text format" className="min-w-0" rowClassName="h-10 gap-0.5 px-1" fold {...fold} onMouseDown={keepTextFocus}>
      {textNode ? (
        <>
          <FoldGroup>
          <ChromeMenu
            tip={{ label: 'Text style' }}
            trigger={
              <ChromeButton aria-label="Text style" className="max-w-[148px] gap-0.5 pl-2 pr-1">
                <span className="min-w-0 truncate">{styleMenu.options.find((o) => o.value === styleMenu.value)?.label ?? 'Custom'}</span>
                <ChevronDown className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
              </ChromeButton>
            }
          >
            {styleMenu.options.map((option) => (
              <ChromeMenuItem
                key={option.value}
                checked={option.value === styleMenu.value}
                onSelect={() => {
                  styleMenu.apply(option.value);
                  refocusEditor();
                }}
              >
                {option.label}
              </ChromeMenuItem>
            ))}
          </ChromeMenu>
          </FoldGroup>
          <FoldDivider />
        </>
      ) : null}
      <FoldGroup>
      <TextColor value={first.style.color ?? null} />
      <Tip label="Bold" shortcut={`${MOD}B`}>
        <ChromeButton square aria-label="Bold" pressed={markOn('b')} onClick={() => mark('b')}>
          <Bold {...ICON} />
        </ChromeButton>
      </Tip>
      <Tip label="Italic" shortcut={`${MOD}I`}>
        <ChromeButton square aria-label="Italic" pressed={markOn('i')} onClick={() => mark('i')}>
          <Italic {...ICON} />
        </ChromeButton>
      </Tip>
      <Tip label="Underline" shortcut={`${MOD}U`}>
        <ChromeButton square aria-label="Underline" pressed={markOn('u')} onClick={() => mark('u')}>
          <Underline {...ICON} />
        </ChromeButton>
      </Tip>
      <LinkButton node={single} />
      </FoldGroup>
      <FoldDivider />
      <FoldGroup>
      <ChromeMenu
        tip={{ label: 'Alignment' }}
        trigger={
          <ChromeButton aria-label="Alignment" className="gap-0 pl-1.5 pr-0.5">
            <AlignIcon {...ICON} />
            <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
          </ChromeButton>
        }
      >
        {ALIGNS.map(([value, label, Icon]) => (
          <ChromeMenuItem
            key={value}
            checked={alignSame && align === value}
            icon={<Icon className="size-4" />}
            onSelect={() => {
              patchSelectionStyle('Align', { 'text-align': value === 'left' ? undefined : value });
              refocusEditor();
            }}
          >
            {label}
          </ChromeMenuItem>
        ))}
      </ChromeMenu>
      {nodes.length > 1 ? <AlignItems nodes={nodes} /> : null}
      {single && (single.kind === 'text' || single.kind === 'list') ? (
        <ChromeMenu
          tip={{ label: 'List' }}
          trigger={
            <ChromeButton aria-label="List" pressed={listKind !== null} className="gap-0 pl-1.5 pr-0.5">
              {listKind === 'ol' ? <ListOrdered {...ICON} /> : <List {...ICON} />}
              <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
            </ChromeButton>
          }
        >
          <ChromeMenuItem checked={listKind === null} onSelect={() => setList(null)}>
            No list
          </ChromeMenuItem>
          <ChromeMenuItem checked={listKind === 'ul'} icon={<List className="size-4" />} onSelect={() => setList('ul')}>
            Bulleted list
          </ChromeMenuItem>
          <ChromeMenuItem checked={listKind === 'ol'} icon={<ListOrdered className="size-4" />} onSelect={() => setList('ol')}>
            Numbered list
          </ChromeMenuItem>
        </ChromeMenu>
      ) : null}
      </FoldGroup>
      <FoldDivider />
      <FoldGroup tail>
        <PropertiesButton />
      </FoldGroup>
    </FoldToolbar>
  );
}

/** The strip shows while the properties panel is closed. */
function PropertiesButton(): ReactNode {
  const folded = useFolded();
  return (
    <Tip label="Open the Properties panel" shortcut={`${MOD}\\`}>
      <ChromeButton square aria-label="Properties" data-fold-more="" onClick={() => useView.getState().toggle('showProperties', true)}>
        {folded ? <PanelRight {...ICON} /> : <Ellipsis {...ICON} />}
      </ChromeButton>
    </Tip>
  );
}

/** Rows (three lines across). */
function RowsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" aria-hidden="true">
      <path d="M3.865 4H12.135M3.865 8H12.135M3.865 12H12.135" />
    </svg>
  );
}

/** Columns (three lines down). */
function ColumnsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" aria-hidden="true">
      <path d="M4 3.865V12.135M8 3.865V12.135M12 3.865V12.135" />
    </svg>
  );
}

/** A selected table (not a cell being typed into): its rows and columns, then the actions. */
function TableStrip({ table, path, fold }: { table: TableNode; path: NodePath; fold: StripFold }): ReactNode {
  const rows = table.rows.length;
  const cols = tableColumns(table);
  return (
    <FoldToolbar aria-label="Table" className="min-w-0" rowClassName="h-10 gap-1 px-1" fold {...fold}>
      <FoldGroup className="gap-1">
      <NumberInput
        aria-label="Rows"
        title="Rows. Fewer rows drop the bottom rows’ text (undoable)"
        label={<RowsIcon />}
        value={rows}
        min={1}
        max={LIMITS.tableRows}
        className="w-[76px] shrink-0"
        onCommit={(v) => v && v !== rows && updateTable(path, 'Table rows', (t) => resizeTable(t, v, tableColumns(t)))}
      />
      <NumberInput
        aria-label="Columns"
        title="Columns. Fewer columns drop the rightmost columns’ text (undoable)"
        label={<ColumnsIcon />}
        value={cols}
        min={1}
        max={LIMITS.tableColumns}
        className="w-[76px] shrink-0"
        onCommit={(v) => v && v !== cols && updateTable(path, 'Table columns', (t) => resizeTable(t, t.rows.length, v))}
      />
      </FoldGroup>
      <FoldDivider />
      <FoldGroup tail>
        <PropertiesButton />
      </FoldGroup>
    </FoldToolbar>
  );
}

/** Aligning the selected elements to each other (⌥A/H/D/W/V/S). */
function AlignItems({ nodes }: { nodes: SlideNode[] }): ReactNode {
  const refused = alignRefusal(nodes) ?? selectionLockRefusal();
  if (refused) {
    return (
      <Tip label={`Align items. ${refused}`}>
        <ChromeButton square aria-label="Align items" disabled>
          <AlignStartVertical {...ICON} />
        </ChromeButton>
      </Tip>
    );
  }
  return (
    <ChromeMenu
      tip={{ label: 'Align items' }}
      trigger={
        <ChromeButton aria-label="Align items" className="gap-0 pl-1.5 pr-0.5">
          <AlignStartVertical {...ICON} />
          <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      {ITEM_ALIGNS.map((row, i) => [
        i > 0 ? <ChromeMenuSeparator key={`sep${i}`} /> : null,
        ...row.map(([edge, label, Icon]) => (
          <ChromeMenuItem key={edge} icon={<Icon className="size-4" />} shortcut={`${ALT}${ALIGN_KEYS[edge]}`} onSelect={() => alignSelection(edge)}>
            {label}
          </ChromeMenuItem>
        )),
      ])}
    </ChromeMenu>
  );
}

/** Text color: of the selected text while typing, else of the element. */
function TextColor({ value }: { value: string | null }): ReactNode {
  const groups = useColorGroups();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      side="bottom"
      align="start"
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) refocusEditor();
      }}
      trigger={
        <ChromeButton square aria-label="Text color" title="Text color" className="flex-col gap-0">
          <span className="text-[14px] font-semibold leading-none">A</span>
          <span className="mt-0.5 h-[3px] w-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: value ?? 'currentColor' }} />
        </ChromeButton>
      }
    >
      <div data-open-artifact-format-bar className="w-60">
        <ColorPanel
          value={value}
          groups={groups}
          onClose={() => {
            setOpen(false);
            refocusEditor();
          }}
          onPick={(color) => {
            if (!color) return;
            if (onSelectedText()) {
              // Coloring a run puts focus back in the text, so the popover
              // closes with it: otherwise Escape would end the edit under it.
              formatEditor('foreColor', color);
              setOpen(false);
            } else patchSelectionStyle('Text color', { color }, { coalesce: 'text-color' });
          }}
        />
      </div>
    </Popover>
  );
}

/** Link buttons on screen: while one is, ⌘K opens its field rather than the one of {@link LinkPrompt}. */
let linkButtonsShown = 0;

/**
 * The link field: the address, then Remove (when there is a link) and Apply.
 * It links the text selected while typing, or else the whole selected
 * elements, and calls `onDone` once it has.
 */
function LinkFields({ node, onDone }: { node: SlideNode | null; onDone: () => void }): ReactNode {
  const [current] = useState(() => editorSelectionHref() ?? (node ? nodeUniformLink(node) : undefined));
  const [url, setUrl] = useState(current ?? '');
  const valid = isSafeHref(url.trim());
  const apply = (): void => {
    const href = url.trim();
    if (!isSafeHref(href)) return;
    if (onSelectedText() || editorSelectionInLink()) linkEditorSelection(href);
    else updateSelection('Link', (n) => setNodeMark(n, 'href', href));
    onDone();
  };
  const remove = (): void => {
    if (activeEditor()) formatEditor('unlink');
    else updateSelection('Remove link', (n) => setNodeMark(n, 'href', undefined));
    onDone();
  };
  return (
    <div data-open-artifact-format-bar className="flex w-72 flex-col gap-2">
      <TextInput
        autoFocus
        aria-label="Link address"
        placeholder="https://"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => {
          if (isLinkKey(event, isApplePlatform())) event.preventDefault();
          if (isComposingKey(event.nativeEvent)) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
        }}
      />
      {url.trim() && !valid ? <p className="text-[12px] text-danger">Links must start with http:// or https://</p> : null}
      <div className="flex justify-end gap-1">
        {current ? (
          <Button size="sm" variant="ghost" icon={<Unlink className="size-3.5" />} onClick={remove}>
            Remove
          </Button>
        ) : null}
        <Button size="sm" variant="primary" disabled={!valid} onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

/** The strip's link button and its field. */
function LinkButton({ node }: { node: SlideNode | null }): ReactNode {
  const [open, setOpen] = useState(false);
  const current = editorSelectionHref() ?? (node ? nodeUniformLink(node) : undefined);
  const requests = useUi((s) => s.linkRequests);
  // Only a request made while the button is shown opens it: one made while the strip was hidden is not kept for later.
  const seen = useRef(requests);
  useEffect(() => {
    linkButtonsShown++;
    return () => {
      linkButtonsShown--;
    };
  }, []);
  useEffect(() => {
    if (requests === seen.current) return;
    seen.current = requests;
    setOpen(true);
  }, [requests]);
  return (
    <Popover
      open={open}
      side="bottom"
      align="start"
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) refocusEditor();
      }}
      trigger={
        <ChromeButton square aria-label="Link" title={`Link (${MOD}K)`} pressed={Boolean(current)} data-fold-keep="">
          <Link2 {...ICON} />
        </ChromeButton>
      }
    >
      <LinkFields node={node} onDone={() => setOpen(false)} />
    </Popover>
  );
}

/**
 * The link field on its own, over the text being typed into: what ⌘K opens
 * while the strip (and its link button) is hidden. Escape or a press outside
 * closes it and gives the focus back to the text.
 */
function LinkPrompt(): ReactNode {
  const requests = useUi((s) => s.linkRequests);
  const editing = useView((s) => Boolean(s.textEdit));
  const { nodes } = useSelectedNodes();
  const seen = useRef(requests);
  const [range, setRange] = useState<Range | null>(null);
  useEffect(() => {
    if (requests === seen.current) return;
    seen.current = requests;
    if (linkButtonsShown > 0 || !activeEditor()) return;
    setRange(editorSelectionRange());
  }, [requests]);
  useEffect(() => {
    if (!editing) setRange(null);
  }, [editing]);
  if (!range || !editing) return null;
  const editor = activeEditor();
  // Measured on every placement, so the field follows the text when the stage scrolls.
  const anchor = {
    contextElement: editor ?? undefined,
    getBoundingClientRect: (): DOMRect => {
      const r = range.getBoundingClientRect();
      const box = linkPromptBox({ x: r.x, y: r.y, width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight });
      return DOMRect.fromRect(box);
    },
  };
  const close = (): void => setRange(null);
  return (
    <BasePopover.Root
      open
      onOpenChange={(next) => {
        if (next) return;
        close();
        refocusEditor();
      }}
    >
      <BasePopover.Portal>
        <BasePopover.Positioner anchor={anchor} side="top" align="start" sideOffset={8} collisionPadding={8} className="z-[1000]">
          <BasePopover.Popup aria-label="Link" finalFocus={false} className={cn(POPUP_LOOK, 'p-3')}>
            <LinkFields node={nodes.length === 1 ? nodes[0]! : null} onDone={close} />
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** The look of the UI kit's popovers. */
const POPUP_LOOK =
  'rounded-lg bg-surface text-[13px] text-fg shadow-popup outline-none origin-[var(--transform-origin)] transition-[opacity,transform] duration-100 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0';
