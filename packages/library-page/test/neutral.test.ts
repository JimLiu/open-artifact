/**
 * The package belongs to no host: its source names none of one's tokens, selectors or modules. A host maps
 * `--oa-page-*` onto its own tokens and says its look on the page's root (README.md).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('host-neutral source', () => {
  it("names no host's tokens, dark-theme selector or modules", () => {
    const found = files(SRC).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return [/--dsw-/, /--dsh-/, /data-ds-dark-theme/, /@deepseek-ai\//].filter((re) => re.test(text)).map((re) => `${path}: ${re}`);
    });
    assert.deepEqual(found, []);
  });

  it('reads the dark look and the platform from the page root', () => {
    const css = readFileSync(join(SRC, 'styles.ts'), 'utf8');
    assert.match(css, /:where\(\.oa-page\)\[data-theme=dark\] /);
    assert.match(css, /:where\(\.oa-page\)\[data-platform=darwin\] \.oa-heading/);
  });
});
