// Child-reclamation wave 6, Task 11 (spec §5.9): of cmd_ws_reclaim's
// pre-lock dies, the two TIED TO AN ID — a malformed --expect token and a
// malformed --child-of run id — are journaled `refused` through `_lc_refuse`
// (emit, then the SAME die). That happens AFTER the session id is validated,
// with words wave 5's reader classes as pre-lock FAILURES. Seven dies stay
// unjournaled, each for its stated reason: the usage die and the four
// --actor/--reason checks (they run before any id is bound), a bad session id
// (no trustworthy id to journal against), and python3 unavailable (the
// journal's encoder IS python3). Fixture HOMEs only. Nothing here reaches the
// reap lock, and nothing may.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_ID, CHILD_STUBS, makeChild } from './childReclaimFixture.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { childReclaimTokenKind, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_PRE_LOCK_TOKEN, childReclaimFailureLine, childReclaimTerminalRefusal, isChildReclaimPreLockToken,
} from '../src/childReclaimSweep.js';
import { LC_REFUSAL_WORD, lcRefusalWord, type LcRefusalToken } from '../../shared/api.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-prelock-'); });
afterEach(() => { h.cleanup(); });

const TOK = 'a'.repeat(64);
const BAD_ID = '../x';
/** `cmd_ws_reclaim` through the sourced function, answering instead of throwing. */
const verb = (argv: string, pre = ''): { code: number; stdout: string; stderr: string } =>
  h.run(`${CHILD_STUBS} ${pre} ${CHILD_ENV} cmd_ws_reclaim ${argv}`);
