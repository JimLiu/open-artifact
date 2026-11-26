import { errorInfo } from './errors.ts';
import type { Log } from './types.ts';
/**
 * The app's own settings: one JSON file in Electron's `userData` folder (`settings.json`), not in the Open Artifact
 * home (they are this app's, not the library's). What the window remembers between runs: whether the sidebar is
 * collapsed, the look (`theme`: `system`, `light` or `dark`), the language (`locale`: `system`, `en` or `zh-CN`) and
 * where new artifacts go (`artifactsFolder`: an absolute folder, or empty for the library's own default), and desktop
 * update preferences (`appAutoCheck`: true, `appAutoDownload`: false; separate from the runtime's policy). A
 * file that is missing or does not parse is the defaults, and a value it holds that is not one of a setting's choices
 * is that setting's default; a write that fails is logged and the setting lasts the run.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';

export interface SettingsValues {
  sidebarCollapsed: boolean;
  theme: 'system' | 'light' | 'dark';
  locale: 'system' | 'en' | 'zh-CN';
  artifactsFolder: string;
  autoPublishAsked: boolean;
  appAutoCheck: boolean;
  appAutoDownload: boolean;
}
export const DEFAULTS: Readonly<SettingsValues> = Object.freeze({
  sidebarCollapsed: false,
  theme: 'system',
  locale: 'system',
  artifactsFolder: '',
  autoPublishAsked: false,
  appAutoCheck: true,
  appAutoDownload: false,
});

/** The values a setting may take (a setting not listed takes any value of its default's type). */
export const CHOICES = Object.freeze({
  theme: Object.freeze(['system', 'light', 'dark'] as const),
  locale: Object.freeze(['system', 'en', 'zh-CN'] as const),
});

/** Whether `value` is one `name` may take. */
export function validSetting<K extends string>(name: K, value: unknown): value is K extends keyof SettingsValues ? SettingsValues[K] : never {
  if (!Object.hasOwn(DEFAULTS, name) || typeof value !== typeof DEFAULTS[name as keyof SettingsValues]) return false;
  // Empty (the library's default) or an absolute folder, written as it is meant.
  if (name === 'artifactsFolder')
    return value === '' || (typeof value === 'string' && value.length <= 1024 && isAbsolute(value) && normalize(value) === value && !value.includes('\0'));
  return !(name in CHOICES) || (CHOICES[name as keyof typeof CHOICES] as readonly unknown[]).includes(value);
}

/** Chromium's `--lang` for a language setting (`zh-CN`, `en`; also test mode's `zh`), or `null` for the system's. */
export function chromiumLang(locale: string) {
  if (locale === 'zh-CN' || locale === 'zh') return 'zh-CN';
  if (locale === 'en') return 'en-US';
  return null;
}

/** The settings in `dir/settings.json`: read once, written on every change. */
export class Settings {
  file: string;
  log: Log;
  values: SettingsValues;
  constructor(dir: string, { log = () => {} }: { log?: Log } = {}) {
    this.file = join(dir, 'settings.json');
    this.log = log;
    this.values = { ...DEFAULTS };
    try {
      const read: Record<string, unknown> = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const name of Object.keys(DEFAULTS) as (keyof SettingsValues)[])
        if (validSetting(name, read?.[name])) Object.assign(this.values, { [name]: read[name] });
    } catch {
      // None yet, or not ours to read: the defaults.
    }
  }

  get<K extends keyof SettingsValues>(name: K): SettingsValues[K] {
    return this.values[name];
  }

  set<K extends keyof SettingsValues>(name: K, value: SettingsValues[K]) {
    if (!validSetting(name, value)) throw new Error(`not a setting: ${name} = ${JSON.stringify(value)}`);
    if (this.values[name] === value) return;
    this.values[name] = value;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(this.values, null, 2)}\n`);
      renameSync(temp, this.file);
    } catch (error) {
      this.log(`settings: ${errorInfo(error).message ?? error}`);
    }
  }
}
