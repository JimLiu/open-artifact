/**
 * The border alignment button (Inside → Center → Outside), shared by the
 * quick bar's border panel and the properties panel. Disabled with the
 * reason when the border can't be aligned.
 */

import { styleMap, type HtmlElement } from '@open-artifact/dc';
import { alignSelectedBorder } from '../services/border-align.ts';
import { alignmentName, alignRefusal, nextAlignment, readAlignment, type BorderAlignment } from '../lib/border-align.ts';
import { PTipButton } from './fields.tsx';

/** Where the stroke sits against the box edge (dashed), per alignment. */
const STROKE_X: Record<BorderAlignment, number> = { inside: 5.5, center: 4, outside: 2.5 };

function AlignGlyph({ alignment }: { alignment: BorderAlignment }) {
  const x = STROKE_X[alignment];
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
      <path d="M4 2V14" stroke="currentColor" strokeWidth={1} strokeDasharray="1.5 1.5" opacity={0.6} />
      <path d={`M${x} 2V14`} stroke="currentColor" strokeWidth={3} />
      <path d="M8.5 5H13M8.5 8H13M8.5 11H13" stroke="currentColor" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

/** Steps the selected element's border to the next alignment (measured in the artboard on click). */
export function BorderAlignButton({ element, computed, disabled }: { element: HtmlElement; computed: Record<string, string>; disabled?: boolean }) {
  const { alignment } = readAlignment(styleMap(element.attrs.find((attr) => attr.name.toLowerCase() === 'style')?.value ?? ''), computed);
  const refusal = alignRefusal(element, computed);
  const next = nextAlignment(alignment);
  return (
    <PTipButton
      tip={refusal ?? alignmentName(alignment)}
      label={alignmentName(alignment)}
      disabled={disabled || Boolean(refusal)}
      onClick={() => alignSelectedBorder(next)}
    >
      <AlignGlyph alignment={alignment} />
    </PTipButton>
  );
}
