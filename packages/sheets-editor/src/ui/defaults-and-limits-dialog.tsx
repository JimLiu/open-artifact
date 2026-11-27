/** A cell's default value and number limits. */
import * as React from 'react';
import { Dialog } from '../kit/dialog.tsx';
import { Form } from '../kit/form.tsx';
import { Button } from '../kit/button.tsx';
import { FieldLabel, FieldRoot, FieldTextInput } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { LiveAnnouncer } from './live-announcer.tsx';
import { useLingeringValue } from '../agent/done-by-agent.tsx';
import { defaultsAndLimitsMessages, defaultsRefusalText } from '../messages/defaults-and-limits.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import type { DefaultsRefusal } from '../messages/defaults-and-limits.ts';

/** A field of the form: mixed across the selection, none, blank, or text. */
export type DefaultOrLimitField = { kind: 'mixed' } | { kind: 'none' } | { kind: 'blank' } | { kind: 'text'; text: string };
/** The default-and-limits form as shown for the selection. */
export interface DefaultAndLimitsShown {
  cells: string;
  defaultValue: DefaultOrLimitField;
  minimum: DefaultOrLimitField;
  maximum: DefaultOrLimitField;
  takesLimits: boolean;
  isOfCheckboxes: boolean;
  longestDefault: number;
  refused: { why: DefaultsRefusal } | null;
}
/** What the form saves: null leaves the default or the limits as they are. */
export interface DefaultAndLimitsChosen {
  defaultValue: string | null;
  limits: { minimum: string; maximum: string } | null;
}
type FieldOfForm = 'defaultValue' | 'minimum' | 'maximum';
type TypedInForm = Partial<Record<FieldOfForm, string>>;

export const textOfLimitValue = (value: DefaultOrLimitField): string => (value.kind === 'text' ? value.text : '');
export function placeholderOfLimitValue({ kind }: DefaultOrLimitField): string | undefined {
  if (kind === 'mixed') return defaultsAndLimitsMessages.mixed();
  return kind === 'blank' ? defaultsAndLimitsMessages.blank() : undefined;
}
export const defaultsChosenFrom = (shown: DefaultAndLimitsShown, typed: TypedInForm): DefaultAndLimitsChosen => ({
  defaultValue: shown.defaultValue.kind === 'blank' && typed.defaultValue === '' ? null : (typed.defaultValue ?? null),
  limits:
    typed.minimum === undefined && typed.maximum === undefined
      ? null
      : {
          minimum: typed.minimum ?? textOfLimitValue(shown.minimum),
          maximum: typed.maximum ?? textOfLimitValue(shown.maximum),
        },
});
export const NO_DEFAULTS_OR_LIMITS: DefaultAndLimitsChosen = {
  defaultValue: '',
  limits: {
    minimum: '',
    maximum: '',
  },
};

export interface DefaultAndLimitsFormProps {
  shown: DefaultAndLimitsShown;
  onChosen: (chosen: DefaultAndLimitsChosen) => void;
}
export function DefaultAndLimitsForm({ shown, onChosen }: DefaultAndLimitsFormProps) {
  let [typed, setTyped] = React.useState<TypedInForm>({});
  let [refusalSeen, setRefusalSeen] = React.useState<DefaultAndLimitsShown['refused']>(null);
  let why = shown.refused === refusalSeen ? null : (shown.refused?.why ?? null);
  let refusalText =
    why === 'defaultValueIsNoOption' && shown.isOfCheckboxes
      ? defaultsAndLimitsMessages.enterTrueOrFalse()
      : why === null
        ? null
        : defaultsRefusalText(why);
  let areLimitsTyped = typed.minimum !== undefined || typed.maximum !== undefined;
  let areLimitsRefused = why === 'limitIsNoNumber' || why === 'minimumAboveMaximum';
  let hintId = React.useId();
  let fieldProps = (field: FieldOfForm) => ({
    value: typed[field] ?? textOfLimitValue(shown[field]),
    placeholder:
      shown[field].kind === 'mixed' && (field === 'defaultValue' ? typed[field] !== undefined : areLimitsTyped)
        ? undefined
        : placeholderOfLimitValue(shown[field]),
    dir: 'auto',
    autoComplete: 'off',
    spellCheck: false,
    onChange({ target }: React.ChangeEvent<HTMLInputElement>) {
      setTyped({
        ...typed,
        [field]: target.value,
      });
      setRefusalSeen(shown.refused);
    },
  });
  let hasAny = [shown.defaultValue, shown.minimum, shown.maximum].some(({ kind }) => kind !== 'none');
  return <Form className="contents" onSubmit={() => onChosen(defaultsChosenFrom(shown, typed))} onKeyDown={(event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && event.repeat) event.preventDefault();
    }}><Dialog.Header>{defaultsAndLimitsMessages.defaultAndLimits()}</Dialog.Header><div className="flex flex-col gap-md"><p className="text-body font-medium">{shown.cells}</p><FieldTextInput {...fieldProps('defaultValue')} label={defaultsAndLimitsMessages.defaultValue()} maxLength={shown.longestDefault} error={areLimitsRefused ? undefined : (refusalText ?? undefined)} />{shown.takesLimits &&
        <div className="flex flex-col gap-xs"><div className="grid grid-cols-2 gap-md">{(['minimum', 'maximum'] as const).map((field) => <FieldRoot key={field} invalid={areLimitsRefused}><FieldLabel>{defaultsAndLimitsMessages[field]()}</FieldLabel><TextInput {...fieldProps(field)} fullWidth aria-describedby={hintId} /></FieldRoot>)}</div><p id={hintId} className={`text-footnote ${areLimitsRefused ? 'text-danger' : 'text-secondary'}`}>{areLimitsRefused ? refusalText : defaultsAndLimitsMessages.hintOfLimits()}</p></div>}<LiveAnnouncer words={refusalText ?? false} /></div><Dialog.Footer align="end">{hasAny &&
        <Button variant="ghost" className="me-auto" onClick={() => onChosen(NO_DEFAULTS_OR_LIMITS)}>{defaultsAndLimitsMessages.remove()}</Button>}<Dialog.Close render={<Button variant="secondary">{sheetMessages.cancel()}</Button>} /><Button type="submit" variant="primary">{defaultsAndLimitsMessages.save()}</Button></Dialog.Footer></Form>;
}

export interface DefaultAndLimitsDialogProps {
  shown: DefaultAndLimitsShown | null;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  /** What was chosen, or null when the dialog is put away. */
  onChosen: (chosen: DefaultAndLimitsChosen | null) => void;
}
export function DefaultAndLimitsDialog({ shown, whatHasCaretAfter, onChosen }: DefaultAndLimitsDialogProps) {
  let lingeringShown = useLingeringValue(shown)?.shown ?? null;
  let popupRef = React.useRef<HTMLDivElement>(null);
  return <Dialog.Root open={shown !== null} onOpenChange={(isOpen: boolean) => {
      if (!isOpen) onChosen(null);
    }}><Dialog.Popup size="sm" ref={popupRef} initialFocus={() => popupRef.current?.querySelector('input') ?? true} finalFocus={whatHasCaretAfter}>{lingeringShown !== null && <DefaultAndLimitsForm shown={lingeringShown} onChosen={onChosen} />}</Dialog.Popup></Dialog.Root>;
}
