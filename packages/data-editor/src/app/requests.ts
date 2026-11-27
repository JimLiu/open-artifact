/**
 * What the page's notices ask the agent: why sources didn't load (or a
 * calculation didn't run), and to fix a page whose code stopped. Each sends
 * the request with where it came from, as data.
 */

import type { Dataset } from '@open-artifact/data-core';
import { sendPageRequest } from '../drafts/request.ts';
import { ASK_REQUESTS, describeCodeFailure, describeSourceFailures, sourceFailureQuestion } from './request-words.ts';

/** Asks the agent why these sources failed; resolves once the request went out (or couldn't). */
export async function askWhySourcesFailed(failed: Dataset[]): Promise<void> {
  if (failed.length === 0) return;
  const request = sourceFailureQuestion(failed);
  await sendPageRequest({ title: request, request, selection: describeSourceFailures(failed) });
}

export function askToFixPage(files: readonly string[]): void {
  const request = ASK_REQUESTS.fixPage;
  void sendPageRequest({ title: request, request, selection: describeCodeFailure(files) });
}
