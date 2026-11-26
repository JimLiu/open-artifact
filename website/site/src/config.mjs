// Build-wide settings: where the repo is, the site's base path, the version shown in the footer.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(SITE_DIR, '..', '..');
export const OUT_DIR = path.join(SITE_DIR, 'dist');

/** Base path the site is served under ("/" or e.g. "/open-artifact/"), from SITE_BASE. */
export const BASE = (() => {
  let b = process.env.SITE_BASE || '/';
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b;
})();

/** Absolute origin for sitemap.xml and canonical links, from SITE_URL (optional; no trailing slash). */
export const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(path.join(REPO_DIR, 'packages/daemon/package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

export const GITHUB = 'https://github.com/JimLiu/open-artifact';
export const RELEASES = `${GITHUB}/releases`;
export const NPM = 'https://www.npmjs.com/package/@open-artifact/cli';
export const DEMO_VIDEO = 'https://github.com/user-attachments/assets/9f34dc69-2e90-4118-92fd-63f36d7bc5f9';

/** A site route ("/docs/overview/") with the base path in front. */
export const url = (route) => BASE + String(route).replace(/^\/+/, '');

/** The same route in the other language: "/x/" <-> "/zh/x/". */
export const routeFor = (lang, route) => {
  const r = '/' + String(route).replace(/^\/+/, '');
  return lang === 'zh' ? (r === '/' ? '/zh/' : '/zh' + r) : r;
};

/** A GitHub link to a repo file (blob) or folder (tree). */
export const ghFile = (rel, { tree = false } = {}) => `${GITHUB}/${tree ? 'tree' : 'blob'}/main/${rel.replace(/^\/+/, '')}`;
