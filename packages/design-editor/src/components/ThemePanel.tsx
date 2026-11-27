/**
 * The Theme tab: the design systems installed on this canvas
 * (`project/ds/<folder>/` plus a `designSystems` record in canvas.json),
 * each with its colors, type styles, font families and scales.
 *
 * Picking a color or a type style applies it to the selected elements
 * (colors as `var(--token, literal)`, styles as plain declarations). Each
 * system's copied README opens read-only.
 */

import { boardsOnPage } from '@open-artifact/design-core';
import { BookOpen, Bot } from 'lucide-react';
import type { SystemCopyStatus } from '@open-artifact/runtime';
import { flush } from '../services/sync.ts';
import { useEffect, useState } from 'react';
import { Button, Dialog, cn } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { sendToAgent, useAgent } from '../services/agent.ts';
import { styleSelection } from '../services/commands.ts';
import { readmePath, swatchValue, systemStylePatch, useDesignSystems, type InstalledSystem } from '../services/design-systems.ts';
import { session } from '../services/session.ts';
import { announce } from '../services/announce.ts';
import { PButton, PNote, PRow, PSection, PSegments } from './fields.tsx';
import { Tip } from '@open-artifact/editor-kit/react';
import { boardsReached, elementGroupsOf } from '../lib/selection.ts';

type Target = 'fill' | 'text' | 'border';

const TARGET_PROPERTY: Record<Target, string> = { fill: 'background-color', text: 'color', border: 'border-color' };

/** The copied README of a system, read-only. */
function ReadmeDialog({ system, onClose }: { system: InstalledSystem | null; onClose(): void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    setError(null);
    if (!system) return;
    let live = true;
    session()
      .artifact.readText(readmePath(system.namespace))
      .then(
        (value) => live && setText(value),
        () => live && setError('This copy has no README.md. Its tokens are listed in the Theme tab.'),
      );
    return () => {
      live = false;
    };
  }, [system]);
  return (
    <Dialog
      open={system !== null}
      onOpenChange={(open) => !open && onClose()}
      title={system ? `${system.title} (read-only)` : ''}
      description={system ? `project/ds/${system.namespace}/ · copied from ${system.artifact || 'an unknown source'}${system.copiedAt ? ` on ${system.copiedAt.slice(0, 10)}` : ''}` : undefined}
      className="w-[min(42rem,calc(100vw-2rem))]"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="max-h-[60vh] overflow-y-auto rounded-[8px] bg-surface-2 p-3">
        {error ? <p className="text-[13px] text-fg-muted">{error}</p> : text === null ? <p className="text-[13px] text-fg-muted">Loading…</p> : <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5">{text}</pre>}
      </div>
    </Dialog>
  );
}

