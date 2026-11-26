/**
 * Layout pieces: tabs, inspector sections and rows, the toolbar shell,
 * keyboard hints, toasts and a few small helpers.
 */
import { Collapsible } from '@base-ui/react/collapsible';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { Toast } from '@base-ui/react/toast';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { scrollStanding } from './focusables.ts';
import { guardHeldActivation } from './keys.ts';
import { TOAST_TOP_GAP_PX, toastBodyLimit, type ToastExtent } from './toast-fit.ts';

/* ---------------------------------- Tabs ---------------------------------- */

/** One tab of {@link Tabs}. */
export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  content: ReactNode;
  /** Kept rendered, hidden, while another tab is on show (its content is unmounted otherwise). */
  keepMounted?: boolean;
}

/** Props of {@link Tabs}. */
export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  className?: string;
  /** Extra controls shown at the end of the tab bar. */
  trailing?: ReactNode;
  /** The tab list's accessible name. */
  label?: string;
}

/** A tab strip with panels. */
export function Tabs<T extends string>({ value, onChange, items, className, trailing, label }: TabsProps<T>) {
  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onChange(next as T)} className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2" data-ui-tabs-bar="">
        <BaseTabs.List aria-label={label} className="relative flex items-center gap-1">
          {items.map((item) => (
            <BaseTabs.Tab
              key={item.value}
              value={item.value}
              className="h-7 rounded-md px-2 text-[13px] font-medium text-fg-muted outline-none hover:text-fg data-[active]:bg-hover data-[active]:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            >
              {item.label}
            </BaseTabs.Tab>
          ))}
        </BaseTabs.List>
        <div className="ml-auto flex items-center gap-1">{trailing}</div>
      </div>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} keepMounted={item.keepMounted} className="min-h-0 flex-1 overflow-auto outline-none">
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}

/* ------------------------------ Inspector parts ----------------------------- */

/** Props of {@link Section}. */
export interface SectionProps {
  title: ReactNode;
  children: ReactNode;
  /** Controls at the right of the heading (add, reset…). */
  actions?: ReactNode;
  /** Collapsed state is uncontrolled; start open unless `defaultOpen` is false. */
  defaultOpen?: boolean;
}

/** A collapsible group of inspector rows. Carries `data-ui-section` (its heading `data-ui-section-head`) for page styles. */
export function Section({ title, children, actions, defaultOpen = true }: SectionProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className="border-b border-line px-3 py-2" data-ui-section="">
      <div className="flex h-7 items-center gap-1" data-ui-section-head="">
        <Collapsible.Trigger className="group flex flex-1 items-center gap-1 text-left text-xs font-semibold text-fg outline-none">
          <ChevronDown className="size-3 text-fg-subtle transition-transform group-data-[panel-open]:rotate-0 -rotate-90" />
          {title}
        </Collapsible.Trigger>
        {actions}
      </div>
      <Collapsible.Panel className="flex flex-col gap-1.5 pb-1 pt-1">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** A label + control row inside a {@link Section}. Carries `data-ui-row` (its label `data-ui-row-label`) for page styles. */
export function Row({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)} data-ui-row="">
      {label !== undefined ? (
        <div className="w-16 shrink-0 truncate text-xs text-fg-muted" data-ui-row-label="">
          {label}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A floating bar (toolbars, zoom controls). */
export function Bar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-0.5 rounded-xl bg-surface p-1 shadow-popup', className)}
      {...rest}
    />
  );
}

/** A thin vertical divider for bars. */
export function BarDivider() {
  return <div className="mx-1 h-5 w-px bg-line" aria-hidden="true" />;
}

/** A keyboard key hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-fg-muted">{children}</kbd>;
}

/** A centered empty or loading state. */
export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-fg-muted">
      {icon ? <div className="text-fg-subtle">{icon}</div> : null}
      <div className="text-[15px] font-semibold text-fg">{title}</div>
      {children ? <div className="max-w-sm">{children}</div> : null}
    </div>
  );
}

/* --------------------------------- Toasts --------------------------------- */

/** The app-wide toast manager: `toast.add({ title, description })`. */
export const toast = Toast.createToastManager();

/**
 * Enter or Space on a toast's close button closes it and focus moves on:
 * until the key is released, Enter and Space must not press whatever gets
 * focus next.
 */
