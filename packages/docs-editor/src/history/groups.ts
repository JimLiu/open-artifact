/**
 * The history list's rows: a tab's versions (newest first) folded into what the panel shows. The newest version is the
 * "Current version" row; a restore stands alone; otherwise consecutive versions by the same author on the same day
 * fold into one "{n} edits by <who>" row. Rows are then sectioned by day.
 */
import { FIRST_REV, MAX_VERSIONS } from '@open-artifact/docs-core';
import type { DocVersion } from '@open-artifact/runtime/doc-api';
import { nameOfPerson } from '../app/people.ts';

export type RowKind = 'current' | 'single' | 'restore' | 'group';

export interface VersionRow {
  kind: RowKind;
  /** Stable while the list changes: `current`, else the (oldest) member's rev. */
  key: string;
  /** Newest first. */
  versions: DocVersion[];
  day: string;
}

export interface DaySection {
  day: string;
  rows: VersionRow[];
}

/** Who made a version, as a key two versions share when the same author made both. */
export const authorKey = (version: DocVersion): string => (version.by === 'human' ? `person:${version.user ?? ''}` : version.by);

const isRestore = (version: DocVersion) => version.restoredFrom !== undefined;

/** Folds versions (newest first) into rows; `dayOf` names the day a time falls on (a key, e.g. `2026-11-18`). */
export function foldVersions(versions: readonly DocVersion[], dayOf: (at: string) => string): VersionRow[] {
  const rows: VersionRow[] = [];
  versions.forEach((version, index) => {
    const day = dayOf(version.at);
    if (index === 0) {
      rows.push({ kind: 'current', key: 'current', versions: [version], day });
      return;
    }
    if (isRestore(version)) {
      rows.push({ kind: 'restore', key: `r${version.rev}`, versions: [version], day });
      return;
    }
    const last = rows[rows.length - 1];
    if (last && (last.kind === 'single' || last.kind === 'group') && last.day === day && authorKey(last.versions[0]!) === authorKey(version)) {
      last.versions.push(version);
      last.kind = 'group';
      last.key = `g${version.rev}`;
      return;
    }
    rows.push({ kind: 'single', key: `r${version.rev}`, versions: [version], day });
  });
  return rows;
}

/** Rows under the day they fall on, in order. */
export function sectionByDay(rows: readonly VersionRow[]): DaySection[] {
  const sections: DaySection[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last?.day === row.day) last.rows.push(row);
    else sections.push({ day: row.day, rows: [row] });
  }
  return sections;
}

/** The version just before `rev` in the list (newest first), the one a version is compared with. */
export function versionBefore(versions: readonly DocVersion[], rev: number): DocVersion | null {
  const index = versions.findIndex(version => version.rev === rev);
  return index >= 0 ? (versions[index + 1] ?? null) : null;
}

/**
 * What a version is compared with: the version just before it, else the tab as first saved, at FIRST_REV, for an oldest
 * version written after the tab's first rev on a tab that was blank (not kept from before the history began, and with
 * no older versions let go); `null` when there is nothing earlier.
 */
export function compareBase(versions: readonly DocVersion[], rev: number): number | null {
  const before = versionBefore(versions, rev);
  if (before) return before.rev;
  const oldest = versions.at(-1);
  return oldest?.rev === rev && rev > FIRST_REV && oldest.by !== 'system' && versions.length < MAX_VERSIONS ? FIRST_REV : null;
}

// ---- words ----------------------------------------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
}

/** Who made a version: a person by name, the agent, or auto-save for what the tab held before its history began. */
export function whoOf(version: DocVersion, me: Person | null): string {
  if (version.by === 'agent') return 'Agent';
  if (version.by === 'system') return 'auto-save';
  if (!version.user) return 'Someone';
  if (me && me.id === version.user) return me.name;
  // An id that is an address still says who; an opaque one (a guest's) doesn't.
  return version.name || nameOfPerson(version.user) || (version.user.includes('@') ? version.user : 'Someone');
}

export const editsLabel = (count: number, who: string) => `${count} ${count === 1 ? 'edit' : 'edits'} by ${who}`;

/** The local calendar day of a time, as a key. */
export function dayKey(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** A day's heading: Today, Yesterday, a weekday within the week, else its date (with the year when not this one). */
export function dayLabel(at: string, now: Date = new Date(), locale?: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(locale, { weekday: 'long' });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeLabel(at: string, locale?: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** "Today at 3:04 PM", "Monday at 9:12 AM", "March 5 at 10:00 AM". */
export function whenLabel(at: string, now: Date = new Date(), locale?: string): string {
  const day = dayLabel(at, now, locale);
  const time = timeLabel(at, locale);
  return day && time ? `${day} at ${time}` : time;
}

/** The full date and time, for a tooltip. */
export function fullTime(at: string, locale?: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale);
}

/** What a restore row says it brought back: the version's time when it is in the list, else its rev. */
export function restoredLabel(version: DocVersion, versions: readonly DocVersion[], now: Date = new Date(), locale?: string): string | null {
  if (version.restoredFrom === undefined) return null;
  const source = versions.find(item => item.rev === version.restoredFrom);
  return source ? `Restored from ${whenLabel(source.at, now, locale)}` : `Restored from rev ${version.restoredFrom}`;
}
