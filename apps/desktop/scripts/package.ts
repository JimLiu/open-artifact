#!/usr/bin/env node
/**
 * Packages the built app as `dist/Open Artifact-darwin-arm64/Open Artifact.app` (macOS arm64).
 * Local builds are signed ad hoc. --release requires Developer ID + notarization credentials and also creates
 * signed, notarized ZIP / DMG assets in dist/release. Run `npm run build` first (`npm run package` does both).
 *
 * - The app's code is the build's `out/main.mjs`, `out/preload.cjs`, `out/notice-preload.cjs`,
 *   `out/artifact-preload.cjs` and `out/renderer/` with a package.json naming the app, staged in `dist/stage/` and packed into `Contents/Resources/app.asar`. Nothing from node_modules goes in: the
 *   main process is one bundle (only `electron` is left out of it, which Electron provides).
 * - The runtime it carries (`resources/runtime`) is copied to `Contents/Resources/runtime`, where `main.ts` looks
 *   for it when packaged (`process.resourcesPath`).
 * - The icon is a placeholder (`scripts/placeholder-icon.ts`), and so are the icons of artifacts installed as apps
 *   (one per type, `Contents/Resources/app-icons/<type>.icns`, copied into each app). The stable bundle id is
 *   `dev.openartifact.desktop`.
 * - Electron's fuses are left as they are: `RunAsNode` stays on, the daemon and the type servers run on the app's own
 *   executable as Node.
 * - No URL scheme is declared unless `OA_DESKTOP_URL_SCHEME=1` is set (`scripts/info-plist.ts`: then `Info.plist`
 *   declares `open-artifact://`); either way nothing is installed or registered (no `lsregister`).
 * - Electron's zip comes from the cache `@electron/get` keeps (`~/Library/Caches/electron`) when it is there, so a
 *   package needs no network then; otherwise `@electron/get` downloads it.
 * - Signing: ad hoc locally; --release signs nested code inside out with hardened runtime and a secure timestamp.
 *
 *   node scripts/package.ts        (from apps/desktop)
 */
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { infoPlistAdditions, urlSchemeFromEnv } from './info-plist.ts';
import { writeIcns, writeTypeIcons } from './placeholder-icon.ts';
import { distributeMac, signingConfig, signingPreflight } from './macos-distribution.ts';

const here = join(import.meta.dirname, '..');
const dist = join(here, 'dist');
const stage = join(dist, 'stage');
const NAME = 'Open Artifact';
export const BUNDLE_ID = 'dev.openartifact.desktop';

const fail = (line: string) => {
  console.error(`package: ${line}`);
  process.exit(1);
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));

if (process.platform !== 'darwin') fail('the app is packaged on macOS only for now.');
if (process.argv.slice(2).some(arg => arg !== '--release')) fail('expected no arguments or --release');
const release = process.argv.includes('--release');
if (release && execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: here, encoding: 'utf8' }).trim())
  fail('release packaging requires committed, clean sources.');
const signing = release ? signingConfig() : null;
if (signing) signingPreflight(signing);
for (const path of ['out/main.mjs', 'out/preload.cjs', 'out/renderer/index.html', 'resources/runtime/scripts/open-artifact.mjs']) {
  if (!existsSync(join(here, path))) fail(`${path} is missing: run npm run build in apps/desktop first.`);
}
const pkg = readJson<{ name: string; version: string; description: string; license: string }>(join(here, 'package.json'));
if (release) {
  const runtime = readJson<{ version: string }>(join(here, 'resources/runtime/package.json'));
  if (runtime.version !== pkg.version) fail(`desktop ${pkg.version} differs from bundled runtime ${runtime.version}`);
}
const electronVersion = readJson<{ version: string }>(join(here, 'node_modules', 'electron', 'package.json')).version;

// ---- the staged app: package.json and the build's output, nothing else ----
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'out'), { recursive: true });
for (const entry of ['main.mjs', 'preload.cjs', 'notice-preload.cjs', 'artifact-preload.cjs', 'renderer'])
  cpSync(join(here, 'out', entry), join(stage, 'out', entry), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify({ name: pkg.name, productName: NAME, version: pkg.version, description: pkg.description, type: 'module', main: 'out/main.mjs', license: pkg.license }, null, 2)}\n`,
);
const icon = writeIcns(join(dist, 'icon.icns'));
// The icons of artifacts installed as apps, one per type (`Contents/Resources/app-icons/<type>.icns`).
const appIcons = join(dist, 'app-icons');
rmSync(appIcons, { recursive: true, force: true });
writeTypeIcons(appIcons);

/** The folder in @electron/get's cache that holds this version's zip, or undefined. */
function cachedZipDir() {
  const cache = join(homedir(), 'Library', 'Caches', 'electron');
  const zip = `electron-v${electronVersion}-darwin-arm64.zip`;
  if (!existsSync(cache)) return undefined;
  for (const dir of readdirSync(cache)) if (existsSync(join(cache, dir, zip))) return join(cache, dir);
  return undefined;
}
const zipDir = cachedZipDir();
const urlScheme = urlSchemeFromEnv();
const extendInfo = infoPlistAdditions({ urlScheme, bundleId: BUNDLE_ID });
if (urlScheme) console.log('package: OA_DESKTOP_URL_SCHEME=1: Info.plist declares open-artifact://');
console.log(`package: Electron ${electronVersion} ${zipDir ? `from the cache (${zipDir})` : 'downloaded by @electron/get'}`);

const [appDir] = await packager({
  dir: stage,
  out: dist,
  name: NAME,
  executableName: NAME,
  platform: 'darwin',
  arch: 'arm64',
  electronVersion,
  ...(zipDir ? { electronZipDir: zipDir } : {}),
  appBundleId: BUNDLE_ID,
  helperBundleId: `${BUNDLE_ID}.helper`,
  appCategoryType: 'public.app-category.productivity',
  appVersion: pkg.version,
  buildVersion: pkg.version,
  darwinDarkModeSupport: true,
  extendInfo,
  icon,
  asar: true,
  extraResource: [join(here, 'resources', 'runtime'), appIcons],
  overwrite: true,
  prune: false,
  junk: true,
  quiet: true,
});
const app = join(appDir, `${NAME}.app`);
if (signing) await distributeMac(app, pkg.version, signing, dist);
else execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
console.log(`package: ${app}`);
