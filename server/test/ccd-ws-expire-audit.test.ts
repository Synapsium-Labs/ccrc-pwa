// `ws-audit --session <id> --expire` — the token `ws-expire` spends (workspace lifecycle spec 2026-09-24 §5.3), read
// as the server will read it: one JSON document, exit 1 when a probe could not run. Its ladder is `_ws_expire_eval`
// (`ccd-ws-expire-ladder.test.ts` holds it rung by rung); this file holds the document, the exits, the journal and the
// containment. FIXTURE HOME ONLY (`wsExpireFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';
import { childIndex, hookRuns, plantRepoPrograms, plantTmux } from './childReclaimFixture.js';
import {
  EXP_ID, EXP_STUBS, NOW, OLD, archiveAt, expireAudit, expireEvalOf, expireToken, expireVerb, makeArchived,
} from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-audit-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);

describe('ws-audit --expire — the token the verb spends', () => {
  it('prints mode, archivedAt and the SAME token the ladder mints', () => {
    makeArchived(h);
    const r = expireAudit(h);
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'archivedAt', 'alive', 'exists', 'reaping', 'sensitive', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ session: EXP_ID, mode: 'expire', archivedAt: OLD, alive: false, exists: true, reaping: null, verdict: 'expirable' });
    expect(doc['token']).toBe(expireEvalOf(h).token);
  }, 60_000);

  it('the audit’s token IS the verb’s consent — end to end', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireToken(h));
    expect(JSON.parse(r.stdout)['expired']).toBe(EXP_ID);
    expect(fs.existsSync(a.wt)).toBe(false);
  }, 120_000);

  it('lists what the pin will drop: every secret-shaped path, untracked or ignored', () => {
    const a = makeArchived(h);
    fs.writeFileSync(path.join(a.wt, '.env'), 'KEY=live');
    expect(JSON.parse(expireAudit(h).stdout)['sensitive']).toEqual(['.env']);
  }, 60_000);

  it('a refusal carries no token, and archivedAt is null when no archive could be read', () => {
    makeArchived(h);
    archiveAt(h, NOW - 60);
    const young = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(young['verdict']).toBe('not-expired');
    expect(young['token']).toBeUndefined();
    fs.rmSync(reg('archived'));
    const gone = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(gone['verdict']).toBe('not-archived');
    expect(gone['archivedAt']).toBeNull();
  }, 60_000);

  it('a probe that could not RUN exits 1 — the document says unmeasured, no token, and nothing is journaled', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('archived'), 'soon\n');
    const r = expireAudit(h);
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('unmeasured');
    expect(doc['token']).toBeUndefined();
    expect(r.stderr).toContain('ws-audit --expire measured nothing');
    expect(refusalsOf(h.home)).toEqual([]);
    expect(fs.existsSync(a.wt)).toBe(true);
  }, 60_000);

  it('journals a TERMINAL refusal — and a retryable one not at all', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('hold'), 'x');
    expect(JSON.parse(expireAudit(h).stdout)['verdict']).toBe('held');
    expect(refusalsOf(h.home), 'a retryable word a pass would bury the journal').toEqual([]);
    fs.rmSync(reg('hold'));
    fs.rmSync(path.join(a.main, '.git', 'worktrees', 'quiet-dune'), { recursive: true, force: true });
    expect(JSON.parse(expireAudit(h).stdout)['verdict']).toBe('no-worktree-record');
    expect(refusalsOf(h.home)).toEqual([{ act: 'expire', token: 'no-worktree-record' }]);
    expect(eventsOf(h.home, 'expire')[0]!['verb']).toBe('ws-audit');
  }, 60_000);

  it('answers the RESUME token on an `expire:` breadcrumb, names the phase — and asserts its argv', () => {
    const a = makeArchived(h);
    h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT")" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['resume']).toBe('worktree');
    expect(doc['reaping']).toBe('expire:worktree');
    expect(doc['token']).toBe(h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} worktree >/dev/null;`
      + ' printf "%s" "$REAP_TOKEN"'));
    for (const extra of ['--defer-expired', '--expire']) {
      const bad = h.run(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID} --expire ${extra}`);
      expect(bad.code, extra).toBe(1);
      expect(bad.stderr).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]');
    }
  }, 90_000);

  it('the plain audit never takes the hand-off — no mode, and never the expiry’s verdict', () => {
    makeArchived(h);
    const plain = JSON.parse(h.sh(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID}`)) as Record<string, unknown>;
    expect(plain['mode'], 'the plain audit carries no mode').toBeUndefined();
    expect(plain['verdict']).toBeTypeOf('string');
    expect(plain['verdict'], 'the plain audit answers ws-reap’s question, never the expiry’s').not.toBe('expirable');
  }, 60_000);
});

// RULING (D) AT THE ENTRY WAVE 3b's LANE READS FIRST: the audit is where the server learns a workspace is expirable,
// so a live archived workspace is refused here too — asked by the binding, with no flavour set by the audit.
describe('the audit refuses a live archived workspace — `live`, no token', () => {
  it('a running unit with no pane', () => {
    makeArchived(h);
    const doc = JSON.parse(expireAudit(h, { pre: '_svc_is_active() { printf active; };' }).stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('live');
    expect(doc['token']).toBeUndefined();
  }, 60_000);

  it('a detached `cc-<id>` pane', () => {
    makeArchived(h);
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('live');
    expect(doc['alive']).toBe(true);
    expect(doc['token']).toBeUndefined();
  }, 60_000);
});

describe('the audit reads the archived tree CONTAINED — no hook, no fsmonitor, no index rewrite', () => {
  it('runs none of the repository’s programs and leaves the stale index byte-identical', () => {
    const a = makeArchived(h);
    plantRepoPrograms(h, a);
    const before = childIndex(h, a);
    expect(expireAudit(h).code).toBe(0);
    expect(hookRuns(h)).toEqual([]);
    expect(childIndex(h, a).bytes).toBe(before.bytes);
    // The CONTROL: an uncontained status of the same tree runs the hook and rewrites the index.
    h.git(a.wt, 'status');
    expect(hookRuns(h).length).toBeGreaterThan(0);
  }, 90_000);
});
