import type { CSSProperties } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { MAX_GUIDES, type BoardEntry, type BoardGuide } from '@open-artifact/design-core';
import { PButton, PIconButton, PInput, PRow, PSection, PSelect } from './fields.tsx';

type Axis = 'stretch' | 'start' | 'center' | 'end';
const options = (values: string[]) => values.map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
const valueIn = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function metrics(g: BoardGuide) {
  const columns = g.kind === 'columns';
  return {
    size: valueIn(g.size, columns ? 64 : 8, 1, g.kind === 'grid' ? 2000 : 4000),
    gutter: valueIn(g.gutter, columns ? 24 : 8, 0, 4000),
    margin: valueIn(g.margin, 0, 0, 4000),
    offset: valueIn(g.offset, 0, 0, 8000),
    align: g.align ?? (columns ? 'stretch' : 'start'),
    count: g.count ?? (columns ? 12 : 'auto'),
  };
}

function guideStyle(g: BoardGuide, board: BoardEntry): CSSProperties {
  const { size, gutter, margin, offset, align, count } = metrics(g);
  const color = typeof g.color === 'string' && CSS.supports('color', g.color) ? g.color : 'rgba(255,0,0,0.1)';
  if (g.kind === 'grid') {
    const line = (dir: string) => `linear-gradient(to ${dir}, ${color} calc(1px / var(--board-zoom)), transparent calc(1px / var(--board-zoom)))`;
    return { inset: 0, backgroundImage: [line('right'), line('bottom')].join(', '), backgroundSize: `${size}px ${size}px`, opacity: `clamp(0, (${size} * var(--board-zoom) - 3) / 4, 1)` };
  }
  const columns = g.kind === 'columns';
  const extent = columns ? board.w : board.h;
  const available = extent - (align === 'center' ? 0 : offset);
  const auto = align === 'stretch' ? (columns ? 12 : 4) : valueIn(Math.floor((available + gutter) / (size + gutter)), 1, 1, 1000);
  const n = count === 'auto' ? auto : Math.round(valueIn(count, auto, 1, 64));
  const band = align === 'stretch' ? Math.max(0, (extent - 2 * margin - (n - 1) * gutter) / n) : size;
  const length = align === 'stretch' ? Math.max(0, extent - 2 * margin) : n * band + (n - 1) * gutter;
  const start = align === 'stretch' ? margin : align === 'center' ? (extent - length) / 2 : align === 'end' ? extent - length - offset : offset;
  return {
    ...(columns ? { left: start, width: length, top: 0, bottom: 0 } : { top: start, height: length, left: 0, right: 0 }),
    backgroundImage: `repeating-linear-gradient(to ${columns ? 'right' : 'bottom'}, ${color} 0 ${band}px, transparent ${band}px ${band + gutter}px)`,
  };
}

/** Lives outside the board document so guides never enter Play, screenshots or exports. */
export function LayoutGuides({ entry }: { entry: BoardEntry }) {
  if (!entry.guides?.some(g => !g.hidden)) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 origin-top-left overflow-hidden" style={{ width: entry.w, height: entry.h, borderRadius: entry.radius, transform: 'scale(var(--board-zoom))' }}>
      {entry.guides.map((g, i) => g.hidden ? null : <div key={i} data-layout-guide={g.kind} className="absolute" style={guideStyle(g, entry)} />)}
    </div>
  );
}

export function GuideInspector({ guides = [], readOnly, change }: { guides?: BoardGuide[]; readOnly: boolean; change(value: BoardGuide[]): void }) {
  const update = (at: number, patch: Partial<BoardGuide>) => change(guides.map((g, i) => i === at ? { ...g, ...patch } : g));
  return (
    <PSection title="Layout guides">
      {guides.map((g, i) => {
        const m = metrics(g);
        const number = (key: 'size' | 'count' | 'gutter' | 'margin' | 'offset') => (
          <PRow key={key} label={key[0]!.toUpperCase() + key.slice(1)}>
            <PInput aria-label={`Guide ${i + 1} ${key}`} value={String(m[key])} disabled={readOnly} onCommit={value => {
              if (key === 'count' && value.toLowerCase() === 'auto') update(i, { count: 'auto' });
              else if (value === '') update(i, { [key]: undefined });
              else if (Number.isFinite(Number(value))) {
                const max = key === 'count' ? 64 : key === 'offset' ? 8000 : g.kind === 'grid' ? 2000 : 4000;
                const n = valueIn(Number(value), 0, key === 'count' || key === 'size' ? 1 : 0, max);
                update(i, { [key]: key === 'count' ? Math.round(n) : n });
              }
            }} />
          </PRow>
        );
        return <div key={i} className="mb-2">
          <PRow label={`Guide ${i + 1}`}>
            <PSelect aria-label="Guide type" value={g.kind} options={options(['columns', 'rows', 'grid'])} disabled={readOnly} onChange={kind => update(i, { kind: kind as BoardGuide['kind'] })} />
            <PIconButton label={g.hidden ? 'Show guide' : 'Hide guide'} disabled={readOnly} onClick={() => update(i, { hidden: !g.hidden })}>{g.hidden ? <EyeOff size={15} /> : <Eye size={15} />}</PIconButton>
            <PIconButton label="Remove guide" disabled={readOnly} onClick={() => change(guides.filter((_, n) => n !== i))}><Trash2 size={15} /></PIconButton>
          </PRow>
          {g.kind === 'grid' ? number('size') : <>
            <PRow label="Align"><PSelect aria-label="Guide alignment" value={m.align} options={options(['stretch', 'start', 'center', 'end'])} disabled={readOnly} onChange={align => update(i, { align: align as Axis })} /></PRow>
            {number('count')}{number('gutter')}
            {m.align === 'stretch' ? number('margin') : <>{number('size')}{m.align === 'center' ? null : number('offset')}</>}
          </>}
          <PRow label="Color"><PInput aria-label="Guide color" value={g.color ?? 'rgba(255,0,0,0.1)'} disabled={readOnly} onCommit={color => { if (!color || CSS.supports('color', color)) update(i, { color: color || undefined }); }} /></PRow>
        </div>;
      })}
      <div className="px-3"><PButton disabled={readOnly || guides.length >= MAX_GUIDES} onClick={() => change([...guides, { kind: 'columns' }])}><Plus size={14} /> Add guide</PButton></div>
    </PSection>
  );
}
