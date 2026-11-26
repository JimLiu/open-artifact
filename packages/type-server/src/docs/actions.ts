/**
 * The agent's calls on a doc (`create`, `read`, `update`, `delete`, `batch`, `export`, `import`): on the open doc's
 * host when the server has it open, so its pages hear of a write at once, else on the folder.
 */
import fs from 'node:fs';
import { duplicateDoc } from './duplicate.ts';
import path from 'node:path';
import type { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import { type CallOutcome, type DocPerson, birth, exportMarkdown, rebirth, runCall } from './calls.ts';
import type { DocHost } from './host.ts';
import { DocStore, StoreError, docDirOf, isDocFolder } from './store.ts';
import { DocTransferError, IMPORT_MAX_BYTES, exportDocFile, importIntoFolder, isExportFormat, isPaper, type ExportFormat } from './transfer.ts';

type Json = Record<string, unknown>;

/** Where exports go when the call names no file: `<artifact>/exports/`. */
export const EXPORTS_DIR = 'exports';

export const DOC_ACTIONS = [
  {
    name: 'duplicate',
    title: 'Copy the document into an independent folder beside it',
    effect: 'write',
    schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'create',
    title: 'Start the doc: {call: {name, doc: {markdown, blocks?}, batch?}} (on a new folder, or the blank doc opening one made)',
    effect: 'write',
    schema: { type: 'object', properties: { call: { type: 'object', description: 'The birth: {name, doc: {markdown, blocks?}, batch?: [members]}.' } }, required: ['call'] },
  },
  {
    name: 'read',
    title: 'Read the doc (its tabs) or a tab: {call: {ref?: {object: "node", id: <tab>}, payload?: {kind: outline|view|search|markdown|history|suggestions}}}',
    effect: 'read',
    schema: { type: 'object', properties: { call: { type: 'object', description: '{ref?, payload?}; without ref, the doc and its tabs.' } } },
  },
  {
    name: 'update',
    title: 'Ops on a tab body, or a change to a tab, a dropdown list or the doc: {call: {ref, payload}}',
    effect: 'write',
    schema: { type: 'object', properties: { call: { type: 'object', description: '{ref: {object, id}, payload: {ops, ifRev?} | …}.' } }, required: ['call'] },
  },
  {
    name: 'delete',
    title: 'Remove a tab: {call: {ref: {object: "file", id}}}',
    effect: 'write',
    schema: { type: 'object', properties: { call: { type: 'object', description: '{ref: {object: "file", id}}.' } }, required: ['call'] },
  },
  {
    name: 'batch',
    title: 'Several members in one transaction: {call: {batch: [members]}} (tabs, dropdown lists, ops)',
    effect: 'write',
    schema: { type: 'object', properties: { call: { type: 'object', description: '{batch: [{verb, object | ref, payload, $lid?}, …]}.' } }, required: ['call'] },
  },
  {
    name: 'export',
    title: 'The doc as markdown, Word, PDF or a page to print: {format?, tab?, paper?, out?}; returns the file written',
    effect: 'read',
    schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['markdown', 'docx', 'pdf', 'html'] },
        tab: { type: 'string', description: 'One tab (its id or name); default every tab.' },
        paper: { type: 'string', enum: ['a4', 'letter'] },
        out: { type: 'string', description: 'Absolute path of the file; default <artifact>/exports/<name>. Markdown without out is answered inline.' },
      },
    },
  },
  {
    name: 'import',
    title: 'A .md, .docx or .pdf as a new tab, or as the doc when the folder holds none: {file, name?}',
    effect: 'write',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path of the file.' },
        name: { type: 'string', description: "The new tab's name (or the new doc's)." },
      },
      required: ['file'],
    },
  },
] as const;

export type DocActionName = (typeof DOC_ACTIONS)[number]['name'];

export const isDocAction = (name: string): name is DocActionName => DOC_ACTIONS.some((action) => action.name === name);

export interface DocActionContext {
  /** The artifact folder (the doc is in its `doc/`). */
  root: string;
  owner: DocPerson;
  /** The open doc, when the server has it open. */
  host?: DocHost;
  workspace?: WorkspaceDirectory | undefined;
}

export interface DocActionAnswer {
  status: number;
  body: Json;
}

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const refused = (status: number, code: string, message: string): DocActionAnswer => ({ status, body: { ok: false, code, message } });

const answerOf = (outcome: CallOutcome): DocActionAnswer => ({ status: outcome.status, body: outcome.body as Json });

function openStore(root: string): DocStore | DocActionAnswer {
  try {
    return DocStore.open(docDirOf(root));
  } catch (error) {
    if (error instanceof StoreError && error.code === 'NOT_A_DOC') return refused(404, 'not_a_doc', `${root} holds no doc yet: start it with create.`);
    throw error;
  }
}

