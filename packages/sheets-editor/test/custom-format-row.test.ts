import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import type { Root } from 'react-dom/client';

/**
 * Node runs these tests by stripping types, which leaves JSX in place. The list
 * lives in a .tsx module, so transform the editor sources as they are imported.
 */
registerHooks({
  load(url, context, nextLoad) {
    if (!isEditorSource(url)) return nextLoad(url, context);
    const source = readFileSync(new URL(url), 'utf8');
    const transformed = esbuild.transformSync(source, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      jsx: 'automatic',
      sourcefile: url,
      target: 'es2022',
    });
    return { format: 'module', source: transformed.code, shortCircuit: true };
  },
});

/** React's `act` flushes effects only after the test environment flag is set. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Load React before any stand-in window exists. If `document` is already there,
 * react-dom probes event support during its own startup and expects a real DOM.
 */
const react = await import('react');
const { createRoot } = await import('react-dom/client');

/** Enough of a document for `createRoot` to commit a hook and record capture listeners. */
class FieldInput {}
class FrameElement {}

interface CaptureListener {
  type: string;
  listener: (event: { timeStamp: number }) => void;
}

interface NativeKey {
  key: string;
  timeStamp: number;
  isComposing: boolean;
  keyCode: number;
  metaKey: boolean;
  ctrlKey: boolean;
}

interface FormatList {
  isLateEnterOfInputMethod?: (event: NativeKey) => boolean;
}

interface FormatRowModule {
  useCustomFormatList: (
    input: {
      entry: ReturnType<typeof writtenFormat>;
      isAgentOffered: boolean;
      told: {
        onTyped: () => void;
        onAgentAsked: () => void;
        onEscaped: () => void;
        onEntered: () => void;
        onActHeld: () => void;
        onTaken: () => void;
      };
    },
    takesTypedPattern: boolean,
  ) => FormatList;
  handleCustomFormatKey: (list: FormatList, event: object, canOffer: boolean) => boolean;
}

interface MountedList {
  root: Root;
  list: FormatList;
  listeners: CaptureListener[];
  acts: string[];
  press: (native: NativeKey) => boolean;
}

const formatRowUrl = new URL('../src/format/custom-format-row.tsx', import.meta.url);

function isEditorSource(url: string): boolean {
  return (
    (url.endsWith('.ts') || url.endsWith('.tsx')) &&
    (url.includes('/packages/sheets-editor/src/') || url.includes('/packages/ui/src/'))
  );
}

function writtenFormat() {
  return {
    pattern: '0.00',
    reading: { kind: 'numberFormat' as const, numberFormat: { pattern: '0.00' }, example: '1.00' },
    isRefusalTold: false,
    agent: { kind: 'wrote' as const, words: 'two decimals' },
    hold: null,
    hasHeldTextOfOthers: false,
    typedIn: 'list' as const,
    shownUnderPattern: new Map(),
  };
}

function enterKey(timeStamp: number, inputMethod: { isComposing?: boolean; keyCode?: number } = {}): NativeKey {
  return {
    key: 'Enter',
    timeStamp,
    isComposing: inputMethod.isComposing ?? false,
    keyCode: inputMethod.keyCode ?? 13,
    metaKey: false,
    ctrlKey: false,
  };
}

/** Mounts the real list hook. `MenuWithField` is not here, so a second tracker would be the only one listening. */
async function mountList(): Promise<MountedList> {
  globalThis.HTMLInputElement = FieldInput as unknown as typeof HTMLInputElement;
  const listeners: CaptureListener[] = [];
  const document = {
    nodeType: 9,
    activeElement: null,
    addEventListener(type: string, listener: CaptureListener['listener']) {
      listeners.push({ type, listener });
    },
    removeEventListener(type: string, listener: CaptureListener['listener']) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    createElement(tag: string) {
      return { nodeType: 1, tagName: String(tag).toUpperCase(), addEventListener() {}, removeEventListener() {} };
    },
    documentElement: { nodeType: 1, tagName: 'HTML', style: {} },
    body: { nodeType: 1, tagName: 'BODY' },
  };
  const view = {
    document,
    navigator: { vendor: 'Apple Computer, Inc.', userAgent: 'test' },
    performance,
    setTimeout,
    clearTimeout,
    HTMLInputElement: FieldInput,
    HTMLIFrameElement: FrameElement,
    addEventListener() {},
    removeEventListener() {},
  };
  document.defaultView = view;
  globalThis.window = view as unknown as Window & typeof globalThis;
  globalThis.document = document as unknown as Document;
  const formatRow = (await import(formatRowUrl.href)) as FormatRowModule;
  const acts: string[] = [];
  let list: FormatList | null = null;
  function Probe() {
    list = formatRow.useCustomFormatList(
      {
        entry: writtenFormat(),
        isAgentOffered: false,
        told: {
          onTyped() {},
          onAgentAsked() {
            acts.push('ask');
          },
          onEscaped() {},
          onEntered() {
            acts.push('entered');
          },
          onActHeld() {
            acts.push('held');
          },
          onTaken() {
            acts.push('taken');
          },
        },
      },
      true,
    );
    return null;
  }
  const root = createRoot({
    nodeType: 1,
    tagName: 'DIV',
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  });
  await react.act(async () => {
    root.render(react.createElement(Probe));
  });
  const mounted = list;
  if (mounted === null) throw new Error('useCustomFormatList did not render');
  return {
    root,
    list: mounted,
    listeners,
    acts,
    press(native) {
      return formatRow.handleCustomFormatKey(
        mounted,
        {
          key: native.key,
          target: new FieldInput(),
          repeat: false,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          nativeEvent: native,
        },
        true,
      );
    },
  };
}

function endCompositions(listeners: CaptureListener[], timeStamp: number) {
  for (const entry of [...listeners]) {
    if (entry.type === 'compositionend') entry.listener({ timeStamp });
  }
}

async function closeList(root: Root) {
  await react.act(async () => {
    root.unmount();
  });
}

describe('useCustomFormatList Enter', () => {
  it('applies a plain Enter after composition ends on Safari', async () => {
    const mounted = await mountList();
    try {
      assert.equal('isLateEnterOfInputMethod' in mounted.list, false);
      assert.equal(
        mounted.listeners.some((entry) => entry.type === 'compositionend'),
        false,
      );
      assert.equal(mounted.press(enterKey(1_000)), true);
      endCompositions(mounted.listeners, 2_000);
      assert.equal(mounted.press(enterKey(2_200)), true);
      assert.deepEqual(mounted.acts, ['taken', 'entered', 'taken', 'entered']);
    } finally {
      await closeList(mounted.root);
    }
  });

  it('leaves an Enter that is still composing', async () => {
    const mounted = await mountList();
    try {
      endCompositions(mounted.listeners, 2_000);
      assert.equal(mounted.press(enterKey(2_200, { isComposing: true })), false);
      assert.equal(mounted.press(enterKey(2_400, { keyCode: 229 })), false);
      assert.deepEqual(mounted.acts, []);
    } finally {
      await closeList(mounted.root);
    }
  });
});
