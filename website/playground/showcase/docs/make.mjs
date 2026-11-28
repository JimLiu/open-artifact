#!/usr/bin/env node
// Makes the docs showcase: Juniper Coffee's spring launch brief, a doc of three tabs.
//
// What the doc says is written here once, as the calls an agent makes (`STEPS`: the outline with its pending sections,
// then one `update` a section), and this script runs them through the real Docs host (the playground's own bundle of
// it, `src/engines/bundles/docHost.js`) over an empty doc of three tabs (`SKELETON`). It writes:
//
//   showcase/docs/doc/…        the doc those calls end with: the plain demo's seed
//   demos/docs.demo.json       the demo: the same calls as its replay's steps (so a replay ends with the same doc),
//                              the simulated agent's responses and the replay's comment
//
//   node website/playground/showcase/docs/make.mjs && node website/playground/scripts/make-seeds.mjs docs
//
// The agent's ids come from the counter of the CLI session in `doc/.sessions.json`, so the same calls over the same
// skeleton make the same ids every time: the steps name the pending blocks they fill, and the agent's responses the
// blocks they write beside, by the ids this run found. This file is not part of the artifact (the demo `omit`s it).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND = path.resolve(HERE, '..', '..');
const REPO = path.resolve(PLAYGROUND, '..', '..');

// The empty doc the replay starts from: its three tabs and its two dropdown lists, nothing written yet. Made once with
// the type's own CLI and kept, so every id stays the same from run to run:
//
//   open-artifact create <folder> '{"name": "First Light: spring launch brief", "doc": {"markdown": ""}, "batch": [
//     {"$lid": "review", "verb": "create", "object": "enum", "payload": {"name": "Review", "options": [
//       {"name": "Draft", "color": "gray"}, {"name": "In review", "color": "pencil"}, {"name": "Approved", "color": "olive"}]}},
//     {"$lid": "status", "verb": "create", "object": "enum", "payload": {"name": "Status", "options": [
//       {"name": "Not started", "color": "gray"}, {"name": "On track", "color": "olive"}, {"name": "At risk", "color": "poppy"}, {"name": "Done", "color": "sky"}]}},
//     {"$lid": "t", "verb": "create", "object": "file", "payload": {"name": "Launch checklist"}},
//     {"$lid": "q", "verb": "create", "object": "file", "payload": {"name": "FAQ"}},
//     {"verb": "update", "ref": {"object": "project", "id": "$lid:p"}, "payload": {"kind": "patch", "patch": [
//       {"op": "set", "path": ["tabs", "$lid:f", "name"], "value": "Brief"}]}}]}'
const SESSION = 'kr0483lpxzq';
const TABS = { brief: '2fb9c8f9-9f88', checklist: '40d54ab0-8945', faq: 'dc147e4d-abeb' };
const REVIEW = 'f80bdb80-166f';
const STATUS = '690af4c5-c745';
const SKELETON = {
  'doc/doc.json': {
    format: 'open-artifact-docs',
    version: 1,
    id: 'd4a9c9d7-f848-4b99-84b3-429cfa02586f',
    name: 'First Light: spring launch brief',
    created: '2026-11-27T08:25:45.904Z',
    updated: '2026-11-27T08:25:45.909Z',
    head: 6,
    tabs: {
      [TABS.brief]: { name: 'Brief', order: 'V', node: '4eae0eff-8043' },
      [TABS.checklist]: { name: 'Launch checklist', order: 'k', node: '0c593cc2-574f' },
      [TABS.faq]: { name: 'FAQ', order: 'r', node: '04c842f9-db66' },
    },
    enums: {
      [REVIEW]: { name: 'Review', options: [{ name: 'Draft', order: 0, color: 'gray' }, { name: 'In review', order: 1, color: 'pencil' }, { name: 'Approved', order: 2, color: 'olive' }] },
      [STATUS]: {
        name: 'Status',
        options: [{ name: 'Not started', order: 0, color: 'gray' }, { name: 'On track', order: 1, color: 'olive' }, { name: 'At risk', order: 2, color: 'poppy' }, { name: 'Done', order: 3, color: 'sky' }],
      },
    },
  },
  'doc/.sessions.json': { sessions: { [SESSION]: { next: 3, kind: 'cli', created: '2026-11-27T08:25:45.905Z' } }, cli: SESSION },
  [`doc/tabs/${TABS.brief}.json`]: { rev: 1, blocks: [{ id: `${SESSION}.0`, type: 'paragraph', inline: [] }] },
  [`doc/tabs/${TABS.checklist}.json`]: { rev: 1, blocks: [{ id: `${SESSION}.1`, type: 'paragraph', inline: [] }] },
  [`doc/tabs/${TABS.faq}.json`]: { rev: 1, blocks: [{ id: `${SESSION}.2`, type: 'paragraph', inline: [] }] },
};

