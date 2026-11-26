/**
 * Open Artifact in OMP: an L3 adapter over the Harness API, through `@open-artifact/harness-kit`.
 *
 * - The Artifact, ArtifactData and ArtifactComments tools, registered as OMP tools with the daemon's own schemas and
 *   `loadMode: 'essential'` (OMP hides extension tools at the bottom of its tool list otherwise). A call names its
 *   session (`caller`), so the artifacts it makes belong to this OMP session. A daemon error fails the call (OMP shows
 *   it as an error), with the whole answer as its text; Esc cancels the wait.
 * - Comments and edit requests from artifact pages wake this session: the owner's words become a user message, which
 *   starts a turn when OMP is idle and is steered into the running turn otherwise; a collaborator's or the system's
 *   become a custom message the model reads (never a user message), the same way. What waited in the session's inbox
 *   comes the same way when the session attaches (a resumed session gets what came while it was away).
 * - The always-on Open Artifact prompt, added to the system prompt on `before_agent_start` (OMP takes the event's
 *   returned prompt, not a section of it); the `open-artifact` skill, written next to this package's `skills/` folder,
 *   which OMP scans as an extension package (it does not fire `resources_discover`); `/open-artifact <type> <what to
 *   make>` with the installed types as completions, which sends the skill and the request as one user message (OMP
 *   does not expand prompt templates in `sendUserMessage`).
 * - The session's state (`running` / `idle`) and the files OMP's own `write` and `edit` tools wrote (`agent.wrote`), so
 *   open pages follow at once.
 *
 * The daemon is only started by a tool call: a session that never makes an artifact starts nothing. When a daemon
 * already runs, the session connects at start so comments reach it.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, installSkill, localSkill, readDaemon, renderSkill, type Harness, type InstallSkillOptions } from '@open-artifact/harness-kit';
import { AGENT_PROMPT, TOOL_DEFINITIONS, toolCallContent, type CommandEntry, type SessionParams, type ToolCallResult, type ToolDefinition, type WakeDeliverParams, type WakeDeliverStatus } from '@open-artifact/protocol';
import type { OmpAgentEndEvent, OmpCompletion, OmpContext, OmpExtensionAPI, OmpTextContent, OmpToolResult } from './omp.ts';
import { hostRuntime } from './runtime.ts';

/** The harness name: the daemon's profile `omp` (packages/daemon/harnesses/omp.json). */
export const HARNESS = 'omp';
/** What pages call the agent. */
export const AGENT_NAME = 'OMP';
/** The command, and the skill's name. */
export const COMMAND = 'open-artifact';
/** The `customType` of the messages this extension puts in a session. */
export const MESSAGE_TYPE = 'open-artifact';

/** How the skill reads for OMP: native tools, and pages shown in the computer's browser (OMP has no page view). */
const SKILL: Omit<InstallSkillOptions, 'dir' | 'force'> = { command: COMMAND, agentName: AGENT_NAME, tools: 'native', opens: 'system' };

/**
 * OMP's profile, also reported in `hello`: a daemon that does not ship `harnesses/omp.json` (an older one already
 * running) keeps it, so it still knows OMP's commands by their variables and refuses the person's commands there.
 */
export const PROFILE = {
  title: 'OMP',
  level: 'L3',
  entry: 'harness-api',
  plugin: 'omp-open-artifact',
  sessionEnv: 'OMP_BASH_SESSION',
  markers: ['OMP_BASH_SESSION'],
  wake: ['live', 'inbox'],
  open: 'browser',
} as const;

/** Options of {@link openArtifact}, for tests and hosts that embed OMP. */
export interface OpenArtifactOmpOptions {
  /** The Open Artifact home (default `$OPEN_ARTIFACT_HOME`, else `~/.open-artifact`). */
  home?: string;
  /** The runtime this package carries (default {@link hostRuntime}); `null`: none, the kit finds one. */
  runtime?: { dir: string; version: string } | null;
  /** Where the skill is written (default this package's `skills/`, which OMP scans as an extension package). */
  skillsDir?: string;
  /** Diagnostic log (default: stderr when `OMP_OPEN_ARTIFACT_DEBUG` is set). */
  log?: (line: string) => void;
}

/** A path as OMP's file tools take it (`@` prefix, `~`), made absolute against the session's folder. */
export function absolutePath(path: string, cwd: string): string {
  const bare = path.startsWith('@') ? path.slice(1) : path;
  if (bare === '~') return homedir();
  if (bare.startsWith('~/')) return join(homedir(), bare.slice(2));
  return resolve(cwd, bare);
}

/** The text after the command in a `commands.list` entry (`/open-artifact slides ` → `slides `). */
function argumentOf(entry: CommandEntry): string {
  return entry.text.replace(/^\/\S+\s*/, '');
}

/** Rejects when `signal` aborts first. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error('Cancelled.'));
  return new Promise<T>((done, fail) => {
    const onAbort = () => fail(new Error('Cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        done(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        fail(error);
      },
    );
  });
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The extension: `export default openArtifact()` is what OMP loads. */
export function openArtifact(options: OpenArtifactOmpOptions = {}): (omp: OmpExtensionAPI) => void {
  return (omp) => setup(omp, options);
}

