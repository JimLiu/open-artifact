/**
 * "Opened 2 hours ago", in the app's language, and a clock that moves it on.
 */
import { useEffect, useState } from 'react';
import type { Translate } from './i18n.ts';

const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 3600],
  ['day', 86400],
  ['week', 604800],
  ['month', 2629800],
  ['year', 31557600],
];

/** When an artifact was opened, relative to `now`; '' for a time that does not parse. */
export function ago(iso: string, now: number, t: Translate): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((then - now) / 1000);
  if (seconds > -60) return t('card.justNow');
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  let size = 60;
  for (const [u, s] of STEPS) if (-seconds >= s) [unit, size] = [u, s];
  let format: Intl.RelativeTimeFormat;
  try {
    format = new Intl.RelativeTimeFormat(t('time.locale'), { numeric: 'auto' });
  } catch {
    format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  return t('card.opened', { time: format.format(Math.round(seconds / size), unit) });
}

/** The time now, once a minute. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
