import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD, ghContainedEnv } from './ccdWsHelpers.js';
import { CFG_DIR, GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-audit-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn() { :; };
  tmux() { return 1; }; _alive() { return 1; };`;

interface Built { main: string; wt: string; tip: string; merge: string }

/**
 * A GENUINE SQUASH MERGE WITH A MOVED BASE — the case the whole ladder exists
 * for, and the first thing the definition of done names. main gains an
 * unrelated commit after the branch is cut, then the branch's three commits
 * land on main as one squashed commit. `ancestor` says no; `tree` says no
 * (the base moved); `patch-id` is what passes.
 *
 * `makeGhRepo` is mandatory here: Phase C refuses `no-remote` before the
 * ladder is ever reached against `makeRepo`'s local-path origin, and its
 * `insteadOf` rewrite is what keeps `_ws_reap_eval`'s mandatory
 * `git fetch origin` off the network.
 *
 * `ignore` writes a `.gitignore` INTO THE MERGED WORK — into the branch's
 * commits and into main's squash of them, so both sides carry it and the
 * patch-ids still match. It is a parameter rather than three lines in each
 * caller because the obvious alternative is wrong in a way that hides itself:
 * committing `.gitignore` to the branch AFTER the squash landed adds a commit
 * that is genuinely not in the merge, so the ladder refuses `tree-differs`
 * before any question about ignored content is reached. Measured: the
 * `LISTS non-sensitive ignored content` case failed outright that way, and
 * `changes the token when ANY fingerprinted fact moves` PASSED — vacuously,
 * comparing a 64-hex token against the `undefined` a refusal hands out.
 */
function squashMovedBase(ignore: string[] = []): Built {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2', '3']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`);
    h.git(wt, 'commit', '-m', `work ${n}`);
  }
  if (ignore.length) {
    fs.writeFileSync(path.join(wt, '.gitignore'), `${ignore.join('\n')}\n`);
    h.git(wt, 'add', '.gitignore');
    h.git(wt, 'commit', '-m', 'ignore');
  }
  const tip = h.git(wt, 'rev-parse', 'HEAD');
  // main moves underneath, THEN the squash lands on top of that.
  fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
  h.git(main, 'add', 'other.txt');
  h.git(main, 'commit', '-m', 'unrelated');
  for (const n of ['1', '2', '3']) fs.writeFileSync(path.join(main, `f${n}.txt`), `work ${n}\n`);
  if (ignore.length) fs.writeFileSync(path.join(main, '.gitignore'), `${ignore.join('\n')}\n`);
  h.git(main, 'add', '-A');
  h.git(main, 'commit', '-m', 'squash of the work (#42)');
  const merge = h.git(main, 'rev-parse', 'HEAD');
  h.git(main, 'push', 'origin', 'main');
  h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
  h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  return { main, wt, tip, merge };
}

/**
 * A REBASE MERGE — the fourth rung, and the one no other fixture reaches.
 * main gains an unrelated commit, then the branch's three commits are REPLAYED
 * onto it (`cherry-pick`, i.e. exactly what "Rebase and merge" does) and main
 * ends on the replayed copies. `ancestor` says no (our shas were rewritten);
 * `tree` says no (main carries `other.txt`, our tip does not); `patch-id` says
 * no (`M^1..M` is one commit's worth of diff against our three); `cherry` is
 * what passes, because every one of our commits has a patch-id equivalent in
 * `M`'s history.
 */
function rebaseMerged(): Built {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2', '3']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`); h.git(wt, 'commit', '-m', `work ${n}`);
  }
  const tip = h.git(wt, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
  h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'unrelated');
  // The replay. Same patches, new shas, on a base our tip does not descend
  // from — which is precisely when `cherry` is the only rung left.
  h.git(main, 'cherry-pick', `${tip}~2`, `${tip}~1`, tip);
  const merge = h.git(main, 'rev-parse', 'HEAD');
  h.git(main, 'push', 'origin', 'main');
  h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
  h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  return { main, wt, tip, merge };
}

/** `pre` is sourced BEFORE the verb, which is the only way to fail one specific
 *  git read: every stub in this file shadows a function or a command rather than
 *  patching ccd. */
const audit = (pre = '', id = 'demo-quiet-basin'): Record<string, any> =>
  JSON.parse(h.sh(`${GH_STUB} ${ARCH} ${pre} cmd_ws_audit --session ${id}`));

/**
 * Read EVERY refusal through this. `ws-audit` is read-only, so a verdict that
 * is not `reapable` must leave the worktree on disk — the definition of done
 * names that explicitly ("every negative case asserts the worktree still
 * exists afterwards") and a checklist item is not an executable assertion.
 * It also asserts `token` is absent, because a refusal that still handed out a
 * token would let the very next reap through.
 *
 * The two identity cases that delete the worktree THEMSELVES
 * (`worktree-missing` and the breadcrumb case) call `audit()` directly and say
 * so inline; every other `it` that expects a REFUSAL goes through here — which
 * is why the session id is a parameter: `no-such-session` and
 * `not-a-workspace` are refusals about a DIFFERENT id or a stripped registry,
 * and reaching for `audit()` to say so is exactly how the two of them lost the
 * worktree assertion.
 */
const refusal = (wt: string, pre = '', id = 'demo-quiet-basin'): Record<string, any> => {
  const a = audit(pre, id);
  expect(a.verdict, `expected a refusal, got ${a.verdict}`).not.toBe('reapable');
  expect(a.token, 'a refusal must not hand out a reap token').toBeUndefined();
  expect(fs.existsSync(wt), 'a read-only audit must never remove the worktree').toBe(true);
  return a;
};

