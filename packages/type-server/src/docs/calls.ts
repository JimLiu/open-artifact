/**
 * The calls on a doc: `read`, `update`, `create`, `delete` and `batch` (several of those as members, `$lid` aliases
 * tying them together), plus the birth of a doc. The CLI runs them on the folder directly, or through the running
 * server, which then tells the open pages; the server also runs the page's own calls on tabs and dropdown lists
 * through the same members.
 *
 * Objects: `project` = the doc, `file` = a tab, `node` = a tab's body (its prose), `enum` = a dropdown's options.
 * Writes are agent writes: replacing or deleting whole blocks is guarded. A call lands whole or not at all.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type Atom,
  type Block,
  type Chips,
  type DocState,
  type ExportContext,
  type Proposal,
  type Session,
  type SuggestionInfo,
  type Version,
  type Writer,
  CONTENTS_PER_FILE,
  DocAnchors,
  HISTORY_DIR,
  MarkdownError,
  Refusal,
  SUGGEST_ID,
  applyOps,
  blockHash,
  blockXml,
  blocksToMarkdown,
  committed,
  contentsOf,
  docToDisk,
  findBlock,
  findChar,
  githubSlug,
  isAtom,
  isText,
  newBlock,
  proposalIds,
  sameProposal,
  shownWords,
  suggestionAsOf,
  uniqueSlugs,
  versionAt,
  walk,
} from '@open-artifact/docs-core';
import { CommentStore } from '@open-artifact/server-sdk/comments';
import { type DeletedTabInfo, DocStore, type EnumDef, FIRST_TAB_NAME, LOCKED_WORDS, MANIFEST_FILE, RESTORED_TAB_NAME, SESSIONS_FILE, StoreError, TABS_DIR, type UndeleteResult } from './store.ts';

/** Who a call is made by: the owner (and the agent acting for them) or a guest. */
export interface DocPerson {
  id: string;
  name: string;
}

/** What a call changed, so open pages hear of it. */
export interface Changes {
  tabs?: string[];
  project?: boolean;
  /** Dropdown lists made or changed: a page re-reads its lists when the feed names one. */
  enums?: string[];
}

export interface CallOutcome {
  status: number;
  body: Json;
  changes?: Changes;
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** A refused call: nothing it asked for was written. */
export class CallRefusal extends Error {
  code: string;
  status: number;
  data: Json;
  constructor(code: string, message: string, data: Json = {}, status = 409) {
    super(message);
    this.code = code;
    this.data = data;
    this.status = status;
  }
}

const OUTLINE_TEXT = 200;
const SEARCH_HITS = 100;
const BIRTH_NAME = /^[^/\\\u0000-\u001f\u007f]{1,255}$/;

// ---- printing ----------------------------------------------------------------------------------------------------

const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttr = (value: string) => escapeText(value).replaceAll("'", '&apos;');

function attrs(values: Record<string, unknown>): string {
  let out = '';
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === false) continue;
    const text = value === true ? '1' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    out += ` ${key}='${escapeAttr(text)}'`;
  }
  return out;
}

function atomTag(item: Atom): string {
  const a = item.attrs ?? {};
  if (item.atom === 'hardBreak') return '<hardBreak/>';
  if (item.atom === 'mention') return `<mention${attrs({ user: a.principal ?? undefined, ref: a.ref ?? undefined, label: a.name ?? a.label ?? undefined })}/>`;
  if (item.atom === 'date') return `<date${attrs({ value: a.ts })}/>`;
  if (item.atom === 'dropdown') return `<dropdown${attrs({ enum: a.enum, index: a.index })}/>`;
  return `<media${attrs(a)}/>`;
}

/** A text block's words for the outline: chips as tags, suggested words in `<ins s>`/`<del s>`, cut at OUTLINE_TEXT characters. */
function outlineText(block: Block): string {
  let out = '';
  let count = 0;
  let open: Proposal | undefined;
  const close = () => {
    if (open) out += `</${open.op}>`;
    open = undefined;
  };
  for (const item of block.inline ?? []) {
    if (count >= OUTLINE_TEXT) {
      close();
      return `${out}…`;
    }
    const suggest = sameProposal(item.suggest, block.suggest) ? undefined : item.suggest;
    if (!sameProposal(suggest, open)) {
      close();
      if (suggest) out += `<${suggest.op} s='${suggest.id}'>`;
      open = suggest;
    }
    out += isAtom(item) ? atomTag(item) : escapeText(item.ch);
    count++;
  }
  close();
  return out;
}

/** One block as the outline shows it: id, hash, attrs; text in full (cut when long); containers folded to a gap. */
function outlineBlock(block: Block): string {
  const suggest = block.suggest ? { suggest: block.suggest.op, s: block.suggest.id } : {};
  const head = `<${block.type}${attrs({ id: block.id, h: blockHash(block), ...(block.attrs ?? {}), ...suggest })}`;
  if (block.inline) return `${head}>${outlineText(block)}</${block.type}>`;
  if (block.children) return `${head}><gap blocks='${block.children.length}'/></${block.type}>`;
  return `${head}/>`;
}

/** The outline leaves out blocks a suggestion adds (the view shows them); words a suggestion adds or strikes are marked. */
const outlineXml = (doc: DocState, me: string) =>
  `<doc rev='${doc.rev}'>\n${doc.blocks.filter(block => block.suggest?.op !== 'ins').map(outlineBlock).join('\n')}${suggestionsXml(doc, proposalIds(doc.blocks), me)}\n</doc>`;
/** Who made a version: `agent` (a CLI call), `human` (the page; with the person) or `system` (from before the history began). */
const authorOf = (version: Version): Json => ({ by: version.by, ...(version.by === 'human' ? { user: version.user } : {}) });
const viewXml = (doc: DocState, blocks: Block[], me: string) =>
  `<doc rev='${doc.rev}' complete='1'>\n${blocks.map(block => blockXml(block, { hashes: true, form: 'agent' })).join('\n')}${suggestionsXml(doc, proposalIds(blocks), me)}\n</doc>`;

/**
 * The open suggestions a read shows: who made each and when, `via='agent'` for an agent's, `mine='1'` for this agent's
 * own (the person's own, made in Suggesting mode under the same user, are theirs, not the agent's), and `asOf`.
 */
function suggestionList(doc: DocState, ids: string[], me: string): Json[] {
  return ids.map(id => {
    const info: SuggestionInfo | undefined = doc.suggestions?.[id];
    return { id, ...(info?.by ? { by: info.by } : {}), ...(info?.at ? { at: info.at } : {}), ...(info?.via ? { via: info.via } : {}), ...(info?.via === 'agent' && info.by === me ? { mine: true } : {}), asOf: suggestionAsOf(doc.blocks, id) };
  });
}

function suggestionsXml(doc: DocState, ids: string[], me: string): string {
  if (!ids.length) return '';
  return `\n<suggestions>\n${suggestionList(doc, ids, me).map(row => `<suggestion${attrs(row)}/>`).join('\n')}\n</suggestions>`;
}

/** A suggestion's members, as its ack counts them: each run of words it strikes or adds, and each block. */
function memberCount(blocks: Block[], id: string, inside = false): number {
  let count = 0;
  for (const block of blocks) {
    const own = block.suggest?.id === id;
    if (own && !inside) count++;
    if (block.inline && !own && !inside) {
      let last: string | undefined;
      for (const item of block.inline) {
        const op = item.suggest?.id === id ? item.suggest.op : undefined;
        if (op && op !== last) count++;
        last = op;
      }
    }
    if (block.children) count += memberCount(block.children, id, inside || own);
  }
  return count;
}

