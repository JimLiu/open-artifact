/**
 * Every keyboard handler tells an input method's keys apart with
 * `isComposingKey`, not `isComposing` alone: Safari sends the Enter that
 * confirms a candidate with `isComposing` already false and key code 229, so a
 * field that reads only `isComposing` submits (or closes) on that Enter.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** A read of `isComposing` off something that may be a keyboard event. */
const READ = /\b(?:event|e|native|nativeEvent|keyEvent|key)\.isComposing\b/;
/** The same or the next line also looks at key code 229, or the event is an InputEvent. */
const COVERED = /229|keyCode|InputEvent/;

/** Reads that are not keydowns (`beforeinput`, `input`), where `isComposing` alone is right. */
const NOT_KEYDOWN: ReadonlyArray<{ file: string; text: string }> = [
  { file: 'packages/whiteboard-editor/src/elements/TextEditor.tsx', text: "!type.startsWith('insert') || event.isComposing" },
  { file: 'packages/whiteboard-editor/src/elements/rich-dom.ts', text: 'context === null || event.isComposing' },
  { file: 'packages/sheets-editor/src/app/sheet-page.tsx', text: "'isComposing' in nativeEvent && nativeEvent.isComposing" },
  { file: 'packages/sheets-editor/src/editor/words-offered-view.tsx', text: "'isComposing' in nativeEvent && nativeEvent.isComposing" },
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'generated' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

function sourceRoots(): string[] {
  const roots = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, 'packages', entry.name, 'src'));
  roots.push(join(ROOT, 'apps', 'desktop', 'src'));
  return roots.filter((root) => existsSync(root));
}

describe('composition checks in key handlers', () => {
  it('use isComposingKey (or check key code 229) wherever a keyboard event reads isComposing', () => {
    const found: string[] = [];
    for (const file of sourceRoots().flatMap((root) => sources(root))) {
      const name = relative(ROOT, file).split('\\').join('/');
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!READ.test(line)) return;
        if (COVERED.test(line) || COVERED.test(lines[index + 1] ?? '')) return;
        if (NOT_KEYDOWN.some((allowed) => allowed.file === name && line.includes(allowed.text))) return;
        found.push(`${name}:${index + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(found, [], `Use isComposingKey from @open-artifact/ui instead of isComposing alone:\n${found.join('\n')}`);
  });
});