describe('the proof ladder', () => {
  it('proves a MULTI-COMMIT SQUASH WITH A MOVED BASE via patch-id', () => {
    // Tree-equality alone holds only when the base did not move between
    // branch point and merge. On a busy repo that is the minority case, and a
    // tree-only design false-refuses almost every real squash — which is
    // exactly what pushes people onto a one-tap unguarded delete.
    squashMovedBase();
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.merge.proof).toBe('patch-id');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('proves a squash whose base did NOT move via tree equality', () => {
    const main = h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'work');
    const tip = h.git(wt, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(main, 'f.txt'), 'work\n');
    h.git(main, 'add', '-A'); h.git(main, 'commit', '-m', 'squash');
    const merge = h.git(main, 'rev-parse', 'HEAD');
    h.git(main, 'push', 'origin', 'main'); h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(audit().merge.proof).toBe('tree');
  });

  it('proves a TRUE merge via ancestor', () => {
    const main = h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'work');
    const tip = h.git(wt, 'rev-parse', 'HEAD');
    h.git(main, 'merge', '--no-ff', '-m', 'Merge PR #42', 'ws/quiet-basin');
    const merge = h.git(main, 'rev-parse', 'HEAD');
    h.git(main, 'push', 'origin', 'main'); h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(audit().merge.proof).toBe('ancestor');
  });

  it('proves a REBASE MERGE via cherry — the rung nothing else reaches', () => {
    // The fourth rung, and the DoD names it. Every earlier rung must fail
    // here: our shas were rewritten (not an ancestor), main carries
    // `other.txt` that our tip does not (tree differs), and `M^1..M` is one
    // replayed commit against our three (patch-ids differ). If this comes back
    // `ancestor`, the fixture fast-forwarded instead of replaying — read the
    // fixture, do not relax the assertion.
    rebaseMerged();
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.merge.proof).toBe('cherry');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('REFUSES the control case: squash plus one genuinely unmerged commit', () => {
    // The entire point. All four rungs must reject this, and the sheet must
    // say so rather than offer an override, because there is none.
    const { wt } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'later.txt'), 'not in the merge\n');
    h.git(wt, 'add', 'later.txt');
    h.git(wt, 'commit', '-m', 'a real follow-up');
    h.git(wt, 'push', 'origin', 'ws/quiet-basin');
    const a = refusal(wt);
    expect(a.verdict).toBe('tree-differs');
    expect(a.detail).toContain('later.txt');
  });

  it('never proves patch-id from two EMPTY patch-ids', () => {
    // `[[ -n "$a" && "$a" == "$b" ]]` — the `-n` half, which a whole-diff
    // mutation sweep found deletable with the suite still green. It is
    // reachable, not defensive: `a` is empty exactly when the tip's tree equals
    // its merge base with `M^1`, and `b` is empty exactly when `M` is an empty
    // commit. Both at once and the mutant `[[ "$a" == "$b" ]]` certifies the
    // branch merged because git computed NOTHING about either side.
    //
    // `_ws_merge_proof` is called directly: this is a shape no `squashMovedBase`
    // variant produces, and the ladder is a pure function of three revisions.
    const main = h.makeRepo('demo');
    h.git(main, 'checkout', '-q', '-b', 'side');
    h.git(main, 'commit', '-q', '--allow-empty', '-m', 'empty on the side');
    const tip = h.git(main, 'rev-parse', 'HEAD');
    h.git(main, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(main, 'other.txt'), 'moved\n');
    h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'unrelated');
    h.git(main, 'commit', '--allow-empty', '-m', 'empty squash');
    const merge = h.git(main, 'rev-parse', 'HEAD');
    // BOTH halves empty — measured here, because if either stops being empty
    // the fixture stops being about this guard at all.
    const patchId = (from: string, to: string): string => h.sh(
      `git -C "${main}" diff --binary "${from}" "${to}" -- | git -C "${main}" patch-id --stable | cut -d' ' -f1`);
    expect(patchId(h.git(main, 'merge-base', tip, `${merge}^1`), tip)).toBe('');
    expect(patchId(`${merge}^1`, merge)).toBe('');
    // The earlier rungs must both say no, or this proves nothing either.
    expect(h.sh(`git -C "${main}" merge-base --is-ancestor -- "${tip}" "${merge}"; echo "rc=$?"`)).toBe('rc=1');
    expect(h.sh(`git -C "${main}" diff --quiet "${merge}" "${tip}" --; echo "rc=$?"`)).toBe('rc=1');
    // `cherry` is what answers instead, and the assertion is on WHICH rung:
    // with the guard deleted this reports `patch-id`.
    expect(h.sh(`_ws_merge_proof "${main}" "${merge}" "${tip}"; echo "rc=$? proof=$_WS_PROOF"`))
      .toBe('rc=0 proof=cherry');
  });

  it('never uses the fail-open `git diff --quiet -- A B` form', () => {
    // Verified in this worktree: `-- A B` exits 0 for ANY two shas (the
    // revisions become pathspecs) while `A B --` exits 1 correctly. A grep is
    // the only assertion that catches the wrong form being reintroduced.
    const src = fs.readFileSync(path.resolve(__dirname, '../../../ccrc-portability/ccd'), 'utf8');
    expect(src).not.toMatch(/diff --quiet\s+--\s+"/);
    expect(src).toContain('diff --quiet "$M" "$tip" --');
  });
});

describe('binding refusals', () => {
  it('refuses when the PR head is not reachable from our tip', () => {
    const { wt } = squashMovedBase();
    h.ghRows([mergedRow({ headRefOid: '0'.repeat(40), mergeCommit: { oid: 'aaaaaaa' } })]);
    const a = refusal(wt);
    expect(a.verdict).toBe('pr-head-not-ours');
    // The DETAIL is what distinguishes this arm from the generic `'!'*` one:
    // both produce the same verdict token, so without this the dedicated arm
    // could be deleted with every assertion above still green.
    expect(a.detail).toContain('not reachable from');
  });

  it('refuses no-bound-pr when the only PR is on ANOTHER branch', () => {
    // "There is no PR for this workspace" and "there is one and it is not
    // ours" are different sentences, and only the second is about a stranger.
    // The `near` filter's head-name conjunct is the only thing keeping them
    // apart: relax it and a merged PR for a different branch of the same repo
    // reports `pr-head-not-ours` about a PR that was never this workspace's.
    const { wt } = squashMovedBase();
    h.ghRows([mergedRow({ headRefName: 'ws/someone-else', headRefOid: '0'.repeat(40) })]);
    expect(refusal(wt).verdict).toBe('no-bound-pr');
  });

  it('refuses a fork PR outright', () => {
    const { wt, tip, merge } = squashMovedBase();
    h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge }, isCrossRepository: true })]);
    expect(refusal(wt).verdict).toBe('no-bound-pr');
  });

  it('refuses when the fetch fails — never a claim about the user commits', () => {
    // The bare repo is the FETCH target too, because makeGhRepo's insteadOf
    // rewrites https://github.com/o/r back to it. Deleting it fails the fetch
    // locally and instantly — no network, and no chance of passing because
    // some unrelated remote 404'd.
    const { wt } = squashMovedBase();
    fs.rmSync(path.join(h.home, 'origins', 'demo.git'), { recursive: true, force: true });
    expect(refusal(wt).verdict).toBe('fetch-failed');
  });
});

