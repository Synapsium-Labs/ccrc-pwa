// `ws-expire --child-of <run>` (D-6640; fleet disk retention spec §2.7.4, caps `expire-child-v1`). Without the flag a
// workspace that carries a `.child` marker still refuses `child`, so an older server changes nothing. With it, rung 2'
// passes only when the marker PARSES as a run id equal to the flag; every other expiry rule stands (seven days from the
// archive, no pane, no cwd user), the token binds the run, and the shared tail removes the child's pin-kept work, its
// registry row and its temp root. FIXTURE HOME only: the unit and pane calls are recorded, never made.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { EXP_ID, EXP_STUBS, NOW, archiveAt, expireVerb, makeArchived, type Archived } from './wsExpireFixture.js';
import { CHILD_ENV } from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-child-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);
const RUN = '7';
const withChild = (): Archived => {
  const a = makeArchived(h);
  fs.writeFileSync(reg('child'), `${RUN}\n`);
  return a;
};
const evalOf = (childOf: string | null): { verdict: string; token: string; detail: string } => {
  const pre = childOf === null ? '' : `EXPIRE_CHILDOF=${childOf};`;
  const out = h.sh(`${EXP_STUBS} ${pre} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
};
const auditOf = (args: string): { code: number; doc: Record<string, unknown> } => {
  const r = h.run(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID} --expire ${args}`);
  return { code: r.code, doc: r.stdout ? JSON.parse(r.stdout) as Record<string, unknown> : {} };
};
const verb = (token: string, childOf: string | null, extra = ''): { code: number; stdout: string; stderr: string } =>
  expireVerb(h, token, { extra: `${childOf === null ? '' : `--child-of ${childOf}`} ${extra}` });
const refusedWith = (r: { code: number; stdout: string; stderr: string }): string => {
  expect(r.code, `a refusal is an ANSWER — exit 0. stderr: ${r.stderr}`).toBe(0);
  return String((JSON.parse(r.stdout) as Record<string, unknown>)['refused']);
};
const stands = (a: Archived): void => {
  expect(fs.existsSync(a.wt), 'the worktree survives').toBe(true);
  expect(h.reg(EXP_ID, 'uuid'), 'the row survives').not.toBeNull();
};

