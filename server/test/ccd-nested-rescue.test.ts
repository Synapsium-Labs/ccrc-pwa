// Rung 9 rescues a nested repository of ANOTHER project into the attic (D-6632, disk-retention spec §2.7.1).
// Under `$REG/nested-rescue-live`, `_ws_reclaim_foreign_clean`'s refusal of work (dirty, no remote) is a RESCUE, not a refusal:
// the pin WIP-commits the nested repository, fetches its refs and the WIP into `refs/ccrc/attic/<id>/nested/<pathhex>/`, re-proves
// each landed, and the tail removes the tree. The ladder is shared, so the expiry rescues the same fixture. FIXTURE HOME only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { EXP_ID, expireAudit, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-nested-rescue-'); });
afterEach(() => { h.cleanup(); });

const MARKER = (): string => path.join(h.home, '.cc-sessions', 'nested-rescue-live');
const hex = (s: string): string => Buffer.from(s).toString('hex');
const REL = 'vendor/other';

/** A repository of another project nested in `wt`: two commits on no remote, plus an untracked file. */
function plantNested(wt: string): { dir: string; tip: string } {
  const dir = path.join(wt, REL);
  fs.mkdirSync(dir, { recursive: true });
  h.git(dir, 'init', '-q', '-b', 'main');
  for (const n of ['1', '2']) {
    fs.writeFileSync(path.join(dir, `n${n}.txt`), `nested ${n}\n`);
    h.git(dir, 'add', `n${n}.txt`);
    h.git(dir, 'commit', '-q', '-m', `nested ${n}`);
  }
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'not committed\n');
  return { dir, tip: h.git(dir, 'rev-parse', 'HEAD') };
}
const arm = (): void => { fs.writeFileSync(MARKER(), ''); };
const base = (id: string): string => `refs/ccrc/attic/${id}/nested/${hex(REL)}`;
const doc = (r: { stdout: string }): Record<string, unknown> => JSON.parse(r.stdout) as Record<string, unknown>;
const tomb = (id: string): { containment: { rescued: Array<Record<string, unknown>> } } =>
  JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${id}.json`), 'utf8')) as never;
const intact = (c: Child, nested: string): void => {
  expect(fs.existsSync(c.wt), 'the worktree survives').toBe(true);
  expect(fs.existsSync(path.join(nested, 'untracked.txt')), 'the nested repository is untouched').toBe(true);
  expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
};

describe('without the marker rung 9 is unchanged, and names what it would rescue', () => {
  it('answers containment-unproven, and the audit document lists the path under wouldRescue', () => {
    const c = makeChild(h);
    plantNested(c.wt);
    const a = evalOf(h);
    expect(a.verdict).toBe('containment-unproven');
    const out = h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    const nr = (JSON.parse(out) as { nestedRescue: { wouldRescue: string[]; rescue: string[] } }).nestedRescue;
    expect(nr.wouldRescue).toEqual([path.join(fs.realpathSync(c.wt), REL)]);
    expect(nr.rescue).toEqual([]);
  }, 90_000);
});

describe('with the marker a nested repository is rescued, then the tree goes', () => {
  it('mints a token, pins both commits and the WIP under the attic, removes the tree, and records the rescue', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    arm();
    const a = evalOf(h);
    expect(a.verdict, a.detail).toBe('reclaimable');
    const audit = JSON.parse(h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`)) as
      { nestedRescue: { rescue: string[] } };
    expect(audit.nestedRescue.rescue).toHaveLength(1);

    const r = childReclaimVerb(h, a.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(doc(r)['reclaimed']).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree is gone').toBe(false);

    const b = base(CHILD_ID);
    expect(h.git(c.main, 'rev-parse', `${b}/refs/heads/main`), 'the nested branch tip is pinned').toBe(n.tip);
    const wip = h.git(c.main, 'rev-parse', `${b}/wip`);
    expect(h.git(c.main, 'rev-parse', `${b}/head`)).toBe(n.tip);
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', wip).split('\n'), 'the untracked file is in the WIP').toContain('untracked.txt');
    expect(h.git(c.main, 'rev-list', '--count', wip), 'both commits and the WIP resolve').toBe('3');
    for (const sha of [n.tip, wip]) expect(() => h.git(c.main, 'cat-file', '-e', `${sha}^{commit}`)).not.toThrow();

    const rescued = tomb(CHILD_ID).containment.rescued;
    expect(rescued).toHaveLength(1);
    expect(rescued[0]).toMatchObject({ path: REL, refs: `${b}/` });
    // The settle re-pin re-captures the tree, so the record may name the earlier WIP: every WIP stays pinned by its sha.
    expect(h.git(c.main, 'rev-parse', `${b}/wips/${String(rescued[0]!['wip'])}`)).toBe(String(rescued[0]!['wip']));
    expect(Number(rescued[0]!['bytes'])).toBeGreaterThan(0);
  }, 120_000);

  it('a commit made in the nested repository between the audit and the act gives state-changed', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    arm();
    const tok = evalOf(h).token;
    fs.writeFileSync(path.join(n.dir, 'n3.txt'), 'late\n');
    h.git(n.dir, 'add', 'n3.txt'); h.git(n.dir, 'commit', '-q', '-m', 'late');
    const r = childReclaimVerb(h, tok);
    expect(doc(r)['refused']).toBe('state-changed');
    intact(c, n.dir);
  }, 120_000);

  it('a status change alone moves the token (the digest is an input)', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    arm();
    const t1 = evalOf(h).token;
    fs.writeFileSync(path.join(n.dir, 'another.txt'), 'x\n');
    expect(evalOf(h).token).not.toBe(t1);
  }, 90_000);

  it('over the size bound: nested-rescue-too-large, nothing removed, no attic ref left', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    arm();
    const tok = evalOf(h).token;
    const r = childReclaimVerb(h, tok, { pre: 'WS_NESTED_RESCUE_MAX_MB=0;' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(doc(r)['failed']).toBe('nested-rescue-too-large');
    intact(c, n.dir);
    expect(h.git(c.main, 'for-each-ref', `${base(CHILD_ID)}/`), 'the refs of a refused rescue are removed').toBe('');
  }, 120_000);

  it('the bound holds on EVERY attempt: a 3 MiB blob over a 1 MiB bound is refused twice and the tree stays', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    fs.writeFileSync(path.join(n.dir, 'big.bin'), randomBytes(3 * 1024 * 1024));
    h.git(n.dir, 'add', 'big.bin'); h.git(n.dir, 'commit', '-q', '-m', 'big');
    arm();
    for (const attempt of [1, 2]) {
      const r = childReclaimVerb(h, evalOf(h).token, { pre: 'WS_NESTED_RESCUE_MAX_MB=1;' });
      expect(doc(r)['failed'], `attempt ${attempt}: ${r.stdout + r.stderr}`).toBe('nested-rescue-too-large');
      intact(c, n.dir);
      expect(h.git(c.main, 'for-each-ref', `${base(CHILD_ID)}/`)).toBe('');
    }
  }, 180_000);

  it('a secret-shaped untracked file in the nested repository is declared in the audit\'s sensitive field', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    fs.writeFileSync(path.join(n.dir, '.env'), 'TOKEN=x\n');
    arm();
    expect(evalOf(h).verdict).toBe('reclaimable');
    const audit = JSON.parse(h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`)) as { sensitive: string[] };
    expect(audit.sensitive).toContain(`${REL}/.env`);
  }, 120_000);

  it('a nested repository with no commit yet stays containment-unproven under the marker (no token to retry forever)', () => {
    const c = makeChild(h);
    const dir = path.join(c.wt, REL);
    fs.mkdirSync(dir, { recursive: true });
    h.git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'never committed\n');
    arm();
    expect(evalOf(h).verdict).toBe('containment-unproven');
    const scratch = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${dir}"`);
    expect(scratch.code).toBe(1);
    expect((JSON.parse(scratch.stdout) as { failed: string }).failed).toBe('nested-rescue-failed');
  }, 120_000);

  it('a fetch that fails: nested-rescue-failed, nothing removed', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    arm();
    const tok = evalOf(h).token;
    const r = childReclaimVerb(h, tok, { pre: 'git() { case "$*" in *" fetch "*) return 128 ;; esac; command git "$@"; };' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(doc(r)['failed']).toBe('nested-rescue-failed');
    intact(c, n.dir);
  }, 120_000);

  it('a fetch that "succeeds" and lands nothing is caught by the re-prove: nested-rescue-failed, nothing removed', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    arm();
    const tok = evalOf(h).token;
    const r = childReclaimVerb(h, tok, { pre: 'git() { case "$*" in *" fetch "*) return 0 ;; esac; command git "$@"; };' });
    expect(doc(r)['failed']).toBe('nested-rescue-failed');
    intact(c, n.dir);
  }, 120_000);

  it('a commit only a reflog names is pinned too (a reset-away tip is not lost)', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    h.git(n.dir, 'reset', '-q', '--hard', 'HEAD~1');
    arm();
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(doc(r)['reclaimed'], r.stdout + r.stderr).toBe(CHILD_ID);
    expect(h.git(c.main, 'rev-parse', `${base(CHILD_ID)}/reflog/${n.tip}`)).toBe(n.tip);
  }, 120_000);

  it('a leaf link and a shared row still answer containment-unproven under the marker', () => {
    const c = makeChild(h);
    plantNested(c.wt);
    arm();
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-other.uuid'), 'u-9');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-other.workdir'), c.wt);
    expect(evalOf(h).verdict, 'a registry row shared with the tree').toBe('containment-unproven');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-other.uuid')); fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-other.workdir'));
    expect(evalOf(h).verdict).toBe('reclaimable');
    const moved = `${c.wt}-moved`;
    fs.renameSync(c.wt, moved);
    fs.symlinkSync(moved, c.wt);
    expect(evalOf(h).verdict, 'the child\'s own leaf is a link').toBe('containment-unproven');
  }, 120_000);
});