describe('local-loss refusals', () => {
  // The `ignore` column goes into the MERGED work, so each row's ONLY reason to
  // refuse is the mutation it makes. `.gitignore` committed after the merge
  // would refuse `tree-differs` first and these rows would pass without ever
  // reaching the guard they name.
  const cases: [string, string[], (wt: string) => void, string][] = [
    ['dirty-tree', [], (wt) => fs.writeFileSync(path.join(wt, 'f1.txt'), 'edited\n'), 'dirty-tree'],
    ['untracked', [], (wt) => fs.writeFileSync(path.join(wt, 'new.txt'), 'new\n'), 'dirty-tree'],
    ['sensitive ignored', ['.env'],
      (wt) => fs.writeFileSync(path.join(wt, '.env'), 'SECRET_API_KEY=1\n'), 'sensitive-ignored'],
  ];

  it.each(cases)('refuses on %s', (_name, ignore, mutate, verdict) => {
    const { wt } = squashMovedBase(ignore);
    mutate(wt);
    // `refusal` carries the worktree-still-exists assertion for every negative
    // case in this file, not just this block.
    expect(refusal(wt).verdict).toBe(verdict);
  });

  it('refuses a tree it could not READ, rather than counting it clean', () => {
    // The two Phase B reads carry the same failure and the same forgery. A
    // `status --porcelain | grep -c .` counts ZERO lines for a worktree nobody
    // could read, and a failed ignored-set read leaves REAP_SENSITIVE empty, so
    // BOTH guards §5.3 forbids overriding pass on a read that never happened.
    // Only `--ignored=matching` is failed here, so `dirty-tree` is not what
    // catches it; a second case fails `status --porcelain` instead. Measured with
    // the plan's own earlier text: both sides recorded ignoredDigest='' and the
    // fingerprints matched, which is the token that authorises the delete.
    const { wt } = squashMovedBase();
    const NOIGN = `git() { [[ "$*" == *"--ignored=matching"* ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOIGN).verdict).toBe('tree-unreadable');
    // The pattern ENDS at `status --porcelain`, so it fails the tree read and
    // neither `worktree list --porcelain` nor `--ignored=matching` (same form the
    // Task 2 test uses).
    const NOSTAT = `git() { [[ "$*" == *"status --porcelain" ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOSTAT).verdict).toBe('tree-unreadable');
  });

  it('refuses a tree it could only PARTLY read — git warns and still exits 0', () => {
    // The exit code is not the whole answer. Measured on git 2.43 with `chmod
    // 000` on an untracked subdirectory holding uncommitted work: `git status
    // --porcelain` exits **0**, prints NOTHING about it, and puts `warning:
    // could not open directory 'sub/'` on stderr — which `2>/dev/null` throws
    // away. So the tree reads pristine, `dirty-tree` passes, and
    // `sensitive-ignored` cannot fire over files it never saw. Both are guards
    // §7 forbids overriding, and a guard that cannot see a directory must
    // refuse rather than report the part it could see.
    //
    // The test is for the DIAGNOSTIC, not for the wording: git translates its
    // warnings and ccd pins no locale, so "the read printed something" is the
    // only form of this check that survives a box with LANG set.
    const { wt } = squashMovedBase();
    const sub = path.join(wt, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'work.txt'), 'uncommitted\n');
    fs.chmodSync(sub, 0o000);
    try {
      // The blindness itself, measured here rather than asserted from memory:
      // this is exactly what the pre-hardening guard saw.
      expect(h.sh(`git -C "${wt}" status --porcelain 2>/dev/null; echo "rc=$?"`),
        'if this stops being rc=0-with-empty-stdout the whole test is moot',
      ).toBe('rc=0');
      expect(refusal(wt).verdict).toBe('tree-unreadable');
      // Phase B's own `status --porcelain` refuses first, so the SAME failure
      // inside `_ws_collect_ignored` is unreachable from the verb — and would
      // survive its hardening being deleted. Pinned at the helper instead.
      expect(h.sh(`${ARCH} _ws_reap_reset; _ws_collect_ignored "${wt}"; echo "rc=$?"`))
        .toBe('rc=1');
      // And the reverse masking, which a mutation sweep caught: the ignored
      // read sees the SAME warning and refuses with the SAME token, so Phase
      // B's own stderr check could be deleted with every case above still
      // green. With the collector stubbed healthy, only that check can answer.
      const OKIGN = '_ws_collect_ignored() { REAP_IGNORED=(); REAP_SENSITIVE=();'
        + ' REAP_IGNDIGEST=stub; return 0; };';
      expect(refusal(wt, OKIGN).verdict).toBe('tree-unreadable');
    } finally {
      // `rmSync` cannot recurse into a 0o000 directory, so without this the
      // harness's own cleanup throws and leaks the entire fixture HOME.
      fs.chmodSync(sub, 0o755);
    }
  });

  it('names the sensitive paths so they can be moved, and offers no override', () => {
    const { wt } = squashMovedBase(['.env', 'id_rsa']);
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=1\n');
    fs.writeFileSync(path.join(wt, 'id_rsa'), 'k\n');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive).toEqual(expect.arrayContaining(['.env', 'id_rsa']));
    expect(a.detail).toContain('.env');
  });

  it('flags a secret-shaped DIRECTORY, which is the entry shape git actually emits', () => {
    // `--ignored=matching` collapses a wholly-ignored directory to ONE entry
    // with a trailing slash — `!! secrets/`, never the files inside it — so
    // the trailing-slash strip is what decides whether a gitignored
    // `secrets/` is a secret or ordinary rubbish queued for deletion. Without
    // `${1%/}` the basename of `secrets/` is the EMPTY STRING and matches
    // nothing. Measured as a mutation survivor, which is how it was found.
    const { wt } = squashMovedBase(['secrets/', 'deploy.pem']);
    fs.mkdirSync(path.join(wt, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'secrets', 'creds'), 'token\n');
    fs.writeFileSync(path.join(wt, 'deploy.pem'), 'KEY\n');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive).toEqual(expect.arrayContaining(['secrets/', 'deploy.pem']));
  });

  it('reads the path git C-QUOTES — a space in a secret’s name is not an override', () => {
    // Measured on git 2.43: `git status --porcelain --ignored=matching` C-quotes
    // any path holding a space, a non-ASCII byte, a quote, a backslash or a
    // control character — `!! "deploy key.pem"`, `!! "s\303\251crets/"` — while
    // leaving `!! .env` alone. Every SUFFIX pattern in `_ws_sensitive_match`
    // then dies on the trailing `"` and every PREFIX pattern on the leading
    // one, so a gitignored private key called `deploy key.pem` came back
    // `verdict=reapable` with a token, `sensitive:false` and `bytes:0` — the
    // quoted string is also what was handed to the size read, and it names
    // nothing on disk. `My Project.env`, `prod db.sqlite` and `ssh key.pem` are
    // the same hole in the one guard §7 says has no override.
    //
    // `-z` is what closes it, and `core.quotePath=false` is NOT: measured, that
    // config unquotes the non-ASCII directory and STILL quotes the space.
    const { wt } = squashMovedBase(['deploy key.pem', 'sécrets/']);
    fs.writeFileSync(path.join(wt, 'deploy key.pem'), 'PRIVATE KEY\n'.repeat(64));
    fs.mkdirSync(path.join(wt, 'sécrets'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'sécrets', 'blob'), 'x'.repeat(4096));
    // The quoting itself, measured here rather than asserted from memory: if
    // git ever stops doing this the test below stops meaning anything.
    expect(h.sh(`git -C "${wt}" status --porcelain --ignored=matching | grep -c '^!! "'`),
      'if git stops C-quoting these two paths the whole test is moot').toBe('2');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive).toEqual(['deploy key.pem']);
    expect(a.detail).toContain('deploy key.pem');
    const byPath: Record<string, { bytes: number; sensitive: boolean }> =
      Object.fromEntries(a.ignored.map((e: { path: string }) => [e.path, e]));
    // The human reads a filename; `"s\303\251crets/"` is not one. And the ORDER
    // is the sensitive-first half of the sort, which nothing else could pin: it
    // is only observable when a sensitive entry and a BIGGER ordinary one are
    // in the same manifest, and that happens exactly here, in the manifest
    // printed beside a `sensitive-ignored` refusal. On bytes alone `sécrets/`
    // would come first.
    expect(a.ignored.map((e: { path: string }) => e.path))
      .toEqual(['deploy key.pem', 'sécrets/']);
    expect(byPath['deploy key.pem']!.sensitive).toBe(true);
    // And the bytes, for BOTH — the quoted path measured nothing on disk, so
    // `ignoredBytes` under-reported precisely the entries that matter. A plain
    // FILE has to size too: `_ws_gc_bytes` answers `-` for anything that is not
    // a directory, which made every ignored file 0 bytes on its own.
    expect(byPath['deploy key.pem']!.bytes).toBe(768);
    expect(byPath['sécrets/']!.sensitive).toBe(false);
    expect(byPath['sécrets/']!.bytes).toBeGreaterThan(4000);
    expect(a.ignoredCount).toBe(2);
    expect(a.ignoredBytes).toBeGreaterThan(4700);
  });

  it('survives a TAB and a NEWLINE inside an ignored path', () => {
    // What `-z` gives with one hand it takes with the other: git's C-quoting was
    // accidentally CONTAINING these two bytes, and unquoted they land in an
    // array whose records used to be `path\tbytes\tsensitive` read
    // left-to-right. Measured with the naive record: a file called `a<TAB>b.log`
    // shifts every field and `cmd_ws_audit` printed `"bytes":b.log` — not JSON
    // at all, so `JSON.parse` in `audit()` is the assertion. A newline breaks
    // the line-oriented `printf '%s\n' | sort` the same way. Hence
    // `sensitive\tbytes\tpath`: the two fixed-shape fields first, the free-form
    // one last, NUL-terminated through `sort -z`.
    const { wt } = squashMovedBase(['*.log']);
    fs.writeFileSync(path.join(wt, 'a\tb.log'), 'x'.repeat(4096));
    fs.writeFileSync(path.join(wt, 'c\nd.log'), 'x');
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.ignored.map((e: { path: string }) => e.path)).toEqual(['a\tb.log', 'c\nd.log']);
    expect(a.ignored[0].bytes).toBe(4096);
    expect(a.ignored[1].bytes).toBe(1);
    expect(a.ignoredCount).toBe(2);
    expect(a.ignoredBytes).toBe(4097);
  });

  it('matches EVERY pattern in the secret-shaped list, and nothing beside them', () => {
    // One `it` per shape would be twelve fixtures; one fixture with twelve
    // files is the same coverage. Written because a whole-diff mutation sweep
    // could delete `*.key`, `*.p12`, `*.sqlite*`, `*.db` and `credentials*`
    // from the case statement with the suite still green: the list is small,
    // permanent and has no override, so every arm of it is load-bearing and
    // none of it may rot silently. The NEGATIVES are half the test — a list
    // that matched everything would refuse every workspace and the pressure
    // would land on a repo-wide opt-out.
    const secret = ['.env.local', 'deploy.pem', 'api.key', 'cert.p12', 'id_ed25519',
      'vault.kdbx', 'credentials.json', 'app.sqlite3', 'cache.db', 'pg.dump',
      'schema.sql', 'secrets.tar'];
    const ordinary = ['notes.md', 'env.sample', 'myid_rsa', 'database.dbx'];
    const { wt } = squashMovedBase([...secret, ...ordinary]);
    for (const n of [...secret, ...ordinary]) fs.writeFileSync(path.join(wt, n), 'x\n');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect([...a.sensitive].sort()).toEqual([...secret].sort());
    // The ordinary four are still LISTED and still destroyed on confirm — they
    // are simply not what refuses.
    expect(a.ignoredCount).toBe(secret.length + ordinary.length);
  });

  it('LISTS non-sensitive ignored content with sizes instead of refusing on it', () => {
    // node_modules/, dist/ and .ccrc/ are named, sized and destroyed on
    // confirm. Refusing on all ignored content would make the gate unpassable
    // within minutes of ws-add and push the escape hatch into a config file.
    const { wt } = squashMovedBase(['node_modules/', 'dist/']);
    fs.mkdirSync(path.join(wt, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'node_modules', 'x', 'big'), 'x'.repeat(4096));
    fs.mkdirSync(path.join(wt, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'small'), 'x');
    const a = audit();
    expect(a.verdict).toBe('reapable');
    // Bytes DESCENDING, and two entries is the smallest fixture that can tell
    // a sort from a coincidence: with one entry the ordering is unobservable.
    expect(a.ignored.map((e: { path: string }) => e.path)).toEqual(['node_modules/', 'dist/']);
    // The per-entry size, not just the total — they are two different lines.
    expect(a.ignored[0].bytes).toBeGreaterThan(4000);
    expect(a.ignored[0].sensitive).toBe(false);
    expect(a.ignoredCount).toBe(2);
    expect(a.ignoredBytes).toBeGreaterThan(4000);
  });

  it('refuses stashes and unpushed commits', () => {
    const { wt } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'wip\n');
    h.sh(`cd "${wt}" && git stash push -q -m wip`);
    const a = refusal(wt);
    expect(a.verdict).toBe('stashes-present');
    // The count is on the wire as well as in the refusal: a manifest that said
    // `stashes: 0` beside `verdict: stashes-present` would be two answers.
    expect(a.stashes).toBe(1);
    expect(a.detail).toContain('1 stash entry');
    h.sh(`cd "${wt}" && git stash drop -q`);
    fs.writeFileSync(path.join(wt, 'z.txt'), 'unpushed\n');
    h.git(wt, 'add', 'z.txt'); h.git(wt, 'commit', '-m', 'unpushed');
    expect(refusal(wt).verdict).toBe('unpushed-commits');
  });

  it('refuses a stash read that failed SILENTLY, instead of fingerprinting its 0', () => {
    // The third instance of the token-forgery class, and the one no status
    // check and no stderr check can reach. `_ws_stash_count` answers 0 for
    // every failure BY DESIGN — its `2>/dev/null` and its `|| true` are Task
    // 2's and Task 4 consumes it — and measured on git 2.43, with
    // `.git/logs/refs/stash` unreadable OR simply deleted while `refs/stash`
    // still resolves, `git stash list` returns rc 0, EMPTY stdout and EMPTY
    // stderr. The failure is deterministic, so ws-reap recomputes the same 0
    // and the `--expect` consent check matches: a deletion authorised over
    // stashes nobody counted. Same shape as deviation 6's digest forgery, in
    // the `stashCount` field.
    const { wt, main } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'wip\n');
    h.sh(`cd "${wt}" && git stash push -q -m wip`);
    // `refs/stash` is a COMMON ref, so a stash pushed from a linked worktree
    // has its reflog in $main. If that stops being true, fix the fixture.
    const reflog = path.join(main, '.git', 'logs', 'refs', 'stash');
    expect(fs.existsSync(reflog), 'the stash reflog must be $main’s').toBe(true);

    fs.chmodSync(reflog, 0o000);
    // The blindness itself, measured here rather than asserted from memory.
    expect(h.sh(`git -C "${main}" stash list 2>&1; echo "rc=$?"`),
      'if this stops being rc=0-with-empty-output the whole test is moot').toBe('rc=0');
    expect(refusal(wt).verdict).toBe('stash-unreadable');
    fs.chmodSync(reflog, 0o644);
    // The honest baseline the two failures are indistinguishable from without
    // the guard: the SAME fixture, read successfully.
    expect(refusal(wt).verdict).toBe('stashes-present');

    fs.rmSync(reflog);
    expect(h.sh(`git -C "${main}" stash list 2>&1; echo "rc=$?"`)).toBe('rc=0');
    expect(refusal(wt).verdict).toBe('stash-unreadable');

    // THE INVARIANT the guard turns on, measured rather than assumed:
    // `refs/stash` exists if and only if at least one entry does — git creates
    // the ref on the first push and deletes it when the last entry goes,
    // whether by pop, drop or clear.
    expect(h.sh(`git -C "${main}" rev-parse --verify --quiet refs/stash >/dev/null; echo "rc=$?"`))
      .toBe('rc=0');
    h.sh(`git -C "${main}" stash clear`);
    expect(h.sh(`git -C "${main}" rev-parse --verify --quiet refs/stash >/dev/null; echo "rc=$?"`))
      .toBe('rc=1');
    expect(audit().verdict).toBe('reapable');
  });

  it('refuses when `git stash list` fails outright — it reports that as 0 too', () => {
    const { wt } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'wip\n');
    h.sh(`cd "${wt}" && git stash push -q -m wip`);
    const NOSTASH = `git() { [[ "$*" == *"stash list"* ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOSTASH).verdict).toBe('stash-unreadable');
  });

  it('does NOT read a stash on another branch as an unreadable one', () => {
    // `refs/stash` resolving means at least one entry exists SOMEWHERE, never
    // that this branch has one — measured, a stash pushed from $main's own
    // checkout leaves `_ws_stash_count "$main" ws/quiet-basin` at a legitimate
    // 0. Reading the ref's mere existence as the refusal would make every
    // workspace in a repo whose main holds one stash permanently un-reapable,
    // with no override — which is why the corroboration is on the WHOLE list
    // and the branch-scoped count stays `_ws_stash_count`'s.
    const { wt, main } = squashMovedBase();
    fs.writeFileSync(path.join(main, 'other.txt'), 'wip on main\n');
    h.sh(`cd "${main}" && git stash push -q -m 'main wip'`);
    expect(h.sh(`git -C "${main}" rev-parse --verify --quiet refs/stash >/dev/null; echo "rc=$?"`),
      'the fixture must actually leave refs/stash resolving').toBe('rc=0');
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.stashes).toBe(0);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(wt)).toBe(true);
  });
});

describe('identity refusals', () => {
  it('refuses a workspace that was never archived — archive IS the staging', () => {
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    expect(refusal(path.join(h.home, 'worktrees', 'demo', 'quiet-basin')).verdict).toBe('not-archived');
  });

  it('refuses a detached HEAD as GIT records it — empty name, exit 0', () => {
    // `_ws_wt_branch`'s middle rung. Verified against git 2.43 in a scratch
    // repo: after `git checkout --detach` inside a linked worktree,
    // `git -C "$main" worktree list --porcelain` prints a bare `detached` line
    // for that path — so $main can see this without asking the directory, and
    // the helper answers empty-with-exit-0, which is NOT the same as exit 1.
    // The next two tests are the other two rungs.
    const { wt } = squashMovedBase();
    h.sh(`cd "${wt}" && git checkout -q --detach`);
    expect(refusal(wt).verdict).toBe('detached-head');
  });

  it('refuses when git’s record and the registry name different branches, printing both', () => {
    // Verified against git 2.43: `git checkout -b feat/x` inside a linked
    // worktree rewrites `$GIT_DIR/worktrees/<slug>/HEAD`, so `worktree list
    // --porcelain` read from $main reports `branch refs/heads/feat/x`. The
    // divergence this refuses is therefore between two RECORDS — ccrc's
    // registry and git's registration — and both names go in the detail,
    // because the remedy is to reconcile them and neither one is guessable
    // from the other.
    const { wt, tip } = squashMovedBase();
    h.sh(`cd "${wt}" && git checkout -q -b feat/x`);
    const a = refusal(wt);
    expect(a.verdict).toBe('registry-branch-drift');
    expect(a.detail).toContain('ws/quiet-basin');
    expect(a.detail).toContain('feat/x');
    // The corroboration is on the wire too, and it is FALSE here — the field
    // exists so a reader can see the disagreement without parsing a sentence.
    expect(a.headMatchesRegistry).toBe(false);
    expect(tip).toMatch(/^[0-9a-f]{40}$/);
  });

  it('asks $main for the branch, so a stray git init cannot speak for us', () => {
    // THE case the unified read exists for, and it is written so it can fail:
    // with `rev-parse --abbrev-ref HEAD` inside the directory — the form the
    // spec's A6/A7 spell and an earlier draft of this plan used — this comes
    // back as a DRIFT refusal printing `attacker/main`, a stranger's branch
    // name, in our refusal, decided by a repository that is not $main. With
    // `_ws_wt_branch` the name cannot come from there at all, the drift rung
    // passes on $main's own record, and what refuses is the guard that is
    // actually about the directory.
    //
    // Measured on git 2.43: the stranger needs a COMMIT. On an unborn branch
    // `rev-parse --abbrev-ref HEAD` prints the literal `HEAD` and the fixture
    // would prove nothing about names. Also measured: $main's record for the
    // path stays and is NOT marked `prunable`, because the record's gitdir file
    // now points at the stranger's own `.git` — which is exactly why
    // `registered` cannot decide the foreign-worktree question by itself.
    const { wt, main } = squashMovedBase();
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.git(wt, 'init', '-q', '-b', 'attacker/main');
    fs.writeFileSync(path.join(wt, 'theirs.txt'), 'not ours\n');
    h.git(wt, 'add', 'theirs.txt');
    h.git(wt, 'commit', '-m', 'stranger');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'),
      'the fixture must actually present a different branch name to the directory read',
    ).toBe('attacker/main');
    const a = refusal(wt);
    expect(a.verdict).toBe('foreign-worktree');
    expect(a.detail, 'no stranger’s branch name may appear in our refusal').not.toContain('attacker/');
    // $main's record still names OUR branch — which is the only reason the
    // drift rung passed, and is the whole claim of the unified read.
    expect(h.git(main, 'worktree', 'list', '--porcelain')).toContain('branch refs/heads/ws/quiet-basin');
  });

  it('treats an unanswerable common-dir as NO answer, never as a match', () => {
    // The `-n "$common" && -n "$mainreal"` halves, which a whole-diff mutation
    // sweep found deletable with the suite still green — and they are the two
    // that decide an IRREVERSIBLE step: with both lookups failing, the mutant
    // `[[ "$common" == "$mainreal" ]]` compares "" against "" and waves a
    // stranger's directory straight into Phase B, which reads it for
    // `dirty-tree` and `sensitive-ignored`, and at Task 6 into
    // `git worktree remove`. `_ws_common_dir`'s own contract is that empty is no
    // answer; this is the call site honouring it.
    const { wt } = squashMovedBase();
    const a = refusal(wt, '_ws_common_dir() { return 1; };');
    expect(a.verdict).toBe('foreign-worktree');
    // Both sides named, and neither invented: the refusal says what it could
    // not read rather than printing an empty path.
    expect(a.detail).toContain('no repository');
  });

  it('refuses no-worktree-record when git’s registration was removed by hand', () => {
    // `_ws_wt_branch`'s exit-1 rung: $main holds no evidence at all about this
    // path. Measured on git 2.43: deleting `$main/.git/worktrees/<slug>` leaves
    // the directory and `refs/heads/ws/quiet-basin` both intact while every
    // read of the directory fails with `not a git repository` — so the OLD
    // `rev-parse` form answered nothing here and the refusal said
    // `detached-head` about a HEAD it never saw. "No record" and "detached" are
    // different states with different remedies and must not share a token.
    const { wt, main } = squashMovedBase();
    const admin = path.join(main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin),
      'git names the admin directory after the worktree basename — if that changed, fix the fixture',
    ).toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    expect(refusal(wt).verdict).toBe('no-worktree-record');
    // Nothing was deleted for want of a record — the branch is still here, and
    // `refusal` already asserted the worktree is.
    expect(h.git(main, 'show-ref', '--verify', 'refs/heads/ws/quiet-basin')).toContain('ws/quiet-basin');
  });

  it('reports the breadcrumb explicitly rather than "0 files" when one exists', () => {
    // Retry after a killed reap used to certify an empty workspace as clean.
    // NOT read through `refusal`: this test removes the worktree ITSELF, so
    // asserting it still exists would assert the opposite of the fixture.
    const { wt, main } = squashMovedBase();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.rmSync(wt, { recursive: true, force: true });
    const a = audit();
    expect(a.reaping).toBe('worktree');
    expect(a.exists).toBe(false);
    expect(a.token).toBeUndefined();
    // And NOT `reapable`. A tokenless `reapable` is a wire shape the sheet
    // mis-renders: `wsaudit.ts` gives `reapable` an EMPTY sentence and
    // `ReapSheet` renders the primary Remove button on it, whose `confirm()`
    // early-returns when `token === undefined` — a button that silently does
    // nothing, under no explanation. It is a different STATE, so it gets a
    // different verdict: the proof holds, the worktree is already gone, and
    // ccrc's own breadcrumb says ccrc removed it, so what remains is a resume
    // and a resume carries no token.
    expect(a.verdict).toBe('reap-interrupted');
    expect(a.detail).toContain('worktree');
    // `refusal`'s worktree assertion cannot be used here — the fixture removed
    // the worktree itself — so the read-only claim is asserted inline: the
    // audit neither re-creates it nor takes the branch with it.
    expect(fs.existsSync(wt)).toBe(false);
    expect(h.git(main, 'show-ref', '--verify', 'refs/heads/ws/quiet-basin'))
      .toContain('ws/quiet-basin');
  });

  it('refuses worktree-missing when there is NO breadcrumb to explain it', () => {
    // Also not read through `refusal`, and for the same reason: the fixture
    // deleted the worktree on purpose.
    const { wt, main } = squashMovedBase();
    fs.rmSync(wt, { recursive: true, force: true });
    const a = audit();
    expect(a.verdict).toBe('worktree-missing');
    expect(a.token).toBeUndefined();
    // The half of `refusal` that still applies, inline: the branch and its
    // commits are what the user has left, and a read-only verb does not touch
    // them.
    expect(h.git(main, 'show-ref', '--verify', 'refs/heads/ws/quiet-basin'))
      .toContain('ws/quiet-basin');
  });
});