describe('ws-audit --expire --child-of — rung 2′ for a child', () => {
  it('without --child-of a child still refuses `child`, exactly as today', () => {
    withChild();
    expect(evalOf(null).verdict).toBe('child');
    const a = auditOf('');
    expect(a.doc['verdict']).toBe('child');
    expect(a.doc['token']).toBeUndefined();
  }, 60_000);

  it('a matching marker, archived 8 days: expirable, with a token', () => {
    withChild();
    const e = evalOf(RUN);
    expect(e.verdict, e.detail).toBe('expirable');
    expect(e.token).toMatch(/^[0-9a-f]{64}$/);
    const a = auditOf(`--child-of ${RUN}`);
    expect(a.code).toBe(0);
    expect(a.doc['verdict']).toBe('expirable');
    expect(a.doc['token']).toBe(e.token);
  }, 60_000);

  it('a mismatched marker refuses `child`', () => {
    const a = withChild();
    expect(evalOf('8').verdict).toBe('child');
    expect(auditOf('--child-of 8').doc['verdict']).toBe('child');
    stands(a);
  }, 60_000);

  it('an unreadable marker (garbage, a dangling link, a directory) and a missing marker still refuse `child`', () => {
    makeArchived(h);
    expect(evalOf(RUN).verdict, 'no marker at all').toBe('child');
    for (const plant of [
      () => fs.writeFileSync(reg('child'), 'not-a-run\n'),
      () => fs.writeFileSync(reg('child'), '7 8\n'),
      () => fs.symlinkSync(path.join(h.home, 'nowhere'), reg('child')),
      () => fs.mkdirSync(reg('child')),
    ]) {
      fs.rmSync(reg('child'), { recursive: true, force: true });
      plant();
      expect(evalOf(RUN).verdict).toBe('child');
    }
  }, 60_000);

  it('a bad run id is a usage error on the audit and on the verb, and nothing is touched', () => {
    const a = withChild();
    for (const bad of ['abc', '0', '07', '-1', '1x']) {
      const r = h.run(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID} --expire --child-of ${bad}`);
      expect(r.code, bad).toBe(1);
      expect(r.stdout, bad).toBe('');
      const v = expireVerb(h, 'a'.repeat(64), { extra: `--child-of ${bad}` });
      expect(v.code, bad).toBe(1);
      expect(v.stdout, bad).toBe('');
    }
    const twice = expireVerb(h, 'a'.repeat(64), { extra: '--child-of 7 --child-of 7' });
    expect(twice.code).toBe(1);
    stands(a);
  }, 120_000);

  it('every other rule stands: archived 6 days is `not-expired`, a hold is `held`, a pause is `paused`', () => {
    withChild();
    archiveAt(h, NOW - 6 * 86_400);
    expect(evalOf(RUN).verdict).toBe('not-expired');
    archiveAt(h, NOW - 8 * 86_400);
    fs.writeFileSync(reg('hold'), 'x');
    expect(evalOf(RUN).verdict).toBe('held');
    fs.rmSync(reg('hold'));
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(evalOf(RUN).verdict).toBe('paused');
  }, 60_000);

  it('the token binds the run: it differs from a plain expiry’s, and a token minted for one run is refused for another', () => {
    const a = withChild();
    fs.rmSync(reg('child'));
    const plain = evalOf(null);
    expect(plain.verdict).toBe('expirable');
    fs.writeFileSync(reg('child'), `${RUN}\n`);
    const forRun = evalOf(RUN).token;
    expect(forRun).not.toBe(plain.token);
    fs.writeFileSync(reg('child'), '8\n');
    const forEight = evalOf('8').token;
    expect(forEight).not.toBe(forRun);
    // A verb for run 8 is spent on the token minted for run 7: the marker agrees with the flag, the token does not.
    expect(refusedWith(verb(forRun, '8'))).toBe('state-changed');
    stands(a);
  }, 120_000);
});

describe('ws-expire --child-of — the act', () => {
  it('expires an archived child through the shared tail; the work is in the attic and the temp root is gone', () => {
    const a = withChild();
    h.sh(`${EXP_STUBS} _child_tmpdir ${EXP_ID} >/dev/null`);
    const leaf = path.join(h.home, '.cc-tmp', EXP_ID);
    fs.writeFileSync(path.join(leaf, 'scratch.bin'), 'x'.repeat(100));
    expect(fs.existsSync(leaf), 'the child has a temp root').toBe(true);
    const tok = evalOf(RUN).token;
    // No process of the box holds the leaf (the probe walks /proc, which a fixture on any host cannot rely on).
    const r = expireVerb(h, tok, { extra: `--child-of ${RUN}`, pre: "_ws_path_users() { _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY=''; return 0; };" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)['expired']).toBe(EXP_ID);
    expect(fs.existsSync(a.wt), 'worktree').toBe(false);
    for (const field of ['uuid', 'archived', 'reaping', 'child']) expect(h.reg(EXP_ID, field), field).toBeNull();
    expect(fs.existsSync(leaf), 'the child’s temp root: ' + r.stdout).toBe(false);
    const refs = h.git(a.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${EXP_ID}/`).split('\n').filter(Boolean);
    expect(refs.length ? h.git(a.main, 'rev-list', ...refs).split('\n') : [], 'the tip is kept').toContain(a.tip);
  }, 120_000);

  it('without --child-of the verb refuses `child` and touches nothing', () => {
    const a = withChild();
    const tok = evalOf(RUN).token;
    expect(refusedWith(verb(tok, null))).toBe('child');
    stands(a);
  }, 60_000);

  it('a marker that changed to another run since the audit refuses', () => {
    const a = withChild();
    const tok = evalOf(RUN).token;
    fs.writeFileSync(reg('child'), '8\n');
    expect(refusedWith(verb(tok, RUN))).toBe('child');
    stands(a);
  }, 60_000);

  it('a crash at `children` resumes with the binding: the same run finishes it, no flag and another run refuse `child`', () => {
    const a = withChild();
    h.sh(`${EXP_STUBS} EXPIRE_CHILDOF=${RUN}; _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:children`);
    expect(h.reg(EXP_ID, 'reaping')).toBe('expire:children');
    const resumeTok = (childOf: string): string =>
      h.sh(`${EXP_STUBS} ${CHILD_ENV} EXPIRE_CHILDOF=${childOf}; _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} children >/dev/null; printf '%s' "$REAP_TOKEN"`);
    const tok = resumeTok(RUN);
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    expect(resumeTok(RUN), 'stable').toBe(tok);
    fs.writeFileSync(reg('child'), '8\n');
    expect(resumeTok('8'), 'the resume token binds the run').not.toBe(tok);
    fs.writeFileSync(reg('child'), `${RUN}\n`);
    expect(refusedWith(verb(tok, null)), 'no flag').toBe('child');
    expect(refusedWith(verb(tok, '8')), 'another run').toBe('child');
    expect(fs.existsSync(a.wt)).toBe(true);
    const r = verb(tok, RUN);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)['expired']).toBe(EXP_ID);
    expect(fs.existsSync(a.wt)).toBe(false);
  }, 120_000);

  it('the box advertises the capability the server composes the flag behind', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('expire-child-v1');
  }, 60_000);
});
