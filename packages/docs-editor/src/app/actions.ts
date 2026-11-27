/** The editor's keys ask the page for these; each feature that answers one provides it. */
import type { EditorActions } from '../editor/plugins.ts';

const handlers: EditorActions = {
  find: () => false,
  link: () => false,
  openLink: () => false,
  openReference: () => false,
  comment: () => false,
  toggleComments: () => false,
  copyPlaceLink: () => false,
  shortcuts: () => false,
  slash: () => false,
};

export const editorActions: EditorActions = {
  find: mode => handlers.find(mode),
  link: () => handlers.link(),
  openLink: () => handlers.openLink(),
  openReference: () => handlers.openReference(),
  comment: () => handlers.comment(),
  toggleComments: () => handlers.toggleComments(),
  copyPlaceLink: () => handlers.copyPlaceLink(),
  shortcuts: () => handlers.shortcuts(),
  slash: () => handlers.slash(),
};

/** Answers one of the editor's asks until the returned function is called. */
export function provideAction<K extends keyof EditorActions>(key: K, handler: EditorActions[K]): () => void {
  const before = handlers[key];
  handlers[key] = handler;
  return () => {
    if (handlers[key] === handler) handlers[key] = before;
  };
}