// ---- chips ----

const date = (value) => ({ type: 'date', value });
const status = (index) => ({ type: 'dropdown', enum: STATUS, index });
const NOT_STARTED = 0;
const ON_TRACK = 1;
const AT_RISK = 2;
const DONE = 3;
const tab = (id) => ({ type: 'mention', ref: `file/${id}` });
const me = { type: 'mention', user: 'me' };
const pending = (intent) => ({ type: 'pending', intent });
const md = (...lines) => lines.join('\n');

// ---- the doc, as the agent writes it ----

/** The comment of the replay is on these words of the summary; the agent's first response writes under their paragraph. */
const COMMENT_ON = 'what a good launch looks like';
const SUMMARY_STARTS = 'On Wednesday, April 14';

const OUTLINE = {
  markdown: md(
    '# First Light: spring launch brief',
    '',
    'Last updated <?oa block asof?> · Owner <?oa block me?> · <?oa block review?>',
    '',
    '```toc',
    '```',
    '',
    '<?oa block summary?>',
    '',
    '## Goals',
    '',
    '<?oa block goals?>',
    '',
    '## What ships',
    '',
    '<?oa block ships?>',
    '',
    '## Timeline',
    '',
    '<?oa block timeline?>',
    '',
    '## How the two launches connect',
    '',
    '<?oa block connect?>',
    '',
    '## Risks',
    '',
    '<?oa block risks?>',
    '',
    '## Open questions',
    '',
    '<?oa block questions?>',
  ),
  blocks: {
    asof: date('2027-03-08'),
    me,
    review: { type: 'dropdown', enum: REVIEW, index: 1 },
    summary: pending('Summary: what ships, when, and what this brief is for'),
    goals: pending('The three things this launch is for'),
    ships: pending('A table: each thing that ships, its owner and its status'),
    timeline: pending('The dates from roast lock to pop-up week, with owners'),
    connect: pending('A diagram: how the bag leads people into the app'),
    risks: pending('The one date we do not control, and the other risks'),
    questions: pending('What is still undecided, and who decides'),
  },
};

const SUMMARY = {
  markdown: md(
    `On **Wednesday, April 14**, Juniper ships two things on the same morning: **First Light**, our spring seasonal blend, and the **Juniper app** for iPhone and Android. This brief is the one place for what ships, who owns each piece, and ${COMMENT_ON}.`,
    '',
    'The day-by-day list is in <?oa block checklist?>, and what we tell customers is in <?oa block faq?>.',
  ),
  blocks: { checklist: tab(TABS.checklist), faq: tab(TABS.faq) },
};

const GOALS = {
  markdown: md(
    '1. **Grow the base.** A seasonal blend should bring in subscriptions, not one-off bags.',
    '2. **Move people into the app.** Skipping or moving a delivery should take two taps, not an email to support.',
    '3. **Keep the promise.** Three days from the roaster to the doorstep, launch week included.',
  ),
};

const SHIPS = {
  markdown: md(
    '| What | In one line | Owner | Status |',
    '|---|---|---|---|',
    '| **First Light** | A light roast of Ethiopia Guji and Colombia Huila: apricot, jasmine, wildflower honey. 340 g, $19, in every box through June. | Dana · Roastery | <?oa block s1?> |',
    '| **Juniper app** | Skip, pause or move a delivery in two taps, a brew guide with a timer for every bag, roast-day and delivery alerts. | Priya · Product | <?oa block s2?> |',
    '| **Code on the bag** | Every First Light bag carries a code that opens its brew guide in the app. | Dana · Roastery | <?oa block s3?> |',
    '| **Support playbook** | Answers and reply templates for launch week. | Leo · Customer care | <?oa block s4?> |',
    '',
    '> “It tastes like the first warm morning of the year. I ordered a second bag before I finished the first cup.”',
    '>',
    '> Maya Okafor, tasting panel, subscriber since 2024',
    '',
    'Of the 60 subscribers on the tasting panel in February, 51 asked when they could buy it.',
  ),
  blocks: { s1: status(ON_TRACK), s2: status(AT_RISK), s3: status(ON_TRACK), s4: status(NOT_STARTED) },
};

