import assert from 'node:assert/strict';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import { artifactCardHtml } from '../src/mcp.ts';

interface Posted {
  message: { id?: number; method?: string };
  origin: string;
}

function scriptOf(html: string): string {
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  assert.ok(start >= 0 && end > start);
  return html.slice(start + '<script>'.length, end);
}

/** Runs the card's script with a fake parent frame; `emit` delivers a message as if from `source`. */
function boot(html: string) {
  const posted: Posted[] = [];
  const listeners: ((event: { source: unknown; origin: string; data: unknown }) => void)[] = [];
  const elements = new Map<string, { textContent: string; disabled: boolean; onclick: (() => void) | null }>();
  const element = (id: string) => {
    let node = elements.get(id);
    if (!node) {
      node = { textContent: '', disabled: false, onclick: null };
      elements.set(id, node);
    }
    return node;
  };
  const parent = {
    postMessage(message: Posted['message'], origin: string) {
      posted.push({ message, origin });
    },
  };
  const context = vm.createContext({ JSON, Promise, URL, setTimeout: () => 0, clearTimeout: () => {}, parent, document: { getElementById: element } });
  Object.assign(context, {
    window: context,
    addEventListener: (type: string, fn: (typeof listeners)[number]) => {
      if (type === 'message') listeners.push(fn);
    },
  });
  vm.runInContext(scriptOf(html), context);
  const emit = (source: unknown, origin: string, data: unknown) => {
    for (const listener of listeners) listener({ source, origin, data });
  };
  return { posted, emit, parent, elements };
}

const ARTIFACT = { url: 'open-artifact://artifact/art_1', title: 'Notes', view_url: 'http://127.0.0.1:7000/a/art_1', type: 'docs' };
const result = { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: ARTIFACT } };

describe('the artifact card', () => {
  it('takes an artifact from its host frame only', () => {
    const card = boot(artifactCardHtml('Codex'));
    assert.equal(card.posted[0]!.message.method, 'ui/initialize');

    card.emit({}, 'https://evil.example', result);
    card.emit(null, 'https://evil.example', result);
    assert.equal(card.elements.get('title')?.textContent ?? '', '');
    card.elements.get('send')?.onclick?.();
    assert.equal(card.posted.length, 1, 'nothing sent for an artifact another window named');

    // A host may sit in an opaque-origin sandbox: its messages still count.
    card.emit(card.parent, 'null', result);
    assert.equal(card.elements.get('title')?.textContent, 'Notes');
    card.elements.get('send')?.onclick?.();
    const sent = card.posted.at(-1)!;
    assert.equal(sent.message.method, 'ui/message');
    assert.match(JSON.stringify(sent.message), /open-artifact:\/\/artifact\/art_1/);
  });

  it('does not let another window answer its requests', async () => {
    const card = boot(artifactCardHtml('Codex'));
    card.emit({}, 'https://evil.example', { jsonrpc: '2.0', id: 1, result: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(card.posted.length, 1);
    card.emit(card.parent, 'https://host.example', { jsonrpc: '2.0', id: 1, result: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(card.posted.at(-1)!.message.method, 'ui/notifications/initialized');
  });
});
