/**
 * The release notes on the Open Artifact page (changelog-state.ts holds them; the host's {@link PageEnv.changelog} reads them):
 *
 *   - {@link WhatsNewPanel}: once a new version is installed, what it brings, at the top of the page until Got it;
 *   - {@link UpcomingNotes}: in the update's offer (updates.tsx), what the offered version brings;
 *   - {@link ChangelogFooter} and {@link ChangelogView}: the version at the foot of the page, and every release in a
 *     dialog, the offered one first.
 */
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import {
  changelogState,
  closeChangelog,
  loadChangelog,
  loadUpcoming,
  markSeen,
  openChangelog,
  subscribeChangelog,
  whatsNew,
} from './changelog-state.ts';
import { usePageEnv, useUpdates, type PageEnv } from './env.tsx';
import { isKey, type Translate } from './i18n.ts';
import { inlinePieces, type ReleaseNotes } from './library/changelog.ts';
import { latestOf } from './library/routes.ts';

export const useChangelog = () => useSyncExternalStore(subscribeChangelog, changelogState);

/** An item's Markdown, drawn. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlinePieces(text).map((piece, i) => {
        if (piece.kind === 'code') return <code key={i}>{piece.text}</code>;
        if (piece.kind === 'strong') return <strong key={i}>{piece.text}</strong>;
        if (piece.kind === 'link') {
          return (
            <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer">
              {piece.text}
            </a>
          );
        }
        return <span key={i}>{piece.text}</span>;
      })}
    </>
  );
}

const sectionTitle = (t: Translate, title: string) => {
  const key = `changelog.section.${title.toLowerCase()}`;
  return isKey(key) ? t(key) : title;
};

/** How many items a folded list shows. */
const FOLDED_ITEMS = 4;

interface NotesProps {
  releases: readonly ReleaseNotes[];
  /** Say which version each block is: more than one, or the changelog. */
  headings: boolean;
  /** Show only the first few items until Show all. */
  fold?: boolean;
  /** A tag beside a version's heading. */
  tag?(release: ReleaseNotes): ReactNode;
}

