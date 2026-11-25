/**
 * Updating the plugin: the registry check (src/server/updates.ts), the version order, and the browser half's run and
 * sidebar mark (src/client/updates.tsx).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateChecker, type PluginManager } from '../src/server/updates.ts';
import type { PluginUpdate } from '../src/shared/routes.ts';
import { markOf, reasonOf, run, updateState, type PluginManagerRemote } from '../src/client/update-state.ts';

const NAME = 'dsh-open-artifact';

function manager(bundle: Record<string, unknown> | null, registries = { registry: 'https://reg.example/' }): PluginManager {
  return {
    listBundles: async () => (bundle ? [{ name: NAME, installed: true, enabled: true, ...bundle } as never] : []),
    registries: async () => registries,
  };
}

/** A registry that has `latest`, counting how often it is asked. */
function registry(latest: string | null) {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    asked.push(url);
    if (latest === null) return new Response('{}', { status: 404 });
    return Response.json({ 'dist-tags': { latest }, versions: { [latest]: { dist: { tarball: `https://reg.example/${NAME}/-/${NAME}-${latest}.tgz` } } } });
  };
  return { asked, fetcher };
}

describe('updateChecker', () => {
  it('offers the registry latest over an older install from that registry', async () => {
    const reg = registry('0.8.0');
    const check = updateChecker([NAME], () => manager({ version: '0.7.0', source: `${NAME}@^0.7.0`, updatable: true }), reg.fetcher);
    const { updates, failed } = await check();
    assert.deepEqual(failed, []);
    assert.deepEqual(updates, [
      { name: NAME, version: '0.7.0', latest: '0.8.0', spec: `https://reg.example/${NAME}/-/${NAME}-0.8.0.tgz`, registry: 'https://reg.example/', enabled: true, native: true },
    ]);
    await check();
    assert.equal(reg.asked.length, 1, 'what the registry said is kept');
  });

  it('leaves a linked folder alone, and says nothing when it is current', async () => {
    const reg = registry('0.8.0');
    assert.deepEqual(await updateChecker([NAME], () => manager({ version: '0.7.0', source: 'link:/src/dsh-plugin' }), reg.fetcher)(), { updates: [], failed: [] });
    assert.equal(reg.asked.length, 0);
    assert.deepEqual((await updateChecker([NAME], () => manager({ version: '0.8.0', source: `${NAME}@0.8.0` }), reg.fetcher)()).updates, []);
  });

  it('names the plugin no registry answered for, and asks again next time', async () => {
    const reg = registry(null);
    const check = updateChecker([NAME], () => manager({ version: '0.7.0', source: `${NAME}@0.7.0` }, { registry: 'https://a/', fallbackRegistries: ['https://b'] } as never), reg.fetcher);
    assert.deepEqual(await check(), { updates: [], failed: [NAME] });
    assert.deepEqual(reg.asked, [`https://a/${NAME}`, `https://b/${NAME}`]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await check();
    assert.equal(reg.asked.length, 4);
  });

  it('has nothing to say without a plugin manager', async () => {
    assert.deepEqual(await updateChecker([NAME], () => undefined)(), { updates: [], failed: [] });
  });
});

const offer: PluginUpdate = { name: NAME, version: '0.7.0', latest: '0.8.0', spec: 'https://reg.example/x-0.8.0.tgz', registry: 'https://reg.example/', enabled: true, native: false };

function remote(outcome: unknown, lost = false) {
  const calls: unknown[] = [];
  const manager: PluginManagerRemote = {
    installBundle: async (spec, options) => {
      calls.push([spec, options.enabled, options.registry]);
      return lost ? { ok: false, error: { message: 'gone' } } : { ok: true, value: outcome as never };
    },
    waitForInstall: async () => (lost ? { ok: false, error: {} } : { ok: true, value: outcome as never }),
  };
  return { manager, calls };
}

/** Puts the shared state back to an offer (the hub lives on globalThis). */
function offering() {
  const state = updateState();
  Object.assign(state, { updates: [offer], phase: 'idle', to: '', restart: false, failure: null, dismissed: '' });
}

describe('the update run', () => {
  it('installs the tarball over the plugin, keeping its switch, and says a restart is wanted', async () => {
    offering();
    assert.equal(markOf(updateState()), 'mark.update');
    const { manager, calls } = remote({ application: 'restart-required' });
    await run(manager);
    assert.deepEqual(calls, [[offer.spec, true, offer.registry]]);
    const state = updateState();
    assert.equal(state.phase, 'done');
    assert.equal(state.to, '0.8.0');
    assert.deepEqual(state.updates, []);
    assert.equal(markOf(state), 'mark.restart');
  });

  it('stops on a failed install with the line that says why', async () => {
    offering();
    const { manager } = remote({ application: 'failed', error: { diagnostic: 'Progress: 1\nERR_PNPM_FETCH_404 not found\nmore' } });
    await run(manager);
    const state = updateState();
    assert.equal(state.phase, 'failed');
    assert.deepEqual(state.failure, { plugin: NAME, message: 'ERR_PNPM_FETCH_404 not found', left: 'kept' });
    assert.equal(markOf(state), 'mark.failed');
  });

  it('cannot say how a lost reply left it', async () => {
    offering();
    await run(remote(null, true).manager);
    assert.equal(updateState().failure?.left, 'unknown');
  });

  it('takes the tarball it already has as done', async () => {
    offering();
    await run(remote({ application: 'failed', error: { code: 'already-installed' } }).manager);
    assert.equal(updateState().phase, 'done');
  });

  it('goes quiet once Later put this version away', () => {
    offering();
    Object.assign(updateState(), { dismissed: '0.8.0' });
    assert.equal(markOf(updateState()), null);
  });

  it('says which requirement refused it', () => {
    assert.equal(reasonOf({ error: { incompatible: [{ name: NAME, version: '0.8.0', requirements: { dsh: '>=0.3.0' } }] } }), `${NAME}@0.8.0 needs dsh >=0.3.0`);
  });
});