describe('the expiry ladder rescues the same fixture', () => {
  it('ws-expire pins the nested repository and removes the archived tree', () => {
    const a = makeArchived(h);
    const n = plantNested(a.wt);
    expect(JSON.parse(expireAudit(h).stdout)['verdict'], 'without the marker').toBe('containment-unproven');
    arm();
    const tok = expireToken(h);
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    const r = expireVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(a.wt), 'the tree is gone').toBe(false);
    expect(h.git(a.main, 'rev-parse', `${base(EXP_ID)}/refs/heads/main`)).toBe(n.tip);
    expect(tomb(EXP_ID).containment.rescued).toHaveLength(1);
  }, 120_000);
});

describe('scratch-rescue keeps a session\'s scratch repository in the project attic', () => {
  it('fetches it under refs/ccrc/attic/<id>/scratch/<namehex>/ and prints the entry', () => {
    const c = makeChild(h);
    const scratch = path.join(h.home, 'scratch-area', 'sandbox');
    fs.mkdirSync(scratch, { recursive: true });
    h.git(scratch, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(scratch, 'a.txt'), 'a\n');
    h.git(scratch, 'add', 'a.txt'); h.git(scratch, 'commit', '-q', '-m', 'a');
    fs.writeFileSync(path.join(scratch, 'loose.txt'), 'loose\n');
    const tip = h.git(scratch, 'rev-parse', 'HEAD');
    const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${scratch}"`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const entry = (JSON.parse(r.stdout) as { rescued: Record<string, unknown> }).rescued;
    const b = `refs/ccrc/attic/${CHILD_ID}/scratch/${hex('sandbox')}`;
    expect(h.git(c.main, 'rev-parse', `${b}/refs/heads/main`)).toBe(tip);
    expect(entry['refs']).toBe(`${b}/`);
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', String(entry['wip'])).split('\n')).toContain('loose.txt');
  }, 90_000);

  it('refuses a directory that is the project\'s own repository', () => {
    const c = makeChild(h);
    const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${c.main}"`);
    expect(r.code).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('nested-rescue-failed');
  }, 60_000);
});
