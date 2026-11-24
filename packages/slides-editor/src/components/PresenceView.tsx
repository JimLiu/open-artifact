/**
 * Presence and following, drawn from plain props (no stores): the avatars
 * card with its follow menu ("Follow me" with "N following you", follow the
 * agent, follow a person), the "Following …" pill, and peers' cursors over
 * a tile. Presence.tsx feeds it the slides editor's state.
 */

import { localize } from '@open-artifact/runtime';
import type { ReactNode } from 'react';
import { Eye, MousePointer2, Radio, Sparkles, X } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { Card, ChromeButton, ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator } from '@open-artifact/editor-kit/react';

/** A peer as these components draw it. */
export interface PresencePeer {
  id: string;
  name: string;
  kind: 'person' | 'agent';
  /** Their color (`peerColor` of `@open-artifact/editor-kit`, or its `AGENT_COLOR`). */
  color: string;
  /** Where they are, shown under their name ("On slide 3"). */
  where?: string;
}

function Avatar({ peer, ring }: { peer: PresencePeer; ring?: boolean }): ReactNode {
  return (
    <span
      className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-chrome', ring && 'outline-2 outline-offset-1 outline-chrome-accent')}
      style={{ background: peer.color }}
      aria-hidden
    >
      {peer.kind === 'agent' ? <Sparkles className="size-3" /> : peer.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export interface PresenceMenuProps {
  peers: readonly PresencePeer[];
  /** The peer id followed, if any. */
  following: string | null;
  leading: boolean;
  followers: number;
  /** The agent, when one can be followed. */
  agent: { name: string; following: boolean } | null;
  onFollow(id: string | null): void;
  onLead(on: boolean): void;
  onFollowAgent(on: boolean): void;
}

/** The avatars card with the follow menu. Hidden when no one else is here and there is no agent. */
export function PresenceMenu({ peers, following, leading, followers, agent, onFollow, onLead, onFollowAgent }: PresenceMenuProps): ReactNode {
  const people = peers.filter((p) => p.kind === 'person');
  if (peers.length === 0 && !agent) return null;
  const shown = peers.slice(0, 3);
  return (
    <Card className="pointer-events-auto flex items-center p-1">
      <ChromeMenu
        align="end"
        tip={{ label: followers ? localize(`${followers} following you`, `${followers} 人正在跟随你`) : localize('People here', '在线成员') }}
        trigger={
          <ChromeButton size="lg" aria-label={localize('People here and following', '在线成员及跟随状态')} className="gap-1.5 px-1.5">
            {shown.length ? (
              <span className="flex -space-x-1.5">
                {shown.map((peer) => (
                  <Avatar key={peer.id} peer={peer} ring={peer.id === following} />
                ))}
              </span>
            ) : (
              <Eye className="size-5" strokeWidth={1.5} />
            )}
            {peers.length > 3 ? <span className="text-xs text-chrome-muted">+{peers.length - 3}</span> : null}
            {leading || followers ? (
              <span className={cn('flex items-center gap-1 rounded-full px-1.5 text-[11px] tabular-nums', leading ? 'bg-chrome-pressed text-chrome-pressed-fg' : 'text-chrome-muted')}>
                <Radio className="size-3" aria-hidden />
                {followers}
              </span>
            ) : null}
          </ChromeButton>
        }
      >
        <ChromeMenuItem
          checked={leading}
          icon={<Radio className="size-4" strokeWidth={1.5} />}
          description={leading ? (followers ? localize(`${followers} ${followers === 1 ? 'person is' : 'people are'} following you`, `${followers} 人正在跟随你`) : localize('No one is following yet', '暂时无人跟随')) : localize('Everyone here sees what you are looking at', '在线成员可以看到你正在查看的内容')}
          onSelect={() => onLead(!leading)}
          disabled={people.length === 0 && !leading}
        >
          {localize('Follow me', '跟随我')}
        </ChromeMenuItem>
        {agent ? (
          <ChromeMenuItem
            checked={agent.following}
            icon={<Sparkles className="size-4" strokeWidth={1.5} />}
            description={localize('Your view follows what it changes', '你的视图会随它的操作切换')}
            onSelect={() => onFollowAgent(!agent.following)}
          >
            {localize('Follow', '跟随')} {agent.name}
          </ChromeMenuItem>
        ) : null}
        {people.length ? (
          <>
            <ChromeMenuSeparator />
            <ChromeMenuLabel>{localize('People here', '在线成员')}</ChromeMenuLabel>
            {people.map((peer) => (
              <ChromeMenuItem
                key={peer.id}
                checked={following === peer.id}
                icon={<Avatar peer={peer} />}
                description={peer.where}
                onSelect={() => onFollow(following === peer.id ? null : peer.id)}
              >
                {following === peer.id ? localize(`Following ${peer.name}`, `正在跟随 ${peer.name}`) : localize(`Follow ${peer.name}`, `跟随 ${peer.name}`)}
              </ChromeMenuItem>
            ))}
          </>
        ) : null}
      </ChromeMenu>
    </Card>
  );
}

/** "Following Ana · Esc to stop" (or "Others follow you · N following") at the top of the stage. */
export function FollowingBanner({ name, leading, followers, onStop }: { name: string | null; leading: boolean; followers: number; onStop(): void }): ReactNode {
  if (!name && !leading) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[60px] z-20 flex justify-center">
      <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-full bg-chrome-accent py-1 pl-3 pr-1 text-xs font-medium text-white shadow-chrome">
        <span>{name ? localize(`Following ${name}`, `正在跟随 ${name}`) : localize(`Others follow you · ${followers} following`, `正在带看 · ${followers} 人跟随`)}</span>
        <span className="text-white/70">{name ? localize('Esc to stop', '按 Esc 停止') : ''}</span>
        <button type="button" aria-label={name ? localize('Stop following', '停止跟随') : localize('Stop leading', '结束带看')} className="flex size-5 items-center justify-center rounded-full hover:bg-white/20" onClick={onStop}>
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Peers' cursors over one box (positions are 0–1 fractions of it). */
export function PeerCursorLayer({ cursors, peers }: { cursors: ReadonlyArray<{ peerId: string; x: number; y: number }>; peers: readonly PresencePeer[] }): ReactNode {
  if (cursors.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {cursors.map(({ peerId, x, y }) => {
        const peer = peers.find((p) => p.id === peerId);
        if (!peer) return null;
        const color = peer.color;
        return (
          <div key={peerId} className="absolute transition-[left,top] duration-75 ease-linear" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
            <MousePointer2 className="size-4 -translate-x-[3px] -translate-y-[2px] drop-shadow" style={{ color, fill: color }} strokeWidth={1.5} />
            <span className="absolute left-3 top-3 whitespace-nowrap rounded px-1 py-px text-[10px] font-medium text-white" style={{ background: color }}>
              {peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
