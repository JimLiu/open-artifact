#!/usr/bin/env node
// Rebuilds design/locks: a canvas with locked and unlocked artboards, elements and notes, for trying
// ⌘L, the lock button, the outline's unlock button and what a lock refuses. Then runs the design check.
//   node test-artifacts/design/locks.gen.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const board = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0}
</style>
</helmet>
${body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":800,"height":520}}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;

// Elements: a locked heading in a flex column, a locked badge placed absolutely, a locked
// drawing (its shapes are locked through the svg), and unlocked neighbours to compare with:
// a one-shape arrow (one layer), a bordered box (fill, stroke, border alignment) and a bar
// set from both sides (it only moves up and down).
const elements = board('Locked elements', `<div style="position: relative; width: 800px; height: 520px; box-sizing: border-box; padding: 48px; display: flex; flex-direction: column; gap: 20px; background: #f7f5f0; font-family: Georgia, serif">
<h1 data-label="Locked heading" data-locked="true" style="margin: 0; font-size: 44px; color: #2b2d31">A locked heading</h1>
<p data-label="Unlocked text" style="margin: 0; font-size: 20px; color: #4a4f55">An unlocked paragraph: it can move, resize and be deleted.</p>
<section data-label="Locked card" data-locked="true" style="display: flex; gap: 12px; padding: 16px; border-radius: 12px; background: #ffffff">
<p style="margin: 0; font-size: 18px">A child of a locked card: it is not locked itself.</p>
</section>
<svg data-label="Locked drawing" data-locked="true" width="220" height="120" viewBox="0 0 220 120">
<rect x="10" y="10" width="90" height="90" rx="12" fill="#c0573e"/>
<circle cx="160" cy="55" r="45" fill="#7c9cbf"/>
</svg>
<div data-label="Locked badge" data-locked="true" style="position: absolute; left: 560px; top: 48px; width: 180px; height: 64px; border-radius: 32px; background: #2f7d4a; color: #fff; display: flex; align-items: center; justify-content: center; font: 600 18px system-ui">Locked badge</div>
<div data-label="Free badge" style="position: absolute; left: 560px; top: 132px; width: 180px; height: 64px; border-radius: 32px; background: #8f5a3c; color: #fff; display: flex; align-items: center; justify-content: center; font: 600 18px system-ui">Free badge</div>
<svg data-label="Free arrow" style="position: absolute; left: 560px; top: 216px" width="180" height="40" viewBox="0 0 180 40"><path d="M10 20H170" stroke="#2b2d31" stroke-width="4" fill="none"/></svg>
<div data-label="Bordered box" style="position: absolute; left: 560px; top: 276px; width: 180px; height: 64px; border-radius: 8px; background-color: #f2c14e; border: 4px solid #2b2d31"></div>
<div data-label="Stretched bar" style="position: absolute; left: 560px; right: 60px; top: 360px; height: 24px; background: #7c9cbf"></div>
</div>`);

// An artboard locked as a whole (canvas.json), with nothing locked inside it.
const lockedBoard = board('Locked artboard', `<div style="width: 800px; height: 520px; box-sizing: border-box; padding: 48px; display: flex; flex-direction: column; justify-content: center; gap: 16px; background: #eef3fb; font-family: Georgia, serif">
<h1 style="margin: 0; font-size: 40px; color: #1f3b63">This artboard is locked</h1>
<p style="margin: 0; font-size: 20px; color: #4a4f55">It can't be moved, resized or deleted until it is unlocked. Its title still selects it.</p>
</div>`);

const canvas = {
  v: 3,
  // A fixed time, so regenerating changes nothing.
  createdOnFiles: { v: 1, at: '2026-11-26T00:00:00Z' },
  title: 'Locks',
  launch: { view: 'canvas' },
  pages: [],
  boards: {
    'Elements.dc.html': { x: 0, y: 0, w: 800, h: 520, title: 'Locked elements' },
    'Locked.dc.html': { x: 900, y: 0, w: 800, h: 520, title: 'Locked artboard', locked: true },
  },
  order: ['Elements.dc.html', 'Locked.dc.html'],
  notes: {
    'locked-note': { x: 0, y: 600, w: 260, h: 160, text: 'A locked note: its words still change, it does not move.', locked: true },
    'free-note': { x: 300, y: 600, w: 260, h: 160, text: 'An unlocked note, to compare.' },
  },
  designSystems: [],
};

const cli = path.join(REPO, 'artifact-types', 'design', 'scripts', 'cli.mjs');
if (!existsSync(cli)) {
  console.error('No design CLI yet: run npm run build first.');
  process.exit(1);
}
const root = path.join(HERE, 'locks');
rmSync(path.join(root, 'project'), { recursive: true, force: true });
mkdirSync(path.join(root, 'project'), { recursive: true });
writeFileSync(path.join(root, 'project', 'canvas.json'), JSON.stringify(canvas, null, 2) + '\n');
writeFileSync(path.join(root, 'project', 'Elements.dc.html'), elements);
writeFileSync(path.join(root, 'project', 'Locked.dc.html'), lockedBoard);
const check = spawnSync(process.execPath, [cli, 'check', root], { encoding: 'utf8' });
if (check.status) {
  process.stdout.write(check.stdout + check.stderr);
  process.exit(check.status);
}
console.log(`2 artboards and 2 notes in ${path.relative(process.cwd(), root) || '.'}; check passed`);
