/**
 * The part of OMP's extension API this package uses (OMP's `src/extensibility/extensions/types.ts`), declared here so
 * the package needs no copy of OMP: OMP provides its API to an extension at load time, and a package must not list
 * OMP among its dependencies. OMP validates tool parameters as JSON Schema, so the tools pass the daemon's schemas as
 * they are.
 */

/** One block of a tool result or a message. */
export interface OmpTextContent {
  type: 'text';
  text: string;
}

/** What a tool's `execute` answers. Throwing marks the call as failed, with the error's message as its text. */
export interface OmpToolResult<Details = unknown> {
  content: OmpTextContent[];
  details: Details;
}

/** A session, as `ctx.sessionManager` reads it. */
export interface OmpSessionManager {
  getSessionId(): string;
  getSessionName?(): string | undefined;
}

/** The context every handler gets. Stale once its session is replaced (`/new`, `/resume`, `/fork`, `/reload`). */
export interface OmpContext {
  cwd: string;
  /** `tui`, `print`, `json`, `rpc` or `acp`. */
  mode?: string;
  hasUI: boolean;
  sessionManager: OmpSessionManager;
  /** False while OMP runs the agent, retries, compacts or continues with queued messages. */
  isIdle(): boolean;
}

/** How a tool is presented when enabled: `essential` stays top-level, `discoverable` is hidden until found. */
export type OmpToolLoadMode = 'essential' | 'discoverable';

/** A tool the model can call. */
export interface OmpTool {
  name: string;
  label: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: unknown;
  /** Extension tools default to `discoverable`; these stay top-level. */
  loadMode?: OmpToolLoadMode;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: OmpToolResult) => void) | undefined,
    ctx: OmpContext,
  ): Promise<OmpToolResult>;
}

/** One line of a command's argument completions. */
export interface OmpCompletion {
  value: string;
  label: string;
  description?: string;
}

/** A slash command. */
export interface OmpCommand {
  description?: string;
  getArgumentCompletions?(prefix: string): OmpCompletion[] | null;
  handler(args: string, ctx: OmpContext): void | Promise<void>;
}

/** A custom message: in the model's context, shown in the transcript when `display` is true. */
export interface OmpCustomMessage {
  customType: string;
  content: string;
  display: boolean;
  details?: unknown;
}

/** How a message enters a session: steered into a running turn, after it, with the next turn, or at a step boundary. */
export type OmpDelivery = 'steer' | 'followUp' | 'nextTurn' | 'aside';

/** The `agent_end` event: `willContinue` is true for a loop stop inside a run (an automatic continuation follows). */
export interface OmpAgentEndEvent {
  willContinue?: boolean;
  awaitingAsyncWork?: boolean;
}

export interface OmpBeforeAgentStartEvent {
  reason: 'prompt' | 'revive';
  /** The already-transformed prompt text. */
  prompt: string;
  /** The system prompt blocks this request is built from. */
  systemPrompt: string[];
}

/**
 * `/new`, `/resume` and `/fork` replace the session id without a new `session_start`; `ctx.sessionManager` has the new
 * one. `/clear` keeps the id and sends `session_clear` instead.
 */
export interface OmpSessionSwitchEvent {
  reason: 'new' | 'resume' | 'fork';
  /** The session file the switch came from. */
  previousSessionFile?: string;
}

/** What a `before_agent_start` handler returns: a replacement system prompt, for this request and its continuations. */
export interface OmpBeforeAgentStartResult {
  systemPrompt?: string[];
}

export interface OmpToolResultEvent {
  toolName: string;
  input: Record<string, unknown>;
  isError: boolean;
}

/** The `omp` object an extension's default export is called with. */
export interface OmpExtensionAPI {
  registerTool(tool: OmpTool): void;
  registerCommand(name: string, command: OmpCommand): void;
  sendMessage(message: OmpCustomMessage, options?: { triggerTurn?: boolean; deliverAs?: OmpDelivery }): void;
  /** Idle starts a turn; streaming queues as steer unless `deliverAs` is set. `expandPromptTemplates` is not an option here. */
  sendUserMessage(content: string, options?: { deliverAs?: 'steer' | 'followUp' | 'aside' }): Promise<void>;
  on(event: 'session_start' | 'session_shutdown', handler: (event: unknown, ctx: OmpContext) => unknown): void;
  on(event: 'session_switch', handler: (event: OmpSessionSwitchEvent, ctx: OmpContext) => unknown): void;
  on(
    event: 'before_agent_start',
    handler: (event: OmpBeforeAgentStartEvent, ctx: OmpContext) => OmpBeforeAgentStartResult | void | Promise<OmpBeforeAgentStartResult | void>,
  ): void;
  on(event: 'agent_start', handler: (event: unknown, ctx: OmpContext) => unknown): void;
  on(event: 'agent_end', handler: (event: OmpAgentEndEvent, ctx: OmpContext) => unknown): void;
  on(event: 'tool_result', handler: (event: OmpToolResultEvent, ctx: OmpContext) => unknown): void;
}
