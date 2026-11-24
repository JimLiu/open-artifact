/**
 * The gradient editor of a fill's Custom tab (Type: Gradient): the style
 * (linear or radial) and angle, a bar with a draggable handle per stop, and
 * the stop list (position, color, remove). Up to eight stops, at least two.
 */

import { localize } from '@open-artifact/runtime';
import { Minus, Plus, RotateCw } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { formatBackground, type Gradient } from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { ColorField, useColorGroups } from './ColorField.tsx';
import { IconButton, NumberInput, SelectInput } from './kit.tsx';

/** Most stops a gradient keeps. */
export const MAX_STOPS = 8;
const MIN_STOPS = 2;

const CHECKER = 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px';

/** A stop's position in percent (spread evenly when unset). */
export function stopPosition(gradient: Gradient, i: number): number {
  const raw = gradient.stops[i]?.positions[0];
  const m = raw ? /^(-?[\d.]+)%$/.exec(raw) : null;
  return m ? Number(m[1]) : Math.round((i / Math.max(1, gradient.stops.length - 1)) * 100);
}

/** `gradient` with every stop's position written out. */
function withPositions(gradient: Gradient): Gradient {
  return { ...gradient, stops: gradient.stops.map((stop, i) => ({ ...stop, positions: [`${stopPosition(gradient, i)}%`] })) };
}

/** `gradient` with stop `i` at `at` percent. */
function moveStop(gradient: Gradient, i: number, at: number): Gradient {
  const next = withPositions(gradient);
  return { ...next, stops: next.stops.map((stop, j) => (j === i ? { ...stop, positions: [`${Math.round(Math.max(0, Math.min(100, at)))}%`] } : stop)) };
}

/** Props of {@link GradientEditor}. */
export interface GradientEditorProps {
  gradient: Gradient;
  /** Every change (callers coalesce drags into one undo step). */
  onChange: (next: Gradient) => void;
  /** Linear only (a text fill clips a linear gradient). */
  linearOnly?: boolean;
}

