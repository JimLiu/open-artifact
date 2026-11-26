/** The open tab's text: a ProseMirror view kept in step with the tab through its binding. */
import { Fragment, type Node as PMNode, Slice } from 'prosemirror-model';
import { EditorState, type Plugin } from 'prosemirror-state';
import { EditorView, type NodeViewConstructor } from 'prosemirror-view';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type OpenTab, docClient } from '../app/doc-client.ts';
import { useDocs } from '../app/store.ts';
import { isSyncedTransaction } from './binding.ts';
import { stripIds } from './commands.ts';
import { focusKeys } from './focus-keys.ts';
import { useEditor } from './format.ts';
import { baseNodeViews } from './node-views.ts';
import { type EditorActions, docPlugins } from './plugins.ts';
import { schema } from './schema.ts';

/** Once a tab's saving has stopped, what is typed would be lost: the text is no longer editable. */
const savingGoes = (tab: string) => useDocs.getState().saving[tab] !== 'stopped';

/** What features add to the editor: their plugins and node views. */
export interface EditorExtension {
  plugins?(): Plugin[];
  nodeViews?: Record<string, NodeViewConstructor>;
}

const extensions: EditorExtension[] = [];

export function addEditorExtension(extension: EditorExtension): void {
  extensions.push(extension);
}

/** The node views the editor draws with: the base ones and every feature's. */
export function editorNodeViews(): Record<string, NodeViewConstructor> {
  return Object.assign({}, baseNodeViews, ...extensions.map(extension => extension.nodeViews ?? {})) as Record<string, NodeViewConstructor>;
}

/** Each tab's editor state, kept while the page is open so its undo history survives a switch of tabs. */
const kept = new Map<string, { state: EditorState; writable: boolean }>();

function withoutSuggestions(node: PMNode): PMNode {
  if (node.isText) return node.mark(node.marks.filter(mark => mark.type !== schema.marks.suggestIns && mark.type !== schema.marks.suggestDel));
  const content: PMNode[] = [];
  node.forEach(child => content.push(withoutSuggestions(child)));
  return node.copy(Fragment.from(content));
}

/** Pasted blocks are new: their ids and any suggestion they were part of stay behind. */
function freshSlice(slice: Slice): Slice {
  const content: PMNode[] = [];
  slice.content.forEach(node => content.push(withoutSuggestions(stripIds(node))));
  return new Slice(Fragment.from(content), slice.openStart, slice.openEnd);
}

function makeState(tab: OpenTab, actions: EditorActions, writable: boolean): EditorState {
  const plugins = [...extensions.flatMap(extension => extension.plugins?.() ?? []), ...docPlugins(actions, { writable })];
  return EditorState.create({ doc: tab.binding.doc, plugins });
}

export function DocEditor({ tabId, actions }: { tabId: string; actions: EditorActions }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const writable = useDocs(state => state.writable);
  const [failed, setFailed] = useState<string | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    let view: EditorView | null = null;
    let tab: OpenTab | null = null;
    let cancelled = false;
    let composeEnd: ReturnType<typeof setTimeout> | undefined;
    let stopFocusKeys: (() => void) | undefined;
    setFailed(null);
    const relay: EditorActions = {
      find: mode => actionsRef.current.find(mode),
      link: () => actionsRef.current.link(),
      openLink: () => actionsRef.current.openLink(),
      openReference: () => actionsRef.current.openReference(),
      comment: () => actionsRef.current.comment(),
      toggleComments: () => actionsRef.current.toggleComments(),
      copyPlaceLink: () => actionsRef.current.copyPlaceLink(),
      shortcuts: () => actionsRef.current.shortcuts(),
      slash: () => actionsRef.current.slash(),
    };
    docClient()
      .tab(tabId)
      .then(open => {
        if (cancelled || !host.current) return;
        tab = open;
        const nodeViews = editorNodeViews();
        const cached = kept.get(tabId);
        const state = cached?.writable === writable ? cached.state : makeState(open, relay, writable);
        const editor = new EditorView(host.current, {
          state,
          nodeViews,
          editable: () => useDocs.getState().writable && savingGoes(tabId),
          attributes: { class: 'doc-text', spellcheck: 'true', 'data-tab': tabId },
          transformPasted: slice => freshSlice(slice),
          dispatchTransaction(tr) {
            if (tr.docChanged && !editor.editable && !isSyncedTransaction(tr)) return;
            const { state: next, transactions } = editor.state.applyTransaction(tr);
            editor.updateState(next);
            const changed = transactions.find(item => item.docChanged);
            if (changed) open.binding.afterTransaction(changed);
            useEditor.setState({ state: editor.state });
          },
          handleDOMEvents: {
            compositionstart: () => {
              clearTimeout(composeEnd);
              open.binding.compositionStarted();
              return false;
            },
            compositionend: () => {
              const settle = () => {
                if (editor.composing) composeEnd = setTimeout(settle, 30);
                else open.binding.compositionEnded();
              };
              composeEnd = setTimeout(settle, 30);
              return false;
            },
            focus: () => {
              useEditor.setState({ focused: true });
              return false;
            },
            blur: () => {
              useEditor.setState({ focused: false });
              return false;
            },
          },
        });
        view = editor;
        stopFocusKeys = focusKeys(editor);
        open.binding.attach(editor);
        useEditor.setState({ view: editor, state: editor.state, tab: tabId });
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      clearTimeout(composeEnd);
      stopFocusKeys?.();
      if (view) {
        kept.set(tabId, { state: view.state, writable });
        tab?.binding.detach();
        view.destroy();
        if (useEditor.getState().view === view) useEditor.setState({ view: null, state: null, tab: null, focused: false });
      }
    };
  }, [tabId, writable]);

  if (failed) return <div className="doc-failed">This tab could not be opened: {failed}</div>;
  return <div ref={host} className="doc-editor" />;
}
