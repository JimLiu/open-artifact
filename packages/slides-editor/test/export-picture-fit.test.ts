import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkToFit, MIN_SHRINK_BYTES, picturesShrunkNote, shrinkToFit, stepsBelow } from '../src/services/export/picture-fit.ts';

interface Picture {
  name: string;
  bytes: number;
  uses: number;
}

const KB = 1024;

/** An encoder that makes each picture `ratio[step]` of its size, recording what it was asked. */
function encoder(ratio: number[], refuse: string[] = []) {
  const asked: string[] = [];
  const encode = async (picture: Picture, step: number) => {
    asked.push(`${picture.name}@${step}`);
    return refuse.includes(picture.name) ? null : { bytes: Math.round(picture.bytes * ratio[step]!) };
  };
  return { asked, encode };
}

describe('the steps a web page can shrink pictures through', () => {
  it('are every step for pictures as they are, else the ones below the start', () => {
    assert.deepEqual(stepsBelow(null, 3), [0, 1, 2]);
    assert.deepEqual(stepsBelow(1, 3), [2]);
    assert.deepEqual(stepsBelow(2, 3), []);
  });
});

describe('shrinking pictures until the page fits', () => {
  const big = { name: 'big', bytes: 1000 * KB, uses: 1 };
  const twice = { name: 'twice', bytes: 600 * KB, uses: 2 };
  const small = { name: 'small', bytes: 300 * KB, uses: 1 };
  const tiny = { name: 'tiny', bytes: MIN_SHRINK_BYTES - 1, uses: 5 };

  it('changes nothing when the page already fits', async () => {
    const { asked, encode } = encoder([0.5]);
    assert.deepEqual(await shrinkToFit([big], [0], 0, encode), new Map());
    assert.deepEqual(asked, []);
  });

  it('goes from the picture taking the most room, and stops once enough is saved', async () => {
    const { asked, encode } = encoder([0.5, 0.25, 0.1]);
    // twice takes 1200 KB of the page, big 1000 KB: twice first saves 600 KB.
    const kept = await shrinkToFit([small, big, twice], [0, 1, 2], 500 * KB, encode);
    assert.deepEqual(asked, ['twice@0']);
    assert.deepEqual([...kept!.keys()], [twice]);
    assert.equal(kept!.get(twice)!.bytes, 300 * KB);
  });

  it('runs through a step before going to the next, keeping the smallest encoding', async () => {
    const { asked, encode } = encoder([0.5, 0.25, 0.1]);
    // Step 0 saves 600 + 500 + 150 KB; step 1 starts again from the largest.
    const kept = await shrinkToFit([small, big, twice], [0, 1, 2], 1400 * KB, encode);
    assert.deepEqual(asked, ['twice@0', 'big@0', 'small@0', 'twice@1']);
    assert.equal(kept!.get(twice)!.bytes, 150 * KB);
    assert.equal(kept!.get(big)!.bytes, 500 * KB);
  });

  it('starts at the step given (a lower quality only shrinks further)', async () => {
    const { asked, encode } = encoder([0.5, 0.25, 0.1]);
    await shrinkToFit([big], [2], 100 * KB, encode);
    assert.deepEqual(asked, ['big@2']);
  });

  it('leaves small pictures and ones that do not get smaller alone', async () => {
    const { asked, encode } = encoder([1.2, 0.5], ['small']);
    const kept = await shrinkToFit([tiny, small, big], [0, 1], 400 * KB, encode);
    assert.ok(!asked.some((name) => name.startsWith('tiny')));
    assert.deepEqual([...kept!.keys()], [big]);
  });

  it('gives up without changes when every step cannot save enough', async () => {
    const { encode } = encoder([0.9, 0.8]);
    assert.equal(await shrinkToFit([big], [0, 1], 900 * KB, encode), null);
  });
});

describe('linking files when shrinking cannot fit the page', () => {
  const files = [
    { name: 'a', bytes: 100, uses: 1 },
    { name: 'b', bytes: 400, uses: 1 },
    { name: 'c', bytes: 150, uses: 2 },
  ];

  it('links the files taking the most room until enough is saved', () => {
    assert.deepEqual(
      linkToFit(files, 350, () => 10).map((file) => file.name),
      ['b'],
    );
    assert.deepEqual(
      linkToFit(files, 500, () => 10).map((file) => file.name),
      ['b', 'c'],
    );
  });

  it('links nothing when the page fits, every file when it never does', () => {
    assert.deepEqual(linkToFit(files, 0, () => 10), []);
    assert.equal(linkToFit(files, 10_000, () => 10).length, 3);
  });
});

describe('the note about smaller pictures', () => {
  it('counts the pictures', () => {
    assert.equal(picturesShrunkNote(1), '1 picture was made smaller so the file fits the 200 MB download limit.');
    assert.equal(picturesShrunkNote(3), '3 pictures were made smaller so the file fits the 200 MB download limit.');
  });
});
