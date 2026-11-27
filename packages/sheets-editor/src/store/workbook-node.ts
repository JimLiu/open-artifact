import type { EditToSave } from './workbook-sync.ts';
import {
  classifyStoreFailure,
  saveEditRequest,
  readSaveOutcome,
  loadRequest,
  readLoadedOps,
  readAskedRevision,
  askRevisionRequest,
  loadTableFileRequest,
  readTableFileSlice,
  type FailureCause,
  type FileCursor,
  type LoadOutcome,
  type SaveOutcome,
  type TableFileSlice,
} from './requests.ts';
import type { StoreCall, StoreOutcome } from './sheet-stream.ts';

/** A failure the page keeps in mind (it decides whether opening failed for good, or may pass). */
export interface NotedFailure {
  action: 'save' | 'load' | 'loadChart' | 'loadTableFile' | 'readHistory' | 'nameVersion' | 'bringLocale';
  cause: FailureCause;
  word: string;
}

export type StoreCaller = (call: StoreCall) => Promise<StoreOutcome>;

/** The failure of a call that came to nothing, or null when it came to something (`isOk` for answers that are not refusals). */
export function failureOf(outcome: StoreOutcome, isOk: boolean): { cause: FailureCause; word: string } | null {
  const failure = classifyStoreFailure(outcome) ?? (isOk ? null : { cause: 'storeFailed' as const, word: 'answerNotUnderstood' });
  return failure === null ? null : { cause: failure.cause, word: failure.word };
}

/** The workbook's calls to the server: its saves, its load and the revision the log stands at. */
export function createWorkbookNodeClient(call: StoreCaller, noteFailure: (failure: NotedFailure) => void) {
  return {
    async save(save: EditToSave): Promise<SaveOutcome> {
      const outcome = await call(saveEditRequest(save));
      const saveOutcome = readSaveOutcome(outcome);
      const failure = failureOf(outcome, saveOutcome.kind === 'saved');
      const refusedOnLastSend = saveOutcome.kind === 'refusedForNow' && save.isLastSend;
      if (failure !== null) noteFailure({ ...failure, ...(refusedOnLastSend && { cause: 'refused' }), action: 'save' });
      return saveOutcome;
    },
    async loadOps(): Promise<LoadOutcome> {
      const outcome = await call(loadRequest());
      const loaded = readLoadedOps(outcome);
      const failure = failureOf(outcome, loaded !== null);
      if (failure !== null) noteFailure({ ...failure, action: 'load' });
      return loaded;
    },
    /** Slices of a connected table's snapshot file. */
    async loadSliceOfTableFile(snapshotId: string, held: FileCursor | null): Promise<TableFileSlice> {
      const from = held?.byteCountHeld ?? 0;
      const outcome = await call(loadTableFileRequest(snapshotId, from));
      const slice = readTableFileSlice(outcome, held, from);
      const failure = failureOf(outcome, slice !== null && slice !== 'startOver');
      if (failure !== null) noteFailure({ ...failure, action: 'loadTableFile' });
      return slice;
    },
    askRevision: async (): Promise<number | 'notSent' | null> => readAskedRevision(await call(askRevisionRequest())),
  };
}

export type WorkbookStore = Pick<ReturnType<typeof createWorkbookNodeClient>, 'save' | 'loadOps' | 'loadSliceOfTableFile' | 'askRevision'>;
