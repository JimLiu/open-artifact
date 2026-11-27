export interface ButtonProps {
  /**
   * How loud the button is. One primary per view.
   * @default "secondary"
   */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  /**
   * Height: 32, 44 or 52px. Use md or lg on touch screens.
   * @default "md"
   */
  size?: 'sm' | 'md' | 'lg';
  /** An icon after the label, 16px, drawn with currentColor. */
  icon?: 'arrow' | 'plus' | 'check';
  /**
   * Keeps its place and its label; says why nearby ("Sold out").
   * @default false
   */
  disabled?: boolean;
  /** The label: sentence case, verb first. */
  children: string;
  /** Called on click and on Enter or Space. */
  onPress?: () => void;
}
