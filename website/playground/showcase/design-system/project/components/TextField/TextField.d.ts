export interface TextFieldProps {
  /** Always visible, above the field. Sentence case, no colon. */
  label: string;
  /** The current value. */
  value?: string;
  /** An example of a valid answer, never the label. */
  placeholder?: string;
  /** What happens with the answer. Replaced by `error` when there is one. */
  hint?: string;
  /** What is wrong and how to fix it. Sets the error state. */
  error?: string;
  /**
   * The keyboard on touch screens.
   * @default "text"
   */
  type?: 'text' | 'email' | 'tel' | 'number';
  /** Called with the new value on every change. */
  onChange?: (value: string) => void;
}
