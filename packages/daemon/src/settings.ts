/**
 * `settings.json`: settings shared by every harness on this computer. Only
 * what the person changed is saved; {@link loadSettings} merges the file over
 * the protocol's defaults.
 */

import { DEFAULT_SETTINGS, OpenArtifactError, type HostingSettings, type HostingResponse, type OpenArtifactSettings } from '@open-artifact/protocol';
import { isIP } from 'node:net';
import { expandHome, files, readJson, writeJson } from './paths.ts';

/**
 * The settings in effect: the saved file over {@link DEFAULT_SETTINGS}, with
 * `~` expanded. `$OPEN_ARTIFACT_USER_TYPES`, `$OPEN_ARTIFACT_EXTRA_TYPES` (colon separated) and
 * `$OPEN_ARTIFACT_PORT` move the type roots and the port without touching the file
 * (tests, dev checkouts).
 */
export function loadSettings(): OpenArtifactSettings {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  const merged: OpenArtifactSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    typeRoots: { ...DEFAULT_SETTINGS.typeRoots, ...(saved.typeRoots ?? {}) },
    wake: { ...DEFAULT_SETTINGS.wake, ...(saved.wake ?? {}) },
    hosting: validateHostingSettings(saved.hosting ?? DEFAULT_SETTINGS.hosting),
  };
  if (process.env.OPEN_ARTIFACT_USER_TYPES) merged.typeRoots.user = process.env.OPEN_ARTIFACT_USER_TYPES;
  if (process.env.OPEN_ARTIFACT_EXTRA_TYPES) {
    merged.typeRoots.extra = [...merged.typeRoots.extra, ...process.env.OPEN_ARTIFACT_EXTRA_TYPES.split(':').filter(Boolean)];
  }
  merged.typeRoots.user = expandHome(merged.typeRoots.user);
  merged.typeRoots.extra = merged.typeRoots.extra.map(expandHome);
  merged.homeWorkspace = expandHome(merged.homeWorkspace);
  merged.trustedProjects = (merged.trustedProjects ?? []).map(expandHome);
  if (process.env.OPEN_ARTIFACT_PORT) merged.serverPort = Number(process.env.OPEN_ARTIFACT_PORT);
  return merged;
}

/** Validate the public origin pair and explicit authenticated gateway listener. */
export function validateHostingSettings(value: unknown): HostingSettings {
  const fail = (message: string): never => { throw new OpenArtifactError('invalid_argument', message); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('hosting must be an object.');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !['publicShellOrigin', 'frameOriginTemplate', 'listenHost', 'port'].includes(key))) return fail('Unknown hosting setting.');
  const origin = (input: unknown, frame: boolean): string | null => {
    if (input === null || input === '') return null;
    if (typeof input !== 'string') return fail('Hosting origins must be strings or null.');
    const text = input.trim();
    if (!text) return null;
    if (frame && (!text.startsWith('https://{artifactId}.') || text.split('{artifactId}').length !== 2)) return fail('Frame origin must start with https://{artifactId}.');
    if (!frame && /[{}]/.test(text)) return fail('Shell origin cannot contain a template.');
    let url: URL;
    try { url = new URL(frame ? text.replace('{artifactId}', 'artifact-placeholder') : text); }
    catch { return fail('Hosting origins must be absolute HTTPS origins.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.hostname.endsWith('.') || url.hostname.includes('*')) return fail('Hosting origins require HTTPS without credentials, path, query, fragment or wildcard.');
    if (frame && url.hostname.split('.').length < 3) return fail('Frame origin needs a dedicated parent hostname.');
    return frame ? url.origin.replace('artifact-placeholder.', '{artifactId}.') : url.origin;
  };
  const publicShellOrigin = origin(fields.publicShellOrigin, false);
  const frameOriginTemplate = origin(fields.frameOriginTemplate, true);
  if (!!publicShellOrigin !== !!frameOriginTemplate) return fail('Shell and isolated frame origins must be configured together.');
  if (publicShellOrigin && frameOriginTemplate) {
    const shell = new URL(publicShellOrigin).hostname;
    const frames = new URL(frameOriginTemplate.replace('{artifactId}', 'artifact-placeholder')).hostname.split('.').slice(1).join('.');
    if (shell === frames || shell.endsWith(`.${frames}`) || frames.endsWith(`.${shell}`)) return fail('Shell and frame hostnames must use separate namespaces.');
  }
  const listenHost = fields.listenHost === undefined || fields.listenHost === null || fields.listenHost === '' ? null : fields.listenHost;
  if (listenHost !== null && (typeof listenHost !== 'string' || !isIP(listenHost) || listenHost.startsWith('127.') || ['0.0.0.0', '::', '::1'].includes(listenHost))) return fail('Gateway listenHost must be a concrete non-loopback IP address.');
  const port = fields.port ?? DEFAULT_SETTINGS.hosting.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return fail('Gateway port must be an integer between 1 and 65535.');
  if (publicShellOrigin && !listenHost) return fail('Public hosting requires a concrete gateway listenHost.');
  return { publicShellOrigin, frameOriginTemplate, listenHost: listenHost as string | null, port };
}

/** Report the actual boundary, not availability inferred from configured URLs. */
export function hostingResponse(settings: HostingSettings, enabled = false, error?: string): HostingResponse {
  return {
    settings: { ...settings },
    remote: { supported: true, enabled, ...(error ? { error } : {}), ...(!enabled ? { reason: error ?? 'Configure both HTTPS origins and a concrete gateway listener to enable remote hosting.' } : {}), restartRequired: false },
  };
}

/** Merges a validated patch without replacing unrelated shared settings. */
export function saveSettings(patch: Partial<OpenArtifactSettings>): void {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  const checked = patch.hosting === undefined ? patch : { ...patch, hosting: validateHostingSettings(patch.hosting) };
  writeJson(files.settings(), { ...saved, ...checked });
}
