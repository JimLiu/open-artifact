/**
 * The app's own settings: one JSON file in Electron's `userData` folder (`settings.json`), not in the Open Artifact
 * home (they are this app's, not the library's). Only what the window remembers between runs: whether the sidebar is
 * collapsed. A file that is missing or does not parse is the defaults; a write that fails is logged and the setting
 * lasts the run.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULTS = Object.freeze({ sidebarCollapsed: false });

/** The settings in `dir/settings.json`: read once, written on every change. */
export class Settings {
  constructor(dir, { log = () => {} } = {}) {
    this.file = join(dir, 'settings.json');
    this.log = log;
    this.values = { ...DEFAULTS };
    try {
      const read = JSON.parse(readFileSync(this.file, 'utf8'));
      if (typeof read?.sidebarCollapsed === 'boolean') this.values.sidebarCollapsed = read.sidebarCollapsed;
    } catch {
      // None yet, or not ours to read: the defaults.
    }
  }

  get(name) {
    return this.values[name];
  }

  set(name, value) {
    if (!(name in DEFAULTS) || typeof value !== typeof DEFAULTS[name]) throw new Error(`not a setting: ${name}`);
    if (this.values[name] === value) return;
    this.values[name] = value;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(this.values, null, 2)}\n`);
      renameSync(temp, this.file);
    } catch (error) {
      this.log(`settings: ${error?.message ?? error}`);
    }
  }
}