const lockFile = (): string => path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`);
/** Every `reclaim` line, WHATEVER its id: a line written against a malformed id must show here too. */
const childReclaimRows = (): Record<string, unknown>[] => readJournal(h.home).filter((e) => e['act'] === 'reclaim');
const shape = (e: Record<string, unknown>) =>
  ({ outcome: e['outcome'], id: e['id'], refusal: e['refusal'], detail: e['detail'], tx: e['tx'] ?? '' });

const JOURNALED = [
  ['a malformed --expect token', `--expect x --child-of 7 --session ${CHILD_ID}`, 'token-malformed', 'bad token'],
  ['a zero run id', `--expect ${TOK} --child-of 0 --session ${CHILD_ID}`, 'run-id-malformed', 'bad run id'],
  ['a leading-zero run id', `--expect ${TOK} --child-of 07 --session ${CHILD_ID}`, 'run-id-malformed', 'bad run id'],
  // Both malformed: the token is checked first, as it always was. ONE line, never two.
  ['a malformed token AND run id', `--expect x --child-of 0 --session ${CHILD_ID}`, 'token-malformed', 'bad token'],
] as const;

describe('the id-tied pre-lock dies journal ONE refused line, then die exactly as before (spec §5.9)', () => {
  it.each(JOURNALED)('%s', (_what, argv, token, said) => {
    makeChild(h);
    const r = verb(argv);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout, 'a die prints no document').toBe('');
    // The executor recognises the die WHOLE (anchored over all of stderr), so this is the stderr pin
    // that matters: the same die as before, now naming the word ccd journaled for it.
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr))
      .toEqual({ kind: 'failed', resume: 'pre-lock-die', detail: said, token });
    expect(childReclaimRows().map(shape)).toEqual([{ outcome: 'refused', id: CHILD_ID, refusal: token, detail: said, tx: '' }]);
    expect(fs.existsSync(lockFile()), 'the lock was never opened').toBe(false);
  }, 60_000);
});

describe('the seven other pre-lock dies stay unjournaled, each for its stated reason (spec §5.9)', () => {
  it('the session id is validated FIRST: a malformed id beside a malformed token and run id dies "bad session id" and journals nothing', () => {
    makeChild(h);
    const r = verb(`--expect x --child-of 0 --session ${BAD_ID}`);
    expect(r.code).toBe(1);
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr))
      .toEqual({ kind: 'failed', resume: 'pre-lock-die', detail: 'bad session id', token: null });
    expect(childReclaimRows(), 'an id that failed its own shape check is never journaled against').toEqual([]);
    expect(readJournal(h.home).filter((e) => e['id'] === BAD_ID), 'under no act at all').toEqual([]);
  }, 60_000);

  it('the usage die journals nothing — no id is bound yet', () => {
    makeChild(h);
    const r = verb(`--expect ${TOK} --session ${CHILD_ID}`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-reclaim');
    expect(childReclaimRows()).toEqual([]);
  }, 60_000);

  it('the python3 die journals nothing — the journal encoder is python3', () => {
    makeChild(h);
    const r = verb(`--expect ${TOK} --child-of 7 --session ${CHILD_ID}`, '_json_str() { return 1; };');
    expect(r.code).toBe(1);
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr)).toEqual({ kind: 'failed', resume: 'pre-lock-die',
      detail: 'python3 unavailable — cannot quote the reclaim record safely', token: null });
    expect(childReclaimRows()).toEqual([]);
    expect(fs.existsSync(lockFile())).toBe(false);
  }, 60_000);

  it.each([
    ['a blank --actor', "--actor ' '", '--actor must be non-blank'],
    ['an over-long --actor', `--actor ${'x'.repeat(513)}`, '--actor is longer than'],
    ['a blank --reason', "--reason ' '", '--reason must be non-blank'],
    ['an over-long --reason', `--reason ${'x'.repeat(513)}`, '--reason is longer than'],
  ] as const)('%s journals nothing — the four --actor/--reason checks run before any id is bound', (_what, flag, said) => {
    makeChild(h);
    const r = verb(`--expect ${TOK} --child-of 7 --session ${CHILD_ID} ${flag}`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(said);
    expect(childReclaimRows()).toEqual([]);
    expect(fs.existsSync(lockFile())).toBe(false);
  }, 60_000);
});

describe('wave 5’s reader classes each journaled die as a pre-lock FAILURE, never a refusal (spec §5.9)', () => {
  it('each line ccd writes parses to a failure line, is never terminal, and words through LC_REFUSAL_WORD', () => {
    makeChild(h);
    verb(`--expect x --child-of 7 --session ${CHILD_ID}`);
    verb(`--expect ${TOK} --child-of 0 --session ${CHILD_ID}`);
    const rows = childReclaimRows();
    expect(rows.map((e) => e['refusal'])).toEqual(['token-malformed', 'run-id-malformed']);
    for (const e of rows) {
      const j = parseJournalLine(JSON.stringify(e));
      const t = String(j.refusal);
      expect(j.act).toBe('reclaim');
      expect(j.outcome).toBe('refused');
      expect(isChildReclaimPreLockToken(j.refusal), t).toBe(true);
      expect(childReclaimFailureLine(j), t).toBe(true);
      expect(childReclaimTerminalRefusal(
        { sessionId: CHILD_ID, outcome: j.outcome, refusal: j.refusal, at: j.at, failingSince: null },
        childReclaimTokenKind), t).toBe(false);
      expect(lcRefusalWord(t), t).toBe(LC_REFUSAL_WORD[t as LcRefusalToken]);
      expect(lcRefusalWord(t), t).not.toBeNull();
    }
  }, 90_000);

  it('the table keys each new word by its die, beside wave 3’s two', () => {
    expect(CHILD_RECLAIM_PRE_LOCK_TOKEN).toEqual({
      flock: 'flock-unavailable', lock: 'lock-unopenable', token: 'token-malformed', runId: 'run-id-malformed',
    });
  });
});

describe('the two words claim only what is true at their one site', () => {
  it.each(['token-malformed', 'run-id-malformed'] as const)('%s: nothing was removed, and it is a ccrc defect', (t) => {
    expect(LC_REFUSAL_WORD[t]).toMatch(/nothing was removed/);
    expect(LC_REFUSAL_WORD[t]).toMatch(/ccrc bug/);
    expect(LC_REFUSAL_WORD[t]).not.toMatch(/intact/);
  });
});
