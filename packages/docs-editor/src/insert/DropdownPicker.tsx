/**
 * A dropdown chip's menu: find or add an option, edit the list's options, or switch the chip to another list (or a
 * new one, or one from a template).
 */
import type { DocEnum } from '@open-artifact/runtime/doc-api';
import { cn, isComposingKey } from '@open-artifact/ui';
import { Check, Pencil, Plus, Search } from 'lucide-react';
import type { EditorView } from 'prosemirror-view';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { enumById, useDocs } from '../app/store.ts';
import { leaveChip, setChipAttrs } from './chips.ts';
import { createDropdown, dropdownFromTemplate, saveDropdown } from './dropdown-calls.ts';
import { COLOR_VALUES, type Draft, type DropdownTemplate, colorOf, defaultColor, draftOf, emptyDraft, finishDraft, pickableOptions, resolveTyped, withOption } from './dropdown-model.ts';
import { DropdownLibrary } from './DropdownLibrary.tsx';
import { OptionsEditor } from './OptionsEditor.tsx';
import { PickerShell } from './PickerShell.tsx';

const NO_ENUMS: readonly DocEnum[] = [];

type Mode = 'list' | 'edit' | 'create';

export function DropdownPicker({ view, pos }: { view: EditorView; pos: number }): ReactNode {
  const enums = useDocs(state => state.project?.enums ?? NO_ENUMS);
  const node = view.state.doc.nodeAt(pos);
  const enumId = String(node?.attrs.enum ?? '');
  const current = typeof node?.attrs.index === 'number' ? (node.attrs.index as number) : null;
  const list = enumById(enums, enumId);
  const [mode, setMode] = useState<Mode>('list');

  const switchTo = (id: string) => {
    setChipAttrs(view, pos, { enum: id, index: null });
    setMode('list');
  };

  return (
    <PickerShell view={view} pos={pos} onChip label={list?.name || 'Dropdown'} onEscape={() => (mode === 'list' ? leaveChip(view, pos) : setMode('list'))}>
      {mode === 'edit' && list ? (
        <OptionsEditor
          initial={draftOf(list)}
          submitLabel="Done"
          busyLabel="Saving…"
          failedLabel="Save failed — retry"
          onBack={() => setMode('list')}
          onSubmit={async draft => {
            await saveDropdown(list.id, finishDraft(draft, list));
            setMode('list');
          }}
        />
      ) : mode === 'create' ? (
        <OptionsEditor
          initial={emptyDraft()}
          submitLabel="Create"
          busyLabel="Creating…"
          failedLabel="Create failed — retry"
          onBack={() => setMode('list')}
          onSubmit={async (draft: Draft) => switchTo(await createDropdown(finishDraft(draft, null)))}
        />
      ) : (
        <OptionList view={view} pos={pos} list={list} current={current} enums={enums} onEdit={() => setMode('edit')} onNew={() => setMode('create')} onSwitch={switchTo} />
      )}
    </PickerShell>
  );
}

interface OptionListProps {
  view: EditorView;
  pos: number;
  list: DocEnum | null;
  current: number | null;
  enums: readonly DocEnum[];
  onEdit(): void;
  onNew(): void;
  onSwitch(id: string): void;
}

/** A row the keys can reach: an option, or "Create <name>". */
interface Row {
  key: string;
  run(): void;
}

