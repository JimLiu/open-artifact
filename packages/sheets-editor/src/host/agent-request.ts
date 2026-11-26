/** What the page puts in the chat with the agent, as the request the agent capability sends (pure). */

import type { AgentRequest, SelectionSnapshot } from '@open-artifact/runtime';
import { selectionSnapshotOf } from '@open-artifact/editor-kit';
import { isNonNullObject } from '../utils/objects.ts';

export const MAX_REQUEST_TEXT = 10_000;
export const MAX_REQUEST_LABEL = 1_000;
export const MAX_REQUEST_CONTEXT = 4_000;

export function agentRequestOf(payload: unknown): AgentRequest | null {
  if (!isNonNullObject(payload)) return null;
  const { label, request, ...rest } = payload as Record<string, unknown>;
  const asked = typeof request === 'string' ? request.trim() : '';
  const pressed = rest.pressed;
  const text =
    asked ||
    (typeof pressed === 'string' && pressed.trim() !== ''
      ? pressed.trim()
      : rest.isSheetBlank === true
        ? 'Fill this blank sheet.'
        : typeof rest.chartId === 'string'
          ? 'About this chart.'
          : typeof rest.ruleNumber === 'number'
            ? 'About this conditional formatting rule.'
            : typeof rest.range === 'string'
              ? 'About these cells.'
              : '');
  if (text === '') return null;
  let context: Record<string, unknown> = { ...rest };
  let contextText = JSON.stringify(context);
  while (contextText.length > MAX_REQUEST_CONTEXT && Array.isArray(context.errors) && context.errors.length > 0) {
    const leftOut = typeof context.errorsLeftOut === 'number' ? context.errorsLeftOut : 0;
    context = { ...context, errors: context.errors.slice(0, -1), errorsLeftOut: leftOut + 1 };
    contextText = JSON.stringify(context);
  }
  const title = typeof label === 'string' ? label.trim().slice(0, MAX_REQUEST_LABEL) : '';
  const snapshot = sheetsSelectionSnapshot(rest, title);
  return {
    text: text.slice(0, MAX_REQUEST_TEXT),
    ...(title !== '' && { title }),
    ...(contextText.length <= MAX_REQUEST_CONTEXT && contextText !== '{}' && { context }),
    // What a chat shows: the words the person typed (never a pressed or canned sentence), and what they asked about.
    ...(asked !== '' && { userText: asked.slice(0, MAX_REQUEST_TEXT) }),
    ...(snapshot !== null && { selectionSnapshot: snapshot }),
  };
}

/**
 * What a request to the agent is about, as its `selectionSnapshot` (taken as the page sends it): the chart, the
 * conditional formatting rule, the blank sheet, or the cells (labelled by their range); `null` for none of them.
 */
export function sheetsSelectionSnapshot(payload: Record<string, unknown>, label: string): SelectionSnapshot | null {
  const sheet = typeof payload.sheetNumber === 'number' ? `Sheet ${payload.sheetNumber}` : undefined;
  const at = sheet ? { where: sheet } : {};
  if (typeof payload.chartId === 'string') return selectionSnapshotOf({ kind: 'chart', count: 1, label: label || 'A chart', items: [{ id: payload.chartId, kind: 'chart' }], ...at });
  if (typeof payload.ruleNumber === 'number') return selectionSnapshotOf({ kind: 'rule', count: 1, label: label || `Conditional formatting rule ${payload.ruleNumber}`, ...at });
  if (payload.isSheetBlank === true) return selectionSnapshotOf({ kind: 'sheet', count: 1, label: label || sheet || 'A blank sheet' });
  if (typeof payload.range === 'string' && payload.range !== '') return selectionSnapshotOf({ kind: 'cells', count: 1, label: payload.range, items: [{ id: payload.range, kind: 'range' }], ...at });
  return null;
}
