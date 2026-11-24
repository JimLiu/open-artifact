/**
 * The Advanced section (collapsed by default):
 *
 * - Sizing, for a flow child: how it aligns itself in its group (align and,
 *   in a grid, justify self), how it grows, shrinks and starts (the `flex`
 *   shorthand), and its aspect ratio.
 * - Effects: the filter and background filter (blur, brightness, contrast,
 *   saturation, grayscale, sepia, invert, hue), the transform (move, scale,
 *   rotate, skew) and the blend mode, each summarized on a field that opens
 *   its editor.
 * - CSS: every declaration of the selection as an editable row, and a row
 *   to add any property the slide subset supports (checked by the
 *   compiler's property table).
 */

import { localize } from '@open-artifact/runtime';
import { Plus, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  CSS_PROPERTIES,
  FILTER_FUNCTIONS,
  formatFilters,
  formatTransform,
  isPinned,
  parentAt,
  parseFilters,
  parseTransform,
  type CssProperty,
  type FilterFunction,
  type Filters,
  type SlideNode,
  type Transform,
} from '@open-artifact/slides-core';
import { CommitInput, IconButton, NumberInput, PanelField, Row, Section, SelectInput } from './kit.tsx';
import { CssField, commitCss, patchTarget, sharedStyle, type Target } from './shared.tsx';

/** A subsection title inside Advanced. */
function Subsection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="px-4 pb-1 pt-2 text-[12px] font-[520] text-chrome-secondary">{title}</div>
      {children}
    </div>
  );
}

