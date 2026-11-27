/**
 * Stands in for `@open-artifact/ui` in `shared-flow.test.ts` (whose components are `.tsx`, which the test runner does
 * not load): the toasts the flow adds are kept for the test to read.
 */

export interface ToastSeen {
  title?: string;
  actionProps?: { children?: unknown; onClick?: () => void };
}

export const toasts: ToastSeen[] = [];

export const toast = {
  add(options: ToastSeen): string {
    toasts.push(options);
    return String(toasts.length);
  },
  close(): void {},
};

export const cn = (...names: unknown[]): string => names.filter((name) => typeof name === 'string' && name !== '').join(' ');
