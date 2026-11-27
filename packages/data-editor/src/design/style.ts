/**
 * The Design panel's Style section state: tweaks over the page's look that
 * preview at once and, like a hand edit, wait for the bar's Save (which
 * merges them into `dash/look` `tweaks`) or Cancel.
 */

import { create } from 'zustand';
import { DASH_LOOK_PATH } from '@open-artifact/data-core';
import { announce } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { SAVED_LABEL } from '../drafts/words.ts';
import {
  STYLE_TWEAK_KEYS,
  keepChangedTweaks,
  mergeStyleTweaks,
  readStyleTweaks,
  styleAfterSave,
  type StyleTweakChange,
  type StyleTweaks,
} from '../page/look.ts';
import { DELETE_FIELD, mergeDocument } from '../sync/index.ts';

export const STYLE_SAVE_FAILED_TEXT = 'The style couldn’t be saved. Your changes are still here, so try again.';

const STATUS_MS = 4000;

export interface StyleEditorState {
  /** The unsaved change, null when there is none. */
  pending: StyleTweakChange | null;
  phase: 'editing' | 'saving';
  /** "Saved" for a moment after a save. */
  status: string | null;
  /** Stored tweaks that the look's own change removed. */
  cleared: number;
}

export const useStyleEditor = create<StyleEditorState>()(() => ({ pending: null, phase: 'editing', status: null, cleared: 0 }));

let stored: unknown = undefined;
let storedTweaks: StyleTweaks = {};
let clearing = new Set<string>();
let statusTimer: ReturnType<typeof setTimeout> | undefined;
/** The tweaks as a save in flight (or just done, until the stored look follows) leaves them. */
let landing: StyleTweaks | null = null;

/** Changes are kept against what the stored tweaks are, or are about to be. */
const keepChanged = (change: StyleTweakChange): StyleTweakChange | null => keepChangedTweaks(change, landing ?? storedTweaks);

/** Follows the stored `dash/look`: counts stored tweaks that went away without this viewer clearing them. */
export function followStoredLook(look: unknown): void {
  if (look === stored) return;
  stored = look;
  const next = readStyleTweaks(look);
  const lost = STYLE_TWEAK_KEYS.filter((key) => storedTweaks[key] !== undefined && next[key] === undefined && !clearing.delete(key)).length;
  storedTweaks = next;
  const { pending, phase } = useStyleEditor.getState();
  if (phase !== 'saving') landing = null;
  const kept = pending === null ? null : keepChanged(pending);
  useStyleEditor.setState({ pending: kept, ...(lost > 0 ? { cleared: lost } : {}) });
}

export function changeStyle(change: StyleTweakChange): void {
  const { pending } = useStyleEditor.getState();
  useStyleEditor.setState({ cleared: 0, pending: keepChanged({ ...pending, ...change }) });
}

export function resetStyle(): void {
  useStyleEditor.setState({ pending: keepChanged(Object.fromEntries(STYLE_TWEAK_KEYS.map((key) => [key, null])) as StyleTweakChange) });
}

/** Runs `then` once a focused number field has committed its value (blurring it commits). */
function afterInputBlur(then: () => void): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.tagName === 'INPUT') active.blur();
  setTimeout(then, 0);
}

export function cancelStyle(): void {
  afterInputBlur(() => useStyleEditor.setState({ pending: null }));
}

function say(words: string | null): void {
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  statusTimer = undefined;
  useStyleEditor.setState({ status: words });
  if (words === null) return;
  announce(words);
  statusTimer = setTimeout(() => useStyleEditor.setState({ status: null }), STATUS_MS);
}

function saveNow(): void {
  const { pending, phase } = useStyleEditor.getState();
  if (pending === null || phase === 'saving') return;
  const before = storedTweaks;
  landing = mergeStyleTweaks(before, pending);
  useStyleEditor.setState({ phase: 'saving' });
  clearing = new Set(Object.keys(pending).filter((key) => pending[key as keyof StyleTweaks] === null));
  const written = Object.fromEntries(Object.entries(pending).map(([key, value]) => [key, value ?? DELETE_FIELD]));
  // The rows stay open while it saves: what changes meanwhile stays unsaved once the save is done.
  mergeDocument(DASH_LOOK_PATH, { tweaks: written })
    .then(() => {
      useStyleEditor.setState((state) => ({ pending: styleAfterSave(state.pending, pending, before, true), cleared: 0 }));
      say(SAVED_LABEL);
    })
    .catch(() => {
      landing = null;
      clearing.clear();
      useStyleEditor.setState((state) => ({ pending: styleAfterSave(state.pending, pending, before, false), cleared: 0 }));
      toast.add({ title: STYLE_SAVE_FAILED_TEXT, timeout: 10_000 });
    })
    .finally(() => useStyleEditor.setState({ phase: 'editing' }));
}

export function saveStyle(): void {
  afterInputBlur(saveNow);
}
