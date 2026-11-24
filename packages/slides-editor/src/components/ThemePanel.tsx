/**
 * The Theme tab of the properties panel: restyle the whole deck from an
 * installed design system's look.
 *
 * - Looks: "Original look" (the deck as it was before any restyle), then
 *   every theme of every installed system (up to eight each) as a tile with
 *   its ground, ink and accent. Picking one rewrites every slide's colours
 *   and its heading and body faces as one undo step; the arrow keys move
 *   between looks and apply them as they go.
 * - Recent: the deck remembers its last two looks, to switch straight back.
 * - Slides still wearing an earlier look (added in the old palette) are
 *   pointed out, with "Apply to all slides".
 * - Fonts: the heading and body typefaces across the deck.
 * - Palette: the colour roles the deck's colours were read as.
 */

import { localize } from '@open-artifact/runtime';
import { useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Bot, Check, Paintbrush } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { deckOrder, useDeck } from '../state/deck.ts';
import { sendToAgent, useAgent } from '../services/agent.ts';
import { useDesignSystems } from '../services/design-systems.ts';
import { MAX_RESTYLE_COLORS } from '../services/theme/analysis.ts';
import { ORIGINAL_LOOK, readThemeMemory } from '../services/theme/restyle.ts';
import { ROLE_LABELS } from '../services/theme/system.ts';
import { applyCurrentLookToAll, applyLook, familyChoices, lookOptions, lookTitle, readThemeState, setDeckFamily, type LookOption } from '../services/theme/theme.ts';
import { Button, Note, Row, Section, SelectInput } from './properties/kit.tsx';

/** A strip of colour chips. */
function Swatches({ colors, className }: { colors: readonly string[]; className?: string }): ReactNode {
  return (
    <span className={cn('flex shrink-0 overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]', className)} aria-hidden>
      {colors.map((color, i) => (
        <span key={i} className="h-full w-3" style={{ background: color }} />
      ))}
    </span>
  );
}

/** One look tile: a small slide in the look's ground, ink and accent, and its name. */
function LookTile({ option, current, onPick, tabStop }: { option: LookOption; current: boolean; onPick: () => void; tabStop: boolean }): ReactNode {
  const [ground, ink, accent] = option.swatches;
  const fonts = [option.heading, option.body].filter((f, i, all): f is string => Boolean(f) && all.indexOf(f) === i).join(' · ');
  return (
    <button
      type="button"
      role="option"
      aria-selected={current}
      data-look={option.id}
      tabIndex={tabStop ? 0 : -1}
      onClick={onPick}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-[8px] p-1.5 text-left outline-none hover:bg-chrome-hover focus-visible:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)]',
        current && 'bg-chrome-hover',
      )}
    >
      <span className="relative flex h-9 w-16 shrink-0 flex-col justify-center gap-1 overflow-hidden rounded-[4px] px-1.5 shadow-[0_0_0_1px_var(--chrome-line)]" style={{ background: ground }} aria-hidden>
        <span className="h-1.5 w-8 rounded-full" style={{ background: ink }} />
        <span className="h-1 w-10 rounded-full opacity-60" style={{ background: ink }} />
        <span className="absolute bottom-1 right-1.5 size-2.5 rounded-full" style={{ background: accent }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-chrome-fg">{option.title}</span>
        {option.subtitle || fonts ? <span className="truncate text-[11px] text-chrome-muted">{[option.subtitle, fonts].filter(Boolean).join(' — ')}</span> : null}
      </span>
      {current ? <Check className="size-4 shrink-0 text-chrome-accent" strokeWidth={2} /> : null}
    </button>
  );
}

const DEFAULT_FACE = '\u0000default';

