import type { SheetFrame, SnapshotFrame } from '@open-artifact/runtime/sheet-api';

/** What the stream told of the Sheet: its snapshot, the revision it reached, and when each widget's code was published. */
export interface SheetState {
  snapshot: SnapshotFrame | null;
  revision: number;
  timesPublished: ReadonlyMap<string, number>;
}

export const EMPTY_SHEET_STATE: SheetState = { snapshot: null, revision: 0, timesPublished: new Map() };

export type SheetContent = { kind: 'loading' } | { kind: 'workbook'; nodeId: string; revision: number };

export function reduceSheetFrame(state: SheetState, frame: SheetFrame): SheetState {
  switch (frame.phase) {
    case 'snapshot':
      return { snapshot: frame, revision: frame.revision, timesPublished: new Map(frame.widgets.map(({ id, pub }) => [id, pub])) };
    case 'edit':
      return frame.revision > state.revision ? { ...state, revision: frame.revision } : state;
    case 'widget':
      return state.timesPublished.get(frame.id) === frame.pub ? state : { ...state, timesPublished: new Map(state.timesPublished).set(frame.id, frame.pub) };
    case 'clock':
    case 'tableRefresh':
      return state;
  }
}

export function describeSheet({ snapshot, revision }: SheetState): SheetContent {
  return snapshot === null ? { kind: 'loading' } : { kind: 'workbook', nodeId: snapshot.workbookId, revision };
}

export const canViewerEdit = ({ snapshot }: SheetState): boolean => snapshot?.viewer.canEdit === true;

export const viewerOf = ({ snapshot }: SheetState): string | null => snapshot?.viewer.personId ?? null;

/** Whether the page's person is the workbook's owner. */
export const isViewerTheOwner = ({ snapshot }: SheetState): boolean => snapshot?.viewer.isOwner === true;

/** When the workbook was made, in Unix seconds. */
export function madeAtUnixSeconds({ snapshot }: SheetState): number | null {
  const at = snapshot === null ? Number.NaN : Date.parse(snapshot.createdAt);
  return Number.isNaN(at) ? null : Math.floor(at / 1000);
}

/** What the server tells of itself in the snapshot: the newest format version it takes, whether it takes connected tables, and whether this page may edit. */
export interface StoreDescription {
  kind: 'stated';
  newestFormatVersion: number;
  takesConnectedTables: boolean;
  availability: 'open' | 'viewOnly';
}

/** The parts of a snapshot that tell of the server and of the page's person. */
export type StoreSnapshot = Pick<SnapshotFrame, 'newestFormatVersion' | 'viewer'> & { takesConnectedTables?: boolean };

export function describeStore(snapshot: StoreSnapshot): StoreDescription {
  return {
    kind: 'stated',
    newestFormatVersion: snapshot.newestFormatVersion,
    takesConnectedTables: snapshot.takesConnectedTables === true,
    availability: snapshot.viewer.canEdit ? 'open' : 'viewOnly',
  };
}
