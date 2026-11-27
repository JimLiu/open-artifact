/**
 * A demo's replay (`<demo>/?replay=1`): the session of an agent asked for this artifact, played beside the real page.
 * The person's `/open-artifact <type> …` types itself into a simulated agent session, the agent's tool calls build the
 * artifact in the page (the seed, a step at a time, through the store's own write paths: the editor shows each as a
 * real agent's edit), then a comment is left on it and sent to the agent, which changes the artifact and answers. The
 * page cannot be touched while it plays; after it (or a skip, which lands everything at once) it is the usual demo,
 * and the session goes on showing what the simulated agent does with the person's own comments.
 *
 * `?replay=hold` waits for the framing page to say `play` (the site's home page, which shows one demo at a time).
 * Messages, same origin only. To the parent: `{openArtifactDemo: 'replay', demo, state: 'ready' | 'playing' | 'done'}`.
 * From the parent: `{openArtifactDemo: 'play' | 'pause' | 'skip' | 'restart'}`; `play` and `pause` say with `chip: true`
 * that this page should show its own "Skip" (the parent has no cover over it that skips).
 */

import type { DbWrite, JsonRecord, PublishBatch } from '@open-artifact/runtime';
import type { DemoArtifact } from '../provider/demo-provider.ts';
import { sleep } from '../provider/events.ts';
import type { TurnEvent } from '../provider/sim-agent.ts';
import { playgroundRoot } from '../root.ts';
import type { ReplayScript, ReplayStep, Words } from '../seeds/manifest.ts';
import { orderValue, startSeed, stepTakes } from './plan.ts';
import './replay.css';

/** Where a replay's comment goes: what `comments.create` takes, and where the replay draws it. */
export type CommentPlace = Pick<ReplayScript['comment'], 'anchor' | 'label' | 'detail' | 'location' | 'at'>;

/**
 * A demo's own part in its replay (`src/replay/types/<demo>.ts`, the default export), for what its script cannot say
 * ahead of time.
 */
export interface ReplayHooks {
  /** The comment's place, when only the built artifact can say (ids an engine made while the replay built it). */
  comment?(demo: DemoArtifact, script: ReplayScript): Partial<CommentPlace> | Promise<Partial<CommentPlace>>;
  /**
   * Whether the editor is up, for a demo whose editor hears its engine and not the store (so the store never counts a
   * listener): asked in place of the store's count while the replay waits to show the page.
   */
  up?(demo: DemoArtifact): boolean;
  /**
   * Called when the build's steps start; what it returns is called once they have all landed. For a page that would
   * not show what a step wrote (a doc longer than its window follows the writing, then goes back to its top).
   */
  build?(demo: DemoArtifact): (() => void) | void;
}

const hooks = import.meta.glob<ReplayHooks>('./types/*.ts', { import: 'default' });

type Lang = 'en' | 'zh';

const WORDS = {
  title: { en: 'Your agent', zh: '你的 Agent' },
  tag: { en: 'simulated', zh: '模拟' },
  again: { en: 'Replay', zh: '重播' },
  skip: { en: 'Replaying · Skip', zh: '回放中 · 跳过' },
  cover: { en: 'The artifact opens here as soon as the agent creates it', zh: 'Agent 一创建，Artifact 就在这里打开' },
  opened: { en: 'opened beside this session', zh: '已在会话旁打开' },
  you: { en: 'You', zh: '你' },
  send: { en: 'Send to Agent', zh: '发给 Agent' },
  comment: { en: 'Comment', zh: '评论' },
  turn: {
    en: 'Your turn. Comment on anything in the artifact, tick “Send to Agent”, and this agent answers here.',
    zh: '轮到你了。在 Artifact 的任意位置留评论，勾选“发给 Agent”，这个 Agent 会在这里回应。',
  },
  foot: { en: 'A simulated agent, scripted for this demo.', zh: '这是为演示准备的模拟 Agent。' },
  install: { en: 'Use it with your own', zh: '接入你自己的 Agent' },
  placeholder: { en: 'Type / for commands', zh: '输入 / 使用命令' },
} satisfies Record<string, Words>;

