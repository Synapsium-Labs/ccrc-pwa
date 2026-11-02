// The `ccrc-linear` skill's install half (#1444, D-7674; spec 2026-10-31 §11, §12, §14 row 22), tested the way
// install-history-skill.test.ts tests its sibling: a fixture HOME, never the live one.
//
// THE START CARD DOES NOT CHANGE (D-7682 R6). The switch-over reaches every session through the installed skill and
// the program skills' sections, never through a SessionStart line, so the first describe below is a characterization
// written green on `main` before any of this work: the card a session is shown at start, byte for byte, for the three
// rows the hook distinguishes (a coordinator row, a held worker row and a dispatched child), and no card assignment in
// `ccd/session-hook.sh` that names Linear. The hook harness is COPIED from session-hook-role-card.test.ts, not
// imported (a test file cannot import another).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(__dirname, '../..');
const HOOK = path.join(REPO, 'ccd/session-hook.sh');

describe('the start card is byte for byte as on main: no Linear line (D-7682 R6; spec §14 row 22)', () => {
  const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
  const SID = '00000000-0000-4000-8000-000000000001';
  const ID = 'project-a-calm-mesa';
  let home: string;
  const reg = (): string => path.join(home, '.cc-sessions');
  beforeEach(() => {
    home = mkTmp('ccrc-linear-card-');
    fs.mkdirSync(reg(), { recursive: true });
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(home, 'work'), { recursive: true });
    fs.writeFileSync(path.join(reg(), `${ID}.generation`), GENERATION);
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  /** The hook's whole stdout for a startup SessionStart, the exit 0 of its header contract asserted. */
  const card = (): string => {
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({
        session_id: SID, transcript_path: path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`),
        cwd: path.join(home, 'work'), hook_event_name: 'SessionStart', source: 'startup', model: 'claude-model-a',
      }),
      encoding: 'utf8',
      env: {
        ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
      },
    });
    expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
    return r.stdout;
  };
  const envelope = (context: string): string =>
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })}\n`;

  it('a coordinator row (no `.child`, no hold) is shown the role sentence and nothing else', () => {
    expect(card()).toBe(envelope('ccrc-role: You are a coordinator for this project. For work worth splitting, run the '
      + '`ccrc-coordinator` skill and dispatch; your children\'s questions and permission prompts come to you first; your '
      + 'own go to the operator.'));
  });

  it('a held worker row is shown the hold card and nothing else', () => {
    fs.writeFileSync(path.join(reg(), `${ID}.hold`), 'program:prog-a wave:1/2 run:7\n');
    expect(card()).toBe(envelope(`ccrc-program: this workspace is claimed — \`~/.cc-sessions/${ID}.hold\` reads `
      + '`program:prog-a wave:1/2 run:7`, which names a program and a wave — what the `ccrc-worker` skill is for. Run that '
      + `skill. Any brief sent to you is listed by \`~/.local/bin/ccrc-api mail list --to ${ID}\`, and one you already `
      + 'acked is not listed again — the plan it named is the durable record. The hold can outlive the run that wrote it: '
      + 'whether that run is still open, and whether any brief was sent, are answered only by `~/.local/bin/ccrc-api runs '
      + 'list`, never by this file.'));
  });

  it('a dispatched child is shown no card at all', () => {
    fs.writeFileSync(path.join(reg(), `${ID}.child`), 'run-a\n');
    expect(card()).toBe('');
  });

  it('no card assignment in the hook names Linear', () => {
    // Every line that assigns one of the card's parts (`CARD`, `CARD_GRAPH`, `CARD_HOLD`, `CARD_ROLE`, `CARD_CCRC` or
    // a part a later change adds), comments dropped. A Linear sentence added to any of them, on any row, reds here.
    const assigns = fs.readFileSync(HOOK, 'utf8').split('\n')
      .filter((l) => !/^\s*#/.test(l) && /\bCARD[A-Z_]*\+?=/.test(l));
    expect(assigns.length, 'the scan found no card assignment: the hook moved, or the scan broke').toBeGreaterThan(5);
    expect(assigns.filter((l) => /linear/i.test(l))).toEqual([]);
  });
});
