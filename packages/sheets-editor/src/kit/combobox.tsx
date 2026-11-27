import * as React from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { cn } from './cn.ts';
import { Badge } from './badge.tsx';
import { Icon, LeadingIcon, type IconName } from './icon.tsx';
import { useKitLabel } from './labels.tsx';
import { useOverlayLayer } from './layers.tsx';
import { MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES } from './menu.tsx';
import { POPUP_MOTION_CLASSES, POPUP_SCROLL_ATTRIBUTE, POPUP_SURFACE_CLASSES, PopupLayerScope } from './popup-frame.tsx';

const NO_AUTOFILL_PROPS = { autoComplete: 'off' } as const;

const POPUP_SEARCH_CLASSES =
  '-mx-[var(--ui-menu-gutter,0.25rem)] -mt-[var(--ui-menu-gutter,0.25rem)] mb-1 block w-[calc(100%+2*var(--ui-menu-gutter,0.25rem))] shrink-0 ui-reset bg-transparent border-0 border-b border-b-[var(--ui-border)] outline-none px-[calc(var(--ui-pad-md)+var(--ui-menu-gutter,0.25rem))] py-2 text-body text-primary placeholder:text-muted';
const LIST_CLASSES =
  'ui-reset min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-fade-y outline-none max-h-[var(--ui-popup-list-max-h,none)]';
const ITEM_CLASSES = `ui-reset group/cbx-item flex w-full items-center gap-2 min-h-control px-md py-1 rounded-[var(--ui-radius)] text-body font-normal font-control text-primary text-start select-none outline-none focus-visible:outline-hidden data-[highlighted]:bg-fill-ghost-hover ${MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES} data-[disabled]:opacity-disabled data-[disabled]:pointer-events-none`;
const GROUP_LABEL_CLASSES = 'px-md pt-2 pb-1 text-footnote font-medium text-muted select-none';
const SEPARATOR_CLASSES = 'mx-pad-md my-1 h-px shrink-0 bg-[var(--ui-menu-line)]';
const FOOTER_DIVIDER_CLASSES = 'mx-pad-md mt-1 h-px shrink-0 bg-[var(--ui-menu-line)]';
const EMPTY_CLASSES = 'empty:hidden px-md py-2 text-body text-muted';
const FOOTER_ACTION_CLASSES =
  'ui-reset flex w-full items-center gap-2 min-h-control px-md rounded-[var(--ui-radius)] text-body font-normal font-control text-primary text-start select-none outline-none focus-visible:outline-hidden hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover disabled:opacity-disabled disabled:pointer-events-none';
const TRIGGER_CLASSES =
  'ui-reset group/cbx flex min-w-0 items-center gap-1.5 h-control ps-sm pe-[var(--ui-pad-xs)] rounded-control border border-default bg-fill-field text-body font-normal font-control text-primary text-start outline-none transition-shadow duration-fast hover:border-strong focus-visible:shadow-focus data-[popup-open]:shadow-focus data-[disabled]:opacity-disabled data-[disabled]:pointer-events-none';
const POPUP_CLASSES = `${POPUP_SURFACE_CLASSES} ${POPUP_MOTION_CLASSES} flex flex-col min-w-[var(--anchor-width)] max-w-[min(var(--available-width),360px)] max-h-[min(var(--available-height,100dvh),var(--ui-popup-max-h,320px))] p-[var(--ui-menu-gutter)]`;

const syntheticKeydowns = new WeakSet<Event>();

/** Space on a focused list picks the highlighted option, as Enter does. */
function selectOptionOnSpace(event: React.KeyboardEvent<HTMLDivElement>): void {
  const list = event.currentTarget;
  if (
    event.key !== ' ' ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.target !== list ||
    event.isPropagationStopped() ||
    list.getAttribute('aria-readonly') === 'true' ||
    !list.getAttribute('aria-activedescendant')
  )
    return;
  const win = list.ownerDocument.defaultView;
  if (win === null) return;
  const enter = new win.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  syntheticKeydowns.add(enter);
  event.preventDefault();
  event.stopPropagation();
  list.dispatchEvent(enter);
}

/** The root of a combobox built from parts; see `Combobox` for a ready-made one. */
function ComboboxRoot<Value, Multiple extends boolean | undefined = false, Item = Value>(
  props: BaseCombobox.Root.Props<Value, Multiple, Item>,
): React.ReactElement {
  return <BaseCombobox.Root {...props} />;
}

