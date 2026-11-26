// Tag planning and publication use only Node built-ins; the publisher never receives Apple credentials.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = resolve(import.meta.dirname, '..');
const root = resolve(appRoot, '../..');
const command = (program: string, args: string[]) => execFileSync(program, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const json = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8'));
const ensure: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };

export async function sha256(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function validateVersion(tag: string, versions: string[]) {
  ensure(tag === tag.trim() && /^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), 'Expected a stable desktop-v<MAJOR>.<MINOR>.<PATCH> tag');
  const version = tag.slice('desktop-v'.length);
  ensure(versions.every(value => value === version), 'Tag, desktop package/lockfile and runtime versions must match');
  return version;
}

function plan() {
  const pkg = json<{ version: string }>(join(appRoot, 'package.json'));
  const lock = json<{ version: string; packages: Record<string, { version: string }> }>(join(appRoot, 'package-lock.json'));
  const runtime = json<{ version: string }>(join(root, 'packages/daemon/package.json'));
  const mode = process.env.RELEASE_MODE ?? 'validate';
  ensure(['validate', 'package', 'publish'].includes(mode), 'Invalid release mode');
  const tag = process.env.RELEASE_TAG || `desktop-v${pkg.version}`;
  const version = validateVersion(tag, [pkg.version, lock.version, lock.packages[''].version, runtime.version]);
  const source = command('git', ['rev-parse', 'HEAD']);
  if (mode === 'publish') {
    ensure(process.env.RELEASE_TAG, 'Publication requires an existing release tag');
    ensure(command('git', ['rev-parse', `refs/tags/${tag}^{commit}`]) === source, 'Release tag differs from checkout');
    command('git', ['merge-base', '--is-ancestor', source, 'origin/main']);
  }
  if (mode !== 'validate') command(process.execPath, ['scripts/changelog.mjs', '--check', version]);
  const output = `tag=${tag}\nversion=${version}\nsource_commit=${source}\n`;
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, output, { flag: 'a' });
  console.log(output.trim());
}

interface Report {
  schema: number; version: string; arch: string; appId: string; sourceCommit: string;
  signingSha1: string; teamId: string; notarized: boolean; appSubmission: string; dmgSubmission: string;
  files: { name: string; sha256: string }[];
}

export async function validateCandidate(directory: string, expected: { tag: string; source: string; identity: string; team: string }) {
  const report = json<Report>(join(directory, 'release.json'));
  const version = validateVersion(expected.tag, [report.version]);
  ensure(report.schema === 1 && report.arch === 'arm64' && report.appId === 'dev.openartifact.desktop', 'Unexpected desktop release identity');
  ensure(/^[a-f0-9]{40}$/.test(expected.source) && report.sourceCommit === expected.source, 'Candidate source differs');
  ensure(/^[A-F0-9]{40}$/.test(expected.identity) && report.signingSha1 === expected.identity && report.teamId === expected.team, 'Candidate signer differs');
  ensure(report.notarized === true && /^[a-f\d-]{36}$/i.test(report.appSubmission) && /^[a-f\d-]{36}$/i.test(report.dmgSubmission), 'Candidate is not notarized');
  const names = ['zip', 'dmg'].map(ext => `Open-Artifact-${version}-darwin-arm64.${ext}`);
  ensure(Array.isArray(report.files) && report.files.length === names.length, 'Candidate must contain ZIP and DMG');
  for (const name of names) {
    const entry = report.files.find(file => file.name === name);
    ensure(entry && /^[a-f0-9]{64}$/.test(entry.sha256), `Missing asset or invalid checksum: ${name}`);
    ensure(await sha256(join(directory, name)) === entry.sha256, `Asset checksum differs: ${name}`);
    ensure(readFileSync(join(directory, `${name}.sha256`), 'utf8') === `${entry.sha256}  ${name}\n`, `Checksum file differs: ${name}`);
  }
  return { report, names: [...names, ...names.map(name => `${name}.sha256`), 'release.json'] };
}

async function publish(directory: string) {
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  ensure(/^[\w.-]+\/[\w.-]+$/.test(repo), 'GITHUB_REPOSITORY is required');
  const tag = process.env.RELEASE_TAG ?? '';
  const source = command('git', ['rev-parse', `refs/tags/${tag}^{commit}`]);
  ensure(source === command('git', ['rev-parse', 'HEAD']), 'Publisher checkout differs from release tag');
  const { report, names } = await validateCandidate(directory, {
    tag, source, identity: process.env.OA_MAC_SIGNING_SHA1 ?? '', team: process.env.OA_APPLE_TEAM_ID ?? '',
  });
  const work = mkdtempSync(join(tmpdir(), 'open-artifact-publish-'));
  const gh = (...args: string[]) => command('gh', [...args, '--repo', repo]);
  const view = () => JSON.parse(gh('release', 'view', tag, '--json', 'isDraft,targetCommitish,assets')) as {
    isDraft: boolean; targetCommitish: string; assets: { name: string }[];
  };
  try {
    let release;
    try { release = view(); } catch {
      const notes = command(process.execPath, ['scripts/changelog.mjs', '--notes', report.version]);
      const notesFile = join(work, 'notes.md');
      writeFileSync(notesFile, `${notes}\n\nmacOS Apple Silicon: Developer ID signed, hardened runtime, Apple notarized and stapled. ZIP and DMG checksums are attached.\n`);
      gh('release', 'create', tag, '--verify-tag', '--target', source, '--title', `Open Artifact Desktop ${report.version}`,
        '--notes-file', notesFile, '--draft', '--latest=false');
      release = view();
    }
    ensure(release.targetCommitish === source, 'Existing release source differs; refusing to change it');
    for (const name of names) {
      const local = join(directory, name);
      if (release.assets.some(asset => asset.name === name)) {
        gh('release', 'download', tag, '--pattern', name, '--dir', work);
        ensure(await sha256(join(work, name)) === await sha256(local), `Existing immutable release asset differs: ${name}`);
      } else {
        ensure(release.isDraft, 'Published releases are immutable; missing asset cannot be appended');
        gh('release', 'upload', tag, local);
      }
    }
    // Independently download every uploaded byte before making a draft public.
    for (const name of names) {
      gh('release', 'download', tag, '--pattern', name, '--dir', work, '--clobber');
      ensure(await sha256(join(work, name)) === await sha256(join(directory, name)), `Uploaded asset differs: ${name}`);
    }
    if (release.isDraft) gh('release', 'edit', tag, '--draft=false', '--latest=false');
    // Anonymous public read-back also catches accidentally private/unavailable release downloads.
    for (const name of names) {
      command('curl', ['--disable', '--fail', '--location', '--silent', '--show-error', '--retry', '3', '--max-time', '300',
        `https://github.com/${repo}/releases/download/${tag}/${name}`, '--output', join(work, name)]);
      ensure(await sha256(join(work, name)) === await sha256(join(directory, name)), `Public asset differs: ${name}`);
    }
    console.log(`Published and verified: https://github.com/${repo}/releases/tag/${tag}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'plan') plan();
    else if (process.argv[2] === 'publish' && process.argv[3]) await publish(resolve(process.argv[3]));
    else throw new Error('Expected plan or publish <candidate-directory>');
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
