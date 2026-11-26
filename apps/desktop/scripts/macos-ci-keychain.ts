// CI credentials are imported into an isolated temporary keychain, never into the login keychain.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const temp = process.env.RUNNER_TEMP;
if (process.platform !== 'darwin' || !temp || !isAbsolute(temp)) throw new Error('Requires macOS and an absolute RUNNER_TEMP');
const keychain = join(temp, 'open-artifact-signing.keychain-db');
const previousFile = join(temp, 'open-artifact-keychains-before.json');
const p12 = join(temp, 'open-artifact-signing.p12');
const p8 = join(temp, 'open-artifact-notary.p8');
const probe = join(temp, 'open-artifact-signing-probe');

function run(program: string, args: string[]) {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed; credential arguments and command output withheld`);
  return `${result.stdout}${result.stderr}`;
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

if (process.argv[2] === 'prepare') {
  const sha1 = required('OA_MAC_SIGNING_SHA1');
  const team = required('OA_APPLE_TEAM_ID');
  if (!/^[A-F0-9]{40}$/.test(sha1) || !/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid signing fingerprint or Team ID');
  if (existsSync(previousFile) || existsSync(keychain)) throw new Error('Temporary keychain already exists; run cleanup first');
  const previous = [...run('security', ['list-keychains', '-d', 'user']).matchAll(/"([^"\n]+)"/g)].map(m => m[1]);
  if (!previous.length) throw new Error('Could not record previous keychain search list');
  writeFileSync(previousFile, JSON.stringify(previous), { mode: 0o600 });
  const password = randomBytes(32).toString('hex');
  writeFileSync(p12, Buffer.from(required('OA_MAC_CERTIFICATE_BASE64'), 'base64'), { mode: 0o600 });
  run('security', ['create-keychain', '-p', password, keychain]);
  run('security', ['set-keychain-settings', '-lut', '21600', keychain]);
  run('security', ['unlock-keychain', '-p', password, keychain]);
  run('security', ['import', p12, '-k', keychain, '-P', required('OA_MAC_CERTIFICATE_PASSWORD'), '-f', 'pkcs12', '-T', '/usr/bin/codesign']);
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain]);
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...previous]);
  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]);
  if (!identities.split('\n').some(line => line.includes(sha1) && line.includes('Developer ID Application:') && line.includes(`(${team})`)))
    throw new Error('Selected Developer ID Application identity and team are unavailable');
  // A real signing probe verifies private-key possession before spending time on a full build.
  writeFileSync(`${probe}.c`, 'int main(void) { return 0; }\n', { mode: 0o600 });
  run('xcrun', ['clang', `${probe}.c`, '-o', probe]);
  run('codesign', ['--force', '--sign', sha1, '--keychain', keychain, '--timestamp', '--options', 'runtime', probe]);
  run('codesign', ['--verify', '--strict', probe]);
  run('codesign', ['-d', `--extract-certificates=${probe}-cert-`, probe]);
  const fingerprint = run('openssl', ['x509', '-inform', 'DER', '-in', `${probe}-cert-0`, '-noout', '-fingerprint', '-sha1'])
    .trim().split('=')[1]?.replaceAll(':', '');
  if (fingerprint !== sha1) throw new Error('Signing probe certificate differs');
  run(probe, []);
  const args = ['notarytool', 'store-credentials', 'open-artifact-notary', '--keychain', keychain];
  if (process.env.OA_NOTARY_API_KEY_BASE64) {
    writeFileSync(p8, Buffer.from(process.env.OA_NOTARY_API_KEY_BASE64, 'base64'), { mode: 0o600 });
    args.push('--key', p8, '--key-id', required('OA_NOTARY_KEY_ID'), '--issuer', required('OA_NOTARY_ISSUER_ID'));
  } else {
    args.push('--apple-id', required('OA_NOTARY_APPLE_ID'), '--password', required('OA_NOTARY_APP_PASSWORD'), '--team-id', team);
  }
  run('xcrun', args);
  run('xcrun', ['notarytool', 'history', '--keychain-profile', 'open-artifact-notary', '--keychain', keychain, '--output-format', 'json']);
  console.log('Developer ID private-key signing, exact fingerprint and Apple notarization access passed.');
} else if (process.argv[2] === 'cleanup') {
  let failed = false;
  if (existsSync(previousFile)) {
    try { run('security', ['list-keychains', '-d', 'user', '-s', ...JSON.parse(readFileSync(previousFile, 'utf8')) as string[]]); }
    catch { failed = true; }
  }
  if (existsSync(keychain)) {
    try { run('security', ['delete-keychain', keychain]); } catch { failed = true; }
  }
  for (const file of [p12, p8, probe, `${probe}.c`, previousFile, ...[0, 1, 2, 3].map(n => `${probe}-cert-${n}`)]) rmSync(file, { force: true });
  if (failed) throw new Error('Temporary keychain cleanup failed');
  console.log('Temporary signing and notarization credentials removed.');
} else throw new Error('Expected prepare or cleanup');
