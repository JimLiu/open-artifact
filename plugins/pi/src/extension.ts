/**
 * Open Artifact in Pi: an L3 adapter over the Harness API, through `@open-artifact/harness-kit`.
 *
 * - The Artifact, ArtifactData and ArtifactComments tools, registered as Pi tools with the daemon's own schemas. A call
 *   names its session (`caller`), so the artifacts it makes belong to this Pi session. A daemon error fails the call
 *   (Pi shows it as an error), with the whole answer as its text; Esc cancels the wait.
 * - Comments and edit requests from artifact pages wake this session: the owner's words become a user message, which
 *   starts a turn when Pi is idle and is steered into the running turn otherwise; a collaborator's or the system's
 *   become a custom message the model reads (never a user message), the same way. What waited in the session's inbox
 *   comes the same way when the session attaches (a resumed session gets what came while it was away).
 * - The always-on Open Artifact prompt as a section of Pi's system prompt; the `open-artifact` skill, rendered for Pi,
 *   through `resources_discover`; `/open-artifact <type> <what to make>` with the installed types as completions.
 * - The session's state (`running` / `idle`) and the files Pi's own `write` and `edit` tools wrote (`agent.wrote`), so
 *   open pages follow at once.
 *
 * The daemon is only started by a tool call: a session that never makes an artifact starts nothing. When a daemon
 * already runs, the session connects at start so comments reach it.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHarness, installSkill, openArtifactHome, readDaemon, renderSkill, type Harness, type InstallSkillOptions } from '@open-artifact/harness-kit';
import { AGENT_PROMPT, TOOL_DEFINITIONS, toolCallContent, type CommandEntry, type SessionParams, type ToolCallResult, type ToolDefinition, type WakeDeliverParams, type WakeDeliverStatus } from '@open-artifact/protocol';
import type { PiCompletion, PiContext, PiExtensionAPI, PiTextContent, PiToolResult } from './pi.ts';
import { hostRuntime } from './runtime.ts';

/** The harness name: the daemon's profile `pi` (packages/daemon/harnesses/pi.json). */
export const HARNESS = 'pi';
/** What pages call the agent. */
export const AGENT_NAME = 'Pi';
/** The command, and the skill's name. */
export const COMMAND = 'open-artifact';
/** The `customType` of the messages this extension puts in a session. */
export const MESSAGE_TYPE = 'open-artifact';
/** The system prompt section the always-on prompt goes in (Pi wraps it in `<open_artifact>`). */
export const PROMPT_SECTION = 'open_artifact';

/** How the skill reads for Pi: native tools, and pages shown in the computer's browser (Pi has no page view). */
const SKILL: Omit<InstallSkillOptions, 'dir' | 'force'> = { command: COMMAND, agentName: AGENT_NAME, tools: 'native', opens: 'system' };

/**
 * Pi's profile, also reported in `hello`: a daemon that does not ship `harnesses/pi.json` (an older one already running)
 * keeps it, so it still knows Pi's commands by their variables and refuses the person's commands there.
 */
export const PROFILE = {
  title: 'Pi',
  level: 'L3',
  entry: 'harness-api',
  plugin: 'pi-open-artifact',
  sessionEnv: 'PI_SESSION_ID',
  markers: ['PI_CODING_AGENT', 'PI_SESSION_ID'],
  wake: ['live', 'inbox'],
  open: 'browser',
} as const;

/** Options of {@link openArtifact}, for tests and hosts that embed Pi. */
export interface OpenArtifactPiOptions {
  /** The Open Artifact home (default `$OPEN_ARTIFACT_HOME`, else `~/.open-artifact`). */
  home?: string;
  /** The runtime this package carries (default {@link hostRuntime}); `null`: none, the kit finds one. */
  runtime?: { dir: string; version: string } | null;
  /** Where the skill is written (default `<home>/skills/pi`). */
  skillsDir?: string;
  /** Diagnostic log (default: stderr when `PI_OPEN_ARTIFACT_DEBUG` is set). */
  log?: (line: string) => void;
}

/** The prompt's text without its outer `<open_artifact>` tags, which Pi's section adds. */
export function promptSection(prompt: string): string {
  return prompt
    .trim()
    .replace(/^<open_artifact>\s*/, '')
    .replace(/\s*<\/open_artifact>$/, '');
}

/** A path as Pi's file tools take it (`@` prefix, `~`), made absolute against the session's folder. */
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

/** The extension: `export default openArtifact()` is what Pi loads. */
export function openArtifact(options: OpenArtifactPiOptions = {}): (pi: PiExtensionAPI) => void {
  return (pi) => setup(pi, options);
}

