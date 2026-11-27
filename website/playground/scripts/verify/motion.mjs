// The motion demo: its checks (see ../verify.mjs).
import { ANY_TEXT, FRAME, IN_FRAME, agentRoundTrip, check, cleanRun, openDemo, replay, shot } from './lib.mjs';

/** The film's first scene as the stage draws it: opening in the last of the night, or (the agent's answer) in morning light. */
const OPENS = (hour) => `!!document.querySelector('.dawn-root.dawn-opens-${hour}')`;
/** The agent's answer to the comment, in the backend: the first scene opens an hour later. */
const WARMER = "window.__PLAYGROUND__.store.getDoc('modules/scene-dawn.js')?.text?.includes('const OPEN = { sky: 0.95, sun: 0.5 }')";

export default async function motion(browser) {
  const page = await openDemo(browser, 'motion', 4000);
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the film renders its first scene', await page.waitFor(`${ANY_TEXT('First Light')} && ${OPENS('night')}`, 15000));
    check('the timeline lists the seeded scenes', await page.waitFor(['First light', 'The pour', 'Tasting notes', 'Juniper Coffee'].map(ANY_TEXT).join(' && '), 10000));
    check('the film is 18 seconds long', await page.waitFor(IN_FRAME("document.body.innerText.includes('0:18')"), 10000));
    check('every scene is made, and the film is final', await page.evaluate(`JSON.parse(${store}.getDoc('modules/scenes.json').text).stage === 'final' && ['dawn', 'pour', 'notes', 'end'].every(id => ${store}.getDoc('modules/scene-' + id + '.js'))`));
    check('…so the page shows no scene to come, no rough cut and no error', !(await page.evaluateAll(['Coming up', 'Rough cut', 'Not made yet', 'Not finished yet', 'scenes missing', 'scene missing', 'stopped with an error'].map(ANY_TEXT).join(' || '))).includes(true));
    check('the film has a score and no voiceover', await page.evaluate(`!!${store}.getDoc('modules/score.js') && !${store}.getDoc('modules/narration.js') && ${store}.listDocs('assets').length === 0`));
    await shot(page, '17-motion-loaded');
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); return [f.x + f.width * 0.6, f.y + f.height * 0.4]; })()`));
    await agentRoundTrip(page, {
      target,
      request: 'Open on something warmer',
      changed: WARMER,
      shows: OPENS('morning'),
      reply: 'The film now opens an hour later',
      showsWorking: false,
      working: '18-motion-agent-working',
      done: '19-motion-agent-done',
    });
    check('the title is still there after the change', (await page.evaluateAll(ANY_TEXT('First Light'))).includes(true));
    cleanRun(page);
  } finally {
    await page.close();
  }
  await replay('motion', {
    built: `${ANY_TEXT('First Light')} && ${OPENS('night')}`,
    changed: WARMER,
    shows: OPENS('morning'),
  });
}
