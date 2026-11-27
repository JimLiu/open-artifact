import * as React from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';
import * as ReactDOM from 'react-dom';
import { Popover } from '@base-ui/react/popover';
import { type CalendarDate, type DateValue, toCalendarDate } from '@internationalized/date';
import { I18nProvider, useDateField, useDateSegment, useLocale as useAriaLocale } from 'react-aria';
import { type DateFieldState, type DateSegment, useDateFieldState } from 'react-stately';
import { Button } from './button.tsx';
import { Calendar, createGregorianCalendar, isoDateOf, parseIsoDate } from './calendar.tsx';
import { cn } from './cn.ts';
import { useKitLabel } from './labels.tsx';
import { LayerBaseProvider, OVERLAY_ATTRIBUTE, useOverlayLayer } from './layers.tsx';
import { PopupScope } from './popup.tsx';
import { useLocale } from './theme.tsx';

export interface DateInputProps {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  /** The day shown, as `YYYY-MM-DD`, or `null` for none. */
  value: string | null;
  /**
   * Called with the typed or picked day once it is settled: when focus leaves the field, on
   * Enter, or on a pick in the calendar. A day that is out of range or has a short year is not
   * reported; clearing the field reports `null`.
   */
  onValueCommitted: (iso: string | null) => void;
  minDate?: string;
  maxDate?: string;
  size?: 'sm';
  fullWidth?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  className?: string;
}

type LeaveState = 'idle' | 'leaving' | 'committed';

const hasFullYear = (date: CalendarDate): boolean => date.year >= 1000;

const isSameDate = (date: CalendarDate | null, other: CalendarDate | null): boolean =>
  date === other || (date !== null && other !== null && date.compare(other) === 0);

const calendarDateOf = (value: DateValue | null): CalendarDate | null => (value === null ? null : toCalendarDate(value));

const isElement = (target: EventTarget | null): target is Element =>
  target !== null && typeof (target as Partial<Element>).nodeType === 'number' && (target as Node).nodeType === 1;

function clickSubmitOf(form: HTMLFormElement | null | undefined): void {
  if (form === null || form === undefined) return;
  for (const element of Array.from(form.elements)) {
    if ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === 'submit') {
      if (!element.disabled) element.click();
      return;
    }
  }
}

const SHELL_CLASSES =
  'ui-reset relative inline-flex h-control min-w-0 items-center rounded-control bg-fill-field text-body text-primary shadow-field-ring transition-shadow duration-fast ease-out motion-reduce:transition-none';
const RING_CLASSES =
  'focus-within:shadow-focus data-[invalid]:shadow-field-invalid data-[invalid]:focus-within:shadow-focus-danger';

const SEGMENT_CLASSES =
  'rounded-chip px-[1px] tabular-nums outline-none focus-visible:outline-hidden focus:bg-fill-accent focus:text-on-accent forced-colors:focus:bg-[color:Highlight] forced-colors:focus:text-[color:HighlightText] data-[placeholder]:text-muted focus:data-[placeholder]:text-on-accent';

function DateInputSegment({ segment, state }: { segment: DateSegment; state: DateFieldState }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const { segmentProps } = useDateSegment(segment, state, ref);
  if (segment.type === 'literal') {
    return (
      <span {...segmentProps} ref={ref} className="text-secondary">
        {segment.text}
      </span>
    );
  }
  return (
    <div {...segmentProps} ref={ref} className={SEGMENT_CLASSES}>
      {segment.text}
    </div>
  );
}

