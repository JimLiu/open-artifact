import { isPageAt, pageUrlOf } from './page-url.ts';

/** Only an unpackaged app may load the loopback Vite page. Production always loads its built file. */
export function rendererUrl(value: string | undefined, packaged: boolean): string | null {
  if (packaged || !value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/dev.html' || url.search || url.hash || url.username || url.password)
    throw new Error('OA_DESKTOP_RENDERER_URL must be http://127.0.0.1:<port>/dev.html');
  return url.href;
}

export function desktopPage(path: string, development: string | null) {
  return {
    url: development ?? pageUrlOf(path),
    matches: (url: unknown) => development ? url === development : isPageAt(url, path),
  };
}
