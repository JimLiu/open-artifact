/** Protect a sheet or range, and pick who can edit it. */
import * as React from 'react';
import { Dialog } from '../kit/dialog.tsx';
import { Form } from '../kit/form.tsx';
import { Button } from '../kit/button.tsx';
import { FieldCombobox, FieldTextInput } from '../kit/field.tsx';
import { Separator } from '../kit/separator.tsx';
import { isComposingKey } from '@open-artifact/ui/keys';
import { useLingeringValue } from '../agent/done-by-agent.tsx';
import { swallowRestOfPress } from './press-swallow.ts';
import { showTitleIfTextOverflows } from './card-rows.tsx';
import {
  openProtectionForLabel,
  protectionMessages,
  protectionPlaceLabel,
  protectionRefusalText,
  whoCanEditText,
} from '../messages/protection.ts';
import { peoplePickerMessages } from '../i18n/chip-labels.ts';
import { customSortMessages } from '../tables/sort-filter-labels.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import type { ComboboxOption } from '../kit/combobox.tsx';
import type { ProtectionPlace } from '../messages/protection.ts';
import type { BrowserSide } from '../state/controller.ts';

/** A protection as the dialog lists it; one not yet made has no id. */
export interface ProtectionListed {
  protectionId: string | null;
  place: ProtectionPlace;
  editors: readonly string[];
  mayBeChanged: boolean;
}
/** The protections of the sheet, and the one the dialog opens on. */
export interface ProtectionShown {
  listed: ProtectionListed[];
  opensOn: string | null;
  /** The viewer, who stays an editor of what they protect. */
  staysAnEditor: string | null;
  viewerId: string | null;
  mostEditors: number;
  areOpenRanges: (text: string) => boolean;
}
/** What the dialog saves or removes. */
export type ProtectionChosen =
  | { kind: 'remove'; protectionId: string }
  | { kind: 'save'; protectionId: string | null; editors: string[]; open: string | null };
/** What was changed in the form and not yet saved: null keeps what the protection has. */
export interface ProtectionChanges {
  editors: string[] | null;
  open: string | null;
}
type NamesOfEditors = Map<string, string>;
type PeopleOfDialog = BrowserSide['people'];

export const NO_PROTECTION_CHANGES: ProtectionChanges = {
  editors: null,
  open: null,
};
export function nameOfEditor(names: NamesOfEditors, userId: string): string {
  let name = names.get(userId) ?? '';
  return name === '' ? protectionMessages.someone() : name;
}
export function editorsOfProtectionText(
  { editors }: Pick<ProtectionListed, 'editors'>,
  { viewerId }: Pick<ProtectionShown, 'viewerId'>,
  names: NamesOfEditors,
): string {
  return whoCanEditText([
    ...(editors.some((userId) => userId === viewerId) ? [protectionMessages.you()] : []),
    ...editors.filter((userId) => userId !== viewerId).map((userId) => nameOfEditor(names, userId)),
  ]);
}

