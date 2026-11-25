/**
 * The app's decisions that need no Electron: the profile and its guards (profile.mjs), the origin allowlist and what a
 * view's navigation does (navigation.mjs).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { daemonEnv, daemonOnDefaultPort, resolveProfile } from '../src/profile.mjs';
import { OriginAllowlist, decide, shellArtifactId, subframeAllowed } from '../src/navigation.mjs';

const user = '/Users/someone';

describe('profile', () => {
  const dev = (argv, env = {}) => resolveProfile({ argv, env, packaged: false, userHome: user, accountHome: user });

  it('a development run with a home and a port of its own starts, with Electron\'s folders under the home', () => {
    const profile = dev(['--home', '/tmp/p/oa', '--port', '4891']);
    assert.deepEqual(profile.problems, []);
    assert.equal(profile.home, '/tmp/p/oa');
    assert.equal(profile.port, 4891);
    assert.deepEqual(profile.paths, {
      userData: '/tmp/p/oa/desktop/user-data',
      sessionData: '/tmp/p/oa/desktop/session',
      logs: '/tmp/p/oa/desktop/logs',
      crashDumps: '/tmp/p/oa/desktop/crash-dumps',
    });
  });

  it('takes the home and the port from the environment too; arguments win', () => {
    assert.equal(dev([], { OPEN_ARTIFACT_HOME: '/tmp/e', OPEN_ARTIFACT_PORT: '4892' }).home, '/tmp/e');
    assert.equal(dev(['--home=/tmp/a', '--port=4893'], { OPEN_ARTIFACT_HOME: '/tmp/e', OPEN_ARTIFACT_PORT: '4892' }).port, 4893);
    assert.equal(dev(['--home=/tmp/a', '--port=4893'], { OPEN_ARTIFACT_HOME: '/tmp/e' }).home, '/tmp/a');
  });

  it('a development run refuses the default home, under HOME or under the account\'s real home', () => {
    assert.match(dev(['--port', '4891']).problems.join(' '), /default home/);
    assert.match(dev(['--home', '~/.agents/open-artifact', '--port', '4891']).problems.join(' '), /default home/);
    const elsewhere = resolveProfile({ argv: ['--home', `${user}/.agents/open-artifact`, '--port', '4891'], packaged: false, userHome: '/tmp/fake-home', accountHome: user });
    assert.match(elsewhere.problems.join(' '), /default home/);
  });

  it('a development run refuses port 4800, and no port at all', () => {
    assert.match(dev(['--home', '/tmp/p', '--port', '4800']).problems.join(' '), /4800/);
    assert.match(dev(['--home', '/tmp/p'], { OPEN_ARTIFACT_PORT: '4800' }).problems.join(' '), /4800/);
    assert.match(dev(['--home', '/tmp/p']).problems.join(' '), /needs a port/);
    assert.match(dev(['--home', '/tmp/p', '--port', 'abc']).problems.join(' '), /not a port/);
  });

  it('a packaged app runs on the default home and port, with Electron\'s own folders', () => {
    const profile = resolveProfile({ argv: [], env: {}, packaged: true, userHome: user, accountHome: user });
    assert.deepEqual(profile.problems, []);
    assert.equal(profile.home, `${user}/.agents/open-artifact`);
    assert.equal(profile.paths, null);
  });

  it('DevTools only in test mode; --open collects artifacts', () => {
    assert.match(dev(['--home', '/tmp/p', '--port', '4891', '--devtools-port', '9333']).problems.join(' '), /test mode/);
    const test = dev(['--home', '/tmp/p', '--port', '4891', '--test-mode', '--devtools-port', '9333', '--open', 'art_a', '--open=art_b']);
    assert.deepEqual(test.problems, []);
    assert.equal(test.debugPort, 9333);
    assert.deepEqual(test.open, ['art_a', 'art_b']);
  });

  it('a daemon on 4800 is recognised from its daemon.json', () => {
    assert.equal(daemonOnDefaultPort({ url: 'http://127.0.0.1:4800' }), true);
    assert.equal(daemonOnDefaultPort({ url: 'http://127.0.0.1:4891' }), false);
    assert.equal(daemonOnDefaultPort(null), false);
  });

  it('the daemon starts with the profile\'s home and port, without another daemon\'s entry or an agent\'s session', () => {
    const env = daemonEnv({ PATH: '/bin', OPEN_ARTIFACT_DAEMON_BIN: '/x', OPEN_ARTIFACT_SESSION: 's', OPEN_ARTIFACT_HARNESS: 'h', ELECTRON_RUN_AS_NODE: '1', OA_DESKTOP_TEST: '1' }, { home: '/tmp/p', port: 4891 });
    assert.deepEqual(env, { PATH: '/bin', OPEN_ARTIFACT_HOME: '/tmp/p', OPEN_ARTIFACT_PORT: '4891' });
  });
});

describe('navigation', () => {
  const allowlist = new OriginAllowlist();
  allowlist.setDaemon('http://127.0.0.1:4891');
  allowlist.fromDaemon({
    origins: [],
    entries: [{ origin: 'http://127.0.0.1:5001' }, { pattern: 'http://*.frame.localhost:4891' }, { origin: 'https://remote.example', remote: true }],
  });
  const current = 'art_one';

  it('allows exactly the daemon and the listed local origins', () => {
    assert.equal(allowlist.allows('http://127.0.0.1:4891/a/x'), true);
    assert.equal(allowlist.allows('http://127.0.0.1:5001/docs/'), true);
    assert.equal(allowlist.allows('http://art1.frame.localhost:4891/'), true);
    assert.equal(allowlist.allows('http://frame.localhost:4891/'), false);
    assert.equal(allowlist.allows('http://127.0.0.1:5002/'), false, 'not all of loopback');
    assert.equal(allowlist.allows('https://remote.example/'), false, 'remote pages are not shown');
    assert.equal(allowlist.allows('file:///etc/passwd'), false);
  });

  it('the same artifact stays; another artifact opens a tab; the home page goes to the first tab', () => {
    assert.deepEqual(decide('http://127.0.0.1:4891/a/art_one?x=1#p', { allowlist, current }), { action: 'allow' });
    assert.deepEqual(decide('http://127.0.0.1:4891/a/art_two?oa_view=t', { allowlist, current }), { action: 'open-tab', id: 'art_two' });
    assert.deepEqual(decide('http://127.0.0.1:5001/a/art_three', { allowlist, current }), { action: 'open-tab', id: 'art_three' });
    assert.deepEqual(decide('http://127.0.0.1:4891/', { allowlist, current }), { action: 'home' });
    assert.deepEqual(decide('http://127.0.0.1:4891/?tab=types', { allowlist, current }), { action: 'home' });
  });

  it('other pages of allowed origins are blocked; the web goes to the system browser; the rest is blocked', () => {
    assert.deepEqual(decide('http://127.0.0.1:4891/types', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('http://127.0.0.1:5001/', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('https://example.com/x', { allowlist, current }), { action: 'external', url: 'https://example.com/x' });
    assert.deepEqual(decide('http://127.0.0.1:5002/', { allowlist, current }), { action: 'external', url: 'http://127.0.0.1:5002/' });
    assert.deepEqual(decide('file:///etc/passwd', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('javascript:alert(1)', { allowlist, current }), { action: 'block' });
    assert.deepEqual(decide('not a url', { allowlist, current }), { action: 'block' });
  });

  it('subframes: the page\'s own and allowed origins only', () => {
    assert.equal(subframeAllowed('blob:http://127.0.0.1:5001/1234', allowlist), true);
    assert.equal(subframeAllowed('about:srcdoc', allowlist), true);
    assert.equal(subframeAllowed('http://127.0.0.1:5001/docs/', allowlist), true);
    assert.equal(subframeAllowed('https://example.com/', allowlist), false);
  });

  it('reads the artifact id of a Shell address', () => {
    assert.equal(shellArtifactId('http://127.0.0.1:4891/a/art_x%20y?z'), 'art_x y');
    assert.equal(shellArtifactId('http://127.0.0.1:4891/b/art_x'), null);
  });
});
