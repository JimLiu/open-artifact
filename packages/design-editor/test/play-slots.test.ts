import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claimSlot, NO_SLOTS, playAnnouncement, releaseSlot, slotLimitMessage } from '../src/lib/play-slots.ts';

describe('video play slots', () => {
  it('lets four play and lines up the rest', () => {
    let slots = NO_SLOTS;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) slots = claimSlot(slots, id);
    assert.deepEqual(slots, { playing: ['a', 'b', 'c', 'd'], waiting: ['e', 'f'] });
    assert.equal(claimSlot(slots, 'a'), slots, 'asking again changes nothing');
  });

  it('hands a freed slot to the first in line', () => {
    let slots = NO_SLOTS;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) slots = claimSlot(slots, id);
    slots = releaseSlot(slots, 'b');
    assert.deepEqual(slots, { playing: ['a', 'c', 'd', 'e'], waiting: ['f'] });
    slots = releaseSlot(slots, 'f');
    assert.deepEqual(slots, { playing: ['a', 'c', 'd', 'e'], waiting: [] });
    assert.equal(releaseSlot(slots, 'zz'), slots);
  });

  it('says why a video waits, and what it is doing', () => {
    assert.equal(slotLimitMessage(), 'Only 4 videos play at once on a page. This one starts when another is deleted or leaves view.');
    assert.equal(slotLimitMessage(1), 'Only 1 video plays at once on a page. This one starts when another is deleted or leaves view.');
    assert.equal(playAnnouncement('Playing', 'Demo'), 'Playing Demo.');
    assert.equal(playAnnouncement('Paused', ''), 'Paused video.');
    assert.equal(playAnnouncement('Stopped', undefined), 'Stopped video.');
  });
});
