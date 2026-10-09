// Workspace lifecycle wave 5 (spec 2026-09-24 §5.3; CCR-15 spec §5.5's consent rule): `ws-expire`'s consent BINDS THE
// BRANCH. The token is checked against the in-lock recompute's branch read, and the pin reads the branch again,
// itself; a branch deleted (or made) between the two reads stops the act there — `failed` `state-changed`, exit 1 —
// AFTER the pin, which only keeps, and BEFORE the tombstone and the breadcrumb, so nothing has started. A branch
// already absent when the token was minted reads absent twice and the expiry goes on, its work kept in the attic.
// The server reads that refusal as one to START OVER from (the coordinator's ruling on the wave-5 plan's question (h)),
// so each window case also measures what the refusal leaves: the stale token is refused before anything, and a fresh
// audit reads what stands and its token expires the archive.
//
// FIXTURE HOME ONLY (`makePrHarness`): the unit and pane calls are RECORDED (`EXP_STUBS`), never made, and the only
// ref this file deletes or makes is the fixture repository's. A new file, not an addition to the verb suite (the
// 600 s foreground ceiling).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { eventsOf } from './lifecycleHelpers.js';
import { EXP_BRANCH, EXP_ID, expireAudit, expireEvalOf, expireVerb, makeArchived, type Archived } from './wsExpireFixture.js';
import { parseExpireResult } from '../src/archivedExpiry.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-consent-'); });
afterEach(() => { h.cleanup(); });

/** This runner's own git, MEASURED: the three-way branch read needs `git show-ref --exists` (git 2.43 and newer). */
const GIT_VERSION = /git version (\d+)\.(\d+)/.exec(execFileSync('git', ['--version'], { encoding: 'utf8', env: inheritedEnv() }));
const MODERN_GIT = GIT_VERSION !== null
  && (Number(GIT_VERSION[1]) > 2 || (Number(GIT_VERSION[1]) === 2 && Number(GIT_VERSION[2]) >= 43));

/** `act`, run INSIDE the verb's lock at the second branch read — the pin's, after the in-lock recompute's — then the
 *  real read. The count lives in the fixture HOME, because every read runs in `$( … )`. */
const IN_THE_WINDOW = (act: string): string => [
  `eval "$(declare -f _ws_reclaim_branch_state | sed '1s/^_ws_reclaim_branch_state /_ws_real_branch_state /')";`,
  `_ws_reclaim_branch_state() { local n; n=$(cat "$HOME/bs-reads" 2>/dev/null || echo 0); echo $(( n + 1 )) > "$HOME/bs-reads";`,
  ` if (( n == 1 )); then ${act}; fi; _ws_real_branch_state "$@"; };`,
].join(' ');

const atticReach = (a: Archived): string[] => {
  const refs = h.git(a.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${EXP_ID}/`).split('\n').filter(Boolean);
  return refs.length ? h.git(a.main, 'rev-list', ...refs).split('\n').filter(Boolean) : [];
};
const unsupervised = (): string[] => h.calls().filter((l) => l.startsWith('unsupervise'));
/** Nothing started: the tree, the row and the archive stand, no breadcrumb, no tombstone, the unit untouched. */
const nothingStarted = (a: Archived): void => {
  expect(fs.existsSync(a.wt), 'the tree stands').toBe(true);
  expect(h.reg(EXP_ID, 'uuid'), 'the row stands').not.toBeNull();
  expect(h.reg(EXP_ID, 'archived'), 'the archive stands').not.toBeNull();
  expect(h.reg(EXP_ID, 'reaping'), 'no breadcrumb').toBeNull();
  expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${EXP_ID}.json`)), 'no tombstone').toBe(false);
  expect(unsupervised(), 'the unit was not touched').toEqual([]);
};
/** AFTER the refusal, what it left is never misread (wave 5: a failed state-changed audits afresh). The attic pin, the
 *  journal's intent and failure, and the row stand, with no breadcrumb and no tombstone. The stale token is
 *  refused before anything. A fresh audit reads the row as it now stands, expirable with nothing to resume, and its
 *  token expires the archive, the tip the refused pin read still in the attic. */
