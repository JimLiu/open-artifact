import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, History } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { Button, Dialog, IconButton, INPUT_CLASS, TextInput, Tooltip, cn } from '@open-artifact/ui';
import { getDatasetQuery, type Dataset, type LoadResult, type Parameters, type QuerySource, type Table } from '@open-artifact/data-core';
import { describeLoadFailure } from '../data/status.ts';
import { stableStringify } from '../data/util.ts';
import { CANCEL_LABEL, DISCARD_LABEL, KEEP_EDITING_LABEL, SAVED_LABEL, SAVE_LABEL, SAVING_LABEL } from '../drafts/words.ts';
import { useDocument } from '../state/document.ts';
import { setSourceDraftDirty } from '../state/shown.ts';
import {
  editableArgumentText,
  getQueryArgumentViews,
  getRestorableArgumentValues,
  parseEditedArgument,
  parseQueryEditArguments,
  type QueryArgumentView,
  type QueryArguments,
} from './args.ts';
import { HighlightedCodeInput, LabeledField, CopyButton, blurOnEscape, runOnModEnter } from './code.tsx';
import { EditDialog } from './EditDialog.tsx';
import {
  describeHistoryArgumentDifference,
  formatQueryHistoryTime,
  getOldestHistoryItemId,
  isHistoryEntryRestorable,
  isHistoryEntrySameFormat,
  parseQueryHistory,
  queryHistoryDocumentName,
  queryHistoryEntryTitle,
  toQueryHistoryItems,
  type QueryHistoryItem,
} from './history.ts';
import { ParameterPlaceholderList, QueryArgumentFields, QueryArgumentValue } from './parts.tsx';
import { formatShortDateTime } from './result.ts';
import { QueryTestResult } from './ResultView.tsx';
import {
  getDraftSaveError,
  previewQueryArguments,
  saveQueryArguments,
  saveSourceMetadata,
  QuerySaveRefusalError,
  type QueryMetaPatch,
} from './save.ts';
import {
  A_CONNECTOR_LABEL,
  BACK_LABEL,
  DESCRIPTION_LABEL,
  DIFFERENT_FORMAT_MESSAGE,
  EDIT_LABEL,
  HISTORY_LABEL,
  NAME_LABEL,
  QUERY_CONCURRENT_EDIT_MESSAGE,
  QUERY_SAVE_FAILED_MESSAGE,
  RESTORE_LABEL,
  RESTORE_NOTE,
  TESTING_LABEL,
  TEST_DIDNT_RUN_MESSAGE,
  TEST_LABEL,
  TEST_WITHOUT_SAVING_LABEL,
  THIS_IS_THE_QUERY_NOW,
  UNSAVED_TYPED_WORDS,
  discardChangesQuestion,
  editedNote,
  formatResultRowCount,
  setByThePageNote,
  testResultNotSavedMessage,
} from './words.ts';

export const QUERY_TEST_SHORTCUT = '⌘↩';

export type QueryDraftPhase = 'idle' | 'busy' | 'testing' | 'invalid' | { error: string };

type DraftTestResult = { key: string; table: Table } | { key: string; failed: string };

export interface ShownDraftTest {
  result: DraftTestResult;
  /** The fields changed since the test ran. */
  stale: boolean;
}

interface DraftValues {
  /** The stored arguments the typing started from. */
  base: string;
  values: Record<string, string | undefined>;
  written?: boolean;
}

export interface QueryArgumentProblem {
  /** The argument (`null` for the test's own failure). */
  name: string | null;
  said: string;
}

export interface QueryDraft {
  stored: QueryArguments;
  phase: QueryDraftPhase;
  dirty: boolean;
  locked: boolean;
  tested: ShownDraftTest | null;
  canTest: boolean;
  testedOk: boolean;
  written: boolean;
  saved: boolean;
  value(name: string): string;
  typed(name: string): boolean;
  invalid(name: string): boolean;
  problems: QueryArgumentProblem[];
  set(name: string, text: string): void;
  restore(args: string): void;
  cancel(): void;
  /** Resolves whether it was saved. */
  save(meta?: QueryMetaPatch): Promise<boolean>;
  test(): void;
}

