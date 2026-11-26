// Developer ID distribution: sign inside out, notarize, staple, then archive the stapled app.
import { sign } from '@electron/osx-sign';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './release.ts';

export type Run = (program: string, args: string[]) => string;
export const run: Run = (program, args) => {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status}): ${result.stdout}${result.stderr}`);
  // codesign writes its display output to stderr.
  return program === 'codesign' ? `${result.stdout}${result.stderr}` : result.stdout;
};

export function signingConfig(env: NodeJS.ProcessEnv = process.env) {
  const identity = env.OA_MAC_SIGNING_SHA1 ?? '';
  const team = env.OA_APPLE_TEAM_ID ?? '';
  if (!/^[A-F0-9]{40}$/.test(identity)) throw new Error('OA_MAC_SIGNING_SHA1 must be the full uppercase Developer ID Application SHA-1');
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('OA_APPLE_TEAM_ID must be the 10-character Apple Team ID');
  if (!env.OA_NOTARY_PROFILE) throw new Error('OA_NOTARY_PROFILE is required for release packaging');
  return { identity, team, profile: env.OA_NOTARY_PROFILE, keychain: env.OA_MAC_KEYCHAIN };
}
type Signing = ReturnType<typeof signingConfig>;
const keychainArgs = (config: Signing) => config.keychain ? ['--keychain', config.keychain] : [];

export function signingPreflight(config: Signing, command = run) {
  const identities = command('security', ['find-identity', '-v', '-p', 'codesigning', ...(config.keychain ? [config.keychain] : [])]);
  if (!identities.split('\n').some(line => line.includes(config.identity) && line.includes('Developer ID Application:') && line.includes(`(${config.team})`)))
    throw new Error('Selected Developer ID Application identity and Team ID are unavailable');
  command('xcrun', ['notarytool', 'history', '--keychain-profile', config.profile, ...keychainArgs(config), '--output-format', 'json']);
}

export function verifySignedApp(app: string, config: Signing, version: string, work: string, command = run) {
  const info: { CFBundleIdentifier?: string; CFBundleShortVersionString?: string; CFBundleVersion?: string } = JSON.parse(
    command('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]),
  );
  if (info.CFBundleIdentifier !== 'dev.openartifact.desktop' || info.CFBundleShortVersionString !== version || info.CFBundleVersion !== version)
    throw new Error('App bundle ID or version differs from the release');
  command('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const details = command('codesign', ['-d', '--verbose=4', app]);
  if (!details.includes('Authority=Developer ID Application:') || !details.includes(`TeamIdentifier=${config.team}`) ||
      !/flags=0x[\da-f]+\([^)]*runtime\)/i.test(details) || !details.includes('Timestamp='))
    throw new Error('Missing Developer ID, matching team, hardened runtime or secure timestamp');
  const prefix = join(work, 'signer-');
  command('codesign', ['-d', `--extract-certificates=${prefix}`, app]);
  const fingerprint = command('openssl', ['x509', '-inform', 'DER', '-in', `${prefix}0`, '-noout', '-fingerprint', '-sha1'])
    .trim().split('=')[1]?.replaceAll(':', '');
  if (fingerprint !== config.identity) throw new Error('App signer certificate fingerprint differs');
}

export function notarize(file: string, config: Signing, work: string, label: string, command = run) {
  const raw = command('xcrun', ['notarytool', 'submit', file, '--keychain-profile', config.profile,
    ...keychainArgs(config), '--wait', '--timeout', '30m', '--output-format', 'json']);
  writeFileSync(join(work, `${label}-notary-result.json`), raw);
  const result: { id?: string; status?: string } = JSON.parse(raw);
  if (!result.id) throw new Error('Apple returned no notarization submission ID');
  if (result.status !== 'Accepted') {
    command('xcrun', ['notarytool', 'log', result.id, '--keychain-profile', config.profile,
      ...keychainArgs(config), join(work, `${label}-notary-log.json`)]);
    throw new Error(`Notarization ${result.status}; see ${label}-notary-log.json`);
  }
  return result.id;
}

export async function distributeMac(app: string, version: string, config: Signing, dist: string) {
  const work = mkdtempSync(join(dist, 'notary-'));
  // Only this directory is uploaded. Clear old public files before starting a new release.
  const output = join(dist, 'release');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output);
  console.log('package: signing nested code with Developer ID and hardened runtime');
  await sign({
    app, platform: 'darwin', identity: config.identity, identityValidation: false,
    ...(config.keychain ? { keychain: config.keychain } : {}),
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    optionsForFile: () => ({ entitlements: join(import.meta.dirname, '..', 'build', 'entitlements.mac.plist'), hardenedRuntime: true }),
  });
  verifySignedApp(app, config, version, work);
  const submission = join(work, 'submission.zip');
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, submission]);
  console.log('package: submitting App to Apple notarization');
  const appSubmission = notarize(submission, config, work, 'app');
  console.log(`package: App notarization Accepted (${appSubmission}); stapling and verifying`);
  run('xcrun', ['stapler', 'staple', app]);
  run('xcrun', ['stapler', 'validate', app]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  const stem = `Open-Artifact-${version}-darwin-arm64`;
  const zip = join(output, `${stem}.zip`);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const extracted = join(work, 'extracted');
  mkdirSync(extracted);
  run('ditto', ['-x', '-k', zip, extracted]);
  const extractedApp = join(extracted, 'Open Artifact.app');
  verifySignedApp(extractedApp, config, version, work);
  run('xcrun', ['stapler', 'validate', extractedApp]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', extractedApp]);
  const root = join(work, 'dmg-root');
  mkdirSync(root);
  run('ditto', [extractedApp, join(root, 'Open Artifact.app')]);
  symlinkSync('/Applications', join(root, 'Applications'));
  const dmg = join(output, `${stem}.dmg`);
  run('hdiutil', ['create', '-volname', `Open Artifact ${version}`, '-srcfolder', root, '-format', 'ULFO', dmg]);
  run('codesign', ['--sign', config.identity, '--timestamp', ...keychainArgs(config), dmg]);
  console.log('package: submitting signed DMG to Apple notarization');
  const dmgSubmission = notarize(dmg, config, work, 'dmg');
  console.log(`package: DMG notarization Accepted (${dmgSubmission}); stapling and verifying`);
  run('xcrun', ['stapler', 'staple', dmg]);
  run('xcrun', ['stapler', 'validate', dmg]);
  run('codesign', ['--verify', '--strict', dmg]);
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', dmg]);
  const files = [];
  for (const file of [zip, dmg]) {
    const digest = await sha256(file);
    const name = file.slice(output.length + 1);
    writeFileSync(`${file}.sha256`, `${digest}  ${name}\n`);
    files.push({ name, sha256: digest });
  }
  const report = {
    schema: 1, version, arch: 'arm64', appId: 'dev.openartifact.desktop',
    sourceCommit: run('git', ['-C', join(import.meta.dirname, '..'), 'rev-parse', 'HEAD']).trim(),
    signingSha1: config.identity, teamId: config.team, notarized: true, appSubmission, dmgSubmission, files,
  };
  writeFileSync(join(output, 'release.json'), `${JSON.stringify(report, null, 2)}\n`);
  rmSync(work, { recursive: true, force: true });
  console.log(`package: signed and notarized ZIP, DMG and checksums in ${output}`);
}
