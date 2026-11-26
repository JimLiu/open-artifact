/** The code block's language button and its filterable list: auto-detect, plain text and each language. */
import { ChromePopover } from '@open-artifact/editor-kit/react';
import { cn, isComposingKey } from '@open-artifact/ui';
import { Check, ChevronDown } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useMemo, useState } from 'react';
import { filterLanguages, findLanguage } from './languages.ts';

/** Most of the list shows before it scrolls. */
const LIST_MAX_HEIGHT = 304;

interface Choice {
  key: string | null;
  label: string;
}

export interface LanguagePickerProps {
  /** What the button reads, e.g. `Python` or `auto (Python)`. */
  shown: string;
  /** The stored language (null for auto). */
  language: string | null;
  disabled: boolean;
  onPick(language: string | null): void;
  onClose(): void;
}

export function LanguagePicker({ shown, language, disabled, onPick, onClose }: LanguagePickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const current = findLanguage(language)?.key ?? (language ? language : null);
  const choices = useMemo<Choice[]>(() => {
    const languages = filterLanguages(query).map(item => ({ key: item.key, label: item.label }));
    const auto = !query.trim() || 'auto'.startsWith(query.trim().toLowerCase());
    return auto ? [{ key: null, label: 'auto' }, ...languages] : languages;
  }, [query]);

  const change = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(Math.max(0, [{ key: null }, ...filterLanguages('')].findIndex(item => item.key === current)));
    } else onClose();
  };
  const pick = (choice: Choice | undefined) => {
    if (!choice) return;
    setOpen(false);
    onPick(choice.key);
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (isComposingKey(event.nativeEvent)) return;
      pick(choices[active]);
      return;
    }
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(index => (choices.length ? (index + step + choices.length) % choices.length : 0));
    }
  };

  const button = (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${shown}, language`}
      title={disabled ? undefined : 'Set language'}
      className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px] text-chrome-muted outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:outline-2 focus-visible:outline-chrome-focus disabled:pointer-events-none data-[popup-open]:bg-chrome-hover"
    >
      <span>{shown}</span>
      {disabled ? null : <ChevronDown className="size-3" strokeWidth={2} />}
    </button>
  );
  if (disabled) return button;
  return (
    <ChromePopover trigger={button} side="bottom" align="start" gap={4} open={open} onOpenChange={change} label="Set language" className="w-56 p-1.5">
      <input
        autoFocus
        value={query}
        role="combobox"
        aria-label="Language"
        aria-controls={listId}
        aria-expanded="true"
        aria-activedescendant={choices[active] ? `${listId}-${active}` : undefined}
        placeholder="Language"
        onChange={event => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={keyDown}
        className="mb-1 h-7 w-full rounded-[8px] bg-chrome-hover px-2 text-[13px] text-chrome-fg outline-none placeholder:text-chrome-muted"
      />
      <div id={listId} role="listbox" aria-label="Language" className="overflow-y-auto" style={{ maxHeight: LIST_MAX_HEIGHT }}>
        {choices.map((choice, index) => (
          <div
            key={choice.key ?? 'auto'}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            onMouseMove={() => setActive(index)}
            onMouseDown={event => event.preventDefault()}
            onClick={() => pick(choice)}
            className={cn('flex h-7 cursor-default items-center gap-2 rounded-[8px] px-2 text-[13px]', index === active && 'bg-chrome-hover')}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">{choice.key === current ? <Check className="size-4 text-chrome-accent" strokeWidth={2.25} /> : null}</span>
            {choice.label}
          </div>
        ))}
        {choices.length === 0 ? <div className="px-2 py-1.5 text-[13px] text-chrome-muted">No languages match</div> : null}
      </div>
    </ChromePopover>
  );
}
