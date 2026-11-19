import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalProvider } from '../src/local-provider.ts';

test('only explicit cross-origin provider bases include cookie credentials', async () => {
  const originals = ['location', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const credentials: (RequestCredentials | undefined)[] = [];
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://shell.example/editor/' } });
    globalThis.fetch = async (_input, init) => {
      credentials.push(init?.credentials);
      return Response.json({ artifact: { id: 'one', title: 'One' }, viewer: { id: 'owner', role: 'owner' } });
    };
    for (const base of [undefined, './', 'https://shell.example/artifact/', 'https://frame.example/artifact/']) {
      credentials.length = 0;
      const artifact = (await createLocalProvider({ ...(base ? { base } : {}) }).get('artifact'))!;
      await artifact.publish({ 'index.html': { content: 'new' } });
      assert.deepEqual(credentials, Array(2).fill(base?.startsWith('https://frame.') ? 'include' : undefined));
    }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
