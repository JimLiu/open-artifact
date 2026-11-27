import type { CalculationData, CalculationReport } from './connector-types.ts';

/**
 * The status of a calculation that its stopped inputs (each neither "ok" nor "loading") keep from running:
 * "connect" or "declined" when each waits on the person or was turned off ("connect" if any waits), else "error".
 */
export function getStoppedCalculationStatus(stopped: readonly string[]): 'error' | 'connect' | 'declined' {
  if (stopped.length === 0 || stopped.some((status) => status !== 'connect' && status !== 'declined')) return 'error';
  return stopped.includes('connect') ? 'connect' : 'declined';
}

/** How a calculation's status is reported to the agent: "ok" and "loading" as they are, any other as "error". */
export function getReportedCalculationStatus(status: CalculationData['status']): CalculationReport['status'] {
  return status === 'ok' || status === 'loading' ? status : 'error';
}
