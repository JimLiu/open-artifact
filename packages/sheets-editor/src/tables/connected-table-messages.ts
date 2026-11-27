import { MESSAGE_LOCALE, translateMessage } from '../i18n/messages.ts';
import type { MessagePart } from '../i18n/messages.ts';
import type { ConnectedTableRefusalWhy } from './connected-table-host.ts';
import type { ConnectedTableStands } from './connected-table-view.ts';
export function connectedTableRefusalWords(why: ConnectedTableRefusalWhy, connector: string): string {
  switch (why) {
    case 'notJustNow':
      return translateMessage({
        defaultMessage: 'Couldn’t refresh right now. Try again in a moment.',
        id: 'XJHknCpksL',
      });
    case 'noRowInTime':
      return translateMessage(
        {
          defaultMessage: '{connector} didn’t return data in time. Try again.',
          id: 'Xsyi49u4a/',
        },
        { connector },
      );
    case 'callChanged':
      return translateMessage({
        defaultMessage:
          'Someone changed this request. Refresh again to review it.',
        id: 'Dd/BGEADTg',
      });
    case 'callNotWellFormed':
      return translateMessage({
        defaultMessage:
          'The request isn’t set up correctly. Ask the agent to fix it.',
        id: 'GgMivNkWZ9',
      });
    case 'answerNotRead':
      return translateMessage({
        defaultMessage:
          'The answer couldn’t be read. Ask the agent to fix the transform.',
        id: 'lsbhubylVu',
      });
    case 'answerTooLarge':
      return translateMessage(
        {
          defaultMessage:
            '{connector} returned too much data. Ask the agent to narrow the request.',
          id: '6CfW99PyVs',
        },
        { connector },
      );
    case 'toolError':
      return translateMessage(
        {
          defaultMessage: '{connector} returned an error. Try again.',
          id: 'vfDk/eoKH1',
        },
        { connector },
      );
    case 'callFailed':
      return translateMessage(
        {
          defaultMessage: '{connector} didn’t answer. The request may have run.',
          id: 'u4I8wyAhko',
        },
        { connector },
      );
    case 'connectorNotServed':
      return translateMessage(
        {
          defaultMessage: '{connector} can’t fill a table yet.',
          id: 'jfgO59fM+W',
        },
        { connector },
      );
    case 'notConnected':
      return translateMessage(
        {
          defaultMessage: 'Connect {connector}, then try again.',
          id: '1zL6XFUy3s',
        },
        { connector },
      );
    case 'reconnect':
      return translateMessage(
        {
          defaultMessage: 'Reconnect {connector}, then try again.',
          id: 'pjPWZeA3ds',
        },
        { connector },
      );
    case 'severalConnectorsHaveTheName':
      return translateMessage(
        {
          defaultMessage: 'You have more than one connector named {connector}.',
          id: 'GjaDNUraSN',
        },
        { connector },
      );
    case 'toolNotAllowedHere':
      return translateMessage(
        {
          defaultMessage: 'This Sheet isn’t allowed to use this {connector} tool.',
          id: 'QO6ITjgF+h',
        },
        { connector },
      );
    case 'toolAsksFirst':
      return translateMessage(
        {
          defaultMessage:
            'This {connector} tool needs approval each time, so it can’t refresh a table.',
          id: 'seVMPp3gGN',
        },
        { connector },
      );
    case 'toolNotAskedFor':
      return translateMessage(
        {
          defaultMessage: '{connector} wasn’t allowed for this Sheet. Try again.',
          id: '0I1quuCxBC',
        },
        { connector },
      );
    case 'notServed':
      return translateMessage({
        defaultMessage: 'Refreshing isn’t available here.',
        id: '6p6CLwD21m',
      });
    case 'signInLapsed':
      return translateMessage({
        defaultMessage: 'Your sign-in expired. Reload the page, then try again.',
        id: 'GhBfSm9CRY',
      });
    case 'noRoomInWorkbook':
      return translateMessage({
        defaultMessage: 'This Sheet has no room for more data.',
        id: 'FdgG+9eR7D',
      });
    case 'notAllowed':
      return translateMessage({
        defaultMessage: 'This Sheet isn’t allowed to refresh its tables.',
        id: 'N5LHyQUa37',
      });
    case 'unconfirmed':
      return translateMessage({
        defaultMessage:
          'No confirmation came back. The table may have been updated.',
        id: 'UIzc9ev/JH',
      });
    case 'failed':
      return translateMessage({
        defaultMessage: 'The refresh couldn’t finish.',
        id: 'pDGXj+UqJp',
      });
  }
}
export function connectedTableStandsWords(stands: ConnectedTableStands, connector: string, canRefresh: boolean): string {
  switch (stands.kind) {
    case 'refused':
      return connectedTableRefusalWords(stands.why, connector);
    case 'refreshing':
      return translateMessage({
        defaultMessage: 'Refreshing…',
        id: 'c3HcwiUelR',
      });
    case 'loadingRows':
      return translateMessage({
        defaultMessage: 'Loading rows…',
        id: 'ckffZnENBo',
      });
    case 'notFetched':
      return canRefresh
        ? translateMessage({
            defaultMessage: 'No data loaded yet.',
            id: '3iTtk8xSUe',
          })
        : translateMessage({
            defaultMessage: 'No data loaded yet. Ask an editor to load it.',
            id: 'OINTe+UGXN',
          });
    case 'rowsNotKept':
      return canRefresh
        ? translateMessage({
            defaultMessage:
              'These rows are no longer available. Refresh to load them again.',
            id: 'PcZtSNR67U',
          })
        : translateMessage({
            defaultMessage:
              'These rows are no longer available. Ask an editor to refresh.',
            id: 'lZzESXJQIM',
          });
    case 'stale':
      return canRefresh
        ? translateMessage({
            defaultMessage:
              'The request changed. Refresh to update these rows.',
            id: 'kUnCCYmgLj',
          })
        : translateMessage({
            defaultMessage: 'The request changed. Ask an editor to refresh.',
            id: '45y68x22Pn',
          });
    case 'current': {
      let { rowCount, fetchedAtMs } = stands,
        [date, time] = [
          CONNECTED_TABLE_DATE_FORMAT.format(fetchedAtMs),
          CONNECTED_TABLE_TIME_FORMAT.format(fetchedAtMs),
        ];
      return stands.isCutOff
        ? translateMessage(
            {
              defaultMessage:
                '{count, plural, one {Only the first row loaded} other {Only the first # rows loaded}} · Refreshed {date} at {time}',
              id: 'Ge92Lx0aoB',
            },
            { count: rowCount, date, time },
          )
        : translateMessage(
            {
              defaultMessage:
                '{count, plural, one {# row} other {# rows}} · Refreshed {date} at {time}',
              id: 'dTQyV2ReKz',
            },
            { count: rowCount, date, time },
          );
    }
  }
}
export const connectedTableMessages = {
    connectedTable: () =>
      translateMessage({
        defaultMessage: 'Connected table',
        id: '9jDTU23P1Z',
      }),
    loadData: () =>
      translateMessage({
        defaultMessage: 'Load data',
        id: 'tEReMBZoZE',
      }),
    refresh: () =>
      translateMessage({
        defaultMessage: 'Refresh',
        id: 'NK/aHWqqhw',
      }),
    source: () =>
      translateMessage({
        defaultMessage: 'Source',
        id: 'krrP2h5F36',
      }),
    showMore: () =>
      translateMessage({
        defaultMessage: 'Show more',
        id: 'xkQEwJqJ6X',
      }),
    showLess: () =>
      translateMessage({
        defaultMessage: 'Show less',
        id: 'eCtNg0mkl+',
      }),
    copyCode: (name: string) =>
      translateMessage(
        {
          defaultMessage: 'Copy {name}',
          id: '8MW05OZRVo',
        },
        { name },
      ),
    copied: () =>
      translateMessage({
        defaultMessage: 'Copied',
        id: '8+KUnzvqNU',
      }),
    hasNoAddresses: () =>
      translateMessage({
        defaultMessage:
          'Formulas can’t point to cells like A2 in a connected table. Use a column name instead, like Orders[Net].',
        id: '7uK8kwHMhI',
      }),
    copyColumn: () =>
      translateMessage({
        defaultMessage: 'Copy column',
        id: 'QOVtMcURkJ',
      }),
    copyNameForFormulas: () =>
      translateMessage({
        defaultMessage: 'Copy name for formulas',
        id: 'YCjN760YMU',
      }),
    noRowsMatch: () =>
      translateMessage({
        defaultMessage: 'No rows match your filter.',
        id: 'DXIgjhF7qb',
      }),
    dismiss: () =>
      translateMessage({
        defaultMessage: 'Dismiss',
        id: 'q3UHtcHPmW',
      }),
    connector: () =>
      translateMessage({
        defaultMessage: 'Connector',
        id: 'pcALYpdmq4',
      }),
    tool: () =>
      translateMessage({
        defaultMessage: 'Tool',
        id: 'DMWUXFG93w',
      }),
    toolThatFollowsUp: () =>
      translateMessage({
        defaultMessage: 'Then',
        id: 'EGgnZRgcrR',
      }),
    transform: () =>
      translateMessage({
        defaultMessage: 'Transform',
        id: 'ORq7Phh933',
      }),
    runWithYourAccess: () =>
      translateMessage({
        defaultMessage: 'Run with your access?',
        id: 'u1cI4e3oin',
      }),
    whoSees: () =>
      translateMessage({
        defaultMessage:
          'This request uses your connector access. Everyone who can open this Sheet will see the results.',
        id: 'suppLd3fcP',
      }),
    mayChangeData: () =>
      translateMessage({
        defaultMessage:
          'This tool isn’t marked read-only, so it may change data outside this Sheet.',
        id: 'LzRgrJ06J5',
      }),
    mayRunTwice: () =>
      translateMessage({
        defaultMessage:
          'The first time you use a tool in this Sheet, it may run twice.',
        id: 'aHbEFuIzSU',
      }),
    run: () =>
      translateMessage({
        defaultMessage: 'Run',
        id: 'JUWHFwpQtk',
      }),
    takesNoEdit: () =>
      translateMessage({
        defaultMessage:
          'This table’s data comes from a connector, so it can’t be edited here.',
        id: 'hneYPX+mt7',
      }),
  };
export const CONNECTED_TABLE_DATE_FORMAT = new Intl.DateTimeFormat(
    MESSAGE_LOCALE,
    { dateStyle: 'short' },
  );
export const CONNECTED_TABLE_TIME_FORMAT = new Intl.DateTimeFormat(
    MESSAGE_LOCALE,
    { timeStyle: 'short' },
  );
export const connectedTableStandsWordParts = (stands: ConnectedTableStands, connector: string, canRefresh: boolean): MessagePart[] =>
    stands.kind === 'refused' && stands.toolSaid !== null
      ? translateMessage(
          {
            defaultMessage: '{connector} returned an error: “{words}”',
            id: 'mmKF+Lc0n3',
          },
          { connector, words: [{ setApart: stands.toolSaid }] },
        )
      : [connectedTableStandsWords(stands, connector, canRefresh)];