/** A query's typed arguments: what changed, what doesn't parse, its test run and its save. */
export function useQueryDraft(dataset: Dataset): QueryDraft | null {
  const query = getDatasetQuery(dataset);
  const storedText = query === undefined ? '' : (query.template ?? query.args);
  const stored = useMemo(() => parseQueryEditArguments(storedText), [storedText]);
  const [draft, setDraft] = useState<DraftValues | null>(null);
  const [phase, setPhase] = useState<QueryDraftPhase>('idle');
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<DraftTestResult | null>(null);
  const [reported, setReported] = useState<QueryArgumentProblem[]>([]);
  const generation = useRef(0);
  if (draft?.written === true && draft.base !== storedText) {
    setDraft(null);
    setPhase('idle');
    setTestResult(null);
  }
  if (query === undefined) return null;
  const typedValues = draft?.values ?? {};
  const isChanged = (name: string, text: string): boolean => {
    const parsed = parseEditedArgument(stored[name], text);
    return 'invalid' in parsed || stableStringify(parsed.value) !== stableStringify(stored[name]);
  };
  const dirty = Object.keys(typedValues).some((name) => isChanged(name, typedValues[name] ?? ''));
  const findProblems = (values: Record<string, string | undefined>): QueryArgumentProblem[] =>
    Object.keys(values).flatMap((name) => {
      const parsed = parseEditedArgument(stored[name], values[name] ?? '');
      return 'invalid' in parsed ? [{ name, said: parsed.invalid }] : [];
    });
  const locked = phase === 'busy' || phase === 'testing';
  const buildArguments = (): QueryArguments | null => {
    const args: QueryArguments = { ...stored };
    for (const name of Object.keys(typedValues)) {
      const parsed = parseEditedArgument(stored[name], typedValues[name] ?? '');
      if ('invalid' in parsed) return null;
      args[name] = parsed.value;
    }
    return args;
  };
  const keyOf = (args: QueryArguments): string => stableStringify([query.connector, query.tool, args]) ?? '';
  const argsNow = buildArguments();
  const keyNow = argsNow === null ? null : keyOf(argsNow);
  const validate = (message: string): QueryArguments | null => {
    if (Object.keys(typedValues).some((name) => !Object.hasOwn(stored, name))) {
      setPhase({ error: message });
      return null;
    }
    if (argsNow !== null) return argsNow;
    setReported(findProblems(typedValues));
    setPhase('invalid');
    return null;
  };
  const testedOk = testResult !== null && 'table' in testResult && testResult.key === keyNow;
  const canTest = dirty && !locked && !testedOk;
  const current = findProblems(typedValues);
  const problems: QueryArgumentProblem[] = [
    ...(phase === 'invalid' ? reported.filter((problem) => current.some((now) => now.name === problem.name)) : []),
    ...(testResult !== null && 'failed' in testResult && testResult.key === keyNow ? [{ name: null, said: testResult.failed }] : []),
  ];
  const runTest = async (args: QueryArguments): Promise<void> => {
    const key = keyOf(args);
    const run = ++generation.current;
    const result: LoadResult = await previewQueryArguments(dataset, args).catch(
      (): LoadResult => ({ ok: false, kind: 'failed', message: TEST_DIDNT_RUN_MESSAGE }),
    );
    if (generation.current !== run) return;
    setTestResult(result.ok ? { key, table: result.table } : { key, failed: describeLoadFailure(result) });
    setPhase('idle');
  };
  return {
    stored,
    phase,
    dirty,
    locked,
    tested: testResult === null ? null : { result: testResult, stale: testResult.key !== keyNow },
    canTest,
    testedOk,
    written: draft?.written === true,
    saved,
    value: (name) => typedValues[name] ?? editableArgumentText(stored[name]) ?? '',
    typed: (name) => Object.hasOwn(typedValues, name),
    invalid: (name) => phase === 'invalid' && problems.some((problem) => problem.name === name),
    problems,
    set(name, text) {
      if (locked) return;
      const values = { ...typedValues, [name]: text };
      setDraft({ base: draft?.base ?? storedText, values });
      setPhase((was) => (was === 'invalid' && findProblems(values).length > 0 ? was : 'idle'));
      setSaved(false);
      if (!Object.keys(values).some((key) => isChanged(key, values[key] ?? ''))) setTestResult(null);
    },
    restore(args) {
      if (locked) return;
      const values = getRestorableArgumentValues(args, stored);
      setDraft(values === null ? null : { base: storedText, values });
      setPhase('idle');
      setSaved(false);
      setTestResult(null);
    },
    cancel() {
      generation.current++;
      setDraft(null);
      setPhase('idle');
      setSaved(false);
      setTestResult(null);
    },
    save(meta) {
      const args = locked || draft === null || !dirty ? null : validate(QUERY_SAVE_FAILED_MESSAGE);
      if (draft === null || args === null) return Promise.resolve(false);
      setPhase('busy');
      return saveQueryArguments(dataset, draft.base, args, meta).then(
        () => {
          setSaved(true);
          setTestResult(null);
          setDraft((was) => (was === null ? null : { ...draft, written: true }));
          return true;
        },
        (error: unknown) => {
          setPhase({ error: getDraftSaveError(error) });
          return false;
        },
      );
    },
    test() {
      if (!canTest || draft === null) return;
      const args = validate(QUERY_CONCURRENT_EDIT_MESSAGE);
      if (args === null) return;
      setPhase('testing');
      void runTest(args);
    },
  };
}

