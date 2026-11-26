import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_ADDED_VIDEO_SECONDS,
  MAX_ASSETS,
  MAX_FILM_SECONDS,
  MAX_SCENES,
  MAX_VIDEO_SCENES,
  SCENES_CUT,
  addVideoRoom,
  addVideoScene,
  checkFilm,
  isAddedVideoModule,
  removeVideoScene,
  restoreVideoBlock,
  restoreVideoScene,
  clipSceneForm,
  clipTrimRange,
  looksLikeVideoFile,
  newVideoSceneId,
  nextSplitId,
  parseScenesFile,
  snapClipSecond,
  splitClipScene,
  trimClipScene,
  videoEncodePlan,
  videoFilmSize,
  videoSceneModule,
  withClipFrom,
  type ClipSceneTexts,
  type VideoSceneFilm,
} from '../src/index.ts';

const mp4 = (name: string): string | undefined => (name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.png') ? 'image/png' : undefined);

const bare = (id: string, extra = ''): string =>
  `const FROM = 2; // where it starts\nkit.scene('${id}', {\n  init(kit) {\n    kit.stage.append(kit.video('talk.mp4', { from: FROM, sound: true${extra} }));\n  },\n  render(t) {},\n});\n`;
const scenesText = (scenes: unknown[]): string => `${JSON.stringify({ v: 1, stage: 'final', width: 1920, height: 1080, fps: 30, background: '#000000', scenes }, null, 2)}\n`;
/** The errors the film check finds in a film of these scenes and modules. */
function filmErrors(scenes: string, modules: Record<string, string>): string[] {
  const files = new Map<string, string>([
    ['film/meta', JSON.stringify({ v: 1, title: 'Clips', updatedAt: '2026-01-01T00:00:00Z' })],
    ['film/script', JSON.stringify({ code: SCENES_CUT })],
    ['modules/scenes.json', JSON.stringify({ kind: 'json', text: scenes })],
    ['assets/talk.mp4', JSON.stringify({ ref: `/_blob/${'a'.repeat(32)}`, mime: 'video/mp4' })],
  ]);
  for (const [name, text] of Object.entries(modules)) files.set(`modules/${name}`, JSON.stringify({ kind: 'js', text }));
  const syntaxError = (code: string): { message: string } | null => {
    try {
      new Function('kit', code);
      return null;
    } catch (error) {
      return { message: String(error) };
    }
  };
  return checkFilm(files, { syntaxError })
    .filter((finding) => finding.level === 'error')
    .map((finding) => `${finding.file}: ${finding.message}`);
}
const texts = (module: string, scenes: unknown[], recut: string | null = null): ClipSceneTexts => ({ module, scenes: scenesText(scenes), recut });

describe('video clips: the clip form', () => {
  it('reads FROM, SPEED, the asset and whether the scene is only its video', () => {
    const form = clipSceneForm(bare('talk'), 'talk', mp4);
    assert.deepEqual(form, { sceneId: 'talk', asset: 'talk.mp4', from: 2, speed: 1, hasSpeed: false, bare: true });
    const fast = `const FROM = 1.5;\nconst SPEED = 2;\nkit.scene("run", { init(kit) { this.v = kit.video("talk.mp4", { from: FROM, speed: SPEED }); kit.stage.append(this.v); }, render(t) {} });`;
    const read = clipSceneForm(fast, 'run', mp4);
    assert.equal(read?.speed, 2);
    assert.equal(read?.bare, false, 'it keeps the element and appends it itself');
  });

  it('refuses what a trim could not rewrite safely', () => {
    const refused = [
      bare('talk').replace('const FROM = 2;', 'let FROM = 2;'),
      bare('talk').replace("kit.scene('talk'", "kit.scene('other'"),
      bare('talk', ', dur: 3'),
      bare('talk', ', loop: true'),
      bare('talk', ', ...more'),
      bare('talk', ', speed: 2'),
      bare('talk', ', at: 4 / 2'),
      bare('talk').replace('render(t) {}', 'render(t) { kit.seek(null, t); }'),
      bare('talk').replace('render(t) {}', 'render(t) { FROM = t; }'),
      bare('talk').replace("'talk.mp4'", "'still.png'"),
      `const SPEED = 2;\n${bare('talk')}`,
      `const FROM = 2;\nconst SPEED = 9;\n${bare('talk').split('\n').slice(1).join('\n')}`,
      `${bare('talk')}\nkit.video('talk.mp4', { from: FROM });`,
    ];
    for (const text of refused) assert.equal(clipSceneForm(text, 'talk', mp4), null, text);
  });

  it('calls a scene with more than its video not bare, but still trims it', () => {
    const text = bare('talk').replace('render(t) {}', 'render(t) { kit.stage.style.opacity = t; }');
    assert.equal(clipSceneForm(text, 'talk', mp4)?.bare, false);
  });

  it('changes only line 1’s number', () => {
    assert.equal(withClipFrom(bare('talk'), 3.25), bare('talk').replace('= 2;', '= 3.25;'));
    assert.equal(withClipFrom(bare('talk'), 1 / 3), bare('talk').replace('= 2;', '= 0.333;'));
  });
});

describe('video clips: trimming', () => {
  const film = texts(bare('talk'), [
    { id: 'intro', name: 'Intro', dur: 4 },
    { id: 'talk', name: 'Talk', dur: 6 },
  ]);
  const form = clipSceneForm(film.module, 'talk', mp4)!;

  it('gives each end its room: the video’s ends, the film’s length limit, half a second between', () => {
    const range = clipTrimRange(film, form, 20)!;
    assert.deepEqual(range, { start: 2, end: 8, startMin: 0, startMax: 7.5, endMin: 2.5, endMax: 20 });
    const unknown = clipTrimRange(film, form, null)!;
    assert.equal(unknown.endMax, 8, 'not past where it ends while the video’s length is not known');
    assert.equal(clipTrimRange(film, form, Number.POSITIVE_INFINITY)!.endMax, 8);
    const full = texts(bare('talk'), [
      { id: 'intro', dur: MAX_FILM_SECONDS - 7 },
      { id: 'talk', dur: 6 },
    ]);
    assert.equal(clipTrimRange(full, form, 100)!.endMax, 9, 'one second of the film is left');
  });

  it('writes FROM and the scene’s dur, nothing else, and keeps the text when nothing moves', () => {
    const result = trimClipScene(film, form, 3, 7.5, { length: 20 });
    assert.ok(result.ok);
    assert.equal(result.texts.module, bare('talk').replace('= 2;', '= 3;'));
    const scenes = JSON.parse(result.texts.scenes);
    assert.deepEqual(
      scenes.scenes.map((scene: { dur: number }) => scene.dur),
      [4, 4.5],
    );
    assert.equal(scenes.scenes[1].name, 'Talk');
    const same = trimClipScene(film, form, 2, 8, { length: 20 });
    assert.ok(same.ok);
    assert.equal(same.texts, film);
  });

  it('refuses a scene under half a second, past the video’s end or past the film’s limit', () => {
    assert.deepEqual(trimClipScene(film, form, 2, 2.3, { length: 20 }), { ok: false, reason: 'short' });
    assert.deepEqual(trimClipScene(film, form, 2, 21, { length: 20 }), { ok: false, reason: 'past-end' });
    assert.ok(trimClipScene(film, form, 2, 21, { length: 20, pastEnd: true }).ok, 'an undo may put back what was');
    assert.deepEqual(trimClipScene(film, form, 0, MAX_FILM_SECONDS, { length: null }), { ok: false, reason: 'long' });
  });

  it('counts film seconds at the scene’s speed', () => {
    const fast = { ...film, module: film.module.replace('const FROM = 2; // where it starts\n', 'const FROM = 2;\nconst SPEED = 2;\n').replace('from: FROM,', 'from: FROM, speed: SPEED,') };
    const fastForm = clipSceneForm(fast.module, 'talk', mp4)!;
    assert.equal(fastForm.speed, 2);
    const range = clipTrimRange(fast, fastForm, 40)!;
    assert.equal(range.end, 14);
    assert.equal(range.startMax, 13);
    const result = trimClipScene(fast, fastForm, 4, 10, { length: 40 });
    assert.ok(result.ok);
    assert.equal(result.dur, 3);
    assert.equal(snapClipSecond(3.17, 2), 3.2);
  });

  it('keeps a length set by hand at the same pace, and drops it when its bounds no longer allow it', () => {
    const recut = JSON.stringify({ v: 1, scenes: [{ id: 'talk', dur: { was: 6, v: 9 }, name: { was: 'Talk', v: 'Speech' } }] });
    const withRecut = { ...film, recut };
    const longer = trimClipScene(withRecut, form, 2, 10, { length: 20 });
    assert.ok(longer.ok);
    const entry = JSON.parse(longer.texts.recut!).scenes[0];
    assert.deepEqual(entry.dur, { was: 8, v: 12 });
    assert.deepEqual(entry.name, { was: 'Talk', v: 'Speech' });
    const short = trimClipScene({ ...film, recut: JSON.stringify({ v: 1, scenes: [{ id: 'talk', dur: { was: 6, v: 3 } }] }) }, form, 2, 2.6, { length: 20 });
    assert.ok(short.ok);
    assert.equal(short.texts.recut, null, '0.3 s is under the shortest a scene may be shown');
  });

  it('leaves a recut of another version alone', () => {
    const later = JSON.stringify({ v: 2, scenes: [] });
    const result = trimClipScene({ ...film, recut: later }, form, 2, 7, { length: 20 });
    assert.ok(result.ok);
    assert.equal(result.texts.recut, later);
  });
});

describe('video clips: splitting', () => {
  const film = texts(bare('talk'), [
    { id: 'intro', name: 'Intro', dur: 4 },
    { id: 'talk', name: 'Talk', dur: 6, desc: 'The speech' },
    { id: 'end', name: 'End', dur: 2 },
  ]);
  const form = clipSceneForm(film.module, 'talk', mp4)!;
  const others = { modules: new Set(['scenes.json', 'scene-intro.js', 'scene-talk.js', 'scene-end.js']), retouched: null };

  it('cuts the scene in two at the playhead: a copy right after it, further into the video, under the same name', () => {
    const result = splitClipScene(film, form, others, 2.5);
    assert.ok(result.ok);
    const { split } = result;
    assert.equal(split.id, 'talk-2');
    assert.equal(split.texts.module, film.module);
    assert.equal(split.module, bare('talk-2').replace('= 2;', '= 4.5;'));
    const scenes = JSON.parse(split.texts.scenes).scenes;
    assert.deepEqual(
      scenes.map((scene: { id: string; dur: number; name: string }) => [scene.id, scene.dur, scene.name]),
      [
        ['intro', 4, 'Intro'],
        ['talk', 2.5, 'Talk'],
        ['talk-2', 3.5, 'Talk'],
        ['end', 2, 'End'],
      ],
    );
    assert.equal(scenes[2].desc, 'The speech');
  });

  it('says why it cannot', () => {
    assert.deepEqual(splitClipScene(film, form, others, 0.4), { ok: false, reason: 'place' });
    assert.deepEqual(splitClipScene(film, form, others, 5.6), { ok: false, reason: 'place' });
    assert.deepEqual(splitClipScene(film, form, others, Number.NaN), { ok: false, reason: 'place' });
    const busy = film.module.replace('render(t) {}', 'render(t) { kit.stage.style.opacity = t; }');
    assert.deepEqual(splitClipScene({ ...film, module: busy }, clipSceneForm(busy, 'talk', mp4)!, others, 3), { ok: false, reason: 'bare' });
    const retouched = JSON.stringify({ v: 1, layers: [{ id: 'talk:0/video', cls: '', kin: '0/1', at: 0, size: { was: 1, v: 2 } }] });
    assert.deepEqual(splitClipScene(film, form, { ...others, retouched }, 3), { ok: false, reason: 'looks' });
    const many = texts(
      bare('talk'),
      Array.from({ length: MAX_SCENES }, (_, index) => ({ id: index === 0 ? 'talk' : `s${index}`, dur: 2 })),
    );
    assert.deepEqual(splitClipScene(many, form, others, 1), { ok: false, reason: 'other' });
  });

  it('names the copy with the first free number, past ids anything else uses', () => {
    assert.equal(nextSplitId('talk-2', (id) => id === 'talk-2'), 'talk-3');
    assert.equal(nextSplitId('talk', () => true), null);
    assert.equal(nextSplitId('a'.repeat(31), () => false), null, 'no room in an id for a number');
    const taken = splitClipScene(film, form, { ...others, modules: new Set([...others.modules, 'scene-talk-2.js~1']) }, 3);
    assert.ok(taken.ok);
    assert.equal(taken.split.id, 'talk-3');
  });

  it('shares a length set by hand out at the same pace', () => {
    const recut = JSON.stringify({ v: 1, scenes: [{ id: 'talk', dur: { was: 6, v: 12 } }] });
    const result = splitClipScene({ ...film, recut }, form, others, 2);
    assert.ok(result.ok);
    assert.deepEqual(JSON.parse(result.split.texts.recut!).scenes, [
      { id: 'talk', dur: { was: 2, v: 4 } },
      { id: 'talk-2', dur: { was: 4, v: 8 } },
    ]);
  });

  it('writes modules the film check passes', () => {
    const result = splitClipScene(film, form, others, 3);
    assert.ok(result.ok);
    const modules = { 'scene-intro.js': bare('intro'), 'scene-talk.js': result.split.texts.module, 'scene-talk-2.js': result.split.module, 'scene-end.js': bare('end') };
    assert.deepEqual(filmErrors(result.split.texts.scenes, modules), []);
  });
});

describe('video clips: adding a video', () => {
  const sequence = (values: number[]): (() => number) => {
    let at = 0;
    return () => values[at++ % values.length]!;
  };

  it('makes a fresh video- id', () => {
    const id = newVideoSceneId(() => false, sequence([0, 0.5, 0.99, 0.1, 0.2, 0.3]));
    assert.match(id!, /^video-[a-z0-9]{6}$/);
    let first = true;
    const again = newVideoSceneId((candidate) => {
      const was = first;
      first = false;
      return was && candidate !== '';
    });
    assert.match(again!, /^video-/);
    assert.equal(newVideoSceneId(() => true), null);
  });

  it('starts a blank film as a film of scenes sized to the video', () => {
    const room = addVideoRoom({ script: '', scenes: null, moduleCount: 0, assetCount: 0 });
    assert.deepEqual(room, { ok: true, longest: Math.min(MAX_ADDED_VIDEO_SECONDS, MAX_FILM_SECONDS), blank: true });
    const added = addVideoScene({ script: '', scenes: null, moduleCount: 0, assetCount: 0 }, { id: 'video-abc123', dur: 5.25, width: 1080, height: 1920, after: null })!;
    assert.equal(added.script, SCENES_CUT);
    const file = parseScenesFile(added.scenes);
    assert.ok(file.ok);
    assert.equal(file.file.width, 1080);
    assert.equal(file.file.height, 1920);
    assert.equal(file.file.fps, 30);
    assert.equal(file.file.background, '#000000');
    assert.deepEqual(file.file.scenes, [{ id: 'video-abc123', name: 'Video', dur: 5.25 }]);
    assert.equal(added.module, videoSceneModule('video-abc123'));
    assert.deepEqual(videoFilmSize(1280, 720), { width: 1920, height: 1080 });
    assert.deepEqual(videoFilmSize(4000, 10), { width: 1920, height: 16 });
  });

  it('puts the scene after the one chosen, else last, and its module is a bare clip scene', () => {
    const film = { script: SCENES_CUT, scenes: scenesText([{ id: 'a', name: 'A', dur: 2 }, { id: 'b', name: 'B', dur: 2 }]), moduleCount: 3, assetCount: 0 };
    const after = addVideoScene(film, { id: 'video-aaaaaa', dur: 3, width: 640, height: 360, after: 'a' })!;
    assert.equal(after.script, null);
    assert.equal(after.index, 1);
    assert.deepEqual(
      JSON.parse(after.scenes).scenes.map((scene: { id: string }) => scene.id),
      ['a', 'video-aaaaaa', 'b'],
    );
    assert.equal(addVideoScene(film, { id: 'video-bbbbbb', dur: 3, width: 640, height: 360, after: null })!.index, 2);
    const form = clipSceneForm(after.module, 'video-aaaaaa', mp4);
    assert.deepEqual(form, { sceneId: 'video-aaaaaa', asset: 'video-aaaaaa.mp4', from: 0, speed: 1, hasSpeed: false, bare: true });
    const modules = { 'scene-a.js': bare('a'), 'scene-b.js': bare('b'), 'scene-video-aaaaaa.js': after.module };
    assert.deepEqual(filmErrors(after.scenes, modules), []);
  });

  it('says when there is no room', () => {
    const base = { script: SCENES_CUT, moduleCount: 1, assetCount: 0 };
    const videos = scenesText(Array.from({ length: MAX_VIDEO_SCENES }, (_, index) => ({ id: `video-${String(index).padStart(6, '0')}`, dur: 1 })));
    assert.deepEqual(addVideoRoom({ ...base, scenes: videos }), { ok: false, reason: 'videos' });
    const scenes = scenesText(Array.from({ length: MAX_SCENES }, (_, index) => ({ id: `s${index}`, dur: 1 })));
    assert.deepEqual(addVideoRoom({ ...base, scenes }), { ok: false, reason: 'scenes' });
    const full = scenesText([{ id: 'a', dur: MAX_FILM_SECONDS - 0.2 }]);
    assert.deepEqual(addVideoRoom({ ...base, scenes: full }), { ok: false, reason: 'length' });
    const some = addVideoRoom({ ...base, scenes: scenesText([{ id: 'a', dur: MAX_FILM_SECONDS - 10 }]) });
    assert.deepEqual(some, { ok: true, longest: 10, blank: false });
    assert.deepEqual(addVideoRoom({ script: 'window.CUT = {}', scenes: null, moduleCount: 0, assetCount: 0 }), { ok: false, reason: 'form' });
    assert.equal(addVideoScene({ ...base, scenes: scenesText([{ id: 'a', dur: MAX_FILM_SECONDS - 10 }]) }, { id: 'video-cccccc', dur: 11, width: 1, height: 1, after: null }), null);
  });

  it('knows a video file by its first bytes', () => {
    const box = (type: string): Uint8Array => new Uint8Array([0, 0, 0, 24, ...[...type].map((char) => char.charCodeAt(0))]);
    assert.equal(looksLikeVideoFile(box('ftyp')), true);
    assert.equal(looksLikeVideoFile(box('moov')), true);
    assert.equal(looksLikeVideoFile(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), true);
    assert.equal(looksLikeVideoFile(new TextEncoder().encode('<!doctype html>')), false);
    assert.equal(looksLikeVideoFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false);
  });

  it('plans a conversion that fits, smaller at each try', () => {
    const first = videoEncodePlan({ width: 3840, height: 2160, fps: 60 }, MAX_ADDED_VIDEO_SECONDS, 0)!;
    assert.equal(first.fps, 30);
    assert.ok(Math.min(first.width, first.height) <= 1080);
    assert.ok(((first.bitrate + first.audioBitrate) * MAX_ADDED_VIDEO_SECONDS) / 8 < 20 * 1024 * 1024);
    const second = videoEncodePlan({ width: 3840, height: 2160, fps: 60 }, MAX_ADDED_VIDEO_SECONDS, 1)!;
    assert.ok(second.bitrate <= first.bitrate && second.height <= first.height);
    const small = videoEncodePlan({ width: 320, height: 240, fps: 25 }, 5, 0)!;
    assert.deepEqual([small.width, small.height, small.fps], [320, 240, 25], 'never made larger');
    assert.equal(videoEncodePlan({ width: 320, height: 240, fps: 25 }, 5, 3), null);
  });
});

describe('video clips: taking an added video back out', () => {
  const added = videoSceneModule('video-aaaaaa');
  const film = (scenes: unknown[], extra: Record<string, string> = {}, assets = ['video-aaaaaa.mp4']): VideoSceneFilm => ({
    script: SCENES_CUT,
    modules: new Map([['scenes.json', scenesText(scenes)], ['scene-video-aaaaaa.js', added], ['scene-a.js', bare('a')], ...Object.entries(extra)]),
    assets: new Set(assets),
  });
  const three = [{ id: 'a', name: 'A', dur: 2 }, { id: 'video-aaaaaa', name: 'Video', dur: 3 }, { id: 'b', name: 'B', dur: 2 }];
  const ids = (text: string): string[] => JSON.parse(text).scenes.map((scene: { id: string }) => scene.id);

  it('knows a module as the page wrote it, after a trim too, and nothing else', () => {
    assert.equal(isAddedVideoModule('video-aaaaaa', added), true);
    assert.equal(isAddedVideoModule('video-aaaaaa', withClipFrom(added, 1.25)), true);
    assert.equal(isAddedVideoModule('video-aaaaaa', added.replace('render() {}', 'render(t) { kit.stage.style.opacity = t; }')), false);
    assert.equal(isAddedVideoModule('video-bbbbbb', added), false);
    assert.equal(isAddedVideoModule('video-aaaaaa-2', withClipFrom(added, 2)), false, 'a split copy is not one');
  });

  it('takes the scene, its module and its file out, but never the only scene', () => {
    const result = removeVideoScene(film(three), 'video-aaaaaa')!;
    assert.deepEqual(ids(result.scenes), ['a', 'b']);
    assert.deepEqual(result.removed, { sceneId: 'video-aaaaaa', entry: three[1], after: 'a', index: 1, module: added, assetGone: true });
    assert.equal(removeVideoScene(film([three[1]]), 'video-aaaaaa'), null);
    assert.equal(removeVideoScene(film(three), 'a'), null, 'a scene made by hand stays');
    const shared = removeVideoScene(film(three, { 'scene-b.js': "kit.video('video-aaaaaa.mp4')" }), 'video-aaaaaa')!;
    assert.equal(shared.removed.assetGone, false, 'another scene still plays the file');
  });

  it('puts it back after the scene it followed, else where it was', () => {
    const { scenes, removed } = removeVideoScene(film(three), 'video-aaaaaa')!;
    const after = (list: unknown[]): VideoSceneFilm => {
      const now = film(list, {}, []);
      const modules = new Map(now.modules);
      modules.delete('scene-video-aaaaaa.js');
      return { ...now, modules };
    };
    assert.deepEqual(ids(restoreVideoScene(after(JSON.parse(scenes).scenes), removed)!), ['a', 'video-aaaaaa', 'b']);
    assert.deepEqual(ids(restoreVideoScene(after([{ id: 'c', dur: 1 }, three[0], three[2]]), removed)!), ['c', 'a', 'video-aaaaaa', 'b']);
    assert.deepEqual(ids(restoreVideoScene(after([three[2]]), removed)!), ['b', 'video-aaaaaa'], 'the scene before it is gone');
    assert.equal(restoreVideoBlock(film(three), removed), 'taken');
  });

  it('says when there is no room to put it back', () => {
    const { removed } = removeVideoScene(film(three), 'video-aaaaaa')!;
    const without = (list: unknown[], assets: string[] = []): VideoSceneFilm => ({ script: SCENES_CUT, modules: new Map([['scenes.json', scenesText(list)]]), assets: new Set(assets) });
    assert.equal(restoreVideoBlock(without(Array.from({ length: MAX_SCENES }, (_, index) => ({ id: `s${index}`, dur: 1 }))), removed), 'scenes');
    assert.equal(restoreVideoBlock(without([{ id: 'a', dur: MAX_FILM_SECONDS - 1 }]), removed), 'length');
    assert.equal(restoreVideoScene(without([{ id: 'a', dur: MAX_FILM_SECONDS - 1 }]), removed), null);
    assert.equal(restoreVideoBlock({ ...without([]), modules: new Map() }, removed), 'form');
    assert.equal(restoreVideoBlock(without([{ id: 'a', dur: 1 }]), removed), null);
    const crowded = without([{ id: 'a', dur: 1 }], Array.from({ length: MAX_ASSETS }, (_, index) => `f${index}.png`));
    assert.equal(restoreVideoBlock(crowded, removed), 'files', 'its file would not fit back');
  });
});
