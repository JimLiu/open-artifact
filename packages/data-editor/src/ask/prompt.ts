/**
 * What "Ask the agent" on a selection sends (pure): the selection as data
 * (its kind, text, heading, where it is in the page's files, its tab, the
 * filters in play and the sources under it), the chip that names it, and
 * the request itself (the person's own words).
 */

import type { AgentRequest, SelectionSnapshot } from '@open-artifact/runtime';
import { agentResultMessage, selectionSnapshotOf } from '@open-artifact/editor-kit';
import { stripColumnNamespace, type ParameterValue, type Parameters, type SourceAddress } from '@open-artifact/data-core';
import type { RequestSelection } from '../drafts/request.ts';
import { getSelectionLabelText, type ElementSelection } from '../page/selection.ts';

export const ASK_TITLE = 'Ask the agent';
export const ASK_PLACEHOLDER = 'What should the agent do with this?';
export const ASK_FIELD_LABEL = 'Your request to the agent';
export const ASK_HINT = 'Enter to send · Shift+Enter for a new line';
export const ASK_SEND_LABEL = 'Send';
export const ASK_CANCEL_LABEL = 'Cancel';
export const ASK_CLOSE_LABEL = 'Close';
export const ASK_SENDING = 'Sending…';
export const ASK_SENT = 'Sent to the agent.';
export const NOT_LISTENING = 'The agent isn’t listening to this dashboard. Ask it to wait for requests here, then try again.';
export const PROMPT_COPIED = 'Prompt copied';

/**
 * What the box says when a request to a listening agent was not taken: how the host said it failed (as every editor's
 * toast says it), never {@link NOT_LISTENING}, which is only for no agent listening.
 */
export function sendFailedText(reason?: string): string {
  const message = agentResultMessage({ status: 'failed', ...(reason ? { reason } : {}) }, 'this dashboard');
  return message.description ? `${message.title}. ${message.description}` : message.title;
}

/** A filter in play: its name and value (null when it has none). */
export type ActiveFilter = readonly [name: string, value: ParameterValue | null];

export interface SelectionContext {
  filters: readonly ActiveFilter[];
  /** A source's title from its id ('' when unknown). */
  sourceTitle(id: string): string;
}

/** The chip a picked selection shows. */
export interface PickChip {
  about: 'pick';
  kind: string;
  name: string;
  tab: string;
  filters: ActiveFilter[];
  source: [title: string, address: SourceAddress] | null;
}

export interface SelectionPrompt {
  chip: PickChip;
  text: string;
}

const arraysEqual = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

/** The filters in play with their values, for a selection. */
export const describeActiveFilters = (names: readonly string[], parameters: Parameters): ActiveFilter[] => names.map((name) => [name, parameters[name] ?? null]);

/** One filter as the selection gives it: `name = value`. */
export function describeFilter([name, value]: ActiveFilter): string {
  return `${name} = ${value === null ? 'none' : Array.isArray(value) ? value.join(', ') : String(value)}`;
}

export function formatRowAddress(address: SourceAddress, describeRow: (row: number) => string = (row) => `row ${row}`): string {
  if (address.where !== undefined) return address.where.map((part) => `${stripColumnNamespace(part.column)} = ${part.value}`).join(', ');
  return address.row === undefined ? '' : describeRow(address.row);
}

export function formatSourceAddress(address: SourceAddress, describeRow?: (row: number) => string): string {
  return [address.field === undefined ? '' : stripColumnNamespace(address.field), formatRowAddress(address, describeRow)].filter((part) => part !== '').join(' · ');
}

const formatRangeRowEndpoint = (address: SourceAddress): string => (address.where === undefined ? String(address.row) : formatRowAddress(address));

interface CellGroup {
  at: SourceAddress;
  columns: string[];
}

/** Cells grouped by row, in order; null when a row comes back after another. */
function groupConsecutiveCells(addresses: readonly SourceAddress[]): CellGroup[] | null {
  const groups = new Map<string, CellGroup>();
  let last = '';
  for (const address of addresses) {
    const row = formatRowAddress(address);
    const group = groups.get(row);
    if (group !== undefined && row !== last) return null;
    const column = stripColumnNamespace(address.field ?? '');
    if (group === undefined) groups.set(row, { at: address, columns: [column] });
    else group.columns.push(column);
    last = row;
  }
  return [...groups.values()];
}

