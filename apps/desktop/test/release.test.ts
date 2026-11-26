import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { notarize, signingConfig, signingPreflight, verifySignedApp } from '../scripts/macos-distribution.ts';
import { sha256, validateCandidate, validateVersion } from '../scripts/release.ts';

const identity = 'C'.repeat(40);
const team = '22FY8U8BF9';
const source = 'a'.repeat(40);
const config = { identity, team, profile: 'test-notary', keychain: '/tmp/test.keychain-db' };

test('release tags are stable, safe and agree with the app, lockfile and bundled runtime', () => {
  assert.equal(validateVersion('desktop-v0.16.0', ['0.16.0', '0.16.0']), '0.16.0');
  for (const tag of ['v0.16.0', 'desktop-v01.16.0', 'desktop-v0.16.0-beta.1', '../tag', 'desktop-v0.16.0\n'])
    assert.throws(() => validateVersion(tag, ['0.16.0']));
  assert.throws(() => validateVersion('desktop-v0.16.0', ['0.16.0', '0.0.0']), /versions must match/);
});

test('release signing requires an exact certificate, team and notarization profile', () => {
  assert.throws(() => signingConfig({}), /OA_MAC_SIGNING_SHA1/);
  assert.throws(() => signingConfig({ OA_MAC_SIGNING_SHA1: identity }), /OA_APPLE_TEAM_ID/);
  assert.throws(() => signingConfig({ OA_MAC_SIGNING_SHA1: identity, OA_APPLE_TEAM_ID: team }), /OA_NOTARY_PROFILE/);
  const selected = signingConfig({ OA_MAC_SIGNING_SHA1: identity, OA_APPLE_TEAM_ID: team, OA_NOTARY_PROFILE: 'test' });
  assert.equal(selected.identity, identity);
  assert.throws(() => signingPreflight(config, () => `${identity} "Apple Development: Name (${team})"`), /Developer ID Application/);
  assert.throws(() => signingPreflight(config, () => `${identity} "Developer ID Application: Name (OTHERTEAM1)"`), /Team ID/);
  const calls: string[][] = [];
  signingPreflight(config, (program, args) => {
    calls.push([program, ...args]);
    return `${identity} "Developer ID Application: Name (${team})"`;
  });
  assert.ok(calls[1].includes(config.keychain));
  assert.ok(calls[1].includes(config.profile));
});

test('notarization fails closed and retrieves the rejection log; only Accepted succeeds', () => {
  const work = mkdtempSync(join(tmpdir(), 'oa-notary-test-'));
  try {
    const calls: string[][] = [];
    const rejected = (program: string, args: string[]) => {
      calls.push([program, ...args]);
      return JSON.stringify({ id: 'b'.repeat(36), status: 'Invalid' });
    };
    assert.throws(() => notarize('app.zip', config, work, 'app', rejected), /Notarization Invalid/);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes('log'));
    assert.ok(calls.every(args => args.includes(config.keychain) && args.includes(config.profile)));
    assert.equal(JSON.parse(readFileSync(join(work, 'app-notary-result.json'), 'utf8')).status, 'Invalid');
    assert.equal(notarize('app.zip', config, work, 'app', () => JSON.stringify({ id: 'b'.repeat(36), status: 'Accepted' })), 'b'.repeat(36));
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('signature verification rejects a same-name certificate with another fingerprint or a missing hardened runtime', () => {
  const details = `Authority=Developer ID Application: Name\nTeamIdentifier=${team}\nflags=0x10000(runtime)\nTimestamp=now`;
  const verifier = (fingerprint: string, signature = details) => (program: string, args: string[]) => {
    if (program === 'plutil') return JSON.stringify({ CFBundleIdentifier: 'dev.openartifact.desktop', CFBundleShortVersionString: '0.16.0', CFBundleVersion: '0.16.0' });
    if (program === 'openssl') return `sha1 Fingerprint=${fingerprint.match(/../g)?.join(':')}\n`;
    return args.includes('--verbose=4') ? signature : '';
  };
  verifySignedApp('App.app', config, '0.16.0', '/tmp', verifier(identity));
  assert.throws(() => verifySignedApp('App.app', config, '0.16.0', '/tmp', verifier('D'.repeat(40))), /fingerprint differs/);
  assert.throws(() => verifySignedApp('App.app', config, '0.16.0', '/tmp', verifier(identity, details.replace('flags=0x10000(runtime)', 'flags=0x0'))), /hardened runtime/);
  assert.throws(() => verifySignedApp('App.app', config, '0.17.0', '/tmp', verifier(identity)), /version differs/);
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'oa-release-test-'));
  const files = [];
  for (const ext of ['zip', 'dmg']) {
    const name = `Open-Artifact-0.16.0-darwin-arm64.${ext}`;
    writeFileSync(join(directory, name), `fixture ${ext} bytes`);
    const digest = await sha256(join(directory, name));
    writeFileSync(join(directory, `${name}.sha256`), `${digest}  ${name}\n`);
    files.push({ name, sha256: digest });
  }
  const report = { schema: 1, version: '0.16.0', arch: 'arm64', appId: 'dev.openartifact.desktop', sourceCommit: source,
    signingSha1: identity, teamId: team, notarized: true, appSubmission: 'b'.repeat(36), dmgSubmission: 'c'.repeat(36), files };
  writeFileSync(join(directory, 'release.json'), JSON.stringify(report));
  return { directory, report };
}
const expected = { tag: 'desktop-v0.16.0', source, identity, team };

test('publication detects corrupted archives and checksum files before upload', async () => {
  const { directory, report } = await fixture();
  try {
    assert.equal((await validateCandidate(directory, expected)).names.length, 5);
    const file = join(directory, report.files[0].name);
    const bytes = readFileSync(file);
    writeFileSync(file, 'tampered');
    await assert.rejects(validateCandidate(directory, expected), /Asset checksum differs/);
    writeFileSync(file, bytes);
    writeFileSync(`${file}.sha256`, 'tampered');
    await assert.rejects(validateCandidate(directory, expected), /Checksum file differs/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('publication rejects mismatched source/signer, unnotarized builds and unexpected asset paths', async () => {
  for (const mutate of [
    (r: Awaited<ReturnType<typeof fixture>>['report']) => { r.sourceCommit = 'd'.repeat(40); },
    (r: Awaited<ReturnType<typeof fixture>>['report']) => { r.signingSha1 = 'D'.repeat(40); },
    (r: Awaited<ReturnType<typeof fixture>>['report']) => { r.notarized = false; },
    (r: Awaited<ReturnType<typeof fixture>>['report']) => { r.files[0].name = '../outside.zip'; },
    (r: Awaited<ReturnType<typeof fixture>>['report']) => { r.files[1] = r.files[0]; },
  ]) {
    const { directory, report } = await fixture();
    try {
      mutate(report);
      writeFileSync(join(directory, 'release.json'), JSON.stringify(report));
      await assert.rejects(validateCandidate(directory, expected));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
