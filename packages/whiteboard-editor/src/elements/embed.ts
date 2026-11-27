/**
 * The sandbox of HTML embeds and the `boardEmbed` bridge between an embed
 * and the board.
 *
 * An embed runs in an `<iframe sandbox="allow-scripts">` (an opaque origin)
 * whose `srcdoc` starts with a Content Security Policy that lets nothing
 * load from the network, then a small bootstrap that defines
 * `window.boardEmbed`:
 *
 * - `boardEmbed.load()` returns the embed's saved state (parsed JSON, or
 *   `null`);
 * - `boardEmbed.save(value)` saves a JSON-serializable value (at most
 *   {@link MAX_HTML_STATE_CHARS} characters as JSON) for everyone on the
 *   board, returning `false` when it cannot;
 * - `boardEmbed.onLoad(fn)` calls `fn` with the state whenever someone
 *   else's save arrives, and returns a function that stops it.
 *
 * The board writes saves through one {@link createStateSaver} for all its
 * embeds (batched, and remembering its own writes so their echoes are not
 * sent back) and stops an embed that navigates away or floods it with
 * messages.
 *
 * The bootstrap also hands the board a private `MessagePort` (before the
 * embed's own code runs, so the embed cannot reach or fake it) and reports
 * on it ({@link EmbedPortMessage}): presses inside the frame, Escape, and
 * echoes of the board's heartbeat pings. With them the board
 * - keeps the keyboard its own: an embed that takes focus without being
 *   pressed or entered is made to give it back, and is stopped the third
 *   time ({@link createKeyboardGuard});
 * - hides an embed that stops answering pings, and stops it when it stays
 *   silent ({@link createHeartbeat});
 * - comes back to the board on Escape inside the frame.
 *
 * Until the embed is entered (a press inside it, or the board's
 * {@link EmbedEnterMessage} when Enter hands it the keyboard), the bootstrap
 * keeps typing, key chords, function keys, Delete, paste and drops from the
 * embed's page; Escape always goes through and ends the entry.
 */

import { MAX_HTML_STATE_CHARS } from '@open-artifact/whiteboard-core';

/** The Content Security Policy of every embed: inline code only, nothing from the network. */
export const EMBED_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** Markup an embed may not contain: nested browsing contexts, plugins, external styles and shadow roots that could hide them. */
const REFUSED_MARKUP = /<\s*(?:iframe|frame|frameset|object|embed|portal|fencedframe|noscript|link)\b|shadowrootmode/i;

/** Why an embed's HTML is not run, or `undefined` when it may run. */
export function embedRefusal(html: string): string | undefined {
  return REFUSED_MARKUP.test(html) ? 'It contains frames, plugins or linked files, which embeds can’t use.' : undefined;
}

/** A message from an embed: save this state. */
export interface EmbedSaveMessage {
  boardEmbed: 'save';
  /** The state as JSON text. */
  state: string;
}

/** A message to an embed: the board's state changed. */
export interface EmbedStateMessage {
  boardEmbed: 'state';
  /** The state as JSON text, or `null` when cleared. */
  state: string | null;
}

/** A message from an embed's bootstrap (on `window`): its private port is attached. */
export interface EmbedPortOffer {
  boardEmbed: 'port';
}

/** A message from an embed's bootstrap on its private port. */
export type EmbedPortMessage =
  /** A trusted press inside the frame, `age` ms old when sent. */
  | { kind: 'press'; age: number }
  /** A trusted Escape inside the frame. */
  | { kind: 'key'; key: 'Escape' }
  /** The answer to heartbeat ping `n`. */
  | { kind: 'echo'; n: number };

/** A message from the board to an embed's bootstrap on its private port: heartbeat ping `ping`. */
export interface EmbedPingMessage {
  ping: number;
}

/** A message from the board to an embed's bootstrap on its private port: the embed was entered (`true`) or left (`false`). */
export interface EmbedEnterMessage {
  enter: boolean;
}

