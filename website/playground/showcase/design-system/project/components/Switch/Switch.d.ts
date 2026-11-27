export interface SwitchProps {
  /** Names the thing that is on: "Pause deliveries". */
  label: string;
  /** One line under the label: what on means. */
  hint?: string;
  /**
   * Whether it is on.
   * @default false
   */
  checked?: boolean;
  /**
   * Shown, but cannot be changed.
   * @default false
   */
  disabled?: boolean;
  /** Called with the new state. It takes effect at once: no Save button. */
  onChange?: (checked: boolean) => void;
}
