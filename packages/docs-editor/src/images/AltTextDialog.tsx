/** The dialog that sets a picture's alt text. */
import { Button, Dialog, cn, isComposingKey } from '@open-artifact/ui';
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react';
import { findTarget, saveAltText } from './actions.ts';
import { ALT_MAX, cleanAlt } from './geometry.ts';
import { setImages, useImages } from './store.ts';

export function AltTextDialog(): ReactNode {
  const open = useImages(state => state.alt);
  const [text, setText] = useState('');

  useEffect(() => setText(open?.text ?? ''), [open]);

  const close = () => {
    const target = useImages.getState().alt;
    setImages({ alt: null });
    if (target) findTarget(target)?.view.focus();
  };
  const tooLong = [...text].length > ALT_MAX;
  const empty = cleanAlt(text) === null;
  const save = () => {
    if (!open || tooLong || empty) return;
    if (saveAltText(open, text)) setImages({ alt: null });
  };
  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposingKey(event.nativeEvent)) return;
    event.preventDefault();
    save();
  };
  const hint = tooLong ? 'Alt text can be up to 2,048 characters.' : empty ? 'Add alt text to save.' : null;

  return (
    <Dialog
      open={!!open}
      onOpenChange={next => (next ? undefined : close())}
      title="Alt text"
      description="Describe the image for people who can’t see it."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={tooLong || empty} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <textarea
        autoFocus
        aria-label="Alt text"
        aria-invalid={tooLong}
        aria-describedby="doc-alt-hint"
        className={cn(
          'block min-h-24 w-full resize-y rounded-control border border-line bg-surface-2 px-2 py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:bg-surface',
          tooLong && 'border-danger focus:border-danger',
        )}
        value={text}
        placeholder="A short description of the image"
        onChange={event => setText(event.target.value)}
        onKeyDown={key}
      />
      <div id="doc-alt-hint" className={cn('mt-1.5 min-h-4 text-xs', tooLong ? 'text-danger' : 'text-fg-muted')} aria-live="polite">
        {hint}
      </div>
    </Dialog>
  );
}
