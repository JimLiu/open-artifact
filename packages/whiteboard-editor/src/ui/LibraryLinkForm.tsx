/**
 * "From a link…" in the Library panel: a link field, then, once the page has
 * read the link, a confirmation that says where it came from, the library's
 * name and how many shapes it adds and leaves out. Nothing is stored before
 * Add. Enter submits, Escape closes.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isComposingKey } from '@open-artifact/ui';
import { ensureEditable } from '../services/actions.ts';
import { announce } from '../services/announce.ts';
import { addShapeLibrary, importSummary, type LibraryImport } from '../services/shape-libraries.ts';
import { readLibraryLink, type LinkLibrary } from '../services/shape-library-link.ts';

const BUTTON = 'h-7 rounded-[6px] px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-chrome-accent disabled:text-chrome-muted';

/** Props of {@link LibraryLinkForm}. */
export interface LibraryLinkFormProps {
  /** A library was added, or adding it failed. */
  onResult(results: LibraryImport[]): void;
  /** The form is done (added, cancelled or closed). */
  onClose(): void;
}

/** The link field and its confirmation. */
export function LibraryLinkForm({ onResult, onClose }: LibraryLinkFormProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<LinkLibrary | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (pending ? confirm : field).current?.focus();
  }, [pending]);

  const read = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await readLibraryLink(text);
      if (result.ok) setPending(result);
      else setError(result.reason);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!pending || busy || !ensureEditable()) return;
    setBusy(true);
    try {
      const results = [await addShapeLibrary(pending.read)];
      announce(importSummary(results));
      onResult(results);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  if (pending) {
    const { read: library, host } = pending;
    const left = library.leftOut.length + library.overLimit;
    return (
      <div role="group" aria-label="Add this library?" data-wb-library-confirm="" onKeyDown={onKeyDown} className="ml-6 flex flex-col gap-1 rounded-[8px] bg-chrome-hover px-2 py-1.5 text-[12px] text-chrome-fg">
        <p className="text-chrome-muted">From {host}</p>
        <p className="break-words">
          “{library.library.name}”: {library.library.shapes.length} {library.library.shapes.length === 1 ? 'shape' : 'shapes'} will be added
          {left > 0 ? `, ${left} left out` : ''}.
        </p>
        {library.leftOut.length > 0 ? (
          <ul className="ml-3 list-disc text-chrome-muted">
            {library.leftOut.slice(0, 5).map((shape, at) => (
              <li key={at}>
                {shape.name}: {shape.reason}
              </li>
            ))}
            {library.leftOut.length > 5 ? <li>and {library.leftOut.length - 5} more</li> : null}
          </ul>
        ) : null}
        <div className="flex justify-end gap-1">
          <button type="button" onClick={onClose} className={`${BUTTON} text-chrome-muted hover:text-chrome-fg`}>
            Cancel
          </button>
          <button ref={confirm} type="button" disabled={busy || library.library.shapes.length === 0} onClick={() => void install()} className={`${BUTTON} bg-chrome text-chrome-fg shadow-chrome`}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      data-wb-library-link=""
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        void read();
      }}
      className="ml-6 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1">
        <input
          ref={field}
          type="url"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="https://…"
          aria-label="Link to a shape library"
          aria-invalid={error !== undefined}
          spellCheck={false}
          maxLength={2048}
          className="h-8 min-w-0 flex-1 rounded-[8px] bg-chrome-hover px-2 text-[13px] text-chrome-fg outline-none placeholder:text-chrome-muted focus:ring-2 focus:ring-chrome-accent"
        />
        <button type="submit" disabled={busy || text.trim() === ''} className={`${BUTTON} bg-chrome-hover text-chrome-fg hover:bg-chrome-line`}>
          {busy ? 'Reading…' : 'Add'}
        </button>
      </div>
      {error !== undefined ? (
        <p role="alert" data-wb-library-link-error="" className="px-1 text-[12px] text-chrome-muted">
          {error}
        </p>
      ) : null}
    </form>
  );
}
