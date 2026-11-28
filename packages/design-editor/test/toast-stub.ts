/**
 * Stands in for `@open-artifact/ui` in tests of services that show toasts
 * (its components are `.tsx`, which the test runner does not load): the
 * toasts they add are kept for the test to read.
 */

export interface ToastSeen {
  title?: string;
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
