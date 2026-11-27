/**
 * Form controls used by inspectors: text, number (with scrubbing), select,
 * switch, slider, segmented control and color.
 */
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef, useEffect, useMemo, useRef, useState, type FocusEvent, type InputHTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { isComposingKey, preventRepeatedActivation, shortcutLetter } from './keys.ts';
import { POPUP_CLASS } from './menu.tsx';
import { announceFromField, prepareFieldAnnounce } from './field-announce.ts';
import { holdNumberTextOnWheel } from './number-wheel.ts';
import { useEscapeHandoffRef } from './escape-to-popup.ts';
import { isMinusSign, limitsKept, numberLimitMessage, refusesMinus, settleTypedText, startsWithMinus, stepTypedText, type NumberLimit } from './number-entry.ts';
import { createSelectAnnouncer } from './select-announce.ts';
import { DRAG_ENDS, endsDrag, largeStepOf, sliderValueText } from './slider-session.ts';

/**
 * Shared look of single-line inputs. Every field's box also carries `data-ui-field`, so a page can give the fields
 * of one part of it another look (a compact inspector, say).
 */
export const INPUT_CLASS =
  'h-7 w-full min-w-0 rounded-control border border-line bg-surface-2 px-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:bg-surface';

/**
 * A plain text input. As `type="number"`, a wheel turned over it while it has the focus steps the value without the
 * number sliding sideways in the box.
 */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, onWheel, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      data-ui-field=""
      className={cn(INPUT_CLASS, '[&[data-ui-wheeling]::-webkit-inner-spin-button]:hidden', className)}
      {...rest}
      onWheel={(event) => {
        onWheel?.(event);
        holdNumberTextOnWheel(event.currentTarget);
      }}
    />
  );
});

/** Props of {@link CommitInput}. */
export interface CommitInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  /** Called on Enter or blur, only when the text changed. Returning `false` refuses the text: the field shows `value` again. */
  onCommit: (value: string) => void | boolean;
  /** Called with the draft as it is typed, and with `value` again when Escape puts it back. */
  onDraftChange?: (draft: string) => void;
}

/**
 * A text input that keeps a local draft and commits on Enter or blur; Escape
 * restores the last committed value. Inspector edits use it so every
 * keystroke does not become a document write. ⌘S / Ctrl+S commits the draft
 * and lets the key go on to the page's save, keeping focus in the field.
 */
export function CommitInput({ value, onCommit, onDraftChange, className, ...rest }: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  /** Set by Enter and Escape, which already decided: the blur they cause commits nothing more. */
  const settled = useRef(false);
  const commit = () => {
    if (settled.current) {
      settled.current = false;
      return;
    }
    if (draft !== value && onCommit(draft) === false) {
      setDraft(value);
      onDraftChange?.(value);
    }
  };
  return (
    <input
      data-ui-field=""
      className={cn(INPUT_CLASS, className)}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraftChange?.(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isComposingKey(event.nativeEvent)) return;
        if ((event.metaKey || event.ctrlKey) && !event.altKey && shortcutLetter(event) === 's') {
          commit();
        } else if (event.key === 'Enter') {
          commit();
          settled.current = true;
          (event.target as HTMLInputElement).blur();
          settled.current = false;
        } else if (event.key === 'Escape') {
          settled.current = true;
          setDraft(value);
          onDraftChange?.(value);
          (event.target as HTMLInputElement).blur();
          settled.current = false;
        }
      }}
      {...rest}
    />
  );
}

/** Props of {@link NumberInput}. */
export interface NumberInputProps {
  value: number | null;
  /** Live updates while scrubbing or typing. */
  onChange?: (value: number | null) => void;
  /** Final value after typing (blur), scrub release or a step. */
  onCommit: (value: number | null) => void;
  /** Short label drawn in the scrub area, e.g. `W`, `X` or an icon. */
  label?: ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  /**
   * Told when the field changed what the user typed: held it at a bound, or
   * (in a field whose minimum is zero or more) dropped a minus sign. Called
   * once per commit or key with every change, in order, instead of the field
   * saying it ({@link numberLimitMessage}).
   */
  onLimit?: (limits: readonly NumberLimit[]) => void;
}

/** Base UI's step sizes for Alt and Shift with an arrow key (the field sets neither). */
const SMALL_STEP = 0.1;
const LARGE_STEP = 10;

/** The decimal separator the locale writes numbers with. */
function localeDecimal(): string {
  return new Intl.NumberFormat().formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.';
}

