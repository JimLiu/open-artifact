export interface ToastProps {
  /** One sentence, with its period. */
  message: string;
  /**
   * Success confirms what the person just did; plain is news.
   * @default "success"
   */
  tone?: 'success' | 'plain';
  /** The way back. One action at most. */
  action?: { label: string; onPress: () => void };
  /**
   * Milliseconds before it leaves by itself; 0 keeps it until dismissed.
   * @default 6000
   */
  duration?: number;
}
