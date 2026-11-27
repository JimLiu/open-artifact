export interface TagProps {
  /**
   * What the tag means. Never decorative.
   * @default "neutral"
   */
  tone?: 'neutral' | 'new' | 'success' | 'seasonal' | 'danger';
  /** One or two words, sentence case. */
  children: string;
}
