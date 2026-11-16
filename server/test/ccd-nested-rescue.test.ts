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
function plantNested(wt: string, rel: string = REL): { dir: string; tip: string } {
  const dir = path.join(wt, rel);
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

  it('the bound counts packed (delta-compressed) bytes: a delta-heavy history under a 2 MiB bound is rescued', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    const lines = Array.from({ length: 6000 }, () => randomBytes(32).toString('hex'));
    for (let i = 0; i < 20; i++) {
      lines[i] = `edit ${i}`;
      fs.writeFileSync(path.join(n.dir, 'text.txt'), lines.join('\n') + '\n');
      h.git(n.dir, 'add', 'text.txt'); h.git(n.dir, 'commit', '-q', '-m', `v${i}`);
    }
    arm();
    const r = childReclaimVerb(h, evalOf(h).token, { pre: 'WS_NESTED_RESCUE_MAX_MB=2;' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(n.dir), 'the tree is gone').toBe(false);
  }, 180_000);

  // The fixture's commits must not start git's auto-maintenance. It runs DETACHED, so it outlives the commit, and on git 2.55
  // its default is a geometric `repack -d`: in the nested repository it can merge and delete the temporary pack of the
  // fixture's own `gc --aggressive` before gc's cruft pass reads it ("could not find pack '.tmp-…-pack-….pack'"). Nothing in
  // the harness git env may leave it on.
  it('the fixture git env never starts auto-maintenance (a detached repack would race the fixture gc)', () => {
    const r = path.join(h.home, 'no-maint');
    fs.mkdirSync(r);
    h.git(r, 'init', '-q');
    fs.writeFileSync(path.join(r, 'w'), 'x');
    h.git(r, 'add', '-A');
    const trace = path.join(h.home, 'no-maint.trace');
    const was = process.env['GIT_TRACE'];
    process.env['GIT_TRACE'] = trace;
    try { h.git(r, 'commit', '-q', '-m', 'w'); } finally { if (was === undefined) delete process.env['GIT_TRACE']; else process.env['GIT_TRACE'] = was; }
    const spawned = fs.readFileSync(trace, 'utf8').split('\n').filter((l) => /run_command: git (maintenance run|gc) --auto/.test(l));
    expect(spawned).toEqual([]);
  });

  it('the bound holds on what lands: a packed, delta-heavy nested repository of fewer than 100 objects grows the project store by at most the bound', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    const lines = Array.from({ length: 90000 }, () => randomBytes(16).toString('hex'));
    for (let i = 0; i < 20; i++) {
      lines[i] = `edit ${i}`;
      fs.writeFileSync(path.join(n.dir, 'text.txt'), lines.join('\n') + '\n');
      h.git(n.dir, 'add', 'text.txt'); h.git(n.dir, 'commit', '-q', '-m', `v${i}`);
    }
    h.git(n.dir, 'gc', '-q', '--aggressive');
    const kb = (): number => h.git(c.main, 'count-objects', '-v').split('\n')
      .reduce((a, l) => (/^size(-pack)?: /.test(l) ? a + Number(l.split(': ')[1]) : a), 0);
    const before = kb();
    arm();
    const r = childReclaimVerb(h, evalOf(h).token, { pre: 'WS_NESTED_RESCUE_MAX_MB=8;' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(kb() - before, 'KiB the project store grew').toBeLessThanOrEqual(8 * 1024);
  }, 240_000);

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

  it('an IGNORED secret and a MODIFIED tracked secret are declared too', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    fs.writeFileSync(path.join(n.dir, '.gitignore'), '.env.local\n'); h.git(n.dir, 'add', '.gitignore');
    fs.writeFileSync(path.join(n.dir, 'id_rsa'), 'k1\n'); h.git(n.dir, 'add', 'id_rsa'); h.git(n.dir, 'commit', '-q', '-m', 'keys');
    fs.writeFileSync(path.join(n.dir, 'id_rsa'), 'k2\n');
    fs.writeFileSync(path.join(n.dir, '.env.local'), 'TOKEN=x\n');
    arm();
    expect(evalOf(h).verdict).toBe('reclaimable');
    const audit = JSON.parse(h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`)) as { sensitive: string[] };
    expect(audit.sensitive).toContain(`${REL}/.env.local`);
    expect(audit.sensitive).toContain(`${REL}/id_rsa`);
  }, 120_000);

  it('a nested repository with a non-standard .git directory (git-crypt keys) stays containment-unproven', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    fs.mkdirSync(path.join(n.dir, '.git', 'git-crypt', 'keys'), { recursive: true });
    fs.writeFileSync(path.join(n.dir, '.git', 'git-crypt', 'keys', 'default'), 'key\n');
    arm();
    expect(evalOf(h).verdict).toBe('containment-unproven');
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

  it('a dirty SHALLOW nested clone stays containment-unproven under the marker (its fetch can never land)', () => {
    const c = makeChild(h);
    const src = path.join(h.home, 'shallow-src');
    fs.mkdirSync(src, { recursive: true });
    h.git(src, 'init', '-q', '-b', 'main');
    for (const n of [1, 2]) { fs.writeFileSync(path.join(src, `s${n}.txt`), `${n}\n`); h.git(src, 'add', `s${n}.txt`); h.git(src, 'commit', '-q', '-m', `s${n}`); }
    const dir = path.join(c.wt, REL);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    h.git(path.dirname(dir), 'clone', '-q', '--depth', '1', `file://${src}`, path.basename(dir));
    fs.writeFileSync(path.join(dir, 'edit.txt'), 'dirty\n');
    const audit = (): { wouldRescue: string[]; rescue: string[] } => {
      const out = h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
      return (JSON.parse(out) as { nestedRescue?: { wouldRescue: string[]; rescue: string[] } }).nestedRescue ?? { wouldRescue: [], rescue: [] };
    };
    expect(audit().wouldRescue).toEqual([]);   // D-6632: arming would never rescue it, so the shadow list does not name it
    arm();
    expect(evalOf(h).verdict).toBe('containment-unproven');
    expect(audit()).toEqual({ wouldRescue: [], rescue: [] });
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
    expect(h.git(c.main, 'for-each-ref', `refs/ccrc/attic/${CHILD_ID}/`), 'a failed re-prove leaves no claim or partial refs').toBe('');
    childReclaimVerb(h, tok, { pre: 'git() { case "$*" in *" fetch "*) return 0 ;; esac; command git "$@"; };' });
    expect(h.git(c.main, 'for-each-ref', `refs/ccrc/attic/${CHILD_ID}/`), 'a retry does not accumulate again-* bases').toBe('');
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

  it('a failed re-prove unlands only its own refs: a concurrent rescue\'s again-* ref under the same base survives', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    arm();
    const tok = evalOf(h).token;
    const planted = `${base(CHILD_ID)}/again-other/refs/heads/main`;
    const pre = `git() { case "$*" in *fetch.unpackLimit*) command git -C "${c.main}" update-ref "${planted}" HEAD; return 0 ;; esac; command git "$@"; };`;
    const r = childReclaimVerb(h, tok, { pre });
    expect(doc(r)['failed']).toBe('nested-rescue-failed');
    intact(c, n.dir);
    expect(h.git(c.main, 'for-each-ref', '--format=%(refname)', `${base(CHILD_ID)}/`), 'only the other rescue\'s ref remains; our claim is gone').toBe(planted);
  }, 120_000);

  it('a second same-named scratch repository never orphans the first: every earlier tip still resolves', () => {
    const c = makeChild(h);
    const tips: string[] = [];
    for (const parent of ['one', 'two']) {
      const scratch = path.join(h.home, 'scratch-area', parent, 'sandbox');
      fs.mkdirSync(scratch, { recursive: true });
      h.git(scratch, 'init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(scratch, `${parent}.txt`), `${parent}\n`);
      h.git(scratch, 'add', '.'); h.git(scratch, 'commit', '-q', '-m', parent);
      tips.push(h.git(scratch, 'rev-parse', 'HEAD'));
      const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${scratch}"`);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    const named = h.git(c.main, 'for-each-ref', '--format=%(objectname)', `refs/ccrc/attic/${CHILD_ID}/`).split('\n');
    for (const t of tips) expect(named, `tip ${t} is named by an attic ref`).toContain(t);
  }, 90_000);

  it('refuses a directory that is the project\'s own repository', () => {
    const c = makeChild(h);
    const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${c.main}"`);
    expect(r.code).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('nested-rescue-failed');
  }, 60_000);
});

describe('the rescue is total: what a ref listing cannot name keeps the tree (D-6632)', () => {
  it('a commit only a LINKED worktree of the nested repository holds is not lost: containment-unproven, the tree stays', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    const ext = path.join(h.home, 'ext-wt');
    h.git(n.dir, 'worktree', 'add', '-q', '--detach', ext);
    fs.writeFileSync(path.join(ext, 'det.txt'), 'only here\n');
    h.git(ext, 'add', 'det.txt'); h.git(ext, 'commit', '-q', '-m', 'detached work');
    arm();
    const a = evalOf(h);
    expect(a.verdict, 'a nested repository with a linked worktree is not rescuable').toBe('containment-unproven');
    expect(childReclaimVerb(h, a.token).code).not.toBe(0);
    intact(c, n.dir);
    expect(fs.existsSync(path.join(ext, 'det.txt')), 'the external worktree is untouched').toBe(true);
  }, 120_000);

  it('scratch-rescue of a repository with a linked worktree fails the total re-prove instead of claiming a rescue', () => {
    const c = makeChild(h);
    const scratch = path.join(h.home, 'scratch-area', 'sandbox');
    fs.mkdirSync(scratch, { recursive: true });
    h.git(scratch, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(scratch, 'a.txt'), 'a\n');
    h.git(scratch, 'add', 'a.txt'); h.git(scratch, 'commit', '-q', '-m', 'a');
    const ext = path.join(h.home, 'scratch-ext');
    h.git(scratch, 'worktree', 'add', '-q', '--detach', ext);
    fs.writeFileSync(path.join(ext, 'det.txt'), 'only here\n');
    h.git(ext, 'add', 'det.txt'); h.git(ext, 'commit', '-q', '-m', 'detached');
    const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${scratch}"`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('nested-rescue-failed');
    expect(c.main).toBeTruthy();
  }, 90_000);

  it('a nested repository with LFS content stays containment-unproven (git fetch never moves it)', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    fs.mkdirSync(path.join(n.dir, '.git', 'lfs', 'objects'), { recursive: true });
    arm();
    expect(evalOf(h).verdict).toBe('containment-unproven');
    intact(c, n.dir);
  }, 120_000);

  it('a nested repository with annex content stays containment-unproven', () => {
    const c = makeChild(h);
    const n = plantNested(c.wt);
    fs.mkdirSync(path.join(n.dir, '.git', 'annex'), { recursive: true });
    arm();
    expect(evalOf(h).verdict).toBe('containment-unproven');
    intact(c, n.dir);
  }, 120_000);

  it('the size bound defaults to 512 MiB', () => {
    expect(h.sh('echo "$WS_NESTED_RESCUE_MAX_MB"').trim()).toBe('512');
  }, 60_000);
});

describe('the rescue is taken once, and named once (D-6632)', () => {
  it('the settle re-pin of an unchanged tree reuses its own base: no again-* namespace, one record', () => {
    const c = makeChild(h);
    plantNested(c.wt);
    arm();
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const names = h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/nested/`).split('\n');
    expect(names.filter((n) => n.includes('again-')), 'no second copy under again-*').toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  }, 120_000);

  it('two scratch-rescues of same-named repositories started together never orphan each other', () => {
    const c = makeChild(h);
    const tips: string[] = [];
    const dirs: string[] = [];
    for (const parent of ['one', 'two']) {
      const scratch = path.join(h.home, 'scratch-area', parent, 'sandbox');
      fs.mkdirSync(scratch, { recursive: true });
      h.git(scratch, 'init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(scratch, `${parent}.txt`), `${parent}\n`);
      h.git(scratch, 'add', '.'); h.git(scratch, 'commit', '-q', '-m', parent);
      tips.push(h.git(scratch, 'rev-parse', 'HEAD')); dirs.push(scratch);
    }
    h.sh(`( cmd_scratch_rescue --session ${CHILD_ID} "${dirs[0]}" >/dev/null & cmd_scratch_rescue --session ${CHILD_ID} "${dirs[1]}" >/dev/null & wait ) || true`);
    const named = h.git(c.main, 'for-each-ref', '--format=%(objectname)', `refs/ccrc/attic/${CHILD_ID}/`).split('\n');
    for (const t of tips) expect(named, `tip ${t} is named by an attic ref`).toContain(t);
  }, 90_000);
});

describe('wouldRescue names only what arming would clear (D-6632)', () => {
  it('a rescuable repository beside a shallow one: the shadow list is empty, the refusal stays', () => {
    const c = makeChild(h);
    plantNested(c.wt, 'vendor/aaa');
    const src = path.join(h.home, 'shallow-src');
    fs.mkdirSync(src, { recursive: true });
    h.git(src, 'init', '-q', '-b', 'main');
    for (const k of [1, 2]) { fs.writeFileSync(path.join(src, `s${k}.txt`), `${k}\n`); h.git(src, 'add', `s${k}.txt`); h.git(src, 'commit', '-q', '-m', `s${k}`); }
    const sh = path.join(c.wt, 'vendor', 'zzz');
    h.git(path.dirname(sh), 'clone', '-q', '--depth', '1', `file://${src}`, path.basename(sh));
    fs.writeFileSync(path.join(sh, 'edit.txt'), 'dirty\n');
    const out = JSON.parse(h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`)) as
      { nestedRescue?: { wouldRescue: string[] } };
    expect(out.nestedRescue?.wouldRescue ?? []).toEqual([]);
    expect(evalOf(h).verdict).toBe('containment-unproven');
  }, 120_000);

  it('two rescuable repositories: both are named, not only the first refused', () => {
    const c = makeChild(h);
    plantNested(c.wt, 'vendor/aaa');
    plantNested(c.wt, 'vendor/bbb');
    const out = JSON.parse(h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`)) as
      { nestedRescue: { wouldRescue: string[] } };
    expect(out.nestedRescue.wouldRescue).toHaveLength(2);
  }, 120_000);
});