/** What one op wrote: the outermost blocks it made, and the text blocks it put new words in. */
function writtenXml(doc: DocState, minted: string[] | undefined, index: number): string {
  const ids = new Set(minted ?? []);
  const out: Block[] = [];
  const collect = (blocks: Block[]) => {
    for (const block of blocks) {
      if (ids.has(block.id) || (isText(block) && block.inline!.some(item => ids.has(item.id)))) out.push(block);
      else if (block.children) collect(block.children);
    }
  };
  if (ids.size) collect(doc.blocks);
  return out.length ? `<doc op='${index}'>${out.map(outlineBlock).join('')}</doc>` : `<doc op='${index}'/>`;
}

// ---- the runner --------------------------------------------------------------------------------------------------

interface MemberAck extends Json {}

class Runner {
  private store: DocStore;
  private user: DocPerson;
  private session: Session;
  readonly lids = new Map<string, string>();
  readonly changedTabs = new Set<string>();
  readonly changedEnums = new Set<string>();
  changedProject = false;

  /** Agent writes need hash guards on what they change; the page's own writes do not. */
  private guards: boolean;
  /** The call is the page's (it reads tabs in the file format), not the agent's (markdown). */
  private fromPage: boolean;
  /** Who the versions this call makes are by: a page session is a person, the CLI's is the agent (one version a call). */
  private writer: Writer;
  /** The caller may lock and unlock the doc: an owner, or the agent acting for one. */
  private mayLock: boolean;

  constructor(store: DocStore, user: DocPerson, session: Session, guards = true, mayLock = true) {
    this.store = store;
    this.user = user;
    this.session = session;
    this.guards = guards;
    this.mayLock = mayLock;
    // Only the page's calls go without guards.
    this.fromPage = !guards;
    this.writer =
      store.sessionKind(session.sess) === 'page'
        ? { by: 'human', user: user.id, sess: session.sess }
        : { by: 'agent', user: user.id, sess: session.sess, call: randomUUID() };
  }

  get changes(): Changes {
    return {
      ...(this.changedTabs.size ? { tabs: [...this.changedTabs] } : {}),
      ...(this.changedProject ? { project: true } : {}),
      ...(this.changedEnums.size ? { enums: [...this.changedEnums] } : {}),
    };
  }

