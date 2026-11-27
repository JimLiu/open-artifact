// The docs demo: its checks (see ../verify.mjs). The showcase is Juniper's spring launch brief (`showcase/docs/`, made
// by its `make.mjs`): three tabs, with tables of date and status chips, a diagram, callouts, checklists and a code
// block. The doc lives in the real Docs host running in the page.
import { ANY_TEXT, EDITOR_BUTTON, FRAME, IN_EDITOR_AT, IN_FRAME, SHELL_IDLE, check, cleanRun, clickInEditor, demoUrl, launch, openDemo, replay, shot, sleep, waitTop, watchAgent } from './lib.mjs';

const store = 'window.__PLAYGROUND__.store';
const DOC = 'window.__PLAYGROUND__.engines.doc';
const VERIFY = "{ id: 'verify', name: 'verify', role: 'owner' }";
/** The blocks of one tab of the doc, from the Docs host itself (by the tab's name). */
const TAB_BLOCKS = (name) => `(h => h.read(h.project().files.find(f => f.name === ${JSON.stringify(name)}).id, ${VERIFY}).doc.blocks)(${DOC}.host)`;
/** The text of one tab, a line a block (a container's line is empty), in reading order. */
const DOC_TAB_TEXT = (name) => `(() => { const lines = []; const walk = bs => { for (const b of bs ?? []) { lines.push((b.inline ?? []).map(i => i.text ?? '').join('')); walk(b.children); } }; walk(${TAB_BLOCKS(name)}); return lines.join('\\n'); })()`;
/** How many blocks of a tab (at any depth) `test` (a function of a block, as source) holds for. */
const COUNT_BLOCKS = (name, test) => `(() => { let n = 0; const walk = bs => { for (const b of bs ?? []) { if ((${test})(b)) n++; walk(b.children); } }; walk(${TAB_BLOCKS(name)}); return n; })()`;
/** How many chips of a kind (`date`, `mention`, `dropdown`) a tab holds. */
const COUNT_CHIPS = (name, kind) => `(() => { let n = 0; const walk = bs => { for (const b of bs ?? []) { n += (b.inline ?? []).filter(i => i.atom === ${JSON.stringify(kind)}).length; walk(b.children); } }; walk(${TAB_BLOCKS(name)}); return n; })()`;

const TABS = ['Brief', 'Launch checklist', 'FAQ'];
/** The words the replay's comment is on, in the summary; the agent's first answer is a panel under their paragraph. */
const WORDS = 'what a good launch looks like';
const SUMMARY = 'On Wednesday, April 14, Juniper ships two things on the same morning';
const PANEL = 'A good launch, by June 30:';
const REQUEST = 'Put numbers on this: what does a good launch look like by the end of June?';
/** The line a person types after, in the Goals list. */
const GOAL = 'Keep the promise. Three days from the roaster to the doorstep, launch week included.';
const TYPED = ' typed in the playground';
/** The kind of the block right after the summary, and its words. */
const UNDER_SUMMARY = `(bs => { const at = bs.findIndex(b => (b.inline ?? []).map(i => i.text ?? '').join('').startsWith(${JSON.stringify(SUMMARY)})); const next = bs[at + 1]; return at < 0 || !next ? null : [next.type, JSON.stringify(next)]; })(${TAB_BLOCKS('Brief')})`;
/** The words the editor marks as commented on, for the first thread (the marks' text, in order). */
const MARKED = IN_FRAME(`[...document.querySelectorAll('[data-comment="' + window.__PLAYGROUND__.comments.list()[0]?.id + '"]')].map(e => e.textContent).join('')`);
/** Whether `element` (an expression in the editor's document) is drawn inside the editor's window, all of it. */
const IN_VIEW = (element) => IN_FRAME(`(r => !!r && r.height > 0 && r.top >= 0 && r.bottom <= w.innerHeight)((${element})?.getBoundingClientRect())`);
const SUCCESS_PANEL = `[...document.querySelectorAll('.doc-callout[data-callout=success]')].find(e => e.textContent.includes(${JSON.stringify(PANEL)}))`;

/** Where the editor draws `words` (once in the doc): the points just inside their first and last characters, in the Shell page's viewport. */
const WORDS_AT = (words) => `(() => {
  const f = ${FRAME}; const d = f.contentWindow.document; const o = f.getBoundingClientRect();
  const walker = d.createTreeWalker(d.querySelector('[contenteditable]'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const from = node.nodeValue.indexOf(${JSON.stringify(words)});
    if (from < 0) continue;
    const box = (at) => { const r = d.createRange(); r.setStart(node, at); r.setEnd(node, at + 1); return r.getBoundingClientRect(); };
    const first = box(from); const last = box(from + ${words.length} - 1);
    return [[o.x + first.left + 1, o.y + first.top + first.height / 2], [o.x + last.right - 1, o.y + last.top + last.height / 2]];
  }
  return null;
})()`;