describe('without the marker a later nested checkout never changes the refusal (D-6632)', () => {
  it('a rescuable repository then a same-repository nested checkout holding an index lock: still containment-unproven, not tree-busy', () => {
    const c = makeChild(h);
    plantNested(c.wt, 'vendor/aaa');
    const own = path.join(c.wt, 'vendor', 'zzz');
    h.git(c.main, 'worktree', 'add', '-q', '--detach', own);
    fs.writeFileSync(h.git(own, 'rev-parse', '--path-format=absolute', '--git-path', 'index') + '.lock', '');
    const a = evalOf(h);
    expect(a.verdict, a.detail).toBe('containment-unproven');
    const out = JSON.parse(h.sh(`${CHILD_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`)) as
      { nestedRescue?: { wouldRescue: string[] } };
    expect(out.nestedRescue?.wouldRescue, 'the walk still fills the shadow list').toEqual([path.join(fs.realpathSync(c.wt), 'vendor', 'aaa')]);
  }, 120_000);
});

describe('scratch-rescue asks the rescue shape itself (D-6632)', () => {
  it('a dirty shallow clone is refused with the shape reason, before any WIP is staged', () => {
    makeChild(h);
    const src = path.join(h.home, 'shallow-src2');
    fs.mkdirSync(src, { recursive: true });
    h.git(src, 'init', '-q', '-b', 'main');
    for (const k of [1, 2]) { fs.writeFileSync(path.join(src, `s${k}.txt`), `${k}\n`); h.git(src, 'add', `s${k}.txt`); h.git(src, 'commit', '-q', '-m', `s${k}`); }
    const scratch = path.join(h.home, 'scratch-area', 'sandbox');
    fs.mkdirSync(path.dirname(scratch), { recursive: true });
    h.git(path.dirname(scratch), 'clone', '-q', '--depth', '1', `file://${src}`, path.basename(scratch));
    fs.writeFileSync(path.join(scratch, 'edit.txt'), 'dirty\n');
    const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${scratch}"`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout + r.stderr).toContain('shape a fetch cannot carry');
  }, 90_000);
});

