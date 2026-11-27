import { useState } from 'react';
import { Button, Dialog, TextInput, isComposingKey } from '@open-artifact/ui';
import { t } from '../../lib/i18n.ts';
import { api } from '../../lib/api.ts';
import { useBoot } from '../store.ts';

export function DocCopyDialog({ title, close }: { title: string; close(): void }) {
  const boot = useBoot();
  const [name, setName] = useState(title.slice(0, 249) + ' (copy)');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      if (boot.typeServer) {
        const response = await fetch('_api/frame/duplicate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || response.statusText);
        location.assign(result.url);
      } else {
        const result = await api.duplicate(boot.id, name);
        location.assign('/a/' + encodeURIComponent(result.id));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };
  return <Dialog open title={t('duplicate')} onOpenChange={next => { if (!next && !busy) close(); }}
    footer={<>
      <Button disabled={busy} onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void copy()}>{t('duplicate')}</Button>
    </>}>
    <TextInput autoFocus aria-label={t('copyName')} value={name} maxLength={256} onFocus={event => event.target.select()}
      onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !isComposingKey(event.nativeEvent)) void copy(); }} />
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </Dialog>;
}