interface BackOfForm {
  backRef: React.RefObject<HTMLButtonElement | null>;
  onBack: (event: React.MouseEvent<HTMLButtonElement>) => void;
}
export interface ProtectionFormProps {
  shown: ProtectionShown;
  picked: ProtectionListed;
  changed: ProtectionChanges;
  onChanged: (changed: ProtectionChanges) => void;
  names: NamesOfEditors;
  people: PeopleOfDialog;
  onNamed: (named: NamesOfEditors) => void;
  onChosen: (chosen: ProtectionChosen) => void;
  back: BackOfForm | null;
  listUnder: React.ReactNode;
}
export function ProtectionForm({ shown, picked, changed, onChanged, names, people, onNamed, onChosen, back, listUnder }: ProtectionFormProps) {
  let { protectionId, place, mayBeChanged } = picked;
  let editors = changed.editors ?? [...picked.editors];
  let open = changed.open ?? (place.kind === 'sheet' ? place.open : '');
  let changeEditors = (nextEditors: string[]) =>
    onChanged({
      ...changed,
      editors: nextEditors,
    });
  let [found, setFound] = React.useState<string[]>([]);
  let [isSearching, setIsSearching] = React.useState(false);
  let searchCountRef = React.useRef(0);
  let search = async (text: string): Promise<void> => {
    let searchNumber = ++searchCountRef.current;
    setIsSearching(true);
    let profiles = await people.search(text);
    if (searchNumber !== searchCountRef.current) return;
    onNamed(new Map(profiles.map(({ userId, name }) => [userId, name])));
    setFound(profiles.map(({ userId }) => userId));
    setIsSearching(false);
  };
  let isFull = editors.length >= shown.mostEditors;
  let items: ComboboxOption<string>[] = [...new Set([...editors, ...found])].map((userId) => ({
    value: userId,
    label: nameOfEditor(names, userId),
    disabled: userId === shown.staysAnEditor || (isFull && !editors.includes(userId)),
  }));
  let addFirstFoundOnEnter = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let [firstFound] = found;
    let { target } = event;
    if (event.key !== 'Enter' || isComposingKey(event)) return;
    if (firstFound === undefined || isSearching || isFull) return;
    if (!(target instanceof HTMLInputElement) || target.value.trim() === '') return;
    if (target.hasAttribute('aria-activedescendant') || editors.includes(firstFound)) return;
    changeEditors([...editors, firstFound]);
  };
  let areOpenRanges = shown.areOpenRanges(open);
  let remove =
    mayBeChanged && protectionId !== null
      ? () =>
          onChosen({
            kind: 'remove',
            protectionId,
          })
      : null;
  return <Form className="contents" onSubmit={() => {
      if (mayBeChanged && areOpenRanges)
        onChosen({
          kind: 'save',
          protectionId,
          editors,
          open: changed.open,
        });
    }} onKeyDown={(event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && event.repeat) event.preventDefault();
    }}>{back === null
      ? <Dialog.Header>{protectionMessages.title()}</Dialog.Header>
      : <div className="flex items-start gap-xs"><Button ref={back.backRef} variant="ghost" iconOnly icon="ArrowLeft" flush="start" className="-mt-1" aria-label={protectionMessages.back()} onClick={back.onBack} /><div className="min-w-0 flex-1"><Dialog.Header>{protectionMessages.title()}</Dialog.Header></div></div>}<div className="flex flex-col gap-md"><div><div className="flex items-center justify-between gap-md"><p className="min-w-0 text-body font-medium">{protectionPlaceLabel(place)}</p>{remove !== null && listUnder !== null &&
          <Button variant="ghost" flush="end" className="-my-1" onClick={remove}>{protectionMessages.remove()}</Button>}</div>{(!mayBeChanged || (protectionId !== null && picked.editors.length === 0)) &&
        <p className="text-body text-secondary">{editorsOfProtectionText(
            {
              ...picked,
              editors,
            },
            shown,
            names,
          )}</p>}</div>{mayBeChanged
        ? (<><div data-initial-focus="" onKeyDownCapture={addFirstFoundOnEnter}><FieldCombobox label={protectionMessages.whoCanEdit()} hint={protectionMessages.ownersCanAlwaysEdit()} multiple triggerMode="chips" chipsOverflow="wrap" items={items} value={editors} onChange={(picks: string[]) =>
                changeEditors([...editors.filter((userId) => userId === shown.staysAnEditor && !picks.includes(userId)), ...picks])} onOpenChange={(isOpen: boolean) => void (isOpen && searchCountRef.current === 0 && search(''))} onInputChange={(text: string) => void search(text)} filter={({ value }: ComboboxOption<string>) => found.includes(value)} isLoading={isSearching} placeholder={peoplePickerMessages.addPeople()} /></div>{place.kind === 'sheet' &&
            <FieldTextInput label={protectionMessages.leftOpen()} value={open} onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChanged({
                  ...changed,
                  open: event.target.value,
                })} error={areOpenRanges ? undefined : customSortMessages.cellsNotFound()} />}</>)
        : <p className="text-body text-secondary">{protectionRefusalText('protectionNotTheirs')}</p>}{listUnder}</div><Dialog.Footer align="end">{remove !== null && listUnder === null &&
        <Button variant="ghost" flush className="me-auto" onClick={remove}>{protectionMessages.remove()}</Button>}<Dialog.Close render={<Button variant="secondary">{sheetMessages.cancel()}</Button>} />{mayBeChanged &&
        <Button type="submit" variant="primary" disabled={!areOpenRanges}>{protectionId === null ? protectionMessages.protect() : protectionMessages.save()}</Button>}</Dialog.Footer></Form>;
}

