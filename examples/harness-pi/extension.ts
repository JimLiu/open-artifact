import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@open-artifact/protocol';
import { Type } from 'typebox';

type Wake = { session?: string | null; text?: string; source?: { from?: { kind?: string } } };
type Pending = { resolve(value: unknown): void; reject(error: Error): void };

function bridge(onWake: (wake: Wake) => string, onInbox: (session: string, inbox: Wake[]) => void) {
  const child = spawn('open-artifact', ['harness', '--stdio', '--harness', 'pi'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, Pending>();
  let id = 0;
  let closed = false;

  function close(error = new Error('Open Artifact bridge closed')) {
    if (closed) return;
    closed = true;
    lines.close();
    child.stdin.end();
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  }

  function send(fields: object) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...fields }) + '\n');
  }

  child.on('error', close);
  child.stdin.on('error', close);
  child.once('close', () => close());
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.method === 'wake.deliver') {
        let status = 'failed';
        try { status = onWake(message.params); }
        finally { send({ id: message.id, result: { status } }); }
      } else if (message.method === 'bridge.reattached') {
        onInbox(message.params.params.session, message.params.inbox);
      } else if (typeof message.id === 'number') {
        const call = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) call?.reject(new Error(message.error.message));
        else call?.resolve(message.result);
      }
    } catch (error) {
      close(error instanceof Error ? error : new Error(String(error)));
    }
  });

  function request<T>(method: string, params: object): Promise<T> {
    if (closed) return Promise.reject(new Error('Open Artifact bridge closed'));
    const key = ++id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`Open Artifact request timed out: ${method}`));
      }, 30_000);
      pending.set(key, {
        resolve(value) { clearTimeout(timeout); resolve(value as T); },
        reject(error) { clearTimeout(timeout); reject(error); },
      });
      send({ id: key, method, params });
    });
  }

  return { request, close, get closed() { return closed; } };
}

export default function (pi: ExtensionAPI) {
  let transport: ReturnType<typeof bridge> | undefined;
  let connection: Promise<{ transport: ReturnType<typeof bridge>; caller: { session: string; workspace: string } }> | undefined;
  const registered = new Set<string>();

  function attach(ctx: ExtensionContext) {
    if (transport?.closed) connection = undefined;
    return connection ??= (async () => {
      const caller = { session: ctx.sessionManager.getSessionId(), workspace: ctx.cwd };
      function receive(wake: Wake) {
        if (wake?.session !== caller.session || typeof wake.text !== 'string' || !wake.text.trim()) return 'failed';
        if (wake.source?.from?.kind === 'owner') pi.sendUserMessage(wake.text, { deliverAs: 'followUp' });
        else ctx.ui.notify(wake.text, 'info');
        return 'delivered';
      }
      function inbox(session: string, messages: Wake[] = []) {
        if (session === caller.session) for (const message of messages) receive({ ...message, session });
      }
      const link = transport = bridge(receive, inbox);
      try {
        await link.request('hello', { harness: 'pi', caps: { wake: { resume: false }, tools: 'native', agentName: 'Pi' } });
        const attached = await link.request<{ inbox: Wake[] }>('session.attach', caller);
        const { tools } = await link.request<{ tools: ToolDefinition[] }>('tools.list', {});
        for (const tool of tools) {
          if (!['Artifact', 'ArtifactData', 'ArtifactComments'].includes(tool.name) || registered.has(tool.name)) continue;
          registered.add(tool.name);
          pi.registerTool({
            name: tool.name,
            label: tool.name,
            description: tool.description,
            parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
            async execute(_id, args, _signal, _update, ctx) {
              const active = await attach(ctx);
              const result = await active.transport.request('tools.call', { name: tool.name, arguments: args, caller: active.caller });
              return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
            },
          });
        }
        inbox(caller.session, attached.inbox);
        return { transport: link, caller };
      } catch (error) {
        link.close();
        throw error;
      }
    })();
  }

  pi.on('session_shutdown', () => transport?.close());
  pi.registerCommand('open-artifact-connect', {
    description: 'Connect this Pi session to Open Artifact',
    handler: async (_args, ctx) => {
      await attach(ctx);
      ctx.ui.notify('Open Artifact is connected to this session', 'info');
    },
  });
}