/** A run of cells over the same columns as one line: `columns a, b · rows 1 to 3 (3 rows, in the order shown)`. */
export function summarizeCellAddressRange(addresses: readonly SourceAddress[]): string | null {
  if (addresses.length < 2 || addresses.some((address) => address.field === undefined || formatRowAddress(address) === '')) return null;
  const groups = groupConsecutiveCells(addresses);
  const first = groups?.at(0);
  const last = groups?.at(-1);
  if (groups === null || first === undefined || last === undefined) return null;
  const columns = groups.reduce((widest, group) => (group.columns.length > widest.columns.length ? group : widest)).columns;
  if (
    !groups.slice(1, -1).every((group) => arraysEqual(group.columns, columns)) ||
    !arraysEqual(columns.slice(-first.columns.length), first.columns) ||
    !arraysEqual(columns.slice(0, last.columns.length), last.columns)
  )
    return null;
  const named = columns.length === 1 ? columns.join() : `columns ${columns.join(', ')}`;
  if (groups.length === 1) return `${named} · ${formatRowAddress(first.at)}`;
  const rows = `rows ${formatRangeRowEndpoint(first.at)} to ${formatRangeRowEndpoint(last.at)} (${groups.length} rows, in the order shown)`;
  const partial = [
    first.columns.length < columns.length ? `first row only ${first.columns.join(', ')}` : '',
    last.columns.length < columns.length ? `last row only ${last.columns.join(', ')}` : '',
  ];
  return [`${named} · ${rows}`, ...partial.filter((part) => part !== '')].join(', ');
}

/** The sources under a selection, one line each: `Title · cells (id)`. */
export function describeSelectionSources(selection: ElementSelection, context: SelectionContext): string[] {
  const addresses = selection.sources ?? (selection.source === null ? [] : [selection.source]);
  const bySource = new Map<string, Map<string, SourceAddress>>();
  for (const address of addresses.filter((candidate) => candidate.source !== '')) {
    const cells = bySource.get(address.source) ?? new Map<string, SourceAddress>();
    if (formatSourceAddress(address) !== '') cells.set(formatSourceAddress(address), address);
    bySource.set(address.source, cells);
  }
  return [...bySource].map(([id, cells]) => {
    const where = summarizeCellAddressRange([...cells.values()]) ?? [...cells.keys()].join('; ');
    return `${[context.sourceTitle(id), where].filter((part) => part !== '').join(' · ')} (${id})`;
  });
}

export function buildSelectionPrompt(selection: ElementSelection, context: SelectionContext): SelectionPrompt {
  const primary: PickChip['source'] = selection.source === null || selection.source.source === '' ? null : [context.sourceTitle(selection.source.source), selection.source];
  const lines = [
    ['kind', selection.kind],
    ['in', selection.within ?? ''],
    ['title', selection.title],
    ['under heading', selection.under],
    ['in the page’s files', selection.hook],
    ['tab', selection.tab],
    ['filters', context.filters.map(describeFilter).join(', ')],
    ['text', selection.text],
    ...describeSelectionSources(selection, context).map((line) => ['source', line]),
  ]
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}: ${value}`);
  return {
    chip: { about: 'pick', kind: selection.kind, name: getSelectionLabelText(selection), tab: selection.tab, filters: [...context.filters], source: primary },
    text: ['From the dashboard’s page:', ...lines].join('\n'),
  };
}

/** The chip in words: `Selected text · “Signups” · Q3 · region = EU · from Sales · revenue · row 3`. */
export function describePickChip(chip: PickChip): string {
  const source = chip.source === null ? '' : [chip.source[0], formatSourceAddress(chip.source[1])].filter((part) => part !== '').join(' · ');
  return [
    chip.kind,
    chip.name === '' ? '' : `“${chip.name}”`,
    chip.tab,
    ...chip.filters.map((filter) => (filter[1] === null ? `${filter[0]} = none` : describeFilter(filter))),
    source === '' ? '' : `from ${source}`,
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/** The selection a page request carries. */
export function toRequestSelection(prompt: SelectionPrompt): RequestSelection {
  return { label: describePickChip(prompt.chip), chip: { ...prompt.chip }, text: prompt.text };
}

/** The request sent once the person wrote what the agent should do: their words, with the selection as data. */
export function buildAskRequest(words: string, selection: RequestSelection): AgentRequest {
  const request = words.trim();
  const snapshot = pickSnapshot(selection);
  return {
    title: ASK_TITLE,
    text: request,
    context: { request, label: selection.label, selection: { ...selection } },
    // What a chat shows: the person's words, and the chip of the part they asked about (taken when they pressed Send).
    userText: request,
    ...(snapshot ? { selectionSnapshot: snapshot } : {}),
  };
}

/** The picked part of the dashboard as a request's `selectionSnapshot`: its chip in words, and what it shows. */
export function pickSnapshot(selection: RequestSelection): SelectionSnapshot | null {
  return selectionSnapshotOf({ kind: 'pick', label: selection.label || 'Part of the dashboard', count: 1, ...(selection.text ? { text: selection.text } : {}) });
}

/** What is copied when no agent listens: the request and the selection, to paste into a conversation with the agent. */
export function buildCopiedPrompt(selection: RequestSelection, words = ''): string {
  const request = words.trim();
  return [request === '' ? `About this part of the dashboard (${selection.label}):` : request, '', selection.text].join('\n');
}