/**
 * The plan's own cases leave eleven refusals and the whole fingerprint
 * unpinned: their lines can be deleted with the suite still green, and two of
 * them (`session-busy`, `status-unknown`) are the §5.3 idle gate, evaluated on
 * the box at the instant of deletion. Whole-diff mutation sweeping is what
 * found them; this block is the answer.
 */
describe('the refusals the ladder reaches last', () => {
  it('refuses a session the wrapper says is BUSY, and one it cannot read', () => {
    // `_ws_status` is an ALLOWLIST — `idle` is the only idle (deviation 6) —
    // and both of its answers gate `git worktree remove`. Shadowed as a
    // function, so the polarity of the gate is what is under test, not the
    // status file's format.
    const { wt } = squashMovedBase();
    expect(refusal(wt, '_ws_status() { echo busy; };').verdict).toBe('session-busy');
    expect(refusal(wt, '_ws_status() { return 1; };').verdict).toBe('status-unknown');
  });

  it('refuses a branch with no upstream — never pushed is never proven', () => {
    const { wt, main } = squashMovedBase();
    h.git(main, 'branch', '--unset-upstream', 'ws/quiet-basin');
    expect(refusal(wt).verdict).toBe('no-upstream');
  });

  it('refuses a bound PR that is not merged', () => {
    const { wt, tip } = squashMovedBase();
    h.ghRows([mergedRow({ headRefOid: tip, state: 'OPEN', mergedAt: null, mergeCommit: null })]);
    expect(refusal(wt).verdict).toBe('not-merged');
  });

  it('refuses when the merge commit gh named is not in the object store', () => {
    // The row binds and its shape is a merge, so `pick` hands it over; the
    // commit simply is not here after a fetch. Distinct from `fetch-failed`:
    // the fetch worked and GitHub's answer is still unverifiable.
    const { wt, tip } = squashMovedBase();
    h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: 'a'.repeat(40) } })]);
    expect(refusal(wt).verdict).toBe('merge-commit-missing');
  });

  it('re-anchors the oids AFTER the TSV split, so a tab in a url shifts nothing', () => {
    // §7: no GitHub-sourced string is ever placed in an argv, and the plan
    // calls that boundary "not a formality". `_pr_py pick` anchors
    // `mergeCommit.oid` and `headRefOid` with `OID` (`^[0-9a-f]{7,40}$`,
    // ccd:292) but NOT `url` or `number`, and hands all four back joined with
    // tabs — so a `url` holding a TAB shifts the fields and `REAP_MERGE`
    // becomes whatever followed it. Measured: with `url: 'https://x/\tinjected'`
    // the string `injected` reached `git cat-file -e "injected^{commit}"`,
    // `git merge-base --is-ancestor -- "$tip" "injected"` and
    // `git diff --stat "injected" …`. It failed CLOSED (`merge-commit-missing`,
    // exit 0, valid JSON), which is luck rather than construction — a floor of
    // 7 anchored at both ends is what makes it construction. Same regex as
    // python's, restated on this side of the split because the split is what
    // can move a value from one field to another.
    const { wt, tip, merge } = squashMovedBase();
    h.ghRows([mergedRow({
      headRefOid: tip, mergeCommit: { oid: merge }, url: 'https://x/\tinjected',
    })]);
    const a = refusal(wt);
    expect(a.verdict).toBe('pr-fields-malformed');
    expect(a.detail).toContain('injected');
  });

  it('refuses when gh itself could not be read, naming the classified reason', () => {
    const { wt } = squashMovedBase();
    h.ghFail(124, 'timed out');
    const a = refusal(wt);
    expect(a.verdict).toBe('gh-unreadable');
    expect(a.detail).toContain('timeout');
  });

  it('refuses a project with no origin remote', () => {
    const { wt, main } = squashMovedBase();
    h.git(main, 'config', '--unset', 'remote.origin.url');
    expect(refusal(wt).verdict).toBe('no-remote');
  });

  it('refuses a session it has never heard of, and a main checkout', () => {
    // Through `refusal` like every other negative case: these two are Phase A's
    // FIRST two rungs, so they refuse before any git call, and a bare `audit()`
    // here asserted neither that the worktree survived nor that no token came
    // back — which is what the definition of done's "a fifth hit is a test that
    // lost the assertion" is about.
    const { wt } = squashMovedBase();
    expect(refusal(wt, '', 'no-such-thing').verdict).toBe('no-such-session');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.workspace'));
    expect(refusal(wt).verdict).toBe('not-a-workspace');
  });

  it('refuses a half-written registry rather than proceeding on part of it', () => {
    const { wt } = squashMovedBase();
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.branch'));
    const a = refusal(wt);
    expect(a.verdict).toBe('incomplete-registry');
    expect(a.detail).toContain("branch=''");
  });

  it('refuses a base that did not resolve, rather than fingerprinting ""', () => {
    // The last fingerprint input that answered a failed read with a DEFAULT.
    // `REAP_BASEOID=$(… rev-parse --verify "$base") || REAP_BASEOID=""` was
    // plan-verbatim, and measured: with that one read failing the verdict
    // stayed `reapable` and a token was issued over a field nobody measured.
    // ws-reap then recomputes the same "" and `--expect` matches — the same
    // forgery as the ignored digest and the stash count, in `baseOid`.
    const { wt } = squashMovedBase();
    expect(h.reg('demo-quiet-basin', 'base'),
      'the stub below is keyed on the recorded base').toBe('origin/main');
    // ONLY this read. `_ws_reap_eval`'s other two rev-parses carry `--quiet`
    // (`@{upstream}`) or a `refs/heads/` operand, and `cmd_ws_audit`'s own
    // `commitsAheadOfBase` read of the same ref carries `--quiet` as well, so
    // the manifest around the refusal is still built from live reads.
    const NOBASE = `git() { [[ "$*" == *"rev-parse --verify origin/main" ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOBASE).verdict).toBe('base-missing');
  });

  it('propagates a digest that could not be computed, not an empty one', () => {
    // `_ws_collect_ignored` checks its enumeration AND its digest, and the two
    // are separately load-bearing — but the enumeration's own guard catches
    // every fixture that fails the shared `git status`, so the digest's
    // `|| return 1` survives being deleted. `sha256sum` is what fails ONLY the
    // digest: `_ws_ignored_digest` reads git's status through PIPESTATUS[0],
    // which is still 0, and refuses on its own `^[0-9a-f]{64}$` rung instead.
    // An empty digest here is the exact forgery deviation 6 closed — it hashes
    // identically on the reap side, so the consent check matches.
    const { wt } = squashMovedBase();
    expect(refusal(wt, 'sha256sum() { return 1; };').verdict).toBe('tree-unreadable');
  });

  it('judges sensitivity on the BASENAME, not on the whole ignored path', () => {
    // `--ignored=matching` collapses a wholly-ignored directory to one entry,
    // but names the FILE when its directory also holds tracked content — so
    // `sub/.env` is a real entry shape, and `${b##*/}` is what makes it match
    // `.env*`. Without the strip it matches nothing and a secret is listed as
    // ordinary rubbish for deletion.
    const { wt } = squashMovedBase(['sub/.env']);
    fs.mkdirSync(path.join(wt, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'sub', '.env'), 'SECRET=1\n');
    fs.writeFileSync(path.join(wt, 'sub', 'kept.txt'), 'tracked\n');
    h.git(wt, 'add', 'sub/kept.txt'); h.git(wt, 'commit', '-m', 'tracked neighbour');
    h.git(wt, 'push', 'origin', 'ws/quiet-basin');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive).toContain('sub/.env');
  });
});

