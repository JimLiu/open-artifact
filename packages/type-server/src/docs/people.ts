/**
 * The names of the people who have worked on a doc, by the id its records name them with (a version's `user`, a
 * suggestion's `by`), so the page can say "Ada" rather than an id. Each name is the last one the person went by here.
 * Kept in the doc folder beside the sessions file; a person who never wrote is not in it.
 */
import type { DocStore } from './store.ts';

/** How many names a doc keeps; the ones seen longest ago go first. */
export const PEOPLE_MAX = 500;
const NAME_MAX = 120;

export class DocPeople {
  private readonly store: DocStore;
  private names: Map<string, string>;
  private constructor(store: DocStore, names: Map<string, string>) {
    this.store = store;
    this.names = names;
  }

  /** The doc folder's names (none when the file is missing or unreadable). */
  static open(store: DocStore): DocPeople {
    const names = new Map<string, string>();
    try {
      const raw = store.readPeople();
      if (raw && typeof raw === 'object' && !Array.isArray(raw))
        for (const [id, name] of Object.entries(raw as Record<string, unknown>)) if (typeof name === 'string' && name.trim()) names.set(id, name);
    } catch {
      // No names yet.
    }
    return new DocPeople(store, names);
  }

  /** Remembers what `id` goes by now; writes only when it changed. */
  remember(id: string, name: string): void {
    const clean = name.trim().slice(0, NAME_MAX);
    if (!id || !clean) return;
    const known = this.names.get(id);
    // Seen again: last in line, so the oldest are the ones let go.
    this.names.delete(id);
    this.names.set(id, clean);
    while (this.names.size > PEOPLE_MAX) this.names.delete(this.names.keys().next().value!);
    if (known === clean) return;
    try {
      this.store.savePeople(Object.fromEntries(this.names));
    } catch {
      // A name not kept only means an id shows until the person writes again.
    }
  }

  nameOf(id: string | undefined): string | undefined {
    return id ? this.names.get(id) : undefined;
  }

  /** Every name known, by id. */
  all(): Record<string, string> {
    return Object.fromEntries(this.names);
  }
}
