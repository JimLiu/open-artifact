import type { RemoteRecord } from '../src/library.ts';
import type { DesktopMenuItem, MenuOptions } from '../src/menu.ts';
import type { ServersView } from '../src/servers.ts';
import { present } from './lib/assertions.ts';
const setUnknown = (settings: Settings, name: unknown, value: unknown): void => Reflect.apply(settings.set, settings, [name, value]);
/**
 * The app's decisions that need no Electron: the profile and its guards (profile.mjs), the origin allowlist and what a
 * view's navigation does (navigation.mjs), back and forward over tabs (history.mjs), the window's own settings
 * (settings.mjs), and what the home page may ask of the Library API (library.mjs).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { TabHistory } from '../src/history.ts';
import { LibraryError, createArg, idArg, libraryClient, patchArg, startsBlank } from '../src/library.ts';
import { OriginAllowlist, decide, decideServer, externalTarget, serverSubframeAllowed, shellArtifactId, subframeAllowed } from '../src/navigation.ts';
import { onThisComputer } from '../src/offline.ts';
import { daemonEnv, daemonOnDefaultPort, resolveProfile } from '../src/profile.ts';
import { Servers, serverAddress, suggestName } from '../src/servers.ts';
import { Settings, chromiumLang } from '../src/settings.ts';
import { until } from './lib/env.ts';

const user = '/Users/someone';

describe('profile', () => {
  const dev = (argv: string[], env = {}) => resolveProfile({ argv, env, packaged: false, userHome: user, accountHome: user });

  it("a development run with a home and a port of its own starts, with Electron's folders under the home", () => {
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

  it("a development run refuses the default home, under HOME or under the account's real home", () => {
    assert.match(dev(['--port', '4891']).problems.join(' '), /default home/);
    assert.match(dev(['--home', '~/.agents/open-artifact', '--port', '4891']).problems.join(' '), /default home/);
    const elsewhere = resolveProfile({
      argv: ['--home', `${user}/.agents/open-artifact`, '--port', '4891'],
      packaged: false,
      userHome: '/tmp/fake-home',
      accountHome: user,
    });
    assert.match(elsewhere.problems.join(' '), /default home/);
  });

  it('a development run refuses port 4800, and no port at all', () => {
    assert.match(dev(['--home', '/tmp/p', '--port', '4800']).problems.join(' '), /4800/);
    assert.match(dev(['--home', '/tmp/p'], { OPEN_ARTIFACT_PORT: '4800' }).problems.join(' '), /4800/);
    assert.match(dev(['--home', '/tmp/p']).problems.join(' '), /needs a port/);
    assert.match(dev(['--home', '/tmp/p', '--port', 'abc']).problems.join(' '), /not a port/);
  });

  it("a packaged app runs on the default home and port, with Electron's own folders", () => {
    const profile = resolveProfile({ argv: [], env: {}, packaged: true, userHome: user, accountHome: user });
    assert.deepEqual(profile.problems, []);
    assert.equal(profile.home, `${user}/.agents/open-artifact`);
    assert.equal(profile.paths, null);
    assert.equal(profile.guarded, false);
  });

  it('the packaged app in test mode is guarded as a development run: its own home, port and Electron folders', () => {
    const packagedTest = (argv: string[], env = {}) =>
      resolveProfile({ argv: ['--test-mode', ...argv], env, packaged: true, userHome: user, accountHome: user });
    const profile = packagedTest(['--home', '/tmp/p/oa', '--port', '4891']);
    assert.deepEqual(profile.problems, []);
    assert.equal(profile.guarded, true);
    assert.equal(present(profile.paths).userData, '/tmp/p/oa/desktop/user-data');
    assert.equal(present(profile.paths).crashDumps, '/tmp/p/oa/desktop/crash-dumps');
    assert.match(packagedTest(['--port', '4891']).problems.join(' '), /default home/);
    assert.match(packagedTest(['--home', '/tmp/p', '--port', '4800']).problems.join(' '), /4800/);
    assert.match(packagedTest(['--home', '/tmp/p']).problems.join(' '), /needs a port/);
    // OA_DESKTOP_TEST=1 is test mode too.
    assert.match(
      resolveProfile({ argv: [], env: { OA_DESKTOP_TEST: '1' }, packaged: true, userHome: user, accountHome: user }).problems.join(' '),
      /default home/,
    );
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

  it("the daemon starts with the profile's home and port, without another daemon's entry or an agent's session", () => {
    const env = daemonEnv(
      { PATH: '/bin', OPEN_ARTIFACT_DAEMON_BIN: '/x', OPEN_ARTIFACT_SESSION: 's', OPEN_ARTIFACT_HARNESS: 'h', ELECTRON_RUN_AS_NODE: '1', OA_DESKTOP_TEST: '1' },
      { home: '/tmp/p', port: 4891 },
    );
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

  it("subframes: the page's own and allowed origins only", () => {
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

describe('navigation: the sites this computer is connected to', () => {
  const allowlist = new OriginAllowlist();
  allowlist.setDaemon('http://127.0.0.1:4891');
  allowlist.fromDaemon({ origins: [], entries: [{ pattern: 'http://*.frame.localhost:4891' }] });
  allowlist.setServers(['https://oa.example.com', 'http://localhost:5100/', 'not a url', 'ftp://x.example', 'http://127.0.0.1:4891']);

  it("only the sites in the list, and never this computer's own pages", () => {
    assert.deepEqual(allowlist.servers, ['https://oa.example.com', 'http://localhost:5100', 'http://127.0.0.1:4891']);
    assert.equal(allowlist.serverOf('https://oa.example.com/a/art_1'), 'https://oa.example.com');
    assert.equal(allowlist.serverOf('http://localhost:5100/auth/sign-in'), 'http://localhost:5100');
    assert.equal(allowlist.serverOf('https://other.example.com/'), null);
    assert.equal(allowlist.serverOf('http://localhost:5101/'), null, 'another port is another origin');
    assert.equal(allowlist.serverOf('http://127.0.0.1:4891/a/art_1'), null, 'the daemon is never a site');
    assert.equal(allowlist.allows('https://oa.example.com/'), false, 'a site never joins the local allowlist');
  });

  it("a site's page stays on its site; local Shells open tabs; everything else goes to the browser", () => {
    assert.deepEqual(decideServer('https://oa.example.com/a/art_1?x', { allowlist }), { action: 'allow' });
    assert.deepEqual(decideServer('http://localhost:5100/auth/sign-in?return_to=%2F', { allowlist }), { action: 'allow' });
    assert.deepEqual(decideServer('http://127.0.0.1:4891/a/art_2', { allowlist }), { action: 'open-tab', id: 'art_2' });
    assert.deepEqual(decideServer('http://127.0.0.1:4891/', { allowlist }), { action: 'home' });
    assert.deepEqual(decideServer('http://127.0.0.1:4891/types', { allowlist }), { action: 'block' });
    assert.deepEqual(decideServer('https://accounts.example.net/login', { allowlist }), { action: 'external', url: 'https://accounts.example.net/login' });
    assert.deepEqual(decideServer('file:///etc/passwd', { allowlist }), { action: 'block' });
    assert.deepEqual(decideServer('javascript:alert(1)', { allowlist }), { action: 'block' });
  });

  it("a site's subframes: its own and the web (its CSP decides), never this computer's pages", () => {
    assert.equal(serverSubframeAllowed('http://art1--x.content.localhost:5100/', allowlist), true);
    assert.equal(serverSubframeAllowed('about:srcdoc', allowlist), true);
    assert.equal(serverSubframeAllowed('http://art1.frame.localhost:4891/docs/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://127.0.0.1:4891/a/art_1', allowlist), false);
    assert.equal(serverSubframeAllowed('file:///etc/passwd', allowlist), false);
  });

  it('a site subframe allows the connected site, its content host and the public web, and refuses this machine', () => {
    assert.equal(serverSubframeAllowed('about:blank', allowlist), true);
    assert.equal(serverSubframeAllowed('blob:https://oa.example.com/1234', allowlist), true);
    assert.equal(serverSubframeAllowed('https://oa.example.com/a/art_1', allowlist), true);
    assert.equal(serverSubframeAllowed('http://localhost:5100/x', allowlist), true, 'the connected site, even on localhost');
    assert.equal(serverSubframeAllowed('https://example.com/x', allowlist), true);
    assert.equal(serverSubframeAllowed('http://127.0.0.1:9/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://127.255.255.255/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://[::1]/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://[::ffff:127.0.0.1]/', allowlist), false, 'IPv4-mapped loopback');
    assert.equal(serverSubframeAllowed('http://10.1.2.3/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://172.16.0.1/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://172.31.255.255/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://192.168.0.8/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://169.254.169.254/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://not-declared.localhost/', allowlist), false);
    assert.equal(serverSubframeAllowed('http://content.localhost/', allowlist), false, 'a content host needs a label in front');
    assert.equal(serverSubframeAllowed('http://172.32.0.1/', allowlist), true, 'outside 172.16/12');
    assert.equal(serverSubframeAllowed('http://169.255.1.1/', allowlist), true);
    assert.equal(serverSubframeAllowed('http://localhost.example.com/', allowlist), true);
    assert.equal(serverSubframeAllowed('http://127.0.0.1.example.com/', allowlist), true);
    assert.equal(serverSubframeAllowed('javascript:alert(1)', allowlist), false);
    // Not the inverse of offline.ts: those private addresses are "not this computer" there, and still refused here.
    assert.equal(onThisComputer('http://192.168.1.2/'), false);
    assert.equal(serverSubframeAllowed('http://192.168.1.2/', allowlist), false);
    assert.equal(onThisComputer('http://10.0.0.1/'), false);
    assert.equal(serverSubframeAllowed('http://10.0.0.1/', allowlist), false);
    assert.equal(onThisComputer('http://localhost:5100/'), true);
    assert.equal(serverSubframeAllowed('http://localhost:5100/', allowlist), true);
    // A top-level navigation to loopback is still handed to the system browser.
    assert.deepEqual(decide('http://127.0.0.1:5002/', { allowlist, current: 'art_one' }), { action: 'external', url: 'http://127.0.0.1:5002/' });
    assert.equal(serverSubframeAllowed('http://127.0.0.1:5002/', allowlist), false);
  });

  it('an external link is http(s) with the userinfo removed, and the log is only the origin and the path', () => {
    assert.equal(externalTarget('file:///etc/passwd'), null);
    assert.equal(externalTarget('javascript:alert(1)'), null);
    assert.equal(externalTarget('not a url'), null);
    const secret = externalTarget('https://user:pw@host/x?token=secret#h');
    assert.deepEqual(secret, { href: 'https://host/x?token=secret#h', log: 'https://host/x' });
    assert.equal(secret?.href.includes('pw'), false);
    assert.equal(secret?.log.includes('pw'), false);
    assert.equal(secret?.log.includes('token'), false);
    assert.deepEqual(externalTarget('https://example.com/x'), { href: 'https://example.com/x', log: 'https://example.com/x' });
    // Loopback is still a link the browser may open. Refusing it would change decide's external result.
    assert.equal(externalTarget('http://127.0.0.1:5002/')?.href, 'http://127.0.0.1:5002/');
  });
});

describe('the servers switcher, as the main process keeps it', () => {
  it('takes https; asks before plain http; refuses the rest', () => {
    assert.deepEqual(serverAddress('oa.example.com'), { host: 'https://oa.example.com', insecure: false });
    assert.deepEqual(serverAddress(' https://oa.example.com/some/path '), { host: 'https://oa.example.com', insecure: false });
    assert.deepEqual(serverAddress('http://10.0.0.2:8080'), { host: 'http://10.0.0.2:8080', needsConfirm: 'http' });
    assert.deepEqual(serverAddress('http://10.0.0.2:8080', { insecure: true }), { host: 'http://10.0.0.2:8080', insecure: true });
    for (const bad of ['', 'ftp://x.example', 'https://user:pw@x.example', 'file:///etc']) assert.throws(() => serverAddress(bad), bad);
  });

  it('suggests a name the daemon takes, from the address', () => {
    assert.equal(suggestName('https://oa.example.com'), 'oa');
    assert.equal(suggestName('https://oa.example.com', ['oa', 'oa-2']), 'oa-3');
    assert.equal(suggestName('http://localhost:5100'), 'localhost');
    assert.equal(suggestName('https://[::1]:5100'), 'server');
  });

  /** A fake of the daemon's routes: what was asked, and the settings as the daemon would keep them. */
  function fakeDaemon() {
    const calls: [string, unknown][] = [];
    const daemon: { remotes: (RemoteRecord & { token?: string })[]; cloud: { default: string | null; publish: string }; waits: number } = {
      remotes: [],
      cloud: { default: null, publish: 'manual' },
      waits: 0,
    };
    const library = {
      async call(name: string, { body }: { body?: { name?: string; host?: string; default?: string; publish?: string } } = {}) {
        calls.push([name, body ?? null]);
        if (name === 'remotes')
          return {
            remotes: daemon.remotes.map((r) => ({ ...r, default: r.name === (daemon.cloud.default ?? (daemon.remotes.length === 1 ? r.name : null)) })),
            cloud: daemon.cloud,
          };
        if (name === 'desktop.settings') return { openInDesktop: false };
        if (name === 'remotes.add')
          return {
            name: body?.name ?? '',
            host: body?.host ?? '',
            user_code: 'ABCD-EFGH',
            verification_uri: `${body?.host}/link/device`,
            verification_uri_complete: `${body?.host}/link/device?user_code=ABCD-EFGH`,
          };
        if (name === 'remotes.add.wait') {
          daemon.waits += 1;
          daemon.remotes.push({
            name: body?.name ?? '',
            host: 'https://oa.example.com',
            user: { name: 'Ada' },
            signedIn: true,
            reachable: true,
            connected: true,
            token: 'secret-token',
            artifacts: [],
          });
          return { status: 'done' };
        }
        if (name === 'cloud.settings') {
          Object.assign(daemon.cloud, body);
          return { cloud: daemon.cloud };
        }
        if (name === 'remotes.remove') {
          daemon.remotes = daemon.remotes.filter((r) => r.name !== body?.name);
          return { removed: body?.name, unlinked: [] };
        }
        throw Object.assign(new Error(`no route ${name}`), { status: 404 });
      },
    };
    const client = libraryClient({
      state: () => ({ url: 'http://127.0.0.1:1', token: 'fixture' }),
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        const body = init?.body ? (JSON.parse(String(init.body)) as { name?: string; host?: string; default?: string; publish?: string }) : undefined;
        return Response.json(await library.call(url.pathname.replace('/api/open-artifact.', ''), { body }));
      },
    });
    return { calls, daemon, library: client };
  }

  it('adds with no browser, sets only the default, asks once, and gives the page no token', async () => {
    const { calls, daemon, library } = fakeDaemon();
    let asked = false;
    const views: ServersView[] = [];
    const servers = new Servers({
      library,
      connected: () => true,
      asked: () => asked,
      setAsked: (on) => (asked = on),
      onChange: (v) => views.push(v),
      log: () => {},
    });
    await servers.refresh();
    assert.equal(servers.view().remotes.length, 0);
    assert.deepEqual(await servers.add({ host: 'http://10.0.0.2' }), { needsConfirm: 'http', host: 'http://10.0.0.2' });
    assert.equal(
      calls.some(([name]) => name === 'remotes.add'),
      false,
      'nothing sent before the http question was answered',
    );

    await servers.add({ host: 'oa.example.com', name: 'team' });
    assert.deepEqual(present(calls.find(([name]) => name === 'remotes.add'))[1], { name: 'team', host: 'https://oa.example.com', browse: false });
    await until(() => servers.view().adding?.state === 'done', 2000);
    const view = servers.view();
    assert.deepEqual([view.remotes[0].name, view.remotes[0].user, view.remotes[0].isDefault], ['team', 'Ada', true]);
    assert.equal(JSON.stringify(views).includes('secret-token'), false, 'a token reached the page');

    assert.equal(servers.shouldAsk(), true);
    await servers.answerAsk(false);
    assert.equal(asked, true);
    assert.equal(daemon.cloud.publish, 'manual', 'not turned on by a no');
    daemon.remotes.push({ name: 'other', host: 'https://other.example.com', signedIn: true, reachable: false, artifacts: [] });
    await servers.refresh();
    const chosen = await servers.setDefault('other');
    assert.deepEqual(present(calls.filter(([name]) => name === 'cloud.settings').at(-1))[1], { default: 'other' }, 'only the default is sent');
    assert.deepEqual(chosen, { ask: false }, 'asked once only');
    assert.deepEqual(
      [...servers.reachable()],
      [
        ['https://oa.example.com', true],
        ['https://other.example.com', false],
      ],
    );
    await servers.setPublish(true);
    assert.equal(daemon.cloud.publish, 'auto');
    await servers.remove('other');
    assert.deepEqual(
      servers.view().remotes.map((r) => r.name),
      ['team'],
    );
    await assert.rejects(() => servers.setDefault('nobody'));
  });

  it("insecure http is sent only once the person said so, as the CLI's --insecure-http", async () => {
    const { calls, library } = fakeDaemon();
    const servers = new Servers({ library, connected: () => true, asked: () => true, setAsked: () => {}, log: () => {} });
    await servers.add({ host: 'http://10.0.0.2:8080', name: 'lab', insecure: true });
    assert.deepEqual(present(calls.find(([name]) => name === 'remotes.add'))[1], {
      name: 'lab',
      host: 'http://10.0.0.2:8080',
      browse: false,
      insecureHttp: true,
    });
    await servers.cancel();
  });
});

