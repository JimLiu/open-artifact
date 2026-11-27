/**
 * What the insert menus follow in the editor: the `/`, `@` or `:` being typed before the caret (and its query), the
 * row picked in its menu, and the chip whose picker is open. The keys of an open menu are answered here, before the
 * editor's own.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { isComposingKey } from '@open-artifact/ui/keys';
import { type EditorState, NodeSelection, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { getDocs } from '../app/store.ts';
import { schema } from '../editor/schema.ts';

const { nodes, marks } = schema;

export type TriggerKind = 'slash' | 'mention' | 'emoji';

/** The trigger and query being typed: `from` is the trigger character, `to` the caret. */
export interface Trigger {
  kind: TriggerKind;
  from: number;
  to: number;
  query: string;
}

export interface Range {
  from: number;
  to: number;
}

/** What a menu icon shows; the views map these to icons. */
export type InsertIcon =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'table'
  | 'dropdown'
  | 'bullet'
  | 'check'
  | 'code'
  | 'contents'
  | 'date'
  | 'divider'
  | 'image'
  | 'ordered'
  | 'quote'
  | 'person'
  | 'agent'
  | 'tab';

/** One row of a typeahead menu. */
export interface MenuOption {
  id: string;
  label: string;
  /** Shown muted after the label. */
  detail?: string;
  /** Rows of one section are grouped under its name. */
  section?: string;
  icon?: InsertIcon;
  /** Text drawn in place of an icon (an emoji). */
  glyph?: string;
  run(view: EditorView, range: Range): void;
}

export type OptionSource = (query: string, state: EditorState) => MenuOption[];

const sources: Partial<Record<TriggerKind, OptionSource>> = {};

export function registerSource(kind: TriggerKind, source: OptionSource): void {
  sources[kind] = source;
}

export const optionsFor = (trigger: Trigger, state: EditorState): MenuOption[] => sources[trigger.kind]?.(trigger.query, state) ?? [];

/** The chip pickers: a date chip's calendar, a dropdown chip's options, and the list of dropdowns to insert. */
export type PickerKind = 'date' | 'dropdown' | 'insertDropdown';

export interface Picker {
  /** Changes each time a picker opens, so its view starts afresh. */
  id: number;
  kind: PickerKind;
  /** The chip's position (for `insertDropdown`, where the chip goes). */
  pos: number;
}

interface InsertState {
  trigger: Trigger | null;
  /** The trigger Escape closed: its menu stays shut until it is gone. */
  dismissed: number | null;
  index: number;
  picker: Picker | null;
}

type InsertMeta = { dismiss: true } | { index: number } | { open: Omit<Picker, 'id'> } | { close: true };

export const insertKey = new PluginKey<InsertState>('insertMenus');

interface TriggerRule {
  kind: TriggerKind;
  pattern: RegExp;
}

const RULES: readonly TriggerRule[] = [
  { kind: 'slash', pattern: /(?:^|\s)\/((?:[^\s/][^/\n]*)?)$/ },
  { kind: 'mention', pattern: /(?:^|[^A-Za-z0-9._%+\-])@((?:[^\s@][^@\n]*)?)$/ },
  { kind: 'emoji', pattern: /(?:^|[\s(]):([a-z][a-z0-9_+\-]+)$/i },
];

const MAX_QUERY = 40;
const MAX_SPACES = 3;

/** The trigger right before an empty caret in plain text (not code), if any; the one typed last wins. */
export function findTrigger(state: EditorState): Trigger | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (!parent.inlineContent || parent.type === nodes.codeBlock) return null;
  if (marks.code!.isInSet(state.storedMarks ?? $from.marks())) return null;
  const before = parent.textBetween(Math.max(0, $from.parentOffset - MAX_QUERY - 2), $from.parentOffset, undefined, '\ufffc');
  const start = $from.parentOffset - before.length;
  const head = start === 0 ? before : ` ${before}`;
  let best: Trigger | null = null;
  for (const rule of RULES) {
    const match = rule.pattern.exec(head);
    if (!match) continue;
    const query = match[1] ?? '';
    if (query.length > MAX_QUERY || (query.match(/ /g)?.length ?? 0) > MAX_SPACES) continue;
    const from = $from.pos - query.length - 1;
    if (!best || from > best.from) best = { kind: rule.kind, from, to: $from.pos, query };
  }
  return best;
}

const pickerNode: Record<Exclude<PickerKind, 'insertDropdown'>, () => PMNode['type']> = {
  date: () => nodes.date!,
  dropdown: () => nodes.dropdown!,
};