/** Runs one of the agent's calls on the doc in `root` and answers its JSON (`ok: false` with a code when refused). */
export async function runDocAction(name: DocActionName, args: Json, context: DocActionContext): Promise<DocActionAnswer> {
  const { root, owner, host } = context;
  switch (name) {
    case 'duplicate': {
      if (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 256) return refused(400, 'bad_name', 'Enter a document name of up to 256 characters.');
      const store = host?.store ?? openStore(root);
      return store instanceof DocStore ? { status: 201, body: duplicateDoc(store, args.name.trim(), context.workspace) } : store;
    }
    case 'create': {
      const call = args.call;
      if (host) return answerOf(host.agentBirth(call));
      const dir = docDirOf(root);
      if (!isDocFolder(dir)) return answerOf(birth(dir, call, owner));
      const store = openStore(root);
      return store instanceof DocStore ? answerOf(rebirth(store, call, owner)) : store;
    }
    case 'read':
    case 'update':
    case 'delete':
    case 'batch': {
      const given = isRecord(args.call) ? args.call : {};
      const call = { ...given, tool: name };
      if (host) return answerOf(host.agentCall(call));
      const store = openStore(root);
      return store instanceof DocStore ? answerOf(runCall(store, call, owner)) : store;
    }
    case 'export':
      return exportAction(args, context);
    case 'import':
      return importAction(args, context);
  }
}

async function exportAction(args: Json, { root, owner, host, workspace }: DocActionContext): Promise<DocActionAnswer> {
  const given = typeof args.format === 'string' ? (args.format === 'md' ? 'markdown' : args.format) : 'markdown';
  if (!isExportFormat(given)) return refused(400, 'bad_format', `No export as ${given}: markdown, docx, pdf or html.`);
  const format: ExportFormat = given;
  if (args.paper !== undefined && !isPaper(args.paper)) return refused(400, 'bad_paper', `No paper called ${String(args.paper)}: a4 or letter.`);
  const tab = typeof args.tab === 'string' && args.tab ? args.tab : undefined;
  const requested = typeof args.out === 'string' && args.out ? path.resolve(args.out) : undefined;
  const out = requested === undefined ? undefined : workspace?.resolve(requested) ?? requested;
  const store = host?.store ?? openStore(root);
  if (!(store instanceof DocStore)) return store;
  if (format === 'markdown') {
    let markdown: string;
    try {
      markdown = exportMarkdown(store, owner, tab);
    } catch (error) {
      return refusalOf(error);
    }
    if (!out) return { status: 200, body: { ok: true, format, markdown } };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, markdown);
    return { status: 200, body: { ok: true, out, format, bytes: Buffer.byteLength(markdown) } };
  }
  try {
    const file = await exportDocFile(store, owner, { format, ...(tab ? { tab } : {}), ...(isPaper(args.paper) ? { paper: args.paper } : {}) });
    const requested = out ?? path.join(root, EXPORTS_DIR, file.name);
    const into = workspace?.resolve(requested) ?? requested;
    fs.mkdirSync(path.dirname(into), { recursive: true });
    fs.writeFileSync(into, file.bytes);
    return {
      status: 200,
      body: { ok: true, out: into, format, bytes: file.bytes.length, ...(file.pages ? { pages: file.pages } : {}), ...(file.notes.length ? { notes: file.notes } : {}) },
    };
  } catch (error) {
    return refusalOf(error);
  }
}

async function importAction(args: Json, { root, owner, host, workspace }: DocActionContext): Promise<DocActionAnswer> {
  if (typeof args.file !== 'string' || !path.isAbsolute(args.file)) return refused(400, 'missing_file', 'file is the absolute path of a .md, .docx or .pdf.');
  const file = workspace?.resolve(args.file) ?? args.file;
  let bytes: Uint8Array;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return refused(404, 'file_not_found', `No such file: ${args.file}`);
  }
  if (bytes.length > IMPORT_MAX_BYTES) return refused(413, 'too_large', `${args.file} is over ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`);
  const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined;
  try {
    const body = await importIntoFolder({ root, owner, ...(host ? { host } : {}) }, { file, bytes, ...(name ? { name } : {}) });
    return { status: 200, body: body as unknown as Json };
  } catch (error) {
    return refusalOf(error);
  }
}

function refusalOf(error: unknown): DocActionAnswer {
  if (error instanceof DocTransferError) return refused(error.status, error.code, error.message);
  if (error instanceof StoreError) return refused(404, error.code.toLowerCase(), error.message);
  throw error;
}
