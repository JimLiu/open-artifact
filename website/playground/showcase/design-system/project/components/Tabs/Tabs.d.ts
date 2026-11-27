export interface TabsProps {
  /** Two to five items, in reading order. */
  items: { value: string; label: string; count?: number }[];
  /** The selected item's value. */
  value: string;
  /**
   * Tabs switch the view under them; a segment picks an option in a form.
   * @default "tabs"
   */
  variant?: 'tabs' | 'segment';
  /** Called with the value of the item the person picked. */
  onChange?: (value: string) => void;
}
