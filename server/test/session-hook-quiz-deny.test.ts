/**
 * The session hook's quiz row (review 3232 F1; the operator's ruling of 2026-11-22): on EVERY session, a top-level one
 * and a dispatched child alike, the PreToolUse arm refuses the box client's replay-quiz rows `record`, `confirm` and
 * `status` (the weekly timer's acts) in the bare, path-qualified, quoted and `$VAR` program forms. `quiz live` (the
 * Overlord coordinator's door) and every other client call stay open. An accident guard, not a wall.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME (`session-hook-account-deny.test.ts`'s harness). Never the
 * live HOME.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const TOP = 'project-a-calm-mesa';
const CHILD = 'project-b-quiet-basin';
/** A neutral `cwd`: one naming `quiz` would pass the prefilter for every call and leave it untested. */
const CWD = '/srv/work/project-a';

let home: string;
beforeAll(() => {
  home = mkTmp('ccrc-quizdeny-hook-');
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  for (const id of [TOP, CHILD]) fs.writeFileSync(path.join(reg, `${id}.generation`), GENERATION);
  fs.writeFileSync(path.join(reg, `${CHILD}.child`), '7');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "cc-%s\\n" "${TMUX_PANE#%}"\n', { mode: 0o755 });
});
afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); });

type Envelope = { hookSpecificOutput: { hookEventName?: string; permissionDecision?: string; permissionDecisionReason?: string } };
const CALLERS: ReadonlyArray<[string, string]> = [['a top-level session', TOP], ['a child', CHILD]];

const hookEnv = (id: string): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: `%${id}`, CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
});
/** The deny reason, or null when nothing was denied. */
const fire = (id: string, tool: string, input: Record<string, unknown>): string | null => {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: CWD });
  const r = spawnSync('bash', [HOOK], { input: payload, encoding: 'utf8', env: hookEnv(id) });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return null;
  const env = JSON.parse(line) as Envelope;
  return env.hookSpecificOutput.permissionDecision === 'deny' ? String(env.hookSpecificOutput.permissionDecisionReason) : null;
};

const VERBS = ['record', 'confirm', 'status'] as const;
const PROGRAMS: ReadonlyArray<[string, (v: string) => string]> = [
  ['bare', (v) => `ccrc-api quiz ${v} --id 12`],
  ['path-qualified (home)', (v) => `~/.local/bin/ccrc-api quiz ${v} --id 12`],
  ['path-qualified (absolute)', (v) => `/opt/tools/.local/bin/ccrc-api quiz ${v} --id 12`],
  ['path-qualified (relative)', (v) => `./ccrc-api quiz ${v}`],
  ['double-quoted', (v) => `"ccrc-api" quiz ${v}`],
  ['single-quoted', (v) => `'ccrc-api' quiz ${v}`],
  ['a $VAR program', (v) => `API=x; $API quiz ${v}`],
  ['a ${VAR} program', (v) => `\${CLIENT} quiz ${v}`],
  ['a "$VAR" program', (v) => `"$API" quiz ${v}`],
  ['with flags', (v) => `ccrc-api --json quiz --x ${v}`],
  ['after a cd', (v) => `cd work && ccrc-api quiz ${v}`],
];

describe('the quiz row refuses the weekly timer\'s client acts on every session', () => {
  for (const [caller, id] of CALLERS) {
    for (const verb of VERBS) {
      it.each(PROGRAMS)(`${caller}: ${verb}, %s`, (_n, build) => {
        const why = fire(id, 'Bash', { command: build(verb) });
        expect(why).not.toBeNull();
        expect(why).toMatch(/replay quiz's record, confirmation and status are the weekly timer's acts/);
        expect(why).toMatch(/quiz live/);
      });
    }
  }
});

describe('the quiz row leaves everything else open', () => {
  it.each(CALLERS)('%s: live, other client calls, reads and plain text pass', (_c, id) => {
    for (const command of [
      'ccrc-api quiz live', '~/.local/bin/ccrc-api quiz live --id 12', 'ccrc-api mail send --json -',
      'grep -n quiz somefile', 'cat quiz-notes.md', 'ccrc-api quizzes status', 'echo record confirm status',
    ]) expect(fire(id, 'Bash', { command }), command).toBeNull();
    expect(fire(id, 'Read', { file_path: '/srv/work/project-a/docs/quiz-unattended-note.md' })).toBeNull();
  });
});
