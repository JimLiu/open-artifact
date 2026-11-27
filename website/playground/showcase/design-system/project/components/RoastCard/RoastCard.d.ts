export interface RoastCardProps {
  /** The coffee's name, set in `title`. Never translated. */
  name: string;
  /** The overline above the name: "Spring blend", "Year round". */
  kicker?: string;
  /** Up to three tasting notes, as one sentence. */
  notes: string;
  /** Roast level, 1 (lightest) to 5. Fills the meter and picks its word. */
  roast: 1 | 2 | 3 | 4 | 5;
  /** Price of one bag, in cents. */
  price: number;
  /**
   * Bag weight in grams.
   * @default 250
   */
  weight?: number;
  /** One tag, top right. */
  tag?: { tone: 'new' | 'success' | 'seasonal' | 'danger'; label: string };
  /**
   * Gives this card the primary button. One per grid.
   * @default false
   */
  featured?: boolean;
  /** Called when the person adds the coffee to their bag. */
  onAdd?: () => void;
}
