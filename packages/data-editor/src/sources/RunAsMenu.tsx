import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button, Menu, MenuCheckboxItem, MenuItem, MenuLabel, MenuSeparator } from '@open-artifact/ui';
import type { Dataset } from '@open-artifact/data-core';
import { maybeDataEngine } from '../data/engine.ts';
import { collectSharedCalls, describeUnsharedQueries, loadServerShares, useSharedAccess } from '../data/shared-access.ts';
import { maybeSession } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import { useShown } from '../state/shown.ts';
import {
  BETA_LABEL,
  CANT_PICK_OTHERS_MESSAGE,
  EACH_VIEWER_DESCRIPTION,
  EACH_VIEWER_LABEL,
  EDITORS_ONLY_MESSAGE,
  LOAD_DATA_USING_LABEL,
  LOCKED_IN_VIEW_MESSAGE,
  NOTHING_SHAREABLE_MESSAGE,
  SHARE_LABEL,
  YOUR_ACCESS_DESCRIPTION,
  YOUR_ACCESS_LABEL,
  YOUR_ACCESS_NOTE,
  describeSharingLine,
  isRunAsBusy,
  othersAccessLabel,
  replacesAccessDescription,
  runAsShortLabel,
  runAsTriggerLabel,
  useRunAsBusy,
  usesSharedAccessDescription,
} from './run-as.ts';
import { shareConnector, stopSharingConnector } from './run-as-actions.ts';

function Choice({ label, description, badge }: { label: string; description: string; badge?: string }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5">
        {label}
        {badge === undefined ? null : <span className="rounded-sm border border-line px-1 text-[10px] leading-4 text-fg-muted">{badge}</span>}
      </span>
      <span className="text-xs whitespace-normal text-fg-muted">{description}</span>
    </span>
  );
}

/** A choice that can't be picked: shown with its reason. */
function Unpickable({ children, reason }: { children: ReactNode; reason: string }): ReactElement {
  return (
    <MenuItem disabled title={reason}>
      {children}
    </MenuItem>
  );
}

/** Whether the page's server shares connectors (asked once); a cloud host doesn't. */
function useSharingSupported(): boolean | null {
  const supported = useSharedAccess((state) => state.supported);
  useEffect(() => {
    const engine = maybeDataEngine();
    if (supported === null && engine !== null) void loadServerShares(engine.sharedAccess);
  }, [supported]);
  return supported;
}

export interface ConnectorAccessProps {
  connector: string;
  datasets: readonly Dataset[];
}

/** "Load data using": whose access a connector's sources load with, in its group header. */
export function RunAsMenu({ connector, datasets }: ConnectorAccessProps): ReactElement | null {
  const supported = useSharingSupported();
  const mark = useDocument((state) => state.content.shared?.[connector]);
  const canWrite = useDocument((state) => state.canWrite);
  const mode = useShown((state) => state.shown.mode);
  const saving = useRunAsBusy((state) => state.saving);
  const session = maybeSession();
  const viewer = session?.viewer ?? null;
  const owner = viewer?.role === 'owner';
  const shareable = useMemo(() => collectSharedCalls(connector, datasets).length > 0, [connector, datasets]);
  const mine = mark !== undefined && viewer !== null && mark.id === viewer.id;
  const others = mark !== undefined && !mine;
  const busy = isRunAsBusy(saving, connector, mark);
  const short = runAsShortLabel(mark, viewer?.id ?? null);
  const access = mark === undefined ? EACH_VIEWER_LABEL : mine ? YOUR_ACCESS_LABEL : othersAccessLabel(mark.name);
  // Only the owner's page has connectors to share; drafts and versions don't change the live dashboard.
  const locked = !owner;
  const canChange = owner && canWrite && session?.canEdit === true && mode === 'live';
  const reason = locked ? LOCKED_IN_VIEW_MESSAGE : canChange ? null : EDITORS_ONLY_MESSAGE;
  const yourReason = reason ?? (shareable ? null : NOTHING_SHAREABLE_MESSAGE);

  // Where connector access can't be shared (a cloud host), there is nothing to pick.
  if (supported === false) return null;
  const eachViewer = <Choice label={EACH_VIEWER_LABEL} description={EACH_VIEWER_DESCRIPTION} />;
  const yours = <Choice label={YOUR_ACCESS_LABEL} badge={BETA_LABEL} description={others ? replacesAccessDescription(mark.name) : YOUR_ACCESS_DESCRIPTION} />;

  return (
    <Menu
      align="end"
      trigger={
        <Button variant="ghost" size="sm" aria-label={runAsTriggerLabel(connector, access)} aria-busy={busy || undefined} data-run-as={connector}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : short}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      }
    >
      <MenuLabel>{LOAD_DATA_USING_LABEL}</MenuLabel>
      {reason === null ? (
        <MenuCheckboxItem checked={mark === undefined} closeOnClick onCheckedChange={() => mark !== undefined && mine && void stopSharingConnector(connector)}>
          {eachViewer}
        </MenuCheckboxItem>
      ) : (
        <Unpickable reason={reason}>{eachViewer}</Unpickable>
      )}
      {others ? (
        <Unpickable reason={CANT_PICK_OTHERS_MESSAGE}>
          <Choice label={othersAccessLabel(mark.name)} description={usesSharedAccessDescription(mark.name)} />
        </Unpickable>
      ) : null}
      {yourReason === null ? (
        <MenuCheckboxItem checked={mine} closeOnClick onCheckedChange={() => !mine && void shareConnector(connector)}>
          {yours}
        </MenuCheckboxItem>
      ) : (
        <Unpickable reason={yourReason}>{yours}</Unpickable>
      )}
      {!mine && yourReason === null ? (
        <>
          <MenuSeparator />
          <MenuLabel>{YOUR_ACCESS_NOTE}</MenuLabel>
        </>
      ) : null}
    </Menu>
  );
}

/** Under a shared connector's name: who shares it, for how many queries, and on the sharer's page what isn't shared yet. */
export function ConnectorShareNotes({ connector, datasets }: ConnectorAccessProps): ReactElement | null {
  const mark = useDocument((state) => state.content.shared?.[connector]);
  const serverCount = useSharedAccess((state) => state.shares?.get(connector)?.keys.size);
  const unshared = useSharedAccess((state) => state.unshared[connector]?.length ?? 0);
  const saving = useRunAsBusy((state) => state.saving);
  const viewer = maybeSession()?.viewer ?? null;
  const count = useMemo(() => collectSharedCalls(connector, datasets).length, [connector, datasets]);
  const supported = useSharingSupported();
  if (mark === undefined || supported === false) return null;
  const mine = viewer !== null && mark.id === viewer.id;
  const busy = isRunAsBusy(saving, connector, mark);
  return (
    <div className="flex flex-col gap-1 pr-1 pl-2 text-xs text-fg-muted">
      <span data-share-line="">{describeSharingLine(mark, mine, serverCount ?? count)}</span>
      {mine && viewer?.role === 'owner' && unshared > 0 ? (
        <span role="note" className="flex items-center gap-2 text-fg">
          <span className="min-w-0 flex-1">{describeUnsharedQueries(connector)}</span>
          <Button variant="secondary" size="sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void shareConnector(connector)}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {SHARE_LABEL}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
