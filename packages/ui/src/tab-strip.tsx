/**
 * A row of tabs like a browser's: an icon on the left, the title, a close button on the right. Tabs are dragged to
 * change their order (the others slide out of the way), closed with ×, a middle click, Delete or the right-click menu,
 * and the ones that do not fit go into a list behind a ▾ button at the end of the row. Picking a tab from that list
 * brings it into the row next to the last tab shown. + after the row either does what its owner says or, given
 * `newMenu`, opens a menu under it (the owner's lines: items with icons, headings and rules).
 *
 * A `fixed` tab (a home page) comes first, is never dragged, closed or put in the list.
 *
 * The row knows nothing of what its tabs show: the owner passes the tabs in order, which one is in front, and is told
 * what the person did (`onSelect`, `onClose`, `onReorder`). A reorder is shown at once and kept until the owner's
 * order says the same (or a second goes by).
 *
 * Keyboard: ←/→, Home and End move between tabs, Enter or Space brings one to the front, Delete or Backspace closes it,
 * Ctrl+Shift+←/→ (⌘⇧ on a Mac) moves it, Shift+F10 or the menu key opens its menu. A drag is cancelled with Escape.
 *
 * Its parts carry `data-slot` (`tab`, `tab-title`, `tab-close`) for an app's own rules and tests. The tab in front is
 * drawn on `surface`, the others on whatever the owner puts behind the row.
 */
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { ChevronDown, Plus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from './cn.ts';
import { MENU_ITEM_CLASS, MenuLabel, MenuSeparator, POPUP_CLASS } from './menu.tsx';
import { closeGroups, dragOrder, fitTabs, moveTo, pickedPlace, sameFit, type Fit } from './tab-strip-layout.ts';

export interface TabStripTab {
  id: string;
  title: string;
  /** Drawn left of the title. */
  icon?: ReactNode;
  /** The second line of the tab's row in the list of tabs that do not fit (its type, say). */
  detail?: string;
  /** Stays first: never dragged, closed or put in the list. */
  fixed?: boolean;
  /** Has a close button and the Close items of the menu. Default: not fixed. */
  closable?: boolean;
  /** Something is not saved: a dot where × is, until the pointer is over the tab. */
  marked?: boolean;
  markLabel?: string;
  /** Drawn after the title (what the tab is doing). */
  extra?: ReactNode;
  /** The tab's tooltip. Default: its title. */
  tooltip?: string;
  /** `data-*` attributes put on the tab. */
  attrs?: Record<`data-${string}`, string | undefined>;
}

/** A menu's line: an item, a rule between groups, or the name of the group under it. */
export type TabStripMenuItem =
  | {
      key: string;
      label: string;
      /** Drawn left of the label. */
      icon?: ReactNode;
      /** Said in the item's tooltip after its label. */
      detail?: string;
      testId?: string;
      /** `data-*` attributes put on the item. */
      attrs?: Record<`data-${string}`, string | undefined>;
      disabled?: boolean;
      onSelect(): void;
    }
  | 'separator'
  | { heading: string };

export interface TabStripWords {
  /** The row's name for screen readers. */
  label: string;
  newTab: string;
  moreTabs: string;
  /** × of a tab. */
  close(title: string): string;
  /** A tab's menu, for screen readers. */
  menu(title: string): string;
  closeTab: string;
  closeOthers: string;
  closeRight: string;
  closeAll: string;
}

export interface TabStripProps {
  tabs: TabStripTab[];
  activeId: string;
  words: TabStripWords;
  onSelect(id: string): void;
  /** Close these tabs (one, or several from the menu), in order. */
  onClose(ids: string[]): void;
  /** Put the tab at `index` of `tabs` (fixed tabs counted). */
  onReorder(id: string, index: number): void;
  /** + after the tabs (none without it, or without `newMenu`): what a click on it does. */
  onNew?(): void;
  /** What + offers instead: a click opens a menu of these under it. */
  newMenu?: TabStripMenuItem[];
  newTestId?: string;
  /** Items above the Close items of a tab's menu. */
  menuItems?(tab: TabStripTab): TabStripMenuItem[];
  /** A menu or the list opened or closed (it may be drawn over something the owner has to hide). */
  onPopupChange?(open: boolean): void;
  className?: string;
}

type Popup = { kind: 'tab'; id: string } | { kind: 'list' } | { kind: 'new' };

interface Drag {
  id: string;
  pointer: number;
  x0: number;
  /** Where in the tab it was taken, from its left edge. */
  grab: number;
  started: boolean;
  /** The order when it began (Escape puts it back). */
  before: string[];
  /** The tab's left edge in the row, where the pointer puts it. */
  left: number;
  el: HTMLElement;
}

/**
 * A tab's width without the room it was given. Not its width less that room: the room is whole pixels and the title
 * may take a little less of it, and a width off by that little flips the fit at the edge (the room goes, the tab fits,
 * the room comes back, it does not), so the title's own box is put back to its cap.
 */
function unstretched(el: HTMLElement, stretch: number) {
  const width = el.getBoundingClientRect().width;
  const title = stretch ? el.querySelector<HTMLElement>('[data-slot=tab-title]') : null;
  if (!title) return width;
  const shown = title.getBoundingClientRect().width;
  const cap = parseFloat(getComputedStyle(title).maxWidth) - stretch;
  return Number.isFinite(cap) ? width - shown + Math.min(shown, cap) : width - stretch;
}

/** How far the pointer moves before a press becomes a drag. */
const DRAG_START_PX = 4;
/** How long a reorder is shown while the owner has not said it (it may have refused). */
const REORDER_WAIT_MS = 1000;
const FRONT = '\0front';
const EMPTY_FIT: Fit = { hidden: new Set(), stretch: new Map(), clipped: new Set(), start: 0 };
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const closableOf = (tab: TabStripTab) => tab.closable ?? !tab.fixed;
const isMac = () => /Mac/i.test(navigator.platform);

const ROW_BUTTON =
  'grid size-7 flex-none cursor-default place-items-center rounded-[7px] border-0 bg-transparent p-0 text-fg-muted hover:bg-hover aria-expanded:bg-hover';
const SCROLLING_POPUP =
  'overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--color-fg)_22%,transparent)_transparent]';
const LIFTED = 'shadow-[0_0_0_0.5px_var(--color-line-strong),0_1px_2px_rgb(0_0_0/0.08)]';

export function TabStrip(props: TabStripProps) {
  const { tabs, activeId, words, onSelect, onClose, onReorder, onNew, newMenu, newTestId, menuItems, onPopupChange, className } = props;
  const rowRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const tabEls = useRef(new Map<string, HTMLElement>());

  // ---- the order shown: the owner's, or a reorder it has not said yet ----
  const ownIds = tabs.map((tab) => tab.id);
  const ownKey = ownIds.join('\0');
  const [override, setOverride] = useState<string[] | null>(null);
  const shownIds = override && sameSet(override, ownIds) ? override : ownIds;
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const shown = shownIds.map((id) => byId.get(id)!);
  const shownKey = shownIds.join('\0');
  useEffect(() => {
    if (!override) return;
    if (override.join('\0') === ownKey || !sameSet(override, ownIds)) return setOverride(null);
    const timer = setTimeout(() => setOverride(null), REORDER_WAIT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override, ownKey]);

  const [layout, setLayout] = useState<Fit>(EMPTY_FIT);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [popup, setPopup] = useState<Popup | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const moreWidth = useRef(28);
  /** The tab that takes the keyboard after the next render: after a move by key, or (FRONT) the one then in front after
   *  a close by key or a pick from the list. */
  const focusNext = useRef<string | null>(null);
  const latest = useRef({ shown, activeId });
  latest.current = { shown, activeId };

  // The owner hears of a menu only when one opens or the last one closes (and once more if the row goes away).
  const popupChange = useRef(onPopupChange);
  popupChange.current = onPopupChange;
  const popupOpen = !!popup;
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current === popupOpen) return;
    reported.current = popupOpen;
    popupChange.current?.(popupOpen);
  }, [popupOpen]);
  useEffect(
    () => () => {
      if (reported.current) popupChange.current?.(false);
    },
    [],
  );

  // ---- which tabs fit ----
  const refits = useRef(0);
  const measure = useCallback(() => {
    const strip = stripRef.current;
    const row = rowRef.current;
    if (!strip || !row || drag.current?.started) return;
    const { shown, activeId } = latest.current;
    const els = shown.map((tab) => tabEls.current.get(tab.id));
    if (els.some((el) => !el)) return;
    const current = layoutRef.current;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const rowStyle = getComputedStyle(row);
    const rowGap = parseFloat(rowStyle.columnGap) || 0;
    const more = moreRef.current?.getBoundingClientRect().width;
    if (more) moreWidth.current = more;
    const next = fitTabs({
      ids: shown.map((tab) => tab.id),
      fixed: shown.map((tab) => !!tab.fixed),
      // What each tab takes on its own (the room it was given taken off), and what its title would need to be whole.
      widths: shown.map((tab, i) => unstretched(els[i]!, current.stretch.get(tab.id) ?? 0)),
      needs: shown.map((tab, i) => {
        const title = els[i]!.querySelector<HTMLElement>('[data-slot=tab-title]');
        return title ? (current.stretch.get(tab.id) ?? 0) + Math.max(0, title.scrollWidth - title.clientWidth) : 0;
      }),
      gap,
      avail:
        row.clientWidth -
        (parseFloat(rowStyle.paddingLeft) || 0) -
        (parseFloat(rowStyle.paddingRight) || 0) -
        (newRef.current ? newRef.current.getBoundingClientRect().width + rowGap : 0),
      more: moreWidth.current + rowGap,
      activeId,
      start: current.start,
    });
    if (sameFit(next, current) && next.start === current.start) return;
    // A fit that keeps changing within one frame would render forever: it waits for the next frame instead.
    if (++refits.current > 8) return;
    if (refits.current === 1) requestAnimationFrame(() => (refits.current = 0));
    setLayout(next);
  }, []);

  useLayoutEffect(measure);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    void document.fonts?.ready.then(() => measure());
    return () => observer.disconnect();
  }, [measure]);

  // ---- the others slide when the order changes ----
  // Where each tab was drawn before this render, read while the page still shows the old order.
  const committedKey = useRef(shownKey);
  const before = useRef<Map<string, number> | null>(null);
  if (committedKey.current !== shownKey && !before.current) {
    before.current = new Map();
    for (const [id, el] of tabEls.current) if (el.isConnected) before.current.set(id, el.getBoundingClientRect().left);
  }
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (committedKey.current === shownKey) return;
    committedKey.current = shownKey;
    const dragging = drag.current?.started ? drag.current : null;
    if (dragging) dragging.el.style.transform = `translateX(${dragging.left - dragging.el.offsetLeft}px)`;
    if (!was || reducedMotion()) return;
    for (const [id, el] of tabEls.current) {
      if (el === dragging?.el || layoutRef.current.hidden.has(id)) continue;
      const from = was.get(id);
      if (from === undefined) continue;
      el.style.transition = 'none';
      el.style.transform = '';
      const delta = from - el.getBoundingClientRect().left;
      if (Math.abs(delta) >= 0.5) {
        el.style.transform = `translateX(${delta}px)`;
        void el.offsetWidth;
      }
      el.style.transition = '';
      el.style.transform = '';
    }
  }, [shownKey]);

  // ---- the keyboard follows a tab moved or brought to the front by key ----
  useEffect(() => {
    const id = focusNext.current;
    if (id === null) return;
    focusNext.current = null;
    tabEls.current.get(id === FRONT ? activeId : id)?.focus();
  });

  // ---- dragging ----
  const endDrag = useCallback(
    (commit: boolean) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onCancel);
      if (!current.started) return;
      const { el, id } = current;
      if (el.hasPointerCapture(current.pointer)) el.releasePointerCapture(current.pointer);
      // The click that ends a drag does not bring the tab to the front.
      const swallow = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      // The tab settles into its place.
      el.style.transition = '';
      el.style.transform = '';
      setTimeout(() => setDragId((was) => (was === id ? null : was)), reducedMotion() ? 0 : 200);
      const order = latest.current.shown.map((tab) => tab.id);
      if (!commit) {
        setOverride(sameSet(current.before, order) ? current.before : null);
        return;
      }
      const to = order.indexOf(id);
      if (to !== current.before.indexOf(id)) onReorder(id, to);
      else setOverride(null);
    },
    // The listeners are the stable ones below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onReorder],
  );
  const endRef = useRef(endDrag);
  endRef.current = endDrag;

  const onMove = useRef((event: PointerEvent) => {
    const current = drag.current;
    const strip = stripRef.current;
    if (!current || !strip || event.pointerId !== current.pointer) return;
    if (!current.started) {
      if (Math.abs(event.clientX - current.x0) < DRAG_START_PX) return;
      current.started = true;
      current.el.setPointerCapture(current.pointer);
      current.el.style.transition = 'none';
      setPopup(null);
      setDragId(current.id);
    }
    event.preventDefault();
    const { shown } = latest.current;
    const { el } = current;
    // The fixed tabs keep their place: the dragged one goes no further left than their end.
    const fixedEnd = shown.reduce((end, tab) => {
      const fixed = tab.fixed ? tabEls.current.get(tab.id) : undefined;
      return fixed ? Math.max(end, fixed.offsetLeft + fixed.offsetWidth) : end;
    }, 0);
    const width = el.offsetWidth;
    const left = Math.max(fixedEnd, Math.min(strip.clientWidth - width, event.clientX - strip.getBoundingClientRect().left - current.grab));
    current.left = left;
    el.style.transform = `translateX(${left - el.offsetLeft}px)`;
    const hidden = layoutRef.current.hidden;
    const order = shown.map((tab) => tab.id);
    const row = shown.filter((tab) => !hidden.has(tab.id) && !tab.fixed).map((tab) => tab.id);
    const next = dragOrder(order, row, current.id, left + width / 2, (id) => {
      const other = tabEls.current.get(id);
      return other ? other.offsetLeft + other.offsetWidth / 2 : Infinity;
    });
    if (next.join('\0') !== order.join('\0')) setOverride(next);
  }).current;
  const onUp = useRef((event: PointerEvent) => {
    if (drag.current && event.pointerId === drag.current.pointer) endRef.current(true);
  }).current;
  const onCancel = useRef(() => endRef.current(false)).current;
  const onKey = useRef((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !drag.current?.started) return;
    event.preventDefault();
    event.stopPropagation();
    endRef.current(false);
  }).current;
  useEffect(() => () => endRef.current(false), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, tab: TabStripTab) => {
    if (event.button !== 0 || tab.fixed || drag.current) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    const strip = stripRef.current;
    const el = tabEls.current.get(tab.id);
    if (!strip || !el) return;
    drag.current = {
      id: tab.id,
      pointer: event.pointerId,
      x0: event.clientX,
      grab: event.clientX - strip.getBoundingClientRect().left - el.offsetLeft,
      started: false,
      before: latest.current.shown.map((x) => x.id),
      left: el.offsetLeft,
      el,
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
  };

  // ---- what the tabs do ----
  const close = (ids: string[], byKey = false) => {
    if (!ids.length) return;
    if (byKey) focusNext.current = FRONT;
    onClose(ids);
  };
  const move = (tab: TabStripTab, step: number) => {
    const order = shown.map((x) => x.id);
    const from = order.indexOf(tab.id);
    const firstMoving = shown.findIndex((x) => !x.fixed);
    const to = from + step;
    if (tab.fixed || to < firstMoving || to >= order.length) return;
    setOverride(moveTo(order, tab.id, to));
    focusNext.current = tab.id;
    onReorder(tab.id, to);
  };
  const openMenu = (tab: TabStripTab) => {
    if (tab.fixed || !tabEls.current.get(tab.id)) return;
    setPopup({ kind: 'tab', id: tab.id });
  };
  const visible = shown.filter((tab) => !layout.hidden.has(tab.id));
  const focusTab = (tab: TabStripTab | undefined) => tab && tabEls.current.get(tab.id)?.focus();

  const onTabKey = (event: ReactKeyboardEvent<HTMLElement>, tab: TabStripTab) => {
    if (event.target !== event.currentTarget) return;
    const at = visible.indexOf(tab);
    const modifier = isMac() ? event.metaKey : event.ctrlKey;
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && modifier && event.shiftKey) {
      event.preventDefault();
      move(tab, event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      focusTab(visible[(at + step + visible.length) % visible.length]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusTab(event.key === 'Home' ? visible[0] : visible[visible.length - 1]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(tab.id);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && closableOf(tab)) {
      event.preventDefault();
      close([tab.id], true);
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      openMenu(tab);
    }
  };

  // ---- the list of tabs that do not fit ----
  const listed = shown.filter((tab) => layout.hidden.has(tab.id));
  const pick = (tab: TabStripTab) => {
    const order = shown.map((x) => x.id);
    const to = pickedPlace(order, tab.id, visible[visible.length - 1]?.id);
    setPopup(null);
    if (to !== null) {
      setOverride(moveTo(order, tab.id, to));
      onReorder(tab.id, to);
    }
    onSelect(tab.id);
    focusNext.current = FRONT;
  };
  useEffect(() => {
    if (popup?.kind === 'list' && listed.length === 0) setPopup(null);
    if (popup?.kind === 'new' && !newMenu) setPopup(null);
    if (popup?.kind === 'tab' && !shown.some((tab) => tab.id === popup.id)) setPopup(null);
  });

  const menuTab = popup?.kind === 'tab' ? byId.get(popup.id) : undefined;
  const menuEntries = (tab: TabStripTab): TabStripMenuItem[] => {
    const own = menuItems?.(tab) ?? [];
    const groups = closeGroups(
      shown.map((x) => x.id),
      (id) => closableOf(byId.get(id)!),
      tab.id,
    );
    return [
      ...own,
      ...(own.length ? ['separator' as const] : []),
      { key: 'close', label: words.closeTab, testId: 'tab-close-this', disabled: !closableOf(tab), onSelect: () => close([tab.id]) },
      { key: 'close-others', label: words.closeOthers, testId: 'tab-close-others', disabled: !groups.others.length, onSelect: () => close(groups.others) },
      { key: 'close-right', label: words.closeRight, testId: 'tab-close-right', disabled: !groups.right.length, onSelect: () => close(groups.right) },
      { key: 'close-all', label: words.closeAll, testId: 'tab-close-all', disabled: !groups.all.length, onSelect: () => close(groups.all) },
    ];
  };
  const openChange = (kind: 'list' | 'new') => (open: boolean) => setPopup((was) => (open ? { kind } : was?.kind === kind ? null : was));

  return (
    <div ref={rowRef} className={cn('flex min-w-0 flex-auto items-center gap-1 [--tab-floor:7rem] [--tab-title-max:10rem]', className)}>
      <div
        ref={stripRef}
        className="relative flex h-full min-w-0 flex-initial items-center gap-[3px] overflow-hidden select-none"
        role="tablist"
        aria-label={words.label}
        aria-orientation="horizontal"
        data-dragging={dragId ? 'true' : undefined}
      >
        {shown.map((tab) => {
          const selected = tab.id === activeId;
          const hidden = layout.hidden.has(tab.id);
          const stretch = layout.stretch.get(tab.id);
          const canClose = closableOf(tab);
          const menuOpen = menuTab?.id === tab.id;
          const dragging = dragId === tab.id;
          return (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) tabEls.current.set(tab.id, el);
                else tabEls.current.delete(tab.id);
              }}
              {...tab.attrs}
              data-slot="tab"
              className={cn(
                'group/tab flex h-7 flex-none cursor-default items-center gap-1.5 rounded-[7px] text-[13px] whitespace-nowrap text-fg-muted',
                'transition-[transform,background-color] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] focus-visible:-outline-offset-2 motion-reduce:transition-none',
                tab.fixed ? 'px-3' : 'min-w-[var(--tab-floor)] pr-1 pl-[9px]',
                // Out of the row, still measured: one of the two positions only (the later rule would win).
                hidden ? 'pointer-events-none invisible absolute top-0 left-0 w-max' : 'relative',
                selected ? cn('bg-surface font-medium text-fg', LIFTED) : !dragId && 'hover:bg-hover',
                menuOpen && !selected && 'bg-hover',
                dragging && cn('z-[2] shadow-[0_0_0_0.5px_var(--color-line-strong),0_2px_6px_rgb(0_0_0/0.12)]', selected ? 'bg-surface' : 'bg-canvas'),
              )}
              role="tab"
              aria-selected={selected}
              aria-hidden={hidden || undefined}
              tabIndex={selected && !hidden ? 0 : -1}
              title={tab.tooltip ?? tab.title}
              data-hidden={hidden ? 'true' : undefined}
              data-clipped={layout.clipped.has(tab.id) ? 'true' : undefined}
              data-marked={tab.marked ? 'true' : undefined}
              data-dragging={dragging ? 'true' : undefined}
              data-menu-open={menuOpen ? 'true' : undefined}
              style={stretch ? ({ '--tab-stretch': `${stretch}px` } as CSSProperties) : undefined}
              onPointerDown={(event) => onPointerDown(event, tab)}
              onClick={() => onSelect(tab.id)}
              onMouseDown={(event) => event.button === 1 && event.preventDefault()}
              onAuxClick={(event: ReactMouseEvent) => {
                if (event.button !== 1 || !canClose) return;
                event.preventDefault();
                close([tab.id]);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!drag.current?.started) openMenu(tab);
              }}
              onKeyDown={(event) => onTabKey(event, tab)}
            >
              {tab.icon && (
                <span className="flex flex-none" aria-hidden="true">
                  {tab.icon}
                </span>
              )}
              <span
                data-slot="tab-title"
                className={cn(
                  'max-w-[calc(var(--tab-title-max)+var(--tab-stretch,0px))] min-w-0 flex-initial overflow-hidden',
                  layout.clipped.has(tab.id) && '[mask-image:linear-gradient(to_right,#000_calc(100%-0.875rem),transparent)]',
                )}
              >
                {tab.title}
              </span>
              {tab.extra}
              {canClose && (
                <span className="ml-auto grid size-5 flex-none place-items-center *:[grid-area:1/1]">
                  {tab.marked && (
                    <span
                      data-testid="unsaved"
                      className={cn(
                        'size-1.5 rounded-full bg-fg-subtle group-hover/tab:opacity-0 group-focus-visible/tab:opacity-0',
                        menuOpen && 'opacity-0',
                      )}
                      title={tab.markLabel}
                      aria-label={tab.markLabel}
                    />
                  )}
                  <button
                    type="button"
                    data-slot="tab-close"
                    className={cn(
                      'grid size-5 place-items-center rounded-[5px] border-0 bg-transparent p-0 text-fg-muted hover:bg-hover',
                      menuOpen || (selected && !tab.marked) ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100 group-focus-visible/tab:opacity-100',
                      dragId && 'pointer-events-none',
                    )}
                    tabIndex={-1}
                    aria-label={words.close(tab.title)}
                    title={words.close(tab.title)}
                    onClick={(event) => {
                      event.stopPropagation();
                      close([tab.id]);
                    }}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <BaseMenu.Root open={popup?.kind === 'list'} onOpenChange={openChange('list')}>
        <BaseMenu.Trigger
          ref={moreRef}
          className={cn(ROW_BUTTON, listed.length === 0 && 'hidden')}
          data-testid="tab-more"
          aria-label={words.moreTabs}
          title={words.moreTabs}
        >
          <ChevronDown className="size-3.5" />
        </BaseMenu.Trigger>
        <BaseMenu.Portal>
          <BaseMenu.Positioner side="bottom" align="end" sideOffset={4} className="z-[1000]">
            <BaseMenu.Popup
              className={cn(POPUP_CLASS, SCROLLING_POPUP, 'max-h-[min(420px,var(--available-height))] w-[300px] select-none')}
              data-testid="tab-list"
              aria-label={words.moreTabs}
            >
              {listed.map((tab) => (
                <BaseMenu.Item
                  key={tab.id}
                  closeOnClick={false}
                  className="group/row flex min-h-10 cursor-default items-center gap-2.5 rounded-md py-1 pr-1 pl-2.5 outline-none data-[highlighted]:bg-hover"
                  data-tab-row={tab.id}
                  data-marked={tab.marked ? 'true' : undefined}
                  title={tab.tooltip ?? tab.title}
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest('[data-slot=tab-close]')) return;
                    pick(tab);
                  }}
                  onMouseDown={(event) => event.button === 1 && event.preventDefault()}
                  onAuxClick={(event) => {
                    if (event.button !== 1 || !closableOf(tab)) return;
                    event.preventDefault();
                    close([tab.id]);
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === 'Delete' || event.key === 'Backspace') && closableOf(tab)) {
                      event.preventDefault();
                      close([tab.id]);
                    }
                  }}
                >
                  {tab.icon && (
                    <span className="flex flex-none" aria-hidden="true">
                      {tab.icon}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{tab.title}</span>
                    {tab.detail && <span className="truncate text-xs text-fg-subtle">{tab.detail}</span>}
                  </span>
                  {tab.marked && <span className="size-1.5 flex-none rounded-full bg-fg-subtle" title={tab.markLabel} aria-label={tab.markLabel} />}
                  {closableOf(tab) && (
                    <button
                      type="button"
                      data-slot="tab-close"
                      className="grid size-6 flex-none place-items-center rounded-[5px] border-0 bg-transparent p-0 text-fg-muted opacity-0 group-hover/row:opacity-100 group-data-[highlighted]/row:opacity-100 hover:bg-hover"
                      tabIndex={-1}
                      aria-label={words.close(tab.title)}
                      title={words.close(tab.title)}
                      onClick={(event) => {
                        event.stopPropagation();
                        close([tab.id]);
                      }}
                    >
                      <X className="size-3.5" strokeWidth={2} />
                    </button>
                  )}
                </BaseMenu.Item>
              ))}
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      </BaseMenu.Root>

      {newMenu ? (
        <BaseMenu.Root open={popup?.kind === 'new'} onOpenChange={openChange('new')}>
          <BaseMenu.Trigger ref={newRef} className={ROW_BUTTON} data-testid={newTestId} aria-label={words.newTab} title={words.newTab}>
            <Plus className="size-4" />
          </BaseMenu.Trigger>
          <BaseMenu.Portal>
            <BaseMenu.Positioner side="bottom" align="start" sideOffset={4} className="z-[1000]">
              <BaseMenu.Popup
                className={cn(POPUP_CLASS, SCROLLING_POPUP, 'max-h-[min(520px,var(--available-height))] w-60')}
                data-testid="tab-new-menu"
                aria-label={words.newTab}
              >
                <MenuLines entries={newMenu} />
              </BaseMenu.Popup>
            </BaseMenu.Positioner>
          </BaseMenu.Portal>
        </BaseMenu.Root>
      ) : (
        onNew && (
          <button type="button" ref={newRef} className={ROW_BUTTON} data-testid={newTestId} aria-label={words.newTab} title={words.newTab} onClick={onNew}>
            <Plus className="size-4" />
          </button>
        )
      )}

      <BaseMenu.Root open={!!menuTab} onOpenChange={(open) => !open && setPopup((was) => (was?.kind === 'tab' ? null : was))}>
        <BaseMenu.Portal>
          <BaseMenu.Positioner
            anchor={() => (menuTab ? (tabEls.current.get(menuTab.id) ?? null) : null)}
            side="bottom"
            align="start"
            sideOffset={4}
            className="z-[1000]"
          >
            <BaseMenu.Popup
              className={cn(POPUP_CLASS, 'w-56')}
              data-testid="tab-menu"
              data-tab-menu={menuTab?.id}
              aria-label={menuTab ? words.menu(menuTab.title) : undefined}
              finalFocus={() => (menuTab ? (tabEls.current.get(menuTab.id) ?? null) : null)}
            >
              {menuTab && <MenuLines entries={menuEntries(menuTab)} />}
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      </BaseMenu.Root>
    </div>
  );
}

/** A menu's lines: its items, rules and group names. */
function MenuLines({ entries }: { entries: TabStripMenuItem[] }) {
  return entries.map((item, i) => {
    if (item === 'separator') return <MenuSeparator key={`rule-${i}`} />;
    if ('heading' in item) return <MenuLabel key={`heading-${i}`}>{item.heading}</MenuLabel>;
    return (
      <BaseMenu.Item
        key={item.key}
        className={MENU_ITEM_CLASS}
        data-testid={item.testId}
        {...item.attrs}
        disabled={item.disabled}
        title={item.detail ? `${item.label} — ${item.detail}` : undefined}
        onClick={() => item.onSelect()}
      >
        {item.icon && (
          <span className="flex size-4 flex-none items-center justify-center" aria-hidden="true">
            {item.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </BaseMenu.Item>
    );
  });
}