function CopyStatus({ system }: { system: InstalledSystem }) {
  const copy = session().artifact.systemCopy;
  const [status, setStatus] = useState<SystemCopyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const readOnly = useDocument(s => s.readOnly);
  useEffect(() => {
    if (!copy) return;
    let active = true;
    const refresh = () => copy(system.namespace, 'status').then(value => {
      if (active) { setStatus(value); setError(''); }
    }, () => active && setError('Could not check the source.'));
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [copy, system.namespace, system.copiedAt]);
  if (!copy) return null;
  const sync = async () => {
    setBusy(true);
    try {
      await flush();
      setStatus(await copy(system.namespace, 'sync'));
      setError('');
    } catch { setError('Could not sync this copy.'); }
    finally { setBusy(false); }
  };
  return <div className="flex items-center justify-between gap-2 px-3 py-1 text-[12px] text-chrome-secondary">
    <span role="status">{error || (status?.state === 'behind' ? [status.changed ? 'Behind source' : '', status.removed ? `${status.removed} removed from source` : ''].filter(Boolean).join(' · ')
      : status?.state === 'current' ? 'Up to date' : status?.state === 'missing' ? 'Installed copy missing' : status ? 'Source not found' : 'Checking source…')}</span>
    {status?.changed && !readOnly ? <PButton disabled={busy} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync'}</PButton> : null}
  </div>;
}

function SystemCard({ system, target, onReadme }: { system: InstalledSystem; target: Target; onReadme(): void }) {
  const readOnly = useDocument((s) => s.readOnly);
  const hasElements = useView((s) => elementGroupsOf(s.selection).length > 0);
  const selection = useView(s => s.selection);
  const page = useView(s => s.page);
  const canvas = useDocument(s => s.canvas);
  const selected = boardsReached(selection);
  const paths = selected.length ? selected : boardsOnPage(canvas, page);
  const can = hasElements && !readOnly;
  return (
    <PSection
      title={system.title}
      action={
        <Tip label="View this system (read-only)">
          <button type="button" aria-label={`View ${system.title}`} onClick={onReadme} className="flex size-6 items-center justify-center rounded-[6px] text-chrome-secondary hover:bg-chrome-hover hover:text-chrome-fg">
            <BookOpen className="size-3.5" />
          </button>
        </Tip>
      }
    >
      <PNote className="py-0.5 font-mono text-[11px]">ds/{system.namespace}/{system.version ? ` · v${system.version}` : ''}</PNote>
      <CopyStatus system={system} />
      {system.looks.length ? <div className="px-3 py-1.5">
        <div className="mb-1 text-[12px] text-chrome-muted">Apply look to {selected.length ? 'selection' : 'page'}</div>
        <div className="flex flex-wrap gap-1">{system.looks.map(look => <PButton key={look.id} disabled={readOnly || !paths.length}
          aria-label={'Apply ' + look.name + ' look'} onClick={() => {
            const n = useDocument.getState().editBoards(paths, { kind: 'look', look });
            announce(n ? `Applied ${look.name} to ${n} artboard${n === 1 ? '' : 's'}` : 'No matching styles to change');
          }}>
          <span className="inline-flex overflow-hidden rounded-sm" aria-hidden="true">{look.colors.slice(0, 3).map(c => <i key={c.name} className="h-3 w-2" style={{ backgroundColor: c.value }} />)}</span>
          {look.name}
        </PButton>)}</div>
      </div> : null}
      {system.colors.length ? (
        <div className="px-3 pb-1 pt-1.5">
          <div className="mb-1 text-[12px] text-chrome-muted">Colors</div>
          <div role="list" aria-label={`${system.title} colors`} className="flex flex-wrap gap-1.5">
            {system.colors.map((color) => (
              <Tip key={color.name} label={`--${color.name} · ${color.value}${color.usage ? ` — ${color.usage}` : ''}`}>
                <button
                  type="button"
                  role="listitem"
                  aria-label={`${color.name}, ${color.value}`}
                  disabled={!can}
                  onClick={() => {
                    styleSelection({ [TARGET_PROPERTY[target]]: swatchValue(color) });
                    announce(`Applied ${color.name}`);
                  }}
                  className={cn('size-[22px] rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]', can ? 'cursor-pointer hover:outline-2 hover:outline-offset-1 hover:outline-chrome-accent' : 'cursor-default')}
                  style={{ background: color.value }}
                />
              </Tip>
            ))}
          </div>
        </div>
      ) : null}
      {system.styles.length ? (
        <div className="px-1.5 pt-1.5">
          <div className="mb-1 px-1.5 text-[12px] text-chrome-muted">Text styles</div>
          {system.styles.map((style) => {
            const size = Number.parseFloat(style.declarations['font-size'] ?? '16');
            return (
              <button
                key={style.id}
                type="button"
                disabled={!can}
                onClick={() => {
                  styleSelection(systemStylePatch(style));
                  announce(`Applied text style ${style.name}`);
                }}
                className="flex w-full items-baseline gap-2 rounded-[6px] px-1.5 py-1 text-left enabled:hover:bg-chrome-hover disabled:cursor-default"
              >
                <span
                  className="min-w-0 flex-1 truncate text-chrome-fg"
                  style={{
                    fontFamily: style.declarations['font-family'],
                    fontWeight: style.declarations['font-weight'] as never,
                    fontStyle: style.declarations['font-style'],
                    textTransform: style.declarations['text-transform'] as never,
                    fontSize: Math.min(26, Math.max(11, size)),
                    lineHeight: 1.25,
                  }}
                >
                  {style.name}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-chrome-muted">{Math.round(size)}px</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {system.families.length ? (
        <div className="px-3 pt-2">
          <div className="mb-1 text-[12px] text-chrome-muted">Fonts</div>
          {system.families.map((family) => (
            <div key={family.key} className="flex items-baseline gap-2 text-[12px]">
              <span className="w-16 shrink-0 truncate text-chrome-muted">{family.key}</span>
              <span className="min-w-0 truncate text-chrome-fg" style={{ fontFamily: family.stack }}>
                {family.stack}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {system.spacing.length || system.radius.length ? (
        <div className="px-3 pt-2 text-[12px]">
          {system.spacing.length ? (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="text-chrome-muted">Spacing</span>
              {system.spacing.slice(0, 12).map((entry) => (
                <span key={entry.name} title={`--${entry.name}`} className="tabular-nums text-chrome-secondary">
                  {entry.value}
                </span>
              ))}
            </div>
          ) : null}
          {system.radius.length ? (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="text-chrome-muted">Radius</span>
              {system.radius.slice(0, 12).map((entry) => (
                <span key={entry.name} title={`--${entry.name}`} className="tabular-nums text-chrome-secondary">
                  {entry.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </PSection>
  );
}

/** The Theme tab body. */
export function ThemePanel() {
  const systems = useDesignSystems((s) => s.systems);
  const missing = useDesignSystems((s) => s.missing);
  const loaded = useDesignSystems((s) => s.loaded);
  const readOnly = useDocument((s) => s.readOnly);
  const agent = useAgent((s) => s.status);
  const [target, setTarget] = useState<Target>('fill');
  const [readme, setReadme] = useState<InstalledSystem | null>(null);

  if (!loaded) return <PNote className="py-3">Reading design systems…</PNote>;

  return (
    <div className="flex min-w-0 flex-col">
      {systems.length ? (
        <PSection title="Apply colors to">
          <PRow label="Target">
            <PSegments
              className="flex-1"
              value={target}
              options={[
                { value: 'fill', label: 'Fill', icon: <span className="text-[12px]">Fill</span> },
                { value: 'text', label: 'Text', icon: <span className="text-[12px]">Text</span> },
                { value: 'border', label: 'Border', icon: <span className="text-[12px]">Border</span> },
              ]}
              onChange={(value) => setTarget(value as Target)}
            />
          </PRow>
          <PNote className="py-0.5">Select elements on an artboard, then pick a color or a text style.</PNote>
        </PSection>
      ) : (
        <PSection title="Design systems">
          <PNote className="py-1">No design system is installed on this canvas. Installed systems offer their colors and text styles here and in the properties panel.</PNote>
          {agent.available && !readOnly ? (
            <div className="px-3 pt-1">
              <PButton onClick={() => void sendToAgent('Install a design system on this canvas (copy it under project/ds/<folder>/ and add its record to designSystems in project/canvas.json) so its colors and text styles show in the Theme tab.')}>
                <Bot className="size-3.5" /> Ask {agent.name} to add one
              </PButton>
            </div>
          ) : null}
        </PSection>
      )}
      {systems.map((system) => (
        <SystemCard key={system.namespace} system={system} target={target} onReadme={() => setReadme(system)} />
      ))}
      {missing.length ? <PNote className="py-2">{missing.map((ns) => `ds/${ns}`).join(', ')}: listed in canvas.json, but its tokens.json is missing or unreadable.</PNote> : null}
      <ReadmeDialog system={readme} onClose={() => setReadme(null)} />
    </div>
  );
}
