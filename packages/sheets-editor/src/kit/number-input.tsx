import * as React from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';
import * as ReactDOM from 'react-dom';
import { Field, type FieldProps } from './field.tsx';
import { TextInput, type TextInputProps } from './text-input.tsx';
import { useLocale } from './theme.tsx';

export interface NumberValueDetails {
  /** The typed text is not a number, so the value is `null` until it is fixed. */
  isUnreadable: boolean;
}

export interface NumberInputProps
  extends Omit<TextInputProps, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'slotEnd'> {
  value: number | null;
  onValueChange?: (value: number | null, details: NumberValueDetails) => void;
  min?: number;
  max?: number;
  /** How far the arrow keys move the value; Shift moves ten times as far. */
  step?: number;
  /** How the value is written when the field is not being typed in. */
  format?: Intl.NumberFormatOptions;
}

type ReadNumber = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'unreadable' };

interface NumberSymbols {
  group: string;
  decimal: string;
}

function numberSymbolsOf(locale: string | undefined): NumberSymbols {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

const SPACES = /[\s  ]/g;
const PLAIN_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

function readNumber(text: string, { group, decimal }: NumberSymbols): ReadNumber {
  let plain = text.replace(SPACES, '');
  if (plain === '') return { kind: 'empty' };
  plain = plain.replace(/[−‒–]/g, '-');
  if (group.trim() !== '' && group !== decimal) plain = plain.split(group).join('');
  if (decimal !== '.') plain = plain.split(decimal).join('.');
  if (!PLAIN_NUMBER.test(plain)) return { kind: 'unreadable' };
  const value = Number(plain);
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'unreadable' };
}

const clamp = (value: number, min: number | undefined, max: number | undefined): number =>
  Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? Number.MIN_SAFE_INTEGER, value));

const decimalPlaces = (value: number): number => {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
};

/**
 * A text field for a number, in the page's language. Typing keeps the text as typed and reports
 * each readable value, kept within `min` and `max`; text that is not a number reports `null`
 * with `isUnreadable` and, once the field is left, shows as invalid.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, min, max, step = 1, format, onBlur, onKeyDown, disabled, readOnly, ...props },
  ref,
) {
  const locale = useLocale();
  const formatter = React.useMemo(() => new Intl.NumberFormat(locale, format), [locale, format]);
  const symbols = React.useMemo(() => numberSymbolsOf(locale), [locale]);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [isInvalidShown, setInvalidShown] = React.useState(false);
  const reported = React.useRef<{ value: number | null; isUnreadable: boolean }>({ value, isUnreadable: false });
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const setRef = React.useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref !== null) ref.current = element;
    },
    [ref],
  );

  React.useEffect(() => {
    if (value === reported.current.value) return;
    reported.current = { value, isUnreadable: false };
    const input = inputRef.current;
    if (input !== null && input.ownerDocument.activeElement === input) return;
    setDraft(null);
    setInvalidShown(false);
  }, [value]);

  const report = (next: number | null, isUnreadable: boolean): void => {
    if (next === reported.current.value && isUnreadable === reported.current.isUnreadable) return;
    reported.current = { value: next, isUnreadable };
    onValueChange?.(next, { isUnreadable });
  };

  const isRefusedNegative = (number: number): boolean => number < 0 && min !== undefined && min >= 0;

  const readDraft = (text: string): { value: number | null; isUnreadable: boolean } => {
    const read = readNumber(text, symbols);
    if (read.kind === 'empty') return { value: null, isUnreadable: false };
    if (read.kind === 'number' && !isRefusedNegative(read.value)) return { value: clamp(read.value, min, max), isUnreadable: false };
    return { value: null, isUnreadable: true };
  };

  const stepTo = (next: number): void => {
    setDraft(null);
    setInvalidShown(false);
    report(next, false);
  };

  const shown = draft ?? (value === null ? '' : formatter.format(value));
  const wholeNumbers = format?.maximumFractionDigits === 0;

  return (
    <TextInput
      ref={setRef}
      data-ui="NumberInput"
      inputMode={wholeNumbers && (min === undefined || min >= 0) ? 'numeric' : 'decimal'}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      {...props}
      disabled={disabled}
      readOnly={readOnly}
      aria-invalid={isInvalidShown || props['aria-invalid'] || undefined}
      value={shown}
      onChange={(event) => {
        const text = event.currentTarget.value;
        setDraft(text);
        setInvalidShown(false);
        const read = readDraft(text);
        report(read.value, read.isUnreadable);
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (draft === null) return;
        const read = readDraft(draft);
        if (read.isUnreadable) setInvalidShown(true);
        else setDraft(null);
        report(read.value, read.isUnreadable);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || disabled || readOnly) return;
        const target = event.currentTarget;
        if (event.key === 'Enter') {
          if (!reported.current.isUnreadable || isComposingKey(event.nativeEvent) || event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          if (event.repeat) return;
          ReactDOM.flushSync(() => {
            target.blur();
            target.focus();
          });
          return;
        }
        if ((event.key === 'Home' && min !== undefined) || (event.key === 'End' && max !== undefined)) {
          if (event.shiftKey) return;
          event.preventDefault();
          stepTo(event.key === 'Home' ? (min ?? 0) : (max ?? 0));
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const current = draft === null ? value : readDraft(draft).value;
        const base = current ?? min ?? 0;
        const amount = event.shiftKey ? step * 10 : step;
        const places = Math.max(decimalPlaces(base), decimalPlaces(amount));
        const next = Number(clamp(base + (event.key === 'ArrowUp' ? amount : -amount), min, max).toFixed(places));
        stepTo(next);
      }}
    />
  );
});

export interface FieldNumberInputProps extends NumberInputProps, Pick<FieldProps, 'label' | 'hint' | 'error'> {
  fieldClassName?: string;
}

/** A labelled number field, with an optional hint or error under it. */
export const FieldNumberInput = React.forwardRef<HTMLInputElement, FieldNumberInputProps>(function FieldNumberInput(
  { label, hint, error, fieldClassName, disabled, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} disabled={disabled} className={fieldClassName}>
      <NumberInput ref={ref} disabled={disabled} {...props} />
    </Field>
  );
});