function setup(omp: OmpExtensionAPI, options: OpenArtifactOmpOptions): void {
  const log = options.log ?? (process.env.OMP_OPEN_ARTIFACT_DEBUG ? (line: string) => process.stderr.write(`${line}\n`) : () => undefined);
  const skillsDir = options.skillsDir ?? fileURLToPath(new URL('../skills', import.meta.url));

  /** The session's context, from `session_start` to `session_shutdown`. */
  let ctx: OmpContext | null = null;
  let session: SessionParams = {};
  /** The session ended: nothing connects again. */
  let closed = false;
  /** Whether OMP runs the agent now (`agent_start` … a terminal `agent_end`). */
  let running = false;
  let pending: Promise<Harness> | null = null;
  let harness: Harness | null = null;
  /** The always-on prompt, with the installed types once a daemon answered. */
  let prompt = AGENT_PROMPT;
  /** The skill's body, for `/open-artifact` (OMP does not expand `/skill:` in a message an extension sends). */
  let skillBody = localSkill(SKILL).body;
  let commands: CommandEntry[] = [];
  let registered = '';

  // ---- tools ----

  const callerOf = (c: OmpContext): SessionParams => ({ session: c.sessionManager.getSessionId(), workspace: c.cwd });

  const runTool = async (name: string, args: Record<string, unknown>, signal: AbortSignal | undefined, c: OmpContext): Promise<OmpToolResult<ToolCallResult>> => {
    const h = await untilAborted(connect(), signal);
    const result = await untilAborted(h.call(name, args, callerOf(c)), signal);
    const content = (toolCallContent(result).content as OmpTextContent[]) ?? [];
    // OMP shows a thrown error as the failed call's result: the text keeps all the daemon said (a conflict's `current`).
    if (result?.error) throw new Error(content.map((block) => block.text).join('\n\n'));
    return { content, details: result };
  };

  /** Registers the tools, again only when the definitions changed (a daemon of another version). */
  const registerTools = (definitions: ToolDefinition[]): void => {
    const key = JSON.stringify(definitions.map((d) => [d.name, d.description, d.inputSchema]));
    if (key === registered) return;
    registered = key;
    for (const definition of definitions) {
      omp.registerTool({
        name: definition.name,
        label: definition.name,
        description: definition.description,
        parameters: definition.inputSchema,
        loadMode: 'essential',
        execute: (_id, params, signal, _onUpdate, c) => runTool(definition.name, params ?? {}, signal, c),
      });
    }
  };
  registerTools(TOOL_DEFINITIONS);

  // ---- wakes ----

  const wake = async (params: WakeDeliverParams): Promise<WakeDeliverStatus> => {
    if (closed || !ctx) return 'failed';
    if (params.session ? params.session !== session.session : params.workspace && params.workspace !== session.workspace) return 'failed';
    const idle = ctx.isIdle();
    try {
      if (params.source?.from?.kind === 'owner') {
        // The person's own words: a user message, as if typed.
        if (idle) await omp.sendUserMessage(params.text);
        else await omp.sendUserMessage(params.text, { deliverAs: 'steer' });
      } else {
        // A collaborator's or the system's: the model reads it, and it is never taken for the person's words.
        omp.sendMessage(
          { customType: MESSAGE_TYPE, content: params.text, display: true, details: { artifact: params.artifact, source: params.source } },
          { triggerTurn: true, deliverAs: idle ? 'followUp' : 'steer' },
        );
      }
    } catch (error) {
      // A failed answer makes the daemon keep the message in the session's inbox instead of losing it.
      log(`open-artifact wake: ${messageOf(error)}`);
      return 'failed';
    }
    return idle ? 'resumed' : 'delivered';
  };

  // ---- the connection ----

  /** Attaches a session and gives the daemon back what its wake callback did not take. */
  const attach = async (h: Harness, ref: SessionParams): Promise<void> => {
    const { inbox } = await h.attach({ ...ref, status: running ? 'running' : 'idle', pid: process.pid });
    // The attach took them out of the daemon; what `wake` did not take (a note, say) waits for the next tool call.
    if (inbox.length && h.features.includes('inbox.return')) {
      await h.client
        .request('inbox.return', { session: ref.session ?? null, workspace: ref.workspace ?? null, messages: inbox })
        .catch((error: unknown) => log(`open-artifact inbox.return: ${messageOf(error)}`));
    }
  };

  /** Tools, prompt, skill and commands as the daemon has them now; each step on its own. */
  const refresh = async (h: Harness): Promise<void> => {
    try {
      registerTools(await h.tools());
    } catch (error) {
      log(`open-artifact tools: ${messageOf(error)}`);
    }
    try {
      const { skill } = await renderSkill(h.client, SKILL);
      if (skill.prompt) prompt = skill.prompt;
      skillBody = skill.body;
    } catch (error) {
      log(`open-artifact prompt: ${messageOf(error)}`);
    }
    try {
      await h.installSkill({ dir: skillsDir, ...SKILL });
    } catch (error) {
      log(`open-artifact skill: ${messageOf(error)}`);
    }
    try {
      commands = await h.commands({ command: COMMAND });
    } catch (error) {
      log(`open-artifact commands: ${messageOf(error)}`);
    }
  };

  const open = async (): Promise<Harness> => {
    const runtime = options.runtime === undefined ? hostRuntime() : options.runtime;
    const h = await createHarness({
      harness: HARNESS,
      agentName: AGENT_NAME,
      commands: [COMMAND],
      caps: { tools: 'native', wake: { resume: true } },
      profile: { ...PROFILE, markers: [...PROFILE.markers], wake: [...PROFILE.wake] },
      wake,
      log,
      ...(options.home ? { home: options.home } : {}),
      ...(runtime ? { runtime } : {}),
    });
    try {
      // `createHarness` keeps trying in the background when its first try failed; this says why it could not.
      await h.ready();
      if (closed) throw new Error('The OMP session ended.');
      await attach(h, session);
    } catch (error) {
      h.close();
      throw error;
    }
    harness = h;
    h.on('state', (state) => {
      if (state === 'connected') void refresh(h);
    });
    await refresh(h);
    return h;
  };

  /** The connection, made once (starting the daemon when none runs); a failure lets the next call try again. */
  const connect = (): Promise<Harness> => {
    if (closed) return Promise.reject(new Error('The OMP session ended.'));
    pending ??= open().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };

  // ---- OMP's events ----

  omp.on('session_start', (_event, c) => {
    ctx = c;
    session = callerOf(c);
    // Only a daemon that already runs: the session takes the comments made while it was away, and new ones.
    void readDaemon(options.home)
      .then((state) => (state && !closed ? connect() : null))
      .catch((error: unknown) => closed || log(`open-artifact connect: ${messageOf(error)}`));
  });

  omp.on('session_shutdown', () => {
    closed = true;
    ctx = null;
    harness?.close();
    harness = null;
    void pending?.then(
      (h) => h.close(),
      () => undefined,
    );
  });

  omp.on('session_switch', (_event, c) => {
    if (closed) return;
    // `/new`, `/resume` and `/fork` change the id in place: the connection stays, its attachment moves.
    const previous = session;
    ctx = c;
    session = callerOf(c);
    running = !c.isIdle();
    void pending
      ?.then(async (h) => {
        if (previous.session && previous.session !== session.session) {
          await h.detach(previous).catch((error: unknown) => log(`open-artifact detach: ${messageOf(error)}`));
        }
        await attach(h, session);
      }, () => undefined)
      .catch((error: unknown) => closed || log(`open-artifact session switch: ${messageOf(error)}`));
  });

  omp.on('before_agent_start', (event) => {
    // OMP takes a replacement prompt from the handler's answer; there is no section list to patch.
    return { systemPrompt: [...event.systemPrompt, prompt] };
  });

  /**
   * Runs `work` on the connection once it is made, if one is made or being made; never starts one. A call that the
   * session's own shutdown cut off is not an error.
   */
  const onceConnected = (what: string, work: (h: Harness) => Promise<unknown>): void => {
    void pending
      ?.then(work, () => undefined)
      .catch((error: unknown) => closed || log(`open-artifact ${what}: ${messageOf(error)}`));
  };

  const status = (state: 'running' | 'idle'): void => {
    running = state === 'running';
    onceConnected('status', (h) => h.status(session, state));
  };
  omp.on('agent_start', () => status('running'));
  omp.on('agent_end', (event: OmpAgentEndEvent) => {
    // A loop stop inside a run (`willContinue`) and a wait for background work are not the session settling.
    if (!event.willContinue && !event.awaitingAsyncWork) status('idle');
  });

  omp.on('tool_result', (event, c) => {
    if (event.isError || (event.toolName !== 'write' && event.toolName !== 'edit')) return;
    const path = event.input?.path;
    if (typeof path !== 'string' || !path) return;
    const paths = [absolutePath(path, c.cwd)];
    const caller = callerOf(c);
    onceConnected('wrote', (h) => h.wrote(paths, caller));
  });

  omp.registerCommand(COMMAND, {
    description: 'Make an Open Artifact: /open-artifact <type> <what to make>',
    getArgumentCompletions: (prefix) => {
      const items: OmpCompletion[] = commands
        .map((entry) => ({ value: argumentOf(entry), label: entry.type, description: entry.title }))
        .filter((item) => item.value.startsWith(prefix));
      return items.length ? items : null;
    },
    handler: async (args, c) => {
      // OMP sends a message without expanding `/skill:`: the skill goes with the request, as Pi's expansion would.
      const text = args.trim() ? `${skillBody}\n\n${args.trim()}` : skillBody;
      try {
        if (c.isIdle()) await omp.sendUserMessage(text);
        else await omp.sendUserMessage(text, { deliverAs: 'followUp' });
      } catch (error) {
        log(`open-artifact command: ${messageOf(error)}`);
      }
    },
  });
}