/** Time that a skip ends at once and a pause holds. */
class Clock {
  fast = false;
  paused = false;

  async wait(ms: number): Promise<void> {
    let left = ms;
    while (left > 0 && !this.fast) {
      const step = Math.min(left, 40);
      await sleep(step);
      if (!this.paused) left -= step;
    }
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A tool call in the session: running until `done`. */
interface ToolLine {
  done(detail?: string): void;
}

/** The session panel and what covers the page while the replay plays. */
class View {
  readonly root = el('div', 'pg-replay');
  readonly page = el('div', 'pg-page');
  private readonly log = el('div', 'pg-agent-log');
  private readonly typed = el('span', 'pg-agent-typed');
  private readonly input = el('div', 'pg-agent-input');
  private readonly foot = el('div', 'pg-agent-foot');
  private readonly cover = el('div', 'pg-cover');
  private readonly shield = el('div', 'pg-shield');
  readonly skip = el('button', 'pg-skip');
  readonly again = el('button', 'pg-agent-again');
  private readonly pointer = el('div', 'pg-pointer');
  private readonly note = el('div', 'pg-note');
  private readonly noteText = el('p', 'pg-note-text');
  private readonly noteCheck = el('span', 'pg-note-check');
  private readonly noteButton = el('span', 'pg-note-button');

  constructor(private readonly lang: Lang, private readonly clock: Clock, site: string) {
    const t = (words: Words): string => words[lang];
    const agent = el('aside', 'pg-agent');
    agent.setAttribute('aria-label', `${t(WORDS.title)} (${t(WORDS.tag)})`);
    const bar = el('header', 'pg-agent-bar');
    const dots = el('span', 'pg-agent-dots');
    dots.append(el('i', ''), el('i', ''), el('i', ''));
    this.again.type = 'button';
    this.again.textContent = `↻ ${t(WORDS.again)}`;
    this.again.hidden = true;
    bar.append(dots, el('span', 'pg-agent-title', t(WORDS.title)), el('span', 'pg-agent-tag', t(WORDS.tag)), this.again);
    this.log.setAttribute('role', 'log');
    this.input.append(el('span', 'pg-agent-prompt', '›'), this.typed, el('span', 'pg-agent-cursor'));
    this.typed.dataset.placeholder = t(WORDS.placeholder);
    const link = el('a', '', `${t(WORDS.install)} →`);
    link.href = new URL(`${lang === 'zh' ? 'zh/' : ''}install/`, site).href;
    link.target = '_top';
    this.foot.append(el('span', '', t(WORDS.foot)), link);
    this.foot.hidden = true;
    agent.append(bar, this.log, this.input, this.foot);

    this.cover.append(el('span', 'pg-cover-mark'), el('span', 'pg-cover-text', t(WORDS.cover)));
    this.skip.type = 'button';
    this.skip.textContent = `${t(WORDS.skip)} ›`;
    const head = el('div', 'pg-note-head');
    head.append(el('span', 'pg-note-face', t(WORDS.you).slice(0, 1)), el('span', 'pg-note-name', t(WORDS.you)));
    const row = el('div', 'pg-note-row');
    const send = el('span', 'pg-note-send');
    send.append(this.noteCheck, el('span', '', t(WORDS.send)));
    this.noteButton.textContent = t(WORDS.comment);
    row.append(send, this.noteButton);
    this.note.append(head, this.noteText, row);
    this.note.hidden = true;
    this.pointer.hidden = true;
    this.shield.append(this.skip, this.note, this.pointer);
    this.page.append(this.cover, this.shield);
    this.root.append(agent, this.page);
  }

  /** Puts the view where `#root` was, the Shell's root inside its page area. Before the Shell renders: a moved frame loads again. */
  mount(shell: HTMLElement): void {
    shell.replaceWith(this.root);
    this.page.prepend(shell);
  }

  private add(node: HTMLElement): void {
    this.log.append(node);
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** Types `text` at `per` ms a character (CJK slower), in at most `most` ms. */
  private async type(into: HTMLElement, text: string, most: number): Promise<void> {
    const chars = [...text];
    const cost = chars.map((c) => (/[⺀-鿿＀-￯]/.test(c) ? 84 : 26));
    const scale = Math.min(1, most / cost.reduce((a, b) => a + b, 0));
    for (let i = 0; i < chars.length && !this.clock.fast; i++) {
      into.textContent = chars.slice(0, i + 1).join('');
      await this.clock.wait(cost[i]! * scale);
    }
    into.textContent = text;
  }

  /** The person types their request and sends it. */
  async ask(text: string): Promise<void> {
    this.input.dataset.on = '';
    await this.type(this.typed, text, 2800);
    await this.clock.wait(420);
    this.typed.textContent = '';
    delete this.input.dataset.on;
    this.user(text);
  }

  user(text: string): void {
    const line = el('div', 'pg-line pg-user');
    line.append(el('span', 'pg-agent-prompt', '›'), el('span', '', text));
    this.add(line);
  }

  tool(say: string): ToolLine {
    const line = el('div', 'pg-line pg-tool');
    line.dataset.run = '';
    line.append(el('i', 'pg-bullet'), el('span', 'pg-say', say));
    this.add(line);
    return {
      done: (detail) => {
        delete line.dataset.run;
        if (detail) {
          line.append(el('span', 'pg-sub', `⎿ ${detail}`));
          this.log.scrollTop = this.log.scrollHeight;
        }
      },
    };
  }

  /** What the agent says. */
  say(text: string): void {
    this.add(el('div', 'pg-line pg-said', text));
  }

  /** What reaches the agent from the artifact's page: the wake line, and the person's words. */
  event(head: string, text: string): void {
    const line = el('div', 'pg-line pg-event');
    line.append(el('span', 'pg-event-head', head), el('span', 'pg-event-text', text));
    this.add(line);
  }

  hint(text: string): void {
    this.add(el('div', 'pg-line pg-hintline', text));
  }

  /** The page shows. */
  open(): void {
    this.cover.dataset.gone = '';
  }

  /** The person's comment, drawn over the page: the pointer goes to `at`, a card opens, the text types, it is sent. */
  async comment(text: string, at: [number, number]): Promise<void> {
    const box = this.page.getBoundingClientRect();
    const x = Math.round(box.width * at[0]);
    const y = Math.round(box.height * at[1]);
    const move = (px: number, py: number): void => {
      this.pointer.style.transform = `translate(${px}px, ${py}px)`;
    };
    this.pointer.hidden = false;
    move(Math.round(box.width * 0.5), box.height - 40);
    await this.clock.wait(60);
    this.pointer.dataset.move = '';
    move(x, y);
    await this.clock.wait(950);
    this.pointer.dataset.press = '';
    await this.clock.wait(260);
    delete this.pointer.dataset.press;
    // The card beside the point, inside the page.
    const width = Math.min(288, box.width - 24);
    const left = Math.max(12, Math.min(x + 18, box.width - width - 12));
    const top = Math.max(12, Math.min(y + 14, box.height - 190));
    this.note.style.cssText = `left:${left}px;top:${top}px;width:${width}px`;
    this.note.hidden = false;
    await this.clock.wait(320);
    await this.type(this.noteText, text, 2400);
    await this.clock.wait(380);
    const spot = (node: HTMLElement): [number, number] => {
      const r = node.getBoundingClientRect();
      return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2];
    };
    move(...spot(this.noteCheck));
    await this.clock.wait(620);
    this.noteCheck.dataset.on = '';
    await this.clock.wait(420);
    move(...spot(this.noteButton));
    await this.clock.wait(620);
    this.noteButton.dataset.press = '';
    await this.clock.wait(240);
    this.note.dataset.gone = '';
    this.pointer.hidden = true;
    await this.clock.wait(260);
    this.note.hidden = true;
  }

  /** The replay is over: the page is the person's. */
  finish(turn: string): void {
    this.root.dataset.state = 'done';
    this.cover.dataset.gone = '';
    this.shield.hidden = true;
    this.hint(turn);
    this.input.hidden = true;
    this.foot.hidden = false;
    this.again.hidden = false;
    this.log.scrollTop = this.log.scrollHeight;
  }
}

/** The writes that land `paths` of the seed in the artifact, with its order list in step. */
function landing(demo: DemoArtifact, script: ReplayScript, present: Set<string>, paths: string[]): { batch: PublishBatch; writes: DbWrite[] } {
  const batch: PublishBatch = {};
  const writes: DbWrite[] = [];
  const put = (path: string, text: string): void => {
    const doc = /^db\/(.+)\.json$/.exec(path);
    if (doc) writes.push({ op: 'set', path: doc[1]!, data: JSON.parse(text) as JsonRecord });
    else batch[path] = { content: text };
  };
  for (const path of paths) {
    const file = demo.seed.files[path]!;
    if ('text' in file) put(path, file.text);
    else batch[path] = { content: file.base64, encoding: 'base64' };
    present.add(path);
  }
  if (script.order && paths.length) put(script.order.path, `${JSON.stringify(orderValue(demo.seed, script.order, (path) => present.has(path)), null, 2)}\n`);
  return { batch, writes };
}

/**
 * Sets the demo's replay up around the Shell's root and plays it. Call before the Shell renders into `shell`; the
 * artifact must have been made with {@link startSeed}.
 */
export async function startReplay(demo: DemoArtifact, shell: HTMLElement, options: { hold: boolean }): Promise<void> {
  const script = demo.seed.replay!;
  const lang: Lang = document.documentElement.dataset.lang === 'zh' ? 'zh' : 'en';
  const t = (words: Words): string => words[lang];
  const clock = new Clock();
  const view = new View(lang, clock, new URL('../', playgroundRoot()).href);
  view.mount(shell);
  view.root.dataset.state = 'playing';
  demo.agent.pace = (ms) => clock.wait(ms);

  const framed = window.parent !== window;
  const tell = (state: 'ready' | 'playing' | 'done'): void => {
    if (framed) window.parent.postMessage({ openArtifactDemo: 'replay', demo: demo.seed.id, state }, location.origin);
  };
  let over = false;
  const skip = (): void => {
    if (over) return;
    clock.fast = true;
    view.root.dataset.fast = '';
    start();
  };
  let start: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const ask = (event.data as { openArtifactDemo?: unknown } | null)?.openArtifactDemo;
    // The framing page skips on a click of its own cover; this page's "Skip" shows when it says so (`chip`).
    if (ask === 'play' || ask === 'pause') view.skip.hidden = options.hold && (event.data as { chip?: unknown }).chip !== true;
    if (ask === 'play') {
      clock.paused = false;
      start();
    } else if (ask === 'pause') clock.paused = !over;
    else if (ask === 'skip') skip();
    else if (ask === 'restart') location.reload();
  });
  view.skip.hidden = options.hold;
  view.skip.addEventListener('click', skip);
  view.again.addEventListener('click', () => location.reload());
  // A page nobody looks at waits.
  document.addEventListener('visibilitychange', () => {
    if (!options.hold) clock.paused = document.hidden && !over;
  });

