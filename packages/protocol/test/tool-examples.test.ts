/**
 * Every tool call the docs, the skills and the tools' own messages show an agent (`Artifact {action: "publish", url,
 * files}`, or `{action: "call", …}` in a Markdown file) names an action the tool has and arguments its schema takes.
 * An agent copies these calls as written, so an argument the tool does not take sends it straight into a refusal.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { ARTIFACT_ACTIONS, COMMENTS_ACTIONS, DATA_ACTIONS, TOOL_SCHEMAS } from '../src/index.ts';

const repo = resolve(import.meta.dirname, '..', '..', '..');

const ACTIONS = { Artifact: ARTIFACT_ACTIONS, ArtifactData: DATA_ACTIONS, ArtifactComments: COMMENTS_ACTIONS } as const;
type Tool = keyof typeof ACTIONS;
const TOOLS = Object.keys(ACTIONS) as Tool[];

/** A call written out: the tool (when the text names it), its action, and the argument names at its top level. */
interface Example {
  file: string;
  tool: Tool | null;
  action: string;
  keys: string[];
  text: string;
}

/** What is between the braces that open at `open`, or null when a code span or the text ends first. */
function braced(text: string, open: number): string | null {
  let depth = 0;
  let quote = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '"') quote = false;
    } else if (c === '"') quote = true;
    else if (c === '`') return null;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/**
 * The argument names at the top level of a call's body: `url`, `files: {…}`, `path? | paths?` and `"key": …` each
 * give their names; what nests inside `{}`, `[]` or `()` is the argument's value, not an argument.
 */
function topLevelKeys(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let part = '';
  for (const c of body) {
    if (quote) {
      if (c === '"') quote = false;
    } else if (c === '"') quote = true;
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(part);
      part = '';
      continue;
    }
    part += c;
  }
  parts.push(part);
  return parts.flatMap((p) => {
    const name = p.split(':')[0]!.trim();
    if (!name || name.startsWith('"') || name.startsWith("'")) return [];
    return [...name.matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]);
  });
}

function examples(file: string, text: string, unnamedToo: boolean): Example[] {
  const found: Example[] = [];
  for (const m of text.matchAll(/(?:\b(Artifact|ArtifactData|ArtifactComments)\s+)?\{\s*action:\s*"([a-z_]+)"/g)) {
    const tool = (m[1] as Tool | undefined) ?? null;
    if (!tool && !unnamedToo) continue;
    const body = braced(text, m.index + m[0].indexOf('{'));
    if (body === null) continue;
    found.push({ file, tool, action: m[2]!, keys: topLevelKeys(body), text: `{${body.replace(/\s+/g, ' ')}}` });
  }
  return found;
}

function tracked(patterns: string[]): string[] | null {
  try {
    return execFileSync('git', ['ls-files', '--', ...patterns], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null;
  }
}

test('tool calls in docs, skills and messages name real actions and arguments', (t) => {
  // The e2e notes describe refused calls on purpose.
  const markdown = tracked(['*.md', ':!CHANGELOG*.md', ':!e2e/**']);
  const sources = tracked(['packages/*/src/**/*.ts', 'plugins/**/*.ts', 'plugins/**/*.mjs', 'plugins/**/*.json']);
  if (!markdown || !sources) {
    t.skip('not a git checkout');
    return;
  }
  const all = [
    ...markdown.flatMap((f) => examples(f, readFileSync(join(repo, f), 'utf8'), true)),
    ...sources.flatMap((f) => examples(f, readFileSync(join(repo, f), 'utf8'), false)),
  ];
  assert.ok(all.length > 100, `only ${all.length} calls found: the scan no longer reads the docs`);

  const problems: string[] = [];
  for (const call of all) {
    // A call that does not name its tool: any tool with that action.
    const tools = call.tool ? [call.tool] : TOOLS.filter((name) => (ACTIONS[name] as readonly string[]).includes(call.action));
    if (!tools.length || (call.tool && !(ACTIONS[call.tool] as readonly string[]).includes(call.action))) {
      problems.push(`${call.file}: ${call.tool ?? 'no tool'} has no action "${call.action}": ${call.text}`);
      continue;
    }
    const taken = new Set(tools.flatMap((name) => Object.keys(TOOL_SCHEMAS[name].properties ?? {})));
    const unknown = call.keys.filter((key) => !taken.has(key));
    if (unknown.length) problems.push(`${call.file}: ${tools.join(' or ')} takes no ${unknown.join(', ')}: ${call.text}`);
  }
  assert.deepEqual(problems, []);
});

test('tool examples: the scan reads a call the way an agent would copy it', () => {
  const [upload] = examples('x.md', 'Uploads are `Artifact {action: "publish", url, file_path, asset: true}`.', true);
  assert.deepEqual(upload && { tool: upload.tool, action: upload.action, keys: upload.keys }, { tool: 'Artifact', action: 'publish', keys: ['action', 'url', 'file_path', 'asset'] });
  const [nested] = examples('x.md', '`{action: "call", url, name: "upload", args: {file: "<absolute path>", name?}}`', true);
  assert.deepEqual(nested?.keys, ['action', 'url', 'name', 'args']);
  const [either] = examples('x.md', '`Artifact {action: "read", url, path? | paths?}`', true);
  assert.deepEqual(either?.keys, ['action', 'url', 'path', 'paths']);
  const [batch] = examples('x.md', '`ArtifactData {action: "batch", url, writes: [{op: "set", path, data}]}`', true);
  assert.deepEqual(batch?.keys, ['action', 'url', 'writes']);
  assert.deepEqual(examples('x.ts', "'{action: \"draft\", widget}'", false), [], 'a source string that names no tool is not a call');
  assert.deepEqual(examples('x.md', '`Artifact {action: "publish", url,` and on', true), [], 'a call a code span cuts off is skipped');
});
