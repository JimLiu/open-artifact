import * as React from 'react';
import { isComposingKey } from '@open-artifact/ui/keys';
import { Form as BaseForm } from '@base-ui/react/form';
import { cn } from './cn.ts';

export interface FormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'className' | 'onSubmit'> {
  className?: string;
  /** Called on submit; the page never navigates. Submits from forms in portalled popups are ignored. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /** Lets ⌘↩ or Ctrl+Enter submit from anywhere in the form. */
  submitOnModEnter?: boolean;
}

function isWithin(event: React.SyntheticEvent<HTMLFormElement>): boolean {
  const { target, currentTarget } = event;
  return target === currentTarget || (target instanceof Node && currentTarget.contains(target));
}

/** A form that stays on the page and validates its fields before submitting. */
export const Form = React.forwardRef<HTMLFormElement, FormProps>(function Form(
  { className, onSubmit, onKeyDown, submitOnModEnter = true, ...props },
  ref,
) {
  return (
    <BaseForm
      ref={ref}
      data-ui="Form"
      {...props}
      className={cn('flex flex-col gap-md', className)}
      onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isWithin(event)) onSubmit?.(event);
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLFormElement>) => {
        onKeyDown?.(event);
        if (
          !submitOnModEnter ||
          event.defaultPrevented ||
          event.key !== 'Enter' ||
          !(event.metaKey || event.ctrlKey) ||
          isComposingKey(event.nativeEvent) ||
          !isWithin(event)
        )
          return;
        event.preventDefault();
        event.currentTarget.requestSubmit();
      }}
    />
  );
});