/** What the board sends an embed's bootstrap on its private port. */
export type EmbedBoardMessage = EmbedPingMessage | EmbedEnterMessage;

/** Whether a posted message offers an embed's private port. */
export function isEmbedPortOffer(data: unknown): data is EmbedPortOffer {
  return typeof data === 'object' && data !== null && (data as { boardEmbed?: unknown }).boardEmbed === 'port';
}

/** The message an embed's bootstrap sent on its port, or `undefined` when it is not one. */
export function readEmbedPortMessage(data: unknown): EmbedPortMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const message = data as { kind?: unknown; age?: unknown; key?: unknown; n?: unknown };
  if (message.kind === 'press') return { kind: 'press', age: typeof message.age === 'number' && Number.isFinite(message.age) ? message.age : Infinity };
  if (message.kind === 'key' && message.key === 'Escape') return { kind: 'key', key: 'Escape' };
  if (message.kind === 'echo' && typeof message.n === 'number') return { kind: 'echo', n: message.n };
  return undefined;
}

/** Whether a posted message is a well-formed save from an embed. */
export function isEmbedSaveMessage(data: unknown): data is EmbedSaveMessage {
  return typeof data === 'object' && data !== null && (data as { boardEmbed?: unknown }).boardEmbed === 'save' && typeof (data as { state?: unknown }).state === 'string';
}

/** JSON for an inline `<script>`: `<` escaped so the text cannot close the script. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

/**
 * The bootstrap that defines `window.boardEmbed` with the given initial
 * state, and hands the board its private port (see the module comment). It
 * keeps its own references to what it calls, so the embed's code cannot
 * reroute its reports later.
 *
 * It also keeps the embed on its page, which would otherwise be stopped as
 * navigated away: links do nothing (a `#name` link scrolls to its target),
 * a click on a link or a submit button with a modifier key or another
 * button is canceled, as is a modified Enter on a link or in a form; a form
 * submits only by `method="dialog"`; and an event the embed's code fires
 * with a modifier key, or at a node outside the page, is canceled first.
 */
