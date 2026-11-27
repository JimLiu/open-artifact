import { getLinkHost, type Dataset, type DatasetRun } from '@open-artifact/data-core';
import { getLastSuccessfulRun } from '../data/query-store.ts';
import { formatVersionDate } from '../history/describe.ts';

/** How a source shows that its connector's tool certified its answer. */
export interface CertificationWords {
  /** "Certified in Sales": the line's text and the badge's name. */
  words: string;
  /** The badge's tip: who certified it (or the words), and when. */
  tip: string;
  /** "By Ada · Nov 3", the date alone, or nothing. */
  detail: string | null;
  link: { href: string; host: string; label: string } | null;
}

export const OPEN_CERTIFICATION_TEXT = 'Open';

/**
 * What a query source's last answer says of its certification; `null` when the tool gave none, the source isn't a
 * query, or it names no connector.
 */
export function getCertificationWords(dataset: Dataset, run: DatasetRun, now: number = Date.now()): CertificationWords | null {
  const source = dataset.source;
  if (source.kind !== 'query' || source.connector === '') return null;
  const certified = getLastSuccessfulRun(run)?.table?.certified;
  if (certified === undefined) return null;
  const connector = source.connector;
  const words = `Certified in ${connector}`;
  const day = certified.at === undefined ? null : formatVersionDate(certified.at, now);
  const withDay = (who: string): string => (day === null ? who : `${who} · ${day}`);
  const by = certified.by === undefined || certified.by === '' ? null : certified.by;
  const host = certified.url === undefined ? '' : getLinkHost(certified.url);
  return {
    words,
    tip: withDay(by === null ? words : `Certified by ${by}`),
    detail: by === null ? day : withDay(`By ${by}`),
    link: certified.url === undefined || host === '' ? null : { href: certified.url, host, label: `Open in ${connector}` },
  };
}
