/**
 * Updating dsh-open-artifact from inside the app: the browser half (src/server/updates.ts asks the registry).
 *
 * A new release never interrupts anyone: nothing is drawn over the app. Three places say so, and they start the same run:
 *
 *   - a mark on the Open Artifact entry in the left sidebar ({@link UpdateMark}): a small label on a wide row, a dot on the
 *     collapsed rail. It also says that a run is on, failed or wants a restart, wherever the person has gone;
 *   - a panel at the top of the Open Artifact page (`UpdatePanel` of `@open-artifact/library-page`, drawing
 *     {@link pageUpdates}): the versions, what the new one brings (its release notes), Update, Later, and how the run
 *     is going. Later folds it to one line and takes the mark away, until a newer version comes;
 *   - an Update button and a tag on the plugin's page in Plugins (`plugins.detail.actions`, `plugins.detail.badge`),
 *     where the app has no Update of its own there (`native`).
 *
 * A run installs the release's tarball over the plugin through the plugin manager the Plugins page calls (its name is
 * refused while it is installed). A failed install puts the profile back as it was; the panel says what happened, and
 * Try again runs it again. It does not use the app's own `updateBundle`, which removes the plugin first: that takes this
 * very code away while it runs, and leaves nothing installed if the download fails.
 *
 * It runs here and not on the server because the install can stop and start the server half that would run it. The
 * page stays, but this half can be replaced under the run once the install changes lib/client.js, so the run's state
 * lives in a hub on `globalThis`, and the half that follows draws the same panel.
 */
import { Action, injectStyles, UPDATE_CSS } from '@open-artifact/library-page';
import { type ComponentType, type ReactNode, useSyncExternalStore } from 'react';
import type { PluginUpdate } from '../shared/routes.ts';
import {
  CHECK_EVERY_MS,
  en,
  FIRST_CHECK_MS,
  look,
  markOf,
  NS,
  setPluginManager,
  setTranslate,
  start,
  subscribe,
  translate,
  updateState,
  zh,
  type PluginManagerRemote,
} from './update-state.ts';

const SLOT_ID = 'open-artifact.update';
const useUpdates = () => useSyncExternalStore(subscribe, updateState);

/** The sidebar mark's CSS; the panel's and the tag's are the page's (`UPDATE_CSS`). */
const MARK_CSS = `
.oau-rail-icon{position:relative;display:inline-flex}
.oau-mark-dot{position:absolute;top:-2px;right:-3px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.oau-mark-dot[data-mark="mark.failed"]{background:var(--dsw-alias-state-error-primary)}
button:has(.oau-mark-pill){position:relative}
.oau-mark-pill{position:absolute;top:50%;right:8px;transform:translateY(-50%);padding:0 7px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-size:11px;line-height:18px;white-space:nowrap}
.oau-mark-pill[data-mark="mark.failed"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
`;

/** The mark on the sidebar entry. The row has room for a word; the collapsed rail has room for a dot on the icon. */
export function UpdateMark({ wide, children }: { wide: boolean; children: ReactNode }) {
  const mark = markOf(useUpdates());
  if (mark === null) return <>{children}</>;
  if (wide) {
    return (
      <>
        {children}
        <span className="oau-mark-pill" data-testid="open-artifact-update-mark" data-mark={mark}>
          {translate(mark)}
        </span>
      </>
    );
  }
  return (
    <span className="oau-rail-icon">
      {children}
      <span className="oau-mark-dot" data-testid="open-artifact-update-mark" data-mark={mark} />
    </span>
  );
}

/** A bundle's page in Plugins says which one it is (`subject` of the slots it renders). */
interface DetailProps {
  subject?: { kind?: string; pkg?: { name?: string } };
}

/** The update this plugin's page offers: none where the app has its own Update there. */
const pageUpdate = (updates: readonly PluginUpdate[], name: string | undefined): PluginUpdate | undefined =>
  name === undefined ? undefined : updates.find((u) => u.name === name && !u.native);

/** The Update button on the plugin's page in Plugins, beside its Uninstall. */
function DetailAction({ subject }: DetailProps) {
  const { phase, updates } = useUpdates();
  const update = pageUpdate(updates, subject?.pkg?.name);
  if (subject?.kind !== 'bundle' || update === undefined) return null;
  const running = phase === 'running';
  return (
    <Action onClick={start} disabled={running} label={translate('update.one', { version: update.latest })}>
      {translate(running ? 'busy' : 'update')}
    </Action>
  );
}

/** Its tag beside the version; a run that stopped at this plugin says so here, since its button may have started it. */
function DetailBadge({ subject }: DetailProps) {
  const { phase, updates, failure } = useUpdates();
  if (subject?.kind !== 'bundle') return null;
  if (phase === 'failed' && failure?.plugin === subject.pkg?.name) {
    return (
      <span className="oau-tag" data-tone="neutral">
        {translate('failed.tag')}
      </span>
    );
  }
  const update = pageUpdate(updates, subject.pkg?.name);
  return update === undefined ? null : <span className="oau-tag">{translate('tag', { version: update.latest })}</span>;
}

// ---------- registering it ----------

/** The client context, as far as updating reads it. */
export interface UpdateContext {
  effect(execute: () => () => void, label?: string): unknown;
  /** Cordis: run `apply` once these services are there. A service read without asking for it this way throws. */
  inject?(deps: string[], apply: (ctx: { remote: { pluginManager: PluginManagerRemote }; effect(execute: () => () => void, label?: string): unknown }) => void): unknown;
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): unknown;
    bind?(ns: string): (key: string, params?: Record<string, string>) => string;
  };
  slots: {
    inject(name: string, register: () => unknown): unknown;
    register(options: Record<string, unknown>, component: ComponentType<never>): unknown;
  };
}

/** Looks for a new release now and then, and offers it: the panel, the sidebar mark, and the plugin's page in Plugins. */
export function joinUpdates(ctx: UpdateContext, plugin: string): void {
  ctx.effect(() => injectStyles(`${plugin}/updates.css`, UPDATE_CSS + MARK_CSS), `${plugin}: update styles`);
  ctx.effect(() => {
    const off = ctx.locale.register(NS, { zh, en });
    return typeof off === 'function' ? (off as () => void) : () => {};
  }, `${plugin}: update dictionaries`);
  const bound = ctx.locale.bind?.(NS);
  if (bound) setTranslate(bound);
  ctx.effect(() => {
    const first = setTimeout(() => void look(), FIRST_CHECK_MS);
    const every = setInterval(() => void look(), CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, `${plugin}: looking for updates`);
  // Not among the plugin's own requirements: an app without a plugin manager still has the page and the rest.
  ctx.inject?.(['remote', 'remote.pluginManager'], (sub) => {
    setPluginManager(sub.remote.pluginManager);
    sub.effect(
      () => () => {
        setPluginManager(undefined);
      },
      `${plugin}: the plugin manager`,
    );
  });
  ctx.slots.inject('plugins.detail.actions', () =>
    ctx.slots.register({ name: 'plugins.detail.actions', id: SLOT_ID, locale: NS, inject: () => ({}) }, DetailAction as ComponentType<never>),
  );
  ctx.slots.inject('plugins.detail.badge', () =>
    ctx.slots.register({ name: 'plugins.detail.badge', id: SLOT_ID, locale: NS, inject: () => ({}) }, DetailBadge as ComponentType<never>),
  );
}