const TIMELINE = {
  markdown: md(
    '| When | Milestone | Owner | Status |',
    '|---|---|---|---|',
    '| <?oa block d1?> | Roast locked, green coffee in for 6,000 bags | Dana | <?oa block t1?> |',
    '| <?oa block d2?> | Press kits out: 40 tasting kits to writers and cafe partners | Mina | <?oa block t2?> |',
    '| <?oa block d3?> | App submitted to both stores | Priya | <?oa block t3?> |',
    '| <?oa block d4?> | App beta opens to 500 subscribers | Priya | <?oa block t4?> |',
    '| <?oa block d5?> | Support team briefed | Leo | <?oa block t5?> |',
    '| <?oa block d6?> | **Launch day:** First Light ships, the app goes live | Everyone | <?oa block t6?> |',
    '| <?oa block d7?> | Pop-up week begins: tasting bars in three cities | Mina | <?oa block t7?> |',
  ),
  blocks: {
    d1: date('2027-03-03'),
    d2: date('2027-03-17'),
    d3: date('2027-03-24'),
    d4: date('2027-03-31'),
    d5: date('2027-04-07'),
    d6: date('2027-04-14'),
    d7: date('2027-04-19'),
    t1: status(DONE),
    t2: status(ON_TRACK),
    t3: status(AT_RISK),
    t4: status(NOT_STARTED),
    t5: status(NOT_STARTED),
    t6: status(ON_TRACK),
    t7: status(NOT_STARTED),
  },
};

const CONNECT = {
  markdown: md(
    'The blend gives people a reason to open the box; the app gives them a reason to stay. The code on the bag ties the two together.',
    '',
    '```mermaid',
    'flowchart LR',
    '    box([First Light in the box]) --> code[Code on the bag]',
    '    code --> guide[Brew guide in the app]',
    '    guide --> account[Signed in]',
    '    account --> stay([Skip, pause or gift in two taps])',
    '```',
  ),
};

const RISKS = {
  markdown: md(
    '> ⚠️ **App store review is the one date we do not control.** Submitting by March 24 keeps a three-week buffer. If review slips past April 7, the blend still ships on the 14th and the app follows.',
    '',
    '| Risk | How likely | What we do |',
    '|---|---|---|',
    '| Store review takes longer than two weeks | <span data-text-color="red">**High**</span> | Submit by March 24 and keep the launch email free of app screenshots until approval. |',
    '| Launch week doubles the support inbox | <span data-text-color="yellow">**Medium**</span> | Brief the team on April 7 and load the reply templates first. |',
    '| Green coffee runs short after 6,000 bags | <span data-text-color="green">**Low**</span> | A second lot from Huila is on hold until March 20. |',
  ),
};

const QUESTIONS = {
  markdown: md(
    '- Do gift subscriptions get First Light in their first box, or the house blend? *Dana decides.*',
    '- Is the bag code single-use, or can a household share it? *Priya decides.*',
    '- Who answers the press on launch morning? <?oa block owner?> decides by <?oa block by?>.',
  ),
  blocks: { owner: me, by: date('2027-03-15') },
};

const CHECKLIST = {
  markdown: md(
    '# Launch checklist',
    '',
    'Everything that has to be true before First Light ships on <?oa block launch?>. Tick a box when it is done; the owner is in bold.',
    '',
    '## Blend',
    '',
    '- [x] **Dana** Lock the roast profile',
    '- [x] **Dana** Bring in green coffee for 6,000 bags',
    '- [ ] **Dana** Sign off the bag artwork, code panel included',
    '- [ ] **Dana** Roast and pack the first 2,000 bags by <?oa block pack?>',
    '',
    '## App',
    '',
    '- [x] **Priya** Freeze features',
    '- [ ] **Priya** Submit to both stores by <?oa block submit?>',
    '- [ ] **Priya** Open the beta to 500 subscribers on <?oa block beta?>',
    '- [ ] **Priya** Try the bag code on ten real bags',
    '',
    '## Customers',
    '',
    '- [x] **Mina** Pick the 40 writers and cafe partners for press kits',
    '- [ ] **Mina** Send the press kits on <?oa block kits?>',
    '- [ ] **Leo** Brief the support team by <?oa block brief?>',
    '- [ ] **Leo** Load the reply templates from <?oa block faq?>',
    '- [ ] **Mina** Schedule the launch email for 7:00 on launch day',
    '',
    '## Launch morning',
    '',
    '1. **6:00** Dana confirms the first boxes have left the roastery.',
    '2. **7:00** The launch email goes to all 4,180 subscribers.',
    '3. **7:30** Priya releases the app in both stores.',
    '4. **9:00** Leo opens the launch inbox. First stand-up at noon.',
    '',
    '## Follow-ups from review',
    '',
    '- [ ] **Dana** Confirm what gift subscriptions get in their first box',
  ),
  blocks: {
    launch: date('2027-04-14'),
    pack: date('2027-04-09'),
    submit: date('2027-03-24'),
    beta: date('2027-03-31'),
    kits: date('2027-03-17'),
    brief: date('2027-04-07'),
    faq: tab(TABS.faq),
  },
};

