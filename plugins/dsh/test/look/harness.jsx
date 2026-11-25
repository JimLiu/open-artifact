/**
 * The page under look.mjs: the plugin's browser half (src/client/index.tsx) applied to a stand-in for the DSH client
 * context, its components drawn into this document. The routes it calls are look.mjs's server; what each case wants
 * (its library, its update offer, whether a session can be started) is in `window.__LOOK__`, set before this runs.
 *
 * Bundled by look.mjs with React in it; never part of the plugin.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { apply } from '../../src/client/index.tsx';

const look = window.__LOOK__;

/** A store in the app's `useSyncExternalStore` shape that never changes. */
const fixed = (value) => ({ getSnapshot: () => value, subscribe: () => () => {} });

const services = {
  sessions: { list: fixed({ phase: 'ready', ids: ['s1', 's2'], byId: { s1: { title: 'Quarterly planning' }, s2: { title: 'Brand refresh' } } }) },
  workspaces: { list: fixed({ state: 'ready', phase: 'ready', archivedSessionIds: [] }) },
  uiWorkspace: look.canCreate ? { startSession() {}, openSession() {} } : {},
};

/** The plugin manager a run would install with: it never finishes, as no case runs one. */
const pluginManager = {
  installBundle: () => new Promise(() => {}),
  waitForInstall: () => new Promise(() => {}),
};

const registered = new Map();
const ctx = {
  effect(execute) {
    execute();
  },
  get(name) {
    return services[name];
  },
  locale: {
    register: () => () => {},
  },
  slots: {
    inject(_name, register) {
      register();
    },
    register(options, component) {
      const key = `${options.name}:${options.key ?? options.id ?? ''}`;
      registered.set(key, component);
    },
  },
  uiConversation: { events: { register() {} } },
  inject(_deps, run) {
    run({ remote: { pluginManager }, effect: (execute) => execute() });
  },
};

apply(ctx);

const component = (prefix) => {
  for (const [key, value] of registered) if (key.startsWith(prefix)) return value;
  throw new Error(`nothing registered at ${prefix}`);
};

const Page = component('main:');
const Entry = component('sidebar.panellist:');
const DetailAction = component('plugins.detail.actions:');
const DetailBadge = component('plugins.detail.badge:');
const subject = { kind: 'bundle', pkg: { name: 'dsh-open-artifact' } };

flushSync(() => createRoot(document.getElementById('main')).render(createElement(Page, {})));
flushSync(() =>
  createRoot(document.getElementById('outside')).render(
    createElement(
      'div',
      { className: 'look-outside' },
      createElement('button', { type: 'button', className: 'look-row' }, createElement(Entry, { size: 16 }), createElement('span', null, 'Open Artifact')),
      createElement('button', { type: 'button', className: 'look-rail' }, createElement(Entry, { size: 18 })),
      createElement('div', { className: 'look-detail' }, createElement(DetailBadge, { subject }), createElement(DetailAction, { subject })),
    ),
  ),
);
window.__LOOK_READY__ = true;