/** The editor footer's note: one line tall even when empty, beside the buttons until it needs the row. */
export const FOOTER_NOTE_CLASS = 'min-h-lh min-w-0 flex-1 basis-40 text-[13px] [overflow-wrap:anywhere]';

function getDraftNotice(phase: QueryDraftPhase): { text: string; bad: boolean } | null {
  if (phase === 'idle' || phase === 'invalid') return null;
  if (phase === 'busy') return { text: SAVING_LABEL, bad: false };
  if (phase === 'testing') return { text: TESTING_LABEL, bad: false };
  return { text: phase.error, bad: true };
}

function getTestAnnouncement(tested: ShownDraftTest | null): string {
  if (tested === null || tested.stale || 'failed' in tested.result) return '';
  return testResultNotSavedMessage(formatResultRowCount(tested.result.table.rows.length));
}

function DraftProblems({ problems }: { problems: readonly QueryArgumentProblem[] }): ReactElement | null {
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="mt-3 flex flex-col gap-1 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-fg">
      {problems.map(({ name, said }) => (
        <p key={name ?? TEST_LABEL} className="[overflow-wrap:anywhere]">
          <span className="text-fg-muted">{name ?? TEST_LABEL}</span> {said}
        </p>
      ))}
    </div>
  );
}

/** This viewer's saved versions of a query, newest first. */
export function useQueryHistory(id: string): QueryHistoryItem[] {
  const ready = useDocument((state) => state.status === 'ready');
  const stored = useDocument((state) => state.ownDocuments.get(queryHistoryDocumentName(id)));
  return useMemo(() => (ready ? toQueryHistoryItems(parseQueryHistory(stored, Date.now())) : []), [ready, stored]);
}

