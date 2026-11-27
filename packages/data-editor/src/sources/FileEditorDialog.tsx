import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { Upload } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { Button, IconButton, Tooltip, cn } from '@open-artifact/ui';
import { fileLoaderAnswer, inferDataFileFormat, type Dataset, type FileSource, type Table } from '@open-artifact/data-core';
import { fetchDataFileText } from '../data/files.ts';
import { finalizeQueryResult, runFileLoader } from '../data/queries.ts';
import { describeLoadFailure } from '../data/status.ts';
import { CANCEL_LABEL, SAVED_LABEL, SAVE_LABEL, SAVING_LABEL } from '../drafts/words.ts';
import { HighlightedCodeInput, LabeledField, blurOnEscape, runOnModEnter } from './code.tsx';
import { EditDialog } from './EditDialog.tsx';
import { setSourceDraftDirty } from '../state/shown.ts';
import {
  DATA_FILE_ACCEPT,
  describeFileNote,
  findLostColumns,
  isEditableFile,
  parseEditedFileText,
  readDataFileText,
  type EditedDataFile,
  type FileEditPhase,
} from './files.ts';
import { FOOTER_NOTE_CLASS, QUERY_TEST_SHORTCUT } from './QueryEditorDialog.tsx';
import { describeTableResult, formatResultFileSize } from './result.ts';
import { QueryTestResult } from './ResultView.tsx';
import { getQuerySaveError, saveDataFile } from './save.ts';
import {
  CHOOSE_DATA_FILE_MESSAGE,
  EDIT_FILE_TITLE,
  FILE_LABEL,
  FILE_NOT_UTF8_MESSAGE,
  FILE_UNREAD_MESSAGE,
  LOADING_LABEL,
  REPLACE_WITH_FILE_LABEL,
  SAVE_ANYWAY_LABEL,
  TESTING_LABEL,
  TEST_DIDNT_RUN_MESSAGE,
  TEST_LABEL,
  TEST_WITHOUT_SAVING_LABEL,
  TOO_LARGE_REPLACED_NOTE,
  TOO_LARGE_STORED_NOTE,
  UNSAVED_WORDS,
  lostColumnsMessage,
  pickedFileNotSavedMessage,
  savedRowsMessage,
  storedFileProblemNote,
} from './words.ts';

type StoredFile = { text: string; bytes: number } | { problem: string } | null;

interface TestedFile {
  text: string;
  format: EditedDataFile['format'];
  table: Table | null;
  problem?: string;
}

async function readEditedRows(text: string, file: Pick<EditedDataFile, 'format'>, dataset: Dataset): Promise<{ table: Table } | { problem: string }> {
  if (dataset.loader === undefined) return parseEditedFileText(text, file.format, false);
  try {
    const answer = await runFileLoader(fileLoaderAnswer(text, file.format), dataset.loader);
    const result = finalizeQueryResult(answer, 0);
    return result.ok ? { table: result.table } : { problem: describeLoadFailure(result) };
  } catch (error) {
    return { problem: error instanceof Error && error.message !== '' ? error.message : TEST_DIDNT_RUN_MESSAGE };
  }
}

function getPhaseNotice(phase: FileEditPhase, testing: boolean): { text: string; bad: boolean } | null {
  if (phase === 'saving') return { text: SAVING_LABEL, bad: false };
  if (testing) return { text: TESTING_LABEL, bad: false };
  if (phase === 'idle') return null;
  if ('warn' in phase) return { text: lostColumnsMessage(phase.warn), bad: true };
  return { text: phase.error, bad: true };
}

export interface FileEditorDialogProps {
  ds: Dataset & { source: FileSource };
  onClose: () => void;
}

