import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, Copy } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { IconButton, cn, toast, isComposingKey } from '@open-artifact/ui';
import { getHighlightedPieces, getPlaceholderName, isHighlightableLang, type CodeKind, type CodePiece, type CodeReading } from './sql.ts';
import { COPIED_LABEL, COPY_FAILED_MESSAGE, SHOW_LESS_LABEL, SHOW_MORE_LABEL } from './words.ts';

export const CODE_KIND_CLASSES: Readonly<Record<CodeKind, string>> = {
  keyword: 'text-accent',
  function: 'text-accent',
  string: 'text-success',
  number: 'text-warning',
  comment: 'italic text-fg-subtle',
  placeholder: 'rounded bg-accent/15 text-accent',
};

export const CODE_BOX_CLASS = 'rounded-control border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs leading-5 text-fg';

/** Draws a placeholder (`{{name}}`) in its own way, e.g. with the filter's value in a tooltip. */
export type PlaceRenderer = (name: string, index: number) => ReactNode;

/** Copies text; says so when it can't. Resolves whether it was copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.add({ title: COPY_FAILED_MESSAGE });
    return false;
  }
}

/** Runs `run` on Cmd/Ctrl+Enter (not while composing); true when it did. */
export function runOnModEnter(event: KeyboardEvent, run: () => void): boolean {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || isComposingKey(event.nativeEvent)) return false;
  event.preventDefault();
  run();
  return true;
}

export function blurOnEscape(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  event.currentTarget.blur();
}

export function HighlightedCodePieces({ pieces, place }: { pieces: readonly CodePiece[]; place?: PlaceRenderer }): ReactElement {
  return (
    <>
      {pieces.map((piece, index) => {
        if (piece.kind === undefined) return piece.text;
        if (piece.kind === 'placeholder' && place !== undefined) {
          const name = getPlaceholderName(piece.text);
          if (name !== undefined) return <span key={index}>{place(name, index)}</span>;
        }
        return (
          <span key={index} data-kind={piece.kind} className={CODE_KIND_CLASSES[piece.kind]}>
            {piece.text}
          </span>
        );
      })}
    </>
  );
}

export interface HighlightedCodeProps extends CodeReading {
  code: string;
  /** SQL is laid out one clause (and select column) per line. */
  laidOut?: boolean;
  place?: PlaceRenderer;
}

/** Code coloured by its language; `{{param}}` placeholders marked on their own. */
export function HighlightedCode({ code, lang, quotes, laidOut = false, place }: HighlightedCodeProps): ReactElement {
  const pieces = useMemo(
    () => getHighlightedPieces(code, { lang, ...(quotes === undefined ? {} : { quotes }) }, { laidOut, placeholders: place !== undefined }),
    [code, lang, quotes, laidOut, place],
  );
  return pieces === null ? <>{code}</> : <HighlightedCodePieces pieces={pieces} {...(place === undefined ? {} : { place })} />;
}

/** A copy button: a check for a moment once copied. */
export function CopyButton({ text, label }: { text: string | (() => string); label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      size="sm"
      label={copied ? COPIED_LABEL : label}
      aria-label={label}
      icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      onClick={() =>
        void copyText(typeof text === 'string' ? text : text()).then((done) => {
          setCopied(done);
          if (done) announce(COPIED_LABEL);
        })
      }
    />
  );
}

export interface LabeledFieldProps {
  label: ReactNode;
  htmlFor?: string;
  note?: ReactNode;
  /** Buttons at the end of the label's line. */
  end?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function LabeledField({ label, htmlFor, note, end, children, className }: LabeledFieldProps): ReactElement {
  const Label = htmlFor === undefined ? 'span' : 'label';
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-h-6 items-center gap-1">
        <Label htmlFor={htmlFor} className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
          {label}
        </Label>
        {end}
      </div>
      {children}
      {note === undefined || note === '' ? null : <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">{note}</p>}
    </div>
  );
}

function useOverflows(ref: RefObject<HTMLElement | null>, watch: unknown): boolean {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const check = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, watch]);
  return overflows;
}