  /** Replaces every `$lid:<alias>` in strings with the id that alias minted earlier in the call. */
  resolve<T>(value: T): T {
    if (typeof value === 'string') {
      return value.replace(/\$lid:([A-Za-z0-9_-]+)/g, (_, alias: string) => {
        const id = this.lids.get(alias);
        if (!id) throw new CallRefusal('lid_unknown', `$lid:${alias} names no member before this one`, { lid: alias });
        return id;
      }) as T;
    }
    if (Array.isArray(value)) return value.map(item => this.resolve(item)) as T;
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolve(item)])) as T;
    return value;
  }

  member(raw: unknown): MemberAck {
    if (!isRecord(raw)) throw new CallRefusal('bad_member', 'a member is an object: {verb, object | ref, payload}');
    const alias = typeof raw.$lid === 'string' ? raw.$lid : undefined;
    if (alias !== undefined && (!/^[A-Za-z0-9_-]+$/.test(alias) || this.lids.has(alias)))
      throw new CallRefusal('bad_lid', `$lid "${alias}" is not a fresh alias (letters, digits, _ and -, once per call)`);
    const { $lid: _alias, ...rest } = raw;
    const member: Json = this.resolve(rest);
    const ref = isRecord(member.ref) ? member.ref : null;
    const object = String(ref?.object ?? member.object ?? '');
    const id = ref && isId(ref.id) ? ref.id : '';
    const payload = isRecord(member.payload) ? member.payload : {};
    const verb = String(member.verb ?? '');
    // A locked doc takes no change but its own unlock (or a new note on its lock); reads go on.
    const lock = this.store.manifest.locked;
    if (lock && verb !== 'read' && !(verb === 'update' && object === 'project' && isLockPatch(payload)))
      throw new CallRefusal('locked', LOCKED_WORDS, { lockedBy: lock.by, lockedAt: lock.at, ...(lock.note ? { note: lock.note } : {}) });
    let ack: MemberAck;
    switch (`${verb} ${object}`) {
      case 'read project':
        ack = { value: payload.kind === 'deleted' ? (payload.id === undefined ? { deleted: this.store.deletedTabs() as unknown as Json[] } : this.deletedTab(payload.id)) : this.projectValue() };
        break;
      case 'read file':
        ack = { value: this.fileValue(this.tabId(id)) };
        break;
      case 'read node':
        ack = this.readNode(id, payload);
        break;
      case 'create file':
        ack = this.createFile(payload);
        break;
      case 'create node':
        ack = this.createNode(payload, member.engine);
        break;
      case 'create enum':
        ack = this.createEnum(payload);
        break;
      case 'read enum':
        ack = { value: this.enumValue(id) };
        break;
      case 'update enum':
        ack = this.updateEnum(id, payload);
        break;
      case 'update project':
        ack = this.updateProject(payload);
        break;
      case 'update file':
        ack = this.updateFile(this.tabId(id), payload);
        break;
      case 'update node':
        ack = this.updateNode(id, payload);
        break;
      case 'delete file':
        ack = this.deleteFile(this.tabId(id), payload);
        break;
      case 'delete node':
        if (this.store.tabOfNode(id)) throw new CallRefusal('tab_body', 'this is the body a tab shows; delete the tab (its file) instead');
        throw new CallRefusal('absent', `no node ${id}`, {}, 404);
      default:
        if (object === 'utterance') throw new CallRefusal('not_here', 'comments are not doc calls: use the comments commands (they keep the artifact\'s comments.json)', {}, 400);
        throw new CallRefusal('unsupported', `${verb || '(no verb)'} ${object || '(no object)'} is not a call on a local doc`, {}, 400);
    }
    if (alias !== undefined && isId(ack.minted)) this.lids.set(alias, ack.minted);
    return ack;
  }

  // -- objects --

  projectValue(): Json {
    const { manifest } = this.store;
    // How many deleted tabs a restore can bring back (`read project` with payload {kind: 'deleted'} lists them).
    const deleted = this.store.deletedTabs({ lines: false }).length;
    return {
      id: this.store.id,
      name: manifest.name,
      head: manifest.head,
      updated: manifest.updated,
      files: this.store.tabIds().map(id => this.fileValue(id)),
      ...(Object.keys(manifest.enums).length ? { enums: Object.entries(manifest.enums).map(([id, def]) => ({ id, name: def.name, options: def.options.map(option => option.name) })) } : {}),
      ...(manifest.display ? { display: manifest.display } : {}),
      ...(deleted ? { deletedTabs: deleted } : {}),
      ...(manifest.locked ? { locked: manifest.locked } : {}),
    };
  }

  fileValue(tabId: string): Json {
    const tab = this.store.tab(tabId);
    return {
      id: tabId,
      name: tab.name,
      order: tab.order,
      ...(tab.subtabOf ? { subtabOf: tab.subtabOf } : {}),
      rev: this.store.doc(tabId).rev,
      content: { kind: 'node', id: tab.node, engine: 'prose' },
    };
  }

  /** A tab by its id (or its body's id, or its name). */
  tabId(key: string): string {
    if (!key) throw new CallRefusal('bad_ref', 'the call names no tab (ref.id)', {}, 400);
    if (this.store.manifest.tabs[key]) return key;
    const byNode = this.store.tabOfNode(key);
    if (byNode) return byNode;
    try {
      return this.store.findTab(key);
    } catch (error) {
      throw new CallRefusal('absent', (error as Error).message, {}, 404);
    }
  }

  /** The tab whose body is `node` (a tab id or name is taken too; none = the first tab). */
  bodyTab(node: string): string {
    // No id: the first tab (the CLI's `{ops}` shorthand).
    if (!node) return this.store.tabIds()[0]!;
    const byNode = this.store.tabOfNode(node);
    if (byNode) return byNode;
    if (this.store.manifest.tabs[node]) return node;
    try {
      return this.store.findTab(node);
    } catch (error) {
      // The store's message lists the tabs, or the ids of the ones sharing that name.
      const why = error instanceof StoreError ? error.message : `no tab body ${node}; the doc read lists each tab's body as files[].content.id`;
      throw new CallRefusal('absent', why, {}, 404);
    }
  }

  // -- reads --

  readNode(node: string, payload: Json): Json {
    const tabId = this.bodyTab(node);
    const doc = this.store.doc(tabId);
    const kind = String(payload.kind ?? payload.projection ?? 'outline');
    if (kind === 'outline') return { rev: doc.rev, tab: tabId, xml: outlineXml(doc, this.user.id) };
    if (kind === 'suggestions') {
      const wanted = Array.isArray(payload.ids) ? new Set(payload.ids.filter(isId)) : null;
      const ids = proposalIds(doc.blocks).filter(id => !wanted || wanted.has(id));
      return { rev: doc.rev, tab: tabId, suggestions: suggestionList(doc, ids, this.user.id) };
    }
    if (kind === 'markdown') return { rev: doc.rev, tab: tabId, markdown: this.markdown(tabId) };
    if (kind === 'search') return { rev: doc.rev, tab: tabId, ...this.search(doc, payload) };
    if (kind === 'history') return this.historyOf(tabId);
    if (kind !== 'view') throw new CallRefusal('bad_read', `unknown read kind ${JSON.stringify(kind)}: outline, view, search, markdown, history or suggestions`, {}, 400);
    if (payload.atRev !== undefined) return this.readAt(tabId, Number(payload.atRev));
    if (payload.sinceRev !== undefined) {
      const since = Number(payload.sinceRev);
      if (since === doc.rev) return { rev: doc.rev, tab: tabId, unchanged: true };
      // No per-rev history here: anything newer is the whole tab again.
      return { rev: doc.rev, tab: tabId, full: true, xml: viewXml(doc, doc.blocks, this.user.id) };
    }
    if (isId(payload.parentId)) {
      const place = findBlock(doc, payload.parentId);
      if (!place) throw new CallRefusal('block_gone', `block ${payload.parentId} is not in the tab`, { id: payload.parentId }, 404);
      return { rev: doc.rev, tab: tabId, xml: viewXml(doc, [place.block], this.user.id) };
    }
    return { rev: doc.rev, tab: tabId, xml: viewXml(doc, doc.blocks, this.user.id) };
  }

  /**
   * The tab as it stood at `rev` (`latest` = its rev now). The history keeps versions, not every rev: a rev between two
   * is answered with the newest version at or before it, and `rev` says which one that is.
   */
  private readAt(tabId: string, rev: number): Json {
    const doc = this.store.doc(tabId);
    if (!Number.isInteger(rev) || rev < 1) throw new CallRefusal('bad_rev', 'atRev is a rev: a whole number from 1', {}, 400);
    if (rev >= doc.rev) return { rev: doc.rev, latest: doc.rev, tab: tabId, xml: viewXml(doc, doc.blocks, this.user.id) };
    const index = this.store.history(tabId);
    const version = index ? versionAt(index, rev) : undefined;
    const old = version ? this.store.snapshot(tabId, version.rev) : null;
    if (!version || !old) {
      const oldest = index?.versions[0]?.rev;
      throw new CallRefusal('no_history', oldest === undefined ? `the tab keeps no version before rev ${doc.rev}` : `the tab keeps no version at or before rev ${rev}; the oldest is rev ${oldest}`, { latest: doc.rev, ...(oldest !== undefined ? { oldest } : {}) });
    }
    return { rev: old.rev, latest: doc.rev, tab: tabId, ...authorOf(version), at: version.at, xml: viewXml(old, old.blocks, this.user.id) };
  }

  /** The tab's kept versions, newest first: each one's rev (for `atRev` and `restore`), who made it and when. */
  private historyOf(tabId: string): Json {
    const doc = this.store.doc(tabId);
    const versions = [...(this.store.history(tabId)?.versions ?? [])].reverse().map(version => ({
      rev: version.rev,
      ...authorOf(version),
      at: version.at,
      ...(version.restoredFrom !== undefined ? { restoredFrom: version.restoredFrom } : {}),
    }));
    return { rev: doc.rev, tab: tabId, versions };
  }

  /** The `restore` op: the whole tab back to a kept rev, the only op in its call, guarded by `ifRev` = the rev now. */
  private restore(tabId: string, ops: unknown[], ifRev: unknown): Json {
    if (ops.length !== 1) throw new CallRefusal('restore_alone', 'restore is the only op in its call', { op: 0 }, 400);
    const op = ops[0] as Json;
    const rev = Number(op.rev);
    if (!Number.isInteger(rev) || rev < 1) throw new CallRefusal('bad_rev', 'restore names a rev: {"op":"restore","rev":N}', { op: 0 }, 400);
    const doc = this.store.doc(tabId);
    if (ifRev === undefined) throw new CallRefusal('missing_guard', `restore needs payload.ifRev: the rev now (${doc.rev}), from the atRev read's latest`, { op: 0, rev: doc.rev });
    if (Number(ifRev) !== doc.rev) throw new CallRefusal('guard_mismatch', `the tab changed since: it is at rev ${doc.rev}, not ${String(ifRev)}; read it again before rewinding`, { op: 0, rev: doc.rev });
    if (!this.store.snapshot(tabId, rev)) {
      const index = this.store.history(tabId);
      const kept = index ? index.versions.filter(version => version.rev < doc.rev).map(version => version.rev) : [];
      throw new CallRefusal('no_history', `the tab keeps no version at rev ${rev}${kept.length ? `; kept: ${kept.slice(-20).join(', ')}` : ''}`, { op: 0, latest: doc.rev, kept: kept.slice(-20) });
    }
    const result = this.store.restoreTab(tabId, rev, this.writer);
    if (result.restored) this.changedTabs.add(tabId);
    return { rev: result.rev, session: this.session.sess, restored: result.restored, ...(result.restored ? {} : { noop: true }) };
  }

  /** What markdown says for the doc's chips. */
  markdownContext(): ExportContext {
    const enums = Object.fromEntries(Object.entries(this.store.manifest.enums).map(([id, def]) => [id, def.options.map(option => option.name)]));
    const refs = Object.fromEntries(this.store.tabIds().map(id => [`file/${id}`, this.store.tab(id).name]));
    return { enums, names: { [this.user.id]: this.user.name }, refs };
  }

  /**
   * A deleted tab's content, read-only (`read project` with payload `{kind: 'deleted', id}`): the page gets the tab as it
   * was deleted (`doc`, in the file format, open suggestions left out), the agent its markdown.
   */
  deletedTab(id: unknown): Json {
    if (!isId(id)) throw new CallRefusal('bad_ref', 'id names a deleted tab (read the project with payload {kind: "deleted"} for the list)', {}, 400);
    let doc: DocState;
    try {
      doc = committed(this.store.deletedSnapshot(id));
    } catch (error) {
      if (error instanceof StoreError && error.code === 'NOT_DELETED') throw new CallRefusal('absent', `no deleted tab ${id}; read the project with payload {kind: "deleted"} for the list`, {}, 404);
      if (error instanceof StoreError && error.code === 'BAD_TAB') throw new CallRefusal('unreadable', `the deleted tab ${id} can't be read`, {}, 500);
      throw error;
    }
    const name = this.store.manifest.deleted?.[id]?.name ?? null;
    const content: Json = this.fromPage ? { doc: docToDisk(doc) as unknown as Json } : { markdown: blocksToMarkdown(doc.blocks, this.markdownContext()) };
    return { id, name, rev: doc.rev, ...content };
  }

  markdown(tabId: string): string {
    // Markdown is the tab as it reads now: an open suggestion's words are not in it until the person accepts them.
    return blocksToMarkdown(committed(this.store.doc(tabId)).blocks, this.markdownContext());
  }

  /** `{text}`: every place the words stand (any case); `{range:[a,b], blocks:[first,last]}`: one hit per block of a selection. */
  search(doc: DocState, payload: Json): Json {
    const textBlocks = [...walk(doc.blocks)].map(place => place.block).filter(isText);
    const charsOf = (block: Block) => block.inline!.map(item => (isAtom(item) ? '￼' : item.ch));
    const hit = (block: Block, from: number, to: number) => ({
      block: block.id,
      text: charsOf(block).slice(from, to + 1).join(''),
      range: [block.inline![from]!.id, block.inline![to]!.id],
    });
    if (Array.isArray(payload.range)) {
      const [a, b] = payload.range;
      const ends = Array.isArray(payload.blocks) ? payload.blocks : [];
      const first = isId(ends[0]) ? ends[0] : undefined;
      const last = isId(ends[ends.length - 1]) ? ends[ends.length - 1] : first;
      const start = isId(a) ? findChar(doc, a) : null;
      const end = isId(b) ? findChar(doc, b) : null;
      if (!start || !end) throw new CallRefusal('char_gone', 'a char of the range is not in the tab', { range: payload.range });
      if ((first && start.block.id !== first) || (last && end.block.id !== last))
        throw new CallRefusal('range_outside', 'the range does not start in the first block and end in the last', { range: payload.range, blocks: ends });
      const from = textBlocks.indexOf(start.block);
      const to = textBlocks.indexOf(end.block);
      if (from > to || (from === to && start.index > end.index)) throw new CallRefusal('range_order', 'the range runs backwards');
      const hits: Json[] = [];
      for (let index = from; index <= to; index++) {
        const block = textBlocks[index]!;
        const lo = index === from ? start.index : 0;
        const hi = index === to ? end.index : block.inline!.length - 1;
        if (hi >= lo) hits.push(hit(block, lo, hi));
      }
      return { hits };
    }
    const wanted = Array.from(String(payload.text ?? '').toLowerCase());
    if (!wanted.length) throw new CallRefusal('bad_read', 'search needs text (or range + blocks)', {}, 400);
    const hits: Json[] = [];
    let more = 0;
    for (const block of textBlocks) {
      const chars = charsOf(block).map(ch => ch.toLowerCase());
      for (let at = 0; at + wanted.length <= chars.length; at++) {
        if (!wanted.every((ch, offset) => chars[at + offset] === ch)) continue;
        if (hits.length < SEARCH_HITS) hits.push(hit(block, at, at + wanted.length - 1));
        else more++;
        at += wanted.length - 1;
      }
    }
    return { hits, ...(more ? { more } : {}) };
  }

  // -- writes --

  private take = (): string => `${this.session.sess}.${this.session.next++}`;

  private emptyParagraph(): Block {
    return newBlock('paragraph', this.take());
  }

  createFile(payload: Json): Json {
    if (payload.undelete !== undefined) return this.undeleteFile(payload.undelete);
    if (payload.copyOf !== undefined) return this.copyDeletedFile(payload.copyOf);
    const value = isRecord(payload.value) ? payload.value : payload;
    const birthName = value.birthName ?? value.name;
    if (typeof birthName !== 'string' || !BIRTH_NAME.test(birthName) || birthName.trim() !== birthName)
      throw new CallRefusal('bad_name', 'birthName is a file name: 1–255 characters, no / or control characters, no spaces at the ends', {}, 400);
    const tabId = this.store.addTab(birthName, [this.emptyParagraph()]);
    this.changedProject = true;
    return { minted: tabId, body: this.store.tab(tabId).node };
  }

  createNode(payload: Json, engine: unknown): Json {
    if (engine !== undefined && engine !== 'prose') throw new CallRefusal('not_here', `${String(engine)} nodes (charts, drawings) are not in the local doc yet`, {}, 400);
    const parent = isRecord(payload.parent) ? payload.parent : null;
    if (!parent || parent.object !== 'file' || !isId(parent.id)) throw new CallRefusal('bad_parent', 'a prose node is made under a tab: parent {object:"file", id}', {}, 400);
    const tabId = this.tabId(parent.id);
    const doc = this.store.doc(tabId);
    const only = doc.blocks.length === 1 ? doc.blocks[0]! : null;
    if (!only || only.type !== 'paragraph' || only.inline!.length)
      throw new CallRefusal('exists', 'that tab already has its body; write to it with an update', { minted: this.store.tab(tabId).node });
    // The page sends its starting content as a ProseMirror doc ({type: 'doc', content}); agents send a source.
    const pmDoc = isRecord(payload.doc) && Array.isArray(payload.doc.content) ? payload.doc.content : null;
    const source =
      payload.source ??
      (pmDoc ? { as: 'blocks', from: { kind: 'inline', content: pmDoc } } : undefined) ??
      (typeof payload.markdown === 'string' ? { as: 'markdown', from: { kind: 'inline', content: payload.markdown }, ...(isRecord(payload.blocks) ? { blocks: payload.blocks } : {}) } : undefined);
    const replace = { op: 'replace', target: { kind: 'blocks', ids: [only.id] }, force: true, with: source, ...(payload.ids !== undefined ? { ids: payload.ids } : {}) };
    const ack = isRecord(source) ? this.write(tabId, [replace], undefined) : { rev: doc.rev };
    return { minted: this.store.tab(tabId).node, ...ack };
  }

  createEnum(payload: Json): Json {
    const minted = this.store.addEnum(enumDef(isRecord(payload.value) ? payload.value : payload));
    this.changedEnums.add(minted);
    return { minted };
  }

  /** A dropdown list as the page's chip menu reads it: `{name, options: [{name, order, disabled, color?}]}`. */
  enumValue(id: string): Json {
    const def = this.store.manifest.enums[id];
    if (!def) throw new CallRefusal('absent', `no dropdown list ${id}`, {}, 404);
    return { name: def.name, options: def.options.map(option => ({ name: option.name, order: option.order, disabled: option.disabled === true, ...(option.color ? { color: option.color } : {}) })) };
  }

  /**
   * A list's new name and options, whole (`{kind: 'value', value: {name, options}}`, as the page's chip menu sends when
   * an option is added, renamed, recoloured, reordered or retired). A dropdown names its option by position, so the
   * options keep their places: one fewer is refused, a retired one stays with `disabled: true`.
   */
  updateEnum(id: string, payload: Json): Json {
    const before = this.store.manifest.enums[id];
    if (!before) throw new CallRefusal('absent', `no dropdown list ${id}`, {}, 404);
    const def = enumDef(isRecord(payload.value) ? payload.value : payload);
    if (def.options.length < before.options.length)
      throw new CallRefusal(
        'enum_shrinks',
        `the list has ${before.options.length} options and a dropdown names its option by position: keep each where it is (disabled: true retires one) and add new ones at the end`,
        { options: before.options.length },
        409,
      );
    this.store.updateEnum(id, def);
    this.changedEnums.add(id);
    return {};
  }

  updateProject(payload: Json): Json {
    const patch = payload.kind === 'patch' && Array.isArray(payload.patch) ? payload.patch : null;
    if (!patch) {
      const value = isRecord(payload.value) ? payload.value : payload;
      if (typeof value.name !== 'string') throw new CallRefusal('bad_patch', 'a doc update is {kind:"patch", patch:[{op, path, value}]}', {}, 400);
      this.rename(value.name);
      return {};
    }
    for (const [index, raw] of patch.entries()) {
      if (!isRecord(raw) || !Array.isArray(raw.path)) throw new CallRefusal('bad_patch', `patch ${index} needs op and path`, { patch: index }, 400);
      const [head, tabKey, field, ...rest] = raw.path.map(String);
      const op = raw.op;
      // The lock: set locks the doc (value {note?}), delete unlocks it. Only an owner (or the agent for one) may.
      if (head === 'locked' && raw.path.length === 1) {
        this.setLock(op, raw.value, index);
        continue;
      }
      if (head === 'name' && raw.path.length === 1 && op === 'set') {
        this.rename(raw.value);
        continue;
      }
      // The page clears its retired folder map whenever it places or drops a tab; there is none here.
      if (head === 'directory' && op === 'delete' && raw.path.length === 2) continue;
      // How the page shows the doc (fonts, page width, tabs beside the text): the page's own keys, kept as sent.
      if (head === 'display' && raw.path.length <= 2) {
        const key = raw.path.length === 2 ? tabKey : undefined;
        if (op === 'delete') this.store.setDisplay(key, undefined);
        else if (op === 'set' && raw.value !== undefined && (key !== undefined || isRecord(raw.value))) this.store.setDisplay(key, raw.value);
        else throw new CallRefusal('bad_patch', `patch ${index}: display takes set {key: value}, set display.<key>, or delete`, { patch: index }, 400);
        continue;
      }
      if (head !== 'tabs' || !tabKey || rest.length) throw new CallRefusal('bad_patch', `patch ${index}: a doc patch sets name, display[.<key>] or tabs.<tab id>[.name|.order|.subtabOf]`, { patch: index }, 400);
      if (op === 'delete' && field === undefined) {
        // Dropping a placement: the page sends it with the tab's file delete, which is what removes the tab here.
        continue;
      }
      const tabId = this.tabId(tabKey);
      if (op === 'delete') {
        if (field !== 'subtabOf') throw new CallRefusal('bad_patch', `patch ${index}: only subtabOf is deleted this way; a tab goes with delete on its file`, { patch: index }, 400);
        this.store.nestTab(tabId, undefined);
        continue;
      }
      if (op !== 'set') throw new CallRefusal('bad_patch', `patch ${index}: op is set or delete`, { patch: index }, 400);
      // A whole placement replaces the old one, so a tab set without subtabOf is top-level.
      const fields = field === undefined ? (isRecord(raw.value) ? { subtabOf: null, ...raw.value } : null) : { [field]: raw.value };
      if (!fields) throw new CallRefusal('bad_patch', `patch ${index}: tabs.<id> takes {name?, order?, subtabOf?}`, { patch: index }, 400);
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'name') {
          if (typeof value !== 'string' || !value.trim()) throw new CallRefusal('bad_patch', `patch ${index}: a tab name is a non-empty string`, { patch: index }, 400);
          this.store.renameTab(tabId, value.trim());
        } else if (key === 'order') {
          // The page's own keys: base-62 digits, never ending in 0. It ignores any other key when it places a tab
          // next to this one, so a tab moved there would land somewhere else.
          if (typeof value !== 'string' || !/^[0-9A-Za-z]{0,127}[1-9A-Za-z]$/.test(value))
            throw new CallRefusal('bad_patch', `patch ${index}: order is a sort key of letters and digits that does not end in 0 ("V", "k", "kV"); tabs sort by it as strings`, { patch: index }, 400);
          this.store.moveTab(tabId, value);
        } else if (key === 'subtabOf') {
          this.store.nestTab(tabId, value === null || value === undefined ? undefined : this.tabId(String(value)));
        } else throw new CallRefusal('bad_patch', `patch ${index}: a tab has name, order and subtabOf here (not ${key})`, { patch: index }, 400);
      }
    }
    this.changedProject = true;
    return {};
  }

  private setLock(op: unknown, value: unknown, index: number): void {
    if (op !== 'set' && op !== 'delete') throw new CallRefusal('bad_patch', `patch ${index}: locked takes set (lock, value {note?}) or delete (unlock)`, { patch: index }, 400);
    if (!this.mayLock) throw new CallRefusal('not_owner', 'only an owner can lock or unlock this document', { patch: index }, 403);
    if (op === 'delete') {
      if (this.store.unlock()) this.changedProject = true;
      return;
    }
    if (value !== undefined && value !== null && !isRecord(value)) throw new CallRefusal('bad_patch', `patch ${index}: a lock's value is {note?}`, { patch: index }, 400);
    const note = isRecord(value) && typeof value.note === 'string' ? value.note.trim().slice(0, 1024) : '';
    this.store.lock({ id: this.user.id, name: this.user.name }, note || undefined);
    this.changedProject = true;
  }

  private rename(name: unknown): void {
    if (typeof name !== 'string' || !name.trim()) throw new CallRefusal('bad_patch', 'the doc name is a non-empty string', {}, 400);
    this.store.rename(name.trim());
    this.changedProject = true;
  }

  updateFile(tabId: string, payload: Json): Json {
    const value = isRecord(payload.value) ? payload.value : payload;
    const content = isRecord(value.content) ? value.content : null;
    if (content && content.id !== this.store.tab(tabId).node)
      throw new CallRefusal('not_here', "a local tab keeps the body it was made with; write to that body instead", { body: this.store.tab(tabId).node }, 400);
    return { noop: true };
  }

  /**
   * A deleted tab back (`{undelete: <tab id>}`, an id from a `read project` of kind `deleted`): with its name, body,
   * history and the comments on it, at its old place or after the last tab; the subtabs deleted with it come too.
   */
  undeleteFile(id: unknown): Json {
    if (!isId(id)) throw new CallRefusal('bad_ref', 'undelete names a deleted tab by its id (read the project with payload {kind: "deleted"} for the list)', {}, 400);
    let result: UndeleteResult;
    try {
      result = this.store.undeleteTab(id);
    } catch (error) {
      if (error instanceof StoreError && error.code === 'TAB_EXISTS') throw new CallRefusal('already_restored', 'That tab has already been restored.', { minted: id });
      if (error instanceof StoreError && error.code === 'NOT_DELETED') throw new CallRefusal('absent', `no deleted tab ${id}; read the project with payload {kind: "deleted"} for the list`, {}, 404);
      if (error instanceof StoreError) throw new CallRefusal('unreadable', error.message, {}, 409);
      throw error;
    }
    this.changedProject = true;
    return { minted: result.id, body: this.store.tab(result.id).node, name: result.name, returnedTo: result.returnedTo, restored: result.restored };
  }

  /**
   * A deleted tab's content as a new tab (`{copyOf: <tab id>}`), for when it can't come back itself: named as it was,
   * after the last tab, its words as they read (open suggestions left out), with new block ids. Its comments and history
   * stay with the deleted tab, which is still in the list.
   */
  copyDeletedFile(id: unknown): Json {
    if (!isId(id)) throw new CallRefusal('bad_ref', 'copyOf names a deleted tab by its id (read the project with payload {kind: "deleted"} for the list)', {}, 400);
    let doc: DocState;
    try {
      doc = this.store.deletedSnapshot(id);
    } catch (error) {
      if (error instanceof StoreError && error.code === 'NOT_DELETED') throw new CallRefusal('absent', `no deleted tab ${id}; read the project with payload {kind: "deleted"} for the list`, {}, 404);
      if (error instanceof StoreError) throw new CallRefusal('unreadable', error.message, {}, 409);
      throw error;
    }
    const name = this.store.deletedTabs({ lines: false }).flatMap(function flat(tab): DeletedTabInfo[] { return [tab, ...tab.subtabs.flatMap(flat)]; }).find(tab => tab.id === id)?.name ?? RESTORED_TAB_NAME;
    const renew = (block: Block): Block => ({ ...block, id: this.take(), ...(block.children ? { children: block.children.map(renew) } : {}) });
    const blocks = committed(doc).blocks.map(renew);
    const tabId = this.store.addTab(name, blocks.length ? blocks : [this.emptyParagraph()]);
    this.changedProject = true;
    return { minted: tabId, body: this.store.tab(tabId).node, name };
  }

  /** The open comment threads on a tab (in the artifact's comments.json, beside the doc's folder). */
  private threadsOn(tabId: string): string[] {
    const threads = new CommentStore(path.dirname(this.store.root)).threads();
    return threads
      .filter(thread => {
        try {
          const anchor = JSON.parse(thread.anchor) as unknown;
          return isRecord(anchor) && anchor.tab === tabId;
        } catch {
          return false;
        }
      })
      .map(thread => thread.id);
  }

  deleteFile(tabId: string, payload: Json = {}): Json {
    // The agent is told first when comments hang on the tab: they lose their place until it is restored.
    if (this.guards && payload.allowDetach !== true) {
      const threads = this.threadsOn(tabId);
      if (threads.length)
        throw new CallRefusal(
          'anchors_affected',
          `${threads.length} open comment thread${threads.length === 1 ? '' : 's'} hang${threads.length === 1 ? 's' : ''} on this tab and would be detached; send payload {allowDetach: true} to delete it anyway (a restore of the tab reattaches them)`,
          { threads },
        );
    }
    try {
      this.store.deleteTab(tabId, { id: this.user.id, name: this.user.name, ...(this.writer.by === 'agent' ? { agent: true as const } : {}) });
    } catch (error) {
      if (error instanceof StoreError && error.code === 'LAST_TAB') throw new CallRefusal('last_tab', 'a doc keeps at least one tab; replace its contents instead');
      throw error;
    }
    this.changedProject = true;
    return { retired: [tabId] };
  }

  updateNode(node: string, payload: Json): Json {
    const ops = Array.isArray(payload.ops) ? payload.ops : null;
    if (!ops || !ops.length) throw new CallRefusal('bad_request', 'payload.ops is the list of ops', {}, 400);
    if (ops.some(op => isRecord(op) && op.op === 'restore')) return this.restore(this.bodyTab(node), ops, payload.ifRev);
    const decides = ops.findIndex(op => isRecord(op) && op.op === 'decide');
    if (decides >= 0 && (ops.length !== 1 || (payload.suggest !== undefined && payload.suggest !== false)))
      throw new CallRefusal('decide_alone', 'decide is the only op in its update, and not a suggestion', { op: decides }, 400);
    if (payload.suggest !== undefined && payload.suggest !== false) return this.suggest(this.bodyTab(node), ops, payload);
    return this.write(this.bodyTab(node), ops, payload.ifRev);
  }

  /**
   * `"suggest": true` beside the ops: the update is proposed, one suggestion for the person to accept or reject, not made.
   * `"suggest": "<id>"` adds to one of this agent's own still open. The ack names it: `suggestId`, and its `members`.
   */
  private suggest(tabId: string, ops: unknown[], payload: Json): Json {
    for (const key of ['ifHash', 'force'])
      if (payload[key] !== undefined) throw new CallRefusal('bad_request', `a suggestion takes no ${key}; ifRev is its only guard`, {}, 400);
    const doc = this.store.doc(tabId);
    const open = proposalIds(doc.blocks);
    let id: string;
    if (payload.suggest === true) {
      do id = `sg_${randomBytes(6).toString('hex')}`;
      while (open.includes(id));
    } else if (typeof payload.suggest === 'string' && SUGGEST_ID.test(payload.suggest)) {
      id = payload.suggest;
      if (!open.includes(id)) return { rev: doc.rev, session: this.session.sess, noop: true, notices: [{ code: 'nothing_open', suggestId: id }] };
      const info = doc.suggestions?.[id];
      if (info?.via !== 'agent' || info.by !== this.user.id)
        throw new CallRefusal('not_yours', `${id} is not a suggestion this agent made; make a new one with "suggest": true`, { suggestId: id });
    } else throw new CallRefusal('bad_request', '"suggest" is true (a new suggestion) or the id of one of your own still open (to add to it)', {}, 400);
    const ack = this.write(tabId, ops, payload.ifRev, { id, info: { by: this.user.id, at: new Date().toISOString(), via: 'agent' } });
    const after = this.store.doc(tabId);
    return proposalIds(after.blocks).includes(id) ? { ...ack, suggestId: id, members: memberCount(after.blocks, id) } : ack;
  }

  /** Applies ops to a tab as an agent write; the ack shows what each op wrote. */
  write(tabId: string, ops: unknown[], ifRev: unknown, suggest?: { id: string; info: SuggestionInfo }): Json {
    const doc = this.store.doc(tabId);
    const keys: Record<string, string> = {};
    let result;
    try {
      result = applyOps(doc, ops, this.session, {
        guards: this.guards,
        ...(ifRev !== undefined ? { ifRev: Number(ifRev) } : {}),
        markdown: { me: { id: this.user.id, name: this.user.name }, keys },
        ...(suggest ? { suggest } : {}),
      });
    } catch (error) {
      if (error instanceof Refusal) throw new CallRefusal(error.code, error.message, { op: error.opIndex ?? 0, ...error.extra });
      if (error instanceof MarkdownError) throw new CallRefusal(error.code, error.message);
      throw error;
    }
    if (result.changed) {
      this.store.putDoc(tabId, result.doc, this.writer);
      this.changedTabs.add(tabId);
    }
    const decided = result.results.find(op => op.decided)?.decided;
    return {
      rev: result.doc.rev,
      session: this.session.sess,
      xml: result.results.map((op, index) => writtenXml(result.doc, op.minted, index)).join('\n'),
      ...(Object.keys(keys).length ? { keys } : {}),
      ...(result.notices.length ? { notices: result.notices } : {}),
      ...(decided ? { decided } : {}),
      ...(result.changed ? {} : { noop: true }),
    };
  }
}

