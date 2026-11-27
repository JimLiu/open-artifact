/**
 * The `@` list of a comment box. While the text before the caret is an `@name` being typed, a list of who it can name
 * opens over the `@` (the agent first); arrows move through it, Enter or Tab or a click puts the name in, Escape closes
 * it. Focus stays in the box all along: the list is a listbox the box drives, and a polite status next to the box says
 * which row is highlighted.
 *
 * {@link useMentions} is shared by the composer and the edit box. It also remembers whom each picked `@Name` stands
 * for, so the box can say whom the message names when it is sent.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { isComposingKey } from '@open-artifact/ui';
import {
  applyMention,
  mentionOptions,
  mentionPieces,
  mentionsName,
  mentionTargets,
  optionPosition,
  stillClosed,
  typedMention,
  type ClosedMention,
  type MentionOption,
  type MentionPerson,
  type MentionPick,
} from '../mentions.ts';

/** Class names, skipping the empty ones. */
const classes = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

/** Who a box's `@` can name. */
export interface MentionsSpec {
  agentName: string;
  /** The viewer may send to the agent: it gets a row, and a message that mentions it goes to it. */
  agentListed: boolean;
  /** Everyone else, in the order to list them. */
  people(): readonly MentionPerson[];
  /** The viewer: never listed. */
  self: { id?: string; name: string };
  /** The first `@` typed in this box (to start fetching who has the artifact). */
  onFirstUse?(): void;
  /** Whom the text already names (a message being edited): their `@Name`s keep naming them. */
  picked?: readonly MentionPick[];
  /** The small picture in front of a row's name. */
  avatar?(option: MentionOption): ReactNode;
}

/** What the box shows and does with {@link useMentions}. */
export interface MentionField {
  /** Call first from the box's keydown: true when the list took the key. */
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean;
  onKeyUp(event: KeyboardEvent<HTMLTextAreaElement>): void;
  /** Click, focus: the caret may have moved. */
  onCaret(): void;
  onBlur(): void;
  /** The text mentions the agent (and the agent may be asked). */
  mentionsAgent: boolean;
  /** Whom `text` names: `agent` first when it mentions the agent, then the picked people still in it. */
  targets(text: string): string[];
  /** The `@names` drawn as mentions in the box and in cards. */
  names: readonly string[];
  /** The list (in the layer's portal) and the status region: render both. */
  parts: ReactNode;
  /** The textarea's `aria-*` while the list is open. */
  aria: { 'aria-controls'?: string; 'aria-activedescendant'?: string; 'aria-autocomplete': 'list'; 'aria-expanded': boolean };
}

const LIST_WIDTH = 288;
const LIST_MAX_HEIGHT = 384;
const EDGE = 16;
const OFFSET = 24;

const LIST =
  'pointer-events-auto fixed z-[1] flex flex-col overflow-y-auto overscroll-contain scroll-thin rounded-card bg-surface-3 p-[0.25rem] shadow-panel font-sans text-body font-normal text-primary outline-none';
const ROW = 'flex min-h-control w-full min-w-0 cursor-default select-none items-center gap-xs rounded px-2 text-body';

