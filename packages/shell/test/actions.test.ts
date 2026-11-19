import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { ShellBoot } from '@open-artifact/protocol';

test('shell links retain owner capability, page fragments and guest invites', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://shell.example/a/art_test?comment=thread#unknown') });
  try {
    const result = await build({ stdin: { contents: `export { shellLink } from './src/shell/actions.ts'; export { useShell } from './src/shell/store.ts';`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'toast', setup(build) {
      build.onResolve({ filter: /^@open-artifact\/ui$/ }, () => ({ path: 'toast', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const toast = { add() {} };' }));
    } }] });
    const { shellLink, useShell } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`);
    const viewUrl = 'https://shell.example/__hosting/owner/capability?next=%2Fa%2Fart_test';
    const boot = { id: 'art_test', type: 'design', viewUrl } as ShellBoot;
    for (const [type, fragment] of [['design', '#page=abc'], ['docs', '#12345678-abcd'], ['sheets', '#page=abc'], ['slides', '#slide-2']]) {
      useShell.setState({ boot: { ...boot, type } });
      assert.equal(shellLink(fragment), viewUrl + fragment);
      assert.equal(shellLink('#unknown'), viewUrl);
    }
    useShell.setState({ boot: { ...boot, viewUrl: undefined } });
    assert.equal(shellLink(''), 'https://shell.example/a/art_test');
    useShell.setState({ boot: { ...boot, type: 'slides', typeServer: { role: 'viewer', invite: 'https://guest.example/slides/invite?key=guest' } } });
    assert.equal(shellLink('#slide-2'), 'https://guest.example/slides/invite?key=guest#slide-2');
    useShell.setState({ boot: { ...boot, typeServer: { role: 'viewer' } } });
    assert.equal(shellLink(''), 'https://shell.example/a/art_test');
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (saved) Object.defineProperty(globalThis, 'location', saved);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});
