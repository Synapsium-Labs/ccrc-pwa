// THE ASK INSTANCE GUARD, MEASURED ACROSS THE SEAM IT ACTUALLY SPANS.
//
// `askAt` (D-2170) is a snapshot of the child's hookstate `updatedAt` taken at
// mint, re-read fresh at answer time and CAS'd for equality by
// `takeAskForAnswer`. Its stated warrant (`freshAskAt`'s docstring,
// `server/src/registry.ts`) is that `askKey` hashes CONTENT, so a child asking
// two structurally identical questions mints the same key twice and only
// `updatedAt` distinguishes instance 1 from instance 2.
//
// HISTORY. This suite once MEASURED A DEFECT (D-2403 and D-2404 are the bump it
// measured, and the suite itself closed D-2406): the hook
// stamped `updatedAt` on every write, and its `SubagentStart`/`SubagentStop`
// arm rewrote the identical ask envelope under a fresh number, so a subagent
// event landing on a session blocked at a dialog made the parent's CAS refuse
// `ask-moved`, permanently. `CoordStore.restampAsk` (the watcher half of the
// pair) was the answer on the server side.
//
// D-4041 (`a-carried-wait-keeps-its-stamp`) FIXED IT AT THE SOURCE for a
// MAIN-thread wait: a subagent event over a main-thread `waiting` now keeps the
// file's own `updatedAt` and `event` (the wait's START) and writes an additive
// `aliveAt` = now, which is what the aged door (`hookstate.ts`) reads for
// liveness. So this suite now pins the fix, not the defect:
//   - a SubagentStop under an open dialog moves neither `updatedAt` nor
//     `event`, adds `aliveAt`, and keeps the ask;
//   - the parent's CAS with the fresh read succeeds, however many subagents
//     stop;
//   - a CONTROL proves the guard still means something: a NEW main-thread
//     question moves `updatedAt`, and a row minted on the first is refused
//     `ask-moved`.
// This supersedes the bump D-2403 describes, for a main-thread wait ONLY.
// STILL OPEN: a wait a SUBAGENT raised (`waitBy:"subagent"`) is not carried, so
// its stamp still moves on a subagent event; that, and any other bump, is why
// the `restampAsk` pair stays. The two cases where the stamp MOVES are kept on
// purpose: a new main-thread question (the control above) and that
// subagent-raised wait (last describe).
//
// `server/test/session-hook.test.ts`'s "ask survives subagent events while
// waiting" pins the envelope's survival; this suite measures what that costs
// (now: nothing) on the other side of the seam, the CAS.
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
const readState = (): { state: string; event: string; updatedAt: number; ask: unknown; aliveAt?: number; waitBy?: string } =>
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

describe('a subagent event under a main-thread dialog keeps the guarded number (D-4041)', () => {
  it('SubagentStop leaves updatedAt and event as the wait set them, adds aliveAt, keeps the ask', () => {
    const before = blockOnAsk();
    expect(before.state).toBe('waiting');
    expect(before.ask).toEqual({ questions: QUESTIONS });
    expect(before.aliveAt).toBeUndefined();   // a plain write carries no aliveAt

    // A background subagent finishes while the dialog is still painted. The
    // child did nothing: it is blocked, and cannot have answered.
    run({ hook_event_name: 'SubagentStop', agent_name: 'reviewer' });
    const after = readState();

    // The dialog is untouched, and so is the wait's START.
    expect(after.state).toBe('waiting');
    expect(after.ask).toEqual(before.ask);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.event).toBe(before.event);
    expect(after.event).toBe('PermissionRequest');

    // The liveness the aged door reads moved instead.
    expect(typeof after.aliveAt).toBe('number');
    expect(after.aliveAt!).toBeGreaterThanOrEqual(before.updatedAt);
  });
});

describe('what that means for the parent at the CAS', () => {
  it('the parent is NOT refused: the fresh read equals the minted askAt', () => {
    const before = blockOnAsk();
    run({ hook_event_name: 'SubagentStop', agent_name: 'reviewer' });
    const after = readState();
    expect(after.ask).toEqual(before.ask);   // still the same question on screen

    const coord = store();
    const id = mintAskAt(coord, before.updatedAt);

    // `freshAskAt` re-reads the child's hookstate and returns exactly
    // `after.updatedAt`; the CAS compares it to the row's `askAt`.
    const taken = coord.takeAskForAnswer(id, after.updatedAt);
    expect(taken.ok).toBe(true);
  });

  it('repeated SubagentStops (reviewer, verifier, scout) never move the guarded number', () => {
    const before = blockOnAsk();
    const coord = store();
    const id = mintAskAt(coord, before.updatedAt);

    for (const agent of ['reviewer', 'verifier', 'scout']) {
      run({ hook_event_name: 'SubagentStart', agent_name: agent });
      run({ hook_event_name: 'SubagentStop', agent_name: agent });
      const fresh = readState();
      expect(fresh.ask).toEqual(before.ask);
      expect(fresh.updatedAt).toBe(before.updatedAt);
      expect(okAsk(coord.askById(id))?.askAt).toBe(before.updatedAt);
      expect(okAsk(coord.askById(id))?.state).toBe('held');
    }
    // One CAS after all of them, on the number the file now holds.
    expect(coord.takeAskForAnswer(id, readState().updatedAt).ok).toBe(true);
  });

  it('a subagent TOOL event over the dialog keeps the number too', () => {
    const before = blockOnAsk();
    run({ hook_event_name: 'PostToolUse', agent_id: 'a1', agent_type: 'general-purpose', tool_name: 'Read', tool_input: {} });
    const after = readState();
    expect(after.state).toBe('waiting');
    expect(after.ask).toEqual(before.ask);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(typeof after.aliveAt).toBe('number');
  });
});

describe('the control: a real substitution still refuses', () => {
  it('a NEW main-thread question moves updatedAt, so a row minted on the first is refused ask-moved', () => {
    const first = blockOnAsk();
    const coord = store();
    const id = mintAskAt(coord, first.updatedAt);

    // The child's operator answers; the child asks a structurally identical
    // question (same content, so the same askKey). That is instance 2.
    run({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: {} });
    const second = blockOnAsk();
    expect(second.ask).toEqual(first.ask);          // same content, same askKey
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.aliveAt).toBeUndefined();

    const refused = coord.takeAskForAnswer(id, second.updatedAt);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.why).toBe('ask-moved');
    expect(okAsk(coord.askById(id))?.state).toBe('held');

    // The same row, offered the number it was minted on, would have taken: the
    // refusal is the substitution, not an unanswerable row or a bad fixture.
    expect(coord.takeAskForAnswer(id, first.updatedAt).ok).toBe(true);
  });
});

describe('still open: a wait a SUBAGENT raised is not carried', () => {
  it('a subagent-raised dialog is stored waitBy:"subagent" and a SubagentStop moves its stamp', () => {
    run({ hook_event_name: 'PermissionRequest', agent_id: 'a1', agent_type: 'general-purpose',
      tool_name: 'AskUserQuestion', tool_input: { questions: QUESTIONS } });
    const before = readState();
    expect(before.state).toBe('waiting');
    expect(before.waitBy).toBe('subagent');

    run({ hook_event_name: 'SubagentStop', agent_name: 'reviewer' });
    const after = readState();
    expect(after.ask).toEqual(before.ask);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);   // the stamp still moves
    expect(after.waitBy).toBe('subagent');                        // and the provenance survives the Stop
    expect(after.aliveAt).toBeUndefined();
  });
});
