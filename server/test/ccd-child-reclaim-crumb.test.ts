// `crumb` — whether a `"failed"` document was printed past the act's breadcrumb
// (child reclamation spec §5.6, §7 item 6). ADDITIVE and ccd-side only: the key
// is printed when the printer was told, and omitted otherwise, so a reader takes
// its absence as unmeasured and never as either value.
//   - `ws-reclaim` says `false` on its fresh arm before its breadcrumb, the
//     resumed state (`true`) on its resumed arm, and `true` once its breadcrumb
//     is written;
//   - the SHARED tail says `true`, for `ws-reclaim` and `ws-expire` alike;
//   - `true` means printed past the act's breadcrumb (the act had started),
//     never that a breadcrumb stands now: a tail `purge-*` failure prints it
//     after the row and its breadcrumb were purged;
//   - `ws-expire`'s own pre-breadcrumb documents (its `probe-unmeasured`,
//     `pin-failed` and `tombstone-unwritable`) carry NO key: its locked body is
//     another programme's region and is not edited;
//   - a breadcrumb that stands but cannot be read says nothing either way.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_ID, EXP_STUBS, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-crumb-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);

type Doc = Record<string, unknown>;
const docOf = (r: { stdout: string }): Doc => JSON.parse(r.stdout) as Doc;
const PIN_FAILS = '_ws_wip_commit() { RECLAIM_WIP_WHY="the disk is full"; return 1; };';
const STASH_FAILS = '_ws_reclaim_stash_shas() { return 1; };';
const UNIT_UP = '_svc_is_active() { printf active; };';
/** A unit that is down for the ladder and UP again once the tail has unsupervised it: the expiry's
 *  presence rung passes, and the tail's re-measure stops it, past its breadcrumb. */
const UNIT_BACK_UP =
  '_svc_is_active() { if grep -q "^unsupervise" "$HOME/ccd-calls" 2>/dev/null; then printf active; else printf inactive; fi; };';

describe('the printer: the key only when told, and only ever a boolean', () => {
  const print = (crumb: string): string =>
    h.sh(`_WS_RCL_CRUMB='${crumb}'; _ws_reclaim_failed_json some-word 'a detail'`);
  it('omits the key when nothing set it, prints true or false when set, and never prints another value', () => {
    expect(print('')).toBe('{"failed":"some-word","detail":"a detail"}');
    expect(print('false')).toBe('{"failed":"some-word","detail":"a detail","crumb":false}');
    expect(print('true')).toBe('{"failed":"some-word","detail":"a detail","crumb":true}');
    expect(print('yes'), 'a value that is not a boolean is not printed').toBe('{"failed":"some-word","detail":"a detail"}');
  }, 30_000);

  it('is assigned when ccd is read, so an exported value never reaches a document', () => {
    expect(h.sh('_ws_reclaim_failed_json some-word d', { _WS_RCL_CRUMB: 'true' }))
      .toBe('{"failed":"some-word","detail":"d"}');
  }, 30_000);
});

describe('ws-reclaim', () => {
  it('fresh arm, before the breadcrumb: pin-failed says crumb false — and the journal row is unchanged', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: PIN_FAILS });
    expect(r.code, r.stderr).toBe(1);
    expect(docOf(r)).toEqual({ failed: 'pin-failed', detail: 'the disk is full', crumb: false });
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
    failedPairAgrees(r);
    const row = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'failed').pop()!;
    expect(row, 'crumb is the document’s, never a journal key').not.toHaveProperty('crumb');
  }, 60_000);

  it('fresh arm: the locked recomputation’s probe-unmeasured says crumb false', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: STASH_FAILS });
    expect(r.code, r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'probe-unmeasured', crumb: false });
  }, 60_000);

  it('resumed arm: probe-unmeasured over a standing breadcrumb says crumb TRUE (the next attempt resumes)', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    const tomb = path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`);
    fs.chmodSync(tomb, 0o000);
    try {
      const r = childReclaimVerb(h, tok);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(docOf(r)).toMatchObject({ failed: 'probe-unmeasured', crumb: true });
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stands').toBe('reclaim:worktree');
    } finally { fs.chmodSync(tomb, 0o644); }
  }, 60_000);

  it('a breadcrumb that stands but cannot be read: probe-unmeasured carries NO crumb', () => {
    makeChild(h);
    const tok = evalOf(h).token;
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.reaping`));
    const r = childReclaimVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const d = docOf(r);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(d, 'whether an act started is unknown, so nothing is said').not.toHaveProperty('crumb');
  }, 60_000);

  it('past the breadcrumb: the tail’s failure says crumb true', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: UNIT_UP });
    expect(r.code, r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'unit-still-active', crumb: true });
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 60_000);
});

describe('ws-expire — its locked body is not edited', () => {
  it('pre-breadcrumb pin-failed carries NO crumb, even with one exported', () => {
    makeArchived(h);
    const tok = expireToken(h);
    let out = '';
    try {
      out = h.sh(`${EXP_STUBS} ${PIN_FAILS} ${CHILD_ENV} cmd_ws_expire --expect ${tok} --session ${EXP_ID}`,
        { _WS_RCL_CRUMB: 'false' });
    } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
    expect(JSON.parse(out)).toEqual({ failed: 'pin-failed', detail: 'the disk is full' });
    expect(h.reg(EXP_ID, 'reaping')).toBeNull();
  }, 90_000);

  it('its own probe-unmeasured (printed by `_ws_reclaim_failed_json` directly) carries NO crumb', () => {
    makeArchived(h);
    const r = expireVerb(h, expireToken(h), { pre: STASH_FAILS });
    expect(r.code, r.stderr).toBe(1);
    const d = docOf(r);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(d).not.toHaveProperty('crumb');
  }, 90_000);

  it('the SHARED tail says crumb true for an expiry too', () => {
    makeArchived(h);
    const r = expireVerb(h, expireToken(h), { pre: UNIT_BACK_UP });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'unit-still-active', crumb: true });
    expect(h.reg(EXP_ID, 'reaping'), 'past the breadcrumb').toBe('expire:children');
  }, 90_000);
});
