import * as React from 'react';
import { askTooLong } from '@open-artifact/editor-kit';
import { cleanAskWords } from '../agent/ask-words.ts';
import type { ChatWithAgent } from '../agent/chat-with-agent.ts';
import type { SheetController } from '../state/controller.ts';
import type { SelectionForAgent } from '../state/initial-state.ts';
/** Asks the agent in the person's words about the cells, with what was pressed; resolves to whether the chat took it. */
export function askAgentInWords(
  controller: Pick<SheetController, 'isEventUnfinished'>,
  chat: Pick<ChatWithAgent, 'openWithWhatWasPressed'>,
  { words, cells, pressed }: { words: string; cells: SelectionForAgent | null; pressed: string },
): Promise<boolean> {
  let request = cleanAskWords(words);
  let isTooSoon = performance.now() - (lastAskInWordsAtMs.get(chat) ?? Number.NEGATIVE_INFINITY) < ASK_IN_WORDS_AGAIN_GAP_MS;
  if (controller.isEventUnfinished() || cells === null || request === '' || isTooSoon || askTooLong(words)) return Promise.resolve(false);
  let shownWords = cleanAskWords(request.slice(0, PRESSED_ASK_WORDS_MAX_CHARS));
  let opening = chat.openWithWhatWasPressed(shownWords, cells, pressed, {
    request,
  });
  let askedAtMs = performance.now();
  lastAskInWordsAtMs.set(chat, askedAtMs);
  return opening.finally(() => {
    if (lastAskInWordsAtMs.get(chat) === askedAtMs) lastAskInWordsAtMs.delete(chat);
  });
}
/** What a live region says: words to say (none when `false`, `null` or empty), and how many times they were said before, so the same words can be said again. */
export interface LiveAnnouncerProps {
  words?: string | false | null;
  timesSaid?: number;
}
/** Words said in the live region, with the key that tells one saying from the next. */
export interface Saying {
  id: number;
  sayingKey: string;
  words: string;
}
/** The words the live region says now, those said just before (kept a moment so they are not cut off), and how many sayings there have been. */
export interface Sayings {
  now: Saying | null;
  before: Saying | null;
  count: number;
}
export function nextSayings(sayings: Sayings, { words, timesSaid = 0 }: LiveAnnouncerProps): Sayings {
  let saying =
    typeof words === 'string' && words !== ''
      ? {
          sayingKey: `${timesSaid} ${words}`,
          words,
        }
      : null;
  if ((sayings.now?.sayingKey ?? null) === (saying?.sayingKey ?? null)) return sayings;
  let count = sayings.count + 1;
  return {
    now:
      saying === null
        ? null
        : {
            id: count,
            ...saying,
          },
    before: sayings.now ?? sayings.before,
    count,
  };
}
export function LiveAnnouncer(announcement: LiveAnnouncerProps) {
  let [sayings, setSayings] = React.useState(() => nextSayings(NO_SAYINGS, announcement));
  let sayingsNow = nextSayings(sayings, announcement);
  if (sayingsNow !== sayings) setSayings(sayingsNow);
  let beforeId = sayings.before?.id;
  React.useEffect(() => {
    if (beforeId === undefined) return;
    let timeoutId = setTimeout(
      () =>
        setSayings(
          (current) =>
            current.before?.id === beforeId
              ? {
                  ...current,
                  before: null,
                }
              : current,
        ),
      OLD_SAYING_KEEP_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [beforeId]);
  return <div role="status" aria-live="polite" aria-atomic="false" className="sr-only">{[sayingsNow.before, sayingsNow.now].map(
      (saying) =>
        saying !== null &&
        <p key={saying.id}>{saying.words}</p>,
    )}</div>;
}
export const OLD_SAYING_KEEP_MS = 1000;
export const NO_SAYINGS: Sayings = {
  now: null,
  before: null,
  count: 0,
};
export const PRESSED_ASK_WORDS_MAX_CHARS = 60;
export const lastAskInWordsAtMs = new WeakMap<object, number>();
export const ASK_IN_WORDS_AGAIN_GAP_MS = 4000;
