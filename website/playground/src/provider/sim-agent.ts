/**
 * The simulated agent: what answers "Send to agent" on the playground. A request (`agent.send`, or a comment thread
 * handed over with `comments.sendToAgent`) makes it busy, reads the thread a moment later, "works" for the script's
 * `thinkMs`, applies the next scripted edit through the store's own write paths (so the page sees the artifact change
 * live, as from a real agent), answers in the thread, and goes idle. Requests queue: one turn at a time.
 *
 * On the docs and sheets demos the artifact lives in a real engine ({@link DemoEngines}): the agent writes through the
 * engine's own agent entry points (the Docs host's `agentCall`, the Sheets store's `agentUpdate`), as the CLI does
 * for a real agent, and the artifact's copy of the engine's files is taken in as the agent's version.
 */

import type { AgentStatus, CommentAuthor, DbWrite, JsonRecord, JsonValue, PublishBatch } from '@open-artifact/runtime';
import type { BrowserDoc, BrowserSheet } from '../engines/load.ts';
import type { AgentEdit, AgentResponse, AgentScript, AppendOrder, DocEdit, SheetEdit } from '../seeds/manifest.ts';
import type { CommentStore } from './comments.ts';
import { channel, sleep } from './events.ts';
import type { DemoStore } from './store.ts';

/** The engines a demo's artifact lives in (docs: `doc`; sheets: `sheet`), and how to take their files in. */
export interface DemoEngines {
  doc?: BrowserDoc;
  sheet?: BrowserSheet;
  /** Takes the engine's files in as a version by `origin` (`agent` here). */
  mirror(origin: 'agent' | 'person'): Promise<void>;
}

/** What one turn knows while it applies its edits: the thread it answers, and the reply's variables so far. */
interface Turn {
  threadId?: string;
  vars: Record<string, string>;
}

const READ_MS = 400;
const REQUEST_CHARS = 80;

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** `value` with `{{n}}` and `{{request}}` filled in every string. */
function fill<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (all, name: string) => vars[name] ?? all) as T;
  if (Array.isArray(value)) return value.map((item) => fill(item, vars)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [fill(k, vars), fill(v, vars)])) as T;
  return value;
}

export class SimAgent {
  private busy = false;
  private turn = 0;
  private queue: Promise<void> = Promise.resolve();
  readonly statusChanges = channel<AgentStatus>();
  private readonly author: CommentAuthor;

  constructor(
    private readonly script: AgentScript,
    private readonly store: DemoStore,
    private readonly comments: CommentStore,
    private readonly engines: DemoEngines | null = null,
  ) {
    this.author = { kind: 'agent', name: script.name };
  }

  status(): AgentStatus {
    return { available: true, busy: this.busy, name: this.script.name };
  }