interface OpenedProtection {
  protectionId: string | null;
  isShown: boolean;
  isByKey: boolean;
  changed: ProtectionChanges;
}
export interface ProtectionDialogContentProps {
  shown: ProtectionShown;
  people: PeopleOfDialog;
  onChosen: (chosen: ProtectionChosen) => void;
}
export function ProtectionDialogContent({ shown, people, onChosen }: ProtectionDialogContentProps) {
  let [changed, setChanged] = React.useState(NO_PROTECTION_CHANGES);
  let [opened, setOpened] = React.useState<OpenedProtection | null>(null);
  let backRef = React.useRef<HTMLButtonElement>(null);
  let openButtonRef = React.useRef<HTMLButtonElement>(null);
  let listHeadingId = React.useId();
  let isOpenedShown = opened?.isShown;
  let isOpenedByKey = opened?.isByKey === true;
  React.useLayoutEffect(() => {
    if (isOpenedShown === undefined) return;
    (isOpenedShown ? backRef : openButtonRef).current?.focus({
      focusVisible: isOpenedByKey,
    });
  }, [isOpenedShown, isOpenedByKey]);
  let [names, setNames] = React.useState<NamesOfEditors>(new Map());
  let addNames = (named: NamesOfEditors) => setNames((namesBefore) => new Map([...namesBefore, ...named]));
  let editorIdsKey = React.useMemo(() => [...new Set(shown.listed.flatMap(({ editors }) => editors))].join(' '), [shown.listed]);
  React.useEffect(() => {
    if (editorIdsKey === '') return;
    let isCurrent = true;
    void people.profiles(editorIdsKey.split(' ')).then((profiles) => {
      if (isCurrent) setNames((namesBefore) => new Map([...namesBefore, ...profiles.map((profile): [string, string] => [profile.userId, profile.name])]));
      return;
    });
    return () => void (isCurrent = false);
  }, [editorIdsKey, people]);
  let opensOn = shown.listed.find((protection) => protection.protectionId === shown.opensOn);
  if (opensOn === undefined) return null;
  let others = shown.listed.filter((protection) => protection !== opensOn);
  let formProps = {
    shown,
    names,
    people,
    onNamed: addNames,
    onChosen,
  };
  let openedOther = others.find((protection) => protection.protectionId === opened?.protectionId);
  if (opened?.isShown === true && openedOther !== undefined)
    return <ProtectionForm {...formProps} key="opened" picked={openedOther} changed={opened.changed} onChanged={(nextChanged) =>
        setOpened({
          ...opened,
          changed: nextChanged,
        })} back={{
        backRef,
        onBack(event) {
          swallowRestOfPress(event);
          setOpened({
            ...opened,
            isShown: false,
            isByKey: event.detail === 0,
          });
        },
      }} listUnder={null} />;
  return <ProtectionForm {...formProps} picked={opensOn} changed={changed} onChanged={setChanged} back={null} listUnder={others.length === 0
      ? null
      : (<><Separator /><div className="flex flex-col gap-xs"><h3 id={listHeadingId} className="text-footnote font-medium text-secondary">{protectionMessages.alreadyProtected()}</h3><ul aria-labelledby={listHeadingId} className="scroll-fade-y scroll-fade-size-4 -m-1 flex max-h-56 flex-col gap-sm overflow-y-auto p-1">{others.map((protection) => <li key={protection.protectionId} className="flex items-center gap-md"><div className="min-w-0 flex-1"><p className="truncate text-body" onPointerEnter={showTitleIfTextOverflows}>{protectionPlaceLabel(protection.place)}</p><p className="truncate text-footnote text-secondary" onPointerEnter={showTitleIfTextOverflows}>{editorsOfProtectionText(protection, shown, names)}</p></div><Button {...(protection === openedOther && {
                  ref: openButtonRef,
                })} variant="secondary" aria-label={openProtectionForLabel(protection.place)} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                  swallowRestOfPress(event);
                  setOpened({
                    protectionId: protection.protectionId,
                    isShown: true,
                    isByKey: event.detail === 0,
                    changed: NO_PROTECTION_CHANGES,
                  });
                }}>{protectionMessages.open()}</Button></li>)}</ul></div></>)} />;
}

export interface ProtectionDialogProps {
  shown: ProtectionShown | null;
  people: PeopleOfDialog;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  /** What was chosen, or null when the dialog is put away. */
  onChosen: (chosen: ProtectionChosen | null) => void;
}
export function ProtectionDialog({ shown, people, whatHasCaretAfter, onChosen }: ProtectionDialogProps) {
  let lingeringShown = useLingeringValue(shown)?.shown ?? null;
  let popupRef = React.useRef<HTMLDivElement>(null);
  return <Dialog.Root open={shown !== null} onOpenChange={(isOpen: boolean) => {
      if (!isOpen) onChosen(null);
    }}><Dialog.Popup size="sm" ref={popupRef} initialFocus={() => popupRef.current?.querySelector<HTMLElement>('[role="combobox"]') ?? true} finalFocus={whatHasCaretAfter}>{lingeringShown !== null && <ProtectionDialogContent key={lingeringShown.opensOn} shown={lingeringShown} people={people} onChosen={onChosen} />}</Dialog.Popup></Dialog.Root>;
}
