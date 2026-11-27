/**
 * The Design panel's Style section: one row per tweak (chart colors, a white
 * page in light mode, font, corners, text size), then a last line that stays
 * put: "Reset all" (off while nothing is set), or why a draft holds the
 * tweaks. A note that the look cleared some tweaks goes under it.
 */

import type { ReactNode } from 'react';
import { getDesignSystemName, parseDashboardLook } from '@open-artifact/data-core';
import { announce } from '@open-artifact/editor-kit';
import { Button, NumberInput, SelectInput } from '@open-artifact/ui';
import { numberLimitMessage } from '@open-artifact/ui/number-entry';
import { CHART_PALETTES, countStyleTweaks, shownStyleTweaks, withoutStyleTweaks, type StyleTweakChange } from '../page/look.ts';
import { changeStyle, resetStyle, useStyleEditor } from './style.ts';

export const STYLE_PANEL_TITLE = 'Style';
const STYLE_DEFAULT_LABEL = 'Default';
const STYLE_FROM_LOOK_LABEL = 'From this look';
const styleFromSystem = (name: string): string => `From ${name}`;
const STYLE_DRAFT_HELD_TEXT = 'Finish with the draft to change the style.';
const styleCleared = (count: number): string =>
  count === 1
    ? 'The look changed, which cleared a style change. Set it again here if you still want it.'
    : 'The look changed, which cleared the style changes. Set them again here if you still want them.';
const RESET_ALL_LABEL = 'Reset all';

type SelectKey = 'palette' | 'page' | 'font' | 'size';
type Choice = readonly [value: string, label: string];

const PALETTE_OPTIONS: readonly Choice[] = Object.keys(CHART_PALETTES).map((name) => [name, name] as const);
const STANDARD_PALETTE_OPTION: Choice = ['own', 'Standard'];
const PAGE_COLOR_OPTIONS: readonly Choice[] = [['white', 'White (light mode)']];
const FONT_OPTIONS: readonly Choice[] = [
  ['Serif', 'Serif'],
  ['Monospace', 'Monospace'],
];
const TEXT_SIZE_OPTIONS: readonly Choice[] = [
  ['small', 'Smaller'],
  ['large', 'Larger'],
];
const FROM_LOOK = 'look';

/** A label and its control; the control carries the label as its name, and a held row can't be changed. */
function Row({ label, held, children }: { label: string; held: boolean; children: ReactNode }): ReactNode {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)] items-center gap-2">
      <span aria-hidden="true" className="truncate text-[13px] text-chrome-muted">
        {label}
      </span>
      <fieldset disabled={held} className="m-0 min-w-0 border-0 p-0">
        {children}
      </fieldset>
    </div>
  );
}

export interface StylePanelProps {
  /** `dash/look` as stored. */
  stored: unknown;
  /** A draft of mine is out: the style waits for it. */
  draftOwn: boolean;
}

export function StylePanel({ stored, draftOwn }: StylePanelProps): ReactNode {
  const { pending, cleared } = useStyleEditor();
  const tweaks = shownStyleTweaks(stored, pending);
  const look = parseDashboardLook(withoutStyleTweaks(stored));
  const system = getDesignSystemName(stored);
  const lookLabel = look === null ? STYLE_DEFAULT_LABEL : system === null ? STYLE_FROM_LOOK_LABEL : styleFromSystem(system);
  // Saving holds nothing: a change made while it saves stays to be saved next.
  const held = draftOwn;
  const corners = Number.parseFloat(look?.corners ?? '8');
  const selectRow = (key: SelectKey, label: string, options: readonly Choice[]): ReactNode => (
    <Row label={label} held={held}>
      <SelectInput
            aria-label={label}
            value={(tweaks[key] as string | undefined) ?? null}
            placeholder={lookLabel}
            options={[{ value: FROM_LOOK, label: lookLabel }, ...options.map(([value, optionLabel]) => ({ value, label: optionLabel }))]}
            onChange={(value) => changeStyle({ [key]: value === FROM_LOOK ? null : value } as StyleTweakChange)}
        className="w-full"
      />
    </Row>
  );
  return (
    <section className="flex flex-col gap-2" aria-label={STYLE_PANEL_TITLE}>
      <h3 className="text-[13px] font-semibold text-chrome-fg">{STYLE_PANEL_TITLE}</h3>
      {selectRow('palette', 'Chart colors', look === null ? PALETTE_OPTIONS : [...PALETTE_OPTIONS, STANDARD_PALETTE_OPTION])}
      {selectRow('page', 'Page color', PAGE_COLOR_OPTIONS)}
      {selectRow('font', 'Font', FONT_OPTIONS)}
      <Row label="Corners" held={held}>
        <NumberInput
              aria-label="Corners"
              value={tweaks.corners ?? null}
              placeholder={String(corners)}
              min={0}
              max={32}
              step={1}
          onCommit={(value) => changeStyle({ corners: value })}
          onLimit={(limits) => announce(numberLimitMessage(limits, { name: 'Corners' }))}
        />
      </Row>
      {selectRow('size', 'Text size', TEXT_SIZE_OPTIONS)}
      {draftOwn ? (
        <p className="mt-1 text-[12px] text-chrome-muted">{STYLE_DRAFT_HELD_TEXT}</p>
      ) : (
        <Button variant="ghost" size="sm" className="-ms-2 self-start" disabled={countStyleTweaks(tweaks) === 0 && pending === null} onClick={resetStyle}>
          {RESET_ALL_LABEL}
        </Button>
      )}
      {cleared > 0 ? <p className="mt-1 text-[12px] text-chrome-muted">{styleCleared(cleared)}</p> : null}
    </section>
  );
}
