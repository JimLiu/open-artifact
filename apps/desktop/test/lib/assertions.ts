import assert from 'node:assert/strict';
import type { InstalledAppState } from '../../src/installed-app-types.ts';

/** Test fixtures are often filled by a hook or a polling callback. Check their readiness where they are read. */
export function present<T>(value: T): NonNullable<T> {
  assert.ok(value !== null && value !== undefined, 'expected a value');
  return value;
}
type WithField<T, K> = T extends object ? (K extends keyof T ? T : never) : never;
type AppField = InstalledAppState extends infer S ? (S extends InstalledAppState ? keyof S : never) : never;
/** Require the journal phase that actually provides the field under test, preserving its discriminated type. */
export function appField<K extends AppField>(state: InstalledAppState, key: K): WithField<InstalledAppState, K> {
  assert.ok(key in state, `app state ${state.state} has no ${key}`);
  return state as WithField<InstalledAppState, K>;
}

export function replyValue<T>(reply: import('../../src/types.ts').Reply<T>): T {
  assert.ok(reply.ok, JSON.stringify(reply));
  return reply.value;
}
