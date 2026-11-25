/**
 * The types published to a cloud host: the home page's Types tab (the catalog the person may list, each card a link
 * to its page, and whether they may publish here) and a type's own page (`/t/<id>`): who published it, what its page
 * may use and reach (the words `types install` and the Install dialog use), its SKILL.md as plain text, how to install
 * it on a computer, its package, and for its publisher or a site admin who sees it and Unpublish.
 *
 * Read-only otherwise: a type is published from a computer (`open-artifact types publish`), and artifacts of it are
 * made by an agent. Everything the publisher wrote is drawn as text.
 */

import type { LinkSiteType, SiteTypeDetail, SiteTypesResult, SiteTypeVisibility } from '@open-artifact/protocol';
import { ArrowLeft, Download } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog, EmptyState, Segmented, toast } from '@open-artifact/ui';
import { ago } from '../../lib/format.ts';
import { t, type MessageKey } from '../../lib/i18n.ts';
import { createSiteTypesApi, typePageHref } from '../../lib/site-types.ts';
import { Chip } from './ArtifactList.tsx';

const siteTypes = createSiteTypesApi();

const VISIBILITY_LABEL: Record<SiteTypeVisibility, MessageKey> = { private: 'siteTypePrivate', link: 'siteTypeLink', site: 'siteTypeSite' };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 text-xs">
      <span className="text-fg-muted">{label}</span>
      <span data-testid={testId} className="min-w-0 break-words">
        {children}
      </span>
    </div>
  );
}

const publisherName = (type: LinkSiteType): string => type.publisher.name ?? t('siteTypeUnnamedPublisher');

/** One type in the Types tab: a link to its page. */
function SiteTypeCard({ type }: { type: LinkSiteType }) {
  return (
    <a
      href={typePageHref(type.id)}
      data-site-type={type.id}
      className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-fg no-underline hover:bg-hover"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{type.name}</span>
        <Chip>{type.version}</Chip>
        <Chip>{t(VISIBILITY_LABEL[type.visibility])}</Chip>
        {type.unpublished ? <Chip>{t('siteTypeDelisted')}</Chip> : null}
      </span>
      {type.description ? <span className="text-xs text-fg-muted">{type.description}</span> : null}
      <span className="text-xs text-fg-subtle">{t('siteTypeBy', { name: publisherName(type), when: type.updatedAt ? ago(type.updatedAt) : '' })}</span>
    </a>
  );
}

/** The cloud home page's Types tab. */
export function SiteTypeList() {
  const [result, setResult] = useState<SiteTypesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    siteTypes.list().then(setResult, (e: unknown) => setError(errorText(e)));
  }, []);
  if (error) return <p role="alert" className="py-4 text-xs text-danger">{error}</p>;
  if (!result) return <p className="py-8 text-fg-muted">{t('loading')}</p>;
  return (
    <div data-home-site-types="" className="flex flex-col gap-3">
      <p className="m-0 text-xs text-fg-muted">
        {t('siteTypesNote')} {result.publish.allowed ? t('siteTypesYouMayPublish') : result.publish.refusal ? t('siteTypesNoPublish', { why: result.publish.refusal }) : null}
      </p>
      {result.types.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {result.types.map((type) => (
            <SiteTypeCard key={type.uid} type={type} />
          ))}
        </div>
      ) : (
        <EmptyState title={t('siteTypesEmptyTitle')}>{t('siteTypesEmpty')}</EmptyState>
      )}
    </div>
  );
}

