/** The card that stands, at a folded heading, for the suggestions its section hides; choosing it unfolds them. */
import { cn } from '@open-artifact/ui';
import { ChevronRight, ListChecks } from 'lucide-react';
import { type CSSProperties, forwardRef, type ReactNode } from 'react';
import { useEditor } from '../editor/format.ts';
import { revealSuggestion } from './decide.ts';
import { type FoldedGroup, foldedGroupLabel, foldedHeadingWords } from './folded.ts';

/** Opens the folded section and looks at the first of the suggestions in it. */
export function revealFolded(group: FoldedGroup): void {
  const first = group.ids[0];
  if (first) revealSuggestion(first);
}

const countOf = (count: number) => (count === 1 ? '1 suggestion' : `${count} suggestions`);

export const FoldedSuggestionsCard = forwardRef<HTMLButtonElement, { group: FoldedGroup; className?: string; style?: CSSProperties }>(function FoldedSuggestionsCard(
  { group, className, style },
  ref,
): ReactNode {
  const words = useEditor(hold => (hold.state ? foldedHeadingWords(hold.state.doc, group.heading) : ''));
  const count = countOf(group.ids.length);
  const label = foldedGroupLabel(group.ids.length, words);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`${label}: show them`}
      title={label}
      data-folded-suggestions={group.ids.join(' ')}
      style={style}
      className={cn(
        'pointer-events-auto flex w-full items-center gap-2 rounded-[12px] bg-chrome p-2.5 pl-3 text-left text-chrome-fg shadow-chrome outline-none transition-[box-shadow] hover:bg-chrome-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chrome-focus',
        className,
      )}
      onMouseDown={event => event.preventDefault()}
      onClick={() => revealFolded(group)}
    >
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chrome-hover text-chrome-muted">
        <ListChecks className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-4">
        <span className="truncate text-[13px] font-medium">{count}</span>
        <span className="truncate text-[12px] text-chrome-muted">{words ? `In the section “${words}”` : 'In this folded section'}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.75} />
    </button>
  );
});
