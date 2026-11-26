/** Editing a dropdown list: its name, and its options' names, colours and order; saved options retire, new ones go. */
import { ChromeButton, SwatchRow } from '@open-artifact/editor-kit/react';
import { Button, cn, isComposingKey } from '@open-artifact/ui';
import { ArrowLeft, Eye, EyeOff, GripVertical, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { COLOR_VALUES, DROPDOWN_COLORS, type Draft, type DraftOption, addDraftOption, moveDraftOption, shownPlace } from './dropdown-model.ts';

const SWATCHES = DROPDOWN_COLORS.map(name => ({ name, value: COLOR_VALUES[name], label: name }));

export interface OptionsEditorProps {
  initial: Draft;
  /** "Done" for a list being edited, "Create" for a new one. */
  submitLabel: string;
  busyLabel: string;
  failedLabel: string;
  onBack(): void;
  /** Saves the draft; a rejection shows the failed label. */
  onSubmit(draft: Draft): Promise<void>;
}

export function OptionsEditor({ initial, submitLabel, busyLabel, failedLabel, onBack, onSubmit }: OptionsEditorProps): ReactNode {
  const [draft, setDraft] = useState<Draft>(initial);
  const [coloring, setColoring] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initial.name) list.current?.querySelector<HTMLInputElement>('input')?.focus();
    else nameInput.current?.focus();
  }, [initial.name]);

  useEffect(() => {
    if (focusRow === null) return;
    list.current?.querySelector<HTMLInputElement>(`[data-row="${focusRow}"] input`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  const rows = draft.options.map((option, index) => ({ option, index })).toSorted((a, b) => a.option.order - b.option.order || a.index - b.index);
  const edit = (index: number, patch: Partial<DraftOption>) => setDraft(current => ({ ...current, options: current.options.map((option, at) => (at === index ? { ...option, ...patch } : option)) }));
  const remove = (index: number) => setDraft(current => ({ ...current, options: current.options.filter((_, at) => at !== index) }));
  const add = () => {
    setDraft(current => addDraftOption(current));
    setFocusRow(draft.options.length);
  };
  const move = (index: number, to: number) => setDraft(current => moveDraftOption(current, index, to));
  const canSubmit = draft.name.trim() !== '' && draft.options.some(option => option.name.trim() !== '') && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(draft);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="flex w-72 flex-col">
      <div className="flex items-center gap-1 border-b border-chrome-line p-1.5">
        <ChromeButton square aria-label="Back" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </ChromeButton>
        <input
          ref={nameInput}
          className="h-7 min-w-0 flex-1 rounded-[6px] bg-transparent px-1.5 font-medium outline-none placeholder:text-chrome-muted focus-visible:bg-chrome-hover"
          placeholder="Dropdown name"
          maxLength={120}
          value={draft.name}
          onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            list.current?.querySelector<HTMLInputElement>('input')?.focus();
          }}
        />
      </div>
      <div ref={list} className="max-h-72 overflow-y-auto p-1.5">
        {rows.map(({ option, index }) => (
          <div
            key={index}
            data-row={index}
            className={cn('rounded-[8px]', dragging === index && 'opacity-50')}
            onDragOver={event => {
              if (dragging === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={event => {
              event.preventDefault();
              if (dragging !== null && dragging !== index) move(dragging, shownPlace(draft, index));
              setDragging(null);
            }}
          >
            <div className="flex h-8 items-center gap-1">
              <span
                draggable
                title="Drag to reorder"
                className="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center text-chrome-muted"
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                  setDragging(index);
                }}
                onDragEnd={() => setDragging(null)}
              >
                <GripVertical className="size-3.5" aria-hidden="true" />
              </span>
              <button
                type="button"
                title="Pick color"
                aria-label="Pick color"
                aria-expanded={coloring === index}
                className="grid size-7 shrink-0 place-items-center rounded-[6px] hover:bg-chrome-hover"
                onClick={() => setColoring(coloring === index ? null : index)}
              >
                <span className="block size-3 rounded-full" style={{ background: COLOR_VALUES[option.color] }} />
              </button>
              <input
                className={cn('h-7 min-w-0 flex-1 rounded-[6px] bg-transparent px-1.5 outline-none placeholder:text-chrome-muted focus-visible:bg-chrome-hover', option.disabled && 'text-chrome-muted line-through')}
                placeholder="Option"
                maxLength={120}
                value={option.name}
                onChange={event => edit(index, { name: event.target.value })}
                onKeyDown={event => {
                  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                    event.preventDefault();
                    move(index, shownPlace(draft, index) + (event.key === 'ArrowUp' ? -1 : 1));
                    setFocusRow(index);
                  } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                    event.preventDefault();
                    if (isComposingKey(event.nativeEvent)) return;
                    const place = shownPlace(draft, index);
                    const next = rows[place + 1];
                    if (next) setFocusRow(next.index);
                    else add();
                  }
                }}
              />
              {option.saved ? (
                <ChromeButton
                  square
                  title={option.disabled ? 'Hidden from picker — click to show' : 'Hide from picker'}
                  aria-label={option.disabled ? 'Hidden from picker — click to show' : 'Hide from picker'}
                  aria-pressed={option.disabled}
                  onClick={() => edit(index, { disabled: !option.disabled })}
                >
                  {option.disabled ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </ChromeButton>
              ) : (
                <ChromeButton square title="Remove (not saved yet)" aria-label="Remove (not saved yet)" onClick={() => remove(index)}>
                  <X className="size-4" />
                </ChromeButton>
              )}
            </div>
            {coloring === index ? (
              <SwatchRow
                label="Pick color"
                swatches={SWATCHES}
                current={option.color}
                size={14}
                className="flex-wrap pb-1 pl-9"
                onPick={name => {
                  edit(index, { color: name as DraftOption['color'] });
                  setColoring(null);
                }}
              />
            ) : null}
          </div>
        ))}
        <ChromeButton className="mt-0.5 w-full justify-start text-chrome-muted" onClick={add}>
          <Plus className="size-4" />
          Add option
        </ChromeButton>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-chrome-line p-1.5">
        {failed ? <span className="mr-auto pl-1 text-[13px] text-danger">{failedLabel}</span> : null}
        <Button size="sm" variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </div>
  );
}