describe('profile: test-mode looks', () => {
  const dev = (argv: string[]) =>
    resolveProfile({ argv: ['--home', '/tmp/p', '--port', '4891', ...argv], env: {}, packaged: false, userHome: user, accountHome: user });

  it('--locale, --theme and --thumbnails only in test mode, with known values', () => {
    const test = dev(['--test-mode', '--locale', 'zh', '--theme', 'dark', '--thumbnails']);
    assert.deepEqual(test.problems, []);
    assert.deepEqual([test.locale, test.theme, test.thumbnails], ['zh', 'dark', true]);
    const plain = dev(['--test-mode']);
    assert.deepEqual([plain.locale, plain.theme, plain.thumbnails], [null, null, false]);
    for (const flag of [['--locale', 'en'], ['--theme', 'light'], ['--thumbnails']]) {
      assert.match(dev(flag).problems.join(' '), /test mode only/, flag.join(' '));
    }
    assert.match(dev(['--test-mode', '--locale', 'fr']).problems.join(' '), /en or zh/);
    assert.match(dev(['--test-mode', '--theme', 'sepia']).problems.join(' '), /light or dark/);
  });
});

describe('tab history', () => {
  it('goes back and forward like a browser; a visit after going back drops what was ahead', () => {
    const h = new TabHistory('home');
    assert.equal(h.canBack, false);
    h.visit('a');
    h.visit('b');
    h.visit('b');
    assert.deepEqual(h.entries, ['home', 'a', 'b']);
    assert.equal(h.back(), 'a');
    assert.equal(h.back(), 'home');
    assert.equal(h.back(), null);
    assert.equal(h.forward(), 'a');
    h.visit('c');
    assert.deepEqual(h.entries, ['home', 'a', 'c']);
    assert.equal(h.canForward, false);
    assert.equal(h.forward(), null);
  });

  it("a closed tab's entries go, and two same entries that then meet become one", () => {
    const h = new TabHistory('home');
    for (const id of ['a', 'b', 'a', 'c']) h.visit(id);
    h.remove('b');
    assert.deepEqual(h.entries, ['home', 'a', 'c']);
    assert.equal(h.current, 'c');
    h.back();
    h.remove('a');
    assert.deepEqual(h.entries, ['home', 'c']);
    assert.equal(h.current, 'home');
    h.remove('home', 'home');
    h.remove('c', 'home');
    assert.deepEqual(h.entries, ['home']);
  });
});