// ---- calls -------------------------------------------------------------------------------------------------------

const refusalBody = (error: CallRefusal, at?: number): Json => ({
  ok: false,
  code: error.code,
  message: error.message,
  ...(at !== undefined ? { member: at } : {}),
  ...(Object.keys(error.data).length ? { data: error.data } : {}),
});

function asRefusal(error: unknown): CallRefusal {
  if (error instanceof CallRefusal) return error;
  if (error instanceof StoreError) return new CallRefusal(error.code.toLowerCase(), error.message, { ...error.data }, error.code === 'NO_TAB' ? 404 : 409);
  throw error;
}

/**
 * Members in order, inside one transaction; the first refusal puts everything back. `indices` gives each member's
 * place in the call as sent, for the refusal's `member`, when these are only some of its members.
 */
function runMembers(store: DocStore, runner: Runner, members: unknown[], indices?: number[]): { acks: Json[] } {
  const acks: Json[] = [];
  store.begin();
  let index = 0;
  try {
    for (; index < members.length; index++) acks.push(runner.member(members[index]));
    store.commit();
  } catch (error) {
    store.rollback();
    const refusal = asRefusal(error);
    refusal.data = { ...refusal.data, member: indices?.[index] ?? index };
    throw refusal;
  }
  return { acks };
}