  // The agent's turns, during the replay and after it: what the person's own comments make it do.
  let reading: ToolLine | null = null;
  let turnDone: () => void = () => undefined;
  demo.agent.turns.on((event: TurnEvent) => {
    if (event.phase === 'asked') {
      view.event(event.threadId ? '[Artifact comment sent to agent]' : '[Artifact edit request sent to agent]', event.text);
      reading = view.tool(event.threadId ? 'ArtifactComments · read the thread' : 'Read the request');
    } else if (event.phase === 'read') {
      reading?.done();
      reading = null;
    } else if (event.phase === 'edited') view.tool(event.what).done();
    else if (event.phase === 'replied') {
      view.tool('ArtifactComments · reply').done();
      view.say(event.reply);
    } else turnDone();
  });

  /** The editor is in its frame and listens for changes (or took too long: the store has every write either way). */
  const editorUp = async (up?: (demo: DemoArtifact) => boolean): Promise<void> => {
    const frame = (): boolean => !!document.querySelector<HTMLIFrameElement>('iframe[name=open-artifact-shell]')?.contentDocument?.body?.childElementCount;
    for (let waited = 0; waited < 10000 && !clock.fast; waited += 100) {
      if ((up ? up(demo) : demo.store.files.size + demo.store.db.size > 0) && frame()) break;
      await sleep(100);
    }
    await clock.wait(600);
  };

