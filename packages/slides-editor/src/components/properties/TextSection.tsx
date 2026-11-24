/**
 * The Text section of the properties panel, in the order of the reference
 * editor: Text style, Font, Weight, Size, Spacing (line height and letter
 * spacing), Color (a color, gradient or picture, with its contrast), then
 * the optional Emphasis, List and Case rows its "+" adds, Align, and Resize
 * (what happens when the text outgrows its box).
 *
 * Inherited values are shown as they render (read off the stage), so an
 * unset field still says what is in effect; a row's reset button clears the
 * element's own value.
 */

import { localize } from '@open-artifact/runtime';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Check, ChevronDown, Plus, Strikethrough, Underline } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  formatBackground,
  isTextual,
  parseBackground,
  setListKind,
  type Background,
  type FitMode,
  type SlideNode,
  type TextNode,
} from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { ChromeMenu, ChromeMenuItem } from '@open-artifact/editor-kit/react';
import { useDeck } from '../../state/deck.ts';
import { updateSelection } from '../../services/commands.ts';
import {
  faceStack,
  firstFamily,
  GENERIC_CHOICES,
  googleFace,
  GOOGLE_FONTS,
  googleFont,
  loadMenuFonts,
  parseVariantKey,
  variantChoices,
  variantKey,
  variantLabel,
  WEB_SAFE_FONTS,
  type FontVariant,
} from '../../lib/fonts.ts';
import { ColorRow, useColorGroups } from './ColorField.tsx';
import { fillKindOf, fillKindOptions, fillPreview, ImageFillEditor, startGradient, type FillKind } from './Fills.tsx';
import { GradientEditor } from './GradientEditor.tsx';
import { LetterSpacingIcon, LineHeightIcon, TypeScaleIcon } from './icons.tsx';
import { FIELD, IconButton, NumberInput, Row, Section, Segmented, SelectInput, TextInput, type Option } from './kit.tsx';
import { useResolvedText, type ResolvedText } from './resolve.ts';
import { canCarryFace, commitCss, commitFontFamily, contrastFor, FACE_LIMIT_REASON, patchTarget, pxOf, sharedStyle, useTextStyleMenu, type Target } from './shared.tsx';

const ALIGNS = [
  ['left', localize('Left', '左'), AlignLeft],
  ['center', localize('Center', '居中'), AlignCenter],
  ['right', localize('Right', '右'), AlignRight],
  ['justify', localize('Justify', '两端对齐'), AlignJustify],
] as const;

const CASES: Option<string>[] = [
  { value: 'none', label: localize('None', '无') },
  { value: 'uppercase', label: localize('Uppercase', '大写') },
  { value: 'lowercase', label: localize('Lowercase', '小写') },
  { value: 'capitalize', label: localize('Capitalize', '首字母大写') },
];

const FITS: Option<FitMode>[] = [
  { value: 'shrink', label: localize('Shrink text to fit', '缩小文字以适应文本框') },
  { value: 'none', label: localize('Don’t resize text', '保持文字大小') },
  { value: 'grow', label: localize('Grow box to fit text', '扩大文本框以容纳文字') },
];

const RESIZE_TIP = localize('What happens when the text outgrows its box: shrink the text, leave it as it is, or grow the box.', '设置文字超出文本框时的处理方式：缩小文字、保持原样或扩大文本框。');

/** Rows the "+" adds. */
type Extra = 'emphasis' | 'list' | 'case';

/** True when the node has text this section styles. */
function hasText(node: SlideNode): boolean {
  return isTextual(node) || node.kind === 'table';
}

/** Normalizes a weight value to a number. */
function weightOf(value: string | undefined): number | null {
  if (!value) return null;
  if (value === 'bold') return 700;
  if (value === 'normal') return 400;
  return /^\d{3}$/.test(value) ? Number(value) : null;
}