const FAQ = {
  markdown: md(
    '# FAQ',
    '',
    'For the support team in launch week. The answers are written to be pasted: change the greeting, keep the facts. Dates and owners are in <?oa block brief?>.',
    '',
    '## First Light',
    '',
    '### What does it taste like?',
    '',
    'Apricot, jasmine and wildflower honey. It is a light roast of two washed coffees, Ethiopia Guji and Colombia Huila, made for filter and pour-over.',
    '',
    '### How should I brew it?',
    '',
    '| Method | Coffee | Water | Time |',
    '|---|---|---|---|',
    '| Pour-over | 20 g, medium-fine | 320 g at 94 °C | 3:00 |',
    '| French press | 30 g, coarse | 500 g at 94 °C | 4:00 |',
    '| AeroPress | 15 g, fine | 230 g at 90 °C | 1:45 |',
    '',
    'The same recipes are in the app, with a timer: the code on the bag opens them.',
    '',
    '### How long is it around?',
    '',
    'It is in every box through June, and $19 for a 340 g bag on its own.',
    '',
    '## The app',
    '',
    '### Do I need the app to keep my subscription?',
    '',
    'No. Everything still works by email and on the website. The app makes it faster: skip, pause or move a delivery in two taps.',
    '',
    '### The code on my bag does not work',
    '',
    '1. Type the code as printed, dashes included. It looks like `FL-7K2Q-9M`.',
    '2. Update the app to version 1.0.2 or later.',
    '3. Still stuck? Reply with a photo of the code panel and we open the guide by hand.',
    '',
    '## Reply template',
    '',
    '```plain',
    'Hi {first name},',
    '',
    'Thanks for writing in about First Light. {answer}',
    '',
    'If anything else comes up, reply here: launch week has a team on this inbox every day from 9 to 6.',
    '',
    '{your name}, Juniper Coffee',
    '```',
  ),
  blocks: { brief: tab(TABS.brief) },
};

const fill = (key, source) => ({ op: 'replace', target: { kind: 'blocks', ids: [`$${key}`] }, source });
const first = (n, source) => ({ op: 'replace', target: { kind: 'blocks', ids: [`${SESSION}.${n}`] }, force: true, source });

/** The replay's steps: what the session shows, how long it takes, and the calls (`tab`, `ops`). `$key`: the id an earlier call gave that chip. */
const STEPS = [
  { say: "Read the docs type's guide", ms: 600 },
  { say: 'Artifact · call create (the outline, 3 tabs)', ms: 1100, calls: [{ tab: 'Brief', ops: [first(0, OUTLINE)] }] },
  { say: 'Artifact · call update “Brief” (summary, goals)', ms: 1200, calls: [{ tab: 'Brief', ops: [fill('summary', SUMMARY)] }, { tab: 'Brief', ops: [fill('goals', GOALS)] }] },
  { say: 'Artifact · call update “Brief” (what ships)', ms: 1000, calls: [{ tab: 'Brief', ops: [fill('ships', SHIPS)] }] },
  { say: 'Artifact · call update “Brief” (timeline, diagram)', ms: 1200, calls: [{ tab: 'Brief', ops: [fill('timeline', TIMELINE)] }, { tab: 'Brief', ops: [fill('connect', CONNECT)] }] },
  { say: 'Artifact · call update “Brief” (risks, open questions)', ms: 1100, calls: [{ tab: 'Brief', ops: [fill('risks', RISKS), fill('questions', QUESTIONS)] }] },
  { say: 'Artifact · call update “Launch checklist”, “FAQ”', ms: 1100, calls: [{ tab: 'Launch checklist', ops: [first(1, CHECKLIST)] }, { tab: 'FAQ', ops: [first(2, FAQ)] }] },
  { say: 'Artifact · call check', ms: 700 },
];