export default async function docs(browser) {
  const started = Date.now();
  const page = await openDemo(browser, 'docs', 2500, IN_FRAME("document.body.innerText.includes('First Light: spring launch brief')"));
  try {
    console.log(`     the Docs editor showed the seeded doc ${Date.now() - started} ms after the page was asked for (settle included)`);
    const script = await page.evaluate('window.__PLAYGROUND__.seed.replay.comment');
    check('the editor renders the seeded first tab, top to bottom', await page.waitFor(IN_FRAME(`document.body.innerText.includes(${JSON.stringify(SUMMARY)}) && document.body.innerText.includes('Who answers the press on launch morning?')`), 10000));
    check('the tab list names the three tabs in order (Docs host session)', await page.waitFor(`${DOC}.host.project().files.sort((a, b) => a.order < b.order ? -1 : 1).map(f => f.name).join('|') === ${JSON.stringify(TABS.join('|'))}`, 5000));
    // The built site serves the engine as a chunk of its own (`assets/docHost-<hash>.js`); the dev server, as the bundle itself.
    const engines = [...page.urls].filter((u) => /docHost|sheetHost/.test(u));
    check('the engine module loaded on this demo only (its own chunk)', engines.some((u) => /\/(?:assets\/docHost-[\w-]+|src\/engines\/bundles\/docHost)\.js(?:\?.*)?$/.test(u)) && !engines.some((u) => /sheetHost/.test(u)), engines.join(', '));
    check('the doc is not changed by the agent yet', !(await page.evaluate(`${DOC_TAB_TEXT('Brief')}.includes(${JSON.stringify(PANEL)})`)) && !(await page.evaluateAll(ANY_TEXT(PANEL))).includes(true));
    const docFiles = Object.keys(await page.evaluate(`${store}.list()`)).filter((p) => p.startsWith('doc/'));
    check('the artifact keeps the seeded doc files (the doc, its sessions, a file a tab)', docFiles.length === 5 && docFiles.filter((p) => p.startsWith('doc/tabs/')).length === 3, docFiles.join(', '));

    // What the brief is made of, as the Docs host holds it…
    const made = {
      tables: await page.evaluate(COUNT_BLOCKS('Brief', "b => b.type === 'table'")),
      numbered: await page.evaluate(COUNT_BLOCKS('Brief', "b => b.type === 'list' && b.attrs?.kind === 'ordered'")),
      quotes: await page.evaluate(COUNT_BLOCKS('Brief', "b => b.type === 'blockquote'")),
      diagrams: await page.evaluate(COUNT_BLOCKS('Brief', "b => b.type === 'codeBlock' && b.attrs?.language === 'mermaid'")),
      pending: await page.evaluate(COUNT_BLOCKS('Brief', "b => b.type === 'pending'")),
      dates: await page.evaluate(COUNT_CHIPS('Brief', 'date')),
      dropdowns: await page.evaluate(COUNT_CHIPS('Brief', 'dropdown')),
      mentions: await page.evaluate(COUNT_CHIPS('Brief', 'mention')),
      ticked: await page.evaluate(COUNT_BLOCKS('Launch checklist', "b => b.type === 'listItem' && b.attrs?.checked === true")),
      boxes: await page.evaluate(COUNT_BLOCKS('Launch checklist', "b => b.type === 'listItem' && typeof b.attrs?.checked === 'boolean'")),
      code: await page.evaluate(COUNT_BLOCKS('FAQ', "b => b.type === 'codeBlock'")),
    };
    check('the brief holds its tables, its numbered goals, a quote and a callout, and one diagram, with no section left pending', made.tables === 3 && made.numbered === 1 && made.quotes === 2 && made.diagrams === 1 && made.pending === 0, JSON.stringify(made));
    check('…and its chips: dates, status dropdowns, the owner and links to the other tabs', made.dates === 9 && made.dropdowns === 12 && made.mentions === 4, JSON.stringify(made));
    check('the checklist has ticked and open boxes; the FAQ a code block', made.ticked === 4 && made.boxes === 14 && made.code === 1, JSON.stringify(made));
    // …and as the editor draws it.
    check('the editor draws the chips: dates, coloured statuses, links to the tabs', await page.waitFor(IN_FRAME("document.querySelectorAll('[data-date]').length === 9 && document.querySelectorAll('.doc-dropdown[data-color]').length === 12 && [...document.querySelectorAll('.doc-mention-tab')].map(e => e.textContent).join('|') === 'Launch checklist|FAQ'"), 6000));
    check('the editor draws the diagram (its own renderer, nothing fetched elsewhere)', await page.waitFor(IN_FRAME("!!document.querySelector('.code-block[data-live=mermaid] .code-block-output svg')?.textContent.includes('Brew guide in the app')"), 15000));
    check('the editor draws the risk as a warning panel', await page.evaluate(IN_FRAME("!!document.querySelector('.doc-callout[data-callout=warning]')?.textContent.includes('App store review is the one date we do not control.')")));
    await shot(page, '23-docs-loaded');

    // A real edit in the editor: type at the end of the third goal; the page writes it through doc.call (brokered).
    const goal = `[...document.querySelectorAll('[contenteditable] li')].find(e => e.textContent.trim() === ${JSON.stringify(GOAL)})?.querySelector('p')`;
    const at = await page.evaluate(`(() => { const f = ${FRAME}; const r = (document => (${goal})?.getBoundingClientRect())(f.contentWindow.document); const o = f.getBoundingClientRect(); return r ? [o.x + r.right - 2, o.y + r.y + r.height / 2] : null; })()`);
    if (at) {
      await page.click(at[0], at[1]);
      await page.press('End');
      await page.type(TYPED);
      check('typing in the editor saves through the Docs host', await page.waitFor(`${DOC_TAB_TEXT('Brief')}.includes(${JSON.stringify(GOAL + TYPED)})`, 8000));
      check("the person's edit becomes a version in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'person' && v.files.some(f => f.path.startsWith('doc/tabs/')))`, 6000));
      check('the editor says the doc is saved', await page.waitFor(IN_FRAME("document.body.innerText.includes('All changes saved')"), 8000));
    } else check('found the third goal to type after', false);

    // Comment on the words the replay's comment is on, from the editor's own comment UI, with "Send to Agent" ticked.
    const ends = await page.evaluate(WORDS_AT(WORDS));
    check(`found “${WORDS}” in the summary`, !!ends);
    if (ends) {
      await page.click(ends[0][0], ends[0][1]);
      await page.click(ends[1][0], ends[1][1], { shift: true });
    }
    check('the words are selected', await page.waitFor(IN_FRAME(`String(w.getSelection()) === ${JSON.stringify(WORDS)}`), 4000), await page.evaluate(IN_FRAME('String(w.getSelection())')));
    check('the selection toolbar offers Comment', await clickInEditor(page, EDITOR_BUTTON('Comment')));
    const field = "document.querySelector('textarea[aria-label=\"Add a comment\"]')";
    check('the comment composer opens in the editor', await page.waitFor(IN_FRAME(`${field} && document.activeElement === ${field}`), 6000));
    await page.type(REQUEST);
    const sendBox = "document.querySelector('[data-send-to-agent] input[type=checkbox]')";
    check('the composer offers "Send to Agent"', await page.waitFor(IN_FRAME(sendBox), 4000), await page.evaluate(IN_FRAME(`${sendBox}?.parentElement?.textContent`)));
    if (!(await page.evaluate(IN_FRAME(`${sendBox}?.checked`)))) await clickInEditor(page, sendBox, 2000);
    check('"Send to Agent" is ticked', await page.evaluate(IN_FRAME(`${sendBox}?.checked === true`)));
    await watchAgent(page);
    // Send with the composer's own Comment button (the nearest one around the text box).
    const submit = `(b => { for (let e = ${field}; e; e = e.parentElement) { const b = e.querySelector('button[aria-label="Comment"]'); if (b) return b; } return null; })()`;
    // The card settles into its place beside the words after it opens; a click while it still moves can miss the
    // send, so wait for the button to stand still first, and click once more if the card is still open with the text.
    let last = null;
    for (let i = 0; i < 20; i++) {
      const now = JSON.stringify(await page.evaluate(IN_EDITOR_AT(submit)));
      if (now !== 'null' && now === last) break;
      last = now;
      await sleep(250);
    }
    check("the composer's Comment button sends it", await clickInEditor(page, submit, 3000));
    const sentThread = `window.__PLAYGROUND__.comments.list().some(t => t.messages[0].text.includes(${JSON.stringify(REQUEST)}))`;
    let reached = await page.waitFor(sentThread, 2500);
    if (!reached && (await page.evaluate(IN_FRAME(`${field}?.value === ${JSON.stringify(REQUEST)}`)))) {
      console.log('     (the first click on Comment did not send; clicking it again)');
      await clickInEditor(page, submit, 2000);
      reached = await page.waitFor(sentThread, 5000);
    }
    check('the thread reaches the backend', reached);
    // The replay leaves this same comment without the editor: its place must be the one the editor makes here.
    const thread = await page.evaluate('window.__PLAYGROUND__.comments.list()[0]');
    check("the thread is anchored in the doc (the tab's id in its location)", await page.evaluate(`window.__PLAYGROUND__.comments.list()[0]?.location?.tab === ${DOC}.host.project().files.find(f => f.name === 'Brief').id`));
    check("the replay's comment has the place the editor gives these words: anchor, label, detail, location", !!thread && thread.anchor === script.anchor && thread.label === script.label && thread.detail === script.detail && JSON.stringify(thread.location) === JSON.stringify(script.location), JSON.stringify({ editor: { anchor: thread?.anchor, label: thread?.label, detail: thread?.detail, location: thread?.location }, replay: { anchor: script.anchor, label: script.label, detail: script.detail, location: script.location } }));
    check('the thread is handed to the agent', await page.waitFor('window.__PLAYGROUND__.comments.list().some(t => t.agent)', 5000));
    check('the agent works (backend)', await page.waitFor('window.__agentBusy', 4000));
    await shot(page, '24-docs-agent-working');
    check('the agent writes in the doc through the Docs host', await page.waitFor(`${DOC_TAB_TEXT('Brief')}.includes(${JSON.stringify(PANEL)})`, 8000));
    const under = await page.evaluate(UNDER_SUMMARY);
    check('…a quote right under the summary', under?.[0] === 'blockquote' && under[1].includes(PANEL), under?.[0]);
    check("the agent's panel shows in the editor live, as a success callout", await page.waitFor(IN_FRAME(`!!(${SUCCESS_PANEL})`), 10000));
    check('…in view, without scrolling', await page.evaluate(IN_VIEW(SUCCESS_PANEL)));
    check("the person's typing is kept beside it", await page.evaluate(IN_FRAME(`document.body.innerText.includes(${JSON.stringify(GOAL + TYPED)})`)));
    check('the thread still hangs on its words', await page.waitFor(`${MARKED} === ${JSON.stringify(WORDS)}`, 6000), await page.evaluate(MARKED));
    const reply = 'Under the summary of “Brief” there is now a panel';
    check('the agent replies in the thread', await page.waitFor(`window.__PLAYGROUND__.comments.list().some(t => t.messages.some(m => m.author.kind === 'agent' && m.text.includes(${JSON.stringify(reply)})))`, 6000));
    check("the reply shows in the editor's comment card", await page.waitFor(IN_FRAME(`document.body.innerText.includes(${JSON.stringify(reply)})`), 8000));
    check("the agent's edit is a version in the Docs host's own history", await page.evaluate(`(async () => { const d = ${DOC}; const tab = d.host.project().files.find(f => f.name === 'Brief'); const h = await d.capability.history(tab.id); return h.versions.some(v => v.by === 'agent'); })()`));
    check("…and in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'agent')`, 4000));
    check('the Shell shows the agent idle again', await waitTop(page, SHELL_IDLE, 8000));
    await shot(page, '25-docs-agent-done');

    // The agent's next turn pins what was asked under the summary; the one after writes in another tab.
    const second = 'Say who signs off the bag artwork';
    await page.evaluate(IN_FRAME(`w.openartifact.use('agent').then(a => a.send({ text: ${JSON.stringify(second)} }))`));
    check('a second agent turn pins a review note under the summary', await page.waitFor(`(u => u?.[0] === 'blockquote' && u[1].includes(${JSON.stringify(second)}))(${UNDER_SUMMARY})`, 8000));
    check('…which the editor draws as an info callout', await page.waitFor(IN_FRAME(`[...document.querySelectorAll('.doc-callout[data-callout=info]')].some(e => e.textContent.includes(${JSON.stringify(`Review note: ${second}`)}))`), 8000));
    const third = 'Book the pop-up venues';
    await page.evaluate(`window.__PLAYGROUND__.agent.request(${JSON.stringify(third)})`);
    check('a third agent turn adds a task at the end of "Launch checklist"', await page.waitFor(`${DOC_TAB_TEXT('Launch checklist')}.endsWith(${JSON.stringify(`You ${third}`)})`, 8000));
    check('…an open box in its last list', (await page.evaluate(COUNT_BLOCKS('Launch checklist', "b => b.type === 'listItem' && typeof b.attrs?.checked === 'boolean'"))) === made.boxes + 1);
    check('the agent is idle again', await page.waitFor('!window.__PLAYGROUND__.agent.status().busy', 8000));

    // The other tabs open from the editor's tab menu.
    check('the tab menu opens', await clickInEditor(page, "document.querySelector('button[aria-label=\"Brief, tabs\"]')", 4000));
    check('…and opens "Launch checklist", with the agent\'s task in it', (await clickInEditor(page, "[...document.querySelectorAll('[role=treeitem]')].find(e => e.textContent.trim() === 'Launch checklist')", 4000)) && (await page.waitFor(IN_FRAME(`document.querySelectorAll('[contenteditable] li[data-checked]').length === ${made.boxes + 1} && document.querySelector('[contenteditable]').innerText.includes(${JSON.stringify(third)})`), 8000)));
    await shot(page, '25-docs-checklist');

    // The editor's own version history panel (the Shell's History button) opens over the engine's history.
    const historyButton = "document.querySelector('header button[aria-label=\"Version history\"]')";
    if (await page.waitFor(`${historyButton} && !${historyButton}.disabled`, 4000)) {
      await page.evaluate(`${historyButton}.click()`);
      check("the doc's version history opens from the Shell", await page.waitFor(IN_FRAME("[...document.querySelectorAll('aside, [role=dialog], [role=complementary]')].some(e => /history|version/i.test(e.getAttribute('aria-label') ?? '') || /Version history|Current version/.test(e.textContent))"), 6000));
      await shot(page, '26-docs-history');
    } else check('the Shell offers version history', false);
    cleanRun(page);
  } finally {
    await page.close();
  }

  await replay('docs', {
    built: ANY_TEXT('Who answers the press on launch morning?'),
    changed: `${DOC_TAB_TEXT('Brief')}.includes(${JSON.stringify(PANEL)})`,
    shows: ANY_TEXT(PANEL),
  });
  await replayEnds();
}

/**
 * Where a replay leaves the doc and the page, in a window the size of the home page's stage (a skipped one: it ends
 * with the same): the doc the plain demo opens with plus the agent's panel, the thread on its words, and the page at
 * its top with the panel in view.
 */
async function replayEnds() {
  const browser = await launch({ width: 1200, height: 720 });
  try {
    const url = demoUrl('docs');
    const page = await browser.load(`${url}${url.includes('?') ? '&' : '?'}replay=1`, { ready: "window.top === window && !!document.querySelector('.pg-replay')", timeout: 30000, settle: 300 });
    try {
      await page.evaluate("document.querySelector('.pg-skip').click()");
      check('a skipped replay ends', await waitTop(page, "document.querySelector('.pg-replay').dataset.state === 'done'", 15000));
      // Each tab's blocks against the seed's file of that tab, the agent's panel (the answer to the comment) aside.
      const same = await page.evaluate(`(() => {
        const p = window.__PLAYGROUND__; const now = p.engines.doc.files(); const text = new TextDecoder(); const out = {};
        for (const [path, file] of Object.entries(p.seed.files)) {
          if (!path.startsWith('doc/tabs/')) continue;
          const built = JSON.parse(text.decode(now[path])).blocks.filter(b => !(b.type === 'blockquote' && JSON.stringify(b).includes(${JSON.stringify(PANEL)})));
          out[path] = JSON.stringify(built) === JSON.stringify(JSON.parse(file.text).blocks);
        }
        return out;
      })()`);
      check('the replay builds the very doc the plain demo opens with (every tab, block for block, id for id)', Object.keys(same ?? {}).length === 3 && Object.values(same).every(Boolean), JSON.stringify(same));
      const thread = await page.evaluate('window.__PLAYGROUND__.comments.list()[0]');
      const script = await page.evaluate('window.__PLAYGROUND__.seed.replay.comment');
      check("the replay's thread is where its hook found the words in the built doc", !!thread && thread.anchor === script.anchor && thread.label === WORDS && JSON.stringify(thread.location) === JSON.stringify(script.location), JSON.stringify({ anchor: thread?.anchor, location: thread?.location }));
      check('the editor marks those words as commented on', await page.waitFor(`${MARKED} === ${JSON.stringify(WORDS)}`, 10000), await page.evaluate(MARKED));
      check("the agent's panel is in view where the page stands (no scrolling)", (await page.waitFor(IN_FRAME(`!!(${SUCCESS_PANEL})`), 10000)) && (await page.waitFor(IN_VIEW(SUCCESS_PANEL), 4000)));
      check('…with the commented words above it', await page.evaluate(IN_VIEW(`document.querySelector('[data-comment]')`)));
      await sleep(600);
      await shot(page, 'replay-docs-6-ends');
      check('no page problems', page.problems.length === 0, page.problems.join(' | '));
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
