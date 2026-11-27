/** Following a link inside the doc: to a tab, a heading or another block, and the address that names one. */
import { toast } from '@open-artifact/ui';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { docClient } from '../app/doc-client.ts';
import { maybeSession } from '../app/session.ts';
import { showTab } from '../app/start.ts';
import { getDocs } from '../app/store.ts';
import { useEditor } from '../editor/format.ts';
import { type DocPlace, findPlace, parseDocHref, placeFragment } from './fragments.ts';
import { washPlace } from './place-wash.ts';

const WAIT_MS = 10_000;

/** The editor of a tab once the page shows it. */
function editorOf(tab: string): Promise<EditorView | null> {
  const now = useEditor.getState();
  if (now.view && now.tab === tab) return Promise.resolve(now.view);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      stop();
      resolve(null);
    }, WAIT_MS);
    const stop = useEditor.subscribe(state => {
      if (!state.view || state.tab !== tab) return;
      clearTimeout(timer);
      stop();
      resolve(state.view);
    });
  });
}

/** Brings a place into view: its block, then a wash over the words it names. */
function showPlace(view: EditorView, tab: string, place: DocPlace, pos: number): void {
  scrollToBlock(view, pos);
  washPlace(view, docClient().openTabOf(tab)?.binding.shadow ?? null, place);
}

/** Scrolls a block into view and puts the cursor at its start. */
export function scrollToBlock(view: EditorView, pos: number): void {
  const dom = view.nodeDOM(pos);
  const element = dom instanceof HTMLElement ? dom : null;
  if (view.editable) {
    const $inside = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size));
    view.dispatch(view.state.tr.setSelection(TextSelection.near($inside)));
    view.focus();
  }
  element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function tabExists(id: string): boolean {
  return !!getDocs().project?.files.some(file => file.id === id);
}

/** Whether an in-doc link names something the open tab (or the doc's tabs) has. */
export function placeExists(href: string, view: EditorView | null): boolean {
  const place = parseDocHref(href);
  if (!place) return false;
  if (place.tab) return tabExists(place.tab);
  return !!view && findPlace(view.state.doc, place) !== null;
}

async function goTo(place: DocPlace): Promise<void> {
  const active = getDocs().activeTab;
  const tab = place.tab ?? active;
  if (!tab) return;
  if (place.tab && !tabExists(place.tab)) {
    toast.add({ title: "That tab or section can't be opened from here" });
    return;
  }
  if (tab !== active) showTab(tab);
  const target = placeFragment(place);
  const hash = '#' + tab + (target ? '.' + target : '');
  history.replaceState(history.state, '', hash);
  maybeSession()?.shell?.currentDocPlace(hash);
  if (!target) return;
  const view = await editorOf(tab);
  if (!view) return;
  const pos = findPlace(view.state.doc, place);
  if (pos === null) {
    toast.add({ title: 'That section no longer exists in this document' });
    return;
  }
  requestAnimationFrame(() => {
    if (!view.isDestroyed && getDocs().activeTab === tab) showPlace(view, tab, place, pos);
  });
}

/** Follows `#…` inside the doc; false for any other link. */
export function followDocLink(href: string): boolean {
  const place = parseDocHref(href);
  if (!place) return false;
  void goTo(place);
  return true;
}

/** Public shell or invitation address, without frame transport parameters. */
export function docLinkBase(): URL {
  const here = new URL(location.href);
  const base = here.searchParams.get('doc_link_base');
  if (base && window.parent !== window) {
    try {
      const url = new URL(base);
      if (/^https?:$/.test(url.protocol)) return url;
    } catch { /* Older hosts supply only the frame address. */ }
  }
  here.searchParams.delete('open_artifact_shell');
  here.searchParams.delete('open_artifact_id');
  here.searchParams.delete('doc_link_base');
  return here;
}

/** The full address of an in-doc link, to share: the page's, naming the tab, with the place as its fragment. */
export function docLinkUrl(href: string): string {
  const url = docLinkBase();
  const place = parseDocHref(href);
  const tab = place?.tab ?? getDocs().activeTab;
  url.searchParams.delete('tab');
  const fragment = place ? placeFragment(place) : '';
  url.hash = tab ? tab + (fragment ? '.' + fragment : '') : fragment;
  return url.href;
}

/** On opening the page, goes to the heading or block its address names (`…?tab=<id>#<block id>~<slug>`). */
export function followAddressOnce(): void {
  const hash = location.hash;
  if (hash.length < 2) return;
  const place = parseDocHref(hash);
  if (!place || (!place.block && !place.slug)) return;
  const stop = useEditor.subscribe(state => {
    if (!state.view || !state.tab) return;
    stop();
    if (place.tab && state.tab !== place.tab) return;
    const view = state.view;
    const pos = findPlace(view.state.doc, place);
    const tab = state.tab;
    if (pos !== null) requestAnimationFrame(() => { if (!view.isDestroyed) showPlace(view, tab, place, pos); });
  });
}