function setup(pi: PiExtensionAPI, options: OpenArtifactPiOptions): void {
  const log = options.log ?? (process.env.PI_OPEN_ARTIFACT_DEBUG ? (line: string) => process.stderr.write(`${line}\n`) : () => undefined);
  const skillsDir = options.skillsDir ?? join(openArtifactHome(options.home), 'skills', HARNESS);

  /** The session's context, from `session_start` to `session_shutdown`. */
  let ctx: PiContext | null = null;
  let session: SessionParams = {};
  /** The session ended: nothing connects again. */
  let closed = false;
  /** Whether Pi runs the agent now (`agent_start` … `agent_settled`). */
  let running = false;
  let pending: Promise<Harness> | null = null;
  let harness: Harness | null = null;
  let prompt = promptSection(AGENT_PROMPT);
  let commands: CommandEntry[] = [];
  let registered = '';

  // ---- tools ----

  const callerOf = (c: PiContext): SessionParams => ({ session: c.sessionManager.getSessionId(), workspace: c.cwd });

  const runTool = async (name: string, args: Record<string, unknown>, signal: AbortSignal | undefined, c: PiContext): Promise<PiToolResult<ToolCallResult>> => {
    const h = await untilAborted(connect(), signal);
    const result = await untilAborted(h.call(name, args, callerOf(c)), signal);
    const content = (toolCallContent(result).content as PiTextContent[]) ?? [];
    // Pi shows a thrown error as the failed call's result: the text keeps all the daemon said (a conflict's `current`).
    if (result?.error) throw new Error(content.map((block) => block.text).join('\n\n'));
    return { content, details: result };
  };

  /** Registers the tools, again only when the definitions changed (a daemon of another version). */
  const registerTools = (definitions: ToolDefinition[]): void => {
    const key = JSON.stringify(definitions.map((d) => [d.name, d.description, d.inputSchema]));
    if (key === registered) return;
    registered = key;
    for (const definition of definitions) {
      pi.registerTool({
        name: definition.name,
        label: definition.name,
        description: definition.description,
        parameters: definition.inputSchema,
        execute: (_id, params, signal, _onUpdate, c) => runTool(definition.name, params ?? {}, signal, c),
      });
    }
  };
  registerTools(TOOL_DEFINITIONS);

  // ---- wakes ----

  const wake = (params: WakeDeliverParams): WakeDeliverStatus => {
    if (closed || !ctx) return 'failed';
    if (params.session ? params.session !== session.session : params.workspace && params.workspace !== session.workspace) return 'failed';
    const idle = ctx.isIdle();
    if (params.source?.from?.kind === 'owner') {
      // The person's own words: a user message, as if typed.
      if (idle) pi.sendUserMessage(params.text);
      else pi.sendUserMessage(params.text, { deliverAs: 'steer' });
    } else {
      // A collaborator's or the system's: the model reads it, and it is never taken for the person's words.
      pi.sendMessage(
        { customType: MESSAGE_TYPE, content: params.text, display: true, details: { artifact: params.artifact, source: params.source } },
        { triggerTurn: true, deliverAs: idle ? 'followUp' : 'steer' },
      );
    }
    return idle ? 'resumed' : 'delivered';
  };

  // ---- the connection ----

  /** Tools, prompt, skill and commands as the daemon has them now; each step on its own. */
  const refresh = async (h: Harness): Promise<void> => {
    try {
      registerTools(await h.tools());
    } catch (error) {
      log(`open-artifact tools: ${messageOf(error)}`);
    }
    try {
      const { skill } = await renderSkill(h.client, SKILL);
      if (skill.prompt) prompt = promptSection(skill.prompt);
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
      if (closed) throw new Error('The Pi session ended.');
      const { inbox } = await h.attach({ ...session, status: running ? 'running' : 'idle', pid: process.pid });
      // The attach took them out of the daemon; what `wake` did not take (a note, say) waits for the next tool call.
      if (inbox.length && h.features.includes('inbox.return')) {
        await h.client
          .request('inbox.return', { session: session.session ?? null, workspace: session.workspace ?? null, messages: inbox })
          .catch((error: unknown) => log(`open-artifact inbox.return: ${messageOf(error)}`));
      }
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
    if (closed) return Promise.reject(new Error('The Pi session ended.'));
    pending ??= open().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };

  // ---- Pi's events ----

  pi.on('session_start', (_event, c) => {
    ctx = c;
    session = callerOf(c);
    // Only a daemon that already runs: the session takes the comments made while it was away, and new ones.
    void readDaemon(options.home)
      .then((state) => (state && !closed ? connect() : null))
      .catch((error: unknown) => closed || log(`open-artifact connect: ${messageOf(error)}`));
  });

  pi.on('session_shutdown', () => {
    closed = true;
    ctx = null;
    harness?.close();
    harness = null;
    void pending?.then(
      (h) => h.close(),
      () => undefined,
    );
  });

  pi.on('resources_discover', async () => {
    try {
      if (harness?.connected) await harness.installSkill({ dir: skillsDir, ...SKILL });
      else await installSkill(null, { dir: skillsDir, ...SKILL });
    } catch (error) {
      log(`open-artifact skill: ${messageOf(error)}`);
    }
    return { skillPaths: [skillsDir] };
  });

  pi.on('before_agent_start', (event) => {
    const options = event.systemPromptOptions;
    if (!options) return;
    options.sections ??= {};
    options.sections[PROMPT_SECTION] = prompt;
  });

  /**
   * Runs `work` on the connection once it is made, if one is made or being made; never starts one. A call that the
   * session's own shutdown cut off (Pi's last `idle` as it exits) is not an error.
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
  pi.on('agent_start', () => status('running'));
  pi.on('agent_settled', () => status('idle'));

  pi.on('tool_result', (event, c) => {
    if (event.isError || (event.toolName !== 'write' && event.toolName !== 'edit')) return;
    const path = event.input?.path;
    if (typeof path !== 'string' || !path) return;
    const paths = [absolutePath(path, c.cwd)];
    const caller = callerOf(c);
    onceConnected('wrote', (h) => h.wrote(paths, caller));
  });

  pi.registerCommand(COMMAND, {
    description: 'Make an Open Artifact: /open-artifact <type> <what to make>',
    getArgumentCompletions: (prefix) => {
      const items: PiCompletion[] = commands
        .map((entry) => ({ value: argumentOf(entry), label: entry.type, description: entry.title }))
        .filter((item) => item.value.startsWith(prefix));
      return items.length ? items : null;
    },
    handler: (args, c) => {
      const text = `/skill:${COMMAND}${args.trim() ? ` ${args.trim()}` : ''}`;
      if (c.isIdle()) pi.sendUserMessage(text, { expandPromptTemplates: true });
      else pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs: 'followUp' });
    },
  });
}
