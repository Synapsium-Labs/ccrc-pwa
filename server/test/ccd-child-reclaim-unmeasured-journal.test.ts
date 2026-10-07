// Child-reclamation wave 6, Task 10 (spec §5.9): a probe the
// reclaim ladder needs that could not run, or whose answer could not be read,
// is JOURNALED as `failed` with the word `probe-unmeasured`, in BOTH arms that
// answer it: `ws-reclaim`'s locked recomputation (`verb ws-reclaim`) and
// `ws-audit --reclaim`'s unmeasured answer (`verb ws-audit`). The verb arm goes
// through the existing failure path, so its stdout is byte for byte the
// document `_ws_reclaim_failed_json` always printed. A `failed` line is already
// a failure line under wave 5's reader, so no server table changes: the last
// describe proves ccd's line round-trips through that reader. Fixture HOMEs
// only: every ccd call here runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf } from './lifecycleHelpers.js';
import { CHILD_ID, CHILD_STUBS, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { CHILD_RECLAIM_TOKEN_KIND, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_PRE_LOCK_TOKEN, childReclaimFailureLine } from '../src/childReclaimSweep.js';
import { LC_REFUSAL_WORD, lcRefusalWord } from '../../shared/api.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-unmeasured-'); });
afterEach(() => { h.cleanup(); });
const { failedPairAgrees } = verbHelpers(() => h);

/** The ladder's stash read fails: `_ws_reclaim_unmeasured`, at audit time and under the lock alike. */
const STASH_FAILS = '_ws_reclaim_stash_shas() { return 1; };';
const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const audit = (pre = ''): { code: number; stdout: string; stderr: string } =>
  h.run(`${AUDIT_STUBS} ${pre} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
const shape = (e: Record<string, unknown>) =>
  ({ outcome: e['outcome'], refusal: e['refusal'], verb: e['verb'], detail: e['detail'], tx: e['tx'] ?? '' });
/** What `_ws_reclaim_failed_json` prints for this detail: ccd's own printer, never a re-spelling. */
const printedBy = (detail: string): string => {
  fs.writeFileSync(path.join(h.home, 'detail.txt'), detail);
  return h.sh('_ws_reclaim_failed_json probe-unmeasured "$(cat "$HOME/detail.txt")"');
};

describe('ws-reclaim: a probe that could not run under the lock is ONE failed line (spec §5.9)', () => {
  it('journals failed probe-unmeasured, verb ws-reclaim, the declared actor, no tx and no intent — and prints the SAME document at exit 1', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: STASH_FAILS, extra: "--surface agent --actor 'run:7 reclaim close'" });
    expect(r.code, r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('probe-unmeasured');
    expect(r.stdout.trim(), 'the stdout bytes are the ones _ws_reclaim_failed_json always printed').toBe(printedBy(o.detail));
    const rows = eventsOf(h.home, 'reclaim');
    expect(rows.map(shape)).toEqual([{ outcome: 'failed', refusal: 'probe-unmeasured', verb: 'ws-reclaim', detail: o.detail, tx: '' }]);
    failedPairAgrees(r);
    expect(decOf(rows[0]!)['actor'], 'the declared actor rides it, as it rides the refusal emit').toBe('run:7 reclaim close');
    expect(h.reg(CHILD_ID, 'reaping'), 'nothing started: no breadcrumb').toBeNull();
    // Wave 5's executor reads the document exactly as before: not resumable, the word as its token.
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr)).toEqual(
      { kind: 'failed', resume: 'not-resumable', detail: `probe-unmeasured: ${o.detail}`, token: 'probe-unmeasured' });
  }, 60_000);

  it('a breadcrumb that stands but cannot be read is the same one failed line', () => {
    makeChild(h);
    const tok = evalOf(h).token;
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.reaping`));
    const r = childReclaimVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['refusal'], e['verb']]))
      .toEqual([['failed', 'probe-unmeasured', 'ws-reclaim']]);
    failedPairAgrees(r);
  }, 60_000);
});

describe('ws-audit --reclaim: the unmeasured answer is ONE failed line, verb ws-audit (spec §5.9)', () => {
  it('exit 1, the reclaim document unchanged, one failed line carrying the document’s own detail', () => {
    makeChild(h);
    const r = audit(STASH_FAILS);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stderr).toContain('ws-audit --reclaim measured nothing');
    const a = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(a['mode']).toBe('reclaim');
    expect(a['verdict']).toBe('unmeasured');
    expect(a).not.toHaveProperty('token');
    expect(eventsOf(h.home, 'reclaim').map(shape))
      .toEqual([{ outcome: 'failed', refusal: 'probe-unmeasured', verb: 'ws-audit', detail: a['detail'], tx: '' }]);
  }, 60_000);

  it('the exception is the unmeasured answer alone: a reclaimable audit still journals nothing', () => {
    makeChild(h);
    const r = audit();
    expect(r.code, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['verdict']).toBe('reclaimable');
    expect(eventsOf(h.home, 'reclaim')).toEqual([]);
  }, 60_000);
});

describe('wave 5’s reader takes both lines as failures, worded by the journal map (spec §5.9)', () => {
  it('each arm’s line parses, is a failure line, and words through LC_REFUSAL_WORD', () => {
    makeChild(h);
    childReclaimVerb(h, evalOf(h).token, { pre: STASH_FAILS });
    audit(STASH_FAILS);
    const rows = eventsOf(h.home, 'reclaim');
    expect(rows.map((e) => e['verb'])).toEqual(['ws-reclaim', 'ws-audit']);
    for (const e of rows) {
      const j = parseJournalLine(JSON.stringify(e));
      expect(j.act).toBe('reclaim');
      expect(j.outcome).toBe('failed');
      expect(childReclaimFailureLine(j), String(e['verb'])).toBe(true);
      expect(lcRefusalWord(j.refusal ?? ''), String(e['verb'])).toBe(LC_REFUSAL_WORD['probe-unmeasured']);
    }
  }, 90_000);

  it('probe-unmeasured is classified nowhere else: not a pre-lock refusal, not a ws-reclaim refusal', () => {
    // A `failed` line needs no table entry (spec §5.9). Putting the word in either table would class it a
    // second time, by a reader that need not agree.
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)).not.toContain('probe-unmeasured');
    expect(Object.keys(CHILD_RECLAIM_TOKEN_KIND)).not.toContain('probe-unmeasured');
    expect(childReclaimFailureLine({ outcome: 'refused', refusal: 'probe-unmeasured' }), 'only ever as `failed`').toBe(false);
  });
});

describe('its word is true of both arms', () => {
  it('says nothing was removed and the next attempt starts over, and never calls itself a refusal or promises anything intact', () => {
    const w = LC_REFUSAL_WORD['probe-unmeasured'];
    expect(w).toMatch(/nothing was removed/);
    expect(w).toMatch(/from the start/);
    expect(w).not.toMatch(/refus/i);
    expect(w).not.toMatch(/intact/);
  });
});