/**
 * A call on an existing doc: `{tool: 'read' | 'update' | 'create' | 'delete' | 'batch', …its arguments}`.
 * `session` writes the ids (the CLI's own session).
 */
export function runCall(store: DocStore, call: unknown, user: DocPerson): CallOutcome {
  const runner = new Runner(store, user, store.cliSession());
  runner.lids.set('p', store.id);
  try {
    if (!isRecord(call)) throw new CallRefusal('bad_call', 'a call is a JSON object', {}, 400);
    const tool = call.tool;
    let body: Json;
    switch (tool) {
      case 'read': {
        const ref = isRecord(call.ref) ? call.ref : { object: 'project' };
        const { acks } = runMembers(store, runner, [{ verb: 'read', ref, payload: call.payload }]);
        body = { ok: true, ...(ref.object === 'node' ? acks[0] : acks[0]!.value as Json) };
        break;
      }
      case 'update':
      case 'delete': {
        const ref = isRecord(call.ref) ? call.ref : null;
        if (!ref) throw new CallRefusal('bad_call', `${tool} needs ref: {object, id}`, {}, 400);
        const { acks } = runMembers(store, runner, [{ verb: tool, ref, payload: call.payload ?? {}, engine: call.engine }]);
        body = { ok: true, ...acks[0] };
        break;
      }
      case 'create': {
        if (isRecord(call.container) && isRecord(call.container.create)) throw new CallRefusal('exists', `${store.root} already holds a doc`, { id: store.id });
        const { acks } = runMembers(store, runner, [{ verb: 'create', object: call.object, engine: call.engine, payload: call.payload ?? {}, ...(call.$lid ? { $lid: call.$lid } : {}) }]);
        body = { ok: true, ...acks[0] };
        break;
      }
      case 'batch': {
        if (isRecord(call.container) && isRecord(call.container.create)) throw new CallRefusal('exists', `${store.root} already holds a doc`, { id: store.id });
        const members = Array.isArray(call.batch) ? call.batch : null;
        if (!members) throw new CallRefusal('bad_call', 'batch needs batch: [members]', {}, 400);
        const { acks } = runMembers(store, runner, members);
        body = { ok: true, ...(runner.lids.size > 1 ? { lids: Object.fromEntries([...runner.lids].filter(([alias]) => alias !== 'p')) } : {}), acks };
        break;
      }
      default:
        throw new CallRefusal('bad_call', `unknown tool ${JSON.stringify(tool)}: read, update, create, delete or batch`, {}, 400);
    }
    store.saveSessions();
    return { status: 200, body, changes: runner.changes };
  } catch (error) {
    const refusal = asRefusal(error);
    const { member, ...data } = refusal.data;
    refusal.data = data;
    return { status: refusal.status, body: refusalBody(refusal, typeof member === 'number' && toolOf(call) === 'batch' ? member : undefined) };
  }
}

