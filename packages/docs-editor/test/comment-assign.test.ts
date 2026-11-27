import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommentMessage, CommentThread } from '@open-artifact/runtime';
import {
  UNASSIGNED_TEXT,
  assignCandidates,
  assignNoteText,
  assignNotes,
  assignSteps,
  assignText,
  assignedLabel,
  assigneeOf,
  assignmentIn,
} from '../src/comments/assign.ts';
import { judgeComment } from '../src/comments/judge.ts';

let next = 0;
const person = (name: string, text: string, to?: string[]): CommentMessage => ({
  id: `m${next++}`,
  author: { kind: 'person', name },
  text,
  at: '2026-01-01T00:00:00Z',
  ...(to ? { to } : {}),
});
const agent = (text: string): CommentMessage => ({ id: `m${next++}`, author: { kind: 'agent', name: 'Agent' }, text, at: '2026-01-01T00:00:00Z' });
const thread = (messages: CommentMessage[], status?: 'replied'): CommentThread => ({
  id: 'c1',
  anchor: '{}',
  label: 'Intro',
  location: {},
  status: 'open',
  ...(status ? { agent: { status } } : {}),
  messages,
});
/** The reply that assigns `to`, as the card sends it. */
const assign = (by: string, to: string | null, from: string | null = null): CommentMessage => person(by, assignText(to, from), to === null ? undefined : [to]);

