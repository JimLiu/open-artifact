import * as React from 'react';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { Spinner } from '../kit/spinner.tsx';
import { ContentsBox } from '../ui/contents-box.tsx';
import { WordsWithColumnNames } from '../ui/card-rows.tsx';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import type { MessagePart } from '../i18n/messages.ts';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import { connectedTableMessages } from './connected-table-messages.ts';
import type { ConnectedTableBarShown } from './connected-table-view.ts';

export interface ConnectedTableBarProps {
  ref: React.Ref<HTMLFieldSetElement>;
  bar: ConnectedTableBarShown;
  howItStandsInWords: MessagePart[];
  /** `null` when the table cannot be refreshed from here. */
  onRefresh: (() => void) | null;
  /** `null` when the agent cannot be asked from here. */
  onAgentAsked: (() => void) | null;
  onRefusalSentAway: () => void;
  onSourceToggled: () => void;
  hasUnsavedEdits: boolean;
  onKeyDown: (keyEvent: React.KeyboardEvent) => void;
  className: string;
  style: StyleWithVariables;
}

export const ConnectedTableBar = React.memo(function ({ ref, ...props }: ConnectedTableBarProps) {
  let { bar, onRefresh, onAgentAsked } = props,
    { connector, stands } = bar,
    labelId = React.useId();
  return (
    <fieldset ref={ref} aria-labelledby={labelId} className={`sheet-own-filter-bar sheet-connected-table-bar ${props.className}`} style={props.style}>
      <ContentsBox onMouseDown={preventMouseDownDefault} onKeyDown={props.onKeyDown}>
        <div className="sheet-own-filter-parts">
          <span aria-hidden className="sheet-own-filter-glyph">
            {bar.isLoading ? <Spinner size="sm" inheritColor /> : <Icon name={bar.isAmiss ? 'Warning' : 'Database'} customSize={14} />}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-sm gap-y-xs">
            <bdi id={labelId} className="min-w-0 truncate font-semibold">
              {connector ?? connectedTableMessages.connectedTable()}
            </bdi>
            <span className="min-w-0 flex-1 basis-40 overflow-hidden wrap-anywhere text-secondary">
              <WordsWithColumnNames words={props.howItStandsInWords} />
            </span>
            <span className="ms-auto flex flex-wrap items-center justify-end gap-x-sm gap-y-xs">
              {stands.kind === 'refused' && (
                <Button variant="ghost" size="xs" iconOnly icon={<Icon name="X" size="sm" />} aria-label={connectedTableMessages.dismiss()} onClick={props.onRefusalSentAway} />
              )}
              {bar.wayOut === 'askAgent' && onAgentAsked !== null && (
                <Button variant="secondary" size="xs" className="text-accent" disabled={props.hasUnsavedEdits} onClick={onAgentAsked}>
                  {sheetMessages.askAgentToFix()}
                </Button>
              )}
              {onRefresh !== null && (
                <Button variant="secondary" size="xs" className="text-accent" disabled={bar.isRefreshUnderWay} onClick={onRefresh}>
                  {bar.hasBeenFetched ? connectedTableMessages.refresh() : connectedTableMessages.loadData()}
                </Button>
              )}
              {connector !== null && (
                <Button variant="ghost" size="xs" className="text-accent" aria-expanded={bar.isPaneOpen} onClick={props.onSourceToggled}>
                  {connectedTableMessages.source()}
                </Button>
              )}
            </span>
          </div>
        </div>
      </ContentsBox>
    </fieldset>
  );
});
