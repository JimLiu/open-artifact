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

/** Runs a card's or the view's script with a fake parent frame; `emit` delivers a message as if from `source`. */
function boot(html: string) {
  const posted: Posted[] = [];
  const listeners: ((event: { source: unknown; origin: string; data: unknown }) => void)[] = [];
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
  const context = vm.createContext({
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
  });
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

describe('the ChatGPT card and the MCP App view', () => {
  it('the card takes an artifact from its host frame only', () => {
    const card = boot(CARD_HTML);
    card.emit({}, 'https://evil.example', result);
    assert.equal(card.elements.get('title')?.textContent ?? '', '');
    card.emit(card.parent, 'null', result);
    assert.equal(card.elements.get('title')?.textContent, 'Notes');
  });

  it('the view answers its host frame, whatever its origin, and no other window', () => {
    const view = boot(VIEW_HTML.replaceAll('__OPEN_ARTIFACT_VERSION__', JSON.stringify('0.0.0-test')));
    const before = view.posted.length;
    view.emit({}, 'https://evil.example', { jsonrpc: '2.0', id: 4, method: 'ping' });
    assert.equal(view.posted.length, before);
    // An MCP Apps host may frame the view from an opaque-origin sandbox.
    view.emit(view.parent, 'null', { jsonrpc: '2.0', id: 7, method: 'ping' });
    assert.equal(view.posted.length, before + 1);
    assert.equal(view.posted.at(-1)!.message.id, 7);
  });
});