const toolOf = (call: unknown) => (isRecord(call) ? call.tool : undefined);

/** A doc update that only locks or unlocks it: every patch names `["locked"]`. */
export function isLockPatch(payload: Json): boolean {
  return payload.kind === 'patch' && Array.isArray(payload.patch) && payload.patch.length > 0 && payload.patch.every(raw => isRecord(raw) && Array.isArray(raw.path) && raw.path.length === 1 && raw.path[0] === 'locked');
}

/** A dropdown list from a call: `{name, options: [{name, order?, disabled?, color?} | "name", …]}`, up to 1000 options (as many as the page reads). */
function enumDef(value: Json): EnumDef {
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
  const options = Array.isArray(value.options) ? value.options : [];
  if (!name || !options.length) throw new CallRefusal('bad_enum', 'an enum needs name and options: [{name}, …]', {}, 400);
  if (options.length > 1000) throw new CallRefusal('bad_enum', 'a dropdown list holds at most 1000 options', {}, 400);
  return {
    name,
    options: options.map((option, index) => {
      const optionName = isRecord(option) ? option.name : option;
      if (typeof optionName !== 'string' || !optionName.trim()) throw new CallRefusal('bad_enum', `option ${index} has no name`, {}, 400);
      const order = isRecord(option) && typeof option.order === 'number' && Number.isFinite(option.order) ? option.order : index;
      const color = isRecord(option) && typeof option.color === 'string' && option.color && option.color.length <= 24 ? option.color : undefined;
      return { name: optionName.trim().slice(0, 120), order, ...(isRecord(option) && option.disabled === true ? { disabled: true } : {}), ...(color ? { color } : {}) };
    }),
  };
}

