/**
 * The part of Pi's extension API this package uses (`@earendil-works/pi-coding-agent`, docs/extensions.md), declared
 * here so the package needs no copy of Pi: Pi provides its API to an extension at load time, and a package must not
 * list Pi among its dependencies. Pi validates tool parameters as JSON Schema, so the tools pass the daemon's schemas
 * as they are.
 */

/** One block of a tool result or a message. */
export interface PiTextContent {
  type: 'text';
  text: string;
}

/** What a tool's `execute` answers. Throwing marks the call as failed, with the error's message as its text. */
export interface PiToolResult<Details = unknown> {
  content: PiTextContent[];
  details: Details;
}

/** A session, as `ctx.sessionManager` reads it. */
export interface PiSessionManager {
  getSessionId(): string;
  getSessionName?(): string | undefined;
}

/** The context every handler gets. Stale once its session is replaced (`/new`, `/resume`, `/fork`, `/reload`). */
export interface PiContext {
  cwd: string;
  /** `interactive`, `print`, `json` or `rpc`. */
  mode?: string;
  hasUI: boolean;
  sessionManager: PiSessionManager;
  /** False while Pi runs the agent, retries, compacts or continues with queued messages. */
  isIdle(): boolean;
  ui: { notify(message: string, level?: 'info' | 'warning' | 'error'): void };
}

/** A tool the model can call. */
export interface PiTool {
  name: string;
  label: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: PiToolResult) => void) | undefined,
    ctx: PiContext,
  ): Promise<PiToolResult>;
}

/** One line of a command's argument completions. */
export interface PiCompletion {
  value: string;
  label: string;
  description?: string;
}

/** A slash command. */
export interface PiCommand {
  description?: string;
  getArgumentCompletions?(prefix: string): PiCompletion[] | null | Promise<PiCompletion[] | null>;
  handler(args: string, ctx: PiContext): void | Promise<void>;
}

/** A custom message: in the model's context, shown in the transcript when `display` is true. */
export interface PiCustomMessage {
  customType: string;
  content: string;
  display: boolean;
  details?: unknown;
}

/** How a message enters a session: steered into a running turn, after it, or with the next prompt. */
export type PiDelivery = 'steer' | 'followUp' | 'nextTurn';

export interface PiSessionStartEvent {
  reason: 'startup' | 'reload' | 'new' | 'resume' | 'fork';
}

export interface PiSessionShutdownEvent {
  reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork';
}

export interface PiBeforeAgentStartEvent {
  /** Mutable: Pi patches the model's prompt with what changed. `sections[tag]` is wrapped in `<tag>…</tag>`. */
  systemPromptOptions: { sections?: Record<string, string> };
}

export interface PiToolResultEvent {
  toolName: string;
  input: Record<string, unknown>;
  isError: boolean;
}

export interface PiResourcesDiscoverEvent {
  cwd: string;
  reason: 'startup' | 'reload';
}

export interface PiResources {
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
}

/** The `pi` object an extension's default export is called with. */
export interface PiExtensionAPI {
  registerTool(tool: PiTool): void;
  registerCommand(name: string, command: PiCommand): void;
  sendMessage(message: PiCustomMessage, options?: { triggerTurn?: boolean; deliverAs?: PiDelivery }): void;
  sendUserMessage(content: string, options?: { deliverAs?: 'steer' | 'followUp'; expandPromptTemplates?: boolean }): void;
  on(event: 'session_start', handler: (event: PiSessionStartEvent, ctx: PiContext) => unknown): void;
  on(event: 'session_shutdown', handler: (event: PiSessionShutdownEvent, ctx: PiContext) => unknown): void;
  on(event: 'before_agent_start', handler: (event: PiBeforeAgentStartEvent, ctx: PiContext) => unknown): void;
  on(event: 'agent_start' | 'agent_settled', handler: (event: unknown, ctx: PiContext) => unknown): void;
  on(event: 'tool_result', handler: (event: PiToolResultEvent, ctx: PiContext) => unknown): void;
  on(event: 'resources_discover', handler: (event: PiResourcesDiscoverEvent, ctx: PiContext) => PiResources | Promise<PiResources>): void;
}