  private setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.statusChanges.emit(this.status());
  }

  /** Queues one turn for `text` (from a thread when `threadId` is given). */
  request(text: string, threadId?: string): void {
    this.queue = this.queue.then(() => this.run(text, threadId)).catch((error: unknown) => {
      console.error('[playground] the simulated agent failed', error);
      this.setBusy(false);
    });
  }

  private async run(text: string, threadId?: string): Promise<void> {
    this.setBusy(true);
    await sleep(READ_MS);
    if (threadId) this.comments.markDelivered(threadId);
    await sleep(Math.max(0, this.script.thinkMs - READ_MS));
    const responses = this.script.responses;
    this.turn += 1;
    const response: AgentResponse | undefined = responses.length ? responses[(this.turn - 1) % responses.length] : undefined;
    // A comment addressed to the agent starts with its @mention (the docs editor puts one in front): not part of the ask.
    const mention = `@${this.script.name}`;
    const asked = text.trim();
    const request = (asked.startsWith(mention) ? asked.slice(mention.length) : asked).trim().replace(/\s+/g, ' ');
    const vars: Record<string, string> = { n: String(this.turn), request: request.length > REQUEST_CHARS ? `${request.slice(0, REQUEST_CHARS - 1)}…` : request };
    const turn: Turn = { ...(threadId ? { threadId } : {}), vars };
    for (const edit of response?.edits ?? []) await this.apply(edit, turn);
    if (threadId) {
      try {
        this.comments.reply(threadId, fill(response?.reply ?? 'Done.', vars), undefined, this.author);
      } catch {
        // The person removed the thread meanwhile.
      }
    }
    this.setBusy(false);
  }

  private async apply(edit: AgentEdit, turn: Turn): Promise<void> {
    const vars = turn.vars;
    if (edit.kind === 'doc') return this.writeDoc(fill(edit, vars), turn);
    if (edit.kind === 'sheet') return this.writeSheet(fill(edit, vars), turn);
    if (edit.kind === 'db') {
      const writes: DbWrite[] = fill(edit.writes, vars);
      if (edit.appendOrder) {
        const order = fill(edit.appendOrder, vars);
        const doc = this.store.getDoc(order.path) ?? {};
        writes.push({ op: 'set', path: order.path, data: appended(doc, order) });
      }
      await this.store.writeDocs(writes, 'agent');
      return;
    }
    const htmlVars = { ...vars, request: escapeHtml(vars.request ?? '') };
    const batch: PublishBatch = {};
    for (const [path, content] of Object.entries(edit.files)) batch[fill(path, vars)] = { content: fill(content, htmlVars) };
    if (edit.appendOrder) {
      const order = fill(edit.appendOrder, vars);
      const doc = JSON.parse(this.store.readText(order.path)) as JsonRecord;
      batch[order.path] = { content: `${JSON.stringify(appended(doc, order), null, 2)}\n` };
    }
    await this.store.publish(batch, 'agent');
  }

  /** A paragraph by the agent, written through the Docs host's agent call (the page hears it as the agent's). */
  private async writeDoc(edit: DocEdit, turn: Turn): Promise<void> {
    const doc = this.engines?.doc;
    if (!doc) throw new Error('This demo has no doc to write in.');
    const tabs = [...doc.host.project().files].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const location = turn.threadId ? this.threadLocation(turn.threadId) : null;
    const tab = (edit.tab ? tabs.find((t) => t.name === edit.tab) : tabs.find((t) => t.id === location?.tab)) ?? tabs[0];
    if (!tab) throw new Error('The doc has no tab.');
    const blocks = doc.host.read(tab.id, { id: 'agent', name: this.script.name, role: 'owner' }).doc.blocks;
    const paragraph = { as: 'blocks', from: { kind: 'inline', content: [{ type: 'paragraph', content: [{ type: 'text', text: edit.text }] }] } };
    const first = blocks[0];
    const op =
      edit.at === 'top' && first
        ? { op: 'insert', target: { kind: 'blocks', ids: [first.id] }, side: 'after', with: paragraph }
        : { op: 'insert', target: { kind: 'root' }, side: edit.at === 'top' ? 'start' : 'end', with: paragraph };
    const outcome = doc.host.agentCall({ tool: 'update', ref: { object: 'node', id: tab.content.id }, payload: { ops: [op] } });
    if (outcome.status !== 200) throw new Error(`The doc refused the agent's edit: ${JSON.stringify(outcome.body)}`);
    turn.vars.tab = tab.name;
    await this.engines?.mirror('agent');
  }

  /** A cell by the agent, written through the Sheets store's agent update (formulas work themselves out again). */
  private async writeSheet(edit: SheetEdit, turn: Turn): Promise<void> {
    const sheet = this.engines?.sheet;
    if (!sheet) throw new Error('This demo has no workbook to write in.');
    const watched = (): string => (edit.watch ? cellValue(sheet.agentRead({ kind: 'readCells', sheet: edit.watch.sheet, range: edit.watch.cell })) : '');
    const was = watched();
    const answer = sheet.store.agentUpdate({ kind: 'applyEdits', base: sheet.store.revision, edits: [{ kind: 'writeCells', sheet: edit.sheet, topLeft: edit.cell, rows: [[edit.value]] }] });
    if (!answer || typeof answer !== 'object' || typeof (answer as { revision?: unknown }).revision !== 'number') throw new Error(`The workbook refused the agent's edit: ${JSON.stringify(answer)}`);
    turn.vars.was = was;
    turn.vars.now = watched();
    turn.vars.value = typeof edit.value === 'number' ? edit.value.toLocaleString('en-US') : edit.value;
    await this.engines?.mirror('agent');
  }

  /** Where the thread is (a doc thread's `location` names its tab), or null. */
  private threadLocation(threadId: string): { tab?: string } | null {
    try {
      const location = this.comments.find(threadId).location as { tab?: unknown } | undefined;
      return typeof location?.tab === 'string' ? { tab: location.tab } : null;
    } catch {
      return null;
    }
  }
}

/** The value an agent read of one cell shows (`{rows: {"5": [value | {formula, value}]}}`), as text. */
function cellValue(read: unknown): string {
  const rows = (read as { rows?: Record<string, unknown[]> } | null)?.rows ?? {};
  const first = Object.values(rows)[0]?.[0];
  const value = first && typeof first === 'object' && 'value' in first ? (first as { value: unknown }).value : first;
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return value === null || value === undefined ? '' : String(value);
}

/** `doc` with `order.value` at the end of its array `order.field` (once). */
function appended(doc: JsonRecord, order: AppendOrder): JsonRecord {
  const list: JsonValue[] = Array.isArray(doc[order.field]) ? [...(doc[order.field] as JsonValue[])] : [];
  if (!list.includes(order.value)) list.push(order.value);
  return { ...doc, [order.field]: list };
}
