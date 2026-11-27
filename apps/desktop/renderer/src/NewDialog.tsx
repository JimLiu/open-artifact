import type { TypeTile } from '@open-artifact/library-page';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { errorInfo } from '../../src/errors.ts';
import type { DialogProps, WordsProps } from './types.ts';
// The new-artifact dialog: the types that go straight to their editor (made blank, then opened to write in), the types
// an agent builds (made empty, then opened: the Shell says how to hand it to an agent), and a name. A create that did
// not work says why here, and the dialog stays.
import { TypeIcon, typeStyle, usePage } from '@open-artifact/library-page';
import { BUILTIN_START, builtinStartOf } from '@open-artifact/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createArtifact } from './host.ts';
import { typeName } from './words.ts';

const order = (list: readonly string[]) => (a: TypeTile, b: TypeTile) => {
  const at = (id: string) => (list.includes(id) ? list.indexOf(id) : list.length);
  return at(a.id) - at(b.id);
};

function TypeButton({
  tile,
  group,
  selected,
  onPick,
  onConfirm,
  t,
}: WordsProps & { tile: TypeTile; group: string; selected: boolean; onPick(id: string): void; onConfirm(id: string): void }) {
  return (
    <button
      type="button"
      className="new-type"
      data-type={tile.id}
      data-group={group}
      aria-pressed={selected}
      title={tile.description || undefined}
      onClick={() => onPick(tile.id)}
      onDoubleClick={() => onConfirm(tile.id)}
    >
      <span className="new-swatch" aria-hidden="true" style={typeStyle(tile.id)}>
        <TypeIcon type={tile.id} size={20} />
      </span>
      <span className="new-type-name">{typeName(t, tile.id, tile.title)}</span>
    </button>
  );
}

export function NewDialog({ t, onClose }: DialogProps) {
  const types = usePage((s) => s.types);
  const blank = useMemo(() => types.filter((tile) => builtinStartOf(tile.id) === 'blank').sort(order(BUILTIN_START.blank)), [types]);
  const agent = useMemo(() => types.filter((tile) => builtinStartOf(tile.id) !== 'blank').sort(order(BUILTIN_START.agent)), [types]);
  const [type, setType] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLInputElement>(null);

  // The first type is picked to start with.
  useEffect(() => {
    if (type === null && (blank[0] || agent[0])) setType((blank[0] || agent[0]).id);
  }, [type, blank, agent]);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-pressed="true"], .new-type')?.focus();
  }, []);

  const submit = async (picked = type) => {
    if (busy) return;
    if (!picked) return setError(t('new.pick'));
    setBusy(true);
    setError('');
    try {
      await createArtifact(picked, title.trim());
      onClose();
    } catch (failure) {
      setError(t('new.failed', { message: errorInfo(failure).message }));
      setBusy(false);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onClose();
    } else if (event.key === 'Tab') {
      // Focus stays in the dialog.
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input') ?? [])];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  const group = (id: string, label: string, tiles: TypeTile[]) =>
    tiles.length > 0 && (
      <div className="new-group" data-group={id}>
        <span className="new-label">{label}</span>
        <div className="new-grid">
          {tiles.map((tile) => (
            <TypeButton key={tile.id} tile={tile} group={id} selected={type === tile.id} onPick={setType} onConfirm={(picked) => void submit(picked)} t={t} />
          ))}
        </div>
      </div>
    );

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="new-dialog" role="dialog" aria-modal="true" aria-labelledby="new-title" data-testid="new-dialog" ref={dialog} onKeyDown={onKeyDown}>
        <h2 id="new-title">{t('new.title')}</h2>
        {types.length === 0 && <p className="new-empty">{t('new.none')}</p>}
        {group('blank', t('new.blank'), blank)}
        {group('agent', t('new.agent'), agent)}
        <form
          className="new-name"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="new-name" className="new-label">
            {t('new.name')}
          </label>
          <input
            id="new-name"
            ref={name}
            type="text"
            value={title}
            maxLength={300}
            placeholder={t('new.namePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </form>
        {error && (
          <p className="new-error" role="alert" data-testid="new-error">
            {error}
          </p>
        )}
        <div className="new-actions">
          <span className="new-spacer" />
          <button type="button" className="button-quiet" onClick={onClose} disabled={busy}>
            {t('new.cancel')}
          </button>
          <button type="button" className="button-primary" data-testid="new-create" onClick={() => void submit()} disabled={busy || !type}>
            {busy ? t('new.creating') : t('new.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