export function embedBootstrap(state: string | undefined): string {
  return `(function(){
var apply=Reflect.apply,send=MessagePort.prototype.postMessage,now=performance.now.bind(performance),channel=new MessageChannel(),port=channel.port1;
function tell(message){try{apply(send,port,[message]);}catch(e){}}
var entered=false,hold=Event.prototype.preventDefault,halt=Event.prototype.stopImmediatePropagation;
port.onmessage=function(event){var data=event.data;if(!data)return;if(typeof data.ping==='number')tell({kind:'echo',n:data.ping});else if(typeof data.enter==='boolean')entered=data.enter;};
parent.postMessage({boardEmbed:'port'},'*',[channel.port2]);
function keep(event){if(!event.isTrusted||entered)return;apply(hold,event,[]);apply(halt,event,[]);}
addEventListener('pointerdown',function(event){if(event.isTrusted){entered=true;tell({kind:'press',age:now()-event.timeStamp});}},true);
addEventListener('keydown',function(event){if(!event.isTrusted)return;if(event.key==='Escape'){entered=false;if(!event.repeat&&!event.isComposing&&event.keyCode!==229)tell({kind:'key',key:'Escape'});return;}keep(event);},true);
['keypress','keyup','beforeinput','paste','drop'].forEach(function(type){addEventListener(type,keep,true);});
addEventListener('dragover',function(event){if(event.isTrusted&&!entered){apply(hold,event,[]);apply(halt,event,[]);if(event.dataTransfer)event.dataTransfer.dropEffect='none';}},true);
var path=Event.prototype.composedPath,matches=Element.prototype.matches,attr=Element.prototype.getAttribute,byId=Document.prototype.getElementById,show=Element.prototype.scrollIntoView,fire=EventTarget.prototype.dispatchEvent,connected=Object.getOwnPropertyDescriptor(Node.prototype,'isConnected').get,Ui=UIEvent,Form=HTMLFormElement;
var LINK='a[href],area[href],a[*|href]',SUBMIT='button,input[type=submit],input[type=image]',IN_FORM='form a[href],form button,form input';
function modified(event){return event.ctrlKey||event.metaKey||event.shiftKey||event.altKey;}
function reach(event,selector){var nodes=apply(path,event,[]);for(var i=0;i<nodes.length;i++){var node=nodes[i];if(node instanceof Element&&apply(matches,node,[selector]))return node;}return null;}
function clicked(event){var link=reach(event,LINK);if(!link&&!reach(event,SUBMIT))return;var plain=!modified(event)&&event.button===0;if(link||!plain)apply(hold,event,[]);if(!link||!plain)return;var href=apply(attr,link,['href'])||'';if(href.charAt(0)!=='#'||href.length<2)return;var id=href.slice(1);try{id=decodeURIComponent(id);}catch(e){}var target=apply(byId,document,[id]);if(target)apply(show,target,[]);}
addEventListener('click',clicked,true);addEventListener('auxclick',clicked,true);
function entering(event){if(event.key==='Enter'&&modified(event)&&reach(event,LINK+','+IN_FORM))apply(hold,event,[]);}
addEventListener('keydown',entering,true);addEventListener('keypress',entering,true);
addEventListener('submit',function(event){var by=event.submitter,form=event.target;if(by instanceof Element&&apply(attr,by,['formmethod'])==='dialog')return;if(form instanceof Form&&form.method==='dialog')return;apply(hold,event,[]);},true);
function onPage(target){return target===window||target===document||(target instanceof Node&&apply(connected,target,[]));}
EventTarget.prototype.dispatchEvent=function(event){if(event instanceof Ui&&!event.isTrusted&&(modified(event)||!onPage(this))){if(!event.cancelable)event=new event.constructor(event.type,{bubbles:event.bubbles,cancelable:true,composed:event.composed,view:event.view,detail:event.detail,button:event.button,buttons:event.buttons,clientX:event.clientX,clientY:event.clientY,screenX:event.screenX,screenY:event.screenY,key:event.key,code:event.code,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey});apply(hold,event,[]);}return apply(fire,this,[event]);};
var state=${scriptJson(state ?? null)},listeners=[],MAX=${MAX_HTML_STATE_CHARS};
function parse(text){if(text==null)return null;try{return JSON.parse(text);}catch(e){return null;}}
var api={
load:function(){return parse(state);},
save:function(value){var text;try{text=JSON.stringify(value);}catch(e){return false;}if(typeof text!=='string'||text.length>MAX)return false;state=text;parent.postMessage({boardEmbed:'save',state:text},'*');return true;},
onLoad:function(fn){if(typeof fn!=='function')return function(){};listeners.push(fn);return function(){var i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);};}
};
Object.defineProperty(window,'boardEmbed',{value:Object.freeze(api)});
addEventListener('message',function(event){if(event.source!==parent)return;var data=event.data;if(!data||data.boardEmbed!=='state')return;state=typeof data.state==='string'?data.state:null;var value=parse(state);listeners.slice().forEach(function(fn){try{fn(value);}catch(error){setTimeout(function(){throw error;});}});});
})();`;
}

/** What every embed's page starts with: no margins, and nothing scrolls past the card. */
export const EMBED_CLIP_STYLE = 'html,body{margin:0;padding:0;overflow:hidden}';