  const step = async (takes: string[], present: Set<string>, one: ReplayStep): Promise<void> => {
    const line = view.tool(one.say);
    const ms = one.ms ?? 700;
    const parts = Math.max(1, Math.min(one.chunks ?? 1, takes.length || 1));
    const size = Math.ceil(takes.length / parts);
    const writes = (takes.length ? parts : 0) + (one.edits?.length ?? 0);
    const beat = ms / (writes + 1);
    for (let i = 0; i < takes.length; i += size) {
      await clock.wait(beat);
      const { batch, writes: docs } = landing(demo, script, present, takes.slice(i, i + size));
      if (docs.length) await demo.store.writeDocs(docs, 'agent');
      if (Object.keys(batch).length) await demo.store.publish(batch, 'agent');
    }
    for (const edit of one.edits ?? []) {
      await clock.wait(beat);
      await demo.agent.perform([edit]);
    }
    await clock.wait(beat);
    line.done();
  };

  const play = async (): Promise<void> => {
    const hook = (await hooks[`./types/${demo.seed.id}.ts`]?.()) ?? {};
    tell('ready');
    if (options.hold) await started;
    tell('playing');
    await clock.wait(500);
    await view.ask(t(script.prompt));
    await clock.wait(450);
    const skill = view.tool('Skill(open-artifact)');
    await clock.wait(650);
    skill.done();
    const create = view.tool(`Artifact · create ${demo.seed.type} “${demo.store.title}”`);
    await editorUp(hook.up);
    create.done(t(WORDS.opened));
    const takes = stepTakes(demo.seed, script);
    const present = new Set(Object.keys(startSeed(demo.seed).files));
    // The page shows from the first step that says so; with none, as soon as the agent has created the artifact.
    const hidden = script.steps.some((one) => one.open);
    if (!hidden) view.open();
    await clock.wait(450);
    demo.agent.working(true);
    const built = hook.build?.(demo);
    for (const [i, one] of script.steps.entries()) {
      await step(takes[i]!, present, one);
      if (one.open) view.open();
    }
    built?.();
    demo.agent.working(false);
    view.open();
    await clock.wait(350);
    view.say(t(script.made));
    await clock.wait(1500);

    const place: CommentPlace = { ...script.comment, ...(await hook.comment?.(demo, script)) };
    const text = t(script.comment.text);
    await view.comment(text, place.at);
    const answered = new Promise<void>((resolve) => {
      turnDone = resolve;
    });
    const thread = demo.comments.create({ anchor: place.anchor, label: place.label, ...(place.detail ? { detail: place.detail } : {}), ...(place.location ? { location: place.location } : {}), text });
    demo.comments.markSent(thread.id, false);
    demo.agent.request(text, thread.id);
    await answered;
    await clock.wait(700);
  };

  try {
    await play();
  } catch (error) {
    console.error('[playground] the replay stopped', error);
    // Whatever it did not get to: the artifact as the seed has it.
    const present = new Set<string>();
    const all = Object.keys(demo.seed.files).filter((path) => !path.startsWith('_blobs/') && !path.startsWith('doc/') && !path.startsWith('sheet/'));
    const { batch, writes } = landing(demo, script, present, all);
    if (writes.length) await demo.store.writeDocs(writes, 'agent').catch(() => undefined);
    if (Object.keys(batch).length) await demo.store.publish(batch, 'agent').catch(() => undefined);
    demo.agent.working(false);
  }
  over = true;
  clock.fast = false;
  clock.paused = false;
  demo.agent.pace = sleep;
  delete view.root.dataset.fast;
  view.finish(t(WORDS.turn));
  tell('done');
}
