import { translateMessage } from '../i18n/messages.ts';
/** Why the named range form refused a name or a range, as the form tells it. */
export type NamedRangeFormRefusal =
  | 'nameTaken'
  | 'nameStartsWrong'
  | 'nameHoldsOtherSigns'
  | 'nameIsTrueOrFalse'
  | 'nameLooksLikeACell'
  | 'nameKeptForFiles'
  | 'addressNamesNoCells'
  | 'tooMany'
  | 'isGone';
/** The words of the toast that offers to undo the delete of a named range. */
export interface NamedRangeDeletedNotice {
  title: string;
  undoLabel: string;
}
export function namedRangeRefusalText(why: NamedRangeFormRefusal, name: string, most: number): string {
  switch (why) {
    case 'nameTaken':
      return namedRangeMessages.nameTaken();
    case 'nameStartsWrong':
      return translateMessage({
        defaultMessage: 'Start the name with a letter or underscore.',
        id: 'rNpmSkIBjl',
      });
    case 'nameHoldsOtherSigns':
      return translateMessage({
        defaultMessage: 'Use only letters, numbers, underscores, and periods.',
        id: 'PMZI/vBs3T',
      });
    case 'nameIsTrueOrFalse':
      return translateMessage({
        defaultMessage: 'TRUE and FALSE can’t be names.',
        id: 'No/i96JI6c',
      });
    case 'nameLooksLikeACell':
      return translateMessage(
        {
          defaultMessage: '“{name}” looks like a cell, so it can’t be a name.',
          id: '2b9QCG+Ux7',
        },
        {
          name,
        },
      );
    case 'nameKeptForFiles':
      return translateMessage({
        defaultMessage: 'Names can’t start with “_xl”.',
        id: 'YlkX7LkBmD',
      });
    case 'addressNamesNoCells':
      return translateMessage({
        defaultMessage: 'Enter one range in this Sheet, like B2:B9.',
        id: '4jeRy2Ff9G',
      });
    case 'tooMany':
      return translateMessage(
        {
          defaultMessage: 'That named range wasn’t saved, because this Sheet already has {most, number} named ranges. Delete one, then try again.',
          id: '1hwqNP7UAU',
        },
        {
          most,
        },
      );
    case 'isGone':
      return namedRangeMessages.isGone();
  }
}
export function namedRangeDeletedNotice({ name, isSaved }: { name: string; isSaved: boolean }): NamedRangeDeletedNotice {
  return {
    title: isSaved
      ? translateMessage(
          {
            defaultMessage: 'Deleted “{name}”',
            id: 'cqhwSjWoNh',
          },
          {
            name,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Deleting “{name}”…',
            id: '0uTi5pwa5w',
          },
          {
            name,
          },
        ),
    undoLabel: translateMessage({
      defaultMessage: 'Undo delete',
      id: 'OIQg9Et/n4',
    }),
  };
}
export const namedRangeMessages = {
  namedRanges: () =>
    translateMessage({
      defaultMessage: 'Named ranges',
      id: 'N4QFP2TmM9',
    }),
  nameThisRange: () =>
    translateMessage({
      defaultMessage: 'Name this range',
      id: 'tAPWUXqtJB',
    }),
  manage: () =>
    translateMessage({
      defaultMessage: 'Manage named ranges',
      id: 'cG2WBy8y1E',
    }),
  add: () =>
    translateMessage({
      defaultMessage: 'Add named range',
      id: '4ueRtwjGO6',
    }),
  noneYet: () =>
    translateMessage({
      defaultMessage: 'Name a range to use it in formulas, like =SUM(Sales).',
      id: 'wH26VP4h/+',
    }),
  name: () =>
    translateMessage({
      defaultMessage: 'Name',
      id: '4Uef0Kg0GC',
    }),
  range: () =>
    translateMessage({
      defaultMessage: 'Range',
      id: 't6zbGZLk/u',
    }),
  save: () =>
    translateMessage({
      defaultMessage: 'Save',
      id: 'JnaSmP7+a6',
    }),
  cellsWereDeleted: () =>
    translateMessage({
      defaultMessage: 'Cells were deleted',
      id: 'JPLKOGDzgK',
    }),
  nameTaken: () =>
    translateMessage({
      defaultMessage: 'Another named range or connected table already has this name. Enter a different name.',
      id: 'rHaK02Kfh+',
    }),
  isGone: () =>
    translateMessage({
      defaultMessage: 'That named range wasn’t saved, because it was deleted.',
      id: 'wqPwIYwh2x',
    }),
};
export const editNamedRangeLabel = (name: string): string =>
  translateMessage(
    {
      defaultMessage: 'Edit “{name}”',
      id: 'xClKcG1zxo',
    },
    {
      name,
    },
  );
export const deleteNamedRangeLabel = (name: string): string =>
  translateMessage(
    {
      defaultMessage: 'Delete “{name}”',
      id: 'ZIppjNy4Vf',
    },
    {
      name,
    },
  );
export const formulasOnSeveralSheetsText = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {This affects # formula on several sheets.} other {This affects # formulas on several sheets.}}',
      id: 'wYNWpFl/6a',
    },
    {
      count,
    },
  );
export const namedRangeSavedText = (name: string): string =>
  translateMessage(
    {
      defaultMessage: 'Saved “{name}”',
      id: '3zkMwyzQTq',
    },
    {
      name,
    },
  );
