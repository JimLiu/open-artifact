import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { HostingResponse as HostingView } from '@open-artifact/protocol';
import { PATHS } from '../../shared/routes.ts';

const inputStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', minHeight: 38, padding: '8px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit' };
const buttonStyle: CSSProperties = { minHeight: 36, padding: '8px 18px', border: 0, borderRadius: 8, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer' };

export function HostingSettings() {
  const [view, setView] = useState<HostingView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(PATHS.hosting, { signal: controller.signal }).then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not load hosting settings.');
      setView(value);
    }).catch((error: Error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!view) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(PATHS.hosting, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(view.settings) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not save hosting settings.');
      setView(value);
      setMessage(value.remote.enabled ? 'Saved. HTTPS hosting is active for all artifact types.' : value.remote.error || 'Saved. Local-only access is active.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section style={{ padding: 24, maxWidth: 680 }}>
    <h2>Artifact Hosting</h2>
    <p>Shared by all artifact types and harnesses on this computer.</p>
    {view ? <form onSubmit={save}>
      <p role="note">{view.remote.enabled ? 'Remote hosting is active. Keep owner links private.' : view.remote.error || view.remote.reason || 'Local-only access. Configure both origins and a concrete gateway address to enable HTTPS hosting.'}</p>
      <label style={{ display: 'grid', gap: 8, marginBlock: 20 }}>Public Shell HTTPS origin
        <input style={inputStyle} type="url" value={view.settings.publicShellOrigin ?? ''} placeholder="https://artifacts.example.com" onChange={(event) => setView({ ...view, settings: { ...view.settings, publicShellOrigin: event.target.value || null } })} />
      </label>
      <label style={{ display: 'grid', gap: 8, marginBlock: 20 }}>Isolated frame origin template
        <input style={inputStyle} type="text" value={view.settings.frameOriginTemplate ?? ''} placeholder="https://{artifactId}.frames.example.com" onChange={(event) => setView({ ...view, settings: { ...view.settings, frameOriginTemplate: event.target.value || null } })} aria-describedby="artifact-hosting-help" />
      </label>
      <label style={{ display: 'grid', gap: 8, marginBlock: 20 }}>Gateway listen address
        <input style={inputStyle} type="text" value={view.settings.listenHost ?? ''} placeholder="172.18.0.1" onChange={(event) => setView({ ...view, settings: { ...view.settings, listenHost: event.target.value || null } })} />
      </label>
      <label style={{ display: 'grid', gap: 8, marginBlock: 20 }}>Gateway port
        <input style={inputStyle} type="number" min={1} max={65535} value={view.settings.port} onChange={(event) => setView({ ...view, settings: { ...view.settings, port: Number(event.target.value) } })} />
      </label>
      <p id="artifact-hosting-help">Use separate HTTPS origins for the trusted Shell and artifact content. Point your TLS reverse proxy at the concrete non-loopback gateway address, preserving Host and Origin. DNS and certificates must already cover both origins. Leave both origins empty for local-only use.</p>
      <button style={buttonStyle} type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form> : <p>{message ? '' : 'Loading…'}</p>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