describe('settings', () => {
  it("keeps the sidebar's state in settings.json, refuses what is not a setting, and starts from defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-desktop-settings-'));
    try {
      const first = new Settings(dir);
      assert.equal(first.get('sidebarCollapsed'), false);
      first.set('sidebarCollapsed', true);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), {
        sidebarCollapsed: true,
        theme: 'system',
        locale: 'system',
        artifactsFolder: '',
        autoPublishAsked: false,
        appAutoCheck: true,
        appAutoDownload: false,
      });
      assert.equal(new Settings(dir).get('sidebarCollapsed'), true);
      assert.throws(() => setUnknown(first, 'sidebarCollapsed', 'yes'), /not a setting/);
      assert.throws(() => setUnknown(first, 'token', 'x'), /not a setting/);
      writeFileSync(join(dir, 'settings.json'), '{ not json');
      assert.equal(new Settings(dir).get('sidebarCollapsed'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the look and the language: only their choices, kept, and a stored value that is not one is the default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-desktop-settings-'));
    try {
      const first = new Settings(dir);
      assert.deepEqual([first.get('theme'), first.get('locale')], ['system', 'system']);
      first.set('theme', 'dark');
      first.set('locale', 'zh-CN');
      assert.deepEqual([new Settings(dir).get('theme'), new Settings(dir).get('locale')], ['dark', 'zh-CN']);
      for (const [name, value] of [
        ['theme', 'blue'],
        ['theme', true],
        ['locale', 'zh'],
        ['locale', 'fr'],
        ['locale', ''],
      ]) {
        assert.throws(() => setUnknown(first, name, value), /not a setting/, `${name} = ${value}`);
      }
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sidebarCollapsed: true, theme: 'sepia', locale: 'de' }));
      const read = new Settings(dir);
      assert.deepEqual([read.get('sidebarCollapsed'), read.get('theme'), read.get('locale')], [true, 'system', 'system']);
      // Chromium's --lang: none for the system's language.
      assert.deepEqual(['system', 'en', 'zh-CN', 'zh'].map(chromiumLang), [null, 'en-US', 'zh-CN', 'zh-CN']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('what the home page may ask', () => {
  it('ids are artifact ids, exactly', () => {
    assert.equal(idArg('art_abc'), 'art_abc');
    for (const bad of ['../daemon.json', 'open-artifact://artifact/art_a', '', 7, null, 'a b']) assert.throws(() => idArg(bad), LibraryError, String(bad));
  });

  it('a change is a title or pinned, nothing else', () => {
    assert.deepEqual(patchArg({ title: '  Ferry  ', pinned: true }), { title: 'Ferry', pinned: true });
    for (const bad of [{ owner: 'x' }, { title: '' }, { title: 'x'.repeat(301) }, { pinned: 'yes' }, {}, [], null]) {
      assert.throws(() => patchArg(bad), LibraryError, JSON.stringify(bad));
    }
  });

  it('a new artifact is a type id and a title; the built-in groups say which start blank', () => {
    assert.deepEqual(createArg({ type: 'docs', title: '  Notes ' }), { type: 'docs', title: 'Notes' });
    assert.deepEqual(createArg({ type: 'design' }), { type: 'design', title: '' });
    for (const bad of [{ type: '../x' }, { type: '' }, { type: 3 }, null]) assert.throws(() => createArg(bad), LibraryError, JSON.stringify(bad));
    assert.deepEqual(['docs', 'sheets', 'whiteboard', 'slides', 'design-system'].map(startsBlank), [true, true, true, true, true]);
    assert.deepEqual(['design', 'data', 'motion', 'page', 'my-type'].map(startsBlank), [false, false, false, false, false]);
  });

  it("the client sends the token itself and throws with the daemon's words; without a connection it sends nothing", async () => {
    const sent: { url: string; auth: string | null; method?: string; body?: BodyInit | null }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      sent.push({ url: String(url), auth: new Headers(init?.headers).get('Authorization'), method: init?.method, body: init?.body });
      return new Response(JSON.stringify({ code: 'not_found', message: 'no such artifact' }), { status: 404, headers: { 'content-type': 'application/json' } });
    };
    const client = libraryClient({ state: () => ({ url: 'http://127.0.0.1:4891', token: 'secret' }), fetchImpl });
    await assert.rejects(client.update('art_a', { title: 'x' }), /no such artifact/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].auth, 'Bearer secret');
    assert.match(sent[0].url, /^http:\/\/127\.0\.0\.1:4891\/api\/open-artifact\./);
    const offline = libraryClient({ state: () => null, fetchImpl });
    await assert.rejects(offline.list(), /not connected/);
    assert.equal(sent.length, 1);
  });
});

describe('the service panel and the runtime, as the page is sent them', async () => {
  const { appsView, daemonView, doctorView, serversView } = await import('../src/service.ts');
  const { newer, statusView, RuntimeUpdates } = await import('../src/runtime.ts');
  const { newArtifactFolder, slugify } = await import('../src/folders.ts');
  const { validSetting } = await import('../src/settings.ts');

  it('the daemon is picked field by field: never its token', () => {
    const state = {
      url: 'http://127.0.0.1:4891',
      port: 4891,
      pid: 12,
      token: 'secret-token',
      version: '0.14.6',
      startedAt: '2026-11-25T00:00:00Z',
      extra: 'x',
    };
    const view = daemonView(state);
    assert.deepEqual(view, { version: '0.14.6', address: '127.0.0.1:4891', port: 4891, pid: 12, startedAt: '2026-11-25T00:00:00Z' });
    assert.equal(JSON.stringify(view).includes('secret-token'), false);
    assert.equal(daemonView(null), null);
  });

  it('the apps connected: one row per connection, this one marked, sessions counted', () => {
    const answer = {
      harnesses: [{ name: 'claude-code', title: 'Claude Code', token: 'no' }],
      adapters: [
        { id: 'c1', harness: 'open-artifact-desktop', sessions: [] },
        { id: 'c2', harness: 'claude-code', sessions: [{ id: 's1' }, { id: 's2' }], polling: true, token: 'no' },
        { harness: 'broken' },
      ],
    };
    assert.deepEqual(appsView(answer, 'c1'), [
      { connection: 'c1', harness: 'open-artifact-desktop', title: 'open-artifact-desktop', sessions: 0, polling: false, self: true },
      { connection: 'c2', harness: 'claude-code', title: 'Claude Code', sessions: 2, polling: true, self: false },
    ]);
    assert.deepEqual(serversView({ servers: [{ type: 'docs', state: 'running', pid: 7, restarts: 1, port: 1, secret: 'x' }] }), [
      { type: 'docs', state: 'running', pid: 7, restarts: 1, error: null },
    ]);
    assert.deepEqual(doctorView({ ok: true, counts: { ok: 1 }, findings: [{ id: 'a', status: 'ok', message: 'fine', env: 'x' }] }), {
      ok: true,
      findings: [{ id: 'a', status: 'ok', message: 'fine' }],
      counts: { ok: 1, warn: 0, fail: 0, 'n/a': 0 },
    });
  });

  it('runtime versions compare as x.y.z, a pre-release before its release; the status is picked', () => {
    assert.equal(newer('0.15.0', '0.14.6'), true);
    assert.equal(newer('0.14.6', '0.14.6'), false);
    assert.equal(newer('0.14.10', '0.14.9'), true);
    assert.equal(newer('0.15.0-rc.1', '0.15.0'), false);
    assert.equal(newer('0.15.0', '0.15.0-rc.1'), true);
    const view = statusView({
      running: '0.14.6',
      policy: { update: 'prompt', source: 'adapter' },
      check: { at: 't', available: 'not a version' },
      pending: '0.15.0',
      token: 'x',
    });
    assert.deepEqual(view, {
      running: '0.14.6',
      selected: null,
      policy: { update: 'prompt', source: 'adapter' },
      pin: null,
      check: { at: 't', available: null, error: null },
      pending: '0.15.0',
    });
  });

  it('a runtime check with missing or malformed JSON reports failure even when the CLI exits zero', async () => {
    for (const stdout of ['', 'not JSON', 'null', 'false', '0']) {
      const runtime = new RuntimeUpdates({
        harness: {
          connected: true,
          runtime: {
            status: async () => {
              throw new Error('not running');
            },
            update: async () => {
              throw new Error('unused');
            },
          },
        },
        runtimeDir: '/runtime',
        profile: { home: '/test-home', port: 4891 },
        carried: '0.15.0',
        cli: async () => ({ code: 0, stdout, stderr: '' }),
      });
      runtime.status = statusView({ running: '0.15.0', policy: { update: 'prompt' } });
      await assert.rejects(runtime.check(), /runtime status exited 0/, JSON.stringify(stdout));
      assert.equal(runtime.view().failure?.act, 'checking');
      assert.equal(runtime.view().busy, null);
    }
  });

  it('the folder for new artifacts: an absolute folder or the default; names as the daemon makes them', () => {
    assert.equal(validSetting('artifactsFolder', ''), true);
    assert.equal(validSetting('artifactsFolder', '/Users/someone/Work'), true);
    assert.equal(validSetting('artifactsFolder', 'relative/path'), false);
    assert.equal(validSetting('artifactsFolder', '/a/../b'), false);
    assert.equal(validSetting('artifactsFolder', '/a\0b'), false);
    assert.equal(validSetting('artifactsFolder', 7), false);
    assert.equal(slugify('Tide Tables, 2027!'), 'tide-tables-2027');
    assert.equal(slugify('渡轮笔记'), '渡轮笔记');
    assert.equal(slugify('Café'), 'cafe');
    assert.equal(slugify('!!!'), 'artifact');
    const base = mkdtempSync(join(tmpdir(), 'oa-unit-folders-'));
    try {
      assert.equal(newArtifactFolder(base, 'Ferry'), join(base, 'ferry'));
      // An empty folder of that name is used; one with something in it is not.
      mkdirSync(join(base, 'ferry'));
      assert.equal(newArtifactFolder(base, 'Ferry'), join(base, 'ferry'));
      writeFileSync(join(base, 'ferry', 'x'), '');
      assert.equal(newArtifactFolder(base, 'Ferry'), join(base, 'ferry-2'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ---- stage 1.5: downloads, offline, the menu, Move To… ----
const { downloadAllowed, freeTarget, safeName, downloadsFolder } = await import('../src/downloads.ts');
const { menuTemplate, newGroups, templateCommands } = await import('../src/menu.ts');
const { moveArtifact, moveTarget } = await import('../src/move.ts');
const { wordsFor } = await import('../renderer/src/words.ts');

describe('downloads', () => {
  const allowlist = new OriginAllowlist();
  allowlist.setDaemon('http://127.0.0.1:4891');
  allowlist.fromDaemon({ origins: ['http://docs.localhost:4891'] });

  it('saves what the views may show, a blob made by such a page, and a data: address from one', () => {
    assert.equal(downloadAllowed('http://127.0.0.1:4891/api/open-artifact.artifact.archive?id=x', allowlist), true);
    assert.equal(downloadAllowed('blob:http://127.0.0.1:4891/2f1c-uuid', allowlist), true);
    assert.equal(downloadAllowed('data:text/plain,hi', allowlist, 'http://127.0.0.1:4891/a/art_x'), true);
  });

  it('cancels another loopback server, the web, file:, an opaque blob, and a data: address from elsewhere', () => {
    assert.equal(downloadAllowed('http://127.0.0.1:9999/file.txt', allowlist), false);
    assert.equal(downloadAllowed('https://example.com/file.zip', allowlist), false);
    assert.equal(downloadAllowed('file:///etc/hosts', allowlist), false);
    assert.equal(downloadAllowed('blob:null/abc', allowlist), false);
    assert.equal(downloadAllowed('blob:https://example.com/abc', allowlist), false);
    assert.equal(downloadAllowed('data:text/plain,hi', allowlist, 'https://example.com/'), false);
    assert.equal(downloadAllowed('data:text/plain,hi', allowlist), false);
  });

  it('names: no folders or forbidden characters; a taken name gets (2), (3)…', () => {
    assert.equal(safeName('../../etc/passwd'), 'passwd');
    assert.equal(safeName('a:b*c?.txt'), 'a_b_c_.txt');
    assert.equal(safeName('.hidden'), 'hidden');
    assert.equal(safeName(''), 'download');
    const dir = mkdtempSync(join(tmpdir(), 'oa-dl-'));
    try {
      assert.equal(freeTarget(dir, 'Notes.md'), join(dir, 'Notes.md'));
      writeFileSync(join(dir, 'Notes.md'), 'x');
      assert.equal(freeTarget(dir, 'Notes.md'), join(dir, 'Notes (2).md'));
      writeFileSync(join(dir, 'Notes (2).md'), 'x');
      assert.equal(freeTarget(dir, 'Notes.md', new Set([join(dir, 'Notes (3).md')])), join(dir, 'Notes (4).md'));
      assert.equal(freeTarget(dir, 'folder'), join(dir, 'folder'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(downloadsFolder('/Users/someone'), '/Users/someone/Downloads');
  });
});

describe('offline', () => {
  it('this computer: localhost, *.localhost, 127/8, ::1, and what is not a network address', () => {
    for (const url of [
      'http://localhost:3000/',
      'http://docs.localhost:4891/x',
      'http://127.0.0.1:4891/',
      'http://127.9.9.9/',
      'ws://127.0.0.1:1/',
      'http://[::1]:80/',
      'file:///tmp/x',
      'blob:http://127.0.0.1/x',
      'data:text/plain,x',
      'devtools://devtools/x',
      'oa-thumbnail://artifact/x',
      'not a url',
    ]) {
      assert.equal(onThisComputer(url), true, url);
    }
  });
  it('everything else leaves it', () => {
    for (const url of [
      'https://example.com/',
      'http://192.168.1.2/',
      'http://10.0.0.1/',
      'https://fonts.googleapis.com/css',
      'wss://example.com/',
      'http://127.0.0.1.example.com/',
      'http://localhost.example.com/',
    ]) {
      assert.equal(onThisComputer(url), false, url);
    }
  });
});

describe('the menu bar', () => {
  const types = ['docs', 'sheets', 'whiteboard', 'slides', 'design-system', 'design', 'data', 'motion', 'page', 'my-own'].map((id) => ({ id, title: id }));
  const build = (locale: string, opts: Partial<MenuOptions> = {}) => menuTemplate({ t: wordsFor(locale), types, run: () => {}, platform: 'darwin', ...opts });
  const sub = (template: DesktopMenuItem[], label: string): DesktopMenuItem[] => {
    const items = present(template.find((m) => m.label === label)).submenu;
    assert.ok(Array.isArray(items));
    return items;
  };

  it('has the app, File, Edit, View, Window and Help menus, in English and in Chinese', () => {
    assert.deepEqual(
      build('en').map((m) => m.label),
      ['Open Artifact', 'File', 'Edit', 'View', 'Window', 'Help'],
    );
    assert.deepEqual(
      build('zh').map((m) => m.label),
      ['Open Artifact', '文件', '编辑', '显示', '窗口', '帮助'],
    );
    assert.equal(present(sub(build('zh'), '文件').find((i) => i.id === 'move')).label, '移动到…');
    assert.equal(present(sub(build('en'), 'File').find((i) => i.id === 'reveal')).label, 'Show Artifact Folder in Finder');
  });

  it("File ▸ New lists the types in the new-artifact dialog's groups and order, with its names", () => {
    const groups = newGroups(types);
    assert.deepEqual(
      groups.blank.map((t) => t.id),
      ['docs', 'sheets', 'whiteboard', 'slides', 'design-system'],
    );
    assert.deepEqual(
      groups.agent.map((t) => t.id),
      ['design', 'data', 'motion', 'page', 'my-own'],
    );
    const items = present(present(sub(build('en'), 'File').find((i) => i.id === 'new')).submenu);
    assert.deepEqual(
      items.filter((i) => i.id).map((i) => i.id),
      [...groups.blank, ...groups.agent].map((t) => `new:${t.id}`),
    );
    assert.equal(items[0].label, wordsFor('en')('group.blank'));
    assert.equal(items[0].enabled, false);
    assert.equal(present(items.find((i) => i.id === 'new:docs')).label, wordsFor('en')('type.docs'));
    assert.equal(present(items.find((i) => i.id === 'new:page')).label, 'Page');
  });

  it("every item of the app's own is a named command; the rest are macOS roles", () => {
    const template = build('en');
    const names = templateCommands(template);
    for (const name of [
      'about',
      'settings',
      'new-dialog',
      'open-folder',
      'import',
      'reveal',
      'move',
      'close-tab',
      'edit:undo',
      'edit:redo',
      'edit:cut',
      'edit:copy',
      'edit:paste',
      'edit:select-all',
      'reload',
      'toggle-sidebar',
      'zoom-reset',
      'zoom-in',
      'zoom-out',
      'fullscreen',
      'previous-tab',
      'next-tab',
      'logs',
      'doctor',
    ]) {
      assert.ok(names.includes(name), name);
    }
    const roles: string[] = [];
    const walk = (items: DesktopMenuItem[]) => items.forEach((i) => (i.role && roles.push(i.role), Array.isArray(i.submenu) && walk(i.submenu)));
    walk(template);
    assert.deepEqual(roles.sort(), ['front', 'help', 'hide', 'hideOthers', 'minimize', 'quit', 'services', 'unhide', 'windowMenu', 'zoom'].sort());
    const ran: [string, unknown][] = [];
    const clicking = menuTemplate({ t: wordsFor('en'), types, run: (name: string, arg) => ran.push([name, arg]), platform: 'darwin' });
    present(present(present(present(sub(clicking, 'File').find((i) => i.id === 'new')).submenu).find((i) => i.id === 'new:sheets')).click)();
    present(present(sub(clicking, 'File').find((i) => i.id === 'close-tab')).click)();
    assert.deepEqual(ran, [
      ['new:sheets', 'sheets'],
      ['close-tab', undefined],
    ]);
  });

  it('greys out what needs an artifact in front, with the macOS shortcuts', () => {
    const template = build('en', { enabled: (name: string) => !['reveal', 'move', 'close-tab', 'reload'].includes(name) });
    const file = sub(template, 'File');
    for (const id of ['reveal', 'move', 'close-tab']) assert.equal(present(file.find((i) => i.id === id)).enabled, false, id);
    assert.equal(present(sub(template, 'View').find((i) => i.id === 'reload')).enabled, false);
    assert.equal(present(file.find((i) => i.id === 'open-folder')).enabled, true);
    assert.equal(present(file.find((i) => i.id === 'close-tab')).accelerator, 'CmdOrCtrl+W');
    assert.equal(present(file.find((i) => i.id === 'new-dialog')).accelerator, 'CmdOrCtrl+N');
    assert.equal(present(sub(template, 'View').find((i) => i.id === 'zoom-in')).accelerator, 'CmdOrCtrl+=');
    assert.equal(present(sub(template, 'Open Artifact').find((i) => i.id === 'settings')).accelerator, 'CmdOrCtrl+,');
  });
});

describe('Move To…', () => {
  const setup = () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'oa-move-')));
    const root = join(dir, 'lib', 'Ferry notes');
    mkdirSync(join(root, 'doc'), { recursive: true });
    writeFileSync(join(root, '.artifact.json'), JSON.stringify({ id: 'art_x' }));
    writeFileSync(join(root, 'doc', 'a.md'), 'The ferry');
    mkdirSync(join(dir, 'into'));
    return { dir, root };
  };

  it('renames the folder into the one chosen, then tells the library', async () => {
    const { dir, root } = setup();
    try {
      const told: [string, string][] = [];
      const library = { record: async () => ({ root }), relocate: async (id: string, folder: string) => told.push([id, folder]) };
      const out = await moveArtifact({ library, id: 'art_x', into: join(dir, 'into') });
      assert.deepEqual(out, { from: root, to: join(dir, 'into', 'Ferry notes'), moved: true });
      assert.equal(existsSync(root), false);
      assert.equal(readFileSync(join(dir, 'into', 'Ferry notes', 'doc', 'a.md'), 'utf8'), 'The ferry');
      assert.deepEqual(told, [['art_x', join(dir, 'into', 'Ferry notes')]]);
      // A name taken there: (2).
      mkdirSync(join(dir, 'into', 'Other'));
      assert.equal(moveTarget(join(dir, 'x', 'Other'), join(dir, 'into')), join(dir, 'into', 'Other (2)'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('puts the folder back when the library refuses, and refuses a folder inside itself or one that is not there', async () => {
    const { dir, root } = setup();
    try {
      const library = {
        record: async () => ({ root }),
        relocate: async () => {
          throw new Error('conflict');
        },
      };
      await assert.rejects(moveArtifact({ library, id: 'art_x', into: join(dir, 'into') }), /conflict/);
      assert.equal(readFileSync(join(root, 'doc', 'a.md'), 'utf8'), 'The ferry');
      assert.equal(existsSync(join(dir, 'into', 'Ferry notes')), false);
      const ok = { record: async () => ({ root }), relocate: async () => {} };
      await assert.rejects(moveArtifact({ library: ok, id: 'art_x', into: join(root, 'doc') }), /into itself/);
      await assert.rejects(moveArtifact({ library: ok, id: 'art_x', into: join(dir, 'missing') }), /not a folder/);
      await assert.rejects(moveArtifact({ library: ok, id: 'art_x', into: 'relative' }), /absolute/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('open-artifact:// links', async () => {
  const { linkedArtifact, opensOf, isLink } = await import('../src/links.ts');
  const ID = 'docs-7f3a9c';

  it('only open-artifact://artifact/<id> is taken, with an id idArg accepts', () => {
    assert.equal(linkedArtifact(`open-artifact://artifact/${ID}`), ID);
    assert.equal(linkedArtifact(`OPEN-ARTIFACT://artifact/${ID}`), ID);
    for (const refused of [
      'open-artifact://artifact/',
      `open-artifact://artifact/${ID}/`,
      `open-artifact://artifact/${ID}?x=1`,
      `open-artifact://artifact/${ID}#top`,
      `open-artifact://type/docs`,
      `open-artifact://artifact/a/b`,
      `open-artifact:artifact/${ID}`,
      `open-artifact://artifact/..%2F..`,
      'open-artifact://artifact/has space',
      `https://example.com/artifact/${ID}`,
      `open-artifact://artifact/${'x'.repeat(400)}`,
      null,
      42,
    ]) {
      assert.equal(linkedArtifact(refused), null, String(refused));
    }
  });

  it("a start's arguments: --open <ref>, --open=<ref> and bare links, in order; bad links are refused", () => {
    assert.ok(isLink('open-artifact://x') && !isLink('--open'));
    const out = opensOf([
      '--home',
      '/h',
      '--open',
      ID,
      `open-artifact://artifact/b-1`,
      '--open=c-2',
      'open-artifact://nope',
      '--open',
      'open-artifact://artifact/d?x',
    ]);
    assert.deepEqual(out.refs, [ID, 'b-1', 'c-2']);
    assert.deepEqual(out.refused, ['open-artifact://nope', 'open-artifact://artifact/d?x']);
    assert.deepEqual(opensOf(undefined), { refs: [], refused: [] });
    assert.deepEqual(opensOf(['--open']).refs, []);
  });

  it('the app never registers the scheme: no setAsDefaultProtocolClient, no lsregister in its source', () => {
    for (const dir of ['src', 'scripts']) {
      for (const name of readdirSync(join(import.meta.dirname, '..', dir))) {
        if (!/\.(?:[cm]?ts|tsx)$/.test(name)) continue;
        const text = readFileSync(join(import.meta.dirname, '..', dir, name), 'utf8')
          .split('\n')
          .filter((line) => !/^\s*(\*|\/\/)/.test(line))
          .join('\n');
        assert.doesNotMatch(text, /setAsDefaultProtocolClient|lsregister/, `${dir}/${name}`);
      }
    }
  });
});

describe("the package's Info.plist additions", async () => {
  const { infoPlistAdditions, urlSchemeFromEnv } = await import('../scripts/info-plist.ts');

  it('nothing by default; the URL type of open-artifact:// only with OA_DESKTOP_URL_SCHEME=1', () => {
    assert.deepEqual(infoPlistAdditions(), {});
    assert.deepEqual(infoPlistAdditions({ urlScheme: urlSchemeFromEnv({}) }), {});
    for (const value of ['', '0', 'true', 'yes', ' 1']) assert.equal(urlSchemeFromEnv({ OA_DESKTOP_URL_SCHEME: value }), false, JSON.stringify(value));
    assert.equal(urlSchemeFromEnv({ OA_DESKTOP_URL_SCHEME: '1' }), true);
    assert.deepEqual(infoPlistAdditions({ urlScheme: true, bundleId: 'dev.openartifact.desktop' }), {
      CFBundleURLTypes: [{ CFBundleURLName: 'dev.openartifact.desktop.link', CFBundleURLSchemes: ['open-artifact'], CFBundleTypeRole: 'Viewer' }],
    });
  });
});