/** One compact labelled line inside the popover. */
function Line({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="w-12 shrink-0 text-[12px] text-chrome-muted">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** The gradient editor. */
export function GradientEditor({ gradient, onChange, linearOnly = false }: GradientEditorProps): ReactNode {
  const groups = useColorGroups();
  const [selected, setSelected] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const radial = gradient.type === 'radial';
  const positions = gradient.stops.map((_, i) => stopPosition(gradient, i));
  const sorted = [...gradient.stops.map((stop, i) => ({ stop, at: positions[i]! }))].sort((a, b) => a.at - b.at);
  const preview = formatBackground({ gradient: { type: 'linear', angle: 90, stops: sorted.map(({ stop, at }) => ({ ...stop, positions: [`${at}%`] })) } });

  const atPointer = (event: PointerEvent): number => {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return 0;
    return ((event.clientX - box.left - 12) / Math.max(1, box.width - 24)) * 100;
  };
  const onHandleKey = (i: number) => (event: KeyboardEvent<HTMLButtonElement>): void => {
    const step = event.shiftKey ? 10 : 1;
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : 0;
    if (!delta) return;
    event.preventDefault();
    onChange(moveStop(gradient, i, positions[i]! + delta));
  };
  const addStop = (): void => {
    // Halfway between the selected stop and its right neighbour.
    const at = positions[selected] ?? 50;
    const right = positions.filter((p) => p > at).sort((a, b) => a - b)[0] ?? Math.min(100, at + 20);
    const next = withPositions(gradient);
    next.stops.push({ color: gradient.stops[selected]?.color ?? '#ffffff', positions: [`${Math.round((at + right) / 2)}%`] });
    onChange(next);
    setSelected(next.stops.length - 1);
  };
  const removeStop = (i: number): void => {
    onChange({ ...gradient, stops: gradient.stops.filter((_, j) => j !== i) });
    setSelected(Math.max(0, Math.min(selected, gradient.stops.length - 2)));
  };

  return (
    <div className="flex flex-col gap-2">
      <Line label={localize('Style', '样式')}>
        <SelectInput<'linear' | 'radial'>
          aria-label={localize('Gradient style', '渐变样式')}
          value={radial ? 'radial' : 'linear'}
          options={[
            { value: 'linear', label: localize('Linear', '线性') },
            { value: 'radial', label: localize('Radial', '径向'), disabled: linearOnly, reason: localize('Linear gradients only here.', '此处仅支持线性渐变。') },
          ]}
          onChange={(type) => onChange(type === 'radial' ? { type, shape: 'ellipse', stops: gradient.stops } : { type, angle: gradient.angle ?? 180, stops: gradient.stops })}
        />
        <NumberInput
          aria-label={localize('Angle', '角度')}
          className="w-[76px] shrink-0"
          label={<RotateCw />}
          value={radial ? null : (gradient.angle ?? 180)}
          placeholder={radial ? '–' : '180'}
          unit="°"
          min={0}
          max={360}
          steppers={false}
          disabled={radial}
          title={radial ? localize('A radial gradient has no angle.', '径向渐变无需设置角度。') : undefined}
          onCommit={(v) => onChange({ ...gradient, angle: v ?? 180 })}
        />
      </Line>
      <div ref={bar} className="relative my-1 h-8 rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ background: CHECKER }}>
        <div className="absolute inset-0 rounded-[6px]" style={{ background: preview }} />
        <div className="absolute inset-y-0 left-3 right-3">
          {gradient.stops.map((stop, i) => (
            <button
              key={i}
              type="button"
              role="slider"
              aria-label={localize(`Stop ${i + 1} position`, `第 ${i + 1} 个色标的位置`)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(positions[i]!)}
              className={cn(
                'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-default touch-none rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)] outline-none focus-visible:ring-2 focus-visible:ring-chrome-accent',
                i === selected && 'z-[1] outline-2 outline-offset-1 outline-chrome-fg',
              )}
              style={{ left: `${positions[i]}%`, background: stop.color }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setSelected(i);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(moveStop(gradient, i, atPointer(event)));
              }}
              onKeyDown={onHandleKey(i)}
            />
          ))}
        </div>
      </div>
      <Line label={localize('Stops', '色标')}>
        <span className="flex-1" />
        <IconButton size="sm" label={localize('Add stop', '添加色标')} icon={<Plus className="size-4" strokeWidth={1.5} />} disabled={gradient.stops.length >= MAX_STOPS} title={gradient.stops.length >= MAX_STOPS ? localize(`${MAX_STOPS} stops at most.`, `最多 ${MAX_STOPS} 个色标。`) : undefined} onClick={addStop} />
      </Line>
      <div role="list" aria-label={localize('Stops', '色标')} className="flex flex-col gap-1.5">
        {gradient.stops.map((stop, i) => (
          <div key={i} role="listitem" className={cn('flex min-w-0 items-center gap-1.5 rounded-[8px]', i === selected && 'bg-chrome-hover')} onFocus={() => setSelected(i)}>
            <NumberInput aria-label={localize(`Stop ${i + 1} position`, `第 ${i + 1} 个色标的位置`)} className="w-[60px] shrink-0" value={Math.round(positions[i]!)} unit="%" min={0} max={100} steppers={false} onCommit={(v) => onChange(moveStop(gradient, i, v ?? positions[i]!))} />
            <div className="min-w-0 flex-1">
              <ColorField
                aria-label={localize(`Stop ${i + 1} color`, `第 ${i + 1} 个色标的颜色`)}
                value={stop.color}
                groups={groups}
                onCommit={(color) => color && onChange({ ...gradient, stops: gradient.stops.map((s, j) => (j === i ? { ...s, color } : s)) })}
              />
            </div>
            <IconButton
              size="sm"
              label={localize(`Remove stop ${i + 1}`, `移除第 ${i + 1} 个色标`)}
              icon={<Minus className="size-4" strokeWidth={1.5} />}
              disabled={gradient.stops.length <= MIN_STOPS}
              title={gradient.stops.length <= MIN_STOPS ? localize(`A gradient needs ${MIN_STOPS} color stops.`, `渐变至少需要 ${MIN_STOPS} 个色标。`) : undefined}
              onClick={() => removeStop(i)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
