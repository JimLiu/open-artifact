/**
 * Suggesting mode in the text: the person's own edits are written as suggestions of theirs instead of changes. Typing,
 * Backspace and Delete, Enter, paste and cut are each worked out as ops (typing.ts) and written to the tab's sync, which
 * shows them in the editor at once; the editor's own change never goes through. Whatever else would change the text
 * (formatting, a table's shape, a picture) is refused with a line saying so. Others' writes, the binding's patches and
 * the editor's own fix-ups pass untouched.
 *
 * An input method composes in the text as usual; once it is done, what it wrote is taken back and written as a
 * suggestion. Undo takes back the person's last suggestion still open (it is withdrawn); Redo brings it back.
 */
import { type DocState, Refusal, proposalIds } from '@open-artifact/docs-core';
import { isApplePlatform as isApple } from '@open-artifact/editor-kit';
import { isComposingKey } from '../../../ui/src/keys.ts';
import { Plugin, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { type OpenTab, docClient } from '../app/doc-client.ts';
import { getDocs } from '../app/store.ts';
import { isSyncedTransaction, pmDocOf, posOfIdPlace } from '../editor/binding.ts';
import { useEditor } from '../editor/format.ts';
import { schema } from '../editor/schema.ts';
import { decide, undoDecisionByKeys, undoLastDecision } from './decide.ts';
import { newSuggestionId, startedHere, suggestingNow } from './mode.ts';
import { getSuggest, setSuggest, showNotice } from './store.ts';
import {
  type Caret,
  type Plan,
  type PlanContext,
  REFUSALS,
  flattenSlice,
  intentOf,
  marksAt,
  planDeleteChar,
  planEnter,
  planInsert,
  planRemove,
  textContent,
} from './typing.ts';

/** The meta of transactions this file makes itself (a caret placed, a composition taken back): they pass. */
const MINE = 'docSuggesting';

const said = (why: string) => showNotice(why.charAt(0).toUpperCase() + why.slice(1));

const PEER_CODES = new Set(['others_pending', 'in_suggestion', 'not_yours']);

/** The words for a write the model refused. */
export const refusalWords = (code: string): string => (PEER_CODES.has(code) ? REFUSALS.peer : REFUSALS.notYet);

/** Whether the person may add to a suggestion: one this page started, or one recorded as theirs (not their agent's). */
export function mineIn(shadow: DocState, me: string | null, id: string): boolean {
  if (startedHere(id)) return true;
  const info = shadow.suggestions?.[id];
  return !!me && !!info && info.by === me && info.via !== 'agent';
}

/** A plan's context over the tab as the editor shows it. */
export function contextOf(state: EditorState, open: OpenTab): PlanContext {
  const shadow = open.binding.shadow;
  const me = getDocs().me?.id ?? null;
  const writer = docClient().writer;
  return {
    state,
    shadow,
    mine: id => mineIn(shadow, me, id),
    // The write takes these ids for what it adds (the model moves the session on past them).
    take: count => Array.from({ length: count }, (_, index) => `${writer.sess}.${writer.next + index}`),
    fresh: newSuggestionId,
  };
}

// ---- the suggestions the person wrote here, for Undo -------------------------------------------------------------

const recent = new Map<string, string[]>();
/** The suggestion Undo withdrew last, which Redo brings back. */
let withdrawn: { tab: string; id: string } | null = null;
let undoing = false;

function noteRecent(tab: string, id: string): void {
  const list = (recent.get(tab) ?? []).filter(each => each !== id);
  list.push(id);
  recent.set(tab, list.slice(-50));
  withdrawn = null;
}

function undoSuggestion(open: OpenTab): void {
  if (undoing) return;
  const list = recent.get(open.id) ?? [];
  const live = new Set(proposalIds(open.sync.shadow.blocks));
  while (list.length && !live.has(list[list.length - 1]!)) list.pop();
  const id = list.pop();
  if (!id) return;
  undoing = true;
  void decide(open.id, [id], 'withdraw').finally(() => {
    undoing = false;
    const last = getSuggest().last;
    if (last?.verdict === 'withdraw' && last.ids.length === 1 && last.ids[0] === id) {
      // Undo again goes further back; Redo takes this back.
      setSuggest({ last: { ...last, editSerial: -1 } });
      withdrawn = { tab: open.id, id };
    }
  });
}

function redoSuggestion(open: OpenTab): void {
  const last = getSuggest().last;
  if (!withdrawn || withdrawn.tab !== open.id || last?.verdict !== 'withdraw' || last.ids[0] !== withdrawn.id) return;
  const id = withdrawn.id;
  withdrawn = null;
  void undoLastDecision().then(() => {
    const list = recent.get(open.id) ?? [];
    list.push(id);
    recent.set(open.id, list);
  });
}

// ---- writing a plan ----------------------------------------------------------------------------------------------

function openOf(view: EditorView): OpenTab | null {
  const { tab, view: shown } = useEditor.getState();
  if (!tab || shown !== view) return null;
  return docClient().openTabOf(tab);
}

function placeCaret(view: EditorView, open: OpenTab, caret: Caret): void {
  const doc = view.state.doc;
  let selection: Selection | null = null;
  if ('bid' in caret) {
    const pos = posOfIdPlace(doc, open.binding.shadow, caret);
    if (pos !== null) selection = TextSelection.create(doc, pos);
  } else selection = Selection.near(doc.resolve(Math.max(0, Math.min(caret.near, doc.content.size))), caret.bias);
  if (!selection) return;
  view.dispatch(view.state.tr.setSelection(selection).setMeta(MINE, true).setMeta('addToHistory', false).scrollIntoView());
}

/** Writes a plan: its ops to the tab's sync (the editor is shown them), then the caret. False when nothing was written. */
export function runPlan(view: EditorView, open: OpenTab, plan: Plan | null): boolean {
  if (!plan) return false;
  if (plan.kind === 'refuse') {
    said(plan.why);
    return false;
  }
  if (plan.kind === 'move') {
    placeCaret(view, open, plan.caret);
    return false;
  }
  try {
    open.sync.write(plan.ops);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    said(refusalWords(error.code));
    return false;
  }
  noteRecent(open.id, plan.id);
  // An edit since the last decision: the undo keys no longer take that decision back.
  const last = getSuggest().last;
  if (last && last.editSerial !== -1) setSuggest({ last: { ...last, editSerial: -1 } });
  placeCaret(view, open, plan.caret);
  return true;
}

// ---- the keys ----------------------------------------------------------------------------------------------------

/** The text of a block before (`dir` -1) or after the caret, a chip as one character. */
function besideCaret(state: EditorState, dir: -1 | 1): string {
  const { $head } = state.selection;
  return dir < 0 ? state.doc.textBetween($head.start(), $head.pos, undefined, '￼') : state.doc.textBetween($head.pos, $head.end(), undefined, '￼');
}

function deletePlan(state: EditorState, ctx: PlanContext, event: KeyboardEvent, dir: -1 | 1): Plan | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return { kind: 'refuse', why: REFUSALS.notYet };
  if (!selection.empty) return planRemove(ctx, selection.from, selection.to, dir);
  const apple = isApple();
  const line = apple ? event.metaKey : false;
  const word = apple ? event.altKey : event.ctrlKey;
  if (line || word) {
    const text = besideCaret(state, dir);
    const span = line ? text : dir < 0 ? (text.match(/\S*\s*$/u)?.[0] ?? '') : (text.match(/^\s*\S*/u)?.[0] ?? '');
    if (span.length) {
      const pos = selection.head;
      return dir < 0 ? planRemove(ctx, pos - span.length, pos, -1) : planRemove(ctx, pos, pos + span.length, 1);
    }
  }
  return planDeleteChar(ctx, selection.head, dir);
}