export type ComboboxPopupSearchProps = BaseCombobox.Input.Props;

/** The search field at the top of a combobox list. */
const ComboboxPopupSearch = React.forwardRef<HTMLInputElement, ComboboxPopupSearchProps>(function ComboboxPopupSearch({ className, ...rest }, ref) {
  return <BaseCombobox.Input ref={ref} {...NO_AUTOFILL_PROPS} {...rest} className={cn(POPUP_SEARCH_CLASSES, className as string | undefined)} />;
});

export type ComboboxListProps = BaseCombobox.List.Props;

const ComboboxList = React.forwardRef<HTMLDivElement, ComboboxListProps>(function ComboboxList({ className, onKeyDown, ...rest }, ref) {
  return (
    <BaseCombobox.List
      ref={ref}
      {...{ [POPUP_SCROLL_ATTRIBUTE]: '' }}
      {...rest}
      onKeyDown={(event) => {
        if (!syntheticKeydowns.has(event.nativeEvent)) onKeyDown?.(event);
        selectOptionOnSpace(event);
      }}
      className={cn(LIST_CLASSES, className as string | undefined)}
    />
  );
});

export interface ComboboxItemProps extends Omit<BaseCombobox.Item.Props, 'className'> {
  icon?: IconName | React.ReactNode;
  description?: React.ReactNode;
  labelDir?: 'auto';
  className?: string;
}

const ComboboxItem = React.forwardRef<HTMLDivElement, ComboboxItemProps>(function ComboboxItem(
  { icon, description, labelDir, className, children, ...rest },
  ref,
) {
  const hasDescription = description !== undefined && description !== null && description !== false && description !== '';
  return (
    <BaseCombobox.Item ref={ref} {...rest} className={cn(ITEM_CLASSES, className)}>
      {icon !== undefined && icon !== null && <LeadingIcon icon={icon} firstLine={hasDescription} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir={labelDir} className="truncate">
          {children}
        </span>
        {hasDescription && <span className="whitespace-normal break-words text-footnote leading-snug text-muted">{description}</span>}
      </div>
      <BaseCombobox.ItemIndicator className={cn('shrink-0 text-[var(--ui-text-accent)]', hasDescription && 'flex h-[1lh] items-center self-start')}>
        <Icon name="Check" size="md" bold />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  );
});

export type ComboboxGroupProps = BaseCombobox.Group.Props;

const ComboboxGroup = React.forwardRef<HTMLDivElement, ComboboxGroupProps>(function ComboboxGroup(props, ref) {
  return <BaseCombobox.Group ref={ref} {...props} />;
});

export type ComboboxGroupLabelProps = BaseCombobox.GroupLabel.Props;

const ComboboxGroupLabel = React.forwardRef<HTMLDivElement, ComboboxGroupLabelProps>(function ComboboxGroupLabel({ className, ...rest }, ref) {
  return <BaseCombobox.GroupLabel ref={ref} {...rest} className={cn(GROUP_LABEL_CLASSES, className as string | undefined)} />;
});

function ComboboxSeparator({ className }: { className?: string }): React.ReactElement {
  return <BaseCombobox.Separator data-ui-part="separator" className={cn(SEPARATOR_CLASSES, className)} />;
}

/** Rows under the list, after a divider: actions that are not options. */
function ComboboxFooter({ className, children }: { className?: string; children?: React.ReactNode }): React.ReactElement {
  return (
    <>
      <div aria-hidden className={FOOTER_DIVIDER_CLASSES} />
      <div className={cn('shrink-0 pt-1', className)}>{children}</div>
    </>
  );
}

export interface ComboboxFooterActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
}

const ComboboxFooterAction = React.forwardRef<HTMLButtonElement, ComboboxFooterActionProps>(function ComboboxFooterAction(
  { icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} {...rest} className={cn(FOOTER_ACTION_CLASSES, className)}>
      {icon !== undefined && <LeadingIcon icon={<Icon name={icon} size="auto" className="text-muted" />} />}
      {children}
    </button>
  );
});

export type ComboboxEmptyProps = BaseCombobox.Empty.Props;

const ComboboxEmpty = React.forwardRef<HTMLDivElement, ComboboxEmptyProps>(function ComboboxEmpty({ className, children, ...rest }, ref) {
  const noResults = useKitLabel('noResults');
  return (
    <BaseCombobox.Empty ref={ref} {...rest} className={cn(EMPTY_CLASSES, className as string | undefined)}>
      {children === undefined ? noResults : children}
    </BaseCombobox.Empty>
  );
});

