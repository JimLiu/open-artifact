/**
 * Under the person's own types in the local home page's Types tab: a section for each site this computer is connected
 * to, with the types it lists and what each offers by how it stands here (`types.sites`, `connected-site-types.ts`):
 * Install (the Install dialog reading its page), Update, Install under another id, or a quiet label. Read when the tab
 * opens; the person's own types never wait for it. A site that could not be read says why, with Retry.
 *
 * Everything the publisher wrote is drawn as text. The only link is the type's page on the site, which the daemon made
 * from the remote's address (checked again when read).
 */

import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@open-artifact/ui';
import { siteTypeOffer, type TypesSite, type TypesSiteType } from '../../lib/connected-site-types.ts';
import { ago } from '../../lib/format.ts';
import { t, type MessageKey } from '../../lib/i18n.ts';
import { loadSites } from '../actions.ts';
import { useHome } from '../store.ts';
import { Chip } from './ArtifactList.tsx';

const VISIBILITY_LABEL: Record<TypesSiteType['visibility'], MessageKey> = { private: 'siteTypePrivate', link: 'siteTypeLink', site: 'siteTypeSite' };

/** One type of a site: who published it, and what it offers here. */
function SiteTypeRow({ type }: { type: TypesSiteType }) {
  const offer = siteTypeOffer(type);
  const open = (): void => {
    if (offer.action !== 'none') useHome.getState().setInstalling(offer.open);
  };
  return (
    <div data-connected-site-type={type.id} data-standing={type.standing} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-3.5">
      <div className="min-w-0">
        <div className="truncate font-semibold">{type.name}</div>
        <div className="truncate text-xs text-fg-muted">{type.id}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip>v{type.version}</Chip>
        <Chip>{t(VISIBILITY_LABEL[type.visibility])}</Chip>
      </div>
      {type.description ? <div className="line-clamp-4 text-xs text-fg-muted">{type.description}</div> : null}
      <div data-testid="site-type-publisher" className="text-xs text-fg-subtle">
        {t('siteTypeBy', { name: type.publisher.name ?? t('siteTypeUnnamedPublisher'), when: type.updatedAt ? ago(type.updatedAt) : '' })}
      </div>
      {type.standing === 'update' && type.local ? (
        <div className="text-xs text-fg-muted">{t('siteTypeUpdateNote', { local: type.local.version ?? '?', id: type.local.id, version: type.version })}</div>
      ) : null}
      {type.standing === 'clash' && type.local ? <div className="text-xs text-warning">{t('siteTypeClashNote', { id: type.local.id })}</div> : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {offer.action === 'install' ? (
          <Button size="sm" variant="primary" icon={<Download className="size-3" />} data-testid="site-type-install" onClick={open}>
            {t('siteTypeInstallHere')}
          </Button>
        ) : offer.action === 'update' ? (
          <Button size="sm" icon={<RefreshCw className="size-3" />} data-testid="site-type-update" onClick={open}>
            {t('siteTypeUpdateHere', { version: type.version })}
          </Button>
        ) : offer.action === 'install-as' ? (
          <Button size="sm" icon={<Download className="size-3" />} data-testid="site-type-install-as" onClick={open}>
            {t('siteTypeInstallAsOther')}
          </Button>
        ) : (
          <span data-testid="site-type-label" className="text-xs text-fg-muted">
            {type.standing === 'published-here'
              ? t('siteTypePublishedHere')
              : type.local && type.local.id !== type.id
                ? t('siteTypeInstalledAs', { id: type.local.id })
                : t('siteTypeInstalledHere')}
          </span>
        )}
        <a href={type.page} target="_blank" rel="noopener noreferrer" data-testid="site-type-page" className="ml-auto inline-flex items-center gap-1 text-xs">
          <ExternalLink className="size-3" />
          {t('siteTypeOpenPage')}
        </a>
      </div>
    </div>
  );
}

/** One connected site: its name and host, then its types, or why they could not be read. */
function SiteSection({ site }: { site: TypesSite }) {
  const loading = useHome((state) => state.sitesLoading);
  const busy = loading === '*' || loading === site.remote;
  let host = site.host;
  try {
    host = new URL(site.host).host;
  } catch {
    // shown as it is
  }
  return (
    <section data-connected-site={site.remote} className="mt-6">
      <h2 className="mb-1 mt-0 min-w-0 break-all text-sm font-semibold">{t('connectedSiteTitle', { name: site.remote, host })}</h2>
      {site.error ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" data-testid="connected-site-error" className="m-0 min-w-0 break-words text-xs text-danger">
            {site.error}
          </p>
          <Button size="sm" disabled={busy} data-testid="connected-site-retry" onClick={() => void loadSites(site.remote)}>
            {busy ? t('loading') : t('connectedSiteRetry')}
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-2 mt-0 text-xs text-fg-muted">
            {t('connectedSiteNote')} {t('packageThirdParty')}
          </p>
          {site.types.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {site.types.map((type) => (
                <SiteTypeRow key={type.uid} type={type} />
              ))}
            </div>
          ) : (
            <p className="m-0 text-xs text-fg-subtle">{t('connectedSiteEmpty')}</p>
          )}
        </>
      )}
    </section>
  );
}

/** The sections of the connected sites, read each time the Types tab opens. */
export function ConnectedSiteTypes() {
  const sites = useHome((state) => state.sites);
  const failed = useHome((state) => state.sitesError);
  const loading = useHome((state) => state.sitesLoading);
  useEffect(() => {
    void loadSites();
  }, []);
  if (failed) {
    return (
      <div data-connected-sites="" className="mt-6 flex flex-wrap items-center gap-2">
        <p role="alert" className="m-0 text-xs text-danger">
          {t('connectedSitesFailed', { error: failed })}
        </p>
        <Button size="sm" disabled={loading !== null} onClick={() => void loadSites()}>
          {t('connectedSiteRetry')}
        </Button>
      </div>
    );
  }
  if (!sites) {
    return (
      <p data-connected-sites="loading" className="mb-0 mt-6 text-xs text-fg-subtle">
        {t('connectedSitesLoading')}
      </p>
    );
  }
  if (!sites.sites.length) {
    return (
      <p data-connected-sites="none" className="mb-0 mt-6 text-xs text-fg-subtle">
        {t('connectedSitesNone')}
      </p>
    );
  }
  return (
    <div data-connected-sites="">
      {sites.sites.map((site) => (
        <SiteSection key={site.remote} site={site} />
      ))}
    </div>
  );
}