/** Edits a file source's text, or replaces the file with another; Test shows the rows before Save stores them. */
export function FileEditorDialog({ ds, onClose }: FileEditorDialogProps): ReactElement {
  const { source } = ds;
  const title = ds.title || ds.id;
  const hasLoader = ds.loader !== undefined;
  const keepsFormat = source.format === 'text' || hasLoader;
  const [stored, setStored] = useState<StoredFile>(null);
  const [replacement, setReplacement] = useState<EditedDataFile | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tested, setTested] = useState<TestedFile | null>(null);
  const [testing, setTesting] = useState(false);
  const [phase, setPhase] = useState<FileEditPhase>('idle');
  const picker = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();
  const generation = useRef(0);

  useEffect(() => {
    let live = true;
    void fetchDataFileText(source.url).then((fetched) => {
      if (!live) return;
      setStored('text' in fetched ? { text: fetched.text, bytes: fetched.bytes } : { problem: describeLoadFailure(fetched) });
    });
    return () => {
      live = false;
    };
  }, [source.url]);

  const storedFile = stored !== null && 'text' in stored ? stored : null;
  const base: EditedDataFile | null = replacement ?? (storedFile === null ? null : { name: source.name, format: source.format, ...storedFile });
  const editable = isEditableFile(base);
  const text = typed ?? (editable && base !== null ? base.text : '');
  const changed = replacement !== null || (typed !== null && storedFile !== null && typed !== storedFile.text);
  const format = base?.format ?? source.format;
  const saving = phase === 'saving';
  const locked = saving || testing;
  const testedNow = tested !== null && tested.text === text && tested.format === format;
  const canTest = base !== null && editable && !locked && !testedNow;
  const unsaved = changed && !saving;

  useEffect(() => {
    setSourceDraftDirty(unsaved);
  }, [unsaved]);
  useEffect(() => () => setSourceDraftDirty(false), []);

  const resetChecks = (): void => {
    setProblem(null);
    setPhase('idle');
  };

  const test = (): void => {
    if (!canTest) return;
    const run = ++generation.current;
    setTesting(true);
    resetChecks();
    void readEditedRows(text, { format }, ds).then((rows) => {
      if (generation.current !== run) return;
      setTesting(false);
      setTested('table' in rows ? { text, format, table: rows.table } : { text, format, table: null, problem: rows.problem });
    });
  };

  const save = async (): Promise<void> => {
    if (base === null || locked || !changed) return;
    const warned = typeof phase === 'object' && 'warn' in phase;
    let table: Table | null = null;
    if (editable) {
      const rows = await readEditedRows(text, { format }, ds);
      if ('problem' in rows) {
        setProblem(rows.problem);
        return;
      }
      table = rows.table;
      if (!warned && !hasLoader && storedFile !== null) {
        const lost = findLostColumns({ text: storedFile.text, format: source.format }, table);
        if (lost.length > 0) {
          setPhase({ warn: lost });
          return;
        }
      }
    }
    setPhase('saving');
    try {
      await saveDataFile(ds, source.url, {
        body: editable ? text : (replacement?.file ?? text),
        name: base.name,
        format: base.format,
      });
    } catch (error) {
      setPhase({ error: getQuerySaveError(error) });
      return;
    }
    announce(table === null || table.columns.length === 0 ? SAVED_LABEL : savedRowsMessage(describeTableResult(table)));
    onClose();
  };

  const pick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    const picked = keepsFormat ? source.format : inferDataFileFormat(file.name);
    if (picked === null) {
      setProblem(CHOOSE_DATA_FILE_MESSAGE);
      return;
    }
    const read = await readDataFileText(file);
    if ('problem' in read) {
      setProblem(read.problem === 'notUtf8' ? FILE_NOT_UTF8_MESSAGE : FILE_UNREAD_MESSAGE);
      return;
    }
    generation.current++;
    setTesting(false);
    setReplacement({ name: keepsFormat ? source.name : file.name, format: picked, text: read.text, bytes: file.size, file });
    setTyped(null);
    setTested(null);
    resetChecks();
    announce(pickedFileNotSavedMessage(file.name, formatResultFileSize(file.size)));
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void save();
  };

  const notice = getPhaseNotice(phase, testing);
  const warned = typeof phase === 'object' && 'warn' in phase;
  const storedNote =
    stored === null ? LOADING_LABEL : 'problem' in stored ? storedFileProblemNote(stored.problem) : !editable && replacement === null ? TOO_LARGE_STORED_NOTE : null;
  const shownProblem = problem ?? (testedNow && tested.problem !== undefined ? tested.problem : null);
  const lang = format === 'json' ? 'json' : null;

  const footer = (
    <div className="flex-none">
      {shownProblem === null ? null : (
        <p role="alert" className="mt-3 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-fg [overflow-wrap:anywhere]">
          {shownProblem}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
        <p role="status" className={cn(FOOTER_NOTE_CLASS, notice?.bad === true ? 'text-danger' : 'text-fg-muted')}>
          {notice?.text}
        </p>
        <span className="flex gap-2">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {CANCEL_LABEL}
          </Button>
          <Tooltip label={TEST_WITHOUT_SAVING_LABEL} shortcut={QUERY_TEST_SHORTCUT}>
            <Button aria-keyshortcuts="Meta+Enter Control+Enter" aria-busy={testing || undefined} disabled={!testing && !canTest} onClick={test}>
              {TEST_LABEL}
            </Button>
          </Tooltip>
          <Button variant={warned ? 'danger' : 'primary'} type="submit" form={fieldId} aria-busy={saving || undefined} disabled={locked || !changed || base === null}>
            {warned ? SAVE_ANYWAY_LABEL : SAVE_LABEL}
          </Button>
        </span>
      </div>
    </div>
  );

  return (
    <EditDialog
      name={title}
      title={EDIT_FILE_TITLE}
      description={title}
      saving={saving}
      unsaved={unsaved}
      unsavedWords={UNSAVED_WORDS}
      onLeave={onClose}
      footer={footer}
    >
      <form id={fieldId} onSubmit={onSubmit} className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
        <LabeledField
          label={FILE_LABEL}
          htmlFor={editable ? `${fieldId}-text` : undefined}
          note={describeFileNote(base?.name ?? source.name, format, base?.bytes ?? null, replacement !== null)}
          end={
            <>
              <IconButton size="sm" label={REPLACE_WITH_FILE_LABEL} icon={<Upload className="size-3.5" />} disabled={locked} onClick={() => picker.current?.click()} />
              <input ref={picker} type="file" hidden {...(keepsFormat ? {} : { accept: DATA_FILE_ACCEPT })} onChange={(event) => void pick(event)} />
            </>
          }
        >
          {storedNote === null ? null : <p className="text-[13px] text-fg-muted">{storedNote}</p>}
          {replacement !== null && !editable ? <p className="text-[13px] text-fg-muted">{TOO_LARGE_REPLACED_NOTE}</p> : null}
          {editable ? (
            <HighlightedCodeInput
              id={`${fieldId}-text`}
              rows={12}
              value={text}
              reading={{ lang }}
              readOnly={locked}
              spellCheck={false}
              onChange={(event) => {
                setTyped(event.target.value);
                resetChecks();
              }}
              onKeyDown={(event) => {
                if (!runOnModEnter(event, test)) blurOnEscape(event);
              }}
            />
          ) : null}
        </LabeledField>
        {testedNow && tested.table !== null && tested.table.columns.length > 0 ? <QueryTestResult table={tested.table} stale={false} /> : null}
      </form>
    </EditDialog>
  );
}