function ArgumentEditor({ id, arg, draft, first, params }: { id: string; arg: QueryArgumentView; draft: QueryDraft; first: boolean; params: Parameters }): ReactElement {
  const invalid = draft.invalid(arg.name);
  const shared = {
    id,
    name: arg.name,
    value: draft.value(arg.name),
    readOnly: draft.locked,
    spellCheck: false,
    autoFocus: first,
  };
  const reading = { lang: arg.lang, ...(arg.quotes === undefined ? {} : { quotes: arg.quotes }) };
  return (
    <>
      {arg.long ? (
        <HighlightedCodeInput
          {...shared}
          rows={3}
          reading={reading}
          tinted
          invalid={invalid}
          onChange={(event) => draft.set(arg.name, event.target.value)}
          onKeyDown={(event) => {
            if (!runOnModEnter(event, draft.test)) blurOnEscape(event);
          }}
        />
      ) : (
        <span className="relative flex">
          <TextInput
            {...shared}
            aria-invalid={invalid || undefined}
            className={cn('w-full font-mono', invalid && 'border-danger pr-7')}
            onChange={(event) => draft.set(arg.name, event.target.value)}
            onKeyDown={(event) => {
              runOnModEnter(event, draft.test);
            }}
          />
          {invalid ? <CircleAlert className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-danger" aria-hidden /> : null}
        </span>
      )}
      <ParameterPlaceholderList text={draft.value(arg.name)} reading={reading} params={params} />
    </>
  );
}

function HistoryList({ items, onPick, asOf }: { items: readonly QueryHistoryItem[]; onPick: (id: string) => void; asOf: number }): ReactElement {
  const oldest = getOldestHistoryItemId(items);
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-auto">
      <h3 className="m-0 text-[13px] font-medium text-fg">{HISTORY_LABEL}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((item) => {
          const title = queryHistoryEntryTitle(item.id, oldest);
          const when = formatQueryHistoryTime(item.at, asOf);
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-label={`${title}, ${when}`}
                className="flex w-full items-center justify-between gap-2 border-b border-line px-1 py-1.5 text-left text-[13px] hover:bg-hover"
                onClick={() => onPick(item.id)}
              >
                <span className="text-fg">{title}</span>
                <span className="text-fg-muted">{when}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HistoryEntry({ item, oldest, call, langs, params }: { item: QueryHistoryItem; oldest: string | undefined; call: QuerySource; langs?: Record<string, string>; params: Parameters }): ReactElement {
  const saved: QuerySource = {
    kind: 'query',
    ...(item.entry.call === true ? { call: true as const } : {}),
    connector: call.connector,
    tool: call.tool,
    args: item.entry.args,
  };
  const now = getQueryArgumentViews(call, langs);
  const current = stableStringify(parseQueryEditArguments(item.entry.args)) === stableStringify(parseQueryEditArguments(call.template ?? call.args));
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto">
      <div className="flex flex-col text-[13px]">
        <h3 className="m-0 font-medium text-fg">{queryHistoryEntryTitle(item.id, oldest)}</h3>
        <p className="text-fg-muted">{current ? `${formatShortDateTime(item.at)} · ${THIS_IS_THE_QUERY_NOW}` : formatShortDateTime(item.at)}</p>
      </div>
      <QueryArgumentFields
        call={saved}
        {...(langs === undefined ? {} : { langs })}
        params={params}
        noteOf={(arg) =>
          describeHistoryArgumentDifference(
            arg,
            now.find((candidate) => candidate.name === arg.name),
          )
        }
      />
    </div>
  );
}

export interface QueryEditorDialogProps {
  ds: Dataset;
  now: number;
  params: Parameters;
  onClose: () => void;
}

/** Edits a query source: its name, description and arguments, with Test, Save and the history of its versions. */
export function QueryEditorDialog(props: QueryEditorDialogProps): ReactElement | null {
  // While a save runs, the editor keeps what it showed when the save began: the stored source changes under it.
  const [held, setHeld] = useState<QueryEditorDialogProps | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const onSaving = useCallback((saving: boolean) => setHeld(saving ? latest.current : null), []);
  return <QueryEditor {...(held ?? props)} onClose={props.onClose} onSaving={onSaving} />;
}

function QueryEditor({ ds, now, params, onClose, onSaving }: QueryEditorDialogProps & { onSaving: (saving: boolean) => void }): ReactElement | null {
  const title = ds.title || ds.id;
  const query = getDatasetQuery(ds);
  const draft = useQueryDraft(ds);
  const [fields, setFields] = useState({ title: ds.title, description: ds.description });
  const [initialMeta] = useState({ title: ds.title, description: ds.description });
  const metaPatch: QueryMetaPatch = {
    ...(fields.title === initialMeta.title ? {} : { title: fields.title }),
    ...(fields.description === initialMeta.description ? {} : { description: fields.description }),
  };
  const metaChanged =
    (metaPatch.title !== undefined && metaPatch.title !== ds.title) || (metaPatch.description !== undefined && metaPatch.description !== ds.description);
  const currentViews = useMemo(() => (query === undefined ? [] : getQueryArgumentViews(query, ds.langs)), [query, ds.langs]);
  const [initialViews] = useState(currentViews);
  const removedTyped = initialViews.filter(
    (arg) => arg.param === null && draft?.typed(arg.name) === true && !currentViews.some((now) => now.name === arg.name && now.param === null),
  );
  const views = [...currentViews.filter((arg) => !removedTyped.some((removed) => removed.name === arg.name)), ...removedTyped];
  const nothingToEdit = query === undefined || draft === null;
  useEffect(() => {
    if (nothingToEdit) onClose();
  }, [nothingToEdit, onClose]);
  const saved = draft?.saved ?? false;
  const history = useQueryHistory(ds.id);
  const [savingMeta, setSavingMeta] = useState(false);
  const unsaved = (draft !== null && draft.dirty && !draft.written && draft.phase !== 'busy') || (metaChanged && !savingMeta && draft?.written !== true);
  const saving = (draft !== null && draft.phase === 'busy' && !draft.written) || savingMeta;
  useLayoutEffect(() => {
    onSaving(saving);
  }, [saving, onSaving]);
  const [metaError, setMetaError] = useState<string | null>(null);
  useEffect(() => {
    setSourceDraftDirty(unsaved);
  }, [unsaved]);
  useEffect(() => () => setSourceDraftDirty(false), []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const close = useCallback((): void => {
    setHistoryOpen(false);
    setHistoryId(null);
    onClose();
  }, [onClose]);
  const dirty = draft?.dirty ?? false;
  useEffect(() => {
    if (!saved || dirty) return;
    announce(SAVED_LABEL);
    close();
  }, [saved, dirty, close]);
  const entry = history.find((item) => item.id === historyId);
  const showingFields = !historyOpen && entry === undefined;
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const locked = draft?.locked ?? false;
  const fieldsLocked = locked || savingMeta;
  const fieldId = useId();
  const committing = useRef(false);

  if (query === undefined || draft === null) return null;

  const restore = (args: string): void => {
    draft.restore(args);
    setHistoryId(null);
    setHistoryOpen(false);
  };
  const requestRestore = (args: string): void => {
    if (locked) return;
    if (unsaved) setPendingRestore(args);
    else restore(args);
  };
  const back = (): void => (entry === undefined ? setHistoryOpen(false) : setHistoryId(null));
  const commit = (): void => {
    if (draft.locked || committing.current) return;
    setMetaError(null);
    if (draft.dirty) {
      void draft.save(metaChanged ? metaPatch : undefined);
      return;
    }
    if (!metaChanged) return;
    committing.current = true;
    setSavingMeta(true);
    void saveSourceMetadata(ds, metaPatch)
      .then((failure) => {
        if (failure !== null) {
          setMetaError(failure);
          return;
        }
        announce(SAVED_LABEL);
        close();
      })
      .finally(() => {
        committing.current = false;
        setSavingMeta(false);
      });
  };
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    commit();
  };
  const notice =
    getDraftNotice(draft.phase) ?? (savingMeta ? { text: SAVING_LABEL, bad: false } : metaError === null ? null : { text: metaError, bad: true });
  const busy = draft.phase === 'busy' || savingMeta;
  const editedLine = ds.updated === null ? null : editedNote(formatShortDateTime(ds.updated.at), ds.updated.by);
  const caption = `${query.connector || A_CONNECTOR_LABEL} · ${query.tool}`;
  const restorable = entry !== undefined && isHistoryEntryRestorable(entry, query);
  const sameFormat = entry === undefined || isHistoryEntrySameFormat(entry, query);

  const footer = showingFields ? (
    <div className="flex-none">
      <DraftProblems problems={draft.problems} />
      <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
        <p className={cn(FOOTER_NOTE_CLASS, notice?.bad === true ? 'text-danger' : 'text-fg-muted')}>
          <span role="status">{notice?.text}</span>
          {notice === null ? editedLine : null}
        </p>
        <span className="sr-only" role="status">
          {getTestAnnouncement(draft.tested)}
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => (unsaved ? setPendingRestore('') : (draft.cancel(), close()))}>
            {CANCEL_LABEL}
          </Button>
          <Tooltip label={TEST_WITHOUT_SAVING_LABEL} shortcut={QUERY_TEST_SHORTCUT}>
            <Button aria-keyshortcuts="Meta+Enter Control+Enter" aria-busy={draft.phase === 'testing' || undefined} disabled={draft.phase !== 'testing' && !draft.canTest} onClick={draft.test}>
              {TEST_LABEL}
            </Button>
          </Tooltip>
          <Button variant="primary" type="submit" form={fieldId} aria-busy={busy || undefined} disabled={draft.locked || savingMeta || (!draft.dirty && draft.phase === 'idle' && !metaChanged)}>
            {SAVE_LABEL}
          </Button>
        </span>
      </div>
    </div>
  ) : (
    <div className="flex flex-none flex-wrap items-center justify-end gap-2 pt-4">
      <p className={cn(FOOTER_NOTE_CLASS, 'text-fg-muted')}>{entry === undefined ? null : sameFormat ? (restorable ? RESTORE_NOTE : null) : DIFFERENT_FORMAT_MESSAGE}</p>
      <Button variant="ghost" onClick={back}>
        {BACK_LABEL}
      </Button>
      {entry === undefined ? null : (
        <Button variant="primary" disabled={!restorable || locked} onClick={() => requestRestore(entry.entry.args)}>
          {RESTORE_LABEL}
        </Button>
      )}
    </div>
  );

  return (
    <EditDialog
      name={title}
      title={
        <span className="flex items-center gap-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span>{EDIT_LABEL}</span>
            <span className="truncate text-xs font-normal text-fg-muted">{caption}</span>
          </span>
          {showingFields ? (
            <IconButton size="sm" label={HISTORY_LABEL} disabled={history.length === 0} icon={<History className="size-3.5" />} onClick={() => setHistoryOpen(true)} />
          ) : null}
        </span>
      }
      saving={saving}
      unsaved={unsaved}
      unsavedWords={UNSAVED_TYPED_WORDS}
      onLeave={() => {
        draft.cancel();
        close();
      }}
      footer={footer}
    >
      {showingFields ? (
        <form id={fieldId} onSubmit={onSubmit} className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <fieldset disabled={fieldsLocked} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <LabeledField label={NAME_LABEL} htmlFor={`${fieldId}-name`}>
              <TextInput
                id={`${fieldId}-name`}
                value={fields.title}
                placeholder={ds.id}
                onChange={(event) => {
                  setMetaError(null);
                  setFields({ ...fields, title: event.target.value });
                }}
              />
            </LabeledField>
            <LabeledField label={DESCRIPTION_LABEL} htmlFor={`${fieldId}-description`}>
              <textarea
                id={`${fieldId}-description`}
                rows={2}
                value={fields.description}
                className={cn(INPUT_CLASS, 'h-auto resize-y py-1.5')}
                onChange={(event) => {
                  setMetaError(null);
                  setFields({ ...fields, description: event.target.value });
                }}
              />
            </LabeledField>
          </fieldset>
          {views.map((arg, index) =>
            arg.param !== null ? (
              <LabeledField key={arg.name} label={arg.name} note={setByThePageNote(arg.param)}>
                <QueryArgumentValue arg={arg} params={params} />
              </LabeledField>
            ) : (
              <LabeledField
                key={arg.name}
                label={arg.name}
                htmlFor={`${fieldId}-${index}`}
                end={arg.long ? <CopyButton text={draft.value(arg.name)} label={`Copy ${arg.name}`} /> : undefined}
              >
                <ArgumentEditor id={`${fieldId}-${index}`} arg={arg} draft={draft} first={false} params={params} />
              </LabeledField>
            ),
          )}
          {draft.tested !== null && 'table' in draft.tested.result ? <QueryTestResult table={draft.tested.result.table} stale={draft.tested.stale} /> : null}
        </form>
      ) : entry === undefined ? (
        <HistoryList items={history} onPick={setHistoryId} asOf={now} />
      ) : (
        <HistoryEntry item={entry} oldest={getOldestHistoryItemId(history)} call={query} {...(ds.langs === undefined ? {} : { langs: ds.langs })} params={params} />
      )}
      <Dialog
        open={pendingRestore !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
        title={discardChangesQuestion(title)}
        description={UNSAVED_TYPED_WORDS}
        footer={
          <>
            <Button autoFocus onClick={() => setPendingRestore(null)}>
              {KEEP_EDITING_LABEL}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const args = pendingRestore;
                setPendingRestore(null);
                if (args === null || args === '') {
                  draft.cancel();
                  close();
                } else restore(args);
              }}
            >
              {DISCARD_LABEL}
            </Button>
          </>
        }
      />
    </EditDialog>
  );
}

export { QuerySaveRefusalError };