/** For its publisher or a site admin: who sees it, and Unpublish. */
function Manage({ type, onChange }: { type: SiteTypeDetail; onChange: (next: SiteTypeDetail | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const change = async (visibility: SiteTypeVisibility): Promise<void> => {
    setBusy(true);
    try {
      onChange(await siteTypes.setVisibility(type.id, visibility));
    } catch (error) {
      toast.add({ title: t('siteTypeCouldNot', { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  };
  const unpublish = async (): Promise<void> => {
    setConfirm(false);
    setBusy(true);
    try {
      const out = await siteTypes.unpublish(type.id);
      toast.add({ title: out.removed ? t('siteTypeRemoved', { name: type.name }) : t('siteTypeDelistedNow', { name: type.name, count: out.artifacts }) });
      onChange(out.removed ? null : { ...type, unpublished: true });
    } catch (error) {
      toast.add({ title: t('siteTypeCouldNot', { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-site-type-manage="" className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <h2 className="m-0 text-sm font-medium">{t('siteTypeManage')}</h2>
      {type.unpublished ? (
        <p className="m-0 text-xs text-fg-muted">{t('siteTypeDelistedManage', { id: type.id })}</p>
      ) : (
        <>
          <Segmented<SiteTypeVisibility>
            aria-label={t('siteTypeWhoSees')}
            value={type.visibility}
            options={(['private', 'link', 'site'] as const).map((value) => ({ value, label: t(VISIBILITY_LABEL[value]) }))}
            onChange={(next) => !busy && next !== type.visibility && void change(next)}
          />
          <p className="m-0 text-xs text-fg-muted">{t('siteTypeVisibilityNote')}</p>
          <div>
            <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => setConfirm(true)}>
              {t('siteTypeUnpublish')}
            </Button>
          </div>
        </>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(open) => !open && setConfirm(false)}
        title={t('siteTypeUnpublishTitle', { name: type.name })}
        description={t('siteTypeUnpublishBody')}
        footer={
          <>
            <Button size="lg" onClick={() => setConfirm(false)}>
              {t('cancel')}
            </Button>
            <Button size="lg" variant="danger" onClick={() => void unpublish()}>
              {t('siteTypeUnpublish')}
            </Button>
          </>
        }
      />
    </section>
  );
}

/** A type's page (`/t/<id>`). */
export function TypePage({ detail }: { detail: SiteTypeDetail }) {
  const [type, setType] = useState<SiteTypeDetail | null>(detail);
  useEffect(() => {
    document.title = detail.name;
  }, [detail.name]);
  if (!type) {
    return (
      <div data-type-page="" className="flex flex-col gap-3">
        <EmptyState title={t('siteTypeGoneTitle')}>{t('siteTypeGone')}</EmptyState>
        <BackLink />
      </div>
    );
  }
  return (
    <div data-type-page={type.id} className="flex flex-col gap-4">
      <BackLink />
      <div className="flex flex-col gap-1">
        <h2 className="m-0 flex flex-wrap items-center gap-2 text-lg font-semibold">
          <span data-testid="type-page-name">{type.name}</span>
          <Chip>{type.version}</Chip>
          <Chip>{t(VISIBILITY_LABEL[type.visibility])}</Chip>
        </h2>
        {type.description ? <p className="m-0 text-fg-muted" data-testid="type-page-description">{type.description}</p> : null}
      </div>
      {type.unpublished ? (
        <p role="status" data-testid="type-page-delisted" className="m-0 rounded-md bg-hover px-3 py-2 text-xs">
          {t('siteTypeDelistedNote')}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Fact label={t('siteTypePublisher')} testId="type-page-publisher">
          {publisherName(type)}
        </Fact>
        <Fact label={t('siteTypeUpdated')}>{type.updatedAt ? ago(type.updatedAt) : '—'}</Fact>
        <Fact label={t('packageCapabilities')} testId="type-page-capabilities">
          {type.capabilities.length ? type.capabilities.join(', ') : t('noCapabilities')}
        </Fact>
        <Fact label={t('packageNetwork')} testId="type-page-network">
          {type.network.length ? type.network.join(', ') : t('noNetwork')}
        </Fact>
        <Fact label="sha256">
          <span className="font-mono break-all">{type.sha256}</span>
        </Fact>
      </div>
      <p className="m-0 text-xs text-fg-muted">{t('packageThirdParty')}</p>
      {type.unpublished ? null : (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-sm font-medium">{t('siteTypeInstall')}</h2>
          <p className="m-0 text-xs text-fg-muted">{t('siteTypeInstallNote')}</p>
          <pre data-testid="type-page-install" className="m-0 overflow-x-auto rounded-md bg-hover px-3 py-2 text-xs">
            {type.install}
          </pre>
          <div>
            <a href={type.packageUrl} download className="inline-flex items-center gap-1.5 text-xs">
              <Download className="size-3.5" />
              {t('siteTypeDownload')}
            </a>
          </div>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-sm font-medium">SKILL.md</h2>
        <p className="m-0 text-xs text-fg-muted">{t('siteTypeSkillNote')}</p>
        {type.skill ? (
          <pre data-testid="type-page-skill" className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border px-3 py-2 text-xs">
            {type.skill}
          </pre>
        ) : (
          <p className="m-0 text-xs text-fg-subtle">{t('siteTypeNoSkill')}</p>
        )}
      </section>
      {type.manages ? <Manage type={type} onChange={setType} /> : null}
    </div>
  );
}

function BackLink() {
  return (
    <a href="/#types" className="inline-flex items-center gap-1 text-xs">
      <ArrowLeft className="size-3.5" />
      {t('siteTypesBack')}
    </a>
  );
}
