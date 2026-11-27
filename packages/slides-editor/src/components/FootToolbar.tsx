/**
 * The toolbar floating at the bottom of the stage: the Text tool, Image or
 * video (a file from this computer), Video (a file or a link), Table, the
 * Shapes tool and its menu; Comment, which turns comment mode on with the
 * All comments panel beside the stage; and the Ask field that hands a
 * request to the agent with what this viewer is looking at.
 */

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, Circle, Diamond, Image, Link, Loader2, MessageCircle, Minus, MoveRight, RectangleHorizontal, Shapes, Spline, Square, Table, Type, Upload, Video } from 'lucide-react';
import { cn, isComposingKey } from '@open-artifact/ui';
import { getToolbarKeyTarget, isTextField } from '@open-artifact/editor-kit';
import { useUi } from '../state/ui.ts';
import { useView, type Tool } from '../state/view.ts';
import { sendToAgent, useAgent } from '../services/agent.ts';
import { MEDIA_ACCEPT, VIDEO_ACCEPT, pickFiles, placeFiles } from '../services/assets.ts';
import { insertShape, type InsertShapeKind } from '../services/commands.ts';
import { setCommenting, useComments } from '../services/comments.ts';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, SHIFT, Tip } from '@open-artifact/editor-kit/react';

const ICON = { className: 'size-5', strokeWidth: 1.5 } as const;
const SMALL = { className: 'size-4', strokeWidth: 1.5 } as const;

/** Shape tools of the Shapes menu: [tool, label, icon, shortcut]. */
const SHAPES: [Tool, string, ReactNode, string][] = [
  ['rect', 'Rectangle', <Square key="r" {...SMALL} />, 'R'],
  ['rounded', 'Rounded rectangle', <RectangleHorizontal key="rr" {...SMALL} />, `${SHIFT}R`],
  ['ellipse', 'Ellipse', <Circle key="e" {...SMALL} />, 'O'],
  ['diamond', 'Diamond (decision)', <Diamond key="d" {...SMALL} />, 'D'],
];

/** Line tools, drawn from point to point. */
const LINES: [Tool, string, ReactNode, string][] = [
  ['line', 'Line', <Minus key="l" {...SMALL} />, 'L'],
  ['connector', 'Connector', <Spline key="c" {...SMALL} />, `${SHIFT}L`],
];

/** Every drawing tool. */
const DRAW = [...SHAPES, ...LINES];

/** Arrows placed at once (no drawing tool): [kind, label, icon]. */
const ARROWS: [InsertShapeKind, string, ReactNode][] = [
  ['arrow-right', 'Arrow right', <MoveRight key="ar" {...SMALL} />],
  ['arrow-left', 'Arrow left', <MoveRight key="al" {...SMALL} className="size-4 rotate-180" />],
  ['arrow-up', 'Arrow up', <MoveRight key="au" {...SMALL} className="size-4 -rotate-90" />],
  ['arrow-down', 'Arrow down', <MoveRight key="ad" {...SMALL} className="size-4 rotate-90" />],
];

/** Picks files of `accept` and places them on the slide. */
function pickMedia(accept: string = MEDIA_ACCEPT): void {
  void pickFiles(accept, true).then((files) => {
    if (files.length) void placeFiles(files);
  });
}