/** One choice of a ready-made combobox. */
export interface ComboboxOption<V extends string = string> {
  value: V;
  label: string;
  description?: React.ReactNode;
  /** A caption shown over this option, starting a group. */
  groupLabelBefore?: React.ReactNode;
  disabled?: boolean;
  icon?: IconName | React.ReactNode;
}

export interface ComboboxProps<V extends string = string> {
  items: readonly ComboboxOption<V>[];
  value: V | null | undefined;
  onChange: (value: V | null) => void;
  /** Shows a search field over the options; by default when there are more than five. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when the search matches nothing. */
  emptyMessage?: React.ReactNode;
  /** Whether an option matches what was typed; by default its label or value contains it, ignoring case. */
  filter?: (item: ComboboxOption<V>, query: string) => boolean;
  autoHighlight?: boolean;
  /** Text on the field when nothing is chosen. */
  placeholder?: string;
  align?: 'start' | 'center' | 'end';
  /** Stretches the field to the width of its container. */
  fullWidth?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}

function foldForSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function optionMatches<V extends string>(item: ComboboxOption<V>, query: string): boolean {
  const folded = foldForSearch(query.trim());
  return foldForSearch(item.label).includes(folded) || foldForSearch(item.value).includes(folded);
}

const optionLabel = <V extends string>(item: ComboboxOption<V>): string => item.label;
const optionValue = <V extends string>(item: ComboboxOption<V>): string => item.value;
const sameOption = <V extends string>(item: ComboboxOption<V>, other: ComboboxOption<V>): boolean => item.value === other.value;