/** Every Advanced subsection the selection has. */
export function AdvancedSection({ target }: { target: Target }): ReactNode {
  return (
    <Section title={localize('Advanced', '高级')} collapsible>
      <SizingRows target={target} />
      <EffectRows target={target} />
      <CssRows target={target} />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Sizing                                                                      */
/* -------------------------------------------------------------------------- */

const SELF_OPTIONS = [
  { value: 'auto', label: localize('Auto', '自动') },
  { value: 'start', label: localize('Start', '起点') },
  { value: 'center', label: localize('Center', '居中') },
  { value: 'end', label: localize('End', '终点') },
  { value: 'stretch', label: localize('Stretch', '拉伸') },
] as const;

/** grow, shrink and basis of a flow child, from `flex` or its longhands. */
interface Flex {
  grow: number;
  shrink: number;
  /** `auto`, `0%` or a px length. */
  basis: string;
}

function flexOf(node: SlideNode): Flex {
  const flex = node.style.flex?.trim();
  if (flex === 'none') return { grow: 0, shrink: 0, basis: 'auto' };
  if (flex === 'auto') return { grow: 1, shrink: 1, basis: 'auto' };
  if (flex) {
    const [a, b, c] = flex.split(/\s+/);
    const second = b !== undefined && /^[\d.]+$/.test(b);
    return { grow: Number(a) || 0, shrink: second ? Number(b) : 1, basis: (second ? c : b) ?? '0%' };
  }
  return { grow: Number(node.style['flex-grow'] ?? 0), shrink: Number(node.style['flex-shrink'] ?? 1), basis: node.style['flex-basis'] ?? 'auto' };
}

/** Writes `flex` as one shorthand (none at all when it is the default). */
function writeFlex(target: Target, label: string, fn: (flex: Flex) => Flex): void {
  patchTarget(target, label, (node) => {
    if (!node) return {};
    const next = fn(flexOf(node));
    const neutral = next.grow === 0 && next.shrink === 1 && next.basis === 'auto';
    return { flex: neutral ? undefined : `${next.grow} ${next.shrink} ${next.basis}`, 'flex-grow': undefined, 'flex-shrink': undefined, 'flex-basis': undefined };
  });
}

/** How a flow child sits in its group. */
function SizingRows({ target }: { target: Target }): ReactNode {
  if (target.nodes.length === 0 || target.nodes.some((n) => isPinned(n) || n.kind === 'connector')) return null;
  const node = target.nodes[0]!;
  const path = target.paths[0]!;
  const parentStyle = (path.length > 1 ? parentAt(target.slide, path)?.style : target.slide.style) ?? {};
  const grid = parentStyle.display === 'grid';
  const alignSelf = sharedStyle(target, 'align-self');
  const justifySelf = sharedStyle(target, 'justify-self');
  const flex = flexOf(node);
  const basisPx = /^([\d.]+)px$/.exec(flex.basis);
  const selfValue = (shared: { value: string | undefined; mixed: boolean }): string | null => (shared.mixed ? null : (shared.value?.replace(/^flex-/, '') ?? 'auto'));
  return (
    <Subsection title={localize('Sizing', '尺寸调整')}>
      <Row label={localize('Align self', '自身对齐')}>
        <SelectInput aria-label={localize('Align self', '自身对齐')} value={selfValue(alignSelf)} placeholder={localize('Mixed', '混合值')} options={SELF_OPTIONS.map((o) => ({ ...o }))} onChange={(v) => commitCss(target, 'align-self', v === 'auto' ? '' : v, localize('Align self', '自身对齐'))} />
      </Row>
      {grid ? (
        <Row label={localize('Justify self', '自身主轴对齐')}>
          <SelectInput aria-label={localize('Justify self', '自身主轴对齐')} value={selfValue(justifySelf)} placeholder={localize('Mixed', '混合值')} options={SELF_OPTIONS.map((o) => ({ ...o }))} onChange={(v) => commitCss(target, 'justify-self', v === 'auto' ? '' : v, localize('Justify self', '自身主轴对齐'))} />
        </Row>
      ) : (
        <>
          <Row label={localize('Grow', '扩展')} tip={localize("How much of the group's spare room this child takes", '子元素占用组合剩余空间的比例')}>
            <NumberInput aria-label={localize('Grow', '扩展')} value={flex.grow} min={0} max={1000} onCommit={(v) => writeFlex(target, localize('Grow', '扩展'), (f) => ({ ...f, grow: v ?? 0 }))} />
          </Row>
          <Row label={localize('Shrink', '收缩')} tip={localize('How much this child gives up when the group runs out of room', '空间不足时子元素收缩的比例')}>
            <NumberInput aria-label={localize('Shrink', '收缩')} value={flex.shrink} min={0} max={1000} onCommit={(v) => writeFlex(target, localize('Shrink', '收缩'), (f) => ({ ...f, shrink: v ?? 1 }))} />
          </Row>
          <Row label={localize('Basis', '基准尺寸')} tip={localize('The size this child starts from before growing or shrinking', '子元素扩展或收缩前的初始尺寸')}>
            <NumberInput aria-label={localize('Basis', '基准尺寸')} value={basisPx ? Number(basisPx[1]) : null} placeholder={flex.basis === '0%' ? '0' : localize('Auto', '自动')} unit="px" min={0} max={4096} step={8} onCommit={(v) => writeFlex(target, localize('Basis', '基准尺寸'), (f) => ({ ...f, basis: v === null ? 'auto' : `${v}px` }))} />
          </Row>
        </>
      )}
      <Row label={localize('Aspect', '宽高比')}>
        <CssField target={target} property="aspect-ratio" label={localize('Aspect ratio', '宽高比')} placeholder={localize('Auto', '自动')} />
      </Row>
    </Subsection>
  );
}

/* -------------------------------------------------------------------------- */
/* Effects                                                                     */
/* -------------------------------------------------------------------------- */

const FILTER_LABELS: Record<FilterFunction, string> = {
  blur: localize('Blur', '模糊'),
  brightness: localize('Brightness', '亮度'),
  contrast: localize('Contrast', '对比度'),
  saturate: localize('Saturate', '饱和度'),
  grayscale: localize('Grayscale', '灰度'),
  sepia: localize('Sepia', '棕褐色'),
  invert: localize('Invert', '反色'),
  'hue-rotate': localize('Hue', '色相'),
};

/** Amounts with no effect (a field at this value removes the function). */
const FILTER_NEUTRAL: Record<FilterFunction, number> = { blur: 0, brightness: 1, contrast: 1, saturate: 1, grayscale: 0, sepia: 0, invert: 0, 'hue-rotate': 0 };

const FILTER_KEYS = Object.keys(FILTER_FUNCTIONS) as FilterFunction[];

/** A filter amount as the field shows it: px, degrees, or a percentage of a ratio. */
function shownAmount(fn: FilterFunction, n: number): number {
  return FILTER_FUNCTIONS[fn].unit === '' ? Math.round(n * 100) : n;
}

function unitOf(fn: FilterFunction): string {
  const unit = FILTER_FUNCTIONS[fn].unit;
  return unit === '' ? '%' : unit === 'deg' ? '°' : unit;
}

/** "Blur 4px · Brightness 120%", or "None". */
function filterSummary(filters: Filters): string {
  const parts = FILTER_KEYS.filter((fn) => filters[fn] !== undefined).map((fn) => `${FILTER_LABELS[fn]} ${shownAmount(fn, filters[fn]!)}${unitOf(fn)}`);
  return parts.length ? parts.join(' · ') : localize('None', '无');
}

const BLEND_OPTIONS = [
  { value: 'default', label: localize('Default', '默认') },
  { value: 'normal', label: localize('Normal', '正常') },
  { value: 'multiply', label: localize('Multiply', '正片叠底') },
  { value: 'screen', label: localize('Screen', '滤色') },
  { value: 'overlay', label: localize('Overlay', '叠加') },
  { value: 'darken', label: localize('Darken', '变暗') },
  { value: 'lighten', label: localize('Lighten', '变亮') },
] as const;

const FILTER_KINDS = new Set(['box', 'text', 'list', 'textbox', 'image', 'shape']);

/** Filter, background filter, transform and blend mode. */
function EffectRows({ target }: { target: Target }): ReactNode {
  if (target.nodes.length === 0) return null;
  const filterable = target.nodes.every((n) => FILTER_KINDS.has(n.kind) && n.kind !== 'rule');
  // A shape turns only (Size › Rotation); connectors don't transform.
  const transformable = target.nodes.every((n) => n.kind !== 'connector' && n.kind !== 'shape');
  if (!filterable && !transformable) return null;
  const blend = sharedStyle(target, 'mix-blend-mode');
  return (
    <Subsection title={localize('Effects', '效果')}>
      {filterable ? <FilterRow target={target} property="filter" label={localize('Filter', '滤镜')} /> : null}
      {filterable ? <FilterRow target={target} property="backdrop-filter" label={localize('Backdrop', '背景滤镜')} /> : null}
      {transformable ? <TransformRow target={target} /> : null}
      {filterable ? (
        <Row label={localize('Blend', '混合')}>
          <SelectInput aria-label={localize('Blend mode', '混合模式')} value={blend.mixed ? null : (blend.value ?? 'default')} placeholder={localize('Mixed', '混合值')} options={BLEND_OPTIONS.map((o) => ({ ...o }))} onChange={(v) => commitCss(target, 'mix-blend-mode', v === 'default' ? '' : v, localize('Blend mode', '混合模式'))} />
        </Row>
      ) : null}
    </Subsection>
  );
}

/** A filter list as a field; its panel has one amount per function. */
function FilterRow({ target, property, label }: { target: Target; property: 'filter' | 'backdrop-filter'; label: string }): ReactNode {
  const shared = sharedStyle(target, property);
  const parsed = shared.value && !shared.mixed ? parseFilters(shared.value) : null;
  const filters: Filters = parsed?.ok ? parsed.value : {};
  const title = property === 'filter' ? localize('Filter', '滤镜') : localize('Background filter', '背景滤镜');
  const set = (fn: FilterFunction, shown: number | null): void => {
    const next: Filters = { ...filters };
    const amount = shown === null ? null : FILTER_FUNCTIONS[fn].unit === '' ? shown / 100 : shown;
    if (amount === null || amount === FILTER_NEUTRAL[fn]) delete next[fn];
    else next[fn] = amount;
    commitCss(target, property, formatFilters(next), title, `${property}-${fn}`);
  };
  return (
    <Row label={label} onReset={shared.value ? () => commitCss(target, property, '', title) : undefined} resetLabel={localize(`Remove ${title.toLowerCase()}`, `移除${title}`)}>
      <PanelField title={title} text={shared.mixed ? localize('Mixed', '混合值') : filterSummary(filters)}>
        {FILTER_KEYS.map((fn) => {
          const spec = FILTER_FUNCTIONS[fn];
          const ratio = spec.unit === '' ? 100 : 1;
          return (
            <Row key={fn} label={FILTER_LABELS[fn]}>
              <NumberInput
                aria-label={`${title} ${FILTER_LABELS[fn].toLowerCase()}`}
                value={filters[fn] === undefined ? null : shownAmount(fn, filters[fn]!)}
                placeholder={String(shownAmount(fn, FILTER_NEUTRAL[fn]))}
                unit={unitOf(fn)}
                min={spec.min * ratio}
                max={spec.max * ratio}
                step={fn === 'blur' ? 0.5 : 1}
                onCommit={(v) => set(fn, v)}
              />
            </Row>
          );
        })}
      </PanelField>
    </Row>
  );
}

/** "Move 10, 0 · Rotate 15°", or "None". */
function transformSummary(t: Transform): string {
  const parts: string[] = [];
  if (t.translateX !== undefined || t.translateY !== undefined) parts.push(localize(`Move ${t.translateX ?? 0}, ${t.translateY ?? 0}`, `位移 ${t.translateX ?? 0}，${t.translateY ?? 0}`));
  if (t.scale !== undefined) parts.push(localize(`Scale ${Math.round(t.scale * 100)}%`, `缩放 ${Math.round(t.scale * 100)}%`));
  if (t.rotate !== undefined) parts.push(localize(`Rotate ${t.rotate}°`, `旋转 ${t.rotate}°`));
  if (t.skewX !== undefined || t.skewY !== undefined) parts.push(localize(`Skew ${t.skewX ?? 0}°, ${t.skewY ?? 0}°`, `倾斜 ${t.skewX ?? 0}°，${t.skewY ?? 0}°`));
  return parts.length ? parts.join(' · ') : localize('None', '无');
}

/** The transform as a field; its panel moves, scales, rotates and skews. */
function TransformRow({ target }: { target: Target }): ReactNode {
  const shared = sharedStyle(target, 'transform');
  const parsed = shared.value && !shared.mixed ? parseTransform(shared.value) : null;
  const transform: Transform = parsed?.ok ? parsed.value : {};
  const set = (patch: Partial<Transform>): void => {
    const next: Transform = { ...transform, ...patch };
    for (const key of Object.keys(next) as Array<keyof Transform>) {
      const neutral = key === 'scale' ? 1 : 0;
      if (next[key] === undefined || next[key] === neutral) delete next[key];
    }
    commitCss(target, 'transform', formatTransform(next), localize('Transform', '变换'), 'transform');
  };
  const px = (v: number | '-50%' | undefined): number | null => (typeof v === 'number' ? v : null);
  return (
    <Row label={localize('Transform', '变换')} onReset={shared.value ? () => commitCss(target, 'transform', '', localize('Transform', '变换')) : undefined} resetLabel={localize('Remove transform', '移除变换')}>
      <PanelField title={localize('Transform', '变换')} text={shared.mixed ? localize('Mixed', '混合值') : transformSummary(transform)}>
        <Row label={localize('Move', '移动')}>
          <NumberInput aria-label={localize('Move x', '水平位移')} label="X" value={px(transform.translateX)} placeholder={transform.translateX === '-50%' ? '−50%' : '0'} steppers={false} min={-4000} max={4000} onCommit={(v) => set({ translateX: v ?? 0 })} />
          <NumberInput aria-label={localize('Move y', '垂直位移')} label="Y" value={px(transform.translateY)} placeholder={transform.translateY === '-50%' ? '−50%' : '0'} steppers={false} min={-4000} max={4000} onCommit={(v) => set({ translateY: v ?? 0 })} />
        </Row>
        <Row label={localize('Scale', '缩放')}>
          <NumberInput aria-label={localize('Scale', '缩放')} value={transform.scale === undefined ? null : Math.round(transform.scale * 100)} placeholder="100" unit="%" min={50} max={200} onCommit={(v) => set({ scale: (v ?? 100) / 100 })} />
        </Row>
        <Row label={localize('Rotate', '旋转')}>
          <NumberInput aria-label={localize('Rotate', '旋转')} value={transform.rotate ?? null} placeholder="0" unit="°" min={-360} max={360} onCommit={(v) => set({ rotate: v ?? 0 })} />
        </Row>
        <Row label={localize('Skew', '倾斜')}>
          <NumberInput aria-label={localize('Skew x', '水平倾斜')} label="X" value={transform.skewX ?? null} placeholder="0" unit="°" steppers={false} min={-60} max={60} onCommit={(v) => set({ skewX: v ?? 0 })} />
          <NumberInput aria-label={localize('Skew y', '垂直倾斜')} label="Y" value={transform.skewY ?? null} placeholder="0" unit="°" steppers={false} min={-60} max={60} onCommit={(v) => set({ skewY: v ?? 0 })} />
        </Row>
      </PanelField>
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                         */
/* -------------------------------------------------------------------------- */

/** Every declaration of the selection, plus "add property". */
function CssRows({ target }: { target: Target }): ReactNode {
  const [adding, setAdding] = useState<CssProperty | null>(null);
  const declared = useMemo(() => {
    const styles = target.nodes.length ? target.nodes.map((n) => n.style) : [target.slide.style];
    const names = new Set<CssProperty>();
    for (const style of styles) for (const key of Object.keys(style) as CssProperty[]) names.add(key);
    return CSS_PROPERTIES.filter((p) => names.has(p));
  }, [target]);
  const available = CSS_PROPERTIES.filter((p) => !declared.includes(p));

  return (
    <Subsection title="CSS">
      {declared.length === 0 ? <p className="px-4 text-[12px] text-chrome-muted">{localize('No declarations.', '暂无 CSS 声明。')}</p> : null}
      <div className="flex flex-col gap-1 px-4">
        {declared.map((property) => (
          <div key={property} className="flex min-w-0 items-center gap-1">
            <span className="w-28 shrink-0 truncate font-mono text-[11px] text-chrome-muted" title={property}>
              {property}
            </span>
            <CssField target={target} property={property} />
            <IconButton label={localize(`Remove ${property}`, `移除 ${property}`)} icon={<X className="size-3" />} onClick={() => commitCss(target, property, '', localize(`Remove ${property}`, `移除 ${property}`))} />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-1 px-4 pt-2">
        <div className="w-28 shrink-0">
          <SelectInput<CssProperty> aria-label={localize('Property to add', '要添加的属性')} value={adding} placeholder={localize('Add…', '添加…')} options={available.map((p) => ({ value: p, label: p }))} onChange={setAdding} />
        </div>
        {adding ? (
          <CommitInput
            autoFocus
            aria-label={localize(`${adding} value`, `${adding}的属性值`)}
            className="min-w-0 flex-1 font-mono text-xs"
            value=""
            placeholder={localize('value', '值')}
            onCommit={(value) => {
              if (value.trim() && commitCss(target, adding, value, adding)) setAdding(null);
            }}
          />
        ) : (
          <Plus className="size-3.5 text-chrome-muted" />
        )}
      </div>
    </Subsection>
  );
}
