/**
 * The docs demo's part in its replay: where the replay's comment goes. The thread hangs on words of the doc (the
 * script's `comment.label`), named by the ids of their first and last characters, and those ids are the Docs host's:
 * it makes them while the replay builds the doc. So the place is read from the doc as it stands, in the shape the docs
 * editor writes for a thread a person starts on selected words (`packages/docs-editor/src/comments/actions.ts`,
 * `wordsComposer`): the anchor `{tab, range: [first char id, last char id]}`, the words as its label, the words and
 * their paragraph as its detail, and the tab and the paragraph's block as its location. Where the pointer goes (`at`)
 * is where the open page draws those words.
 */

import type { JsonRecord } from '@open-artifact/runtime';
import { VISITOR, type DemoArtifact } from '../../provider/demo-provider.ts';
import { sleep } from '../../provider/events.ts';
import type { CommentPlace, ReplayHooks } from '../replay.ts';

/** A run of a block's line as a tab's file has it: text whose characters have consecutive ids from `id`, or a chip. */
interface Run {
  id: string;
  text?: string;
}

interface Block {
  id: string;
  inline?: Run[];
  children?: Block[];
}

/** Longest context a thread's detail keeps (the editor's `DETAIL_MAX`). */
const DETAIL_MAX = 1200;

/** Each character of a block's line with its id; a chip is one character no words match. */
function charsOf(block: Block): Array<{ id: string; ch: string }> {
  const out: Array<{ id: string; ch: string }> = [];
  for (const run of block.inline ?? []) {
    if (typeof run.text !== 'string') {
      out.push({ id: run.id, ch: '￼' });
      continue;
    }
    const dot = run.id.lastIndexOf('.');
    const session = run.id.slice(0, dot);
    const first = Number(run.id.slice(dot + 1));
    Array.from(run.text).forEach((ch, offset) => out.push({ id: `${session}.${first + offset}`, ch }));
  }
  return out;
}

/** The first block (at any depth, in reading order) whose line holds `words`, and where in it. */
function findWords(blocks: Block[], words: string): { block: Block; chars: Array<{ id: string; ch: string }>; from: number } | null {
  const wanted = Array.from(words);
  for (const block of blocks) {
    const chars = charsOf(block);
    for (let from = 0; from + wanted.length <= chars.length; from++) {
      if (wanted.every((ch, offset) => chars[from + offset]!.ch === ch)) return { block, chars, from };
    }
    const inside = findWords(block.children ?? [], words);
    if (inside) return inside;
  }
  return null;
}

/** How long the page stays on the end of the tab the agent wrote before it goes back to the top. */
const HOME_MS = 900;

/** The ids of the last block (and all inside it) of the doc's first tab as the replay leaves it: the seed's own. */
function lastBlockIds(demo: DemoArtifact): Set<string> {
  const ids = new Set<string>();
  const tabs = [...(demo.engines?.doc?.host.project().files ?? [])].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const file = tabs[0] && demo.seed.files[`doc/tabs/${tabs[0].id}.json`];
  if (!file || !('text' in file)) return ids;
  const all = (block: Block): void => {
    ids.add(block.id);
    block.children?.forEach(all);
  };
  const final = (JSON.parse(file.text) as { blocks?: Block[] }).blocks?.at(-1);
  if (final) all(final);
  return ids;
}

/** The editor's frame and the element its doc scrolls in. */
function editor(): { frame: HTMLIFrameElement; page: Document; scroller: HTMLElement | null } | null {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[name=open-artifact-shell]');
  const page = frame?.contentDocument;
  return frame && page ? { frame, page, scroller: page.querySelector<HTMLElement>('.doc-scroll') } : null;
}

/** The box the open page draws `words` in, inside the block's element (frame coordinates); null while it shows neither. */
function wordsBox(page: Document, blockId: string, words: string): DOMRect | null {
  const element = page.querySelector(`[data-bid="${CSS.escape(blockId)}"]`);
  if (!element) return null;
  const walker = page.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number }> = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: text.length });
    text += node.nodeValue ?? '';
  }
  const from = text.indexOf(words);
  if (from < 0) return null;
  const at = (offset: number): [Text, number] | null => {
    const hit = [...nodes].reverse().find((entry) => entry.start <= offset);
    return hit ? [hit.node, offset - hit.start] : null;
  };
  const start = at(from);
  const end = at(from + words.length);
  if (!start || !end) return null;
  const range = page.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  // Words that wrap have a box a line: the widest is where a person would point.
  const boxes = [...range.getClientRects()].filter((box) => box.width > 0);
  return boxes.sort((a, b) => b.width - a.width)[0] ?? null;
}

