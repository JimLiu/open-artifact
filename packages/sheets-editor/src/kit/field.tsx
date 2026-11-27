import * as React from 'react';
import { Field as BaseField } from '@base-ui/react/field';
import { cn } from './cn.ts';
import { Combobox, MultiCombobox, type ComboboxProps, type MultiComboboxProps } from './combobox.tsx';
import { Icon } from './icon.tsx';
import { TextInput, type TextInputProps } from './text-input.tsx';

const InFieldContext = React.createContext(false);

export interface FieldRootProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Groups a label, a control and its messages; the control takes the label and the invalid state. */
export const FieldRoot = React.forwardRef<HTMLDivElement, FieldRootProps>(function FieldRoot({ className, ...props }, ref) {
  return (
    <InFieldContext.Provider value>
      <BaseField.Root ref={ref} data-ui="Field" {...props} className={cn('flex min-w-0 flex-col gap-xs', className)} />
    </InFieldContext.Provider>
  );
});

export interface FieldLabelProps extends Omit<React.LabelHTMLAttributes<HTMLLabelElement>, 'className'> {
  className?: string;
  /** Another element to render as, such as a `<span>` for a label that only names a group. */
  render?: React.ReactElement;
}

export const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProps>(function FieldLabel({ className, render, ...props }, ref) {
  const isNativeLabel = render === undefined || render.type === 'label';
  return (
    <BaseField.Label
      ref={ref}
      render={render}
      nativeLabel={isNativeLabel}
      {...props}
      className={cn('w-fit text-body font-medium leading-none text-primary select-none', className)}
    />
  );
});

export interface FieldDescriptionProps extends Omit<React.HTMLAttributes<HTMLParagraphElement>, 'className'> {
  className?: string;
}

export const FieldDescription = React.forwardRef<HTMLParagraphElement, FieldDescriptionProps>(function FieldDescription(
  { className, ...props },
  ref,
) {
  return <BaseField.Description ref={ref} {...props} className={cn('text-footnote leading-snug text-secondary', className)} />;
});

export interface FieldErrorProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  /** `true` always shows the message; a validity key shows it when that check fails. */
  match?: boolean | keyof ValidityState;
  className?: string;
}

const ERROR_CLASSES = 'flex items-start gap-1 text-footnote leading-snug text-[color:var(--ui-text-danger)]';

export const FieldError = React.forwardRef<HTMLDivElement, FieldErrorProps>(function FieldError({ match, className, children, ...props }, ref) {
  const inField = React.useContext(InFieldContext);
  const content = (
    <>
      <Icon name="WarningCircle" size="xs" className="mt-[calc((1lh-1em)/2)]" />
      <span className="min-w-0">{children}</span>
    </>
  );
  if (!inField) {
    return (
      <div ref={ref} {...props} className={cn(ERROR_CLASSES, className)}>
        {content}
      </div>
    );
  }
  return (
    <BaseField.Error ref={ref} match={match} {...props} className={cn(ERROR_CLASSES, className)}>
      {content}
    </BaseField.Error>
  );
});

export interface FieldProps {
  label?: React.ReactNode;
  /** A line under the control that explains it. */
  hint?: React.ReactNode;
  /** Shown under the control, and marks the field invalid. */
  error?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const isShown = (node: React.ReactNode): boolean => node !== undefined && node !== null && node !== false && node !== '';

/** A label, one control, and its hint or error. */
export function Field({ label, hint, error, disabled, className, children }: FieldProps): React.ReactElement {
  const hasError = isShown(error);
  return (
    <FieldRoot invalid={hasError || undefined} disabled={disabled} className={className}>
      {isShown(label) && <FieldLabel>{label}</FieldLabel>}
      {children}
      {isShown(hint) && <FieldDescription>{hint}</FieldDescription>}
      {hasError && <FieldError match>{error}</FieldError>}
    </FieldRoot>
  );
}

export interface FieldTextInputProps extends TextInputProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  fieldClassName?: string;
}

/** A labelled text field. */
export const FieldTextInput = React.forwardRef<HTMLInputElement, FieldTextInputProps>(function FieldTextInput(
  { label, hint, error, fieldClassName, disabled, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} disabled={disabled} className={fieldClassName}>
      <TextInput ref={ref} disabled={disabled} {...props} />
    </Field>
  );
});

interface FieldComboboxParts {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  fieldClassName?: string;
}

export type FieldComboboxProps<V extends string = string> = FieldComboboxParts &
  ((ComboboxProps<V> & { multiple?: false }) | MultiComboboxProps<V>);

/** A labelled combobox; with nothing around it (no label, hint or error, one pick) it is the bare combobox. */
export function FieldCombobox<V extends string = string>(props: FieldComboboxProps<V>): React.ReactElement {
  const { label, hint, error, fieldClassName, ...rest } = props;
  const labelId = React.useId();
  const named = isShown(label);
  if (rest.multiple !== true && !named && !isShown(hint) && !isShown(error) && fieldClassName === undefined) {
    const { multiple: _single, ...single } = rest;
    return <Combobox {...single} />;
  }
  const naming = named && rest['aria-label'] === undefined ? { 'aria-labelledby': rest['aria-labelledby'] ?? labelId } : {};
  let control: React.ReactElement;
  if (rest.multiple === true) {
    control = <MultiCombobox {...rest} {...naming} />;
  } else {
    const { multiple: _single, ...single } = rest;
    control = <Combobox {...single} {...naming} />;
  }
  return (
    <FieldRoot invalid={isShown(error) || undefined} disabled={rest.disabled} className={fieldClassName}>
      {named && (
        <FieldLabel id={labelId} render={<span />}>
          {label}
        </FieldLabel>
      )}
      {control}
      {isShown(hint) && <FieldDescription>{hint}</FieldDescription>}
      {isShown(error) && <FieldError match>{error}</FieldError>}
    </FieldRoot>
  );
}