/** A page's call on tabs, dropdown lists or the doc (not its prose: the doc host writes that itself). */
export function runPageMember(store: DocStore, member: Json, user: DocPerson, session: Session, options: { owner?: boolean } = {}): CallOutcome {
  const runner = new Runner(store, user, session, false, options.owner === true);
  runner.lids.set('p', store.id);
  try {
    const { acks } = runMembers(store, runner, [member]);
    store.saveSessions();
    return { status: 200, body: { verdict: 'allow', diff: [], ...acks[0] }, changes: runner.changes };
  } catch (error) {
    const refusal = asRefusal(error);
    return { status: refusal.status, body: { verdict: 'deny', reason: refusal.code, detail: refusal.message, ...(Object.keys(refusal.data).length ? { data: refusal.data } : {}) } };
  }
}

/**
 * The page's own batch, `{batch: [members]}`: a new tab is a file, its body node, the file pointing at that node and
 * the doc's tab entry, with `$lid` aliases between them. One transaction; each ack carries its verdict.
 */
export function runPageBatch(store: DocStore, members: unknown[], user: DocPerson, session: Session, options: { owner?: boolean } = {}): CallOutcome {
  const runner = new Runner(store, user, session, false, options.owner === true);
  runner.lids.set('p', store.id);
  try {
    const { acks } = runMembers(store, runner, members);
    store.saveSessions();
    return { status: 200, body: { verdict: 'allow', diff: [], acks: acks.map(ack => ({ verdict: 'allow', diff: [], ...ack })) }, changes: runner.changes };
  } catch (error) {
    const refusal = asRefusal(error);
    const { member, ...data } = refusal.data;
    return {
      status: refusal.status,
      body: { verdict: 'deny', reason: refusal.code, detail: refusal.message, ...(typeof member === 'number' ? { index: member } : {}), ...(Object.keys(data).length ? { data } : {}) },
    };
  }
}

/** What a birth asks for: the doc's name, its first tab's markdown and chips, and the members run with it. */
interface BirthRequest {
  name: string;
  markdown: string;
  chips: Chips;
  members: unknown[];
}

function birthRequest(call: unknown): BirthRequest | CallOutcome {
  if (!isRecord(call)) return { status: 400, body: { ok: false, code: 'bad_call', message: 'a birth is a JSON object' } };
  const create = isRecord(call.container) && isRecord(call.container.create) ? call.container.create : call;
  const name = typeof create.name === 'string' ? create.name.trim() : '';
  if (!name) return { status: 400, body: { ok: false, code: 'bad_name', message: 'the doc needs a name: its title as a reader would say it' } };
  const doc = isRecord(create.doc) ? create.doc : {};
  return {
    name,
    markdown: typeof doc.markdown === 'string' ? doc.markdown : '',
    chips: isRecord(doc.blocks) ? (doc.blocks as Chips) : {},
    members: Array.isArray(call.batch) ? call.batch : [],
  };
}

