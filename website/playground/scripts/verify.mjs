#!/usr/bin/env node
// Drives the playground in headless Chrome over the DevTools protocol (the repo's e2e/lib/browser.mjs) and checks the
// playground end to end: each demo's editor loads in the real Shell from the in-memory backend, a change made through the
// page's own `window.openartifact` reaches the backend, a comment sent to the agent from the page's own comment UI
// makes the simulated agent work, reply in the thread and change the artifact live, and no request leaves the page
// for another host; and each demo's replay (`?replay=1`) plays to its end, and ends at once on a skip. Screenshots go to
// `.spike-shots/`. The checks of each demo are its own file, `verify/<demo>.mjs`; what they share is `verify/lib.mjs`.
//
// Every demo is covered: whiteboard, slides, design, design-system, data, motion, page (frame-host's inner shell), and
// docs and sheets, whose artifacts live in the real Docs host and Sheets store (with its WebAssembly engine) running in
// the page.
//
// Each demo opens at its own page, `<base><demo>/`; ROUTES=query opens `demo.html?type=<demo>` instead. The landing page
// and the hint bar above each demo (and its absence with `?embed=1`) are checked too (`landing`).
//
//   node website/playground/scripts/verify.mjs [base URL, default http://127.0.0.1:5190/]
//   ONLY=design,page node website/playground/scripts/verify.mjs   # some demos only
//   node website/playground/scripts/verify.mjs http://127.0.0.1:4330/playground/   # the built website (website/build.mjs)
import { launch, results } from './verify/lib.mjs';

const DEMOS = ['landing', 'whiteboard', 'slides', 'design', 'design-system', 'data', 'motion', 'page', 'docs', 'sheets'];
const ONLY = process.env.ONLY?.split(',');
const browser = await launch({ width: 1440, height: 900 });
try {
  for (const demo of DEMOS) if (!ONLY || ONLY.includes(demo)) await (await import(`./verify/${demo}.mjs`)).default(browser);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
