/** List, add, edit and delete named ranges. */
import * as React from 'react';
import { Button } from '../../kit/button.tsx';
import { FieldRoot } from '../../kit/field.tsx';
import { TextInput } from '../../kit/text-input.tsx';
import { TooltipGroup } from '../../kit/tooltip.tsx';
import { isComposingKey } from '@open-artifact/ui/keys';
import {
  PANE_START_ATTRIBUTE,
  PaneRow,
  PaneRowNote,
  PaneSection,
  PaneTableButton,
  SidePane,
  focusPaneStart,
  useSidePaneCaret,
} from './side-pane.tsx';
import { LiveAnnouncer } from '../live-announcer.tsx';
import { deleteNamedRangeLabel, editNamedRangeLabel, namedRangeMessages, namedRangeRefusalText } from '../../messages/named-ranges.ts';
import { customSortMessages } from '../../tables/sort-filter-labels.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import type { NamedRangeFormRefusal } from '../../messages/named-ranges.ts';
import type { LimitsOfNamedRanges, NamedRangeRead } from '../../model/workbook.ts';

/** The form of a named range: a new one (over nothing) or one being edited. */
export interface NamedRangeFormShown {
  over: string | null;
  name: string;
  address: string;
  isChanged: boolean;
  refused: NamedRangeFormRefusal | null;
}
/** What the pane shows. */
export interface NamedRangesShown {
  form: NamedRangeFormShown | null;
  namedRanges: NamedRangeRead[];
  limits: LimitsOfNamedRanges;
}
/** What was done in the pane. */
export type NamedRangesPaneAct =
  | { kind: 'add' }
  | { kind: 'edit'; namedRangeId: string }
  | { kind: 'type'; field: 'name' | 'address'; text: string }
  | { kind: 'useSelection' }
  | { kind: 'giveUp' }
  | { kind: 'save' }
  | { kind: 'delete'; namedRangeId: string }
  | { kind: 'goTo'; namedRangeId: string };

export const NAMED_RANGE_INPUT_PROPS = {
  fullWidth: true,
  dir: 'auto',
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

export interface NamedRangeFormProps {
  form: NamedRangeFormShown;
  limits: LimitsOfNamedRanges;
  nameRef: React.RefObject<HTMLInputElement | null>;
  onAct: (act: NamedRangesPaneAct) => void;
}
export function NamedRangeForm({ form, limits, nameRef, onAct }: NamedRangeFormProps) {
  let { name, address, refused } = form;
  let noteId = React.useId();
  let canBeSaved = name.trim() !== '' && address.trim() !== '';
  let refusalText = refused === null ? null : namedRangeRefusalText(refused, name.trim(), limits.mostNamedRanges);
  let isAddressRefused = refused === 'addressNamesNoCells';
  let isNameRefused = refused !== null && !isAddressRefused;
  let refusalNote = <PaneRowNote id={noteId} isRefusal>{refusalText}</PaneRowNote>;
  let onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event)) return event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (canBeSaved)
        onAct({
          kind: 'save',
        });
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onAct({
        kind: 'giveUp',
      });
    }
    return;
  };
  return <div className="pb-2"><PaneRow label={namedRangeMessages.name()}><FieldRoot invalid={isNameRefused} className="min-w-0 flex-1"><TextInput {...NAMED_RANGE_INPUT_PROPS} ref={nameRef} aria-label={namedRangeMessages.name()} aria-describedby={isNameRefused ? noteId : undefined} maxLength={limits.longestNameOfANamedRangeInCharacters} value={name} onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onAct({
              kind: 'type',
              field: 'name',
              text: event.target.value,
            })} onKeyDown={onKeyDown} /></FieldRoot></PaneRow>{isNameRefused && refusalNote}<PaneRow label={namedRangeMessages.range()}><FieldRoot invalid={isAddressRefused} className="min-w-0 flex-1"><TextInput {...NAMED_RANGE_INPUT_PROPS} className="[&_input]:text-ellipsis" aria-label={namedRangeMessages.range()} aria-describedby={isAddressRefused ? noteId : undefined} value={address} slotEnd={<PaneTableButton name={customSortMessages.useSelection()} onPressed={() =>
                onAct({
                  kind: 'useSelection',
                })} />} onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onAct({
              kind: 'type',
              field: 'address',
              text: event.target.value,
            })} onKeyDown={onKeyDown} /></FieldRoot></PaneRow>{isAddressRefused && refusalNote}<LiveAnnouncer words={refusalText ?? false} /><PaneRow><div className="flex flex-1 justify-end gap-sm"><Button variant="ghost" onClick={() =>
            onAct({
              kind: 'giveUp',
            })}>{sheetMessages.cancel()}</Button><Button variant="secondary" disabled={!canBeSaved} onClick={() =>
            onAct({
              kind: 'save',
            })}>{namedRangeMessages.save()}</Button></div></PaneRow></div>;
}

