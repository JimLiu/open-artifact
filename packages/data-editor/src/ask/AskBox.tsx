/**
 * The box a selection's "Ask the agent" opens: what the selection is, a field
 * for the request (Enter sends, Shift+Enter breaks the line, Escape closes),
 * and Send. Keys typed in it stay in it, so the page's shortcuts don't fire.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, isComposingKey } from '@open-artifact/ui';
import { closeAskBox, sendAsk, useAsk, type AskBoxRequest } from './ask.ts';
import { ASK_CANCEL_LABEL, ASK_CLOSE_LABEL, ASK_FIELD_LABEL, ASK_HINT, ASK_PLACEHOLDER, ASK_SENDING, ASK_SEND_LABEL, ASK_TITLE } from './prompt.ts';

const stop = (event: SyntheticEvent): void => event.stopPropagation();

function AskBoxView({ box }: { box: AskBoxRequest }): ReactNode {
  const [words, setWords] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = useId();
  const aboutId = useId();
  const empty = words.trim() === '';

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    if (empty || sending) return;
    setSending(true);
    setError(null);
    const outcome = await sendAsk(words, box.selection);
    if (outcome.sent) return;
    setSending(false);
    setError(outcome.error);
    fieldRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    event.stopPropagation();
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAskBox();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && event.target === fieldRef.current) {
      event.preventDefault();
      void submit();
    }
  };

  const about = box.selection.label === '' ? box.selection.text : box.selection.label;
  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={aboutId}
      className="dash-ask-box"
      data-uncommentable=""
      data-mc-chrome=""
      onKeyDown={onKeyDown}
      onKeyUp={stop}
      onKeyPress={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      <div className="dash-ask-box-head">
        <h2 id={titleId} className="dash-ask-box-title">
          {ASK_TITLE}
        </h2>
        <button type="button" className="dash-ask-box-close" aria-label={ASK_CLOSE_LABEL} onClick={closeAskBox}>
          <X size={16} aria-hidden />
        </button>
      </div>
      {about !== '' && (
        <p id={aboutId} className="dash-ask-box-about">
          {about}
        </p>
      )}
      <textarea
        ref={fieldRef}
        className="dash-ask-box-field"
        rows={3}
        value={words}
        placeholder={ASK_PLACEHOLDER}
        aria-label={ASK_FIELD_LABEL}
        aria-invalid={error !== null || undefined}
        readOnly={sending}
        onChange={(event) => {
          setWords(event.target.value);
          setError(null);
        }}
      />
      <div className="dash-ask-box-foot">
        <p role="status" className="dash-ask-box-hint" data-error={error === null ? undefined : ''}>
          {error ?? (sending ? ASK_SENDING : ASK_HINT)}
        </p>
        <Button size="md" variant="ghost" onClick={closeAskBox}>
          {ASK_CANCEL_LABEL}
        </Button>
        <Button size="md" variant="primary" disabled={empty || sending} onClick={() => void submit()}>
          {ASK_SEND_LABEL}
        </Button>
      </div>
    </div>
  );
}

/** Mount once; shows the open ask box, if any. */
export function AskBox(): ReactNode {
  const box = useAsk((state) => state.box);
  if (box === null) return null;
  return createPortal(<AskBoxView key={box.key} box={box} />, document.body);
}