describe('the dispatcher', () => {
  const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
    const opts = {
      encoding: 'utf8' as const, cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }),
    };
    try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
    }
  };

  it('routes ws-audit to cmd_ws_audit, with argv shifted', () => {
    // Every other test in this file sources ccd and calls the function, so the
    // arm and the `shift` are invisible to all of them. A session id the regex
    // refuses answers before any registry, git or gh call: a missing arm prints
    // the `*)` usage line instead, and an arm without its `shift` hands
    // cmd_ws_audit three tokens and prints ITS usage line.
    const r = runCcd('ws-audit', '--session', '../../etc/passwd');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('bad session id');
  });

  it('asserts its argv exactly — fixed arity, no getopt loop', () => {
    // A ninth verb that silently ignored a trailing token would answer a
    // question the caller did not ask. Both directions, because `-eq 2` is one
    // mutation away from `-ge 1`.
    expect(runCcd('ws-audit').stderr).toContain('usage: ccd ws-audit --session <id>');
    expect(runCcd('ws-audit', '--session', 'a', 'extra').stderr)
      .toContain('usage: ccd ws-audit --session <id>');
    expect(runCcd('ws-audit', '--sess', 'a').stderr)
      .toContain('usage: ccd ws-audit --session <id>');
  });

  it('names ws-audit in the usage line an unknown verb prints', () => {
    expect(runCcd('no-such-verb').stderr).toContain('ws-audit');
  });

  it('advertises ws-audit in caps — the agent refuses what caps omits', () => {
    // ~/.local/bin/ccd is a COPY, so the server asks the agent what this box
    // implements and never emits a verb caps did not name.
    expect(runCcd('caps').stdout.split('\n')).toContain('ws-audit');
  });
});

