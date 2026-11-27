import { create } from 'zustand';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { askWithEdits } from '../drafts/edit-flow.ts';
import { sendPageRequest } from '../drafts/request.ts';
import { DESIGN_SYSTEM_ASK_MS, DESIGN_SYSTEM_REQUEST, DESIGN_SYSTEM_SELECTION } from './look-card.ts';

interface ChangeDesignSystemState {
  /** Change was pressed: busy while the agent works, or for {@link DESIGN_SYSTEM_ASK_MS} when it does not start. */
  asked: boolean;
}

export const useChangeDesignSystem = create<ChangeDesignSystemState>()(() => ({ asked: false }));

let timer: ReturnType<typeof setTimeout> | undefined;
let stopWatching: (() => void) | null = null;

function settle(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  stopWatching?.();
  stopWatching = null;
  useChangeDesignSystem.setState({ asked: false });
}

/**
 * Keeps `asked` on while the agent works (its activity already holds through short pauses); drops it as soon as the
 * work ends, or after {@link DESIGN_SYSTEM_ASK_MS} when the agent does not start.
 */
function holdAsked(): void {
  if (timer !== undefined) clearTimeout(timer);
  stopWatching?.();
  stopWatching = useAgentActivity.subscribe((state, previous) => {
    if (state.activity === previous.activity) return;
    if (state.activity === 'working') {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    } else if (previous.activity === 'working') settle();
  });
  timer = useAgentActivity.getState().activity === 'working' ? undefined : setTimeout(settle, DESIGN_SYSTEM_ASK_MS);
}

/** Asks the agent to change the dashboard's design system (unsaved hand edits are dealt with first). */
export function changeDesignSystem(): void {
  if (useChangeDesignSystem.getState().asked) return;
  askWithEdits(() => {
    useChangeDesignSystem.setState({ asked: true });
    holdAsked();
    void sendPageRequest({ title: DESIGN_SYSTEM_SELECTION.label, request: DESIGN_SYSTEM_REQUEST, selection: { ...DESIGN_SYSTEM_SELECTION, chip: { ...DESIGN_SYSTEM_SELECTION.chip } } }).then((handed) => {
      if (!handed) settle();
    });
  });
}
