/** The native Info.plist keys exercised by the packaging tests. Other keys are compared unchanged. */
export interface AppPlist {
  CFBundleIdentifier: string;
  CFBundleName: string;
  CFBundleExecutable: string;
  CFBundleDisplayName?: string;
  CFBundleIconFile?: string;
  CFBundleShortVersionString?: string;
  CFBundleURLTypes?: { CFBundleURLName?: string; CFBundleURLSchemes?: string[] }[];
  [key: string]: unknown;
}