describe('only the nested repository\'s own state decides rescuability (D-6632)', () => {
  it('a global filter.lfs block (git-lfs installed on the box) does not make a plain repository unrescuable', () => {
    const c = makeChild(h);
    plantNested(c.wt);
    fs.writeFileSync(path.join(h.home, '.gitconfig'),
      '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tsmudge = git-lfs smudge -- %f\n\tprocess = git-lfs filter-process\n\trequired = true\n');
    const sys = path.join(h.home, 'sys-gitconfig');
    fs.writeFileSync(sys, '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\trequired = true\n');
    arm();
    const a = evalOf(h, { pre: `export GIT_CONFIG_SYSTEM='${sys}';` });
    expect(a.verdict).toBe('reclaimable');
    expect(a.token).not.toBe('');
  }, 120_000);
});

describe('a nested repository mid-operation keeps its state: it is not rescued (D-6632)', () => {
  const stopRebase = (dir: string): void => {
    h.git(dir, 'checkout', '-q', '-b', 'feat');
    fs.writeFileSync(path.join(dir, 'n1.txt'), 'feat side\n'); h.git(dir, 'commit', '-q', '-am', 'feat');
    h.git(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'n1.txt'), 'main side\n'); h.git(dir, 'commit', '-q', '-am', 'main');
    h.git(dir, 'checkout', '-q', 'feat');
    fs.writeFileSync(path.join(dir, 'n2.txt'), 'staged only in the autostash\n'); h.git(dir, 'add', 'n2.txt');
    try { h.git(dir, 'rebase', '--autostash', 'main'); } catch { /* stops on the conflict, as intended */ }
    expect(fs.existsSync(path.join(dir, '.git', 'rebase-merge')), 'the rebase is stopped').toBe(true);
  };
  const stopAm = (dir: string): void => {
    h.git(dir, 'checkout', '-q', '-b', 'feat');
    fs.writeFileSync(path.join(dir, 'n1.txt'), 'feat side\n'); h.git(dir, 'commit', '-q', '-am', 'feat');
    const patch = path.join(h.home, 'p.patch');
    fs.writeFileSync(patch, h.git(dir, 'format-patch', '--stdout', '-1') + '\n');
    h.git(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'n1.txt'), 'main side\n'); h.git(dir, 'commit', '-q', '-am', 'main');
    try { h.git(dir, 'am', '-3', patch); } catch { /* stops on the conflict */ }
    expect(fs.existsSync(path.join(dir, '.git', 'rebase-apply')), 'the am is stopped').toBe(true);
  };
  for (const [name, stop] of [['an autostash rebase', stopRebase], ['an am stop', stopAm]] as const) {
    it(`${name}: the tree stays and no token is minted`, () => {
      const c = makeChild(h);
      const n = plantNested(c.wt);
      stop(n.dir);
      arm();
      const a = evalOf(h);
      expect(a.verdict).toBe('containment-unproven');
      expect(childReclaimVerb(h, a.token).code).not.toBe(0);
      intact(c, n.dir);
    }, 120_000);

    it(`${name}: scratch-rescue refuses it`, () => {
      makeChild(h);
      const scratch = path.join(h.home, 'scratch-area', 'sandbox');
      fs.mkdirSync(scratch, { recursive: true });
      h.git(scratch, 'init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(scratch, 'n1.txt'), 'base\n'); h.git(scratch, 'add', 'n1.txt'); h.git(scratch, 'commit', '-q', '-m', 'base');
      fs.writeFileSync(path.join(scratch, 'n2.txt'), 'x\n'); h.git(scratch, 'add', 'n2.txt'); h.git(scratch, 'commit', '-q', '-m', 'two');
      stop(scratch);
      const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${scratch}"`);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('nested-rescue-failed');
    }, 90_000);
  }
});

