import { translateMessage, MESSAGE_LOCALE } from '../i18n/messages.ts';
/** Where a protection is, as the protection pane writes it. */
export type ProtectionPlace =
  | { kind: 'cells'; written: string }
  | { kind: 'sheet'; open: string }
  | { kind: 'columns' | 'rows'; lines: { first: string; last: string } };
/** What was last done to a protection. */
export interface ProtectionDone {
  what: 'protectionMade' | 'protectionSaved' | 'protectionRemoved';
  place: ProtectionPlace;
  sheetName: string;
}
/** Why an edit was refused because of a protection. */
export type ProtectionRefusal = 'cellsProtected' | 'linesProtected' | 'sheetProtected' | 'protectionNotTheirs' | 'protectionIsGone';
export function protectionPlaceLabel(place: ProtectionPlace): string {
  switch (place.kind) {
    case 'cells':
      return place.written;
    case 'sheet':
      return translateMessage(
        {
          defaultMessage: '{isAll, select, true {Whole sheet} other {Whole sheet except {open}}}',
          id: 'qYFp6ldEa+',
        },
        {
          isAll: `${place.open === ''}`,
          open: place.open,
        },
      );
    case 'columns':
    case 'rows': {
      let { first, last } = place.lines;
      let oneLine = place.kind === 'rows' ? 'row' : 'column';
      return translateMessage(
        {
          defaultMessage: '{lines, select, row {Row {first}} rows {Rows {first} to {last}} column {Column {first}} other {Columns {first} to {last}}}',
          id: 'mNDfAeGuca',
        },
        {
          lines: first === last ? oneLine : place.kind,
          first,
          last,
        },
      );
    }
  }
}
export function protectionPlaceInSentence({ what, place, sheetName }: ProtectionDone): string {
  switch (place.kind) {
    case 'cells':
      return place.written;
    case 'sheet':
      return translateMessage(
        {
          defaultMessage: '{isAll, select, true {sheet “{name}”} other {sheet “{name}” except {open}}}',
          id: 'HcJ+0eqo5H',
        },
        {
          isAll: `${place.open === '' || what === 'protectionRemoved'}`,
          name: sheetName,
          open: place.open,
        },
      );
    case 'columns':
    case 'rows': {
      let { first, last } = place.lines;
      let oneLine = place.kind === 'rows' ? 'row' : 'column';
      return translateMessage(
        {
          defaultMessage: '{lines, select, row {row {first}} rows {rows {first} to {last}} column {column {first}} other {columns {first} to {last}}}',
          id: 'kqb53FsZPd',
        },
        {
          lines: first === last ? oneLine : place.kind,
          first,
          last,
        },
      );
    }
  }
}
export function protectionRefusalText(why: ProtectionRefusal): string {
  switch (why) {
    case 'cellsProtected':
      return translateMessage({
        defaultMessage: 'These cells are protected. Ask an owner to let you edit them.',
        id: 'wmY3RNODfF',
      });
    case 'linesProtected':
      return translateMessage({
        defaultMessage: 'These rows or columns include protected cells, so they can’t be changed. Ask an owner to let you edit those cells.',
        id: 'TWhcflsg1o',
      });
    case 'sheetProtected':
      return translateMessage({
        defaultMessage: 'This sheet is protected, so that can’t be changed. Ask an owner to let you edit it.',
        id: 'ewXsNPXp6C',
      });
    case 'protectionNotTheirs':
      return translateMessage({
        defaultMessage: 'Only people who can edit these cells can change their protection.',
        id: '5zedr5rZxL',
      });
    case 'protectionIsGone':
      return translateMessage({
        defaultMessage: 'That protection was already removed.',
        id: '0Mt3rLIkj7',
      });
  }
}
export const protectionMessages = {
  protectCells: () =>
    translateMessage({
      defaultMessage: 'Protect cells',
      id: 'qmrYoGq9bP',
    }),
  protect: () =>
    translateMessage({
      defaultMessage: 'Protect',
      id: '3PXFXBLVxD',
    }),
  title: () =>
    translateMessage({
      defaultMessage: 'Protection',
      id: 'lrGf1j5xmR',
    }),
  alreadyProtected: () =>
    translateMessage({
      defaultMessage: 'Already protected',
      id: 'BdaxXHin0m',
    }),
  open: () =>
    translateMessage({
      defaultMessage: 'Open',
      id: 'Tp6p3Vpf9b',
    }),
  back: () =>
    translateMessage({
      defaultMessage: 'Back to sheet protection',
      id: 'KyP890pyfA',
    }),
  whoCanEdit: () =>
    translateMessage({
      defaultMessage: 'Who can edit',
      id: 'EVTRlySPgE',
    }),
  ownersCanAlwaysEdit: () =>
    translateMessage({
      defaultMessage: 'Owners can always edit.',
      id: 'wmyCLeo1Lq',
    }),
  leftOpen: () =>
    translateMessage({
      defaultMessage: 'Don’t protect these cells',
      id: 'aoYSA8iyty',
    }),
  save: () =>
    translateMessage({
      defaultMessage: 'Save',
      id: 'RmBwIvHdpZ',
    }),
  remove: () =>
    translateMessage({
      defaultMessage: 'Remove protection',
      id: '/RNKxIVGIT',
    }),
  saidOfCell: () =>
    translateMessage({
      defaultMessage: 'Protected',
      id: 'Gbavu7UkIf',
    }),
  you: () =>
    translateMessage({
      defaultMessage: 'You',
      id: 'Q/4myC8LdN',
    }),
  someone: () =>
    translateMessage({
      defaultMessage: 'Someone',
      id: 'Ufd9tY9MgR',
    }),
};
export const openProtectionForLabel = (place: ProtectionPlace): string =>
  translateMessage(
    {
      defaultMessage: 'Open protection for {place}',
      id: 'opIPSCJhhw',
    },
    {
      place: protectionPlaceLabel(place),
    },
  );
export const whoCanEditText = (names: readonly string[]): string =>
  names.length === 0
    ? translateMessage({
        defaultMessage: 'Only owners can edit.',
        id: '4hd0i93toU',
      })
    : translateMessage(
        {
          defaultMessage: '{names} can edit.',
          id: '9LxQYWL+YV',
        },
        {
          names: new Intl.ListFormat(MESSAGE_LOCALE).format(names),
        },
      );
export const protectedSheetTabLabel = (name: string): string =>
  translateMessage(
    {
      defaultMessage: '{name}, protected',
      id: '/dSOOISIPX',
    },
    {
      name,
    },
  );
export const protectionDoneText = (done: ProtectionDone): string =>
  translateMessage(
    {
      defaultMessage:
        '{what, select, protectionMade {Protected {place}} protectionSaved {Saved protection for {place}} other {Removed protection from {place}}}',
      id: 'lz4T/9PYH1',
    },
    {
      what: done.what,
      place: protectionPlaceInSentence(done),
    },
  );
export const tooManyProtectionsText = (most: number): string =>
  translateMessage(
    {
      defaultMessage:
        '{most, plural, one {This Sheet already has # protection. Remove it to add another.} other {This Sheet already has # protections. Remove one to add another.}}',
      id: 'pJ9riXoUWC',
    },
    {
      most,
    },
  );
export const cellProtectedText = (): string =>
  translateMessage({
    defaultMessage: 'This cell is protected. Ask an owner to let you edit it.',
    id: 'dWYuUnqjIK',
  });
