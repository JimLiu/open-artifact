import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmSeconds, playSeconds, type ClockPart, type SceneEntry } from '@open-artifact/motion-core';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';
import { groupMarks, hiddenCount, nextPage } from '../src/comments/mark-groups.ts';
import { isCharacterKey } from '../src/keyboard/letter-keys.ts';
import { localVoice, sceneReached, sceneWords, speakingLimitMs } from '../src/reading/aloud.ts';
import { filmTextFile, nextUnread, partKey, readLines, sceneTexts, shownLines, spokenBetween, textFileName, textParts } from '../src/reading/film-text.ts';
import { parseSwitch } from '../src/stores/switches.ts';
import { moreGroups } from '../src/transport/more.ts';
import { lineAt, movedFrom } from '../src/voiceover/lines.ts';

const part = (key: string | null, label: string, start: number, dur: number): ClockPart => ({
  key,
  own: label,
  label,
  renamed: null,
  filmStart: filmSeconds(start),
  filmDur: filmSeconds(dur),
  playStart: playSeconds(start),
  playDur: playSeconds(dur),
  retimed: false,
});

const row = (kind: LayerRow['kind'], texts: string[], from: number, kids: LayerRow[] = []): LayerRow => ({
  id: `${kind}:${texts.join('|')}`,
  kind,
  round: false,
  name: '',
  hidden: false,
  under: null,
  own: false,
  many: 0,
  texts,
  spans: [[playSeconds(from), playSeconds(from + 1)]],
  at: playSeconds(from),
  enter: { how: [], from: playSeconds(from), to: playSeconds(from) },
  leave: { how: [], from: playSeconds(from + 1), to: playSeconds(from + 1) },
  box: null,
  wordsBox: null,
  look: null,
  kids,
  sole: null,
  whole: false,
  drawn: '',
  full: false,
});

test('the words a reading found: text rows, nested ones too, each line once with its spaces collapsed', () => {
  const rows = [row('group', ['ignored'], 0, [row('text', ['  Hello\n world '], 0), row('text', ['Hello world'], 2)]), row('text', ['Second', ''], 3)];
  assert.deepEqual(readLines(rows, 0), [
    { text: 'Hello world', atStart: true },
    { text: 'Second', atStart: false },
  ]);
});

test('words on a box they paint are read too, but not the words of a drawing', () => {
  const chip = row('shape', ['2× speed'], 0);
  const drawing = { ...row('shape', ['Axis label'], 0), drawn: 'graphic' as const };
  const box = row('shape', [], 0, [row('text', ['Inside'], 1)]);
  assert.deepEqual(
    readLines([chip, drawing, box], 0).map((line) => line.text),
    ['2× speed', 'Inside'],
  );
});

test('a line still on from the scene before is left out; one that comes again later is kept', () => {
  const before = [{ text: 'Title', atStart: true }];
  assert.deepEqual(
    shownLines(
      [
        { text: 'Title', atStart: true },
        { text: 'New', atStart: false },
      ],
      before,
    ),
    ['New'],
  );
  assert.deepEqual(shownLines([{ text: 'Title', atStart: false }], before), ['Title']);
});

test('spoken lines belong to the scene they start in', () => {
  const lines = [
    { at: 0.5, text: ' One ' },
    { at: 2, text: 'Two' },
    { at: 3.9, text: '' },
  ];
  assert.deepEqual(spokenBetween(lines, 0, 2), ['One']);
  assert.deepEqual(spokenBetween(lines, 2, 4), ['Two']);
});

