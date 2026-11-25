/**
 * Where a new artifact made in the app goes.
 *
 * Without the app's setting the daemon decides (`artifacts.create` with no `folder`):
 * `<homeWorkspace>/<artifactsDir>/<slug of the title>`, `-2`, `-3`… when that folder exists and is not empty, with
 * `homeWorkspace` (default `~/OpenArtifact`) and `artifactsDir` (default `artifacts`) from the Open Artifact home's
 * `settings.json`.
 *
 * With the setting (`artifactsFolder`, a folder the person chose) the app passes `folder` itself. The daemon takes a
 * `folder` as the artifact's own folder, as it is (it adds no `-2`), so the app makes the same name the daemon would:
 * `<chosen>/<slug of the title>`, then `-2`, `-3`… past a folder that exists and is not empty.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandHome } from './profile.mjs';

/** A folder name from a title, as the daemon makes one (daemon `store.ts` `slugify`). */
export function slugify(text) {
  const slug = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'artifact';
}

const taken = (dir) => {
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return true;
  }
};

/** The folder for a new artifact titled `title` under `base`. */
export function newArtifactFolder(base, title) {
  const slug = slugify(title);
  let root = join(base, slug);
  for (let i = 2; taken(root); i++) root = join(base, `${slug}-${i}`);
  return root;
}

/** The daemon's own default folder for new artifacts, for showing (`settings.json` of the Open Artifact home). */
export function libraryDefaultFolder(home, userHome = homedir()) {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) ?? {};
  } catch {
    // The defaults.
  }
  const workspace = typeof saved.homeWorkspace === 'string' && saved.homeWorkspace ? saved.homeWorkspace : '~/OpenArtifact';
  const dir = typeof saved.artifactsDir === 'string' && saved.artifactsDir ? saved.artifactsDir : 'artifacts';
  return join(expandHome(workspace, userHome), dir);
}
