#!/usr/bin/env node
// A FAKE Claude Code build for the delivery recipe's runner tests (`testbox-capture-delivery-run.test.ts`): never a real
// one. The test copies this file to `<root>/captures/builds/<version>` (mode 0755) and the test launcher runs it with stdin
// piped. It does what the delivery drive needs of a build, no more: SessionStart; a typed `/model` raises PreModelSwitch
// and PostModelSwitch; a line `JSON:<a JSON string>` is one prompt (so a prompt with line breaks travels on one line of
// the pipe; the tests' fake driver writes it), which raises UserPromptSubmit, asks the stand-in model for a turn (the
// Messages API, with a tool offered) and raises Stop; `/exit` raises SessionEnd and exits.
// Broken variants are chosen by the version's patch (the environment is built from empty): 990 asks for every turn TWICE
// (a duplicate); 989 sends each line of a prompt as a turn of its own (a split); 988 cuts every prompt to its first 100
// code points (a truncation); 987 exits after its first prompt (a build that dies during the cases); 986 asks a side
// request (no tools) before each turn.
// CommonJS on purpose, as `fake-claude-build.mjs`: the copy has no extension, and Node reads such a file as CommonJS.
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');

const version = path.basename(process.argv[1]);
const patch = version.split('.')[2];
const config = process.env.CLAUDE_CONFIG_DIR;
const base = process.env.ANTHROPIC_BASE_URL;
const settings = JSON.parse(readFileSync(path.join(config, 'settings.json'), 'utf8'));
const sessionId = randomUUID();
const statusFile = path.join(config, 'sessions', `${process.pid}.json`);

function writeStatus(status) {
  mkdirSync(path.dirname(statusFile), { recursive: true });
  writeFileSync(statusFile, JSON.stringify({ pid: process.pid, sessionId, cwd: process.cwd(), status, version }));
}

function hook(event, extra = {}) {
  const entry = settings.hooks?.[event]?.[0]?.hooks?.[0];
  if (entry === undefined) return;
  spawnSync('/bin/sh', ['-c', entry.command], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: path.join(config, 'x.jsonl'), cwd: process.cwd(), hook_event_name: event, ...extra }),
    encoding: 'utf8', env: process.env, timeout: 20_000, killSignal: 'SIGKILL',
  });
}

async function post(content, tools) {
  await fetch(`${base}/v1/messages?beta=true`, {
    method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'fake-model', max_tokens: 64, stream: false, messages: [{ role: 'user', content }], ...(tools === null ? {} : { tools }) }),
  }).then((r) => r.json());
}

async function turn(prompt) {
  writeStatus('busy');
  hook('UserPromptSubmit', { prompt });
  if (patch === '986') await post('write a title for this conversation', null);
  // 989: each line of the prompt is asked as a turn of its own, all inside this one prompt's hooks.
  for (const part of patch === '989' ? prompt.split('\n') : [prompt]) await post(part, [{ name: 'Bash' }]);
  if (patch === '990') await post(prompt, [{ name: 'Bash' }]);
  hook('Stop');
  writeStatus('idle');
}

async function main() {
  writeStatus('idle');
  hook('SessionStart', { source: 'startup' });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    if (line === '/exit') { hook('SessionEnd', { reason: 'prompt_input_exit' }); process.exit(0); }
    if (line.startsWith('/model')) {
      const to = { from_model: 'fake-model', to_model: line.slice(6).trim() };
      hook('PreModelSwitch', to);
      hook('PostModelSwitch', to);
      continue;
    }
    if (!line.startsWith('JSON:')) continue;
    let prompt = JSON.parse(line.slice(5));
    if (patch === '988') prompt = Array.from(prompt).slice(0, 100).join('');
    await turn(prompt);
    if (patch === '987') process.exit(0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