/** The Shapes button: the last drawing tool, and a menu of every shape. */
function ShapesMenu(): ReactNode {
  const tool = useView((s) => s.tool);
  const drawing = DRAW.find(([t]) => t === tool);
  return (
    <ChromeMenu
      side="top"
      align="center"
      tip={{ label: drawing ? drawing[1] : 'Shapes', side: 'top' }}
      trigger={
        <ChromeButton size="lg" pressed={Boolean(drawing)} aria-label="Shapes" className="gap-0 pl-1.5 pr-0.5">
          {drawing ? <span className="flex size-5 items-center justify-center [&>svg]:size-5">{drawing[2]}</span> : <Shapes {...ICON} />}
          <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      {SHAPES.map(([t, label, icon, shortcut]) => (
        <ChromeMenuItem key={t} icon={icon} shortcut={shortcut} onSelect={() => useView.getState().setTool(t)}>
          {label}
        </ChromeMenuItem>
      ))}
      {ARROWS.map(([kind, label, icon]) => (
        <ChromeMenuItem key={kind} icon={icon} onSelect={() => insertShape(kind)}>
          {label}
        </ChromeMenuItem>
      ))}
      <ChromeMenuSeparator />
      {LINES.map(([t, label, icon, shortcut]) => (
        <ChromeMenuItem key={t} icon={icon} shortcut={shortcut} onSelect={() => useView.getState().setTool(t)}>
          {label}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );
}

/** The Video button: a clip from this computer, or a link to one online. */
function VideoMenu(): ReactNode {
  return (
    <ChromeMenu
      side="top"
      align="center"
      tip={{ label: 'Video', side: 'top' }}
      trigger={
        <ChromeButton size="lg" aria-label="Video" className="gap-0 pl-1.5 pr-0.5">
          <Video {...ICON} />
          <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      <ChromeMenuItem icon={<Upload {...SMALL} />} onSelect={() => pickMedia(VIDEO_ACCEPT)}>
        Upload video…
      </ChromeMenuItem>
      <ChromeMenuItem icon={<Link {...SMALL} />} onSelect={() => useUi.getState().open('videoLink')}>
        Embed a video link…
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** Comment: comment mode and the All comments panel, on and off together. */
function CommentButton(): ReactNode {
  const on = useComments((s) => s.on);
  return (
    <Tip label={on ? 'Done commenting' : 'Comment'} shortcut="C" side="top">
      <ChromeButton size="lg" square pressed={on} aria-label="Comment" onClick={() => setCommenting(!on)}>
        <MessageCircle {...ICON} fill={on ? 'currentColor' : 'none'} />
      </ChromeButton>
    </Tip>
  );
}

/** The Ask field: one line that grows into the composer while focused. */
function AskField(): ReactNode {
  const name = useAgent((s) => s.status.name);
  const busy = useAgent((s) => s.status.busy);
  const selected = useView((s) => s.selection.length);
  const onSlide = useView((s) => s.current !== null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);

  const send = async (): Promise<void> => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      // The draft stays when the words are refused or the send fails, so the person can try again.
      const result = await sendToAgent(message);
      if (result && result.status !== 'failed') setText('');
    } finally {
      setSending(false);
    }
  };

  const open = focused || text.length > 0;
  return (
    <form
      className={cn('flex h-8 shrink-0 items-center gap-1 rounded-[8px] bg-chrome-field pl-2.5 pr-1 transition-[width] duration-150', open ? 'w-64' : 'w-[100px]')}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-chrome-muted" aria-label={`${name} is working`} /> : null}
      <input
        value={text}
        aria-label={`Ask ${name}`}
        placeholder={open ? (selected ? `Ask ${name} about the selection…` : onSlide ? `Ask ${name} to change this slide…` : `Ask ${name} to make some slides…`) : `Ask ${name}`}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-chrome-fg outline-none placeholder:text-chrome-muted"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isComposingKey(event.nativeEvent)) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {open ? (
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim() || sending}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chrome-fg text-chrome outline-none disabled:opacity-30"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" strokeWidth={2} />}
        </button>
      ) : null}
    </form>
  );
}

/** Props of {@link FootToolbar}. */
export interface FootToolbarProps {
  /** Show the tools that change the slide (an editor who can change it). */
  editing: boolean;
  /** Show the Ask field. */
  ask: boolean;
  /** Show Comment (this viewer may comment). */
  comment?: boolean;
  /** Why the insert tools can't be used yet (they show disabled), if they can't. */
  insertBlocked?: string;
}

/**
 * The insert tools, unavailable with the reason as their tip. They stay
 * focusable and take the pointer, so hovering or tabbing to one tells why.
 */
function BlockedInsert({ reason }: { reason: string }): ReactNode {
  const reasonId = useId();
  const tools: [string, ReactNode][] = [
    ['Text', <Type key="t" {...ICON} />],
    ['Image or video', <Image key="i" {...ICON} />],
    ['Video', <Video key="v" {...ICON} />],
    ['Table', <Table key="tb" {...ICON} />],
    ['Shapes', <Shapes key="s" {...ICON} />],
  ];
  return (
    <>
      <span id={reasonId} hidden>
        {reason}
      </span>
      {tools.map(([label, icon]) => (
        <Tip key={label} label={`${label}. ${reason}`} side="top">
          <ChromeButton
            size="lg"
            square
            aria-label={label}
            aria-disabled
            aria-describedby={reasonId}
            className="opacity-40 hover:bg-transparent"
          >
            {icon}
          </ChromeButton>
        </Tip>
      ))}
    </>
  );
}

/** The toolbar (the caller places it). */
export function FootToolbar({ editing, ask, comment = false, insertBlocked }: FootToolbarProps): ReactNode {
  const tool = useView((s) => s.tool);
  const view = useView.getState;
  if (!editing && !ask && !comment) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isComposingKey(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextField(event.target)) return;
    if (document.querySelector('[role="menu"], [role="listbox"]')) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].filter(
      (button) => !button.closest('form'),
    );
    const active = document.activeElement;
    const index = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
    const next = getToolbarKeyTarget(event.key, index, buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <Card role="toolbar" aria-label={editing ? 'Insert' : ask ? 'Ask' : 'Comment'} className="max-w-full gap-1 p-1" onKeyDown={onKeyDown}>
      {editing && insertBlocked ? <BlockedInsert reason={insertBlocked} /> : null}
      {editing && !insertBlocked ? (
        <>
          <Tip label="Text" shortcut="T" side="top">
            <ChromeButton size="lg" square pressed={tool === 'text'} aria-label="Text" onClick={() => view().setTool(tool === 'text' ? 'select' : 'text')}>
              <Type {...ICON} />
            </ChromeButton>
          </Tip>
          <Tip label="Image or video" side="top">
            <ChromeButton size="lg" square aria-label="Image or video" onClick={() => pickMedia()}>
              <Image {...ICON} />
            </ChromeButton>
          </Tip>
          <VideoMenu />
          <Tip label="Table" side="top">
            <ChromeButton size="lg" square aria-label="Table" onClick={() => useUi.getState().open('table')}>
              <Table {...ICON} />
            </ChromeButton>
          </Tip>
          <ShapesMenu />
        </>
      ) : null}
      {(ask || comment) && editing ? <ChromeDivider className="mx-0" /> : null}
      {comment ? <CommentButton /> : null}
      {ask ? <AskField /> : null}
    </Card>
  );
}