export interface NamedRangeRowProps {
  read: NamedRangeRead;
  canBeEdited: boolean;
  onAct: (act: NamedRangesPaneAct) => void;
}
export function NamedRangeRow({ read, canBeEdited, onAct }: NamedRangeRowProps) {
  let { namedRangeId, namedRange, address, liveCells } = read;
  return <TooltipGroup closeDelay={0}><PaneRow><Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start py-1 text-start" disabled={liveCells === null} onClick={() =>
          onAct({
            kind: 'goTo',
            namedRangeId,
          })}><span className="flex min-w-0 flex-col"><span dir="auto" className="wrap-anywhere whitespace-normal">{namedRange.name}</span><span dir="auto" className="truncate text-footnote text-secondary">{liveCells === null ? namedRangeMessages.cellsWereDeleted() : address}</span></span></Button><Button variant="ghost" iconOnly icon="Edit" aria-label={editNamedRangeLabel(namedRange.name)} disabled={!canBeEdited} className="text-secondary" onClick={() =>
          onAct({
            kind: 'edit',
            namedRangeId,
          })} /><Button variant="ghost" iconOnly icon="Trash" aria-label={deleteNamedRangeLabel(namedRange.name)} className="text-secondary" onClick={() =>
          onAct({
            kind: 'delete',
            namedRangeId,
          })} /></PaneRow></TooltipGroup>;
}

export interface NamedRangesPaneProps {
  pane: NamedRangesShown | null;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent<HTMLElement>) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
  onAct: (act: NamedRangesPaneAct) => void;
  onPressed?: () => void;
  onShut: () => void;
}
export const NamedRangesPane = React.memo(function ({
  pane,
  timesAsked,
  paneRef,
  takesNoTyping,
  paneWidth,
  onPaneWidthChange,
  onKeyDownInPane,
  whatHasCaretAfter,
  wasPointerPressedLast,
  onAct,
  onPressed,
  onShut,
}: NamedRangesPaneProps) {
  let nameRef = React.useRef<HTMLInputElement>(null);
  let addRef = React.useRef<HTMLButtonElement>(null);
  let form = pane?.form ?? null;
  let formOver = form === null ? null : (form.over ?? 'new');
  React.useLayoutEffect(() => {
    if (formOver !== null) return nameRef.current?.focus();
    let ownerDocument = addRef.current?.ownerDocument;
    if (ownerDocument !== undefined && ownerDocument.activeElement === ownerDocument.body) addRef.current?.focus();
  }, [formOver]);
  useSidePaneCaret({
    isOpen: pane !== null,
    timesAsked,
    paneRef,
    putCaretWhereToStart: () => {
      if (nameRef.current !== null)
        nameRef.current.focus({
          preventScroll: true,
        });
      else
        focusPaneStart(paneRef.current, 'start', {
          isByPointer: wasPointerPressedLast(),
        });
    },
    whatHasCaretAfter,
  });
  if (pane === null) return null;
  let { namedRanges, limits } = pane;
  let formShown = form !== null && <NamedRangeForm form={form} limits={limits} nameRef={nameRef} onAct={onAct} />;
  let isFormOverARow = namedRanges.some(({ namedRangeId }) => namedRangeId === form?.over);
  return <SidePane ref={paneRef} title={namedRangeMessages.namedRanges()} takesNoTyping={takesNoTyping} width={paneWidth} onWidthChange={onPaneWidthChange} onClose={onShut} onKeyDown={onKeyDownInPane} onPressed={onPressed} wasPointerPressedLast={wasPointerPressedLast}><PaneSection title={null} className="pt-2">{!isFormOverARow && formShown}{form === null &&
        <PaneRow><Button ref={addRef} {...{
              [PANE_START_ATTRIBUTE]: true,
            }} variant="secondary" className="w-full" onClick={() =>
              onAct({
                kind: 'add',
              })}>{namedRangeMessages.add()}</Button></PaneRow>}{namedRanges.length === 0 && form === null &&
        <p className="px-lg pt-1 text-center text-footnote text-muted">{namedRangeMessages.noneYet()}</p>}<ul className="flex flex-col">{namedRanges.map((read) => <li key={read.namedRangeId}>{read.namedRangeId === form?.over ? formShown : <NamedRangeRow read={read} canBeEdited={form?.isChanged !== true} onAct={onAct} />}</li>)}</ul></PaneSection></SidePane>;
});
