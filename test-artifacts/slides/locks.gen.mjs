#!/usr/bin/env node
// Rebuilds slides/locks: a deck with locked and unlocked elements side by side, for trying ⇧⌘L,
// the menu's Lock and Unlock, what a lock refuses, the layer keys, the table cell menu and the
// properties panel's number fields. Then runs the slides check.
//   node test-artifacts/slides/locks.gen.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const deck = {
  v: 4,
  title: 'Locks and layers',
  lists: 'css',
  order: ['elements', 'second'],
  sections: {},
  faces: {},
  designSystems: [],
  attachments: {},
};

// Unlocked text, a locked text box, a locked drawing, a locked and an unlocked shape stacked so the
// layer keys have something to reorder, and a 2×2 table for the cell menu.
const elements = `<section id="elements" style="padding:128px;background:#fbfbf8;color:#14213d">
  <div id="free" data-text style="position:absolute;left:128px;top:128px;width:640px;height:120px;font-size:48px">
    <p>Unlocked text</p>
  </div>
  <div id="held" data-locked data-text style="position:absolute;left:128px;top:300px;width:640px;height:120px;background:#e8c547;font-size:48px">
    <p>Locked text</p>
  </div>
  <svg id="drawing" data-locked viewBox="0 0 10 10" style="position:absolute;left:128px;top:480px;width:200px;height:200px"><circle cx="5" cy="5" r="4" fill="#1870e0"/></svg>
  <div id="under" data-locked style="position:absolute;left:420px;top:500px;width:280px;height:180px;background:#c0573e;border-radius:16px"></div>
  <div id="over" style="position:absolute;left:520px;top:560px;width:280px;height:180px;background:#2f7d4a;border-radius:16px"></div>
  <table id="grid" style="position:absolute;left:960px;top:128px;width:800px;font-size:28px">
    <tr><td>A1</td><td>B1</td></tr>
    <tr><td>A2</td><td>B2</td></tr>
  </table>
</section>
`;

const second = `<section id="second" style="padding:128px;background:#14213d;color:#fbfbf8">
  <h2 style="font-size:72px">A second slide</h2>
</section>
`;

const cli = path.join(REPO, 'artifact-types', 'slides', 'scripts', 'cli.mjs');
if (!existsSync(cli)) {
  console.error('No slides CLI yet: run npm run build first.');
  process.exit(1);
}
const root = path.join(HERE, 'locks');
rmSync(path.join(root, 'project'), { recursive: true, force: true });
mkdirSync(path.join(root, 'project', 'slides'), { recursive: true });
writeFileSync(path.join(root, 'project', 'deck.json'), JSON.stringify(deck, null, 2) + '\n');
writeFileSync(path.join(root, 'project', 'slides', 'elements.html'), elements);
writeFileSync(path.join(root, 'project', 'slides', 'second.html'), second);
const check = spawnSync(process.execPath, [cli, 'check', root], { encoding: 'utf8' });
if (check.status) {
  process.stdout.write(check.stdout + check.stderr);
  process.exit(check.status);
}
console.log(`2 slides in ${path.relative(process.cwd(), root) || '.'}; check passed`);
