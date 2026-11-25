// The home page's `PageApi` and `PageHost` over the preload's bridge (`window.desktop`). The page never reaches the
// daemon itself: every call goes to the main process, which answers it with the daemon's token. Opening an artifact
// opens its tab; making one goes through the main process too, which opens its tab once it is made.
import { BUILTIN_START } from '@open-artifact/protocol';

const bridge = () => window.desktop;

/** A bridge answer's value, or a throw with its words. */
async function unwrap(answer) {
  const out = await answer;
  if (!out || out.ok !== true) throw new Error(out?.error || 'no answer');
  return out.value;
}

/** What the page's store reads as a preview "address": only the artifact's id; the page itself stays in the main process. */
const PREVIEW = 'oa-preview:';

export const pageApi = {
  list: () => unwrap(bridge().library.list()),
  async open(id) {
    const opened = await bridge().open(id);
    if (!opened?.ok) throw new Error(opened?.error || 'could not open it');
    // Shown already (its tab): nothing for the host to show, no session of this app's.
    return { url: '', sessionId: '', title: '' };
  },
  preview: async (id) => `${PREVIEW}${id}`,
  update: (id, patch) => unwrap(bridge().library.update(id, patch)),
  remove: (id) => unwrap(bridge().library.remove(id)),
  restore: (trash) => unwrap(bridge().library.restore(trash)),
  saveThumbnail: (id, version, jpeg) => unwrap(bridge().library.saveThumbnail(id, version, jpeg)),
  thumbnailUrl: (id, version) => `oa-thumbnail://artifact/${encodeURIComponent(id)}?v=${encodeURIComponent(version ?? '')}`,
  events(onEvent, onError) {
    return bridge().library.onEvent((event) => (event?.type === 'disconnected' ? onError() : onEvent()));
  },
};

/** The home page's two groups of type tiles, as the new-artifact dialog has them. */
export const tileGroups = (t) => [
  { id: 'blank', title: t('group.blank'), types: BUILTIN_START.blank },
  // Every other type (one a person made too) is made empty, for an agent: the last group takes them.
  { id: 'agent', title: t('group.agent'), types: BUILTIN_START.agent },
];

/** Makes an artifact of `type` (blank or empty, as the main process decides) and opens its tab. */
export const createArtifact = (type, title = '') => unwrap(bridge().library.create(type, title));

/**
 * The page's host. `openDialog()`: the new-artifact dialog; `failed(message)`: says a create did not work;
 * `visible()`: thumbnails may be taken now.
 */
export function pageHost({ openDialog, failed, visible }) {
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    // Storage refused: the layout choice lasts the run.
  }
  return {
    canCreate: () => true,
    create(type) {
      if (type === undefined) return openDialog();
      createArtifact(type.id).catch((error) => failed(error.message));
    },
    away: () => false,
    pendingWindow: () => null,
    show: async () => ({ sessionGone: false }),
    copy: (text) => unwrap(bridge().library.copy(text)),
    capture: (url, type) => {
      if (!url.startsWith(PREVIEW)) return Promise.reject(new Error('not a preview'));
      return unwrap(bridge().library.capture(url.slice(PREVIEW.length), type));
    },
    visible: () => visible() && document.visibilityState === 'visible',
    storage,
  };
}
