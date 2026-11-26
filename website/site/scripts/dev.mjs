// Dev server: build once, serve dist/ with Vite (full reload on change), rebuild when the site's source or the
// repo's docs change.
import { watch } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { SITE_DIR, REPO_DIR, OUT_DIR } from '../src/config.mjs';

const port = Number(process.env.PORT) || 4321;
let building = null;
let again = false;

async function rebuild() {
  if (building) {
    again = true;
    return;
  }
  // A fresh process each time, so edits to src/*.mjs take effect.
  building = promisify(execFile)(process.execPath, [path.join(SITE_DIR, 'scripts/build.mjs'), '--no-clean'], { cwd: SITE_DIR })
    .then(({ stdout }) => process.stdout.write(stdout))
    .catch((e) => console.error(e.stderr || e))
    .finally(() => {
      building = null;
      if (again) {
        again = false;
        rebuild();
      }
    });
  await building;
}

await rebuild();

const server = await createServer({
  configFile: false,
  root: OUT_DIR,
  appType: 'mpa',
  server: { port, watch: { ignored: ['!**/*'] } },
  logLevel: 'info',
});
await server.listen();
server.printUrls();

let timer;
const onChange = (file) => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await rebuild();
    server.ws.send({ type: 'full-reload' });
    console.log(`rebuilt (${file || 'change'})`);
  }, 120);
};
for (const dir of [path.join(SITE_DIR, 'src'), path.join(SITE_DIR, 'public'), path.join(REPO_DIR, 'docs'), path.join(REPO_DIR, 'skills/open-artifact')]) {
  watch(dir, { recursive: true }, (_, f) => onChange(f));
}