describe('scratch-rescue never claims a rescue a fetch cannot carry (LFS or annex content, D-6632)', () => {
  const scratchRepo = (): string => {
    makeChild(h);
    const scratch = path.join(h.home, 'scratch-area', 'sandbox');
    fs.mkdirSync(scratch, { recursive: true });
    h.git(scratch, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(scratch, 'a.txt'), 'a\n'); h.git(scratch, 'add', 'a.txt'); h.git(scratch, 'commit', '-q', '-m', 'a');
    return scratch;
  };
  const refused = (scratch: string): void => {
    const r = h.run(`cmd_scratch_rescue --session ${CHILD_ID} "${scratch}"`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('nested-rescue-failed');
  };

  it('a repository whose .git/lfs/objects holds content: nested-rescue-failed', () => {
    const scratch = scratchRepo();
    fs.mkdirSync(path.join(scratch, '.git', 'lfs', 'objects', 'ab'), { recursive: true });
    fs.writeFileSync(path.join(scratch, '.git', 'lfs', 'objects', 'ab', 'only-copy'), 'x'.repeat(1024));
    refused(scratch);
  }, 90_000);

  it('a repository with .git/annex: nested-rescue-failed', () => {
    const scratch = scratchRepo();
    fs.mkdirSync(path.join(scratch, '.git', 'annex'), { recursive: true });
    refused(scratch);
  }, 90_000);

  it('a global clean filter that writes into .git/lfs/objects while the WIP is staged: nested-rescue-failed', () => {
    const scratch = scratchRepo();
    const clean = path.join(h.home, 'clean.sh');
    fs.writeFileSync(clean, '#!/bin/sh\nmkdir -p .git/lfs/objects/ab && cat > .git/lfs/objects/ab/only-copy\necho "version pointer"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(h.home, '.gitconfig'), `[filter "lfs"]\n\tclean = ${clean} %f\n`);
    fs.writeFileSync(path.join(scratch, '.gitattributes'), '*.bin filter=lfs\n');
    h.git(scratch, 'add', '.gitattributes'); h.git(scratch, 'commit', '-q', '-m', 'attrs');
    fs.writeFileSync(path.join(scratch, 'big.bin'), 'the only copy\n');
    refused(scratch);
  }, 90_000);
});
