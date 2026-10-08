// Wraps the user's own Claude Code CLI login (Max/Pro subscription) as the AI backend.
// No Anthropic API key anywhere — every call goes through `claude -p` and is billed
// against the subscription, not metered API usage.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CANDIDATES = ['/usr/local/bin/claude', '/opt/homebrew/bin/claude'];

function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'claude'; // fall back to PATH lookup
}

export const CLAUDE_BIN = resolveClaudeBin();

// tests swap the process spawn for a stub
let runner = spawnClaude;
export function _setRunner(fn) { runner = fn; }
export function _resetRunner() { runner = spawnClaude; }

function spawnClaude(args, input, timeoutMs, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // never metered — CLI subscription login only
    const child = spawn(CLAUDE_BIN, args, { env, cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e), timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, timedOut });
    });
    child.stdin.end(input);
  });
}

// Small concurrency queue: N photos arriving at once must not spawn N heavy CLI processes.
const MAX_CONCURRENT = Number(process.env.CLAUDE_CLI_CONCURRENCY || 2);
let active = 0;
const waiters = [];

function acquire() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  active--;
  const next = waiters.shift();
  if (next) { active++; next(); }
}

function baseArgs({ model, systemPrompt, jsonSchema, tools, restricted }) {
  const args = [
    '-p',
    '--model', model,
    '--setting-sources', '',
    '--system-prompt', systemPrompt,
    '--output-format', 'json',
    '--permission-prompts', 'none', // never hang on an interactive prompt headless
  ];
  if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));
  // tools === '' disables every built-in tool (plain text turn, fastest + safest).
  // tools === 'Read' (photo analysis) additionally gets --restricted, which confines
  // the Read tool to the given working directory and refuses bypassPermissions outright.
  args.push('--tools', tools ?? '');
  if (restricted) args.push('--restricted');
  return args;
}

function parseOuter(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function isAuthError(message) {
  return /401|invalid authentication|not logged in|please run \/login/i.test(message || '');
}

// Runs one turn and returns { structured, text } on success, throws a friendly
// Error otherwise. `prompt` already includes the data-specific instructions
// (schema is also passed via --json-schema for the CLI's own validation).
export async function runStructured({
  prompt, systemPrompt, jsonSchema, model, tools, restricted, cwd, timeoutMs = 60_000, retryOnInvalid = true,
}) {
  await acquire();
  try {
    const args = baseArgs({ model, systemPrompt, jsonSchema, tools, restricted });
    const opts = cwd ? { cwd } : {};
    let r = await runner(args, prompt, timeoutMs, opts);
    let outer = parseOuter(r.out);

    if (r.timedOut) throw new Error('TIMEOUT: the Claude CLI took too long to respond');
    if (r.code !== 0 || !outer || outer.is_error) {
      const msg = (outer && outer.result) || r.err.trim().split('\n').slice(-3).join(' ') || `claude exited ${r.code}`;
      if (isAuthError(`${msg} ${r.err}`)) {
        throw new Error('AUTH: the Claude CLI is logged out — run `claude` once on this machine and follow the login prompt, then try again.');
      }
      throw new Error(`claude CLI failed: ${msg}`);
    }

    let structured = outer.structured_output;
    if (jsonSchema && structured === undefined) {
      // fall back to pulling a JSON object out of the free-text result
      const match = typeof outer.result === 'string' ? outer.result.match(/\{[\s\S]*\}/) : null;
      structured = match ? parseOuter(match[0]) : null;
    }

    if (jsonSchema && structured == null && retryOnInvalid) {
      const retryPrompt = `${prompt}\n\nYour previous response was not valid JSON matching the schema. Reply with ONLY a single JSON object matching the schema, no markdown fences, no extra text.`;
      return runStructured({ prompt: retryPrompt, systemPrompt, jsonSchema, model, tools, restricted, cwd, timeoutMs, retryOnInvalid: false });
    }
    if (jsonSchema && structured == null) {
      throw new Error('claude CLI did not return valid structured JSON after a retry');
    }

    return { structured, text: String(outer.result || '').trim() };
  } finally {
    release();
  }
}