/** A field that opens a list of options to choose one from, with an optional search. */
function ComboboxField<V extends string = string>({
  items,
  value,
  onChange,
  searchable,
  searchPlaceholder,
  emptyMessage,
  filter,
  autoHighlight,
  placeholder,
  align = 'start',
  fullWidth = true,
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  className,
}: ComboboxProps<V>): React.ReactElement {
  const layer = useOverlayLayer('combobox');
  const isSearchable = searchable ?? items.length > 5;
  const selected = React.useMemo(() => items.find((item) => item.value === value) ?? null, [items, value]);
  const matches = filter ?? optionMatches;
  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  // Without a search field the list takes focus, so arrows, Enter and Space work on it; a touch focuses the popup instead.
  const focusList = React.useCallback(
    (openType: string): HTMLElement | null => (openType === 'touch' ? popupRef.current : listRef.current),
    [],
  );

  return (
    <BaseCombobox.Root<ComboboxOption<V>>
      items={items}
      value={selected}
      onValueChange={(item) => onChange(item === null ? null : item.value)}
      itemToStringLabel={optionLabel}
      itemToStringValue={optionValue}
      isItemEqualToValue={sameOption}
      filter={isSearchable ? (item, query) => matches(item, query) : null}
      autoHighlight={autoHighlight ?? !isSearchable}
      disabled={disabled}
    >
      <BaseCombobox.Trigger
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        className={cn(TRIGGER_CLASSES, fullWidth ? 'w-full' : 'w-fit max-w-full', className)}
      >
        <span className={cn('min-w-0 flex-1 truncate', selected === null && 'text-muted')}>{selected?.label ?? placeholder}</span>
        <Icon name="CaretDown" size="auto" className="shrink-0 text-muted" />
      </BaseCombobox.Trigger>
      <BaseCombobox.Portal>
        <PopupLayerScope layer={layer}>
          <BaseCombobox.Positioner className="data-[anchor-hidden]:invisible" style={layer.style} align={align} sideOffset={4}>
            <BaseCombobox.Popup ref={popupRef} data-ui="Combobox" initialFocus={isSearchable ? undefined : focusList} className={POPUP_CLASSES}>
              {isSearchable && <ComboboxPopupSearch placeholder={searchPlaceholder} aria-label={searchPlaceholder ?? ariaLabel} />}
              <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
              <ComboboxList ref={listRef}>
                {(item: ComboboxOption<V>) => (
                  <React.Fragment key={item.value}>
                    {item.groupLabelBefore !== undefined && (
                      <div role="presentation" className={GROUP_LABEL_CLASSES}>
                        {item.groupLabelBefore}
                      </div>
                    )}
                    <ComboboxItem value={item} disabled={item.disabled} icon={item.icon} description={item.description}>
                      {item.label}
                    </ComboboxItem>
                  </React.Fragment>
                )}
              </ComboboxList>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </PopupLayerScope>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}

const CHIPS_FIELD_CLASSES =
  'ui-reset flex min-w-0 w-full items-center gap-1.5 min-h-control ps-[var(--ui-pad-xs)] pe-[var(--ui-pad-xs)] py-[calc((var(--ui-h-control)-var(--ui-h-control-nested))/2-1px)] rounded-control border border-default bg-fill-field text-body font-normal font-control text-primary cursor-text transition-shadow duration-fast hover:border-strong focus-within:shadow-focus data-[disabled]:opacity-disabled data-[disabled]:pointer-events-none data-[invalid]:border-[color:var(--ui-text-danger)]';
const CHIPS_CLASSES = 'flex min-w-0 flex-1 flex-wrap items-center gap-1';
const CHIP_CLASSES = 'max-w-full min-w-0 outline-none data-[highlighted]:shadow-focus';
const CHIPS_INPUT_CLASSES =
  'ui-reset h-control-nested min-w-[6ch] flex-1 bg-transparent border-0 outline-none px-1 text-body text-primary placeholder:text-muted';
const CHIP_REMOVE_CLASSES =
  'ui-reset -me-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted hover:text-primary cursor-default';
const STATUS_CLASSES = 'empty:hidden px-md py-2 text-body text-muted';

/** Enter held down does not pick and unpick the highlighted option again and again. */
function preventRepeatedEnterKeydown(event: React.KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter' && event.repeat) event.preventDefault();
}

export interface MultiComboboxProps<V extends string = string> {
  multiple: true;
  /** The picks show as chips inside the field, with the search typed after them. */
  triggerMode: 'chips';
  /** Chips wrap onto more lines as they are added. */
  chipsOverflow?: 'wrap';
  items: readonly ComboboxOption<V>[];
  value: readonly V[];
  onChange: (value: V[]) => void;
  onOpenChange?: (open: boolean) => void;
  /** Called as the search changes, for options that come from elsewhere. */
  onInputChange?: (text: string) => void;
  /** Whether an option matches what was typed; by default its label or value contains it, ignoring case. */
  filter?: (item: ComboboxOption<V>, query: string) => boolean;
  /** Options are still being found; the list says so while it has none. */
  isLoading?: boolean;
  emptyMessage?: React.ReactNode;
  /** Text in the field while nothing is picked. */
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}

/**
 * A field to pick several options from, shown as removable chips, with a search typed after them.
 * A picked option that is disabled stays picked; picking keeps the list open and clears the search.
 */
function MultiComboboxField<V extends string = string>({
  items,
  value,
  onChange,
  onOpenChange,
  onInputChange,
  filter,
  isLoading = false,
  emptyMessage,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  className,
}: MultiComboboxProps<V>): React.ReactElement {
  const layer = useOverlayLayer('combobox');
  const loadingOptions = useKitLabel('loadingOptions');
  const removeLabel = useKitLabel('removeItem', { item: '{item}' });
  const matches = filter ?? optionMatches;
  const itemsByValue = React.useMemo(() => new Map(items.map((item) => [item.value, item])), [items]);
  const selected = React.useMemo(
    () => value.flatMap((picked) => itemsByValue.get(picked) ?? []),
    [value, itemsByValue],
  );
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const chipsRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const shownCount = React.useMemo(() => items.filter((item) => matches(item, query)).length, [items, matches, query]);

  const changeValue = (next: ComboboxOption<V>[], details: BaseCombobox.Root.ChangeEventDetails): void => {
    // Escape closes the list (and lets a dialog around it close), not the picks.
    if (details.reason === 'escape-key') {
      details.cancel();
      details.allowPropagation();
      return;
    }
    // A held Backspace removes one chip, not all of them.
    const event = details.event;
    if (event instanceof KeyboardEvent && event.key === 'Backspace' && event.repeat && event.target instanceof HTMLInputElement) {
      details.cancel();
      return;
    }
    let picks = next;
    const values = new Set(next.map((item) => item.value));
    const kept = selectedRef.current.filter((item) => item.disabled === true && !values.has(item.value));
    if (kept.length > 0) {
      picks = [...next, ...kept];
      const current = new Set(valueRef.current);
      if (picks.length === current.size && picks.every((item) => current.has(item.value))) return;
    }
    onChange(picks.map((item) => item.value));
  };

  return (
    <BaseCombobox.Root<ComboboxOption<V>, true>
      multiple
      items={items}
      value={selected}
      onValueChange={changeValue}
      onInputValueChange={(text) => {
        setQuery(text);
        onInputChange?.(text);
      }}
      open={open}
      onOpenChange={(isOpen, details) => {
        // Enter that closes the list does not reach a form or dialog around it.
        if (!isOpen && details.reason === 'none' && details.event instanceof KeyboardEvent && details.event.key === 'Enter') {
          details.event.preventDefault();
        }
        setOpen(isOpen);
        onOpenChange?.(isOpen);
      }}
      itemToStringLabel={optionLabel}
      itemToStringValue={optionValue}
      isItemEqualToValue={sameOption}
      filter={(item, query) => matches(item, query)}
      disabled={disabled}
    >
      <div
        data-ui="ComboboxChips"
        data-disabled={disabled || undefined}
        className={cn(CHIPS_FIELD_CLASSES, className)}
        onClick={(event) => {
          if (disabled === true || open || event.target !== event.currentTarget) return;
          event.preventDefault();
          inputRef.current?.focus();
          setOpen(true);
          onOpenChange?.(true);
        }}
      >
        <BaseCombobox.Chips ref={chipsRef} className={CHIPS_CLASSES}>
          {selected.map((item) => (
            <BaseCombobox.Chip key={item.value} className={CHIP_CLASSES} render={<Badge variant="neutral" className="min-w-0" />}>
              <span className="min-w-0 truncate">{item.label}</span>
              {item.disabled !== true && (
                <BaseCombobox.ChipRemove
                  nativeButton={false}
                  render={<span />}
                  aria-label={removeLabel.replace('{item}', item.label)}
                  onClick={(event) => event.preventDefault()}
                  className={CHIP_REMOVE_CLASSES}
                >
                  <Icon name="X" size="xs" />
                </BaseCombobox.ChipRemove>
              )}
            </BaseCombobox.Chip>
          ))}
          <BaseCombobox.Input
            ref={inputRef}
            {...NO_AUTOFILL_PROPS}
            className={cn(CHIPS_INPUT_CLASSES, selected.length > 0 && 'w-0')}
            placeholder={selected.length === 0 ? placeholder : undefined}
            disabled={disabled}
            onKeyDown={preventRepeatedEnterKeydown}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-describedby={ariaDescribedby}
          />
        </BaseCombobox.Chips>
      </div>
      <BaseCombobox.Portal>
        <PopupLayerScope layer={layer}>
          <BaseCombobox.Positioner
            className="data-[anchor-hidden]:invisible"
            style={layer.style}
            anchor={chipsRef}
            align="start"
            sideOffset={4}
          >
            <BaseCombobox.Popup data-ui="Combobox" aria-busy={isLoading || undefined} className={POPUP_CLASSES}>
              <ComboboxEmpty>{isLoading ? null : emptyMessage}</ComboboxEmpty>
              <ComboboxList>
                {(item: ComboboxOption<V>) => (
                  <ComboboxItem key={item.value} value={item} disabled={item.disabled} icon={item.icon} description={item.description}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
              <BaseCombobox.Status className={STATUS_CLASSES}>{isLoading && shownCount === 0 ? loadingOptions : null}</BaseCombobox.Status>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </PopupLayerScope>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}

ComboboxPopupSearch.displayName = 'Combobox.PopupSearch';
ComboboxList.displayName = 'Combobox.List';
ComboboxItem.displayName = 'Combobox.Item';
ComboboxGroup.displayName = 'Combobox.Group';
ComboboxGroupLabel.displayName = 'Combobox.GroupLabel';
ComboboxFooterAction.displayName = 'Combobox.FooterAction';
ComboboxEmpty.displayName = 'Combobox.Empty';

MultiComboboxField.displayName = 'MultiCombobox';

export {
  MultiComboboxField as MultiCombobox,
  ComboboxRoot,
  ComboboxPopupSearch,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxSeparator,
  ComboboxFooter,
  ComboboxFooterAction,
  ComboboxEmpty,
};

/** A ready-made combobox, with the parts to build one inline. */
export const Combobox = Object.assign(ComboboxField, {
  Root: ComboboxRoot,
  PopupSearch: ComboboxPopupSearch,
  List: ComboboxList,
  Item: ComboboxItem,
  Group: ComboboxGroup,
  GroupLabel: ComboboxGroupLabel,
  Separator: ComboboxSeparator,
  Footer: ComboboxFooter,
  FooterAction: ComboboxFooterAction,
  Empty: ComboboxEmpty,
});
