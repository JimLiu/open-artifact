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

function boot(html: string) {
  const posted: Posted[] = [];
  const listeners: { type: string; fn: (event: { source: unknown; origin: string; data: unknown }) => void }[] = [];
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
  const sandbox = {
    JSON,
    Promise,
    URL,
    setTimeout: () => 0,
    clearTimeout: () => {},
    parent,
    document: { getElementById: element },
  };
  const context = vm.createContext(sandbox);
  Object.assign(context, { window: context, addEventListener: (type: string, fn: (typeof listeners)[number]['fn']) => listeners.push({ type, fn }) });
  vm.runInContext(scriptOf(html), context);
  const emit = (source: unknown, origin: string, data: unknown) => {
    for (const listener of listeners) if (listener.type === 'message') listener.fn({ source, origin, data });
  };
  return { posted, emit, parent, elements };
}

const ARTIFACT = { url: 'open-artifact://artifact/art_1', title: 'Notes', view_url: 'https://127.0.0.1/a/art_1', type: 'docs' };

describe('artifact card host origin', () => {
  const html = artifactCardHtml('ChatGPT');

  it('talks only to the parent window and locks a real origin', async () => {
    assert.match(html, /event\.source===window\.parent/);
    assert.match(html, /origin!=='null'/);
    assert.equal(html.includes("postMessage({"), false);
    assert.equal(html.includes("postMessage(m,'*')"), false);

    const card = boot(html);
    assert.equal(card.posted.length, 1);
    assert.equal(card.posted[0]!.origin, '*');
    assert.equal(card.posted[0]!.message.method, 'ui/initialize');
    assert.equal(card.posted[0]!.message.id, 1);
    const body = JSON.stringify(card.posted[0]!.message).toLowerCase();
    assert.equal(body.includes('https://'), false);
    assert.equal(body.includes('http://'), false);
    assert.equal(body.includes('open-artifact://'), false);

    card.emit({}, 'https://evil.example', { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: ARTIFACT } });
    assert.equal(card.elements.get('title')?.textContent ?? '', '');

    card.emit(card.parent, 'null', { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: ARTIFACT } });
    assert.equal(card.elements.get('title')?.textContent, 'Notes');
    card.elements.get('send')?.onclick?.();
    assert.equal(card.posted.length, 1);

    card.emit(card.parent, 'https://host.example', { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed' });
    card.emit(card.parent, 'https://other.example', { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed' });
    card.elements.get('send')?.onclick?.();
    const sent = card.posted.at(-1)!;
    assert.equal(sent.origin, 'https://host.example');
    assert.equal(sent.message.method, 'ui/message');
    assert.match(JSON.stringify(sent.message), /open-artifact:\/\/artifact\/art_1/);
    assert.equal(card.posted.some((item) => item.origin === '*' && item.message.method !== 'ui/initialize'), false);
  });

  it('sends the initialized notice to the origin learned from the parent', async () => {
    const card = boot(html);
    card.emit(card.parent, 'https://host.example', { jsonrpc: '2.0', id: 1, result: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(card.posted.length, 2);
    assert.equal(card.posted[1]!.origin, 'https://host.example');
    assert.equal(card.posted[1]!.message.method, 'ui/notifications/initialized');
  });
});
