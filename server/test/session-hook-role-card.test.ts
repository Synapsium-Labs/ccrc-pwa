// Coordinator-first routing, Task 9 (spec 2026-10-17 §8, D-5301): every
// session that is not a dispatched child is told at start that it is its
// project's coordinator. The ROLE IS DERIVED: the card reads only the row's
// `$REG/<id>.child` and its `$REG/<id>.hold`, and renders for a row with
// neither. A PWA "+" create, a `POST /api/sessions` start and a CLI-created
// session (`cc <wrapper> <project>`, a hand-run `ccd ws-add`) all leave the
// SAME registry shape — no `.child`, no hold — so one fixture stands for all
// three; only a dispatch (`ws-add --no-rc --child <run>`) writes `.child`.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME. The harness is
// COPIED from session-hook-turnmark.test.ts, not imported (a test file cannot
// import another, and session-hook.test.ts's lines are cited by audits).
//
// The payloads copy the key sets of the committed SessionStart captures in
// `fixtures/delegation/2.1.289/swap-resume.json` (startup: cwd,
// hook_event_name, model, session_id, source, transcript_path; resume adds
// context_tokens, estimated_cache_write_usd, prompt_cache_likely_expired,
// seconds_since_last_response), with neutral values.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');

/** Spec §8's sentence, verbatim. */
const SENTENCE = 'You are a coordinator for this project. For work worth splitting, run the `ccrc-coordinator` skill and dispatch; your children\'s questions and permission prompts come to you first; your own go to the operator.';

/** The row's generation, exactly 36 bytes and no LF, as ccd writes it. */
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const SID = '00000000-0000-4000-8000-000000000001';

let home: string;
let id: string;
const reg = (): string => path.join(home, '.cc-sessions');
const useId = (next: string): void => {
  id = next;
  fs.writeFileSync(path.join(reg(), `${id}.generation`), GENERATION);
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${id}"\n`, { mode: 0o755 });
};
beforeEach(() => {
  home = mkTmp('ccrc-hook-role-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  useId('project-a-calm-mesa');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const startup = (): object => ({
  session_id: SID,
  transcript_path: path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`),
  cwd: path.join(home, 'work'),
  hook_event_name: 'SessionStart',
  source: 'startup',
  model: 'claude-model-a',
});
const withSource = (source: string): object =>
  source === 'resume'
    ? { ...startup(), source, context_tokens: 1200, estimated_cache_write_usd: 0.01,
        prompt_cache_likely_expired: false, seconds_since_last_response: 30 }
    : { ...startup(), source };

/** The hook's stdout, with the header contract's exit 0 asserted here. */
const run = (payload: object): string => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: {
      ...process.env, HOME: home,
      PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242',
      CCRC_SESSION_GENERATION: GENERATION,
    },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return r.stdout;
};
/** The one SessionStart envelope's context, or '' when the hook printed nothing. */
const context = (stdout: string): string => {
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  expect(lines.length, 'at most one envelope per event').toBeLessThanOrEqual(1);
  if (lines.length === 0) return '';
  const env = JSON.parse(lines[0]!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(env.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return env.hookSpecificOutput.additionalContext;
};
const hookstate = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(reg(), `${id}.hookstate.json`), 'utf8')) as Record<string, unknown>;

describe('the role card (D-5301): a row with no `.child` and no hold is its project\'s coordinator', () => {
  it('renders the sentence for a row with neither marker (the PWA "+", POST /api/sessions and the CLI alike)', () => {
    const c = context(run(startup()));
    expect(c).toContain(SENTENCE);
    expect(c.split(SENTENCE)).toHaveLength(2);   // once, not twice
  });

  it('renders on a clear and on a source-less SessionStart (an older harness), both fresh contexts', () => {
    expect(context(run(withSource('clear')))).toContain(SENTENCE);
    const { source: _s, ...noSource } = startup() as { source: string } & Record<string, unknown>;
    expect(context(run(noSource))).toContain(SENTENCE);
  });

  it('says nothing for a dispatched child (`.child` present)', () => {
    useId('project-a-quiet-basin');
    fs.writeFileSync(path.join(reg(), `${id}.child`), 'run-a\n');
    expect(context(run(startup()))).not.toContain('coordinator for this project');
    expect(hookstate()).toMatchObject({ state: 'done' });   // control: the arm ran
  });

  it('a `.child` it cannot read still reads as a child: doubt is silence', () => {
    useId('project-a-quiet-basin');
    fs.mkdirSync(path.join(reg(), `${id}.child`));
    expect(context(run(startup()))).not.toContain('coordinator for this project');
  });

  it('says nothing for a held row, whatever the hold carries', () => {
    const hold = path.join(reg(), `${id}.hold`);
    fs.writeFileSync(hold, 'program:prog-a wave:1/2 run:7\n');
    const held = context(run(startup()));
    expect(held).toContain('ccrc-program:');                   // control: the hold card spoke
    expect(held).not.toContain('coordinator for this project');
    fs.writeFileSync(hold, '');                                 // an empty hold is still HELD
    expect(context(run(startup()))).not.toContain('coordinator for this project');
    fs.rmSync(hold); fs.mkdirSync(hold);                        // and so is an unreadable one
    expect(context(run(startup()))).not.toContain('coordinator for this project');
  });

  it('says nothing on a resumed SessionStart, whose transcript already carries the start card', () => {
    expect(context(run(withSource('resume')))).not.toContain('coordinator for this project');
    expect(hookstate()).toMatchObject({ state: 'done' });   // control: the arm ran
  });

  it('says nothing on a fork, which copies a transcript that already carries it', () => {
    // No committed capture has a `fork` SessionStart; this is the startup key set with the
    // source the hook's spool arm already names (`startup|resume|clear|fork`). DERIVED.
    expect(context(run(withSource('fork')))).not.toContain('coordinator for this project');
  });

  it('honours the standing cards\' kill switch', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    expect(context(run(startup()))).not.toContain('coordinator for this project');
  });

  it('writes no marker: beside the per-event state every SessionStart writes, the registry is unchanged', () => {
    // `.hookstate.json` and `.turn.json` are the arm's existing per-event state (D-306, the turn marker).
    const mine = (n: string): boolean => n !== `${id}.hookstate.json` && n !== `${id}.turn.json`;
    const before = fs.readdirSync(reg()).filter(mine).sort();
    run(startup());
    const after = fs.readdirSync(reg()).filter(mine).sort();
    expect(after).toEqual(before);
  });
});