// ---- running it ----

const { createDocCapability } = await import(pathToFileURL(path.join(PLAYGROUND, 'src', 'engines', 'bundles', 'docHost.js')).href);
const start = Object.fromEntries(Object.entries(SKELETON).map(([file, value]) => [file, `${JSON.stringify(value, null, 2)}\n`]));
// The owner is the playground's visitor (`src/provider/store.ts`, PERSON): the “me” chips name them.
const doc = createDocCapability({ ...start }, { owner: { id: 'demo-visitor', name: 'You' }, log: () => undefined });
const tabNamed = (name) => doc.host.project().files.find((file) => file.name === name);

const keys = {};
/** `value` with every `$key` id replaced by the id that chip got. */
const resolved = (value) => {
  if (typeof value === 'string') {
    if (!value.startsWith('$')) return value;
    const id = keys[value.slice(1)];
    if (!id) throw new Error(`no chip ${value} yet`);
    return id;
  }
  if (Array.isArray(value)) return value.map(resolved);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'source' ? v : resolved(v)]));
  return value;
};

const steps = STEPS.map(({ say, ms, calls }) => {
  const edits = (calls ?? []).map((call) => {
    const ops = resolved(call.ops);
    const outcome = doc.host.agentCall({ tool: 'update', ref: { object: 'node', id: tabNamed(call.tab).content.id }, payload: { ops } });
    if (outcome.status !== 200) throw new Error(`${say}: the doc refused ${JSON.stringify(outcome.body)}`);
    Object.assign(keys, outcome.body.keys ?? {});
    return { kind: 'doc-ops', tab: call.tab, ops };
  });
  return { say, ms, ...(edits.length ? { edits } : {}) };
});

/** The blocks of a tab, as its file has them. */
const blocksOf = (name) => JSON.parse(new TextDecoder().decode(doc.files()[`doc/tabs/${tabNamed(name).id}.json`])).blocks;
const textOf = (block) => (block.inline ?? []).map((item) => item.text ?? '').join('');
/** The top-level block right after the heading `words`. */
const under = (name, words) => {
  const blocks = blocksOf(name);
  const at = blocks.findIndex((block) => block.attrs?.heading && textOf(block) === words);
  if (at < 0 || !blocks[at + 1]) throw new Error(`no block under “${words}” in ${name}`);
  return blocks[at + 1];
};
const summary = blocksOf('Brief').find((block) => textOf(block).startsWith(SUMMARY_STARTS));
if (!summary || !textOf(summary).includes(COMMENT_ON)) throw new Error('the summary lost the words the comment is on');
const followUps = under('Launch checklist', 'Follow-ups from review');
if (followUps.type !== 'list') throw new Error('“Follow-ups from review” has no list under it');

// ---- the doc's files ----

const out = path.join(HERE, 'doc');
fs.rmSync(out, { recursive: true, force: true });
const files = doc.files();
for (const [file, bytes] of Object.entries(files)) {
  // The versions are this run's own, as a doc folder's .gitignore leaves them out of git.
  if (!file.startsWith('doc/') || file.startsWith('doc/history/')) continue;
  const to = path.join(HERE, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, bytes);
}

// ---- the demo ----