/** The `srcdoc` of an embed: policy, clip style, bootstrap, then its HTML (without a doctype of its own). */
export function buildEmbedSrcdoc(html: string, state: string | undefined): string {
  const body = html.replace(/^\s*<!doctype[^>]*>/i, '');
  const csp = EMBED_CSP.replace(/"/g, '&quot;');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${EMBED_CLIP_STYLE}</style><script>${embedBootstrap(state)}</script>${body}`;
}

/* ------------------------------------------------------------------------ */
/* Saving                                                                   */
/* ------------------------------------------------------------------------ */

/** How long saves wait for more before writing, in milliseconds. */
export const EMBED_SAVE_DELAY_MS = 400;

/** How many embeds' states one write takes while saves are waiting. */
export const EMBED_SAVES_PER_WRITE = 16;

/** How many of its own writes the saver remembers per embed. */
export const EMBED_OWN_WRITES = 8;

/** Timer functions a saver uses (injectable for tests). */
export interface SaverClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The page's timers as a {@link SaverClock}. */
function systemClock(): SaverClock {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let last = 0;
  return {
    setTimeout(callback, ms) {
      const key = ++last;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          callback();
        }, ms),
      );
      return key;
    },
    clearTimeout(handle) {
      if (typeof handle !== 'number') return;
      const timer = timers.get(handle);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

/** One embed's state to write. */
export type EmbedStateWrite = readonly [id: string, state: string];

/** The board's writes of its embeds' states. */
export interface StateSaver {
  /**
   * Queues an embed's state. When nothing has been written for a while it
   * writes at once; otherwise it waits, and each pause then writes up to
   * {@link EMBED_SAVES_PER_WRITE} embeds' latest states in one board change.
   * A state that is not JSON, or is too long, is dropped.
   */
  save(id: string, state: string): void;
  /** Writes the queued state of one embed now, or of all of them. */
  flush(id?: string): void;
  /** Whether a state is one this saver wrote for the embed (an echo, not someone else's change). */
  isOwnWrite(id: string, state: string | undefined): boolean;
  /** Drops everything queued. */
  cancel(): void;
}

/** Whether a state is JSON the board can keep. */
function isKeepableState(state: string): boolean {
  if (state.length > MAX_HTML_STATE_CHARS) return false;
  try {
    JSON.parse(state);
    return true;
  } catch {
    return false;
  }
}

/** A {@link StateSaver} that writes through `write` (one call per board change). */
export function createStateSaver(write: (writes: readonly EmbedStateWrite[]) => void, delay = EMBED_SAVE_DELAY_MS, clock: SaverClock = systemClock()): StateSaver {
  const queued = new Map<string, string>();
  const own = new Map<string, string[]>();
  let timer: unknown;
  const commit = (writes: readonly EmbedStateWrite[]): void => {
    if (writes.length === 0) return;
    for (const [id, state] of writes) own.set(id, [...(own.get(id) ?? []), state].slice(-EMBED_OWN_WRITES));
    write(writes);
  };
  const take = (count: number): EmbedStateWrite[] => {
    const writes = [...queued].slice(0, count);
    for (const [id] of writes) queued.delete(id);
    return writes;
  };
  // While saves come in, a write every `delay`; quiet once a pause finds nothing queued.
  const pause = (): void => {
    timer = clock.setTimeout(() => {
      timer = undefined;
      if (queued.size === 0) return;
      commit(take(EMBED_SAVES_PER_WRITE));
      pause();
    }, delay);
  };
  return {
    save(id, state) {
      if (!isKeepableState(state)) return;
      if (timer !== undefined) {
        queued.set(id, state);
        return;
      }
      commit([[id, state]]);
      pause();
    },
    flush(id) {
      if (id === undefined) return commit(take(queued.size));
      const state = queued.get(id);
      if (state === undefined) return;
      queued.delete(id);
      commit([[id, state]]);
    },
    isOwnWrite: (id, state) => state !== undefined && (own.get(id)?.includes(state) ?? false),
    cancel() {
      if (timer !== undefined) clock.clearTimeout(timer);
      timer = undefined;
      queued.clear();
    },
  };
}

/** Most messages an embed may send per second before it is stopped. */
export const EMBED_FLOOD_LIMIT = 2000;

/** Counts an embed's messages; `hit()` returns `true` once it sent too many within a second. */
export function createFloodGuard(limit = EMBED_FLOOD_LIMIT, windowMs = 1000): { hit(now?: number): boolean } {
  let start = -Infinity;
  let count = 0;
  return {
    hit(now = Date.now()) {
      if (now - start >= windowMs) {
        start = now;
        count = 0;
      }
      count += 1;
      return count > limit;
    },
  };
}

/** Why an embed was stopped. */
export const EMBED_STOP_MESSAGES = {
  navigated: 'It navigated away from its content.',
  flooded: 'It sent the board more than it can handle.',
  silent: 'It stopped responding.',
  keyboard: 'It kept taking over the keyboard.',
} as const;

/** A reason an embed was stopped. */
export type EmbedStopReason = keyof typeof EMBED_STOP_MESSAGES;

/** Whether an embed stopped for `reason` may run again in place (the others run again when the board is reopened). */
export function canRunEmbedAgain(reason: EmbedStopReason): boolean {
  return reason === 'keyboard';
}

/** What the view of a stopped embed says after the reason (`undefined`: it offers to run again instead). */
export function embedStopHint(reason: EmbedStopReason): string | undefined {
  return canRunEmbedAgain(reason) ? undefined : 'Reopen the board to run it again.';
}

/** Longest embed title an announcement names before cutting it. */
const ANNOUNCED_TITLE_CHARS = 30;

/** Said when an embed is stopped for taking the keyboard (`title`: its page title, if any). */
export function embedKeyboardStopMessage(title: string | undefined): string {
  const name = title === undefined || title.trim() === '' ? undefined : title.length > ANNOUNCED_TITLE_CHARS ? title.slice(0, ANNOUNCED_TITLE_CHARS) + '…' : title;
  return (name === undefined ? 'An embed' : name) + ' was stopped: it kept taking over the keyboard. Press Return on it to run it again.';
}

/** Said when a stopped embed runs again. */
export const EMBED_RUNS_AGAIN_MESSAGE = 'The embed runs again.';

/* ------------------------------------------------------------------------ */
/* Heartbeat                                                                */
/* ------------------------------------------------------------------------ */

/** How often the board pings an embed, ms. */
export const EMBED_HEARTBEAT_MS = 1000;
/** Pings in a row an embed may miss before it is hidden (silent). */
export const EMBED_MISSES_TO_SILENCE = 5;
/** Pings in a row an embed may miss before it is stopped. */
export const EMBED_MISSES_TO_STOP = 60;

/** What a heartbeat beat found: all well, the embed just went silent (hide it), or it must stop. */
export type HeartbeatVerdict = 'ok' | 'silent' | 'stop';

/** An embed's heartbeat: a ping every beat, answered by an echo. */
export interface Heartbeat {
  /** One beat: what the last ping's answer (or its absence) means, and the number of the ping to send now. */
  beat(): { verdict: HeartbeatVerdict; ping: number };
  /** The echo of ping `n` arrived; `true` when it ends a silence (show the embed again). */
  echo(n: number): boolean;
  /** Skips a beat without counting a miss (the page is hidden, so the embed may be paused). */
  rest(): void;
  /** Whether the embed is silent now. */
  readonly silent: boolean;
}

/**
 * A {@link Heartbeat}: a ping answered before
 * the next beat resets the misses; {@link EMBED_MISSES_TO_SILENCE} misses in
 * a row make the embed silent until an echo arrives;
 * {@link EMBED_MISSES_TO_STOP} stop it.
 */
export function createHeartbeat(missesToSilence = EMBED_MISSES_TO_SILENCE, missesToStop = EMBED_MISSES_TO_STOP): Heartbeat {
  let sent = 0;
  let answered = true;
  let misses = 0;
  let silent = false;
  return {
    beat() {
      let verdict: HeartbeatVerdict = 'ok';
      if (answered) misses = 0;
      else {
        misses += 1;
        if (misses >= missesToStop) verdict = 'stop';
        else if (misses >= missesToSilence && !silent) {
          silent = true;
          verdict = 'silent';
        }
      }
      answered = false;
      sent += 1;
      return { verdict, ping: sent };
    },
    echo(n) {
      if (n !== sent) return false;
      answered = true;
      misses = 0;
      if (!silent) return false;
      silent = false;
      return true;
    },
    rest() {
      answered = true;
    },
    get silent() {
      return silent;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Keyboard guard                                                           */
/* ------------------------------------------------------------------------ */

/** Oldest a press inside an embed may be and still hand it the keyboard, ms. */
export const EMBED_PRESS_MAX_AGE_MS = 1000;
/** How long a press the board did not accept excuses an embed for taking focus, ms. */
export const EMBED_EXCUSE_MS = 500;
/** How long after being handed the keyboard focus elsewhere does not end an embed's hold, ms. */
export const EMBED_JUST_ALLOWED_MS = 250;
/** How long the board waits before judging an embed that took focus, ms. */
export const EMBED_FOCUS_SETTLE_MS = 50;
/** Take-backs that stop an embed (the last one stops it). */
export const EMBED_TAKE_BACKS_TO_STOP = 3;

/**
 * What to do about an embed holding the keyboard: leave it (it may), take
 * focus back without counting it (a press excuses it), take it back, or
 * stop the embed.
 */
export type KeyboardVerdict = 'keep' | 'excused' | 'take-back' | 'stop';

/** Whether an embed may hold the keyboard, and what to do when it takes it anyway. */
export interface KeyboardGuard {
  /** Whether the embed may hold the keyboard now. */
  readonly owner: boolean;
  /**
   * A press inside the embed, `age` ms old, was heard at `now`; `accepted`
   * when the board lets the press reach it (the embed is live). Returns
   * whether the embed now may hold the keyboard.
   */
  pressed(age: number, accepted: boolean, now: number): boolean;
  /** The board hands the embed the keyboard at `now` (Enter on it): it may hold it, and is forgiven. */
  allow(now: number): void;
  /** The embed may no longer hold the keyboard (Escape, a press on the board). */
  release(): void;
  /** Focus is elsewhere on the page at `now`: the hold ends, unless the embed was just handed the keyboard. */
  left(now: number): void;
  /** The embed was seen taking the keyboard a moment before `now`: what to do. */
  settle(now: number): KeyboardVerdict;
}

/**
 * A {@link KeyboardGuard}: an embed
 * may hold the keyboard after a fresh press inside it or after Enter hands
 * it over; taking it otherwise is taken back, and the
 * {@link EMBED_TAKE_BACKS_TO_STOP}th time stops the embed. A press resets
 * the count.
 */
export function createKeyboardGuard(): KeyboardGuard {
  let owner = false;
  let allowedAt = -Infinity;
  let excusedUntil = -Infinity;
  let takeBacks = 0;
  const allow = (now: number): void => {
    owner = true;
    allowedAt = now;
    excusedUntil = -Infinity;
    takeBacks = 0;
  };
  return {
    get owner() {
      return owner;
    },
    pressed(age, accepted, now) {
      if (accepted && age <= EMBED_PRESS_MAX_AGE_MS) {
        allow(now);
        return true;
      }
      excusedUntil = now + EMBED_EXCUSE_MS;
      return false;
    },
    allow,
    release() {
      owner = false;
    },
    left(now) {
      if (now - allowedAt > EMBED_JUST_ALLOWED_MS) owner = false;
    },
    settle(now) {
      if (owner) return 'keep';
      if (now <= excusedUntil) {
        excusedUntil = -Infinity;
        return 'excused';
      }
      takeBacks += 1;
      if (takeBacks < EMBED_TAKE_BACKS_TO_STOP) return 'take-back';
      takeBacks = 0;
      return 'stop';
    },
  };
}