const hooks: ReplayHooks = {
  // The docs editor hears the Docs host's own frames (`doc.onFrame`), never the store: it is up once it shows the doc.
  up: () => !!editor()?.page.querySelector('.doc-scroll [data-bid]'),

  // The brief is longer than its window, and the agent writes it top to bottom: the page follows the writing (the first
  // block each write adds comes a third of the way down the window). Once the tab's last block is written it goes back
  // to its top, where the comment lands: a beat later, so that the end is seen, and before the agent says it is done.
  build(demo) {
    const open = editor();
    const scroller = open?.scroller;
    if (!open || !scroller) return;
    const skipped = (): boolean => document.querySelector('.pg-replay')?.hasAttribute('data-fast') ?? false;
    const to = (top: number): void => scroller.scrollTo({ top: Math.max(0, top), behavior: skipped() ? 'auto' : 'smooth' });
    const blocks = (): HTMLElement[] => [...scroller.querySelectorAll<HTMLElement>('[data-bid]')];
    const seen = new Set(blocks().map((block) => block.dataset.bid));
    const last = lastBlockIds(demo);
    let home: number | undefined;
    const follow = new MutationObserver(() => {
      const fresh = blocks().filter((block) => !seen.has(block.dataset.bid));
      if (!fresh.length) return;
      for (const block of fresh) seen.add(block.dataset.bid);
      const top = fresh[0]!.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      to(top - scroller.clientHeight / 3);
      if (home === undefined && fresh.some((block) => last.has(block.dataset.bid ?? ''))) home = window.setTimeout(() => to(0), HOME_MS);
    });
    follow.observe(scroller, { childList: true, subtree: true });
    return () => {
      follow.disconnect();
      window.clearTimeout(home);
      to(0);
    };
  },

  async comment(demo, script): Promise<Partial<CommentPlace>> {
    const doc = demo.engines?.doc;
    if (!doc) return {};
    const words = script.comment.label;
    const scripted = JSON.parse(script.comment.anchor) as { tab?: unknown };
    const tabs = [...doc.host.project().files].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const tab = tabs.find((one) => one.id === scripted.tab) ?? tabs[0];
    if (!tab) return {};
    const found = findWords(doc.host.read(tab.id, VISITOR).doc.blocks as Block[], words);
    if (!found) return {};
    const { block, chars, from } = found;
    const around = chars
      .map((one) => one.ch)
      .join('')
      .replaceAll('￼', '')
      .trim();
    const location: JsonRecord = { tab: tab.id, block: block.id };
    const place: Partial<CommentPlace> = {
      anchor: JSON.stringify({ tab: tab.id, range: [chars[from]!.id, chars[from + Array.from(words).length - 1]!.id] }),
      label: words,
      detail: around === words ? `On “${words}”` : `On “${words}” in: ${around.slice(0, DETAIL_MAX)}`,
      location,
    };

    // Where the page shows the words: the pointer goes to their middle. A page scrolled away from them comes back first.
    const area = document.querySelector<HTMLElement>('.pg-page')?.getBoundingClientRect();
    const open = editor();
    if (!area?.width || !open) return place;
    let box = wordsBox(open.page, block.id, words);
    const height = open.page.documentElement.clientHeight;
    if (box && open.scroller && (box.top < 96 || box.bottom > height - 220)) {
      open.scroller.scrollTop = Math.max(0, open.scroller.scrollTop + box.top - 220);
      await sleep(120);
      box = wordsBox(open.page, block.id, words);
    }
    if (!box) return place;
    const frame = open.frame.getBoundingClientRect();
    const x = (frame.left + box.left + box.width / 2 - area.left) / area.width;
    const y = (frame.top + box.top + box.height / 2 - area.top) / area.height;
    if (x > 0 && x < 1 && y > 0 && y < 1) place.at = [x, y];
    return place;
  },
};

export default hooks;
