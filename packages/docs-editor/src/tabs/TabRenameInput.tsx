/** A tab's name, being typed over in its row: Enter or leaving the field keeps it, Escape puts the old one back. */
import { isComposingKey } from '@open-artifact/ui';
import { type ReactNode, useEffect, useRef } from 'react';
import { renameTab } from './actions.ts';
import { getTabsUi, setTabsUi, useTabsUi } from './state.ts';

export function TabRenameInput({ id }: { id: string }): ReactNode {
  const draft = useTabsUi(state => (state.renaming?.id === id ? state.renaming.draft : ''));
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    input.current?.parentElement?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const renaming = getTabsUi().renaming;
    setTabsUi({ renaming: null });
    if (keep && renaming?.id === id) void renameTab(id, renaming.draft);
  };

  return (
    <input
      ref={input}
      type="text"
      autoComplete="off"
      spellCheck={false}
      aria-label="Tab name"
      value={draft}
      maxLength={255}
      className="-my-0.5 h-6 min-w-0 flex-1 rounded-[6px] bg-chrome-field px-1.5 text-[14px] text-chrome-fg outline-none ring-1 ring-chrome-accent"
      onChange={event => setTabsUi({ renaming: { id, draft: event.target.value } })}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          if (event.repeat || isComposingKey(event.nativeEvent)) return;
          finish(true);
        } else if (event.key === 'Escape') {
          if (isComposingKey(event.nativeEvent)) return;
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}
