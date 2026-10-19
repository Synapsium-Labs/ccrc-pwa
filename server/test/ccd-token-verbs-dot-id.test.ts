// path-identity W1b, Task 8 (path-identity spec §2.6, decision SEC6). The three token verbs (ws-reclaim, ws-expire
// and ws-collect) and the two audits that mint their tokens (`ws-audit --reclaim` and `ws-audit --expire`) apply ONE
// id rule at entry, `_ws_tmproot_id_ok`: the registry charset, never dash-leading, and never dot-leading. A
// dot-leading id names ccd's own hidden registry files (`$REG/.<id>.*`), so it is no child's, no archive's and no
// witness's. Without this rule, ws-reclaim journaled a token refusal against such an id, and ws-expire created a
// permanent `.reap-.<id>.lock` for it. Each refusal is the bare `die "bad session id"`: nothing is read, nothing is
// journaled, and no lock is taken. Plain `ws-audit` (reap mode) is no token verb's audit; it keeps today's answer for
// the same id.
//
// FIXTURE HOME ONLY. Every call is a sourced function under `makePrHarness`'s HOME. The reclaim and expiry
// machinery's recorders (`CHILD_STUBS`, `EXP_STUBS`) stand in for the unit and the pane, and the residue probe stays
// inside that HOME (`CHILD_ENV`). `_alive` is redefined as a RECORDER: it is the first read each audit makes after
// its id check, so an empty `ccd-calls` proves the entry refused before anything was read.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_STUBS } from './childReclaimFixture.js';
import { EXP_STUBS } from './wsExpireFixture.js';
import { WRONG_TOKEN } from './wsCollectFixture.js';
import { reapLocks } from './dashIdFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-token-dot-id-'); });
afterEach(() => { h.cleanup(); });

type Run = { code: number; stdout: string; stderr: string };

/** A well-formed token. The entry rule must refuse before any token is compared. */
const TOK = 'a'.repeat(64);
/** `_alive` as a recorder: the first read each audit makes after its id check (see the header). */
const ALIVE_REC = '_alive() { echo "alive $*" >> "$HOME/ccd-calls"; return 1; };';
/** The stubs `ccd-ws-audit.test.ts` uses for a plain audit: no tmux, and every session gone. */
const PLAIN_STUBS = 'tmux() { return 1; }; _session_verdict() { echo gone; };';

const reclaimAt = (id: string, token: string): Run =>
  h.run(`${CHILD_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_reclaim --expect ${token} --child-of 7 --session '${id}'`);
const expireAt = (id: string): Run =>
  h.run(`${EXP_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_expire --expect ${TOK} --session '${id}'`);
const collectAt = (id: string): Run =>
  h.run(`${ALIVE_REC} cmd_ws_collect --expect ${WRONG_TOKEN} --session '${id}'`);
const reclaimAuditAt = (id: string, defer = false): Run =>
  h.run(`${CHILD_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_audit --session '${id}' --reclaim${defer ? ' --defer-expired' : ''}`);
const expireAuditAt = (id: string): Run =>
  h.run(`${EXP_STUBS} ${ALIVE_REC} ${CHILD_ENV} cmd_ws_audit --session '${id}' --expire`);
const plainAuditAt = (id: string): Run =>
  h.run(`${GH_STUB} ${PLAIN_STUBS} cmd_ws_audit --session '${id}'`);

/** The entry refused, and nothing came after it: no document, no read, no lock and no journal line. */
const expectEntryDeath = (r: Run, what: string): void => {
  expect(r.code, `${what}: ${r.stdout}${r.stderr}`).toBe(1);
  expect(r.stderr, what).toContain('bad session id');
  expect(r.stdout, `${what}: a die prints no document`).toBe('');
  expect(h.calls(), `${what}: nothing was read after the entry`).toEqual([]);
  expect(reapLocks(h.home), `${what}: no reap lock was created`).toEqual([]);
  expect(readJournal(h.home), `${what}: nothing was journaled`).toEqual([]);
};

describe('the token verbs and their audits refuse a dot-leading id at entry, as ws-collect does (path-identity spec §2.6)', () => {
  it('ws-reclaim --session .hidden-x dies "bad session id", journals nothing, and takes no lock', () => {
    // A malformed token: without the rule, the token check is reached and journals `token-malformed` against the id.
    expectEntryDeath(reclaimAt('.hidden-x', 'x'), 'ws-reclaim, malformed token');
    // A well-formed token: without the rule, the verb reaches the reap lock and creates `.reap-.hidden-x.lock`.
    expectEntryDeath(reclaimAt('.hidden-x', TOK), 'ws-reclaim, well-formed token');
  }, 60_000);

  it('ws-expire --session .x-y with a well-formed token dies "bad session id", and there is no .reap-.x-y.lock', () => {
    expectEntryDeath(expireAt('.x-y'), 'ws-expire');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reap-.x-y.lock')), 'the permanent lock').toBe(false);
  }, 60_000);

  it('ws-audit --reclaim and ws-audit --expire die "bad session id" for .x-y before anything is read', () => {
    expectEntryDeath(reclaimAuditAt('.x-y'), 'ws-audit --reclaim');
    expectEntryDeath(reclaimAuditAt('.x-y', true), 'ws-audit --reclaim --defer-expired');
    expectEntryDeath(expireAuditAt('.x-y'), 'ws-audit --expire');
  }, 60_000);

  it('plain ws-audit for .x-y keeps today\'s answer', () => {
    // Reap mode is no token verb's audit (path-identity spec §2.6 names the token verbs alone). It audits the literal id,
    // which has no row: Phase A's first rung, as `ccd-ws-audit.test.ts` measures for an id it never heard of.
    h.makeGhRepo('demo');
    const r = plainAuditAt('.x-y');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict'], 'the literal id, refused by the ladder, never at entry').toBe('no-such-session');
    expect(doc['token'], 'a refusal hands out no token').toBeUndefined();
    expect(reapLocks(h.home)).toEqual([]);
  }, 60_000);

  it('ws-collect --session .x-y still dies "bad session id" through the one call', () => {
    expectEntryDeath(collectAt('.x-y'), 'ws-collect');
  }, 60_000);

  it('a dash-leading id still dies at all five entries', () => {
    // The three verbs refused a dash-leading id already (the dash rule at their entries). The two audits refuse it from
    // this task on, because `_ws_tmproot_id_ok` derives from `_reg_id_ok`. One delegation now carries both rules at all five.
    for (const id of ['-x-y', '--actor']) {
      expectEntryDeath(reclaimAt(id, TOK), `ws-reclaim ${id}`);
      expectEntryDeath(expireAt(id), `ws-expire ${id}`);
      expectEntryDeath(collectAt(id), `ws-collect ${id}`);
      expectEntryDeath(reclaimAuditAt(id), `ws-audit --reclaim ${id}`);
      expectEntryDeath(expireAuditAt(id), `ws-audit --expire ${id}`);
    }
  }, 120_000);
});
