import type { DefaultsRefusal as RefusalOfDefaults } from '@open-artifact/sheets-core';
import { translateMessage } from '../i18n/messages.ts';
/** The limits of a cell an entry was refused for, written in the cell's number format. */
export interface WrittenValueLimits {
  minimum?: string | null;
  maximum?: string | null;
}
/** Why the default and limits form refused what was typed. */
export type DefaultsRefusal = Extract<
  RefusalOfDefaults,
  'limitIsNoNumber' | 'minimumAboveMaximum' | 'defaultValueNotPlain' | 'defaultValueIsNoOption' | 'defaultValueOutsideLimits'
>;
/** What was last done to defaults and limits. */
export type DefaultsDone = { what: 'defaultsSaved' } | { what: 'defaultAndLimitsSaved' } | { what: 'defaultsReset'; count: number };
export function resetToDefaultsLabel({ to }: { to: string | null }): string {
  if (to === null)
    return translateMessage({
      defaultMessage: 'Reset to defaults',
      id: 'CZwG8T1cet',
    });
  return to === ''
    ? translateMessage({
        defaultMessage: 'Reset to blank',
        id: 'PlzDp/CHmB',
      })
    : translateMessage(
        {
          defaultMessage: 'Reset to {value}',
          id: 'y+ohtZmBug',
        },
        {
          value: to,
        },
      );
}
export function defaultsRefusalText(why: DefaultsRefusal): string {
  switch (why) {
    case 'limitIsNoNumber':
      return translateMessage({
        defaultMessage: 'Enter a number.',
        id: '+NwC1xjUjl',
      });
    case 'minimumAboveMaximum':
      return translateMessage({
        defaultMessage: 'The minimum can’t be above the maximum.',
        id: 'iuxUJsAdU+',
      });
    case 'defaultValueNotPlain':
      return translateMessage({
        defaultMessage: 'A default can’t be a formula.',
        id: 'PTA6WcH5+l',
      });
    case 'defaultValueIsNoOption':
      return translateMessage({
        defaultMessage: 'Pick one of the dropdown’s options.',
        id: 'sCt9GMszeb',
      });
    case 'defaultValueOutsideLimits':
      return translateMessage({
        defaultMessage: 'The default has to be within the minimum and maximum.',
        id: 'x713j8ToD3',
      });
  }
}
export function outsideLimitsText(limits: WrittenValueLimits | null | undefined): string {
  let { minimum = null, maximum = null } = limits ?? {};
  if (minimum !== null && maximum !== null)
    return translateMessage(
      {
        defaultMessage: 'Enter a number from {minimum} to {maximum}.',
        id: '+znwBiu6yF',
      },
      {
        minimum,
        maximum,
      },
    );
  if (minimum !== null)
    return translateMessage(
      {
        defaultMessage: 'Enter a number of {minimum} or more.',
        id: 'XAi4lGYsxE',
      },
      {
        minimum,
      },
    );
  if (maximum !== null)
    return translateMessage(
      {
        defaultMessage: 'Enter a number of {maximum} or less.',
        id: 'jf+Y+wVLA/',
      },
      {
        maximum,
      },
    );
  return translateMessage({
    defaultMessage: 'That change wasn’t made, because some cells take only numbers within their limits.',
    id: 'L4qKyKQ0Yj',
  });
}
export function defaultsDoneText(done: DefaultsDone): string {
  switch (done.what) {
    case 'defaultsSaved':
      return translateMessage({
        defaultMessage: 'Saved as default',
        id: 'DBB1D/YY7T',
      });
    case 'defaultAndLimitsSaved':
      return translateMessage({
        defaultMessage: 'Default and limits saved',
        id: 'p4acbU7vOT',
      });
    case 'defaultsReset':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {# cell reset} other {# cells reset}}',
          id: 'z25qm//uKA',
        },
        {
          count: done.count,
        },
      );
  }
}
export const defaultsAndLimitsMessages = {
  defaultAndLimits: () =>
    translateMessage({
      defaultMessage: 'Default and limits',
      id: '42KVuGUTAE',
    }),
  saveAsDefault: () =>
    translateMessage({
      defaultMessage: 'Save as default',
      id: 'xnrU6+UgJL',
    }),
  changedCells: () =>
    translateMessage({
      defaultMessage: 'Changed cells',
      id: 'RCG21dgljw',
    }),
  defaultValue: () =>
    translateMessage({
      defaultMessage: 'Default',
      id: 'dMRxa0mRcS',
    }),
  minimum: () =>
    translateMessage({
      defaultMessage: 'Minimum',
      id: '0+u5SM1qXd',
    }),
  maximum: () =>
    translateMessage({
      defaultMessage: 'Maximum',
      id: 'mibu71lfVi',
    }),
  hintOfLimits: () =>
    translateMessage({
      defaultMessage: 'Numbers outside these limits can’t be entered.',
      id: 'm23LJOTEuO',
    }),
  mixed: () =>
    translateMessage({
      defaultMessage: 'Mixed',
      id: 'Qi1w8G2yvA',
    }),
  blank: () =>
    translateMessage({
      defaultMessage: 'Blank',
      id: 'MF2bGcIth0',
    }),
  remove: () =>
    translateMessage({
      defaultMessage: 'Remove',
      id: 'bosdY6wgqJ',
    }),
  save: () =>
    translateMessage({
      defaultMessage: 'Save',
      id: '4AdZZSwPme',
    }),
  enterTrueOrFalse: () =>
    translateMessage({
      defaultMessage: 'Enter TRUE or FALSE.',
      id: 'TcDe8sxmW1',
    }),
  onlyPlainValues: () =>
    translateMessage({
      defaultMessage: 'Formulas, people, and long or formatted text can’t be saved as defaults. Select cells with a plain value instead.',
      id: '42D4hFL/Rt',
    }),
  resetAll: () =>
    translateMessage({
      defaultMessage: 'Reset all',
      id: 'oOY9SKp/Qj',
    }),
  noneChanged: () =>
    translateMessage({
      defaultMessage: 'Cells changed from their defaults will appear here.',
      id: 'ypLnU8a5bx',
    }),
};
export const resetCellLabel = (cell: string): string =>
  translateMessage(
    {
      defaultMessage: 'Reset {cell}',
      id: 'W6RGhvVJjV',
    },
    {
      cell,
    },
  );
export const defaultValueLabel = (value: string): string =>
  value === ''
    ? translateMessage({
        defaultMessage: 'Default blank',
        id: 'z+CzpuJ03i',
      })
    : translateMessage(
        {
          defaultMessage: 'Default {value}',
          id: '6Ovt9Boi+M',
        },
        {
          value,
        },
      );
export const changedFromDefaultLabel = (value: string): string =>
  value === ''
    ? translateMessage({
        defaultMessage: 'Changed from a blank default',
        id: 'WOClx29JVO',
      })
    : translateMessage(
        {
          defaultMessage: 'Changed from default {value}',
          id: 'Iv95xeaXyP',
        },
        {
          value,
        },
      );
export const moreChangedCellsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# more changed cell} other {# more changed cells}}',
      id: 'v4xmXGIr6Q',
    },
    {
      count,
    },
  );
export const tooManyDefaultsText = (most: number): string =>
  translateMessage(
    {
      defaultMessage:
        '{most, plural, one {A Sheet can have up to # cell with a default. Remove some defaults to add more.} other {A Sheet can have up to # cells with a default. Remove some defaults to add more.}}',
      id: 'hcrlR4BPdi',
    },
    {
      most,
    },
  );
