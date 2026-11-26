import * as React from 'react';
import { Button } from './button.tsx';
import { cn } from './cn.ts';
import { isComposingKey } from '@open-artifact/ui';

export type ChatComposerForm = 'default' | 'reply';

export interface ChatComposerEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Lines the box shows when empty; it grows with the text up to `maxHeight`. */
  minLines?: number;
  maxHeight?: string;
  /** Accepted for existing callers; the box never takes focus on its own. */
  skipAutofocus?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  /** Enter sends; Shift+Enter and Alt+Enter start a new line. */
  onSubmit?: (value: string) => void;
  onKeyDownCapture?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  className?: string;
}

export interface ChatComposerEditorHandle {
  focus: () => void;
  getElement: () => HTMLTextAreaElement | null;
}

export interface ChatComposerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'className'> {
  editor: ChatComposerEditorProps;
  editorRef?: React.Ref<ChatComposerEditorHandle>;
  /** Waiting on an answer: the send button turns into a stop button. */
  busy?: boolean;
  /** A reply box sits inside a conversation and sends with a quieter button. */
  form?: ChatComposerForm;
  className?: string;
  cardClassName?: string;
  children?: React.ReactNode;
}

interface ComposerState {
  busy: boolean;
  form: ChatComposerForm;
}

const ComposerStateContext = React.createContext<ComposerState>({ busy: false, form: 'default' });

function insertNewLine(textarea: HTMLTextAreaElement, onChange: (value: string) => void): void {
  const { selectionStart, selectionEnd } = textarea;
  textarea.setRangeText('\n', selectionStart, selectionEnd, 'end');
  onChange(textarea.value);
}

const ChatComposerRoot = React.forwardRef<HTMLDivElement, ChatComposerProps>(function ChatComposer(
  { editor, editorRef, busy = false, form = 'default', className, cardClassName, children, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby, ...props },
  ref,
) {
  const { value, onChange, placeholder, minLines = 1, maxHeight, readOnly, disabled, onSubmit, onKeyDownCapture } = editor;
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useImperativeHandle(
    editorRef,
    () => ({
      focus: () => textareaRef.current?.focus(),
      getElement: () => textareaRef.current,
    }),
    [],
  );

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  const state = React.useMemo(() => ({ busy, form }), [busy, form]);

  return (
    <ComposerStateContext.Provider value={state}>
      <div ref={ref} role="group" data-ui="ChatComposer" aria-busy={busy || undefined} {...props} className={cn('min-w-0', className)}>
        <div
          className={cn(
            'flex min-w-0 items-end gap-xs rounded-panel bg-fill-field p-0.5 shadow-field-ring transition-shadow duration-fast [&:not(:focus-within)]:hover:shadow-field-hover focus-within:shadow-focus',
            cardClassName,
          )}
        >
          <textarea
            ref={textareaRef}
            data-ui="ChatComposerEditor"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            rows={minLines}
            value={value}
            placeholder={placeholder}
            readOnly={readOnly}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDownCapture={onKeyDownCapture}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.defaultPrevented || event.currentTarget.readOnly || onSubmit === undefined || event.shiftKey) return;
              const plain = !event.altKey && !event.metaKey && !event.ctrlKey;
              if (plain || !isComposingKey(event.nativeEvent)) event.preventDefault();
              if (isComposingKey(event.nativeEvent)) return;
              if (event.altKey) {
                insertNewLine(event.currentTarget, onChange);
                return;
              }
              if (!event.repeat) onSubmit(event.currentTarget.value);
            }}
            style={{ maxHeight }}
            className={cn(
              'ui-input-bare block min-h-[calc(var(--ui-h-control))] w-full min-w-0 flex-1 resize-none overflow-y-auto break-words py-[calc((var(--ui-h-control)-1lh)/2)] ps-sm pe-[var(--ui-pad-xs)]',
              'text-[length:var(--cmp-font-size,var(--ui-font-size-body))] leading-snug text-primary placeholder:text-muted disabled:opacity-disabled',
              editor.className,
            )}
          />
          {children}
        </div>
      </div>
    </ComposerStateContext.Provider>
  );
});

export interface ChatComposerActionsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  /** The send or stop button, placed last. */
  send?: React.ReactNode;
  className?: string;
}

const ChatComposerActions = React.forwardRef<HTMLDivElement, ChatComposerActionsProps>(function ChatComposerActions(
  { send, className, children, ...props },
  ref,
) {
  return (
    <div ref={ref} data-ui="ChatComposerActions" {...props} className={cn('flex shrink-0 items-center gap-0.5 self-end', className)}>
      {children}
      {send}
    </div>
  );
});

export type ChatComposerActionState = 'idle' | 'busy';

export interface ChatComposerPrimaryActionProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  state: ChatComposerActionState;
  sendLabel: string;
  stopLabel: string;
  onSend: () => void;
  onStop?: () => void;
  className?: string;
}

/** The send button, or the stop button while an answer is awaited. Its ref is the wrapper around the button. */
const ChatComposerPrimaryAction = React.forwardRef<HTMLDivElement, ChatComposerPrimaryActionProps>(function ChatComposerPrimaryAction(
  { state, sendLabel, stopLabel, onSend, onStop, className, ...props },
  ref,
) {
  const { form } = React.useContext(ComposerStateContext);
  return (
    <div ref={ref} data-ui="ChatComposerPrimaryAction" {...props} className={cn('flex cursor-default items-center', className)}>
      {state === 'idle' ? (
        <Button
          variant={form === 'reply' ? 'ghost' : 'primary'}
          iconOnly
          icon="ArrowUp"
          aria-label={sendLabel}
          onClick={() => onSend()}
        />
      ) : (
        <Button variant="ghost" iconOnly icon="StopFilled" aria-label={stopLabel} onClick={() => onStop?.()} />
      )}
    </div>
  );
});

/** A box for writing a prompt, with a send button. */
export const ChatComposer = Object.assign(ChatComposerRoot, {
  Actions: ChatComposerActions,
  PrimaryAction: ChatComposerPrimaryAction,
});