const auditsAfresh = (a: Archived, stale: string): void => {
  const again = expireVerb(h, stale);
  expect(again.code, again.stdout + again.stderr).toBe(0);
  expect((JSON.parse(again.stdout) as { refused?: string }).refused, 'the stale token is refused before anything').toBe('state-changed');
  nothingStarted(a);
  const audit = expireAudit(h);
  expect(audit.code, audit.stdout + audit.stderr).toBe(0);
  const doc = JSON.parse(audit.stdout) as Record<string, unknown>;
  expect(doc, 'a fresh audit reads what stands').toMatchObject({ verdict: 'expirable', reaping: null });
  expect(doc, 'nothing to resume').not.toHaveProperty('resume');
  expect(doc['token'], 'a token over what stands, not the stale one').not.toBe(stale);
  const r = expireVerb(h, String(doc['token']));
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect((JSON.parse(r.stdout) as { expired: string }).expired).toBe(EXP_ID);
  expect(fs.existsSync(a.wt), 'the tree is gone').toBe(false);
  expect(atticReach(a), 'the tip the refused pin read is in the attic').toContain(a.tip);
};

describe.skipIf(!MODERN_GIT)('ws-expire: the consent binds the branch (wave 5)', () => {
  it('a branch DELETED between the in-lock recompute and the pin stops the act: failed state-changed, before the breadcrumb', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');      // so the pin meets no HEAD symbolic to the branch
    const token = expireEvalOf(h).token;              // minted over branchState=present
    const r = expireVerb(h, token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref -d "refs/heads/$2" >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('state-changed');
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the recompute read, then the pin, and nothing after').toBe('2');
    expect(o.detail).toMatch(new RegExp(`${EXP_BRANCH} read present when the token was checked inside the lock, but absent when the pin read it again`));
    expect(eventsOf(h.home, 'expire').map((e) => e['outcome']), 'one act: its intent, then its failure').toEqual(['intent', 'failed']);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the CONTROL: the other actor did delete the branch').toBe('');
    expect(atticReach(a), 'the pin only kept: the tip it read is in the attic').toContain(a.tip);
    nothingStarted(a);
    // And the server reads this document as one to START OVER from — nothing started, so nothing is resumed, and what
    // stands is audited afresh.
    expect(parseExpireResult(EXP_ID, r.stdout, r.stderr)).toEqual({ kind: 'restart', detail: `state-changed: ${o.detail}` });
    auditsAfresh(a, token);
  }, 180_000);

  it('a branch MADE between the in-lock recompute and the pin stops it too: the consent binds both ways', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');
    h.git(a.main, 'update-ref', '-d', `refs/heads/${EXP_BRANCH}`);
    const token = expireEvalOf(h).token;              // minted over branchState=absent
    const r = expireVerb(h, token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref "refs/heads/$2" ${a.tip} >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('state-changed');
    expect(o.detail).toMatch(new RegExp(`${EXP_BRANCH} read absent when the token was checked inside the lock, but present when the pin read it again`));
    expect(h.git(a.main, 'rev-parse', `refs/heads/${EXP_BRANCH}`), 'the branch made in the window stands').toBe(a.tip);
    nothingStarted(a);
    auditsAfresh(a, token);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the fresh consent covered the branch made in the window').toBe('');
  }, 180_000);

  it('the CONTROL: a branch ALREADY ABSENT when the token was minted still expires, its work kept in the attic', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');
    h.git(a.main, 'update-ref', '-d', `refs/heads/${EXP_BRANCH}`);
    const r = expireVerb(h, expireEvalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { expired: string }).expired).toBe(EXP_ID);
    expect(fs.existsSync(a.wt), 'the tree is gone').toBe(false);
    expect(atticReach(a), 'HEAD — the work — is kept in the attic').toContain(a.tip);
  }, 120_000);

  it('the CONTROL: a branch that stands at both reads expires as ever', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');
    const r = expireVerb(h, expireEvalOf(h).token, { pre: IN_THE_WINDOW(':') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { expired: string }).expired).toBe(EXP_ID);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch was deleted at its tip').toBe('');
  }, 120_000);
});