/** The Theme tab. */
export function ThemePanel(): ReactNode {
  const slides = useDeck((s) => s.slides);
  const index = useDeck((s) => s.index);
  const readOnly = useDeck((s) => s.readOnly);
  const systems = useDesignSystems((s) => s.systems);
  const agent = useAgent((s) => s.status);
  const list = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () =>
      deckOrder({ index, slides })
        .map((id) => ({ id, entry: slides[id] }))
        .filter((x): x is { id: string; entry: NonNullable<typeof x.entry> } => Boolean(x.entry && !x.entry.held))
        .map(({ id, entry }) => ({ id, slide: entry.slide })),
    [index, slides],
  );
  const memoryRaw = useMemo(() => readThemeMemory(index), [index]);
  const state = useMemo(() => readThemeState(entries, memoryRaw, systems), [entries, memoryRaw, systems]);
  const { analysis, memory, current, strays } = state;

  const original: LookOption = useMemo(() => {
    const colors = memory?.original.colors ?? Object.fromEntries(analysis.slots.map((s) => [s.id, s.value]));
    const pick = (...ids: string[]): string => ids.map((id) => colors[id]).find(Boolean) ?? '#ffffff';
    return {
      id: ORIGINAL_LOOK,
      title: localize('Original look', '原始外观'),
      subtitle: localize('How the deck looked before', '演示文稿原先的外观'),
      swatches: [pick('background', 'surface'), pick('text', 'muted', 'on-inverse'), pick('accent', 'text'), pick('surface', 'background'), pick('muted', 'text')],
    };
  }, [memory, analysis]);
  const options = useMemo(() => lookOptions(systems, original), [systems, original]);
  const titleOf = (id: string): string => {
    const found = options.find((o) => o.id === id);
    return found ? lookTitle(found) : (memory?.recent.find((r) => r.look === id)?.title ?? localize('an earlier look', '之前的外观'));
  };

  const pick = (id: string): void => {
    if (readOnly) return;
    if (id === current) return;
    if (id === ORIGINAL_LOOK && !memory) return;
    applyLook(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', localize('End', '终点')].includes(event.key)) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-look]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, (at < 0 ? 0 : at) + (event.key === 'ArrowDown' ? 1 : -1)));
    const button = buttons[next];
    if (!button) return;
    event.preventDefault();
    button.focus();
    // Moving between looks applies them as it goes (each one undo step).
    pick(button.dataset.look ?? '');
  };

  const choices = useMemo(() => familyChoices(index.faces, systems), [index.faces, systems]);
  const fontOptions = useMemo(
    () => [
      { value: DEFAULT_FACE, label: localize('Default (system font)', '默认（系统字体）'), group: localize('Default', '默认') },
      ...choices.map((c) => ({ value: c.family.toLowerCase(), label: c.family, group: c.group, style: { fontFamily: `"${c.family}"` } })),
    ],
    [choices],
  );
  const fontValue = (key: string): string => (key === '' ? DEFAULT_FACE : key);
  const withCurrent = (key: string): typeof fontOptions =>
    key && !fontOptions.some((o) => o.value === key) ? [{ value: key, label: key, group: localize('In this deck', '演示文稿内置'), style: { fontFamily: `"${key}"` } }, ...fontOptions] : fontOptions;
  const familyOf = (value: string): string => (value === DEFAULT_FACE ? '' : (choices.find((c) => c.family.toLowerCase() === value)?.family ?? value));

  const recent = memory?.recent.slice(1).filter((r) => r.look !== current) ?? [];
  const disabled = readOnly;

  return (
    <div className="flex min-w-0 flex-col">
      <Section title={localize('Look', '外观')}>
        {systems.length === 0 ? (
          <>
            <Note>{localize('Install a design system in this deck to restyle every slide from its colors and fonts.', '为此演示文稿安装设计系统，即可将其中的颜色和字体应用到全部幻灯片。')}</Note>
            {agent.available && !readOnly ? (
              <div className="px-4 py-1">
                <Button
                  variant="secondary"
                  icon={<Bot />}
                  onClick={() => void sendToAgent('Install a design system in this deck (copy it under project/ds/ and list it in deck.json designSystems) so I can restyle the slides from the Theme panel.')}
                >
                  {localize(`Ask ${agent.name} to add one`, `请 ${agent.name} 添加设计系统`)}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {!memory && analysis.over ? (
          <Note>
            {localize(`This deck uses ${analysis.distinct} colors (at most ${MAX_RESTYLE_COLORS} can be restyled automatically). Ask ${agent.name} to redo its look instead.`, `此演示文稿使用了 ${analysis.distinct} 种颜色，超出自动调整的 ${MAX_RESTYLE_COLORS} 色上限。可请 ${agent.name} 重新设计其外观。`)}
          </Note>
        ) : null}
        <div ref={list} role="listbox" aria-label={localize('Looks', '外观方案')} aria-disabled={disabled || undefined} onKeyDown={onKeyDown} className={cn('flex flex-col gap-0.5 px-2.5', disabled && 'pointer-events-none opacity-50')}>
          {options
            .filter((o) => o.id !== ORIGINAL_LOOK || memory)
            .map((option) => (
              <LookTile key={option.id || 'original'} option={option} current={option.id === current} tabStop={option.id === current || (!memory && option === options[1])} onPick={() => pick(option.id)} />
            ))}
          {!memory && systems.length > 0 ? <Note className="px-1.5">{localize('The deck wears its own look. Pick one to restyle every slide; Original look brings it back.', '选择一个外观方案可调整所有幻灯片。选择「原始外观」可恢复原样。')}</Note> : null}
        </div>
        {recent.length ? (
          <Row label={localize('Recent', '最近使用')}>
            {recent.map((r) => (
              <Button key={r.look || 'original'} variant="ghost" className="min-w-0 truncate px-1.5" disabled={disabled} onClick={() => pick(r.look)} title={localize(`Switch back to ${titleOf(r.look)}`, `切换回「${titleOf(r.look)}」`)}>
                <Swatches className="h-3" colors={[r.colors.background, r.colors.text, r.colors.accent].filter((c): c is string => Boolean(c))} />
                <span className="truncate">{titleOf(r.look)}</span>
              </Button>
            ))}
          </Row>
        ) : null}
        {strays.length && memory?.recent[0] ? (
          <div className="mx-4 mt-1 flex flex-col gap-1.5 rounded-[8px] bg-chrome-field p-2.5">
            <span className="text-[12px] leading-[1.45] text-chrome-fg">
              {localize(`${strays.length === 1 ? '1 slide still uses' : `${strays.length} slides still use`} colors from an earlier look. Make ${strays.length === 1 ? 'it' : 'them'} ${titleOf(current)} too?`, `还有 ${strays.length} 张幻灯片使用旧配色。也将它们切换到「${titleOf(current)}」吗？`)}
            </span>
            <Button variant="secondary" icon={<Paintbrush />} disabled={disabled} onClick={applyCurrentLookToAll} className="self-start">
              {localize('Apply to all slides', '应用到所有幻灯片')}
            </Button>
          </div>
        ) : null}
      </Section>
      <Section title={localize('Fonts', '字体')}>
        <Row label={localize('Headings', '标题')} tip={localize('The typeface of every heading in the deck', '应用于演示文稿中的所有标题')}>
          <SelectInput<string>
            aria-label={localize('Heading font', '标题字体')}
            value={fontValue(analysis.heading)}
            options={withCurrent(analysis.heading)}
            disabled={disabled}
            onChange={(value) => setDeckFamily('heading', familyOf(value))}
          />
        </Row>
        <Row label={localize('Body', '正文')} tip={localize('The typeface of body text across the deck', '应用于演示文稿中的正文')}>
          <SelectInput<string>
            aria-label={localize('Body font', '正文字体')}
            value={fontValue(analysis.body)}
            options={withCurrent(analysis.body)}
            disabled={disabled}
            onChange={(value) => setDeckFamily('body', familyOf(value))}
          />
        </Row>
        <Note>{localize('A presentation carries up to four typefaces; changing a font is one undo step.', '一份演示文稿最多可内置四种字体。更改字体可一步撤销。')}</Note>
      </Section>
      {analysis.slots.length ? (
        <Section title={localize('Palette', '配色')} collapsible>
          <div className="flex flex-col gap-0.5 px-4">
            {analysis.slots.slice(0, 24).map((slot) => (
              <div key={slot.id} className="flex min-h-6 items-center gap-2 text-[12px]">
                <span className="size-4 shrink-0 rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]" style={{ background: slot.value }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-chrome-fg">
                  {ROLE_LABELS[slot.role]}
                  {/-\d+$/.test(slot.id) ? ` ${slot.id.split('-').at(-1)}` : ''}
                </span>
                <span className="font-mono text-[11px] text-chrome-muted">{slot.value}</span>
              </div>
            ))}
          </div>
          <Note>{localize('How the deck’s colors were read. A look maps each role to the design system’s matching color.', '这里按用途列出演示文稿的颜色。应用外观方案时，每种用途会匹配设计系统中的对应颜色。')}</Note>
        </Section>
      ) : null}
    </div>
  );
}