/**
 * Commits what is typed in a field before ⌘S / Ctrl+S reaches the page's
 * save, keeping the field focused with its text selected. The key is not
 * stopped: the page saves the committed value.
 */
function commitBeforeSave(field: HTMLInputElement): void {
  field.blur();
  field.focus({ preventScroll: true });
  field.select();
  queueMicrotask(() => field.select());
}

/** True for ⌘S / Ctrl+S (without Alt), on any keyboard layout. */
function isSaveKey(event: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && shortcutLetter(event) === 's';
}

/**
 * Replaces a field's text as if it were typed, so the field's own input
 * handling takes it in. False when the browser cannot.
 */
function retype(field: HTMLInputElement, text: string): boolean {
  field.select();
  return document.execCommand('insertText', false, text);
}

/**
 * A number field whose label can be dragged horizontally to scrub the value.
 *
 * Typed text past `min` or `max` is held at the bound. When `min` is zero or
 * more the field takes no negative numbers: the minus key does nothing, and
 * typed or pasted text that starts with a minus sign keeps its number without
 * the sign (`-5` is 5, not the minimum). The field says both to screen
 * readers, unless `onLimit` takes them over. ⌘S /
 * Ctrl+S commits what is typed before the page saves.
 */
export function NumberInput({ value, onChange, onCommit, label, unit, min, max, step = 1, placeholder, className, onLimit, ...aria }: NumberInputProps) {
  const input = useRef<HTMLInputElement>(null);
  /** The text in the field was typed or pasted and not committed yet. */
  const typed = useRef(false);
  const decimal = useMemo(localeDecimal, []);
  const bounds = { min, max };
  const tell = (limits: readonly NumberLimit[]) => {
    if (limits.length === 0) return;
    if (onLimit) return onLimit(limits);
    const name = aria['aria-label'] ?? (typeof label === 'string' ? label : undefined);
    if (input.current) announceFromField<HTMLSpanElement>(input.current, numberLimitMessage(limits, { name, unit }));
  };
  /**
   * The value to pass on for one the field reports. Typed text that starts with a minus sign the field refuses
   * keeps its number without the sign (left alone, the field would hold it at the minimum). On a commit from typed
   * text, the changes are told.
   */
  const typedValue = (next: number | null, reason: string, event: Event | undefined, committed: boolean): number | null => {
    const text = input.current?.value;
    const stepped = reason === 'keyboard' && event instanceof KeyboardEvent && (event.key === 'ArrowUp' || event.key === 'ArrowDown');
    const fromText = typed.current && text !== undefined && (reason === 'input-change' || reason === 'input-blur' || stepped);
    if (committed) typed.current = false;
    if (!fromText) return next;
    const settled = settleTypedText(text, bounds, decimal);
    if (settled === null) return next;
    const minusDropped = settled.limits.some((limit) => limit.reason === 'no-minus');
    const kept = minusDropped && !stepped ? settled.value : next;
    if (committed) tell(limitsKept(settled.limits, kept));
    return kept;
  };
  return (
    <BaseNumberField.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next, details) => onChange?.(typedValue(next, details.reason, details.event, false))}
      onValueCommitted={(next, details) => onCommit(typedValue(next, details.reason, details.event, true))}
      data-ui-field=""
      className={cn('flex h-7 min-w-0 items-center rounded-control border border-line bg-surface-2 focus-within:border-accent', className)}
    >
      {label !== undefined ? (
        <BaseNumberField.ScrubArea className="flex h-full w-6 shrink-0 cursor-ew-resize items-center justify-center text-[11px] text-fg-subtle">
          {label}
          <BaseNumberField.ScrubAreaCursor />
        </BaseNumberField.ScrubArea>
      ) : null}
      <BaseNumberField.Input
        ref={input}
        placeholder={placeholder}
        aria-label={aria['aria-label']}
        onFocus={(event) => prepareFieldAnnounce<HTMLSpanElement>(event.currentTarget)}
        onInput={() => {
          typed.current = true;
        }}
        onPaste={() => {
          typed.current = true;
        }}
        onBlur={() => {
          // The field commits (or turns the text down) during this blur; what is typed after it is new.
          queueMicrotask(() => {
            typed.current = false;
          });
        }}
        onKeyDown={(event) => {
          if (isComposingKey(event.nativeEvent)) return;
          const field = event.currentTarget;
          if (isSaveKey(event)) {
            commitBeforeSave(field);
          } else if (event.key === 'Enter') {
            field.blur();
          } else if (refusesMinus(bounds) && isMinusSign(event.key) && !event.ctrlKey && !event.metaKey) {
            // The field turns the key down too, except with Alt (which types dashes on a Mac).
            event.preventDefault();
            tell([{ reason: 'no-minus', limit: min ?? 0 }]);
          } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.ctrlKey && !event.metaKey && typed.current && refusesMinus(bounds) && startsWithMinus(field.value)) {
            // Left to the field, a step from "-5" would start at -5 and stop at the minimum.
            const amount = event.altKey ? SMALL_STEP : event.shiftKey ? LARGE_STEP : step;
            const stepped = stepTypedText(field.value, event.key === 'ArrowUp' ? amount : -amount, bounds, decimal);
            if (stepped === null) return;
            event.preventDefault();
            const next = stepped.value;
            if (!retype(field, new Intl.NumberFormat().format(next))) onChange?.(next);
            typed.current = false;
            onCommit(next);
            tell(stepped.limits);
          }
        }}
        className={cn('h-full w-full min-w-0 bg-transparent text-[13px] text-fg outline-none', label === undefined && 'pl-2')}
      />
      {unit ? <span className="pr-2 text-[11px] text-fg-subtle">{unit}</span> : null}
    </BaseNumberField.Root>
  );
}

