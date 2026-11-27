/**
 * Other people (and the agent) on the design: the shared presence views
 * (`@open-artifact/editor-kit`, PresenceViews.tsx) fed with the design's world boxes: peers'
 * selected artboards, notes and elements, the artboard each is editing,
 * and the artboards the agent just changed.
 */

import { useMemo, type ReactNode } from 'react';
import { PeerBoxes, PeerCursors, PresenceAvatars as SharedAvatars, type PeerBox } from '@open-artifact/editor-kit/react';
import { AGENT_COLOR } from '@open-artifact/editor-kit';
import { noteRect } from '../lib/scene.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { liveElementRect } from '../services/comments.ts';
import { useLiveCamera } from '../services/camera-frame.ts';
import { usePresence, type DesignPeer } from '../services/presence.ts';
import { Tip } from '@open-artifact/editor-kit/react';

/** Peers' pointers, selections and editing notes on the current page. */
export function PresenceLayer(): ReactNode {
  const peers = usePresence((s) => s.peers);
  const agentWrote = usePresence((s) => s.agentWrote);
  const page = useView((s) => s.page);
  const mode = useView((s) => s.mode);
  const layoutTick = useView((s) => s.layoutTick);
  const canvas = useDocument((s) => s.canvas);
  const firstPage = canvas.pages[0]?.id ?? null;
  const here = (p: string | null | undefined): boolean => (p ?? firstPage) === (page ?? firstPage);

  const boxes = useMemo((): PeerBox[] => {
    const out: PeerBox[] = [];
    for (const peer of peers) {
      const d = peer.state;
      if (!d || !here(d.page)) continue;
      for (const path of d.boards) {
        const e = canvas.boards[path];
        if (e && path !== d.editing) out.push({ key: `${peer.id}:b:${path}`, color: peer.color, rect: e });
      }
      for (const id of d.notes) {
        const note = canvas.notes[id];
        if (note) out.push({ key: `${peer.id}:n:${id}`, color: peer.color, rect: noteRect(note) });
      }
      const e = d.elements ? canvas.boards[d.elements.board] : undefined;
      if (d.elements && e) {
        for (const tid of d.elements.tids) {
          const r = liveElementRect(d.elements.board, tid);
          if (r) out.push({ key: `${peer.id}:e:${tid}`, color: peer.color, rect: { x: e.x + r.x, y: e.y + r.y, w: r.w, h: r.h } });
        }
      }
      const editing = d.editing ? canvas.boards[d.editing] : undefined;
      if (editing) out.push({ key: `${peer.id}:editing`, color: peer.color, rect: editing, label: `${peer.name} is editing` });
    }
    for (const path of agentWrote?.paths ?? []) {
      const e = canvas.boards[path];
      if (e && here(e.page)) out.push({ key: `agent:${path}`, color: AGENT_COLOR, rect: e, label: 'Agent edited', agent: true });
    }
    return out;
    // layoutTick: element boxes move as artboards re-render.
  }, [peers, agentWrote, canvas, page, layoutTick]);

  const camera = useLiveCamera(mode === 'canvas' && (boxes.length > 0 || peers.some(peer => peer.cursor && here(peer.state?.page))));
  if (mode !== 'canvas') return null;
  return (
    <div data-presence-layer="" className="contents">
      <PeerBoxes camera={camera} boxes={boxes} />
      <PeerCursors camera={camera} peers={peers} shown={(peer: DesignPeer) => here(peer.state?.page)} interpolate={false} />
    </div>
  );
}

/** Avatars of the people and the agent here now. */
export function PresenceAvatars(): ReactNode {
  const peers = usePresence((s) => s.peers);
  const agentWrote = usePresence((s) => Boolean(s.agentWrote));
  return <SharedAvatars peers={peers} agentWrote={agentWrote} status={(peer) => (peer.state?.editing ? 'editing' : null)} noun="design" Tip={Tip} />;
}