/**
 * The birth of a doc in `root` (the artifact's `doc/` folder): `{name, doc: {markdown, blocks?}, batch?: [members]}`
 * (or `{container: {kind: 'project', create: {name, doc}}, batch}`). `$lid:p`, `$lid:f` and `$lid:n` name the doc, its
 * first tab and that tab's body; enum and file (tab) members run before the markdown is read, so its dropdown chips
 * and tab links can name them.
 */
export function birth(root: string, call: unknown, user: DocPerson): CallOutcome {
  const request = birthRequest(call);
  if ('status' in request) return request;
  let store: DocStore;
  try {
    store = DocStore.create(root, request.name, (_store, session) => [{ name: FIRST_TAB_NAME, blocks: [newBlock('paragraph', `${session.sess}.${session.next++}`)] }]);
  } catch (error) {
    if (error instanceof StoreError) return { status: 409, body: { ok: false, code: error.code.toLowerCase(), message: error.message } };
    throw error;
  }
  const outcome = fillBirth(store, request, user);
  // Nothing of a refused birth stays: the folder held no doc before.
  if (outcome.body.ok !== true) removeDoc(root);
  return outcome;
}

/**
 * True for a doc nobody has written yet: one tab holding one empty paragraph, no dropdown lists, no suggestions (what
 * opening an empty folder starts).
 */
export function isBlankDoc(store: DocStore): boolean {
  const ids = store.tabIds();
  if (ids.length !== 1 || Object.keys(store.manifest.enums).length > 0) return false;
  const doc = store.doc(ids[0]!);
  const [only] = doc.blocks;
  return doc.blocks.length === 1 && only!.type === 'paragraph' && !only!.inline?.length && !only!.children?.length && Object.keys(doc.suggestions ?? {}).length === 0;
}

/** A birth on a blank doc (see {@link isBlankDoc}): it takes the birth's name and content in place. */
export function rebirth(store: DocStore, call: unknown, user: DocPerson): CallOutcome {
  const request = birthRequest(call);
  if ('status' in request) return request;
  if (!isBlankDoc(store)) return { status: 409, body: { ok: false, code: 'exists', message: `${store.root} already holds a doc`, data: { id: store.id } } };
  // A refused birth leaves the blank doc as it was, so a corrected one can follow.
  store.begin();
  const outcome = fillBirth(store, request, user);
  if (outcome.body.ok !== true) {
    store.rollback();
    return { status: outcome.status, body: outcome.body };
  }
  store.rename(request.name);
  store.commit();
  outcome.changes = { ...outcome.changes, project: true };
  return outcome;
}

function fillBirth(store: DocStore, { name, markdown, chips, members }: BirthRequest, user: DocPerson): CallOutcome {
  const root = store.root;
  const tabId = store.tabIds()[0]!;
  const runner = new Runner(store, user, store.cliSession());
  runner.lids.set('p', store.id);
  runner.lids.set('f', tabId);
  runner.lids.set('n', store.tab(tabId).node);
  const early = (member: unknown) => isRecord(member) && member.verb === 'create' && (member.object === 'enum' || member.object === 'file');
  const first = members.flatMap((member, index) => (early(member) ? [index] : []));
  const later = members.flatMap((member, index) => (early(member) ? [] : [index]));
  try {
    const firstAcks = runMembers(store, runner, first.map(index => members[index]), first).acks;
    store.begin();
    let written: Json;
    try {
      const placeholder = store.doc(tabId).blocks[0]!.id;
      const source = { as: 'markdown', blocks: runner.resolve(chips), from: { kind: 'inline', content: markdown.trim() ? markdown : '' } };
      written = markdown.trim() ? runner.write(tabId, [{ op: 'replace', target: { kind: 'blocks', ids: [placeholder] }, force: true, with: source }], undefined) : { rev: store.doc(tabId).rev, xml: "<doc op='0'/>" };
      store.commit();
    } catch (error) {
      store.rollback();
      throw error;
    }
    const laterAcks = runMembers(store, runner, later.map(index => members[index]), later).acks;
    // Acks in the order the members were sent.
    const acks: Json[] = [];
    first.forEach((index, k) => (acks[index] = firstAcks[k]!));
    later.forEach((index, k) => (acks[index] = laterAcks[k]!));
    store.saveSessions();
    const xml = String(written.xml ?? '').replace(/^<doc op='0'>|<\/doc>$/g, '');
    return {
      status: 200,
      body: {
        ok: true,
        created: { id: store.id, name, root },
        lids: Object.fromEntries(runner.lids),
        rev: written.rev,
        session: written.session ?? store.cliSession().sess,
        xml: `<doc rev='${String(written.rev)}'>${xml}</doc>`,
        ...(written.keys ? { keys: written.keys } : {}),
        ...(written.notices ? { notices: written.notices } : {}),
        ...(acks.length ? { acks } : {}),
      },
      changes: runner.changes,
    };
  } catch (error) {
    const refusal = asRefusal(error);
    const { member, ...data } = refusal.data;
    return { status: refusal.status, body: { ok: false, code: refusal.code, message: refusal.message, ...(typeof member === 'number' ? { member } : {}), ...(Object.keys(data).length ? { data } : {}) } };
  }
}

function removeDoc(root: string): void {
  for (const name of [MANIFEST_FILE, SESSIONS_FILE, TABS_DIR, HISTORY_DIR]) fs.rmSync(path.join(root, name), { recursive: true, force: true });
}

/**
 * The doc, or one tab, as a markdown file. A link inside the doc goes to its heading by the name GitHub gives it in the
 * file (`#risks`, the second `#risks-1`); one to a tab, to the heading the tab opens with. A link to anything else (a
 * paragraph, a tab not in the file) keeps its words without the link.
 */
export function exportMarkdown(store: DocStore, user: DocPerson, tabKey?: string): string {
  const runner = new Runner(store, user, { sess: 'export', next: 0 });
  const ids = tabKey ? [runner.tabId(tabKey)] : store.tabIds();
  const tabs = ids.map(id => ({ id, blocks: committed(store.doc(id)).blocks }));
  const context = runner.markdownContext();
  const names = new Map<string, string>();
  const unique = uniqueSlugs();
  for (const tab of tabs) {
    // A heading in a table cell is no heading once it is a pipe table's row.
    for (const { block, parent } of walk(tab.blocks)) if (block.type === 'paragraph' && block.attrs?.heading && parent?.type !== 'cell') names.set(block.id, unique(githubSlug(shownWords(block.inline ?? [], context))));
  }
  const anchors = new DocAnchors(tabs);
  let tables = 0;
  const body = tabs.map((tab, index) =>
    blocksToMarkdown(tab.blocks, {
      ...context,
      fragment: href => {
        const target = anchors.resolve(href, index);
        const block = target ? (target.block ?? tabs[target.tab]!.blocks[0]) : undefined;
        const name = block ? names.get(block.id) : undefined;
        return name ? `#${name}` : null;
      },
      // A table of contents as a list of links to the headings it lists, nested as they are.
      contents: () => {
        const lines = contentsOf(tab.blocks);
        if (!lines.length || ++tables > CONTENTS_PER_FILE) return null;
        return lines
          .map(({ heading, indent }) => {
            const words = shownWords(heading.block.inline ?? [], context).replace(/([\\`*_[\]<>|~])/g, '\\$1');
            const name = names.get(heading.block.id);
            return `${'  '.repeat(indent)}- ${name ? `[${words}](#${name})` : words}`;
          })
          .join('\n');
      },
    }),
  );
  if (tabs.length === 1) return `${body[0]}\n`;
  return `${tabs.map((tab, index) => `<!-- tab: ${store.tab(tab.id).name} -->\n\n${body[index]}`).join('\n\n')}\n`;
}
