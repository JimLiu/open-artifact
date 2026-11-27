/** Reply on a suggestion's card: the comments feature answers it (it opens a thread on the suggestion's words). */
import { create } from 'zustand';

export interface SuggestionReplyTarget {
  tab: string;
  suggestId: string;
  /** The card's sentence, e.g. `Replace “a” with “b”`. */
  summary: string;
}

export type SuggestionReplyHandler = (target: SuggestionReplyTarget) => void;

export const useSuggestionReply = create<{ handler: SuggestionReplyHandler | null }>(() => ({ handler: null }));

/** Shows Reply on suggestion cards until the returned function is called. */
export function provideSuggestionReply(handler: SuggestionReplyHandler): () => void {
  useSuggestionReply.setState({ handler });
  return () => {
    if (useSuggestionReply.getState().handler === handler) useSuggestionReply.setState({ handler: null });
  };
}

/** The words of replies on suggestions that the server refused after their box was closed, by `tab|suggestion`. */
const kept = new Map<string, string>();

const keyOf = (tab: string, suggestId: string) => `${tab}|${suggestId}`;

/** Keeps a refused reply's words for its suggestion while the page is open. */
export function keepReplyDraft(tab: string, suggestId: string, text: string): void {
  if (text.trim()) kept.set(keyOf(tab, suggestId), text);
}

/** The words kept for a suggestion, handed back once (Reply on it again puts them in the box). */
export function takeReplyDraft(tab: string, suggestId: string): string | null {
  const key = keyOf(tab, suggestId);
  const text = kept.get(key) ?? null;
  kept.delete(key);
  return text;
}