/** Releases' notes: the summary, then each section's items. */
export function ReleaseNotesList({ releases, headings, fold = false, tag }: NotesProps) {
  const { t } = usePageEnv();
  const [all, setAll] = useState(!fold);
  const total = releases.reduce((n, r) => n + r.sections.reduce((m, s) => m + s.items.length, 0), 0);
  let left = all ? Infinity : FOLDED_ITEMS;
  return (
    <div className="oa-notes">
      {releases.map((release) => {
        if (left <= 0) return null;
        return (
          <article key={release.version} className="oa-release" data-version={release.version}>
            {headings && (
              <h3 className="oa-release-head">
                <span className="oa-release-version">{release.version}</span>
                {release.date && <span className="oa-release-date">{release.date}</span>}
                {tag?.(release)}
              </h3>
            )}
            {release.summary.map((paragraph, i) => (
              <p key={i} className="oa-release-summary">
                <Inline text={paragraph} />
              </p>
            ))}
            {release.sections.map((section) => {
              if (left <= 0 || section.items.length === 0) return null;
              const items = section.items.slice(0, left);
              left -= items.length;
              return (
                <section key={section.title} className="oa-release-section">
                  <h4>{sectionTitle(t, section.title)}</h4>
                  <ul>
                    {items.map((item, i) => (
                      <li key={i}>
                        <Inline text={item} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </article>
        );
      })}
      {!all && total > FOLDED_ITEMS && (
        <button type="button" className="oau-show" onClick={() => setAll(true)}>
          {t('changelog.more', { count: String(total - FOLDED_ITEMS) })}
        </button>
      )}
    </div>
  );
}

/** Reads the notes when the page shows, and again once an update has gone in. */
function useLoadChangelog(): void {
  const { phase } = useUpdates();
  const { changelog: read } = usePageEnv();
  useEffect(() => {
    if (read) void loadChangelog(read);
  }, [read]);
  useEffect(() => {
    if (phase !== 'done' || !read) return;
    // The host's server may be starting again on the new version: ask now, and once more after.
    void loadChangelog(read);
    const again = setTimeout(() => void loadChangelog(read), 5_000);
    return () => clearTimeout(again);
  }, [phase, read]);
}

/** What the version installed brings, at the top of the page until Got it. */
export function WhatsNewPanel() {
  const { t } = usePageEnv();
  useLoadChangelog();
  const changelog = useChangelog();
  const releases = whatsNew(changelog);
  if (releases.length === 0) return null;
  return (
    <section className="oau-panel oa-news" role="status" aria-label={t('changelog.new', { version: changelog.version })} data-testid="open-artifact-whats-new">
      <div className="oau-head">
        <div className="oau-head-text">
          <div className="oau-title">{t('changelog.new', { version: changelog.version })}</div>
        </div>
        <div className="oau-actions">
          <button type="button" className="oa-btn" onClick={openChangelog}>
            {t('changelog.all')}
          </button>
          <button type="button" className="oa-btn" data-primary="true" onClick={markSeen}>
            {t('changelog.gotIt')}
          </button>
        </div>
      </div>
      <ReleaseNotesList releases={releases} headings={releases.length > 1} fold />
    </section>
  );
}

/** What the offered update brings, in the offer. Nothing while the notes are not known. */
export function UpcomingNotes() {
  const { t, changelog: read } = usePageEnv();
  const latest = latestOf(useUpdates().updates);
  const { upcoming } = useChangelog();
  useEffect(() => {
    if (read) void loadUpcoming(latest, read);
  }, [latest, read]);
  if (upcoming.length === 0) return null;
  return (
    <div className="oa-news-upcoming">
      <ReleaseNotesList releases={upcoming} headings={upcoming.length > 1} fold />
      <button type="button" className="oau-show" onClick={openChangelog}>
        {t('changelog.all')}
      </button>
    </div>
  );
}

/** The version at the foot of the page, and the way to the changelog. */
export function ChangelogFooter() {
  const { t } = usePageEnv();
  const { version } = useChangelog();
  if (version === '') return null;
  return (
    <footer className="oa-foot">
      <span>{t('changelog.version', { version })}</span>
      <span aria-hidden="true">·</span>
      <button type="button" className="oau-show" onClick={openChangelog} data-testid="open-artifact-changelog">
        {t('changelog.title')}
      </button>
    </footer>
  );
}

/** Every release, the offered one first: the changelog dialog's body. */
export function ChangelogView() {
  const { t, changelog: read } = usePageEnv();
  const { version, releases, upcoming } = useChangelog();
  const latest = latestOf(useUpdates().updates);
  useEffect(() => {
    if (read) void loadUpcoming(latest, read);
  }, [latest, read]);
  const tag = (release: ReleaseNotes) =>
    release.version === version ? (
      <span className="oau-tag" data-tone="neutral">
        {t('changelog.installed')}
      </span>
    ) : upcoming.includes(release) ? (
      <span className="oau-tag">{t('changelog.available')}</span>
    ) : null;
  return (
    <>
      <div className="oa-dialog-head">
        <h2>{t('changelog.title')}</h2>
      </div>
      <div className="oa-changelog">
        {upcoming.length + releases.length === 0 ? <p>{t('changelog.none')}</p> : <ReleaseNotesList releases={[...upcoming, ...releases]} headings tag={tag} />}
      </div>
      <div className="oa-dialog-actions">
        <a className="oa-btn oa-btn-link" href="https://github.com/JimLiu/open-artifact/releases" target="_blank" rel="noopener noreferrer">
          {t('changelog.releases')}
        </a>
        <button type="button" className="oa-btn" data-primary="true" autoFocus onClick={closeChangelog}>
          {t('dialog.close')}
        </button>
      </div>
    </>
  );
}

export { closeChangelog };
