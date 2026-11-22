/**
 * The session hook's quiz row (review 3232 F1; the operator's ruling of 2026-11-22): on EVERY session, a top-level one
 * and a dispatched child alike, the PreToolUse arm refuses the box client's replay-quiz rows `record`, `confirm` and
 * `status` (the weekly timer's acts) in the bare, path-qualified, quoted and `$VAR` program forms, an act held in a
 * variable, and the shell verb that posts them (`ccrc quiz-record`, its script; review 3254 F1 and F2). `quiz live` (the
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

/** Review 3254 F1: the shell verb that posts the rows, `ccrc quiz-record` and its script, in the account arm's forms. */
const SHELL_FORMS: ReadonlyArray<[string, string]> = [
  ['the verb, bare', 'ccrc quiz-record --report r.json --sha abc --confirm'],
  ['the verb after env -u', 'env -u CLAUDECODE -u TMUX_PANE ccrc quiz-record --report r.json --sha abc --confirm'],
  ['the verb, path-qualified', '~/.local/bin/ccrc quiz-record --report r.json'],
  ['the verb, quoted', '"ccrc" quiz-record --report r.json'],
  ['the verb, a $VAR program', 'C=ccrc; $C quiz-record --report r.json'],
  ['the script, bare', 'ccrc-quiz-record --report r.json --confirm'],
  ['the script, quoted', '\'ccrc-quiz-record\' --confirm'],
  ['the script, installed path', '~/.local/bin/ccrc-quiz-record --report r.json'],
  ['the script, "$HOME" path', '"$HOME/.local/bin/ccrc-quiz-record" --confirm'],
  ['the script, repository path', './ccd/ccrc-quiz-record --report r.json'],
  ['the script by path after env -u', 'env -u CLAUDECODE -u TMUX_PANE ./ccd/ccrc-quiz-record --confirm'],
  ['the script through bash', 'bash ccd/ccrc-quiz-record --confirm'],
  ['the script by path after a cd', 'cd work && ccd/ccrc-quiz-record --confirm'],
  ['the script, a $VAR program', 'Q=ccrc-quiz-record; $Q --confirm'],
];

describe('the quiz row refuses the shell verb that posts the timer\'s rows (review 3254 F1)', () => {
  for (const [caller, id] of CALLERS) {
    it.each(SHELL_FORMS)(`${caller}: %s`, (_n, command) => {
      const why = fire(id, 'Bash', { command });
      expect(why, command).not.toBeNull();
      expect(why).toMatch(/replay quiz's record, confirmation and status are the weekly timer's acts/);
    });
  }
});

/** Review 3254 F2: a tab between the words (the prefilter reads it stripped, as `t`) and an act held in a variable. */
const SPELLINGS: ReadonlyArray<[string, string]> = [
  ['a tab before the act', 'ccrc-api quiz\trecord --id 1'],
  ['a tab before quiz', 'ccrc-api\tquiz confirm --id 1'],
  ['a newline continuation before the act', 'ccrc-api quiz \\\nstatus --json -'],
  ['the act in a $V', 'V=record; ccrc-api quiz $V --id 1'],
  ['the act in a "$V"', 'ccrc-api quiz "$V" --id 1'],
  ['the act in a ${V}', 'ccrc-api quiz ${ACT} --id 1'],
];

describe('the quiz row reads a tab and an act in a variable (review 3254 F2)', () => {
  for (const [caller, id] of CALLERS) {
    it.each(SPELLINGS)(`${caller}: %s`, (_n, command) => {
      expect(fire(id, 'Bash', { command }), command).not.toBeNull();
    });
  }
});

describe('the deny reason names the way past a text-only refusal (review 3254 F3)', () => {
  it.each(CALLERS)('%s', (_c, id) => {
    expect(fire(id, 'Bash', { command: 'git commit -m "note ccrc-api quiz record"' }))
      .toMatch(/Text that only names it is refused too; reword it or write it through a file/);
  });
});

describe('the quiz row leaves everything else open', () => {
  it.each(CALLERS)('%s: live, other client calls, reads and plain text pass', (_c, id) => {
    for (const command of [
      'ccrc-api quiz live', '~/.local/bin/ccrc-api quiz live --id 12', 'ccrc-api mail send --json -',
      'grep -n quiz somefile', 'cat quiz-notes.md', 'ccrc-api quizzes status', 'echo record confirm status',
      'cat ccd/ccrc-quiz-record', 'git add ccd/ccrc-quiz-record server/test/ccrc-quiz-record.test.ts',
      './node_modules/.bin/vitest run test/ccrc-quiz-record.test.ts', 'git diff -- ccd/ccrc-quiz-record',
    ]) expect(fire(id, 'Bash', { command }), command).toBeNull();
    expect(fire(id, 'Read', { file_path: '/srv/work/project-a/docs/quiz-unattended-note.md' })).toBeNull();
  });
});