/** Text styling of the selected text elements. */
export function TextSection({ target }: { target: Target }): ReactNode {
  const isSlide = target.nodes.length === 0;
  const allText = !isSlide && target.nodes.every((n) => n.kind === 'text');
  const styleMenu = useTextStyleMenu(allText ? (target.nodes as TextNode[]) : null);
  const resolved = useResolvedText(isSlide ? [] : target.paths);
  const selectionKey = target.paths.map((p) => p.join('.')).join('|');
  const [extras, setExtras] = useState<ReadonlySet<Extra>>(new Set());
  useEffect(() => setExtras(new Set()), [selectionKey]);
  if (!isSlide && !target.nodes.every(hasText)) return null;

  const size = sharedStyle(target, 'font-size');
  const lineHeight = sharedStyle(target, 'line-height');
  const spacing = sharedStyle(target, 'letter-spacing');
  const transform = sharedStyle(target, 'text-transform');
  const decoration = sharedStyle(target, 'text-decoration');
  const align = sharedStyle(target, 'text-align');
  const line = decoration.mixed ? null : /line-through/.test(decoration.value ?? '') ? 'line-through' : /underline/.test(decoration.value ?? '') ? 'underline' : null;
  const canList = !isSlide && target.nodes.every((n) => n.kind === 'text' || n.kind === 'list');
  const listKind = canList ? (target.nodes.every((n) => n.kind === 'list' && n.tag === 'ul') ? 'ul' : target.nodes.every((n) => n.kind === 'list' && n.tag === 'ol') ? 'ol' : target.nodes.every((n) => n.kind === 'text') ? 'none' : null) : null;
  const canFit = !isSlide;
  const fits = target.nodes.map((n) => n.fit ?? 'shrink');
  const fit = fits.every((f) => f === fits[0]) ? (fits[0] ?? 'shrink') : null;

  const showEmphasis = !isSlide && (extras.has('emphasis') || decoration.mixed || line !== null);
  const showList = canList && (extras.has('list') || target.nodes.some((n) => n.kind === 'list'));
  const showCase = extras.has('case') || transform.mixed || Boolean(transform.value && transform.value !== 'none');
  const add = (extra: Extra): void => setExtras(new Set([...extras, extra]));

  const n = target.nodes.length;
  const title = n > 1 ? localize(`${n} Text`, `${n} 个文本元素`) : localize('Text', '文本');
  const menu = (
    <ChromeMenu
      align="end"
      tip={{ label: localize('Add to Text', '添加文本设置') }}
      trigger={
        <button type="button" aria-label={localize('Add to Text', '添加文本设置')} className="flex size-6 items-center justify-center rounded-[6px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:ring-2 focus-visible:ring-chrome-accent">
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
      }
    >
      {!isSlide ? (
        <ChromeMenuItem disabled={showEmphasis} onSelect={() => add('emphasis')}>
          {localize('Emphasis', '强调')}
        </ChromeMenuItem>
      ) : null}
      {canList ? (
        <ChromeMenuItem disabled={showList} onSelect={() => add('list')}>
          {localize('List', '列表')}
        </ChromeMenuItem>
      ) : null}
      <ChromeMenuItem disabled={showCase} onSelect={() => add('case')}>
        {localize('Case', '大小写')}
      </ChromeMenuItem>
    </ChromeMenu>
  );

  const spacingSet = Boolean(lineHeight.value || spacing.value);
  const letterValue = spacing.mixed || !spacing.value ? null : spacing.value.endsWith('em') ? Math.round(Number.parseFloat(spacing.value) * (resolved?.size ?? 16) * 10) / 10 : pxOf(spacing.value);

  return (
    <Section title={title} actions={menu}>
      {allText ? (
        <Row label={localize('Text style', '文本样式')}>
          <SelectInput
            aria-label={localize('Text style', '文本样式')}
            icon={<TypeScaleIcon />}
            value={styleMenu.value}
            placeholder={styleMenu.mixed ? localize('Mixed', '混合值') : localize('Custom', '自定义')}
            options={styleMenu.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint, group: o.group, style: o.style }))}
            valueStyle={{}}
            onChange={styleMenu.apply}
          />
        </Row>
      ) : null}
      <FontRow target={target} resolved={resolved} isSlide={isSlide} />
      <WeightRow target={target} resolved={resolved} />
      <Row label={localize('Size', '大小')} onReset={size.value && !size.mixed ? () => commitCss(target, 'font-size', '', localize('Font size', '字号')) : undefined}>
        <NumberInput
          aria-label={localize('Font size', '字号')}
          value={size.mixed ? null : pxOf(size.value)}
          unit="px"
          min={8}
          max={400}
          placeholder={size.mixed ? localize('Mixed', '混合值') : resolved ? String(resolved.size) : localize('Auto', '自动')}
          inherited={!size.mixed}
          onCommit={(v) => commitCss(target, 'font-size', v === null ? '' : `${v}px`, localize('Font size', '字号'))}
        />
      </Row>
      <Row
        label={localize('Spacing', '间距')}
        tip={localize('Line height · Letter spacing', '行高 · 字间距')}
        resetLabel={localize('Reset Spacing', '重置间距')}
        onReset={spacingSet ? () => patchTarget(target, localize('Spacing', '间距'), { 'line-height': undefined, 'letter-spacing': undefined }) : undefined}
      >
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          <NumberInput
            aria-label={localize('Line height', '行高')}
            title={localize('Line height', '行高')}
            label={<LineHeightIcon />}
            value={lineHeight.mixed || !lineHeight.value ? null : Number.parseFloat(lineHeight.value)}
            step={0.05}
            min={0.5}
            max={4}
            steppers={false}
            placeholder={lineHeight.mixed ? localize('Mixed', '混合值') : resolved?.lineHeight != null ? String(resolved.lineHeight) : localize('Auto', '自动')}
            inherited={!lineHeight.mixed}
            onCommit={(v) => commitCss(target, 'line-height', v === null ? '' : String(v), localize('Line height', '行高'))}
          />
          <NumberInput
            aria-label={localize('Letter spacing', '字间距')}
            title={localize('Letter spacing (px)', '字间距（像素）')}
            label={<LetterSpacingIcon />}
            value={letterValue}
            step={0.5}
            min={-24}
            max={32}
            steppers={false}
            placeholder={spacing.mixed ? localize('Mixed', '混合值') : String(resolved?.letterSpacing ?? 0)}
            inherited={!spacing.mixed}
            onCommit={(v) => commitCss(target, 'letter-spacing', v === null || v === 0 ? '' : `${v}px`, localize('Letter spacing', '字间距'))}
          />
        </div>
      </Row>
      <TextColorRow target={target} resolved={resolved} />
      {showEmphasis ? (
        <Row label={localize('Emphasis', '强调')} onReset={line ? () => commitCss(target, 'text-decoration', '', localize('Emphasis', '强调')) : undefined}>
          <IconButton label={localize('Underline', '下划线')} icon={<Underline />} active={line === 'underline'} onClick={() => commitCss(target, 'text-decoration', line === 'underline' ? '' : 'underline', localize('Underline', '下划线'))} />
          <IconButton label={localize('Strikethrough', '删除线')} icon={<Strikethrough />} active={line === 'line-through'} onClick={() => commitCss(target, 'text-decoration', line === 'line-through' ? '' : 'line-through', localize('Strikethrough', '删除线'))} />
        </Row>
      ) : null}
      {showList ? (
        <Row label={localize('List', '列表')}>
          <Segmented<'none' | 'ul' | 'ol'>
            aria-label={localize('List', '列表')}
            value={listKind}
            options={[
              { value: 'none', label: localize('None', '无') },
              { value: 'ul', label: localize('Bulleted', '项目符号') },
              { value: 'ol', label: localize('Numbered', '编号') },
            ]}
            onChange={(kind) => updateSelection(localize('List', '列表'), (node) => (node.kind === 'text' || node.kind === 'list' ? setListKind(node, kind === 'none' ? null : kind) : node))}
          />
        </Row>
      ) : null}
      <Row label={localize('Align', '对齐')} onReset={align.value && !align.mixed ? () => commitCss(target, 'text-align', '', localize('Align', '对齐')) : undefined}>
        <Segmented
          aria-label={localize('Text alignment', '文本对齐')}
          value={align.mixed ? null : (align.value ?? resolved?.align ?? 'left')}
          options={ALIGNS.map(([value, title, Icon]) => ({ value, title, label: <Icon className="size-4" strokeWidth={1.5} /> }))}
          onChange={(value) => commitCss(target, 'text-align', value, localize('Align', '对齐'))}
        />
      </Row>
      {showCase ? (
        <Row label={localize('Case', '大小写')} onReset={transform.value && !transform.mixed ? () => commitCss(target, 'text-transform', '', localize('Text case', '字母大小写')) : undefined}>
          <SelectInput
            aria-label={localize('Text case', '字母大小写')}
            value={transform.mixed ? null : (transform.value ?? 'none')}
            placeholder={localize('Mixed', '混合值')}
            options={CASES}
            onChange={(value) => commitCss(target, 'text-transform', value === 'none' ? '' : value, localize('Text case', '字母大小写'))}
          />
        </Row>
      ) : null}
      {canFit ? (
        <Row label={localize('Resize', '调整大小')} tip={RESIZE_TIP}>
          <SelectInput<FitMode>
            aria-label={localize('Resize', '调整大小')}
            title={RESIZE_TIP}
            value={fit}
            placeholder={localize('Mixed', '混合值')}
            options={FITS}
            onChange={(mode) =>
              updateSelection(localize('Resize', '调整大小'), (node) => {
                const { fit: _old, ...rest } = node;
                return (mode === 'shrink' ? rest : { ...rest, fit: mode }) as SlideNode;
              })
            }
          />
        </Row>
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Font                                                                        */
/* -------------------------------------------------------------------------- */

/** One entry of the font menu. */
interface FontChoice {
  key: string;
  label: string;
  /** What `font-family` becomes ('' clears it). */
  css: string;
  /** The web font the deck must carry for it. */
  google?: boolean;
  /** The label's own font. */
  preview?: string;
  disabled?: boolean;
}

/** The menu key of a stored `font-family`. */
function choiceKey(value: string | undefined): string {
  if (!value) return '';
  const first = firstFamily(value);
  if (!first) return '';
  const lower = first.toLowerCase();
  const generic = GENERIC_CHOICES.find((c) => c.key === lower);
  return generic ? generic.key : `face:${lower}`;
}

/** The Font row: a searchable menu of the deck's faces, the generic families and the catalog. */
function FontRow({ target, resolved, isSlide }: { target: Target; resolved: ResolvedText | null; isSlide: boolean }): ReactNode {
  const deckFaces = useDeck((s) => s.index.faces);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shared = sharedStyle(target, 'font-family');
  const current = shared.mixed ? null : choiceKey(shared.value);
  const room = useMemo(() => canCarryFace(), [deckFaces, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = useMemo((): FontChoice[] => {
    const carried = Object.values(deckFaces).map((f) => f.family);
    const carriedLower = new Set(carried.map((f) => f.toLowerCase()));
    const out: FontChoice[] = [{ key: '', label: isSlide ? localize('System font', '系统字体') : localize('Style default', '样式默认字体'), css: '' }];
    for (const family of carried) out.push({ key: `face:${family.toLowerCase()}`, label: family, css: faceStack(family), preview: faceStack(family) });
    const own = shared.mixed ? null : firstFamily(shared.value);
    const known = (name: string): boolean =>
      carriedLower.has(name.toLowerCase()) || GENERIC_CHOICES.some((c) => c.key === name.toLowerCase()) || Boolean(googleFont(name)) || WEB_SAFE_FONTS.some((f) => f.family.toLowerCase() === name.toLowerCase());
    if (own && !known(own)) out.push({ key: `face:${own.toLowerCase()}`, label: own, css: shared.value!, preview: shared.value });
    for (const generic of GENERIC_CHOICES) out.push({ key: generic.key, label: generic.label, css: generic.css, preview: generic.css });
    const catalog = [...WEB_SAFE_FONTS.map((f) => ({ family: f.family, google: false })), ...GOOGLE_FONTS.map((f) => ({ family: f.family, google: true }))]
      .filter((f) => !carriedLower.has(f.family.toLowerCase()))
      .sort((a, b) => a.family.localeCompare(b.family));
    for (const font of catalog) {
      out.push({ key: `face:${font.family.toLowerCase()}`, label: font.family, css: faceStack(font.family), preview: faceStack(font.family), google: font.google, disabled: font.google && !room });
    }
    return out;
  }, [deckFaces, shared.value, shared.mixed, isSlide, room]);

  const q = query.trim().toLowerCase();
  const shown = q ? choices.filter((c) => c.label.toLowerCase().includes(q)) : choices;
  const selected = choices.find((c) => c.key === current);
  const rendered = resolved?.family && !/^(?:system-ui|-apple-system|blinkmacsystemfont)$/i.test(resolved.family) ? resolved.family : localize('System font', '系统字体');
  const label = shared.mixed ? localize('Mixed', '混合值') : current ? (selected?.label ?? firstFamily(shared.value) ?? '') : resolved ? rendered : isSlide ? localize('System font', '系统字体') : localize('Style default', '样式默认字体');

  const choose = (choice: FontChoice): void => {
    setOpen(false);
    setQuery('');
    if (choice.google) {
      const font = googleFont(choice.label)!;
      commitFontFamily(target, choice.css, googleFace(font));
    } else commitFontFamily(target, choice.css, null);
  };

  return (
    <Row label={localize('Font', '字体')} onReset={shared.value && !shared.mixed ? () => commitCss(target, 'font-family', '', localize('Font', '字体')) : undefined}>
      <BasePopover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) loadMenuFonts();
          else setQuery('');
        }}
      >
        <BasePopover.Trigger aria-label={localize(`Font: ${label}`, `字体：${label}`)} className={cn(FIELD, 'flex w-full min-w-0 cursor-default items-center gap-1.5 pl-2 pr-[5px] text-left data-[popup-open]:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)]')}>
          <span className={cn('min-w-0 flex-1 truncate', shared.mixed ? 'text-chrome-muted' : !current && 'text-chrome-secondary')}>{label}</span>
          <ChevronDown className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
        </BasePopover.Trigger>
        <BasePopover.Portal>
          <BasePopover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-[1000]">
            <BasePopover.Popup className="flex w-64 flex-col overflow-hidden rounded-[14px] bg-chrome text-chrome-fg shadow-chrome-popup outline-none">
              <div className="p-2 pb-1">
                <TextInput autoFocus aria-label={localize('Search fonts', '搜索字体')} placeholder={localize('Search fonts', '搜索字体')} value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <div role="listbox" aria-label={localize('Fonts', '字体')} className="max-h-80 overflow-y-auto p-1.5 pt-1">
                {shown.map((choice) => (
                  <button
                    key={choice.key || 'default'}
                    type="button"
                    role="option"
                    aria-selected={choice.key === current}
                    disabled={choice.disabled}
                    title={choice.disabled ? FACE_LIMIT_REASON : undefined}
                    onClick={() => choose(choice)}
                    className="flex h-7 w-full cursor-default items-center gap-2 rounded-[8px] pl-2 pr-2.5 text-left text-[13px] outline-none hover:bg-chrome-hover focus-visible:bg-chrome-hover disabled:opacity-40"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">{choice.key === current ? <Check className="size-4 text-chrome-accent" strokeWidth={2.25} /> : null}</span>
                    <span className="min-w-0 flex-1 truncate" style={choice.preview ? { fontFamily: choice.preview } : undefined}>
                      {choice.label}
                    </span>
                  </button>
                ))}
                {shown.length === 0 ? <p className="px-2 py-2 text-[12px] text-chrome-muted">{localize('No matches', '没有匹配项')}</p> : null}
              </div>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </Row>
  );
}

/** The Weight row: the family's weights and italics. */
function WeightRow({ target, resolved }: { target: Target; resolved: ResolvedText | null }): ReactNode {
  const family = sharedStyle(target, 'font-family');
  const weight = sharedStyle(target, 'font-weight');
  const style = sharedStyle(target, 'font-style');
  const mixed = weight.mixed || style.mixed;
  const set = weight.value !== undefined || style.value !== undefined;
  const effective: FontVariant | null = resolved ? { weight: resolved.weight, italic: resolved.italic } : null;
  const own: FontVariant | null = set ? { weight: weightOf(weight.value) ?? effective?.weight ?? 400, italic: style.value === 'italic' } : null;
  const familyName = (family.mixed ? null : firstFamily(family.value)) ?? resolved?.family ?? null;
  const options = variantChoices(familyName, own ?? effective).map((v) => ({ value: variantKey(v), label: variantLabel(v) }));
  return (
    <Row label={localize('Weight', '字重')} onReset={set && !mixed ? () => patchTarget(target, localize('Font weight', '字重'), { 'font-weight': undefined, 'font-style': undefined }) : undefined}>
      <SelectInput
        aria-label={localize('Weight', '字重')}
        value={mixed || !own ? null : variantKey(own)}
        placeholder={mixed ? localize('Mixed', '混合值') : effective ? variantLabel(effective) : localize('Regular', '常规')}
        inherited={!mixed}
        options={options}
        onChange={(key) => {
          const v = parseVariantKey(key);
          if (v) patchTarget(target, localize('Font weight', '字重'), { 'font-weight': String(v.weight), 'font-style': v.italic ? 'italic' : undefined });
        }}
      />
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/* Color                                                                       */
/* -------------------------------------------------------------------------- */

/** Clipping that paints the background through the glyphs. */
const CLIP_ON = { 'background-clip': 'text', '-webkit-text-fill-color': 'transparent' } as const;
const CLIP_OFF = { background: undefined, 'background-clip': undefined, '-webkit-text-fill-color': undefined } as const;

const CHECKER = 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px';

/** The text Color row: a color (with contrast), or a gradient or picture painted through the letters. */
function TextColorRow({ target, resolved }: { target: Target; resolved: ResolvedText | null }): ReactNode {
  const groups = useColorGroups();
  const color = sharedStyle(target, 'color');
  const bg = sharedStyle(target, 'background');
  const clip = sharedStyle(target, 'background-clip');
  const canFill = target.nodes.length > 0 && target.nodes.every((n) => isTextual(n));
  const clipped = !clip.mixed && clip.value === 'text';
  const parsed = clipped && !bg.mixed && bg.value ? parseBackground(bg.value) : null;
  const background: Background | null = parsed?.ok ? parsed.value : null;
  const stored: FillKind = clipped ? fillKindOf(background) : 'color';
  const [pending, setPending] = useState<FillKind | null>(null);
  const kind = pending ?? stored;
  useEffect(() => setPending(null), [stored]);

  const setFill = (next: Background, label: string, coalesce?: string): void => {
    patchTarget(target, label, { background: formatBackground(next), ...CLIP_ON }, coalesce);
  };
  const setKind = (next: FillKind): void => {
    if (next === 'color') {
      setPending(null);
      if (clipped) patchTarget(target, localize('Text fill', '文字填充'), CLIP_OFF);
    } else if (next === 'gradient') {
      setPending(null);
      setFill({ gradient: background?.gradient ?? startGradient(color.value ?? resolved?.color) }, localize('Gradient text', '渐变文字'));
    } else setPending('image');
  };
  const content =
    kind === 'gradient' && background?.gradient ? (
      <GradientEditor gradient={background.gradient} onChange={(gradient) => setFill({ gradient }, localize('Text gradient', '文字渐变'), 'text-gradient')} />
    ) : kind === 'image' ? (
      <ImageFillEditor image={background?.image ?? null} onImage={(image) => setFill({ image }, localize('Picture text', '图片填充文字'))} />
    ) : null;
  const preview = kind === 'color' ? null : (fillPreview(background) ?? { swatch: CHECKER, label: kind === 'image' ? localize('Image', '图片') : localize('Linear', '线性') });
  const value = color.mixed ? null : (color.value ?? null);
  const contrast =
    kind === 'color' && !color.mixed
      ? contrastFor(target, { kind: 'text', color: value ?? resolved?.color ?? null, ...(resolved ? { size: resolved.size, weight: resolved.weight } : {}) })
      : null;

  return (
    <ColorRow
      label={localize('Color', '颜色')}
      aria-label={localize('Text color', '文字颜色')}
      value={value}
      mixed={color.mixed}
      effective={resolved?.color ?? null}
      emptyLabel={localize('Theme default', '主题默认')}
      groups={groups}
      preview={preview}
      contrast={contrast}
      onReset={value ? () => commitCss(target, 'color', '', localize('Text color', '文字颜色')) : undefined}
      onCommit={(next) => {
        setPending(null);
        patchTarget(target, localize('Text color', '文字颜色'), { color: next ?? undefined, ...(clipped ? CLIP_OFF : {}) }, 'text-color');
      }}
      {...(canFill ? { kinds: { value: kind, options: fillKindOptions(['color', 'gradient', 'image']), onChange: (v: string) => setKind(v as FillKind), content } } : {})}
    />
  );
}
