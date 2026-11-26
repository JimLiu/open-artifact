/**
 * `chrome_hello` pins and clears the host theme on the page root. The Shell's side is the same
 * `host-theme` patch; this checks the page actually removes `data-theme` and the three accent properties.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { HOST_ACCENT_VARS, accentVars } from '@open-artifact/protocol';
import { connectShell } from '../src/shell.ts';

const SHELL = 'http://shell.example';

describe('chrome_hello theme', () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
  };

  afterEach(() => {
    restore('window', previous.window);
    restore('document', previous.document);
    restore('location', previous.location);
  });

  it('clears data-theme and the three accent properties when theme or the accent is missing, and keeps both schemes', () => {
    const props = new Map<string, string>();
    const dataset: { theme?: string } = {};
    let colorScheme: string | undefined;
    const root = {
      dataset,
      style: {
        setProperty(name: string, value: string) {
          if (name === 'color-scheme') throw new Error('color-scheme must stay under the page stylesheet');
          props.set(name, value);
        },
        removeProperty(name: string) {
          props.delete(name);
        },
        set colorScheme(value: string) {
          colorScheme = value;
          throw new Error('color-scheme must stay under the page stylesheet');
        },
      },
    };
    const listeners = new Set<(event: MessageEvent) => void>();
    const parent = { postMessage(): void {} };
    const win = {
      parent,
      addEventListener(_type: string, listener: (event: MessageEvent) => void) {
        listeners.add(listener);
      },
      removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
        listeners.delete(listener);
      },
    };
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = { documentElement: root } as unknown as Document;
    globalThis.location = { href: `http://page.example/p?open_artifact_shell=${encodeURIComponent(SHELL)}` } as Location;

    const shell = connectShell();
    assert.ok(shell);
    const deliver = (data: unknown): void => {
      for (const listener of listeners) listener({ origin: SHELL, source: parent, data } as unknown as MessageEvent);
    };

    deliver({ openArtifact: 'chrome_hello', theme: { scheme: 'dark', accent: '#FF8800' } });
    assert.equal(dataset.theme, 'dark');
    assert.equal(props.get('--open-artifact-accent'), '#ff8800');
    assert.equal(props.get('--open-artifact-accent-fg'), accentVars('#FF8800')['--open-artifact-accent-fg']);
    assert.equal(props.get('--open-artifact-accent-soft'), '#ff88001f');

    deliver({ openArtifact: 'chrome_hello', theme: { scheme: 'dark' } });
    assert.equal(dataset.theme, 'dark', 'a missing accent keeps the scheme');
    for (const name of HOST_ACCENT_VARS) assert.equal(props.has(name), false, name);

    deliver({ openArtifact: 'chrome_hello', theme: { scheme: 'light', accent: '#112233' } });
    assert.equal(dataset.theme, 'light');
    assert.equal(props.get('--open-artifact-accent'), '#112233');

    deliver({ openArtifact: 'chrome_hello', draws: [] });
    assert.equal(dataset.theme, undefined);
    assert.equal('theme' in dataset, false);
    for (const name of HOST_ACCENT_VARS) assert.equal(props.has(name), false, name);
    assert.equal(colorScheme, undefined, 'clearing a theme does not force color-scheme to light');

    shell.dispose();
  });
});

function restore(name: 'window' | 'document' | 'location', value: unknown): void {
  if (value === undefined) delete (globalThis as Record<string, unknown>)[name];
  else (globalThis as Record<string, unknown>)[name] = value;
}