function guardToastClose(event: KeyboardEvent<HTMLElement>) {
  if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
  const toastElement = event.currentTarget.closest('[data-toast]') ?? event.currentTarget;
  const view = toastElement.ownerDocument.defaultView;
  if (!view) return;
  guardHeldActivation(view, event.key, (target) => target instanceof view.Node && toastElement.contains(target));
}

/**
 * A toast's text. A long one is held to its share of the room above the
 * column (see {@link useToastFit}) and scrolls, fading out at its foot while
 * there is more below; it then takes focus as a group, so keys can scroll it.
 * The close button stays outside.
 */
function ToastBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [standing, setStanding] = useState<'none' | 'more' | 'end'>('none');
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = (): void => {
      const style = getComputedStyle(node);
      const { scrollWidth, clientWidth, scrollHeight, clientHeight, scrollTop } = node;
      setStanding(scrollStanding({ scrollWidth, clientWidth, scrollHeight, clientHeight, scrollTop, overflowX: style.overflowX, overflowY: style.overflowY }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    node.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', measure);
    };
  }, []);
  return (
    <Toast.Content
      ref={ref}
      role={standing === 'none' ? undefined : 'group'}
      tabIndex={standing === 'none' ? undefined : 0}
      data-overflow={standing === 'none' ? undefined : standing}
      data-toast-body=""
      className="flex max-h-[var(--toast-fit,none)] min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[overflow=more]:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
    >
      {children}
    </Toast.Content>
  );
}

/**
 * Keeps `--toast-fit` on the column at the height each toast's text is held
 * to, so every toast stays below the top of the window. Measured again when
 * toasts come and go, change size, or the window does.
 */
function useToastFit(viewport: HTMLElement | null, toasts: readonly unknown[]): void {
  useLayoutEffect(() => {
    const view = viewport?.ownerDocument.defaultView;
    if (!viewport || !view) return undefined;
    const cards = (): HTMLElement[] => Array.from(viewport.querySelectorAll<HTMLElement>('[data-toast]'));
    const update = (): void => {
      const extents: ToastExtent[] = [];
      for (const card of cards()) {
        const body = card.querySelector<HTMLElement>('[data-toast-body]');
        if (body) extents.push({ chrome: card.offsetHeight - body.offsetHeight, content: body.scrollHeight });
      }
      const room = viewport.getBoundingClientRect().bottom - TOAST_TOP_GAP_PX;
      const limit = toastBodyLimit(extents, room, parseFloat(view.getComputedStyle(viewport).rowGap) || 0);
      const value = limit === null ? 'none' : `${limit}px`;
      if (viewport.style.getPropertyValue('--toast-fit') !== value) viewport.style.setProperty('--toast-fit', value);
    };
    update();
    const observer = new ResizeObserver(update);
    for (const card of cards()) {
      observer.observe(card);
      const body = card.querySelector('[data-toast-body]');
      if (body) for (const part of body.children) observer.observe(part);
    }
    view.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      view.removeEventListener('resize', update);
    };
  }, [viewport, toasts]);
}

function ToastList({ viewport }: { viewport: HTMLElement | null }) {
  const { toasts } = Toast.useToastManager();
  useToastFit(viewport, toasts);
  return toasts.map((item) => (
    <Toast.Root
      key={item.id}
      toast={item}
      data-toast=""
      className="pointer-events-auto flex w-80 items-start gap-3 rounded-lg bg-surface p-3 text-fg shadow-popup transition-[opacity,transform] data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0"
    >
      <ToastBody>
        <Toast.Title className="text-[13px] font-semibold" />
        <Toast.Description className="text-xs text-fg-muted" />
        {item.actionProps ? (
          <Toast.Action className="mt-1 self-start rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-hover" />
        ) : null}
      </ToastBody>
      <Toast.Close aria-label="Dismiss" onKeyDown={guardToastClose} className="rounded p-0.5 text-fg-muted hover:bg-hover">
        <X className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  ));
}

/** Mount once near the app root to show toasts. */
export function Toaster({ children }: { children?: ReactNode }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <Toast.Provider toastManager={toast} timeout={4000}>
      {children}
      <Toast.Portal>
        <Toast.Viewport ref={setViewport} className="pointer-events-none fixed bottom-4 right-4 z-[1100] flex flex-col gap-2">
          <ToastList viewport={viewport} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