function mapPicker(picker: Picker | null, tr: Transaction): Picker | null {
  if (!picker) return null;
  const pos = tr.mapping.map(picker.pos, 1);
  if (picker.kind === 'insertDropdown') return pos <= tr.doc.content.size ? { ...picker, pos } : null;
  return tr.doc.nodeAt(pos)?.type === pickerNode[picker.kind]() ? { ...picker, pos } : null;
}

let pickers = 0;

export const insertState = (state: EditorState | null | undefined): InsertState | null => (state ? (insertKey.getState(state) ?? null) : null);

/** The trigger whose menu is open (not one Escape closed). */
export function activeTrigger(state: EditorState | null | undefined): Trigger | null {
  const plugin = insertState(state);
  return plugin?.trigger && plugin.trigger.from !== plugin.dismissed ? plugin.trigger : null;
}

/** The page lets this person write, and the editor takes their typing. */
export const canWrite = (view: EditorView): boolean => view.editable && getDocs().writable;

const send = (view: EditorView, meta: InsertMeta) => view.dispatch(view.state.tr.setMeta(insertKey, meta));

export const dismissMenu = (view: EditorView) => send(view, { dismiss: true });
export const setMenuIndex = (view: EditorView, index: number) => send(view, { index });
export const openPicker = (view: EditorView, kind: PickerKind, pos: number) => send(view, { open: { kind, pos } });
export const closePicker = (view: EditorView) => send(view, { close: true });

/** Runs a menu row on the trigger's text. */
export function pickOption(view: EditorView, option: MenuOption, trigger: Trigger): void {
  option.run(view, { from: trigger.from, to: trigger.to });
}

function handleMenuKey(view: EditorView, event: KeyboardEvent): boolean {
  const plugin = insertState(view.state);
  const trigger = activeTrigger(view.state);
  if (!plugin || !trigger || view.composing || isComposingKey(event) || !canWrite(view)) return false;
  if (event.key === 'Escape') {
    dismissMenu(view);
    return true;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const options = optionsFor(trigger, view.state);
  if (!options.length) return false;
  const index = Math.min(plugin.index, options.length - 1);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const step = event.key === 'ArrowDown' ? 1 : -1;
    send(view, { index: (index + step + options.length) % options.length });
    return true;
  }
  if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
    pickOption(view, options[index]!, trigger);
    return true;
  }
  return false;
}

const isChip = (node: PMNode | null | undefined): node is PMNode => !!node && (node.type === nodes.date || node.type === nodes.dropdown);

function toggleChipPicker(view: EditorView, pos: number, node: PMNode): void {
  const open = insertState(view.state)?.picker;
  if (open && open.pos === pos && open.kind !== 'insertDropdown') closePicker(view);
  else openPicker(view, node.type === nodes.date ? 'date' : 'dropdown', pos);
}

export function insertMenusPlugin(): Plugin<InsertState> {
  return new Plugin<InsertState>({
    key: insertKey,
    state: {
      init: (_config, state) => ({ trigger: findTrigger(state), dismissed: null, index: 0, picker: null }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(insertKey) as InsertMeta | undefined;
        const trigger = tr.docChanged || tr.selectionSet || meta ? findTrigger(state) : prev.trigger;
        let dismissed = prev.dismissed === null ? null : tr.mapping.map(prev.dismissed);
        if (meta && 'dismiss' in meta && trigger) dismissed = trigger.from;
        if (!trigger || trigger.from !== dismissed) dismissed = null;
        const same = !!trigger && !!prev.trigger && prev.trigger.kind === trigger.kind && tr.mapping.map(prev.trigger.from) === trigger.from && prev.trigger.query === trigger.query;
        const index = meta && 'index' in meta ? meta.index : same ? prev.index : 0;
        let picker = mapPicker(prev.picker, tr);
        if (meta && 'open' in meta) picker = { ...meta.open, id: ++pickers };
        if (meta && 'close' in meta) picker = null;
        return { trigger, dismissed, index, picker };
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (handleMenuKey(view, event)) return true;
        const { selection } = view.state;
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && canWrite(view)) {
          if (selection instanceof NodeSelection && isChip(selection.node)) {
            toggleChipPicker(view, selection.from, selection.node);
            return true;
          }
        }
        return false;
      },
      handleClickOn(view, _pos, node, nodePos, event, direct) {
        if (!direct || event.button !== 0 || !isChip(node) || !canWrite(view)) return false;
        toggleChipPicker(view, nodePos, node);
        return false;
      },
    },
  });
}
