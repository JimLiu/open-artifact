/**
 * What a package adds to its `Info.plist` (`@electron/packager`'s `extendInfo`).
 *
 * By default nothing: a package declares no URL scheme, so installing or running it never makes it the handler of
 * `open-artifact://`. With `OA_DESKTOP_URL_SCHEME=1` set when packaging, it declares the scheme
 * (`CFBundleURLTypes`): macOS then hands such links to it through `open-url` once the app has been run from where it
 * is installed. Nothing here registers anything; that is the system's, on its own terms.
 *
 * Pure functions: the unit tests check what is generated without building a package.
 */
import { SCHEME } from '../src/links.ts';

/** Whether the environment asks for the scheme to be declared (exactly `OA_DESKTOP_URL_SCHEME=1`). */
export const urlSchemeFromEnv = (env = process.env) => env.OA_DESKTOP_URL_SCHEME === '1';

/** The keys added to `Info.plist`: `{}`, or the URL type of `open-artifact://` when `urlScheme` is true. */
export function infoPlistAdditions({ urlScheme = false, bundleId = 'dev.openartifact.desktop' } = {}) {
  if (!urlScheme) return {};
  return {
    CFBundleURLTypes: [
      {
        CFBundleURLName: `${bundleId}.link`,
        CFBundleURLSchemes: [SCHEME],
        CFBundleTypeRole: 'Viewer',
      },
    ],
  };
}