function handleKey(view: EditorView, event: KeyboardEvent): boolean {
  if (!suggestingNow() || view.composing || isComposingKey(event)) return false;
  const open = openOf(view);
  if (!open) return false;
  const state = view.state;
  const mod = isApple() ? event.metaKey : event.ctrlKey;
  const key = event.key;
  if (mod && !event.altKey && (key === 'z' || key === 'Z' || key === 'y')) {
    const redo = key === 'y' || event.shiftKey;
    if (redo) redoSuggestion(open);
    else if (!undoDecisionByKeys(state)) undoSuggestion(open);
    return true;
  }
  if (key === 'Backspace' || key === 'Delete') {
    runPlan(view, open, deletePlan(state, contextOf(state, open), event, key === 'Backspace' ? -1 : 1));
    return true;
  }
  if (key === 'Enter' && !mod && !event.altKey) {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) {
      said(REFUSALS.notYet);
      return true;
    }
    const ctx = contextOf(state, open);
    if (event.shiftKey) {
      const code = selection.$head.parent.type === schema.nodes.codeBlock;
      runPlan(view, open, planInsert(ctx, selection.head, selection.head, code ? textContent('\n') : [{ type: 'hardBreak' }]));
    } else runPlan(view, open, planEnter(ctx, selection.head));
    return true;
  }
  return false;
}

// ---- an input method's words -------------------------------------------------------------------------------------

/** An input method is composing, or has just finished and its words are not written yet. */
let composing = false;

/** What the input method wrote, taken back: the editor's change undone, and the words it wrote, as a plan's input. */
function takeBack(state: EditorState, open: OpenTab): { tr: Transaction; from: number; to: number; content: Record<string, unknown>[] } | 'same' | null {
  const before = pmDocOf(open.binding.shadow);
  const doc = state.doc;
  const start = before.content.findDiffStart(doc.content);
  if (start === null) return 'same';
  let { a: endA, b: endB } = before.content.findDiffEnd(doc.content)!;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  const tr = state.tr.replace(start, endB, before.slice(start, endA)).setMeta(MINE, true).setMeta('addToHistory', false);
  if (!tr.doc.eq(before)) tr.replaceWith(0, tr.doc.content.size, before.content);
  const $a = before.resolve(start);
  const $b = doc.resolve(start);
  const one = $a.parent.isTextblock && $a.sameParent(before.resolve(endA)) && $b.parent.isTextblock && $b.sameParent(doc.resolve(endB));
  if (!one) return { tr, from: -1, to: -1, content: [] };
  const flat = flattenSlice(doc.slice(start, endB), $b.parent.type === schema.nodes.codeBlock);
  return { tr, from: start, to: endA, content: flat.content };
}

