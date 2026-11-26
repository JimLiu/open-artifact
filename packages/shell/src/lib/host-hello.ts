/**
 * Which `host_hello` is taken, and the memory of the declared-origin list.
 *
 * The Shell (`shell/bridge.ts`) and the home page (`home/host.ts`) both use this. Neither keeps
 * its own request number. `hostVerdict` itself does not remember a list: a failed read is
 * `undeclared` until {@link settleHostOriginRead} has a successful one to reuse.
 */

/** Whether a `host_hello` from `origin` is taken against this list (one read, no memory). */
export function hostVerdict(origin: string, hosts: readonly string[] | null): 'declared' | 'undeclared' | 'refused' {
  // `null` or an empty list declares nothing. Callers that already read a list must not pass `null`
  // for a later failure; they pass the list they kept.
  if (!hosts || !hosts.length) return 'undeclared';
  return hosts.includes(origin) ? 'declared' : 'refused';
}

/**
 * One page's reads of `GET /api/open-artifact.embed`. `lastGoodHosts` stays `null` until a read
 * returns a list (an empty list is a success that declares nothing). `goodSeq` is the read that
 * produced it, so an older list cannot replace a newer one.
 */
export interface HostOriginLedger {
  seq: number;
  goodSeq: number;
  lastGoodHosts: readonly string[] | null;
}

/** A read started by {@link beginHostOriginRead}. */
export interface HostOriginRead {
  seq: number;
}

export function emptyHostOriginLedger(): HostOriginLedger {
  return { seq: 0, goodSeq: 0, lastGoodHosts: null };
}

/** Starts a read. The next one gets a higher `seq`, which is how a late answer is told from the current one. */
export function beginHostOriginRead(ledger: HostOriginLedger): { ledger: HostOriginLedger; read: HostOriginRead } {
  const seq = ledger.seq + 1;
  return { ledger: { ...ledger, seq }, read: { seq } };
}

/** What to do with the hello that started this read. */
export type HostHelloDecision =
  /** This hello lost to a newer one. Do not accept it. */
  | { action: 'discard' }
  /** The origin is not on the list that applies. Clear a host this origin already wrote. */
  | { action: 'refuse' }
  /** Take the hello. `declared` is false for `undeclared` (no list has been read yet). */
  | { action: 'accept'; verdict: 'declared' | 'undeclared' };

/**
 * Settles one `declaredHosts()` callback.
 *
 * A failure (`hosts === null`) before any success is still `undeclared`. After a success, a
 * failure is judged by `lastGoodHosts` and must not accept an origin that list refuses.
 * A hello whose read is no longer the latest does not get accepted. A successful list from
 * that older read is still kept when no newer list has arrived: dropping it because a newer
 * read had only started would let that newer read's failure accept a refused origin. When the
 * list now in hand refuses `origin`, the decision is `refuse` so a host an earlier failure
 * wrote is cleared.
 */
export function settleHostOriginRead(
  ledger: HostOriginLedger,
  read: HostOriginRead,
  origin: string,
  hosts: readonly string[] | null,
): { ledger: HostOriginLedger; decision: HostHelloDecision } {
  let next = ledger;
  if (hosts !== null && read.seq > ledger.goodSeq) {
    next = { ...ledger, goodSeq: read.seq, lastGoodHosts: [...hosts] };
  }
  const stale = read.seq !== next.seq;
  if (stale) {
    if (next.lastGoodHosts && hostVerdict(origin, next.lastGoodHosts) === 'refused') {
      return { ledger: next, decision: { action: 'refuse' } };
    }
    return { ledger: next, decision: { action: 'discard' } };
  }
  const list = hosts !== null ? hosts : next.lastGoodHosts;
  const verdict = hostVerdict(origin, list);
  if (verdict === 'refused') return { ledger: next, decision: { action: 'refuse' } };
  return { ledger: next, decision: { action: 'accept', verdict } };
}

/**
 * The host record after a decision. A refusal clears only a record this `origin` wrote.
 * A discarded read leaves the record alone. `accept` runs only when the hello is taken.
 */
export function hostAfterHello<T extends { origin: string }>(
  current: T | null,
  origin: string,
  decision: HostHelloDecision,
  accept: () => T | null,
): T | null {
  if (decision.action === 'discard') return current;
  if (decision.action === 'refuse') return current?.origin === origin ? null : current;
  return accept();
}