/** One option of {@link SelectInput} and {@link Segmented}. */
export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  /** Icon-only segments need an accessible name. */
  title?: string;
}

/** Props of {@link SelectInput}. */
export interface SelectInputProps<T extends string> {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * Focus handlers for a select's trigger that say its new value (`label`)
 * politely while it has the focus (see `select-announce.ts`).
 */
export function useSelectAnnouncement(label: string): { onFocus(event: FocusEvent<HTMLElement>): void; onBlur(event: FocusEvent<HTMLElement>): void } {
  const announcer = useRef(createSelectAnnouncer<HTMLSpanElement>()).current;
  useEffect(() => announcer.change(label), [announcer, label]);
  useEffect(() => () => announcer.dispose(), [announcer]);
  return {
    onFocus: (event) => announcer.focus(event.currentTarget, label),
    onBlur: (event) => announcer.blur(event.currentTarget),
  };
}

/** A dropdown select. Its new value is said while its trigger has the focus. */
export function SelectInput<T extends string>({ value, options, onChange, placeholder = '—', className, ...aria }: SelectInputProps<T>) {
  const current = options.find((option) => option.value === value);
  const announce = useSelectAnnouncement(current ? (typeof current.label === 'string' ? current.label : (current.title ?? current.value)) : '');
  const handoffRef = useEscapeHandoffRef();
  return (
    <BaseSelect.Root value={value} onValueChange={(next) => next !== null && onChange(next as T)}>
      <BaseSelect.Trigger
        {...announce}
        aria-label={aria['aria-label']}
        data-ui-field=""
        className={cn(INPUT_CLASS, 'flex items-center justify-between gap-1 text-left', className)}
      >
        <BaseSelect.Value>
          {(current: T | null) => options.find((option) => option.value === current)?.label ?? <span className="text-fg-subtle">{placeholder}</span>}
        </BaseSelect.Value>
        <BaseSelect.Icon>
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-[1000]" alignItemWithTrigger={false}>
          <BaseSelect.Popup ref={handoffRef} className={cn(POPUP_CLASS, 'max-h-80 overflow-auto')}>
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className="flex h-7 min-w-32 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-hover"
                >
                  <span className="flex size-4 items-center justify-center">
                    <BaseSelect.ItemIndicator>
                      <Check className="size-3.5" />
                    </BaseSelect.ItemIndicator>
                  </span>
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/** Props of {@link Segmented}. */
export interface SegmentedProps<T extends string> {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  /**
   * Called with the picked option when it is pressed again (to let the pick go, say). Without it, that press does
   * nothing and the pick stays.
   */
  onRepick?: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

/** A segmented control (one of a few options, all visible). */
export function Segmented<T extends string>({ value, options, onChange, onRepick, className, ...aria }: SegmentedProps<T>) {
  return (
    <ToggleGroup
      value={value === null ? [] : [value]}
      onValueChange={(next) => {
        const picked = next[0];
        // Pressing the pressed option again leaves the group empty.
        if (picked !== undefined) onChange(picked as T);
        else if (value !== null) onRepick?.(value);
      }}
      aria-label={aria['aria-label']}
      data-ui-field=""
      className={cn('flex h-7 items-center gap-0.5 rounded-control bg-surface-2 p-0.5', className)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={option.title}
          title={option.title}
          className="flex h-full flex-1 items-center justify-center whitespace-nowrap rounded-[4px] px-1.5 text-fg-muted outline-none hover:text-fg data-[pressed]:bg-surface data-[pressed]:text-fg data-[pressed]:shadow-sm focus-visible:outline-2 focus-visible:outline-accent"
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** Props of {@link SwitchInput}. */
export interface SwitchInputProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label'?: string;
  disabled?: boolean;
}

/** An on/off switch. A held Enter flips it once. */
export function SwitchInput({ checked, onChange, disabled, ...aria }: SwitchInputProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next)}
      onKeyDown={preventRepeatedActivation}
      aria-label={aria['aria-label']}
      className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors data-[checked]:bg-accent disabled:opacity-40"
    >
      <BaseSwitch.Thumb className="size-3 rounded-full bg-white shadow transition-transform data-[checked]:translate-x-3" />
    </BaseSwitch.Root>
  );
}

/** Class names for the parts of a {@link SliderInput}, for an editor with its own look. */
export interface SliderLook {
  root?: string;
  track?: string;
  indicator?: string;
  thumb?: string;
}

const SLIDER_LOOK: Required<SliderLook> = {
  root: 'flex h-7 w-full items-center data-[disabled]:opacity-40',
  track: 'h-1 w-full rounded-full bg-line-strong',
  indicator: 'rounded-full bg-accent',
  thumb: 'size-3.5 rounded-full border border-line-strong bg-white shadow outline-none focus-visible:outline-2 focus-visible:outline-accent',
};

/** Props of {@link SliderInput}. */
export interface SliderInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /**
   * What an arrow key moves when it is not `step` (a range with no step of
   * its own drags in fine steps but keys by its field's step); Shift: ten
   * times it.
   */
  keyStep?: number;
  /** Each move, during a drag or from a key. */
  onChange: (value: number) => void;
  /** Once per drag when it ends, and after each key. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
  /** The selection holds different values: it reads "Mixed" and shows no thumb position. */
  mixed?: boolean;
  /** "%": the value reads as a percentage. */
  unit?: string;
  look?: SliderLook;
  'aria-label'?: string;
}

/** The drag under way: the pointer that started it and what it has moved to. */
interface SliderDrag {
  pointerId: number | null;
  last: number;
  moved: boolean;
  /** Another pointer was released while this one drags. */
  foreign?: boolean;
  /** The range as it was when the drag began: it holds still until the drag ends. */
  range: { min: number; max: number; step: number };
  stop: () => void;
}

/**
 * A horizontal slider. A drag always ends in one `onCommit`: also when the
 * pointer is cancelled, or the slider is disabled or removed mid-drag; only
 * the pointer that started it ends it, and its range holds still meanwhile.
 * Pointer movement after a cancelled drag changes nothing. The arrows move a
 * step, PageUp and PageDown ten, Home and End go to the ends; Space does not
 * scroll the page.
 */
export function SliderInput({ value, min, max, step = 1, keyStep, onChange, onCommit, disabled, mixed, unit, look, ...aria }: SliderInputProps): ReactNode {
  const drag = useRef<SliderDrag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // A mixed slider has no one value to report.
  useEffect(() => {
    if (mixed) root.current?.querySelectorAll('[aria-valuenow]').forEach((node) => node.removeAttribute('aria-valuenow'));
  });
  const latest = useRef(onCommit);
  latest.current = onCommit;
  const settle = (final?: number): void => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    current.stop();
    if (final !== undefined || current.moved) latest.current?.(final ?? current.last);
  };
  const begin = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current || disabled || event.button !== 0) return;
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    const end = (ended: Event): void => {
      // Listening in the capture phase hears every element's blur too: only the window's ends a drag.
      if (ended.type === 'blur' && ended.target !== window) return;
      if (!endsDrag({ type: ended.type, ...(ended instanceof PointerEvent ? { pointerId: ended.pointerId } : {}) }, pointerId)) {
        // Another pointer let go: the slider ends its own tracking on any release, but this drag goes on.
        if (drag.current) drag.current.foreign = true;
        return;
      }
      // The slider commits a release itself; settle whatever it left open.
      setTimeout(() => settle(), 0);
    };
    DRAG_ENDS.forEach((type) => window.addEventListener(type, end, true));
    drag.current = { pointerId, last: value, moved: false, range: { min, max, step }, stop: () => DRAG_ENDS.forEach((type) => window.removeEventListener(type, end, true)) };
  };
  useEffect(() => {
    if (disabled) settle();
  }, [disabled]);
  useEffect(() => () => settle(), []);
  // After a cancelled drag the slider keeps tracking the pointer until the next
  // release; whatever it reports then belongs to no drag of this slider.
  const strayPointer = (reason: string): boolean => !drag.current && (reason === 'drag' || reason === 'track-press');
  const single = (next: number | readonly number[]): number => (Array.isArray(next) ? (next[0] ?? min) : (next as number));
  const range = drag.current?.range ?? { min, max, step };
  const parts = { ...SLIDER_LOOK, ...look };
  const valueText = (_formatted: string, current: number): string => sliderValueText(current, { ...(mixed ? { mixed } : {}), ...(unit ? { unit } : {}) }) ?? _formatted;
  return (
    <BaseSlider.Root
      value={value}
      disabled={disabled}
      min={range.min}
      max={range.max}
      step={range.step}
      largeStep={largeStepOf(range.step)}
      ref={root}
      data-mixed={mixed ? '' : undefined}
      onPointerDownCapture={begin}
      onKeyDownCapture={(event) => {
        const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
        if (keyStep === undefined || direction === undefined || disabled) return;
        event.preventDefault();
        event.stopPropagation();
        const from = mixed ? min : value;
        const next = Math.min(max, Math.max(min, Math.round((from + direction * keyStep * (event.shiftKey ? 10 : 1)) * 1e6) / 1e6));
        if (next === value) return;
        onChange(next);
        onCommit?.(next);
      }}
      onKeyDown={(event) => {
        if (event.key === ' ') event.preventDefault();
      }}
      onValueChange={(next, details) => {
        if (strayPointer(details.reason)) return;
        const v = single(next);
        if (drag.current) drag.current = { ...drag.current, last: v, moved: true };
        onChange(v);
      }}
      onValueCommitted={(next, details) => {
        if (strayPointer(details.reason)) return;
        const v = single(next);
        const current = drag.current;
        if (current?.foreign) {
          // Released by another pointer: the drag ends when its own pointer lets go.
          current.foreign = false;
          current.last = v;
          return;
        }
        if (current) settle(v);
        else onCommit?.(v);
      }}
      className={parts.root}
    >
      <BaseSlider.Control className="flex h-4 w-full items-center">
        <BaseSlider.Track className={parts.track}>
          {mixed ? null : <BaseSlider.Indicator className={parts.indicator} />}
          <BaseSlider.Thumb aria-label={aria['aria-label']} getAriaValueText={valueText} data-mixed={mixed ? '' : undefined} className={cn(parts.thumb, mixed && 'opacity-0 focus-visible:opacity-100')} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

/** Props of {@link ColorInput}. */
export interface ColorInputProps {
  /** Any CSS color string, or `null` for "not set". */
  value: string | null;
  onCommit: (value: string) => void;
  /** Swatches offered above the text field (e.g. design-system tokens). */
  swatches?: { label: string; value: string; css?: string }[];
  /** Text shown while no color is set (default "none"). */
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * A color field: a swatch opening the browser's picker, a text field for any
 * CSS color (hex, rgb, oklch, `var(--token)`), and optional token swatches.
 */
export function ColorInput({ value, onCommit, swatches, placeholder = 'none', ...aria }: ColorInputProps) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <label
          className="relative size-7 shrink-0 overflow-hidden rounded-control border border-line"
          style={{ background: value ?? 'transparent' }}
          title="Pick a color"
        >
          <input
            type="color"
            value={hex}
            aria-label={aria['aria-label'] ? `${aria['aria-label']} picker` : 'Color picker'}
            onChange={(event) => onCommit(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <CommitInput value={value ?? ''} onCommit={onCommit} placeholder={placeholder} aria-label={aria['aria-label']} />
      </div>
      {swatches && swatches.length ? (
        <div className="flex flex-wrap gap-1">
          {swatches.map((swatch) => (
            <button
              key={swatch.label}
              type="button"
              title={swatch.label}
              aria-label={swatch.label}
              onClick={() => onCommit(swatch.css ?? swatch.value)}
              className="size-5 rounded-[4px] border border-line"
              style={{ background: swatch.value }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