test('the film as text: names, starts, descriptions, what was read and what is said', () => {
  const parts = textParts([part('intro', 'Intro', 0, 2), part('end', 'End', 2, 3), part('todo', 'Later', 5, 1)], 6);
  const scenes: SceneEntry[] = [
    { id: 'intro', name: 'Intro', dur: filmSeconds(2), desc: 'A  title\ncard' },
    { id: 'end', name: 'End', dur: filmSeconds(3) },
  ];
  const reports = [
    { id: 'intro', state: 'final' as const },
    { id: 'end', state: 'final' as const },
    { id: 'todo', state: 'todo' as const },
  ];
  const read = new Map([[partKey(parts[0]!, 0), [{ text: 'Hi', atStart: true }]]]);
  const texts = sceneTexts({ parts, scenes, reports, read, spoken: [{ at: 2.5, text: 'Bye' }] });
  assert.deepEqual(
    texts.map((scene) => [scene.name, scene.from, scene.note, scene.shown, scene.spoken]),
    [
      ['Intro', 0, 'A title card', ['Hi'], []],
      ['End', 2, '', undefined, ['Bye']],
      ['Later', 5, '', [], []],
    ],
  );
  assert.equal(nextUnread(parts, reports, read), 1);
  const failed = new Map([...read, [partKey(parts[1]!, 1), null]]);
  assert.equal(nextUnread(parts, reports, failed), -1);
  assert.equal(sceneTexts({ parts, scenes, reports, read: failed, spoken: [] })[1]!.shown, null);
});

test('a film with no parts is read as one', () => {
  assert.deepEqual(textParts([], 4), [{ key: null, label: '', from: 0, to: 4 }]);
});

test('the text file lists each scene, and says where words could not be read', () => {
  const words = { scene: (name: string, index: number) => name || `Scene ${index + 1}`, startsAt: (s: number) => `from ${s}`, onScreen: 'On screen', spoken: 'Spoken', unread: 'Unread.' };
  const file = filmTextFile(' My film ', [
    { name: 'Intro', from: 0, note: 'Opening', shown: ['Hello'], spoken: ['Hi there'] },
    { name: '', from: 2, note: '', shown: null, spoken: [] },
  ], words);
  assert.equal(file, 'My film\n\nIntro (from 0)\nOpening\nOn screen:\n- Hello\nSpoken:\n- Hi there\n\nScene 2 (from 2)\nUnread.\n');
  assert.equal(textFileName('Café: the “Big” day!'), 'cafe-the-big-day.txt');
  assert.equal(textFileName('   '), 'animation.txt');
});

test('describe aloud uses a voice on this device in the page’s language, the default first', () => {
  const voices = [
    { lang: 'en-US', localService: false, default: true },
    { lang: 'en-GB', localService: true, default: false },
    { lang: 'en_AU', localService: true, default: true },
    { lang: 'fr-FR', localService: true, default: false },
  ];
  assert.equal(localVoice(voices, 'en')?.lang, 'en_AU');
  assert.equal(localVoice(voices, 'fr-CA')?.lang, 'fr-FR');
  assert.equal(localVoice(voices, 'de'), null);
  assert.equal(localVoice([], 'en'), null);
});

test('a scene is reached by playing into it, or by starting to play at its start; not by a seek', () => {
  const parts = [part('a', 'A', 0, 2), part('b', 'B', 2, 2)];
  assert.equal(sceneReached(parts, 1.98, 2.01, false), 1);
  assert.equal(sceneReached(parts, 1.5, 1.6, false), -1);
  assert.equal(sceneReached(parts, 0.2, 3, false), -1, 'a jump is a seek');
  assert.equal(sceneReached(parts, 3, 2.01, false), -1, 'going back is a seek');
  assert.equal(sceneReached(parts, 0, 2, true), 1);
  assert.equal(sceneReached(parts, 0, 2.5, true), -1);
  assert.equal(sceneReached([], 0, 1, false), -1);
  const scenes: SceneEntry[] = [{ id: 'b', name: 'B', dur: filmSeconds(2), desc: ' A  dog ' }];
  assert.equal(sceneWords(parts, scenes, 1), 'A dog');
  assert.equal(sceneWords(parts, scenes, 0), '');
  assert.ok(speakingLimitMs('one two three') > speakingLimitMs('one'));
});

test('single-key shortcuts are one character with no Cmd, Ctrl or Alt; Space is not one', () => {
  const press = (key: string, more: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...more });
  assert.equal(isCharacterKey(press('f')), true);
  assert.equal(isCharacterKey(press('F')), true);
  assert.equal(isCharacterKey(press(',')), true);
  assert.equal(isCharacterKey(press(' ')), false);
  assert.equal(isCharacterKey(press('ArrowLeft')), false);
  assert.equal(isCharacterKey(press('z', { metaKey: true })), false);
  assert.equal(isCharacterKey(press('z', { altKey: true })), false);
});

