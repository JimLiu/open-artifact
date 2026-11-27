import * as React from 'react';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { connectedTableMessages } from './connected-table-messages.ts';
import type { PieceOfCode } from './sql-code.ts';
import type { CallShown } from './connected-table-view.ts';

export function WrittenCode({ written }: { written: PieceOfCode[] }): React.ReactNode {
  return written.map((piece) =>
    'seen' in piece ? (
      piece.kind === void 0 ? (
        piece.seen
      ) : (
        <span key={piece.from} className="dash-code-kind" data-kind={piece.kind}>
          {piece.seen}
        </span>
      )
    ) : (
      <span
        key={piece.from}
        className={`mx-px rounded bg-alpha-2 box-decoration-clone px-xs text-footnote text-secondary ${piece.unseen.spelled === null ? 'whitespace-nowrap' : ''}`}
      >
        {sheetMessages.charactersNotSeen(piece.unseen)}
      </span>
    ),
  );
}
export function CodeOfCall({ written }: { written: PieceOfCode[] }): React.ReactNode {
  return (
    <dd dir="ltr" className="col-span-2 rounded bg-alpha-1 p-sm font-mono wrap-anywhere whitespace-pre-wrap text-primary">
      <WrittenCode written={written} />
    </dd>
  );
}
export function CallField({ label, written, isCode = false }: { label: string; written: PieceOfCode[]; isCode?: boolean }): React.ReactNode {
  return (
    <>
      <dt>{label}</dt>
      <dd className={`min-w-0 wrap-anywhere text-primary ${isCode ? 'font-mono' : ''}`}>
        <bdi>
          <WrittenCode written={written} />
        </bdi>
      </dd>
    </>
  );
}
export function CallView({ call }: { call: CallShown }): React.ReactNode {
  return (
    <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-sm text-footnote text-secondary">
      <CallField label={connectedTableMessages.connector()} written={call.connector} />
      {call.requests.map(({ tool, argumentsOfTool }, index) => {
        let label = index === 0 ? connectedTableMessages.tool() : connectedTableMessages.toolThatFollowsUp();
        return (
          <React.Fragment key={label}>
            <CallField label={label} written={tool} isCode />
            {argumentsOfTool.map(({ value }) => (
              <CodeOfCall key={value.toCopy} written={value.written} />
            ))}
          </React.Fragment>
        );
      })}
      <dt className="col-span-2">{connectedTableMessages.transform()}</dt>
      <CodeOfCall written={call.transform.written} />
    </dl>
  );
}
