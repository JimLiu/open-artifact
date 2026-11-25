/** A site type page's address (`https://<site>/t/<id>`): what `types install` reads as one, and what it fetches as a file. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteTypePageOf, siteTypePagePath } from '../src/link.ts';

test('a type page address is its origin and id; anything else is not one', () => {
  assert.deepEqual(siteTypePageOf('https://oa.example.com/t/trip-planner'), { origin: 'https://oa.example.com', id: 'trip-planner' });
  assert.deepEqual(siteTypePageOf('http://localhost:8080/t/poll.v2/'), { origin: 'http://localhost:8080', id: 'poll.v2' });
  for (const address of [
    'https://oa.example.com/t/trip-planner-1.2.0.oatype',
    'https://oa.example.com/t/trip.zip',
    'https://oa.example.com/t/a/b',
    'https://oa.example.com/t/',
    'https://oa.example.com/t/x?y=1',
    'https://oa.example.com/t/x#y',
    'https://me:pw@oa.example.com/t/x',
    'ftp://oa.example.com/t/x',
    'https://oa.example.com/a/x',
    'not an address',
  ]) {
    assert.equal(siteTypePageOf(address), null, address);
  }
  assert.equal(siteTypePagePath('trip-planner'), '/t/trip-planner');
});
