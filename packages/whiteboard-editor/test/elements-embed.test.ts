import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_HTML_STATE_CHARS } from '@open-artifact/whiteboard-core';
import {
  EMBED_CSP,
  EMBED_OWN_WRITES,
  EMBED_SAVES_PER_WRITE,
  buildEmbedSrcdoc,
  createFloodGuard,
  createStateSaver,
  embedBootstrap,
  embedRefusal,
  isEmbedSaveMessage,
  type EmbedStateWrite,
  type SaverClock,
} from '../src/elements/embed.ts';
import { artifactIdOf, boardLinkTarget, linkDisplayUrl, resolveAssetUrl } from '../src/elements/links.ts';

/** A clock whose timers run only when told to. */
function manualClock(): SaverClock & { run(): void } {
  let queued: (() => void) | undefined;
  return {
    setTimeout(callback) {
      queued = callback;
      return 1;
    },
    clearTimeout() {
      queued = undefined;
    },
    run() {
      const callback = queued;
      queued = undefined;
      callback?.();
    },
  };
}

describe('embed sandbox', () => {
  it('builds a srcdoc with the policy first and the page doctype removed', () => {
    const doc = buildEmbedSrcdoc('<!DOCTYPE html><title>Hi</title><p>x</p>', '{"n":1}');
    assert.ok(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
    assert.ok(doc.includes("connect-src 'none'"));
    assert.equal(doc.match(/<!doctype/gi)?.length, 1);
    assert.ok(doc.endsWith('<title>Hi</title><p>x</p>'));
    assert.ok(EMBED_CSP.startsWith("default-src 'none'"));
  });

  it('escapes the initial state so it cannot close the script', () => {
    const boot = embedBootstrap('{"html":"</script><script>alert(1)</script>"}');
    assert.ok(!boot.includes('</script>'));
    assert.ok(boot.includes('\\u003c/script>'));
  });

  it('refuses nested frames, plugins and linked files', () => {
    assert.equal(embedRefusal('<p>ok</p><script>1</script>'), undefined);
    for (const html of ['<iframe src=x>', '<OBJECT>', '<link rel=stylesheet href=x>', '<template shadowrootmode="open">', '< embed>'])
      assert.ok(embedRefusal(html), html);
  });

  it('recognizes save messages', () => {
    assert.ok(isEmbedSaveMessage({ boardEmbed: 'save', state: '{}' }));
    assert.ok(!isEmbedSaveMessage({ boardEmbed: 'save', state: 1 }));
    assert.ok(!isEmbedSaveMessage(null));
  });
});

describe('createStateSaver', () => {
  const recorder = () => {
    const writes: string[][] = [];
    return { writes, write: (batch: readonly EmbedStateWrite[]) => writes.push(batch.map(([id, state]) => `${id}=${state}`)) };
  };

  it('writes the first save at once, then the latest of each embed after a pause', () => {
    const { writes, write } = recorder();
    const clock = manualClock();
    const saver = createStateSaver(write, 400, clock);
    saver.save('a', '1');
    saver.save('a', '2');
    saver.save('b', '1');
    saver.save('a', '3');
    assert.deepEqual(writes, [['a=1']]);
    clock.run();
    assert.deepEqual(writes, [['a=1'], ['a=3', 'b=1']], 'one board change for both');
    clock.run();
    assert.deepEqual(writes.length, 2, 'quiet once nothing is waiting');
    saver.save('b', '2');
    assert.deepEqual(writes.at(-1), ['b=2'], 'at once again after a quiet pause');
    assert.ok(saver.isOwnWrite('a', '3'));
    assert.ok(!saver.isOwnWrite('a', '2'));
    assert.ok(!saver.isOwnWrite('b', '3'));
  });

  it(`writes at most ${EMBED_SAVES_PER_WRITE} embeds per pause, and all of them on a full flush`, () => {
    const { writes, write } = recorder();
    const clock = manualClock();
    const saver = createStateSaver(write, 400, clock);
    saver.save('first', '0');
    for (let index = 0; index < EMBED_SAVES_PER_WRITE + 4; index += 1) saver.save(`e${index}`, String(index));
    clock.run();
    assert.equal(writes[1]?.length, EMBED_SAVES_PER_WRITE);
    assert.equal(writes[1]?.[0], 'e0=0');
    saver.save('e0', '"again"');
    saver.flush();
    assert.deepEqual(writes[2], ['e16=16', 'e17=17', 'e18=18', 'e19=19', 'e0="again"']);
    saver.save('late', '1');
    saver.flush('late');
    assert.deepEqual(writes.at(-1), ['late=1'], 'one embed alone');
    saver.flush('late');
    assert.equal(writes.length, 4);
  });

  it('drops states that are not JSON or too long, remembers only its last writes and cancels', () => {
    const { writes, write } = recorder();
    const clock = manualClock();
    const saver = createStateSaver(write, 400, clock);
    saver.save('a', 'x'.repeat(MAX_HTML_STATE_CHARS + 1));
    saver.save('a', '{not json');
    assert.equal(writes.length, 0);
    saver.save('a', '"a"');
    for (let index = 0; index < EMBED_OWN_WRITES; index += 1) {
      saver.save('a', `${index}`);
      saver.flush();
    }
    assert.ok(!saver.isOwnWrite('a', '"a"'));
    assert.ok(saver.isOwnWrite('a', `${EMBED_OWN_WRITES - 1}`));
    saver.save('b', '1');
    saver.cancel();
    clock.run();
    saver.flush();
    assert.ok(!writes.some((batch) => batch.includes('b=1')));
  });
});

describe('createFloodGuard', () => {
  it('trips after too many messages in a second', () => {
    const guard = createFloodGuard(3, 1000);
    assert.deepEqual([guard.hit(0), guard.hit(1), guard.hit(2), guard.hit(3)], [false, false, false, true]);
    assert.equal(guard.hit(1500), false);
  });
});

describe('board links', () => {
  it('opens artifacts in the Shell and web links as they are', () => {
    assert.equal(artifactIdOf('open-artifact://artifact/art_abc1234567'), 'art_abc1234567');
    assert.equal(artifactIdOf('https://example.com'), undefined);
    assert.equal(boardLinkTarget('open-artifact://artifact/art_abc1234567', 'https://shell.test'), 'https://shell.test/a/art_abc1234567');
    assert.equal(boardLinkTarget('https://example.com/x'), 'https://example.com/x');
    assert.equal(boardLinkTarget('javascript:alert(1)'), undefined);
  });

  it('shows short addresses and resolves uploads relative to the page', () => {
    assert.equal(linkDisplayUrl('https://example.com/'), 'example.com');
    assert.equal(linkDisplayUrl('https://example.com/a/b'), 'example.com/a/b');
    assert.equal(resolveAssetUrl(`/_blob/${'0f'.repeat(16)}`), `/_blob/${'0f'.repeat(16)}`);
    assert.equal(resolveAssetUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  });
});
