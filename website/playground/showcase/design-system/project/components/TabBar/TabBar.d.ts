export interface TabBarProps {
  /**
   * The place the person is in.
   * @default "home"
   */
  value?: 'home' | 'shop' | 'brew' | 'account';
  /** A small dot on Shop when the bag is not empty. */
  bagCount?: number;
  /** Called with the place the person picked. */
  onChange?: (value: 'home' | 'shop' | 'brew' | 'account') => void;
}
