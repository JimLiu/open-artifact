import assert from 'node:assert/strict';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import { CARD_HTML } from '../src/chatgpt.ts';
import { VIEW_HTML } from '../src/mcp-app.ts';

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
  const frame = { name: 'frame' };
  const elements = new Map<string, Record<string, unknown>>();
  const element = (id: string) => {
    let node = elements.get(id);
    if (!node) {
      node = {
        id,
        hidden: false,
        textContent: '',
        value: '',
        disabled: false,
        onclick: null,
        contentWindow: id === 'page' ? frame : undefined,
        classList: { toggle() {} },
        style: {},
        select() {},
        focus() {},
      };
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
    navigator: {},
    document: {
      documentElement: { setAttribute() {} },
      body: { classList: { toggle() {} }, getBoundingClientRect: () => ({ height: 40 }) },
      getElementById: element,
      addEventListener() {},
    },
  };
  const context = vm.createContext(sandbox);
  Object.assign(context, { window: context, addEventListener: (type: string, fn: (typeof listeners)[number]['fn']) => listeners.push({ type, fn }) });
  vm.runInContext(scriptOf(html), context);
  const emit = (source: unknown, origin: string, data: unknown) => {
    for (const listener of listeners) if (listener.type === 'message') listener.fn({ source, origin, data });
  };
  return { posted, emit, parent, elements, frame };
}

describe('daemon card and view host origin', () => {
  it('keeps the ChatGPT card on the same parent-origin rule', () => {
    assert.match(CARD_HTML, /event\.source===window\.parent/);
    assert.match(CARD_HTML, /origin!=='null'/);
    assert.equal(CARD_HTML.includes("postMessage({"), false);
    const card = boot(CARD_HTML);
    assert.equal(card.posted.length, 1);
    assert.equal(card.posted[0]!.origin, '*');
    assert.equal(card.posted[0]!.message.method, 'ui/initialize');
    assert.equal(JSON.stringify(card.posted[0]!.message).toLowerCase().includes('https://'), false);
    card.emit({}, 'https://evil.example', { jsonrpc: '2.0', id: 1, result: {} });
    assert.equal(card.posted.length, 1);
    card.emit(card.parent, 'null', { jsonrpc: '2.0', id: 1, result: {} });
    assert.equal(card.posted.length, 1);
  });

  it('answers the view only after the parent origin is known', () => {
    const html = VIEW_HTML.replaceAll('__OPEN_ARTIFACT_VERSION__', JSON.stringify('0.0.0-test'));
    assert.match(html, /event\.source===window\.parent/);
    assert.match(html, /origin!=='null'/);
    assert.equal(html.includes("postMessage(m,'*')"), false);
    const view = boot(html);
    assert.equal(view.posted.length, 1);
    assert.equal(view.posted[0]!.origin, '*');
    assert.equal(view.posted[0]!.message.method, 'ui/initialize');
    assert.equal(JSON.stringify(view.posted[0]!.message).includes('open-artifact://'), false);

    view.emit(view.frame, 'https://evil.example', { openArtifact: 'shell_hello' });
    view.emit({}, 'https://evil.example', { jsonrpc: '2.0', id: 4, method: 'ping' });
    view.emit(view.parent, 'null', { jsonrpc: '2.0', id: 7, method: 'ping' });
    assert.equal(view.posted.length, 1);

    view.emit(view.parent, 'https://host.example', { jsonrpc: '2.0', id: 8, method: 'ping' });
    assert.equal(view.posted.length, 2);
    assert.equal(view.posted[1]!.origin, 'https://host.example');
    assert.equal(view.posted[1]!.message.id, 8);
  });
});
