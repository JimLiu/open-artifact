import * as React from 'react';
import { Field as BaseField } from '@base-ui/react/field';
import { cn } from './cn.ts';
import { TooltipGroup } from './tooltip.tsx';

/**
 * Sections and rows read their inline padding from `--cmp-property-pad-start` and
 * `--cmp-property-pad-end`, the label column from `--cmp-property-label-width` (in px,
 * unitless) and the trailing column from `--cmp-property-trailing`.
 */
const PAD_CLASSES = 'ps-[var(--cmp-property-pad-start,var(--ui-pad-lg))] pe-[var(--cmp-property-pad-end,var(--ui-pad-md))]';

export interface PropertySectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'className'> {
  title?: React.ReactNode;
  /** Buttons at the end of the title row. */
  actions?: React.ReactNode;
  className?: string;
}

const isShown = (node: React.ReactNode): boolean => node !== undefined && node !== null && node !== false;

/** A titled group of property rows, divided from the section before it. */
export const PropertySection = React.forwardRef<HTMLElement, PropertySectionProps>(function PropertySection(
  { title, actions, className, children, ...props },
  ref,
) {
  const hasTitle = isShown(title);
  const hasChildren = React.Children.toArray(children).length > 0;
  return (
    <section
      ref={ref}
      data-ui="PropertySection"
      {...props}
      className={cn(
        'flex min-w-0 shrink-0 flex-col border-divider [&:not(:first-child)]:border-t',
        !hasTitle && '[&:not(:first-child)]:pt-2',
        'has-[[data-ui-part=property-row-trailing]]:[--cmp-property-trailing:var(--ui-h-control)]',
        className,
      )}
    >
      {hasTitle && (
        <div className={cn('flex min-h-10 min-w-0 shrink-0 items-center gap-xs py-2 text-body-semibold text-primary select-none', PAD_CLASSES)}>
          <h3 className="min-w-0 flex-1 truncate font-inherit">{title}</h3>
          {isShown(actions) && (
            <span className="-my-1 flex shrink-0 items-center gap-0.5">
              <TooltipGroup>{actions}</TooltipGroup>
            </span>
          )}
        </div>
      )}
      {hasChildren && <div className="flex min-w-0 flex-col pb-2">{children}</div>}
    </section>
  );
});

export interface PropertyRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  /** Names the row; it also labels the control in the row. */
  label?: React.ReactNode;
  /** A small control after the row's control, such as an icon button. */
  trailing?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

const FOCUSABLE_SELECTOR = 'input:not([aria-hidden="true"]),textarea,select,button,[tabindex="0"]';
const UNFOCUSABLE_SELECTOR = ':disabled,[aria-disabled="true"],[data-disabled],[tabindex="-1"],[data-ui-disabled-reason-wrapper]';
const OWN_POPUP_SELECTOR = '[popover],[role="dialog"],[role="listbox"],[role="menu"],[data-ui-part="property-row-trailing"]';
const TEXT_ENTRY_SELECTOR =
  'input:not([type="button"],[type="checkbox"],[type="color"],[type="file"],[type="image"],[type="radio"],[type="range"],[type="reset"],[type="submit"]),textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';

/** One labelled property: a label column, the control, and an optional trailing control. */
export const PropertyRow = React.forwardRef<HTMLDivElement, PropertyRowProps>(function PropertyRow(
  { label, trailing, disabled = false, className, children, onPointerDown, onClick, onKeyDownCapture, ...props },
  ref,
) {
  const hasLabel = isShown(label);
  const hasTrailing = isShown(trailing);
  const controlsRef = React.useRef<HTMLDivElement | null>(null);
  const touchPressRef = React.useRef(false);
  const silentlyFocusedRef = React.useRef<HTMLElement | null>(null);

  // A press on the row that focused nothing moves focus to its first usable control; a touch
  // does not put the keyboard up for a text field this way.
  const focusFirstControl = (): void => {
    const byTouch = touchPressRef.current;
    touchPressRef.current = false;
    const controls = controlsRef.current;
    const doc = controls?.ownerDocument;
    if (!controls || !doc || disabled || doc.activeElement !== doc.body) return;
    for (const candidate of controls.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
      const popup = candidate.closest(OWN_POPUP_SELECTOR);
      if (candidate.matches(UNFOCUSABLE_SELECTOR) || (popup !== null && controls.contains(popup))) continue;
      const entersText = candidate.matches(TEXT_ENTRY_SELECTOR);
      if (byTouch && entersText) return;
      candidate.focus(entersText ? undefined : { focusVisible: false });
      if (doc.activeElement === candidate) {
        silentlyFocusedRef.current = entersText ? null : candidate;
        return;
      }
    }
  };

  return (
    <BaseField.Root
      ref={ref}
      data-ui="PropertyRow"
      disabled={disabled}
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        touchPressRef.current = event.pointerType === 'touch';
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        focusFirstControl();
      }}
      onKeyDownCapture={(event) => {
        onKeyDownCapture?.(event);
        // The first key after a silent focus shows the focus ring.
        const focused = silentlyFocusedRef.current;
        if (focused === null || event.ctrlKey || event.metaKey || event.altKey || event.key === 'Shift') return;
        silentlyFocusedRef.current = null;
        if (event.target === focused && !focused.matches(':focus-visible')) {
          focused.blur();
          focused.focus({ focusVisible: true });
        }
      }}
      className={cn(
        'group/property-row grid min-h-[max(2rem,calc(var(--ui-h-control)+0.25rem))] min-w-0 shrink-0 items-center gap-0 gap-x-sm py-px touch:min-h-10',
        PAD_CLASSES,
        hasLabel ? 'grid-cols-[calc(var(--cmp-property-label-width,76)/16*1rem*var(--ui-rem-scale,1))_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]',
        className,
      )}
    >
      {hasLabel && (
        <div className={cn('flex min-w-0 items-center', disabled && 'opacity-disabled')}>
          <BaseField.Label className="min-w-0 truncate text-footnote font-normal text-secondary select-none">{label}</BaseField.Label>
        </div>
      )}
      <div
        ref={controlsRef}
        className={cn(
          'flex min-w-0 items-center gap-2',
          !hasTrailing && 'pe-[calc(var(--cmp-property-trailing,-0.25rem)+0.25rem)] touch:pe-[calc(var(--cmp-property-trailing,-0.5rem)+0.5rem)]',
        )}
      >
        {children}
        {hasTrailing && (
          <TooltipGroup>
            <span
              data-ui-part="property-row-trailing"
              className="-ms-1 flex w-[var(--cmp-property-trailing,auto)] shrink-0 items-center justify-center touch:ms-0"
            >
              {trailing}
            </span>
          </TooltipGroup>
        )}
      </div>
    </BaseField.Root>
  );
});
