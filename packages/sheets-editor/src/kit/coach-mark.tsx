import * as React from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Button } from './button.tsx';
import { cn } from './cn.ts';
import { Icon } from './icon.tsx';
import { useKitLabel } from './labels.tsx';
import { useOverlayLayer } from './layers.tsx';
import { PopupLayerScope, useMergedRefs, useOpenerFocusReturn, type PopupFinalFocus } from './popup-frame.tsx';
import { useScrollableOverflow } from './scrollable-overflow.ts';

type PositionerProps = BasePopover.Positioner.Props;
type OpenChangeDetails = BasePopover.Root.ChangeEventDetails;

export type CoachMarkVariant = 'accent' | 'neutral';

/** How much taller than its room a coach mark's content may be before it scrolls. */
const COACH_MARK_SCROLL_SLACK_PX = 6;

const COACH_MARK_POPUP_CLASSES =
  'ui-reset relative flex max-h-[var(--available-height)] max-w-[280px] flex-col cursor-default rounded-panel p-lg text-body font-normal shadow-popover outline-none focus-visible:outline-hidden origin-[var(--transform-origin)] transition-[opacity,scale] duration-base ease-snap motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97]';

const COACH_MARK_VARIANT_CLASSES: Readonly<Record<CoachMarkVariant, string>> = {
  neutral: 'bg-surface-popover border border-[var(--ui-ring-color)] text-primary',
  accent: 'bg-fill-accent text-on-accent',
};

const ARROW_VARIANT_CLASSES: Readonly<Record<CoachMarkVariant, string>> = {
  neutral: 'bg-surface-popover border-[var(--ui-ring-color)]',
  accent: 'bg-fill-accent border-transparent',
};

const ARROW_CLASSES =
  'size-2.5 rotate-45 border data-[side=bottom]:-top-[5px] data-[side=bottom]:border-e-0 data-[side=bottom]:border-b-0 data-[side=top]:-bottom-[5px] data-[side=top]:border-s-0 data-[side=top]:border-t-0 data-[side=left]:-right-[5px] data-[side=left]:border-b-0 data-[side=left]:border-s-0 data-[side=right]:-left-[5px] data-[side=right]:border-t-0 data-[side=right]:border-e-0 forced-colors:hidden';

export interface CoachMarkProps {
  open: boolean;
  onOpenChange?: (open: boolean, details: OpenChangeDetails) => void;
  /** Called once each time the coach mark has shown. */
  onShown?: () => void;
  /** What the coach mark points at. */
  anchor: PositionerProps['anchor'];
  side?: PositionerProps['side'];
  align?: PositionerProps['align'];
  sideOffset?: PositionerProps['sideOffset'];
  variant?: CoachMarkVariant;
  title?: React.ReactNode;
  /** The accessible name when there is no title. */
  'aria-label'?: string;
  /** Shows a dismiss button in the corner. */
  showClose?: boolean;
  closeLabel?: string;
  /** A button under the text. */
  action?: React.ReactNode;
  /**
   * Whether a press outside, focus leaving or Escape closes it. A coach mark with a dismiss button
   * or an action stays until one of them is used, unless this is true.
   */
  lightDismiss?: boolean;
  finalFocus?: PopupFinalFocus;
  className?: string;
  children?: React.ReactNode;
}

/** A note pointing at part of the page, shown without taking focus. */
export const CoachMark = React.forwardRef<HTMLDivElement, CoachMarkProps>(function CoachMark(
  {
    open,
    onOpenChange,
    onShown,
    anchor,
    side = 'bottom',
    align = 'center',
    sideOffset = 10,
    variant = 'accent',
    title,
    'aria-label': ariaLabel,
    showClose = false,
    closeLabel,
    action,
    lightDismiss = false,
    finalFocus,
    className,
    children,
  },
  ref,
) {
  const layer = useOverlayLayer('coachmark');
  const dismiss = useKitLabel('dismiss');
  const opener = useOpenerFocusReturn(finalFocus === undefined);
  const mergedRef = useMergedRefs<HTMLDivElement>(ref, opener.popupRef);
  // A tall coach mark scrolls its content inside the available height.
  const [scrollBox, setScrollBox] = React.useState<HTMLDivElement | null>(null);
  const scrolls = useScrollableOverflow(scrollBox, COACH_MARK_SCROLL_SLACK_PX);
  const needsExplicitClose = showClose || (action !== undefined && action !== null);
  const shownRef = React.useRef(false);

  const handleOpenChange = (next: boolean, details: OpenChangeDetails): void => {
    if (
      !next &&
      needsExplicitClose &&
      !lightDismiss &&
      (details.reason === 'outside-press' || details.reason === 'focus-out' || details.reason === 'escape-key')
    ) {
      details.cancel();
      details.allowPropagation();
      return;
    }
    onOpenChange?.(next, details);
  };

  const onOpenChangeComplete = (isOpen: boolean): void => {
    if (!isOpen) {
      shownRef.current = false;
      return;
    }
    if (shownRef.current) return;
    shownRef.current = true;
    onShown?.();
  };

  const hasTitle = title !== undefined && title !== null && title !== false && title !== '';
  const closeButton = showClose ? (
    <span className="ms-auto flex size-[1lh] shrink-0 items-center justify-center">
      <BasePopover.Close
        render={
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            icon={<Icon name="X" size="xs" />}
            tooltip={false}
            aria-label={closeLabel ?? dismiss}
            className={cn('shrink-0', variant === 'accent' && '!text-on-accent [--ui-fill-ghost-hover:rgb(255_255_255/0.15)]')}
          />
        }
      />
    </span>
  ) : null;

  return (
    <BasePopover.Root open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={onOpenChangeComplete} modal={false}>
      <BasePopover.Portal>
        <PopupLayerScope layer={layer}>
          <BasePopover.Positioner
            className="data-[anchor-hidden]:invisible"
            style={layer.style}
            anchor={anchor}
            side={side}
            align={align}
            sideOffset={sideOffset}
            arrowPadding={16}
          >
            <BasePopover.Popup
              ref={mergedRef}
              data-ui="CoachMark"
              data-variant={variant}
              aria-label={hasTitle ? undefined : ariaLabel}
              aria-live="polite"
              initialFocus={false}
              finalFocus={finalFocus ?? opener.finalFocus}
              className={cn(COACH_MARK_POPUP_CLASSES, COACH_MARK_VARIANT_CLASSES[variant], className)}
            >
              <BasePopover.Arrow className={cn(ARROW_CLASSES, ARROW_VARIANT_CLASSES[variant])} />
              <div ref={setScrollBox} className={cn('min-h-0 flex-auto', scrolls && '-m-1.5 overflow-y-auto p-1.5')}>
                <div className="flex flex-col gap-xs [overflow-wrap:anywhere]">
                  {hasTitle ? (
                    <>
                      <div className="flex items-start gap-sm">
                        <BasePopover.Title className="min-w-0 font-semibold break-words">{title}</BasePopover.Title>
                        {closeButton}
                      </div>
                      {children}
                    </>
                  ) : closeButton !== null ? (
                    <div className="flex items-start gap-sm">
                      <div className="flex min-w-0 flex-1 flex-col gap-xs">{children}</div>
                      {closeButton}
                    </div>
                  ) : (
                    children
                  )}
                  {action !== undefined && action !== null && <div className="mt-xs flex justify-end">{action}</div>}
                </div>
              </div>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </PopupLayerScope>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
});