describe('assigning a comment', () => {
  it('says what changed, and names the new assignee', () => {
    assert.equal(assignText('Ana', null), 'Assigned to @Ana');
    assert.equal(assignText('Ana', 'Bo Li'), 'Reassigned from @Bo Li to @Ana');
    assert.equal(assignText(null, 'Ana'), UNASSIGNED_TEXT);
    assert.deepEqual(assignmentIn(assign('Ana', 'Bo')), { to: 'Bo', worded: true });
    assert.deepEqual(assignmentIn(assign('Ana', 'Cy', 'Bo Li')), { to: 'Cy', from: 'Bo Li', worded: true });
    assert.deepEqual(assignmentIn(assign('Ana', null)), { to: null, worded: true });
  });

  it('takes `assignee` for what a message changes, and draws it as a note only when its words are an assignment', () => {
    const withField = (message: CommentMessage, assignee: string | null): CommentMessage => ({ ...message, assignee });
    assert.deepEqual(assignmentIn(withField(person('Ana', 'Please look, @Bo', ['Bo']), 'Bo')), { to: 'Bo', worded: false });
    assert.deepEqual(assignmentIn(withField(assign('Ana', 'Bo'), 'Bo')), { to: 'Bo', worded: true });
    assert.deepEqual(assignmentIn(withField(assign('Ana', null), null)), { to: null, worded: true });
    // The words name someone else: the field wins, and it is a message.
    assert.deepEqual(assignmentIn(withField(person('Ana', 'Assigned to @Cy', ['Cy']), 'Bo')), { to: 'Bo', worded: false });

    const first = withField(person('Ana', 'Fix the intro, @Bo', ['Bo']), 'Bo');
    const root = thread([first]);
    assert.equal(assigneeOf(root), 'Bo', 'a thread assigned as it starts');
    assert.deepEqual([...assignNotes(root)], []);
    const reply = withField(person('Bo', 'Over to you, @Cy', ['Cy']), 'Cy');
    const off = withField(assign('Cy', null), null);
    const notes = assignNotes(thread([first, reply, off]));
    assert.deepEqual([...notes], [off.id]);
    assert.equal(assigneeOf(thread([first, reply])), 'Cy');
    assert.equal(assigneeOf(thread([first, reply, off])), null);
  });

  it('takes only the words it writes, with the one person they name, for an assignment', () => {
    assert.equal(assignmentIn(person('Ana', 'Assigned to @Bo')), null, 'no one named');
    assert.equal(assignmentIn(person('Ana', 'Assigned to @Bo', ['Bo', 'Cy'])), null, 'two named');
    assert.equal(assignmentIn(person('Ana', 'Assigned to @Bo, please look', ['Bo'])), null, 'more words');
    assert.equal(assignmentIn(person('Ana', 'Assigned to @agent', ['agent'])), null, 'never the agent');
    assert.equal(assignmentIn(person('Ana', UNASSIGNED_TEXT, ['Bo'])), null);
    assert.equal(assignmentIn(agent(UNASSIGNED_TEXT)), null, 'only people assign');
  });

  it('follows the thread to who has it now', () => {
    const one = thread([person('Ana', 'Fix the intro'), assign('Ana', 'Bo')]);
    assert.equal(assigneeOf(one), 'Bo');
    const two = thread([...one.messages, assign('Bo', 'Cy', 'Bo')]);
    assert.equal(assigneeOf(two), 'Cy');
    assert.equal(assigneeOf(thread([...two.messages, assign('Cy', null)])), null);
    assert.equal(assigneeOf(thread([person('Ana', 'Fix the intro')])), null);
  });

  it('draws as notes only the assignments that agree with the thread so far', () => {
    const first = person('Ana', 'Fix the intro');
    const toBo = assign('Ana', 'Bo');
    const wrongFrom = assign('Ana', 'Cy', 'Dee');
    const off = assign('Ana', null);
    const offAgain = assign('Ana', null);
    const notes = assignNotes(thread([first, toBo, wrongFrom, off, offAgain]));
    assert.deepEqual([...notes], [toBo.id, off.id]);
    // The one that did not agree still hands the thread on.
    assert.equal(assigneeOf(thread([first, toBo, wrongFrom])), 'Cy');
  });

  it('says each note from where the viewer stands', () => {
    const steps = assignSteps(thread([person('Ana', 'Fix it'), assign('Ana', 'Bo'), assign('Bo', null), assign('Ana', 'Ana'), assign('Ana', null)]));
    const said = (me: string) => steps.filter(step => step.note).map(step => assignNoteText(step, me));
    assert.deepEqual(said('Cy'), ['Ana assigned Bo', 'Bo is no longer assigned', 'Ana took this on', 'Ana is no longer assigned']);
    assert.deepEqual(said('Bo'), ['Ana assigned you', 'You are no longer assigned', 'Ana took this on', 'Ana is no longer assigned']);
    const byOther = assignSteps(thread([person('Ana', 'Fix it'), assign('Ana', 'Bo'), assign('Cy', null)])).filter(step => step.note);
    assert.equal(assignNoteText(byOther[1]!, 'Bo'), 'Cy unassigned you');
    assert.equal(assignedLabel('Bo', 'Bo'), 'Assigned to you');
    assert.equal(assignedLabel('Bo', 'Ana'), 'Assigned to Bo');
  });

  it('offers the viewer, the thread, then the others, at most eight, keeping who has it', () => {
    const talk = thread([person('Ana', 'Fix it'), agent('Done?'), person('Bo', 'Not yet')]);
    assert.deepEqual(assignCandidates({ me: 'Cy', thread: talk, listed: ['Bo', 'Dee', 'agent'], current: null }), ['Cy', 'Ana', 'Bo', 'Dee']);
    const many = Array.from({ length: 10 }, (_, index) => `P${index}`);
    const offered = assignCandidates({ me: 'Cy', thread: talk, listed: many, current: 'P9' });
    assert.equal(offered.length, 8);
    assert.equal(offered[7], 'P9');
    assert.deepEqual(offered.slice(0, 3), ['Cy', 'Ana', 'Bo']);
  });

  it('is no one talking, for the agent judging a reply', () => {
    const talk = [person('Ana', '@Agent tighten this', ['agent']), agent('Cut it to two sentences.')];
    const reply = person('Ana', 'Make it punchier');
    assert.equal(judgeComment({ thread: thread([...talk, assign('Bo', 'Ana'), reply], 'replied'), to: [] }).choice, 'wake');
    assert.equal(judgeComment({ thread: thread([...talk, person('Bo', 'I disagree'), reply], 'replied'), to: [] }).choice, 'nothing');
  });
});