function OptionList({ view, pos, list, current, enums, onEdit, onNew, onSwitch }: OptionListProps): ReactNode {
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listbox = useRef<HTMLDivElement>(null);

  useEffect(() => (input.current ?? listbox.current)?.focus({ preventScroll: true }), [list?.id]);
  useEffect(() => setActive(null), [filter, list?.id]);
  useEffect(() => {
    listbox.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (index: number) => {
    setChipAttrs(view, pos, { index: index === current ? null : index });
    leaveChip(view, pos);
  };

  const add = async (name: string) => {
    if (!list || adding) return;
    const next = withOption(list, name);
    setAdding(true);
    try {
      await saveDropdown(list.id, { name: next.name, options: next.options });
      setChipAttrs(view, pos, { index: next.index });
      leaveChip(view, pos);
    } catch {
      setAdding(false);
    }
  };

  const fromTemplate = async (picked: DropdownTemplate) => {
    setTemplate(picked.name);
    try {
      onSwitch(await dropdownFromTemplate(picked));
    } finally {
      setTemplate(null);
    }
  };

  const typed = filter.trim();
  const options = list ? pickableOptions(list.options, current, filter) : [];
  const canCreate = !!list && typed !== '' && !list.options.some(option => option.name.trim().toLowerCase() === typed.toLowerCase());
  const rows: Row[] = [
    ...options.filter(({ option }) => !option.disabled).map(({ index }) => ({ key: `opt-${index}`, run: () => choose(index) })),
    ...(canCreate ? [{ key: 'create', run: () => void add(typed) }] : []),
  ];

  const enter = () => {
    if (active !== null && rows[active]) return rows[active].run();
    if (!list) return;
    const resolved = resolveTyped(list.options, filter);
    if (resolved.kind === 'pick') choose(resolved.index);
    else if (resolved.kind === 'add') void add(resolved.name);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(active === null ? (step === 1 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      enter();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      leaveChip(view, pos);
    }
  };

  const activeKey = active === null ? null : (rows[active]?.key ?? null);

  return (
    <div className="flex w-64 flex-col">
      {list ? (
        <div className="flex items-center gap-2 border-b border-chrome-line px-2.5">
          <Search className="size-4 shrink-0 text-chrome-muted" aria-hidden="true" />
          <input
            ref={input}
            className="h-9 min-w-0 flex-1 bg-transparent outline-none placeholder:text-chrome-muted"
            placeholder="Find or add an option…"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            value={filter}
            onChange={event => setFilter(event.target.value)}
            onKeyDown={onKey}
          />
        </div>
      ) : null}
      <div ref={listbox} tabIndex={-1} role="listbox" aria-label={list?.name ?? 'Dropdowns'} className="max-h-72 overflow-y-auto p-1.5 outline-none">
        {options.map(({ option, index }) => {
          const selected = index === current;
          return (
            <div
              key={index}
              role="option"
              aria-selected={selected}
              aria-disabled={option.disabled || undefined}
              data-active={activeKey === `opt-${index}`}
              className={cn(
                'flex h-8 cursor-default select-none items-center gap-2 rounded-[8px] px-2.5 hover:bg-chrome-hover',
                activeKey === `opt-${index}` && 'bg-chrome-hover',
                option.disabled && 'pointer-events-none opacity-50',
              )}
              onMouseDown={event => event.preventDefault()}
              onClick={() => !option.disabled && choose(index)}
            >
              <span className="block size-2.5 shrink-0 rounded-full" style={{ background: COLOR_VALUES[colorOf(option, index)] }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {selected ? <Check className="size-4 shrink-0 text-chrome-accent" aria-hidden="true" /> : null}
            </div>
          );
        })}
        {canCreate ? (
          <div
            role="option"
            aria-selected="false"
            data-active={activeKey === 'create'}
            className={cn('flex h-8 cursor-default select-none items-center gap-2 rounded-[8px] px-2.5 hover:bg-chrome-hover', activeKey === 'create' && 'bg-chrome-hover', adding && 'opacity-50')}
            onMouseDown={event => event.preventDefault()}
            onClick={() => void add(typed)}
          >
            <Plus className="size-4 shrink-0 text-chrome-muted" aria-hidden="true" />
            <span className="text-chrome-muted">Create</span>
            <span className="block size-2.5 shrink-0 rounded-full" style={{ background: COLOR_VALUES[defaultColor(list.options.length)] }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{typed}</span>
          </div>
        ) : null}
        {list && !typed && list.options.length === 0 ? (
          <div role="option" aria-disabled="true" aria-selected="false" className="px-2.5 py-1.5 text-chrome-muted">
            No options yet — type to add one.
          </div>
        ) : null}
        {list && list.options.length > 0 ? (
          <button
            type="button"
            className="mt-1 flex h-8 w-full items-center gap-2 rounded-[8px] border-t border-chrome-line px-2.5 text-left text-chrome-muted outline-none hover:bg-chrome-hover focus-visible:bg-chrome-hover"
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden="true" />
            Edit options
          </button>
        ) : null}
        {!typed ? (
          <>
            {list ? <div className="mx-2 my-1 h-px bg-chrome-line" aria-hidden="true" /> : null}
            <DropdownLibrary enums={enums} current={list?.id ?? null} busy={template} onPick={onSwitch} onTemplate={picked => void fromTemplate(picked)} onNew={onNew} />
          </>
        ) : null}
      </div>
    </div>
  );
}