/** A description clamped to three lines, with Show more. */
export function ExpandableDescription({ text }: { text: string }): ReactElement {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overflows = useOverflows(ref, text);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <p ref={ref} className={cn('whitespace-pre-line text-[13px] text-fg-muted [overflow-wrap:anywhere]', !expanded && 'line-clamp-3')}>
        {text}
      </p>
      {overflows || expanded ? (
        <button type="button" className="text-xs text-accent hover:underline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? SHOW_LESS_LABEL : SHOW_MORE_LABEL}
        </button>
      ) : null}
    </div>
  );
}

export interface CollapsibleCodeBlockProps {
  /** The region's name. */
  label: string;
  /** Long lines scroll sideways instead of wrapping. */
  unwrapped?: boolean;
  /** Buttons in the block's top corner. */
  corner?: ReactNode;
  children: ReactNode;
}

const COLLAPSED_CODE_HEIGHT = '10rem';

/** A code block cut to its first lines, with Show more. */
export function CollapsibleCodeBlock({ label, unwrapped = false, corner, children }: CollapsibleCodeBlockProps): ReactElement {
  const ref = useRef<HTMLPreElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overflows = useOverflows(ref, children);
  return (
    <div className="relative flex min-w-0 flex-col items-start gap-0.5">
      <pre
        ref={ref}
        tabIndex={0}
        role="region"
        aria-label={label}
        style={expanded ? undefined : { maxHeight: COLLAPSED_CODE_HEIGHT }}
        className={cn(
          CODE_BOX_CLASS,
          'm-0 w-full min-w-0 overflow-x-auto overflow-y-hidden outline-none focus-visible:outline-2 focus-visible:outline-accent',
          unwrapped ? 'whitespace-pre' : 'whitespace-pre-wrap [overflow-wrap:anywhere]',
          corner !== undefined && 'pr-9',
        )}
      >
        {children}
      </pre>
      {corner === undefined ? null : <span className="absolute right-1 top-1 flex items-center">{corner}</span>}
      {overflows || expanded ? (
        <button type="button" className="text-xs text-accent hover:underline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? SHOW_LESS_LABEL : SHOW_MORE_LABEL}
        </button>
      ) : null}
    </div>
  );
}

export interface HighlightedCodeInputProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string;
  reading: CodeReading;
  invalid?: boolean;
  /** Placeholders are coloured in a text argument too. */
  tinted?: boolean;
}

/** A code text area, coloured while it isn't being typed in. */
export function HighlightedCodeInput({ value, reading, invalid = false, tinted = false, className, onFocus, onBlur, onScroll, ...rest }: HighlightedCodeInputProps): ReactElement {
  const [focused, setFocused] = useState(false);
  const overlayRef = useRef<HTMLPreElement | null>(null);
  const colours = !focused && (isHighlightableLang(reading.lang) || tinted);
  const pieces = useMemo(() => (colours ? getHighlightedPieces(value, reading, { placeholders: true }) : null), [colours, value, reading]);
  const shared = 'm-0 whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-xs leading-5';
  return (
    <div className="relative min-w-0">
      {pieces === null ? null : (
        <pre ref={overlayRef} aria-hidden className={cn(shared, 'pointer-events-none absolute inset-0 overflow-hidden border border-transparent text-fg')}>
          <HighlightedCodePieces pieces={pieces} />
          {'\n'}
        </pre>
      )}
      <textarea
        {...rest}
        value={value}
        aria-invalid={invalid || undefined}
        className={cn(
          shared,
          'block w-full resize-y rounded-control border bg-surface-2 outline-none focus-visible:border-accent',
          invalid ? 'border-danger' : 'border-line',
          pieces === null ? 'text-fg' : 'text-transparent caret-fg',
          className,
        )}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onScroll={(event) => {
          if (overlayRef.current !== null) overlayRef.current.scrollTop = event.currentTarget.scrollTop;
          onScroll?.(event);
        }}
      />
    </div>
  );
}
