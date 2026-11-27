import { useState, type ReactElement } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Button, Dialog, IconButton, Menu, MenuCheckboxItem, MenuLabel, toast } from '@open-artifact/ui';
import type { DashboardUpdateSetting } from '@open-artifact/data-core';
import { joinSentences } from '../data/util.ts';
import { useDocument } from '../state/document.ts';
import { SETTING_NOT_SAVED_MESSAGE, getUpdatesChoices, updatesLabel } from './refresh.ts';
import { writeSettingsRead } from './run-as-actions.ts';
import {
  ABOUT_SOURCES_TITLE,
  REFRESH_DATA_LABEL,
  REFRESH_LOADS_NOW_MESSAGE,
  RESULTS_REUSED_MESSAGE,
  SAVED_DATA_LABEL,
  SAVED_FILES_MESSAGE,
  SOURCES_LOAD_FROM_MESSAGE,
  WHEN_SOMEONE_OPENS_IT_LABEL,
  refreshDataChoiceLabel,
} from './words.ts';

/** Stores how long results are reused, settling once the document has it; a refused write says so. */
export function saveRefreshSetting(updates: DashboardUpdateSetting): Promise<void> {
  return writeSettingsRead({ updates }).catch((error: unknown) => {
    const said = error instanceof Error ? error.message : '';
    toast.add({ title: said === '' ? SETTING_NOT_SAVED_MESSAGE : joinSentences(SETTING_NOT_SAVED_MESSAGE, said) });
  });
}

export interface RefreshDataMenuProps {
  /** The current setting (defaults to the document's). */
  value?: DashboardUpdateSetting;
  onChange?: (updates: DashboardUpdateSetting) => void;
  disabled?: boolean;
}

/** Refresh data: a menu of how long the page reuses its sources' results before loading them again. */
export function RefreshDataMenu({ value, onChange, disabled = false }: RefreshDataMenuProps): ReactElement {
  const stored = useDocument((state) => state.content.updates);
  const updates = value ?? stored;
  const label = updatesLabel(updates);
  const choose = onChange ?? ((next: DashboardUpdateSetting) => void saveRefreshSetting(next));
  return (
    <Menu
      align="end"
      trigger={
        <Button variant="ghost" size="sm" disabled={disabled} aria-label={refreshDataChoiceLabel(label)}>
          {label}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      }
    >
      <MenuLabel>{WHEN_SOMEONE_OPENS_IT_LABEL}</MenuLabel>
      {getUpdatesChoices(updates).map((choice) => (
        <MenuCheckboxItem
          key={String(choice)}
          checked={choice === updates}
          closeOnClick
          onCheckedChange={() => {
            if (choice !== updates) choose(choice);
          }}
        >
          {updatesLabel(choice)}
        </MenuCheckboxItem>
      ))}
    </Menu>
  );
}

/** What sources are and how their results are kept. */
export function AboutSourcesDialog({ open, onOpenChange, editor }: { open: boolean; onOpenChange: (open: boolean) => void; editor: boolean }): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={ABOUT_SOURCES_TITLE} description={SOURCES_LOAD_FROM_MESSAGE}>
      <section className="flex flex-col gap-1.5 text-[13px] text-fg">
        <h3 className="m-0 text-[13px] font-medium">{SAVED_DATA_LABEL}</h3>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-fg-muted">
          <li>{SAVED_FILES_MESSAGE}</li>
          <li>{RESULTS_REUSED_MESSAGE}</li>
          {editor ? <li>{REFRESH_LOADS_NOW_MESSAGE}</li> : null}
        </ul>
      </section>
    </Dialog>
  );
}

/** The Sources panel's footer row: Refresh data, its setting (a menu for editors), and About sources. */
export function RefreshDataRow({ canChange }: { canChange: boolean }): ReactElement {
  const updates = useDocument((state) => state.content.updates);
  const [about, setAbout] = useState(false);
  return (
    <div className="flex min-h-9 items-center gap-1 border-t border-line px-3 py-1 text-[13px] text-fg">
      <span>{REFRESH_DATA_LABEL}</span>
      <IconButton size="sm" label={SAVED_DATA_LABEL} icon={<Info className="size-3.5" />} onClick={() => setAbout(true)} />
      <span className="flex-1" />
      {canChange ? <RefreshDataMenu value={updates} /> : <span className="text-fg-muted">{updatesLabel(updates)}</span>}
      <AboutSourcesDialog open={about} onOpenChange={setAbout} editor={canChange} />
    </div>
  );
}