/** `@` handling for a comment box (see the module comment). */
export function useMentions(spec: MentionsSpec | undefined, value: string, onChange: (value: string) => void, field: RefObject<HTMLTextAreaElement | null>): MentionField {
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [closed, setClosed] = useState<ClosedMention | null>(null);
  const [keyRow, setKeyRow] = useState(0);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [picks, setPicks] = useState<MentionPick[]>(() => [...(spec?.picked ?? [])]);
  const [added, setAdded] = useState('');
  const placeCaret = useRef<number | null>(null);
  const used = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const scrollToKeyRow = useRef(false);

  const typed = spec && caret !== null ? typedMention(value, caret) : null;
  const options: MentionOption[] =
    spec && typed && !stillClosed(closed, typed)
      ? mentionOptions({ query: typed.query, agentName: spec.agentName, agentListed: spec.agentListed, people: spec.people(), self: spec.self })
      : [];
  const open = options.length > 0;
  const shown = Math.min(hoverRow ?? keyRow, options.length - 1);

  const readCaret = (): void => {
    const el = field.current;
    if (!el || el.ownerDocument.activeElement !== el && (el.getRootNode() as Document | ShadowRoot).activeElement !== el) return setCaret(null);
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionEnd : null);
  };

  // The text changed (typed, or set from outside): put the caret where a pick left it, then read it again.
  useLayoutEffect(() => {
    const el = field.current;
    if (el && placeCaret.current !== null) {
      el.setSelectionRange(placeCaret.current, placeCaret.current);
      placeCaret.current = null;
    } else if (added) {
      setAdded('');
    }
    if (spec) readCaret();
  }, [value]);

  // A new query: the first row again.
  useEffect(() => {
    setKeyRow(0);
    setHoverRow(null);
  }, [typed?.start, typed?.query]);

  // Escape (or a pick) keeps the list shut only while the same `@` grows from where it was.
  useEffect(() => {
    if (closed && !stillClosed(closed, typed)) setClosed(null);
  }, [closed, typed?.start, typed?.query]);

  useEffect(() => {
    if (!typed || used.current) return;
    used.current = true;
    spec?.onFirstUse?.();
  }, [typed !== null]);

  useLayoutEffect(() => {
    if (!scrollToKeyRow.current) return;
    scrollToKeyRow.current = false;
    list.current?.querySelector(`[data-mention-row="${shown}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  const pick = (option: MentionOption): void => {
    if (!typed) return;
    const next = applyMention(value, typed, option);
    if (option.kind === 'person') setPicks((all) => [...all.filter((p) => p.key !== option.key || p.name !== next.name), { key: option.key, name: next.name }]);
    setClosed({ start: typed.start, query: next.name });
    // The new text is read with its new caret at once (with the old one it would look like a different `@`).
    setCaret(next.caret);
    placeCaret.current = next.caret;
    onChange(next.text);
    setAdded(`${option.label} added`);
  };

  const agentName = spec?.agentName ?? '';
  const agentListed = spec?.agentListed ?? false;
  const mentionsAgent = agentListed && mentionsName(value, agentName);

  const field_: MentionField = {
    onKeyDown(event) {
      if (!open || isComposingKey(event.nativeEvent)) return false;
      const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setKeyRow((shown + step + options.length) % options.length);
        setHoverRow(null);
        scrollToKeyRow.current = true;
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && plain) {
        event.preventDefault();
        event.stopPropagation();
        const option = options[shown];
        if (option) pick(option);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (typed) setClosed({ start: typed.start, query: typed.query });
        return true;
      }
      return false;
    },
    onKeyUp(event) {
      if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) return;
      if (spec) readCaret();
    },
    onCaret() {
      if (spec) readCaret();
    },
    onBlur() {
      setCaret(null);
    },
    mentionsAgent,
    targets: (text) => mentionTargets(text, picks, { name: agentName, listed: agentListed }),
    names: [...(agentListed && agentName ? [agentName] : []), ...picks.map((p) => p.name)],
    aria: {
      'aria-autocomplete': 'list',
      'aria-expanded': open,
      ...(open ? { 'aria-controls': listId, 'aria-activedescendant': `${listId}-${shown}` } : {}),
    },
    parts: spec ? (
      <>
        {open ? (
          <MentionList
            id={listId}
            listRef={list}
            field={field}
            at={typed!.start}
            options={options}
            highlighted={shown}
            onHover={setHoverRow}
            onPick={pick}
            avatar={spec.avatar}
          />
        ) : null}
        <span role="status" aria-live="polite" className="sr-only" data-mention-status="">
          {open ? optionPosition(options[shown]!.label, shown, options.length) : added}
        </span>
      </>
    ) : null,
  };
  return field_;
}

/** Where the `@` at `index` of a textarea is on the screen (a hidden copy of the box measures it). */
function caretBox(el: HTMLTextAreaElement, index: number): { left: number; top: number } {
  const doc = el.ownerDocument;
  const style = doc.defaultView!.getComputedStyle(el);
  const copy = doc.createElement('div');
  for (const name of [
    'box-sizing',
    'width',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-variant',
    'letter-spacing',
    'word-spacing',
    'line-height',
    'text-indent',
    'text-transform',
    'tab-size',
  ]) {
    copy.style.setProperty(name, style.getPropertyValue(name));
  }
  Object.assign(copy.style, { position: 'fixed', visibility: 'hidden', top: '0', left: '0', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid' });
  copy.textContent = el.value.slice(0, index);
  const mark = doc.createElement('span');
  mark.textContent = '@';
  copy.append(mark);
  doc.body.append(copy);
  const left = mark.offsetLeft;
  const top = mark.offsetTop;
  copy.remove();
  const box = el.getBoundingClientRect();
  return { left: box.left + left - el.scrollLeft, top: box.top + top - el.scrollTop };
}

/** The portal of the comments layer `el` is in, if any. */
function layerPortal(el: HTMLElement | null): Element | null {
  const root = el?.getRootNode();
  return root && 'querySelector' in root ? (root as ParentNode).querySelector('[data-layer-portal]') : null;
}

function MentionList({
  id,
  listRef,
  field,
  at,
  options,
  highlighted,
  onHover,
  onPick,
  avatar,
}: {
  id: string;
  listRef: RefObject<HTMLDivElement | null>;
  field: RefObject<HTMLTextAreaElement | null>;
  at: number;
  options: readonly MentionOption[];
  highlighted: number;
  onHover(row: number | null): void;
  onPick(option: MentionOption): void;
  avatar?(option: MentionOption): ReactNode;
}): ReactNode {
  // The list goes in the layer's portal (above the cards and the panel) when the box is in a layer.
  const [portal] = useState(() => layerPortal(field.current));
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const el = field.current;
    const box = listRef.current;
    if (!el || !box) return;
    const view = el.ownerDocument.defaultView!;
    const point = caretBox(el, at);
    const height = Math.min(LIST_MAX_HEIGHT, box.scrollHeight);
    const above = point.top - OFFSET - EDGE;
    const below = view.innerHeight - (point.top + OFFSET) - EDGE;
    const left = Math.max(EDGE, Math.min(point.left, view.innerWidth - LIST_WIDTH - EDGE));
    const next = above >= height || above >= below
      ? { left, bottom: view.innerHeight - (point.top - OFFSET), maxHeight: Math.min(LIST_MAX_HEIGHT, Math.max(0, above)) }
      : { left, top: point.top + OFFSET, maxHeight: Math.min(LIST_MAX_HEIGHT, Math.max(0, below)) };
    setPlace((last) => (last && last.left === next.left && last.top === next.top && last.bottom === next.bottom && last.maxHeight === next.maxHeight ? last : next));
  }, [at, options.length]);

  const list = (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="Mention suggestions"
      data-mention-list=""
      className={LIST}
      style={{ width: LIST_WIDTH, ...(place ?? { left: 0, top: 0, visibility: 'hidden' }) }}
      // A press on the list keeps the focus (and the caret) in the box.
      onMouseDown={(event) => event.preventDefault()}
      onPointerLeave={() => onHover(null)}
    >
      {options.map((option, index) => (
        <div
          key={`${option.kind}:${option.key}`}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === highlighted}
          data-mention-row={index}
          data-highlighted={index === highlighted || undefined}
          className={classes(ROW, index === highlighted && 'bg-fill-ghost-hover')}
          // Moves only: a row that slides under a still pointer does not take the highlight.
          onPointerMove={() => {
            if (index !== highlighted) onHover(index);
          }}
          onClick={() => onPick(option)}
        >
          {avatar ? (
            <span aria-hidden className="inline-flex shrink-0">
              {avatar(option)}
            </span>
          ) : null}
          <span
            className="min-w-0 flex-1 truncate"
            onPointerEnter={(event) => {
              const label = event.currentTarget;
              label.title = label.scrollWidth > label.clientWidth ? option.label : '';
            }}
          >
            {option.label}
          </span>
        </div>
      ))}
    </div>
  );
  return portal ? createPortal(list, portal) : list;
}

/** The `@names` of a box drawn in the accent colour over its text (the rest of the copy is see-through); its parent is `relative` and as big as the box. */
export function MentionMarks({ value, names, field, className }: { value: string; names: readonly string[]; field: RefObject<HTMLTextAreaElement | null>; className?: string }): ReactNode {
  const inner = useRef<HTMLDivElement>(null);
  const pieces = mentionPieces(value, names);
  const any = pieces.some((piece) => piece.mention);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el || !any) return;
    const follow = (): void => {
      if (!inner.current) return;
      inner.current.style.transform = `translateY(${-el.scrollTop}px)`;
      // The copy starts where the box's text does (after a tag in front of it).
      inner.current.style.textIndent = el.ownerDocument.defaultView!.getComputedStyle(el).textIndent;
    };
    follow();
    el.addEventListener('scroll', follow);
    return () => el.removeEventListener('scroll', follow);
  });
  if (!any) return null;
  return (
    <div aria-hidden data-mention-marks="" className={classes('pointer-events-none absolute inset-0 overflow-hidden font-sans text-body', className)}>
      <div ref={inner} className="whitespace-pre-wrap break-words text-transparent">
        {pieces.map((piece, index) =>
          piece.mention ? (
            <span key={index} className="text-accent">
              {piece.text}
            </span>
          ) : (
            piece.text
          ),
        )}
      </div>
    </div>
  );
}