/** The words an input method wrote, written as a suggestion (after the editor's own change was taken back). */
function writeComposed(view: EditorView, open: OpenTab, from: number, to: number, content: Record<string, unknown>[]): void {
  if (from < 0) {
    said(REFUSALS.notYet);
    return;
  }
  const state = view.state;
  const ctx = contextOf(state, open);
  const marks = marksAt(state, from, to);
  const withMarks = content.map(node => (node.type === 'text' && marks.length && !node.marks ? { ...node, marks } : node));
  runPlan(view, open, planInsert(ctx, from, to, withMarks));
}

function settleComposition(view: EditorView): void {
  if (!composing || view.composing) return;
  composing = false;
  const open = openOf(view);
  if (!open) return;
  const back = takeBack(view.state, open);
  if (!back || back === 'same') return;
  view.dispatch(back.tr);
  writeComposed(view, open, back.from, back.to, back.content);
}

// ---- the plugin --------------------------------------------------------------------------------------------------

let current: EditorView | null = null;

/** Lets a transaction that changes the text through, in Suggesting mode, or turns it into a suggestion (or a refusal). */
function letThrough(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged || !suggestingNow()) return true;
  if (isSyncedTransaction(tr) || tr.getMeta(MINE) || tr.getMeta('appendedTransaction') || tr.getMeta('composition') !== undefined) return true;
  const view = current;
  if (!view || view.state !== state || view.composing || composing) return true;
  const open = openOf(view);
  if (!open) return true;
  const intent = intentOf(tr);
  let plan: Plan | null;
  if (intent.kind === 'refuse') plan = { kind: 'refuse', why: intent.why };
  else {
    const ctx = contextOf(state, open);
    plan =
      intent.kind === 'remove'
        ? planRemove(ctx, intent.from, intent.to, -1)
        : planInsert(ctx, intent.from, intent.to, intent.content.length ? intent.content : []);
  }
  // Written once this dispatch is over, over the text it was worked out for.
  queueMicrotask(() => {
    if (view.state.doc !== state.doc || openOf(view) !== open) {
      if (plan?.kind !== 'refuse') said(REFUSALS.changed);
      return;
    }
    runPlan(view, open, plan);
  });
  return false;
}

export function suggestingPlugin(): Plugin {
  return new Plugin({
    view(view) {
      current = view;
      return {
        destroy() {
          if (current === view) current = null;
        },
      };
    },
    filterTransaction: letThrough,
    appendTransaction(transactions, _old, state) {
      // The input method's last words came in after it finished: taken back before the binding writes them.
      const view = current;
      if (!composing || !view || view.composing || !suggestingNow()) return null;
      if (!transactions.some(tr => tr.docChanged && !isSyncedTransaction(tr) && !tr.getMeta(MINE))) return null;
      const open = openOf(view);
      if (!open) return null;
      composing = false;
      const back = takeBack(state, open);
      if (!back || back === 'same') return null;
      queueMicrotask(() => writeComposed(view, open, back.from, back.to, back.content));
      return back.tr;
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (!suggestingNow() || view.composing) return false;
        const open = openOf(view);
        if (!open) return false;
        const state = view.state;
        const code = state.doc.resolve(from).parent.type === schema.nodes.codeBlock;
        runPlan(view, open, planInsert(contextOf(state, open), from, to, textContent(code ? text : text.replace(/\r?\n/g, ' '), code ? [] : marksAt(state, from, to))));
        return true;
      },
      handleKeyDown: handleKey,
      handlePaste(view, _event, slice) {
        if (!suggestingNow()) return false;
        const open = openOf(view);
        if (!open) return false;
        const state = view.state;
        const { from, to } = state.selection;
        const flat = flattenSlice(slice, state.selection.$from.parent.type === schema.nodes.codeBlock);
        if (!flat.content.length) {
          said(flat.leftOut ? REFUSALS.uploads : REFUSALS.notYet);
          return true;
        }
        if (runPlan(view, open, planInsert(contextOf(state, open), from, to, flat.content))) {
          if (flat.leftOut) said(REFUSALS.uploadsLeftOut);
          else if (flat.joined) said(REFUSALS.flattened);
        }
        return true;
      },
      handleDrop() {
        if (!suggestingNow()) return false;
        said(REFUSALS.notYet);
        return true;
      },
      handleDOMEvents: {
        compositionstart(view) {
          if (!suggestingNow()) return false;
          const open = openOf(view);
          if (!open) return false;
          // Words the input method writes over are struck first; it then writes at the caret.
          const { selection } = view.state;
          if (!selection.empty) runPlan(view, open, planRemove(contextOf(view.state, open), selection.from, selection.to, 1));
          composing = true;
          return false;
        },
        compositionend(view) {
          if (!composing) return false;
          // After the editor read the last of the input method's words in.
          setTimeout(() => settleComposition(view), 0);
          return false;
        },
      },
    },
  });
}
