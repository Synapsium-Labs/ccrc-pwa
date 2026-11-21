#!/usr/bin/env node
// A FAKE Claude Code build for `testbox-capture-runner.test.ts`: never a real one. The test copies this file to
// `<root>/captures/builds/<version>` (mode 0755) and the fake launcher runs it with stdin piped. It does what the capture's
// drive needs of a build, no more: it reads `<CLAUDE_CONFIG_DIR>/settings.json`, keeps a live status file at
// `<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`, runs each hook and the statusline command through `/bin/sh -c` with the
// payload JSON on stdin, and talks to the stand-in model at ANTHROPIC_BASE_URL with the Messages API.
// It reads its VERSION from its own file name. Broken variants are chosen by that name (the environment is built from
// empty, so no switch can ride in it): a patch of 999 never raises SubagentStop; a patch of 998 hangs at step two, never
// answering that prompt; a patch of 997 raises everything but never exits on `/exit`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const version = path.basename(process.argv[1]);
const patch = version.split('.')[2];
const config = process.env.CLAUDE_CONFIG_DIR;
const base = process.env.ANTHROPIC_BASE_URL;
const settings = JSON.parse(readFileSync(path.join(config, 'settings.json'), 'utf8'));
const sessionId = randomUUID();
const startedAt = Date.now();
const statusFile = path.join(config, 'sessions', `${process.pid}.json`);
let shellCwd = process.cwd();

function writeStatus(status) {
  mkdirSync(path.dirname(statusFile), { recursive: true });
  writeFileSync(statusFile, JSON.stringify({ pid: process.pid, sessionId, cwd: shellCwd, status, version, startedAt, statusUpdatedAt: Date.now() }));
}

function sh(command, payload) {
  const r = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify(payload), encoding: 'utf8', env: process.env, cwd: shellCwd });
  return r.stdout ?? '';
}

function hook(event, extra = {}) {
  if (event === 'SubagentStop' && patch === '999') return '';
  const entry = settings.hooks?.[event]?.[0]?.hooks?.[0];
  if (entry === undefined) return '';
  return sh(entry.command, { session_id: sessionId, transcript_path: path.join(config, 'projects', `${sessionId}.jsonl`), cwd: shellCwd, hook_event_name: event, ...extra });
}

function statusline() {
  const c = settings.statusLine?.command;
  if (c !== undefined) sh(c, { session_id: sessionId, model: { id: 'fake-model', display_name: 'Fake' }, workspace: { current_dir: shellCwd }, cwd: shellCwd, cost: { total_cost_usd: 0 } });
}

async function post(messages, tools) {
  const r = await fetch(`${base}/v1/messages?beta=true`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_AUTH_TOKEN ?? '' },
    body: JSON.stringify({ model: 'fake-model', max_tokens: 64, stream: false, messages, tools }),
  });
  return { status: r.status, body: await r.json() };
}

const TOOLS = [{ name: 'Bash' }, { name: 'Agent' }];

async function turn(prompt) {
  writeStatus('busy');
  hook('UserPromptSubmit', { prompt });
  const messages = [{ role: 'user', content: prompt }];
  for (;;) {
    const r = await post(messages, TOOLS);
    if (r.status !== 200) { hook('StopFailure', { error: 'invalid_request' }); break; }
    messages.push({ role: 'assistant', content: r.body.content });
    const calls = r.body.content.filter((b) => b.type === 'tool_use');
    if (calls.length === 0) { hook('Stop'); break; }
    const results = [];
    for (const c of calls) {
      if (c.name === 'Agent') {
        const sub = { agent_id: randomUUID(), agent_type: 'general-purpose' };
        hook('SubagentStart', sub);
        await post([{ role: 'user', content: c.input.prompt }], [{ name: 'Bash' }]);
        hook('SubagentStop', { ...sub, agent_transcript_path: path.join(config, 'projects', `${sub.agent_id}.jsonl`) });
        results.push({ type: 'tool_result', tool_use_id: c.id, content: 'ok' });
        continue;
      }
      const command = String(c.input.command);
      hook('PreToolUse', { tool_name: c.name, tool_input: c.input, tool_use_id: c.id });
      if (!command.startsWith('cd ')) {
        // The recorder answers a permission prompt `allow`; anything else leaves the tool unrun.
        let allowed = false;
        try { allowed = JSON.parse(hook('PermissionRequest', { tool_name: c.name, tool_input: c.input })).hookSpecificOutput.decision.behavior === 'allow'; } catch { /* not allowed */ }
        if (!allowed) { results.push({ type: 'tool_result', tool_use_id: c.id, content: 'denied', is_error: true }); continue; }
      }
      if (command.startsWith('cd ')) shellCwd = path.resolve(shellCwd, command.slice(3).trim());
      else if (command.startsWith('touch ')) writeFileSync(path.resolve(shellCwd, command.slice(6).trim()), '');
      hook('PostToolUse', { tool_name: c.name, tool_input: c.input, tool_response: { stdout: '' }, tool_use_id: c.id });
      results.push({ type: 'tool_result', tool_use_id: c.id, content: '' });
    }
    messages.push({ role: 'user', content: results });
  }
  writeStatus('idle');
  statusline();
}

async function compact() {
  hook('PreCompact', { trigger: 'manual' });
  await post([{ role: 'user', content: 'summarize the conversation' }], []);
  hook('PostCompact', { trigger: 'manual' });
}

writeStatus('idle');
hook('SessionStart', { source: 'startup' });
statusline();

for await (const raw of readline.createInterface({ input: process.stdin })) {
  const line = raw.trim();
  if (line === '/exit') {
    hook('SessionEnd', { reason: 'prompt_input_exit' });
    rmSync(statusFile, { force: true });
    if (patch === '997') { await new Promise(() => {}); }
    process.exit(0);
  } else if (line === '/compact') await compact();
  else if (line.includes('step two') && patch === '998') continue;
  else if (line.includes('ccrc capture step')) await turn(line);
}