function DateInputBody({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  value,
  onValueCommitted,
  minDate,
  maxDate,
  size,
  fullWidth = true,
  invalid = false,
  disabled = false,
  readOnly = false,
  required,
  name,
  className,
}: DateInputProps): React.ReactElement {
  const { locale, direction } = useAriaLocale();
  const calendarName = useKitLabel('calendar');
  const minValue = React.useMemo(() => parseIsoDate(minDate), [minDate]);
  const maxValue = React.useMemo(() => parseIsoDate(maxDate), [maxDate]);

  const [lastValue, setLastValue] = React.useState(value);
  const [committed, setCommitted] = React.useState(() => parseIsoDate(value));
  const [draft, setDraft] = React.useState(committed);
  const [isFocusWithin, setFocusWithin] = React.useState(false);
  const [isOpen, setOpen] = React.useState(false);

  let shownCommitted = committed;
  let shownDraft = draft;
  if (value !== lastValue) {
    const next = parseIsoDate(value);
    setLastValue(value);
    if (!isSameDate(next, committed)) {
      shownDraft = next;
      setDraft(next);
    }
    shownCommitted = next;
    setCommitted(next);
  }

  const isInRange = (date: CalendarDate): boolean =>
    !(minValue !== null && date.compare(minValue) < 0) && !(maxValue !== null && date.compare(maxValue) > 0);

  const commit = (date: CalendarDate | null): void => {
    if (disabled || readOnly) return;
    if (date !== null && !(hasFullYear(date) && isInRange(date))) return;
    if (isSameDate(date, shownCommitted)) return;
    setCommitted(date);
    onValueCommitted(date === null ? null : isoDateOf(date));
  };

  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const segmentsRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const leaveState = React.useRef<LeaveState>('idle');
  const isCalendarOpen = isOpen && !disabled && !readOnly;
  if (isOpen && !isCalendarOpen) setOpen(false);

  const isDraftIncomplete = !isFocusWithin && shownDraft !== null && !hasFullYear(shownDraft);
  const state = useDateFieldState({
    value: shownDraft,
    onChange: (changed) => {
      const date = calendarDateOf(changed);
      setDraft(date);
      if (isCalendarOpen || !isFocusWithin) commit(date);
      else if (leaveState.current === 'leaving') {
        commit(date);
        leaveState.current = 'committed';
      }
    },
    minValue,
    maxValue,
    isDisabled: disabled,
    isReadOnly: readOnly,
    isRequired: required,
    isInvalid: invalid || isDraftIncomplete || undefined,
    locale,
    createCalendar: createGregorianCalendar,
  });
  const hasPlaceholder = state.segments.some((segment) => segment.type !== 'literal' && segment.isPlaceholder);
  const draftToCommit = hasPlaceholder ? null : shownDraft;

  const { fieldProps, inputProps } = useDateField(
    {
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledby,
      'aria-describedby': ariaDescribedby,
      name,
      isDisabled: disabled,
      isReadOnly: readOnly,
      isRequired: required,
      inputRef,
      onKeyDown: (event) => {
        if (event.key !== 'Enter' || isComposingKey(event.nativeEvent) || event.repeat) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        ReactDOM.flushSync(() => {
          target.blur();
          target.focus();
        });
        if (inputRef.current?.dataset.held === undefined) clickSubmitOf(inputRef.current?.form);
      },
    },
    state,
    segmentsRef,
  );

  const isLeavingGroup = (event: React.FocusEvent): boolean =>
    !isCalendarOpen && (event.relatedTarget === null || !(groupRef.current?.contains(event.relatedTarget) ?? false));

  const onOpenChange = (open: boolean, details: Popover.Root.ChangeEventDetails): void => {
    setOpen(open);
    if (open) return;
    const { event } = details;
    const nextFocus =
      details.reason === 'focus-out' && 'relatedTarget' in event
        ? event.relatedTarget
        : details.reason === 'outside-press'
          ? event.target
          : groupRef.current;
    const isInGroup = isElement(nextFocus) && (groupRef.current?.contains(nextFocus) ?? false);
    setFocusWithin(isInGroup && isFocusWithin);
    if (!hasPlaceholder || !isInGroup) commit(draftToCommit);
  };

  const layer = useOverlayLayer('popover');
  const isInvalid = state.isInvalid;
  const calendarDay = shownDraft !== null && !hasFullYear(shownDraft) ? shownCommitted : calendarDateOf(state.value);
  const segments = state.segments.map((segment, index) => <DateInputSegment key={index} segment={segment} state={state} />);

  return (
    <Popover.Root open={isCalendarOpen} onOpenChange={onOpenChange}>
      <div
        ref={groupRef}
        data-ui="DateInput"
        data-size={size}
        data-invalid={isInvalid || undefined}
        data-disabled={disabled || undefined}
        onFocus={(event) => {
          const group = event.currentTarget;
          if (!group.contains(group.ownerDocument.activeElement)) return;
          leaveState.current = 'idle';
          setFocusWithin(true);
        }}
        onBlurCapture={(event) => {
          if (isLeavingGroup(event)) leaveState.current = 'leaving';
        }}
        onBlur={(event) => {
          if (!isLeavingGroup(event)) return;
          setFocusWithin(false);
          if (leaveState.current !== 'committed') commit(draftToCommit);
          leaveState.current = 'idle';
        }}
        className={cn(
          SHELL_CLASSES,
          RING_CLASSES,
          disabled ? 'opacity-disabled' : '[&:not(:focus-within)]:hover:shadow-field-hover',
          fullWidth && 'w-full',
          className,
        )}
      >
        <div {...fieldProps} ref={segmentsRef} className="flex h-full min-w-0 flex-1 cursor-text items-center whitespace-nowrap ps-md">
          {direction === 'ltr' ? <div dir="ltr" className="inline-flex items-center">{segments}</div> : segments}
        </div>
        <input
          {...inputProps}
          ref={inputRef}
          value={shownCommitted === null ? '' : isoDateOf(shownCommitted)}
          data-held={!isSameDate(draftToCommit, shownCommitted) || undefined}
        />
        <span className="flex aspect-square h-control shrink-0 items-center justify-center">
          <Popover.Trigger
            render={
              <Button
                iconOnly
                variant="ghost"
                size={size === 'sm' ? 'xs' : 'sm'}
                icon="Calendar"
                aria-label={calendarName}
                tooltip={false}
                disabled={disabled || readOnly}
              />
            }
          />
        </span>
      </div>
      <Popover.Portal>
        <PopupScope>
          <LayerBaseProvider base={layer.base}>
            <Popover.Positioner anchor={groupRef} align="start" sideOffset={4} style={layer.style} className="data-[anchor-hidden]:invisible">
              <Popover.Popup
                data-ui="Popover"
                {...{ [OVERLAY_ATTRIBUTE]: '' }}
                aria-label={calendarName}
                initialFocus={false}
                finalFocus
                className="ui-reset rounded-panel bg-surface-popover p-sm text-body text-primary shadow-popover outline-none focus-visible:outline-hidden"
              >
                <Calendar
                  autoFocus
                  aria-label={ariaLabelledby === undefined ? (ariaLabel ?? calendarName) : undefined}
                  aria-labelledby={ariaLabelledby}
                  value={calendarDay === null ? null : isoDateOf(calendarDay)}
                  onChange={(iso) => {
                    const picked = parseIsoDate(iso);
                    if (picked !== null) state.setValue(picked);
                    setOpen(false);
                  }}
                  minDate={minDate}
                  maxDate={maxDate}
                  disabled={disabled}
                  readOnly={readOnly}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </LayerBaseProvider>
        </PopupScope>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A day typed into month, day and year parts in the page's language, with a calendar to pick
 * from. Arrow keys step the focused part; Enter settles the day and submits the form it is in.
 */
export function DateInput(props: DateInputProps): React.ReactElement {
  const locale = useLocale();
  return (
    <I18nProvider locale={locale}>
      <DateInputBody {...props} />
    </I18nProvider>
  );
}
