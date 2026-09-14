// THE ASK INSTANCE GUARD, MEASURED ACROSS THE SEAM IT ACTUALLY SPANS.
//
// `askAt` (D-2170) is a snapshot of the child's hookstate `updatedAt` taken at
// mint, re-read fresh at answer time and CAS'd for equality by
// `takeAskForAnswer`. Its stated warrant (`freshAskAt`'s docstring,
// `server/src/registry.ts`) is that `askKey` hashes CONTENT, so a child asking
// two structurally identical questions mints the same key twice and only
// `updatedAt` distinguishes instance 1 from instance 2.
//
// That reasoning is sound about SUBSTITUTION and silent about everything else
// that moves the same number. `ccd/session-hook.sh` stamps `updatedAt`
// unconditionally on every write (its tail `--argjson updatedAt
// "$(_hook_epoch_ms)"`), and its `SubagentStart`/`SubagentStop` arm
// deliberately restores `prev_state` and re-reads `.ask` back off the file —
// so a subagent event landing on a session that is BLOCKED on a dialog rewrites
// the identical ask envelope under a fresh number.
//
// `server/test/session-hook.test.ts`'s "ask survives subagent events while
// waiting" already pins the first half of that and is green: it asserts the
// envelope survives and never looks at the number carried alongside it. This
// suite measures what the survival costs on the other side of the seam.
//
// Both halves run for real: the hook is executed as a process against a
// FIXTURE HOME (the `run`/`readState` idiom is lifted verbatim from
// `session-hook.test.ts`, the same way `asks-mint.test.ts` lifts
// `push-copy.test.ts`'s seeding rather than inventing a third), and the CAS is
// the shipped `CoordStore` against a real `node:sqlite` database. Nothing here
// is a hand-built fixture asserting its own premise.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { okAsk } from './coordReadHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-ask-guard-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (payload: object): void => {
  execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env, HOME: home,
      PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
    },
  });
};
const stateFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json');
const readState = (): { state: string; event: string; updatedAt: number; ask: unknown } =>
  JSON.parse(fs.readFileSync(stateFile(), 'utf8'));

const QUESTIONS = [{
  question: 'Ship the rescue lane behind the preflight, or gate it on the operator?',
  header: 'Rescue lane', multiSelect: false,
  options: [{ label: 'Behind the preflight' }, { label: 'Gate on the operator' }],
}];

/** The child blocks on a dialog. `PermissionRequest` is the arm that fires for
 *  `AskUserQuestion` on this fleet's harness (`session-hook.sh`'s own MEASURED
 *  2026-08-05 comment); the `PreToolUse` arm produces the identical envelope,
 *  so which one fires does not change what this suite measures. */
const blockOnAsk = (): ReturnType<typeof readState> => {
  run({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion',
    tool_input: { questions: QUESTIONS } });
  return readState();
};

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

/** The row the mint would write for the dialog above. `askAt` is the ONLY
 *  field under test; everything else is the shape `insertAsk` requires. */
const mintAskAt = (coord: CoordStore, askAt: number): number => coord.insertAsk({
  childId: 'demo-quiet-basin', parentId: 'demo-coordinator', runId: null,
  askKey: 'content-hash-of-the-questions-above', askAt, dialogId: 'sha1-of-the-pane',
  question: QUESTIONS[0]!.question, options: ['Behind the preflight', 'Gate on the operator'],
  now: Date.now(),
});

describe('a subagent event under an open dialog moves the guarded number', () => {
  it('SubagentStop rewrites the SAME ask envelope under a FRESH updatedAt', () => {
    const before = blockOnAsk();
    expect(before.state).toBe('waiting');
    expect(before.ask).toEqual({ questions: QUESTIONS });

    // A background subagent finishes while the dialog is still painted. The
    // child did nothing: it is blocked, and cannot have answered.
    run({ hook_event_name: 'SubagentStop', agent_name: 'reviewer' });
    const after = readState();

    // The dialog is untouched — same envelope, still waiting on the operator.
    expect(after.state).toBe('waiting');
    expect(after.ask).toEqual(before.ask);
    expect(after.event).toBe('SubagentStop');

    // …and the number the instance guard compares has moved anyway.
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
  });
});

describe('what that costs the parent at the CAS', () => {
  it('the parent is refused ask-moved, and the control proves the bump is why', () => {
    const before = blockOnAsk();
    run({ hook_event_name: 'SubagentStop', agent_name: 'reviewer' });
    const after = readState();
    expect(after.ask).toEqual(before.ask);   // still the same question on screen

    const coord = store();
    const id = mintAskAt(coord, before.updatedAt);   // minted before the bump

    // THE DEFECT. `freshAskAt` re-reads the child's hookstate and returns
    // exactly `after.updatedAt`; the CAS compares it to the row's `askAt`.
    const moved = coord.takeAskForAnswer(id, after.updatedAt);
    expect(moved.ok).toBe(false);
    expect(moved.ok === false && moved.why).toBe('ask-moved');

    // THE CONTROL, on the SAME row in the same breath: the only variable is
    // which number is offered. A green refusal above with no passing control
    // here would be ambiguous — an unanswerable row, a bad fixture, or the
    // bump. This makes it the bump.
    const unmoved = coord.takeAskForAnswer(id, before.updatedAt);
    expect(unmoved.ok).toBe(true);
  });

  it('the refusal is permanent: the failed CAS leaves askAt behind the child forever', () => {
    const before = blockOnAsk();
    const coord = store();
    const id = mintAskAt(coord, before.updatedAt);

    // Every subsequent subagent event re-reads the same envelope under a new
    // number, and nothing re-stamps the row: a parent that retries on
    // `ask-moved` — which is exactly what `wave-lifecycle.md` tells a
    // coordinator `ask-moved` means — refuses again on every pass, for the
    // whole life of the row.
    for (const agent of ['reviewer', 'verifier', 'scout']) {
      run({ hook_event_name: 'SubagentStop', agent_name: agent });
      const fresh = readState();
      expect(fresh.ask).toEqual(before.ask);
      const attempt = coord.takeAskForAnswer(id, fresh.updatedAt);
      expect(attempt.ok).toBe(false);
      expect(attempt.ok === false && attempt.why).toBe('ask-moved');
      expect(okAsk(coord.askById(id))?.askAt).toBe(before.updatedAt);
      expect(okAsk(coord.askById(id))?.state).toBe('held');
    }
  });
});