const GOOD_LAUNCH = 'A good launch, by June 30:';
const demo = {
  id: 'docs',
  type: 'docs',
  typeTitle: 'Docs',
  title: SKELETON['doc/doc.json'].name,
  source: 'website/playground/showcase/docs',
  omit: ['make.mjs'],
  agent: {
    name: 'Agent',
    thinkMs: 2500,
    responses: [
      {
        reply: {
          en: `Done. Under the summary of “{{tab}}” there is now a panel that says what a good launch looks like by June 30: 5,000 active subscriptions, half of them signed in to the app, and three-day delivery held through launch week.`,
          zh: `改好了。“{{tab}}”的摘要下面多了一个提示框，写明到 6 月 30 日怎样才算发布成功：5,000 个活跃订阅，其中一半登录了 App，发布周也守住三天送达。`,
        },
        edits: [
          {
            kind: 'doc-ops',
            tab: 'Brief',
            ops: [
              {
                op: 'insert',
                target: { kind: 'blocks', ids: [summary.id] },
                side: 'after',
                source: { markdown: `> ✅ **${GOOD_LAUNCH}** ==5,000 active subscriptions==, up from 4,180 today, half of them signed in to the app, and three-day delivery held through launch week.` },
              },
            ],
          },
        ],
      },
      {
        reply: {
          en: 'I pinned “{{request}}” as a review note at the top of “{{tab}}”, right under the summary, so it is settled before the brief is approved.',
          zh: '我把“{{request}}”作为评审备注钉在“{{tab}}”顶部、摘要的正下方，简报批准之前要先把它定下来。',
        },
        edits: [
          {
            kind: 'doc-ops',
            tab: 'Brief',
            ops: [{ op: 'insert', target: { kind: 'blocks', ids: [summary.id] }, side: 'after', source: { markdown: '> ℹ️ **Review note:** {{request}}' } }],
          },
        ],
      },
      {
        reply: {
          en: 'That one needs an owner, so I added “{{request}}” as a task under “Follow-ups from review” on the “{{tab}}” tab.',
          zh: '这件事得有人负责，所以我把“{{request}}”加成了一项任务，放在“{{tab}}”标签页的“Follow-ups from review”下面。',
        },
        edits: [
          {
            kind: 'doc-ops',
            tab: 'Launch checklist',
            ops: [{ op: 'insert', target: { kind: 'blocks', ids: [followUps.id] }, side: 'end', source: { markdown: '- [ ] **You** {{request}}' } }],
          },
        ],
      },
    ],
  },
  replay: {
    prompt: {
      en: '/open-artifact docs a launch brief for First Light, our spring blend, and the Juniper app: goals, what ships, timeline, risks, plus tabs for the launch checklist and a support FAQ',
      zh: '/open-artifact docs 给春季拼配 First Light 和 Juniper App 写一份发布简报：目标、发布内容、时间表、风险，再加上发布清单和客服 FAQ 两个标签页',
    },
    start,
    steps,
    made: {
      en: 'The brief is written: “Brief” opens with a table of contents, then the goals, what ships, the timeline, a diagram of how the bag leads into the app, and the risks; “Launch checklist” and “FAQ” are its other two tabs. Select any words and comment to have me change them.',
      zh: '简报写好了：“Brief”开头是目录，后面是目标、发布内容、时间表、一张从咖啡袋到 App 的流程图和风险；另外两个标签页是“Launch checklist”和“FAQ”。选中任意文字留评论，我就来改。',
    },
    comment: {
      text: {
        en: 'Put numbers on this: what does a good launch look like by the end of June?',
        zh: '这里要有数字：到 6 月底，怎样才算发布成功？',
      },
      // Where the words are in the doc the steps make. The replay's hook (`src/replay/types/docs.ts`) works the same
      // out from the doc as it stands, and where on the page the words are.
      ...placeOf(summary, COMMENT_ON),
      at: [0.62, 0.42],
    },
  },
};

/** A thread's place on `words` of `block`, as the page writes one a person starts (and `comment-add` for the agent). */
function placeOf(block, words) {
  const chars = [];
  for (const item of block.inline ?? []) {
    if (typeof item.text !== 'string') chars.push({ id: item.id, ch: '￼' });
    else {
      const [session, n] = [item.id.slice(0, item.id.lastIndexOf('.')), Number(item.id.slice(item.id.lastIndexOf('.') + 1))];
      Array.from(item.text).forEach((ch, i) => chars.push({ id: `${session}.${n + i}`, ch }));
    }
  }
  const text = chars.map((c) => c.ch).join('');
  const from = text.indexOf(words);
  const around = text.replaceAll('￼', '').trim();
  return {
    anchor: JSON.stringify({ tab: TABS.brief, range: [chars[from].id, chars[from + words.length - 1].id] }),
    label: words,
    detail: `On “${words}” in: ${around}`,
    location: { tab: TABS.brief, block: block.id },
  };
}

fs.writeFileSync(path.join(PLAYGROUND, 'demos', 'docs.demo.json'), `${JSON.stringify(demo, null, 2)}\n`);

const count = Object.keys(files).filter((file) => file.startsWith('doc/') && !file.startsWith('doc/history/')).length;
console.log(`showcase/docs/doc: ${count} files; demos/docs.demo.json: ${steps.length} steps, ${demo.agent.responses.length} responses`);
console.log(`the summary is ${summary.id}; the comment is on ${demo.replay.comment.anchor}`);

// The type's own check, when the repo is built (`artifact-types/docs/scripts/cli.mjs`).
const cli = path.join(REPO, 'artifact-types', 'docs', 'scripts', 'cli.mjs');
if (fs.existsSync(cli)) process.stdout.write(execFileSync(process.execPath, [cli, 'check', HERE], { encoding: 'utf8' }));