test('a remembered switch reads on, off, or its default', () => {
  assert.equal(parseSwitch('on', false), true);
  assert.equal(parseSwitch('off', true), false);
  assert.equal(parseSwitch(null, true), true);
  assert.equal(parseSwitch('garbage', false), false);
});

test('the More menu keeps its rows in groups, in order', () => {
  const groups = moreGroups([
    { id: 'keys', group: 20, order: 10 },
    { id: 'aloud', group: 10, order: 20 },
    { id: 'read', group: 10, order: 10 },
  ]);
  assert.deepEqual(
    groups.map((rows) => rows.map((row) => row.id)),
    [['read', 'aloud'], ['keys']],
  );
});

test('crowded comment marks gather into a group that shows three and pages through the rest', () => {
  const marks = [0, 2, 4, 6, 8, 100].map((x, index) => ({ id: `m${index}`, x, range: false }));
  const groups = groupMarks(marks, 10);
  assert.deepEqual(
    groups.map((group) => group.shown),
    [['m0', 'm1', 'm2'], ['m5']],
  );
  assert.equal(hiddenCount(groups[0]!), 2);
  assert.equal(nextPage(groups[0]!), 1);
  const paged = groupMarks(marks, 10, new Map([['m0', 1]]));
  assert.deepEqual(paged[0]!.shown, ['m3', 'm4']);
  assert.equal(hiddenCount(paged[0]!), 3);
  assert.equal(nextPage(paged[0]!), 0);
  const stretched = groupMarks([{ id: 'a', x: 0, range: false }, { id: 'r', x: 1, range: true }], 10);
  assert.equal(stretched.length, 2, 'a stretch keeps a mark of its own');
});

test('the voiceover line said at a moment', () => {
  const lines = [
    { at: 0, dur: 1 },
    { at: 2, dur: 1 },
  ];
  assert.equal(lineAt(lines, 0.5), 0);
  assert.equal(lineAt(lines, 1.5), -1);
  assert.equal(lineAt(lines, 2), 1);
});

test('a line moved again before the film comes back starts where the last move put it', () => {
  const shown = {};
  const last = { code: 'S.b + 1', at: 4, on: shown };
  assert.equal(movedFrom(last, 'S.b + 1', shown), 4);
  assert.equal(movedFrom(last, 'S.b + 1', {}), null, 'the film came back');
  assert.equal(movedFrom(last, 'S.b + 2', shown), null, 'the code was changed since');
  assert.equal(movedFrom(undefined, 'S.b + 1', shown), null);
});

test('Mod+\\ closes a panel opened from a menu, and does not bring it back as the last one open', async () => {
  const { registerPanel, togglePanel } = await import('../src/panels/registry.ts');
  const { useUi } = await import('../src/stores/ui.ts');
  const offs = [registerPanel({ id: 'tweaks', label: 'Tweaks', order: 10, render: () => null }), registerPanel({ id: 'read', label: 'Read', order: 90, fromMenu: true, render: () => null })];
  try {
    useUi.getState().openPanel('read');
    togglePanel();
    assert.equal(useUi.getState().panel, null);
    togglePanel();
    assert.equal(useUi.getState().panel, 'tweaks');
    togglePanel();
    assert.equal(useUi.getState().panel, null);
    togglePanel('read');
    assert.equal(useUi.getState().panel, 'read');
  } finally {
    for (const off of offs) off();
  }
});

test('showing the playhead’s moment again sends one render of it, where it stands', async () => {
  const { PlaybackLoop } = await import('../src/engine/playback-loop.ts');
  const renders: [number, boolean][] = [];
  const ticks: { time: number }[] = [];
  let seq = 0;
  const stage = { live: true, lastSent: 0, render: (t: number, playing: boolean) => (renders.push([t, playing]), ++seq) };
  const sound = { now: () => 2, seek: () => undefined, play: () => undefined, pause: () => undefined, state: { interrupted: false } };
  const loop = new PlaybackLoop({ stage: stage as never, sound: sound as never, duration: () => 2, onTick: (tick) => ticks.push(tick) });
  loop.seek(1.5);
  loop.presented(seq);
  loop.show();
  assert.deepEqual(renders, [[1.5, false], [1.5, false]]);
});
