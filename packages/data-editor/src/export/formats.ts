import type { ChromeReport } from '@open-artifact/runtime';

export type ChromeFormat = NonNullable<ChromeReport['formats']>[number];

/** `print` opens the browser's print dialog; the others make a file. */
export type DashboardExportFormat = 'pdf' | 'print' | 'html' | 'json';

/** The formats that make a file. */
export type DashboardFileFormat = Exclude<DashboardExportFormat, 'print'>;

export const DASHBOARD_EXPORT_FORMATS: readonly DashboardExportFormat[] = ['pdf', 'print', 'html', 'json'];

export const DASHBOARD_EXPORT_LABELS: Readonly<Record<DashboardExportFormat, { label: string; description: string }>> = {
  pdf: { label: 'PDF', description: 'The dashboard on paper-size pages, in the light look, with text you can select.' },
  print: { label: 'Print…', description: 'Open the print dialog, to print the dashboard or choose the paper and margins yourself.' },
  html: { label: 'Web page (HTML)', description: 'A copy of the page as it shows now. Its numbers do not update.' },
  json: { label: 'Sources and page (JSON)', description: 'Where each number comes from, the filters in effect, and a copy of the page.' },
};

/** Whether the page can be exported now, and why not. */
export interface DashboardExportAvailability {
  ready: boolean;
  why?: ChromeFormat['why'];
  reason?: string;
}

export const isDashboardExportFormat = (format: string): format is DashboardExportFormat =>
  (DASHBOARD_EXPORT_FORMATS as readonly string[]).includes(format);

/** The formats as the Shell lists them, disabled (with why) while the page can't be exported. */
export function dashboardChromeFormats(
  availability: DashboardExportAvailability,
  offered: readonly DashboardExportFormat[] = DASHBOARD_EXPORT_FORMATS,
): ChromeFormat[] {
  const state: Partial<ChromeFormat> = availability.ready
    ? {}
    : {
        disabled: true,
        ...(availability.why === undefined ? {} : { why: availability.why }),
        ...(availability.reason === undefined ? {} : { disabledReason: availability.reason }),
      };
  return offered.map((format) => ({
    format,
    ...DASHBOARD_EXPORT_LABELS[format],
    ...(format === 'print' ? { more: true } : {}),
    ...state,
  }));
}