describe('the manifest', () => {
  it('fingerprints twelve DISTINCT facts, and nothing else', () => {
    // The token is what `ws-reap --expect` re-proves against at the instant of
    // deletion, so every field has to be in it and no two fields may be
    // interchangeable. Moving one fact at a time through the helper is the only
    // way to say that: the behavioural token test can only move the one fact a
    // fixture can move without changing the verdict.
    const facts = ['id', 'branch', 'tip', 'head', 'merge', 'proof',
      '0', 'igndigest', 'sensdigest', '0', 'wthead', 'baseoid'];
    const call = (a: string[]): string => h.sh(`_ws_fingerprint ${a.map((x) => `'${x}'`).join(' ')}`);
    const first = call(facts);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(call(facts), 'same twelve facts, same token').toBe(first);
    const seen = new Map<string, number>([[first, -1]]);
    facts.forEach((_v, i) => {
      const moved = [...facts];
      moved[i] = `${moved[i]}-moved`;
      const t = call(moved);
      expect(t, `argument ${i + 1} is not fingerprinted at all`).not.toBe(first);
      expect(seen.has(t), `argument ${i + 1} collides with argument ${(seen.get(t) ?? 0) + 1}`).toBe(false);
      seen.set(t, i);
    });
  });

  it('the token IS the fingerprint of the facts it reports', () => {
    // `changes the token when ANY fingerprinted fact moves` can only move the
    // ONE fact a fixture can move without changing the verdict, and
    // `fingerprints twelve DISTINCT facts` exercises the helper in isolation.
    // Neither says the verb feeds it the right twelve. Measured as five
    // mutation survivors: the proof argument, `baseOid`, the sensitive digest
    // and its `sort`, and `headRefOid` — every one of them could be replaced
    // by a constant with the whole file still green, because nothing ever
    // asserted what the token IS.
    const { main, wt, tip, merge } = squashMovedBase(['node_modules/']);
    fs.mkdirSync(path.join(wt, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'node_modules', 'big'), 'x'.repeat(2048));
    const a = audit();
    expect(a.verdict).toBe('reapable');
    // Every fact read independently of the verb: from git, from the helper
    // Task 2 owns, and from the wire the verb itself published.
    const igndigest = h.sh(`_ws_ignored_digest "${wt}"`);
    const baseOid = h.git(main, 'rev-parse', '--verify', 'origin/main');
    // The empty-set sensitive digest. It is a CONSTANT in every state that
    // reaches a token, because a non-empty set is `sensitive-ignored` and
    // refuses — which is why its `sort` cannot be pinned behaviourally.
    const sensdigest = h.sh(`printf '%s\\n' "" | sort | sha256sum | cut -d' ' -f1`);
    const args = ['demo-quiet-basin', 'ws/quiet-basin', tip, tip, merge, 'patch-id',
      '0', igndigest, sensdigest, '0', 'ws/quiet-basin', baseOid];
    expect(a.token).toBe(h.sh(`_ws_fingerprint ${args.map((x) => `'${x}'`).join(' ')}`));
    // and the wire says the same things the token was built from.
    expect(a.pr.headRefOid).toBe(tip);
    expect(a.pr.mergeCommit).toBe(merge);
    expect(a.merge.proof).toBe('patch-id');
  });

  it('carries the transcript path, the stash count and the worktree size', () => {
    squashMovedBase();
    const a = audit();
    expect(a.headMatchesRegistry).toBe(true);
    expect(a.exists).toBe(true);
    expect(a.reaping).toBeNull();
    // `timeout` is shadowed by GH_STUB and logs its own argv, because the
    // wrapper is the only bound on a blocking fetch and a stub that swallowed
    // it would let ccd drop `timeout` with the suite still green.
    expect(h.ghCalls().some((c) => /^timeout 60 git .* fetch --quiet origin$/.test(c)),
      `no bounded fetch in ${JSON.stringify(h.ghCalls())}`).toBe(true);
    // `_cfg_dir` maps the wrapper `_ws_least_loaded` picked to its config dir
    // (claude -> ~/.claude, claude2 -> ~/.claude-personal, …), so the assertion
    // is derived, never hardcoded to `.claude`.
    expect(a.transcript).toContain(`${CFG_DIR[h.reg('demo-quiet-basin', 'wrapper')!]}/projects/`);
    expect(a.stashes).toBe(0);
    expect(a.worktreeBytes).toBeGreaterThan(0);
    expect(a.commitsAheadOfBase).toBe(3);
    expect(a.pr.number).toBe(42);
  });

  it('changes the token when ANY fingerprinted fact moves', () => {
    // BOTH halves, and the first one is what makes the second mean anything.
    // `ws-reap --expect <token>` re-proves against this string at the instant
    // of deletion, so a token that drifted on its own would refuse every honest
    // confirmation, and a token that did not move would authorise a delete over
    // facts the human was never shown. `.gitignore` is part of the MERGED work
    // here (see `squashMovedBase`): committing it afterwards turns the verdict
    // into `tree-differs`, and comparing `undefined` against a hex string is a
    // green test that pins nothing — which is exactly what this test did.
    const { wt } = squashMovedBase(['dist/']);
    const first = audit().token;
    expect(first, 'the fixture must be reapable or there is no token to compare').toMatch(/^[0-9a-f]{64}$/);
    expect(audit().token, 'same world, same token — determinism first').toBe(first);
    // One fingerprinted fact moves and NOTHING else: `dist/` is ignored, so the
    // tree stays clean, the branch stays level with the remote and the proof
    // stays `patch-id`. `ignoredDigest` is the only input that can differ.
    fs.mkdirSync(path.join(wt, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'a'), 'a');
    const second = audit();
    expect(second.verdict, 'ignored content is listed, never a refusal').toBe('reapable');
    expect(second.token).toMatch(/^[0-9a-f]{64}$/);
    expect(second.token).not.toBe(first);
  });
});
