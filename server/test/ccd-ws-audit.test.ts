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

    // And the OTHER end of the helper, which no fixture that reaches a rung can
    // observe: a call that proves nothing must return 1 with `_WS_PROOF` still
    // EMPTY. Both the reset at the top and the final `return 1` survived a
    // whole-diff sweep for want of exactly this — a caller that read a stale
    // `_WS_PROOF` after a refusal would record the previous workspace's proof.
    h.git(main, 'checkout', '-q', '-b', 'stray');
    fs.writeFileSync(path.join(main, 'unmerged.txt'), 'not in the merge\n');
    h.git(main, 'add', 'unmerged.txt'); h.git(main, 'commit', '-m', 'stray work');
    const stray = h.git(main, 'rev-parse', 'HEAD');
    expect(h.sh(`_ws_merge_proof "${main}" "${merge}" "${stray}"; echo "rc=$? proof=$_WS_PROOF"`))
      .toBe('rc=1 proof=');
  });

  it('does not read a FAILED `git cherry` as an empty one', () => {
    // The rung's own comment says it — "swallowing its exit code and testing an
    // empty string would pass every broken invocation" — and a mutation sweep
    // found the `if cout=$(…); then` deletable. The rebase fixture is where it
    // bites: `cherry` is the ONLY rung left there, so with the exit code
    // swallowed an empty `cout` has no `+` line and the merge is proven from a
    // command that never ran.
    const { wt } = rebaseMerged();
    const NOCHERRY = `git() { [[ "$*" == *" cherry "* ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOCHERRY).verdict).toBe('tree-differs');
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
    // The other half of the same filter, which a whole-diff sweep found
    // deletable on its own: a merged PR opened FROM this branch INTO a
    // different base. `pr-head-not-ours` would be a sentence about a stranger's
    // commit told about our own branch, and the remedy it implies (look at
    // whose commit that is) is the wrong one.
    h.ghRows([mergedRow({ baseRefName: 'develop', headRefOid: '0'.repeat(40) })]);
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

  it('shows a dirty path as a FILENAME, not as C-quoted octal', () => {
    // The sibling of the ignored list, in the same document, read by the same
    // human, and left behind when that one was fixed: `git status --porcelain`
    // without `-z` C-quotes any path holding a space, a non-ASCII byte, a
    // quote, a backslash or a control character. Measured, this fixture
    // rendered `"?? \"d\\303\\251j\\303\\240 vu.txt\""` in the same document as
    // an `ignored` array carrying raw paths.
    //
    // NO GUARD READS THIS ARRAY — `dirty-tree` refuses on `REAP_DIRTY`, a count
    // from a different read in `_ws_reap_eval` — so this is about the manifest a
    // human is asked to authorise a deletion from, which is the whole of why
    // the ignored list was a finding.
    const { wt } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'déjà vu.txt'), 'x\n');
    const a = refusal(wt);
    expect(a.verdict).toBe('dirty-tree');
    expect(a.dirty).toEqual(['?? déjà vu.txt']);
  });

  it('reads a staged RENAME as one dirty entry, not as an orphan path', () => {
    // What `-z` gives it takes back, here as in the ignored list. Porcelain v1
    // emits a rename or copy as TWO NUL-terminated records — `XY <to>NUL<from>`
    // — where the non-`-z` form printed a single `R  <from> -> <to>` line.
    // Unpaired, the second record joins this list as an entry with no status
    // letters: a bare filename, in the one list this design asks a human to
    // read before authorising a delete.
    //
    // The letter is in the X column: measured on git 2.43, a worktree-only
    // rename is not detected at all (it reports ` D` plus `??`) and only an
    // INDEX rename produces the two-path form.
    const { wt } = squashMovedBase();
    h.git(wt, 'mv', 'f1.txt', 'renamed.txt');
    expect(h.sh(`git -C "${wt}" status --porcelain -z | tr '\\0' '|'`),
      'if git stops emitting the two-record form this test is moot')
      .toBe('R  renamed.txt|f1.txt|');
    const a = refusal(wt);
    expect(a.verdict).toBe('dirty-tree');
    expect(a.dirty).toEqual(['R  f1.txt -> renamed.txt']);
  });

  it('reads a staged COPY the same way — `C` is reachable, not dead weight', () => {
    // The other letter that carries the two-path form, given its own fixture so
    // that `[RC]*` is not half a pattern nobody can tell from `[R]*`. It takes
    // BOTH `status.renames=copies` and a MODIFIED source: measured on git 2.43,
    // an unmodified source beside a fresh copy reports a plain `A  copy.txt`,
    // because git's copy detection only considers sources that changed in the
    // same diff and `git status` has no `--find-copies-harder`.
    const { wt } = squashMovedBase();
    h.git(wt, 'config', 'status.renames', 'copies');
    fs.copyFileSync(path.join(wt, 'f1.txt'), path.join(wt, 'f1copy.txt'));
    fs.appendFileSync(path.join(wt, 'f1.txt'), 'edited\n');
    h.git(wt, 'add', '-A');
    expect(h.sh(`git -C "${wt}" status --porcelain -z | tr '\\0' '|'`),
      'if git stops detecting the copy this test is moot')
      .toBe('M  f1.txt|C  f1copy.txt|f1.txt|');
    const a = refusal(wt);
    expect(a.verdict).toBe('dirty-tree');
    expect(a.dirty).toEqual(['M  f1.txt', 'C  f1.txt -> f1copy.txt']);
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
    // And the collector's own EXIT-CODE check. This USED to be unreachable —
    // the two patterns above failed `_ws_ignored_digest` as well, its
    // `|| return 1` answered for both, and `(( rc == 0 ))` survived a
    // whole-diff mutation sweep. The digest is now built from the collector's
    // own records rather than from a second `git status`, so there is no second
    // read left to answer for it: re-measured, deleting `(( rc == 0 )) || …`
    // fails THIS test and `removes its scratch file on EVERY path that refuses`
    // (2 failed / 66 passed), where before it failed nothing. `-z` is still what
    // separates the two reads, so this case fails the enumeration alone — and
    // the enumeration is the half that needs no token to do harm: an empty
    // `REAP_SENSITIVE` means `sensitive-ignored` cannot fire over files nobody
    // listed.
    const NOZ = `git() { [[ "$*" == *"--ignored=matching -z"* ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOZ).verdict).toBe('tree-unreadable');
  });

  it('takes only the `!! ` lines from a status that also has dirty ones', () => {
    // The `!! ` filter, deletable with the suite green because Phase B refuses
    // `dirty-tree` BEFORE the collector ever sees a mixed status — so the only
    // caller that can is Task 6's resume path, and the only place to read it is
    // the helper. Without the filter a ` M f1.txt` line becomes an ignored
    // ENTRY whose path is ` M f1.txt`, sized 0 and offered for deletion beside
    // the real ones.
    const { wt } = squashMovedBase(['dist/']);
    fs.mkdirSync(path.join(wt, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'a'), 'a');
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'edited\n');
    expect(h.sh(`git -C "${wt}" status --porcelain --ignored=matching | wc -l`),
      'the fixture must present BOTH kinds of line to the collector').toBe('2');
    const paths = h.sh(`${ARCH} _ws_reap_reset; _ws_collect_ignored "${wt}"`
      + `; for r in "\${REAP_IGNORED[@]}"; do echo "\${r##*$'\\t'}"; done`);
    expect(paths).toBe('dist/');
  });

  // RENAMED, round-3 item 3, routed here by the ui-tsx verifier. This was
  // `records 0 bytes rather than an empty field when the size read fails`, and
  // it PINNED A FORGERY: `[[ "$b" =~ ^[0-9]+$ ]] || b=0` turned a `du` that
  // never ran into the number `0`, the record went into `ignoredBytes`, and
  // `ReapSheet.tsx:161` prints that as a stated total immediately above the
  // Remove button. A test asserting the 0 is worse than no test, so the
  // assertion is inverted rather than deleted — and the half it legitimately
  // defended (an empty `b` makes `"bytes":`, which is not JSON) is kept: the
  // `JSON.parse` in `audit()`/`refusal()` still runs on every case below.
  it('refuses the collection when an entry\'s size read FAILS, and records no 0', () => {
    const { wt } = squashMovedBase(['dist/']);
    fs.mkdirSync(path.join(wt, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'a'), 'a');
    const a = refusal(wt, 'du() { return 1; };');
    expect(a.verdict).toBe('tree-unreadable');
    expect(a.detail, a.detail).toContain("could not size the ignored entry dist/");
    // The forged figures are ABSENT, not zero: a refusal document carries no
    // ignored manifest at all, so there is no total to misread.
    expect(a.ignored ?? [], 'no entry was recorded on a size nobody took').toEqual([]);
    expect(a.ignoredBytes ?? 0).toBe(0);
    expect(a.ignoredCount ?? 0).toBe(0);
  });

  it('refuses a PARTIAL du total — the failure that looks like an answer', () => {
    // The second and nastier half of the same rung. `du -sb` on a directory it
    // can only partly read exits 1, writes the diagnostic to stderr, and still
    // prints a PARTIAL total on stdout — measured below, and on GNU coreutils
    // 9.4 outside the suite: 5000 for a tree holding 14000. `^[0-9]+$` accepted
    // that, so the old rung did not merely record 0 on a hard failure, it
    // recorded a plausible under-count on a soft one. 0 looks like a bug;
    // an under-count looks like an answer, and it is the answer the Remove
    // button prints.
    const { wt } = squashMovedBase(['dist/']);
    const locked = path.join(wt, 'dist', 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'visible.bin'), 'v'.repeat(5000));
    fs.writeFileSync(path.join(locked, 'hidden.bin'), 'h'.repeat(9000));
    fs.chmodSync(locked, 0o000);
    try {
      // The fixture only means anything if du really behaves this way here.
      const probe = h.sh(`du -sb "${wt}/dist" >"$HOME/du-out" 2>"$HOME/du-err"; echo "rc=$?"; `
        + `echo "out=[$(cat "$HOME/du-out")]"; echo "err=[$(cat "$HOME/du-err")]"`);
      expect(probe, probe).toContain('rc=1');
      expect(probe, probe).toContain('Permission denied');
      expect(probe, probe).toMatch(/out=\[5\d{3}\s/);   // partial: 9000 bytes missing

      const a = refusal(wt, '');
      expect(a.verdict).toBe('tree-unreadable');
      expect(a.detail, a.detail).toContain("could not size the ignored entry dist/");
      expect(JSON.stringify(a), 'the partial total never reaches the wire')
        .not.toMatch(/"bytes":5\d{3}/);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  }, 30000);

  it('removes its scratch file on EVERY path that refuses, and on the one that does not', () => {
    // Five exits, four `rm -f "$outf"`, and each one is only reachable through
    // its own failure — measured by mutation: with any single `rm` deleted, the
    // fixture for a different failure still cleans up, so one case pins nothing
    // and all of them have to be walked. The fifth, added with the scan inside
    // a collapsed ignored directory, needs an ignored directory to exist at all
    // and so lives in `removes the inside-scan's scratch files too`. The verdicts are identical with and
    // without them (an empty temp-file name is itself a failing redirect, so the
    // next guard refuses anyway); the FILE is the whole difference, and TMPDIR
    // is what makes it observable. A verb that runs on every sheet open and
    // leaks one temp file per failure is how a box ends up with 47k of them.
    const { wt } = squashMovedBase();
    const tmp = path.join(h.home, 'tmpdir');
    fs.mkdirSync(tmp);
    const run = (pre: string): string => h.sh(
      `${ARCH} ${pre} _ws_reap_reset; _ws_collect_ignored "${wt}"; echo "rc=$?"`, { TMPDIR: tmp });

    // (a) the SECOND allocation fails — the leak is the file the first one made.
    // The counter lives in a FILE, not a variable: `outf=$(mktemp)` runs the
    // stub inside a command substitution, so a shell variable it incremented
    // would be discarded with the subshell and the stub would never fail.
    const ONCE = `mktemp() { local c="$HOME/mkcount" n;`
      + ` n=$(( $(cat "$c" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$c";`
      + ` (( n >= 2 )) && return 1; command mktemp; };`;
    expect(run(ONCE)).toBe('rc=1');
    expect(fs.readdirSync(tmp), 'the errf-allocation refusal left its scratch file').toEqual([]);

    // (b) the read fails by EXIT CODE.
    const NOZ = `git() { [[ "$*" == *"--ignored=matching -z"* ]] && return 128; command git "$@"; };`;
    expect(run(NOZ)).toBe('rc=1');
    expect(fs.readdirSync(tmp), 'the exit-code refusal left its scratch file').toEqual([]);

    // (c) the read exits 0 and WARNS — the partial-read refusal.
    const sub = path.join(wt, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'work.txt'), 'uncommitted\n');
    fs.chmodSync(sub, 0o000);
    try {
      expect(run('')).toBe('rc=1');
      expect(fs.readdirSync(tmp), 'the stderr refusal left its scratch file').toEqual([]);
    } finally {
      fs.chmodSync(sub, 0o755);
    }

    // (d) and the path that succeeds.
    fs.rmSync(sub, { recursive: true, force: true });
    expect(run('')).toBe('rc=0');
    expect(fs.readdirSync(tmp), 'a successful read left its scratch file').toEqual([]);
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
    // nothing on disk. `prod db.sqlite` and `ssh key.pem` are the same hole in
    // the one guard §7 says has no override. `My Project.env` was named here
    // too and did NOT belong: its suffix had no arm in `_ws_sensitive_match`,
    // so quoting was never what was wrong with it — see the `*.env` case in
    // `matches EVERY pattern`, which is where it is actually closed.
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

  it('scans ALL TYPES inside a collapsed dir, so a secret-shaped DIRECTORY is seen', () => {
    // The inside-scan's `find` deliberately carries no `-type f`, because
    // `_ws_sensitive_match` matches DIRECTORY names too — restricting it would
    // answer a different question inside a collapsed entry than outside it.
    // That choice was argued in a comment and pinned by nothing: adding
    // `-type f` left the whole suite green (gate finding N1). Here the only
    // matches ARE directories — no file below `build/` matches any glob — so
    // with `-type f` the scan finds nothing, the entry reads ordinary, and a
    // tap deletes `build/secrets/` and `build/credentials/` unnamed.
    const { wt } = squashMovedBase(['build/']);
    for (const d of ['secrets', 'credentials']) {
      fs.mkdirSync(path.join(wt, 'build', d), { recursive: true });
      fs.writeFileSync(path.join(wt, 'build', d, 'data.txt'), 'x'.repeat(128));
    }
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive.sort()).toEqual(['build/credentials', 'build/secrets']);
    expect(a.token).toBeUndefined();
    expect(fs.existsSync(path.join(wt, 'build', 'secrets', 'data.txt'))).toBe(true);
  });

  // F3 refinement (pre-merge fix round): the human partner ruled directly —
  // apply it. Measured over 15 real projects, three top-level globs
  // (`credentials*`, `secrets*`, `*.pem`) reaching one directory into a
  // dependency or build tree produced 338 inside-hits, 7 of 15 projects
  // refusing on the first tap, essentially all of it vendored/build noise.
  // A secret-shaped name that ALSO ends in a source, compiled or template
  // extension is filtered — but COUNTED, never silently dropped, and a real
  // secret beside the noise still refuses.
  it('filters vendored noise inside a collapsed directory, but a real secret beside it still refuses (F3 refinement)', () => {
    const { wt } = squashMovedBase(['build/']);
    fs.mkdirSync(path.join(wt, 'build'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'credentials.d.ts'), 'export {};\n');
    fs.writeFileSync(path.join(wt, 'build', 'secretsmanager.generated.js'), '// generated\n');
    fs.writeFileSync(path.join(wt, 'build', '.env'), 'SECRET_API_KEY=1\n');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    // The noise is not in `sensitive` at all — only the real secret is.
    expect(a.sensitive).toEqual(['build/.env']);
    // But it is COUNTED: excluded must never mean invisible.
    expect(a.sensitiveFiltered).toBe(2);
  });

  it('reads reapable when every secret-shaped hit inside a collapsed directory is noise — and still reports what it filtered', () => {
    const { wt } = squashMovedBase(['build/']);
    fs.mkdirSync(path.join(wt, 'build'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'credentials.d.ts'), 'export {};\n');
    fs.writeFileSync(path.join(wt, 'build', 'secretsmanager.generated.js'), '// generated\n');
    fs.writeFileSync(path.join(wt, 'build', 'secrets-manager.js.map'), '{}\n');
    fs.writeFileSync(path.join(wt, 'build', '.env.example'), 'KEY=\n');
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sensitive).toEqual([]);
    expect(a.sensitiveFiltered).toBe(4);
  });

  it('filters a top-level .env.example as noise while a real top-level .env still refuses — and both stay LISTED', () => {
    const { wt } = squashMovedBase(['.env.example', '.env']);
    fs.writeFileSync(path.join(wt, '.env.example'), 'KEY=\n');
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=1\n');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive).toEqual(['.env']);
    expect(a.sensitiveFiltered).toBe(1);
    // Filtered is not the same as unlisted or undeleted: both entries are
    // still named and sized in `ignored`, exactly as ordinary rubbish is.
    expect(a.ignoredCount).toBe(2);
    expect(a.ignored.map((e: { path: string }) => e.path).sort()).toEqual(['.env', '.env.example']);
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

  /** A path holding a byte that is not valid UTF-8 — the case `-z` created by
   *  handing raw bytes to a serializer git's C-quoting used to keep ASCII.
   *  `path.join` takes strings, and a JS string cannot hold a lone 0xff, so the
   *  path is built as a BUFFER and the byte never round-trips through node. */
  const rawName = (dir: string, prefix: string, suffix: string): Buffer =>
    Buffer.concat([Buffer.from(`${dir}/${prefix}`, 'utf8'), Buffer.from([0xff]),
      Buffer.from(suffix, 'utf8')]);

  it('serialises a path byte NO locale can decode — a SENSITIVE name', () => {
    // The regression `-z` introduced, and the reason the encoding policy is
    // pinned in `_json_str`. Before this: `_json_str` read stdin through
    // python's LOCALE codec, which on this box (LANG=en_US.UTF-8) is utf-8
    // STRICT, so 0xff raised UnicodeDecodeError, stdout was EMPTY, `$(…)`
    // swallowed the status, and `cmd_ws_audit` printed
    // `"ignored":[{"path":,"bytes":600,…}]` — a document `JSON.parse` rejects,
    // at exit 0, for a workspace whose verdict was `sensitive-ignored`. Worse
    // than the syntax error: the `sensitive` array degraded to `[]` beside a
    // verdict that named it. It was locale-dependent too (valid under LC_ALL=C,
    // where python falls back to surrogateescape), and on the same file the
    // collector's own comment gives "ccd pins no locale" as a reason to
    // distrust text tests.
    //
    // `JSON.parse` inside `refusal()` is therefore half the assertion. The
    // other half is that the byte is REPLACED (U+FFFD) rather than dropped:
    // the guard already ran on the raw bytes in bash, so this string is the
    // human's copy and it has to say "something here is not text".
    const { wt } = squashMovedBase(['*.pem']);
    fs.writeFileSync(rawName(wt, 'a', 'b.pem'), 'PRIVATE KEY\n'.repeat(50));
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive).toEqual(['a�b.pem']);
    expect(a.ignored).toEqual([{ path: 'a�b.pem', bytes: 600, sensitive: true }]);
    expect(a.detail).toContain('a�b.pem');
  });

  it('serialises a path byte NO locale can decode — an ORDINARY name', () => {
    // The same byte in a name nothing refuses on: the document must still parse
    // and the token must still be issued. Measured before the fix: verdict
    // `reapable` with a real 64-hex token inside a document `JSON.parse` threw
    // on — so `parseAudit` answered null and the sheet rendered "Checking…"
    // forever, over a workspace ccd had certified as deletable.
    const { wt } = squashMovedBase(['*.log']);
    fs.writeFileSync(rawName(wt, 'a', 'b.log'), 'x'.repeat(77));
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.ignored).toEqual([{ path: 'a�b.log', bytes: 77, sensitive: false }]);
    expect(a.sensitive).toEqual([]);
  });

  it('REFUSES outright when python3 cannot quote — it never prints a hole', () => {
    // The one failure `_json_str` has left once bytes cannot fail it, and the
    // reason its status is checked ONCE, up front, rather than at fifteen
    // `$(_json_str …)` sites inside printf argument lists where the status is
    // swallowed by construction. `_ws_manifest` (ccd:1066) already probes for
    // exactly this and says why: a best-effort transcript sanitize may warn and
    // continue, a record that authorises deletions may not.
    //
    // The assertion is deliberately NOT `expect(() => audit()).toThrow()`: a
    // document full of holes ALSO makes `JSON.parse` throw, so that shape is
    // green with and without the fix and pins nothing. What is asserted is the
    // pair — exit NON-ZERO and stdout EMPTY — which is the difference between
    // refusing and emitting a hole.
    //
    // `-c` is `_json_str`'s invocation form and nothing else's in this file:
    // `_pr_py` runs `python3 /dev/fd/3`, so the PR read still works for real and
    // the only broken thing is the quoting. A blanket `python3() { return 127; }`
    // would break `_pr_py` too and refuse for a different reason entirely.
    const { wt } = squashMovedBase(['dist/']);
    fs.mkdirSync(path.join(wt, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'a'), 'a');
    const NOPY = `python3() { [[ "\${1-}" == -c ]] && return 127; command python3 "$@"; };`;
    // In a SUBSHELL because refusing here is `die`, which is `exit 1` — in the
    // sourcing shell that ends the snippet before its own `echo` can report.
    expect(h.sh(`${GH_STUB} ${ARCH} ${NOPY} `
      + `( cmd_ws_audit --session demo-quiet-basin ) >out.json 2>err.txt; echo "exit=$?"`))
      .toBe('exit=1');
    expect(fs.readFileSync(path.join(h.home, 'out.json'), 'utf8'),
      'a refusal must print NO document, not a document with holes in it').toBe('');
    expect(fs.readFileSync(path.join(h.home, 'err.txt'), 'utf8')).toContain('python3');
    expect(fs.existsSync(wt), 'a read-only audit must never remove the worktree').toBe(true);
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
    //
    // `.env*` is a PREFIX arm and `*.env` a SUFFIX one, and BOTH spellings are
    // here because for one round only the prefix existed: `production.env`,
    // `prod.env` and `My Project.env` all read as ordinary rubbish queued for
    // deletion while four places claimed the case was closed. The one with a
    // space in it is deliberate — that is the name the C-quoting round used as
    // its example, and quoting was never what was wrong with it.
    const secret = ['.env.local', 'production.env', 'My Project.env', 'deploy.pem',
      'api.key', 'cert.p12', 'id_ed25519',
      'vault.kdbx', 'credentials.json', 'app.sqlite3', 'cache.db', 'pg.dump',
      'schema.sql', 'secrets.tar'];
    // `env.sample` and `environment` are the negatives that keep `*.env` from
    // being written as a substring match.
    const ordinary = ['notes.md', 'env.sample', 'environment', 'myid_rsa', 'database.dbx'];
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

  it('refuses a stash taken from a DETACHED worktree, which names no branch', () => {
    // Final-round integration docket 6, end to end on the verb that acts on the
    // count. The stash is taken while the worktree is detached — git writes
    // `WIP on (no branch):` — and the worktree is then put BACK on its branch,
    // which is the state an operator who compared two commits leaves behind and
    // the only state `ws-audit` can even reach (a detached worktree refuses
    // `detached-head` two rungs earlier). Before the fix this workspace audited
    // `reapable` with `stashes: 0`, handed out a token, and the reap
    // CAS-deleted the branch the stash was taken from.
    const { wt, main } = squashMovedBase();
    h.git(wt, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'wip\n');
    h.sh(`cd "${wt}" && git stash push -q`);           // NO -m: the common form
    h.git(wt, 'checkout', '-q', 'ws/quiet-basin');
    expect(h.sh(`git -C "${main}" stash list`), 'the fixture must be the (no branch) form')
      .toContain('WIP on (no branch):');
    const a = refusal(wt);
    expect(a.verdict).toBe('stashes-present');
    // On the wire too: `stashes: 0` beside a `stashes-present` verdict would be
    // two answers, and 0 is the one that would have authorised the delete.
    expect(a.stashes).toBe(1);
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

    // THE HALF OF THE INVARIANT THAT IS A LAW, measured rather than assumed:
    // at least one entry ⇒ `refs/stash` resolves — git creates the ref on the
    // first push and deletes it when the last entry goes, whether by pop, drop
    // or clear. The CONVERSE is what this guard actually rests on and it is NOT
    // a law git keeps; the next `it` names the state that breaks it.
    expect(h.sh(`git -C "${main}" rev-parse --verify --quiet refs/stash >/dev/null; echo "rc=$?"`))
      .toBe('rc=0');
    h.sh(`git -C "${main}" stash clear`);
    expect(h.sh(`git -C "${main}" rev-parse --verify --quiet refs/stash >/dev/null; echo "rc=$?"`))
      .toBe('rc=1');
    expect(audit().verdict).toBe('reapable');
  }, 30000);

  it('carries its own remedy when maintenance leaves refs/stash behind', () => {
    // The guard's false-positive state, named rather than hidden.
    // `git reflog expire --all --expire=now --expire-unreachable=now` is a
    // DOCUMENTED maintenance command that does not mention refs/stash, and
    // measured on git 2.43 it empties the stash reflog and LEAVES THE REF: the
    // ref resolves (rc 0) beside a `git stash list` that returns rc 0 with zero
    // entries — bit for bit the shape the guard reads as "the reflog was not
    // read". So `stash-unreadable` fires for a repository that honestly has no
    // stashes, and it fires PERMANENTLY, for every workspace in that repository,
    // with no override, and — running before the `exists` branch — it blocks the
    // `reap-interrupted` resume path too. (`git gc --prune=now` does NOT reach
    // it, nor does gc with `gc.reflogExpire=now`: git protects refs/stash from
    // gc by default. Measured. The trigger is narrow, but it is real.)
    //
    // It fails SAFE — a refusal, never a token — so the guard stays and the
    // false positive is disclosed instead of engineered away, because from
    // here the two states are indistinguishable and "I cannot tell" may only
    // refuse. What that makes load-bearing is the REMEDY: the operator this
    // message reaches is the only one who can act on it, so it travels in the
    // refusal rather than in a comment nobody in that position will read.
    const { wt, main } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'wip\n');
    h.sh(`cd "${wt}" && git stash push -q -m wip`);
    h.sh(`git -C "${main}" reflog expire --all --expire=now --expire-unreachable=now`);
    // The state itself, measured here rather than asserted from memory: if a
    // future git stops leaving the ref, this whole `it` is moot.
    expect(h.sh(`git -C "${main}" rev-parse --verify --quiet refs/stash >/dev/null; echo "rc=$?"`),
      'the ref must OUTLIVE the reflog for this to be the state under test').toBe('rc=0');
    expect(h.sh(`git -C "${main}" stash list | grep -c . || true`),
      'and the list must read back empty').toBe('0');
    const a = refusal(wt);
    expect(a.verdict).toBe('stash-unreadable');
    expect(a.detail, 'a permanent refusal with no override must name its way out')
      .toContain('git stash clear');
    expect(a.detail).toContain('git update-ref -d refs/stash');
    // And the named remedy WORKS on the state it is named for — otherwise the
    // detail is advice nobody measured. Both are asserted; `stash clear` runs
    // last so the workspace is left reapable.
    h.sh(`git -C "${main}" update-ref -d refs/stash`);
    expect(audit().verdict).toBe('reapable');
    // The tree is clean again after that first stash, so it has to be dirtied
    // before it can hold a second one — `git stash push` on a clean tree makes
    // no entry and no ref, and the fixture would rebuild nothing.
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'wip again\n');
    h.sh(`cd "${wt}" && git stash push -q -m wip2`);
    h.sh(`git -C "${main}" reflog expire --all --expire=now --expire-unreachable=now`);
    expect(refusal(wt).verdict).toBe('stash-unreadable');
    h.sh(`git -C "${main}" stash clear`);
    expect(audit().verdict).toBe('reapable');
    // Four `cmd_ws_audit` runs on one fixture, which lands ON vitest's 5 s
    // default rather than under it. Measured the expensive way: with no timeout
    // this `it` failed once in six whole-suite runs at 5062 ms, and that flake
    // landed inside a mutation sweep and reported a mutant KILLED that survives
    // three re-runs. A test that fails on load does not pin anything — it
    // fabricates evidence for whatever ran while it was flapping.
  }, 30000);

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
    // A shifted fragment that IS hex refuses as well: `bee` is three hex
    // characters, so the character class alone would take it. What refuses it
    // here is the TAIL field, which still carries the literal tab — which is
    // also why THIS route can only ever pin the character class. The floor, the
    // ceiling and all four anchors are pinned by the next `it`, through the one
    // route that can reach them.
    h.ghRows([mergedRow({
      headRefOid: tip, mergeCommit: { oid: merge }, url: 'https://x/\tbee',
    })]);
    expect(refusal(wt).verdict).toBe('pr-fields-malformed');
  });

  /** A `_pr_py pick` that answers a row of OUR choosing.
   *
   *  Shadowing a shell function is what every other stub in this file does, and
   *  it is the only route to this guard's interior: the guard's own reason for
   *  existing is "the day these two stop being read from the same producer", and
   *  while there IS one producer, python's `OID` screens both oids before they
   *  are joined and the tab-shift always leaves a literal tab in the tail field.
   *  So with the real `pick` nothing below the character class is reachable —
   *  measured, as eight surviving mutants. `pick` is the only mode `ws-audit`
   *  calls, so shadowing the function shadows exactly this one answer.
   *
   *  `number` and `url` are kept well-formed: the point is the two oid fields. */
  const pickRow = (merge: string, head: string): string =>
    `_pr_py() { cat >/dev/null; printf '42\\thttps://x/1\\t%s\\t%s\\n' '${merge}' '${head}'; };`;

  it('re-anchors BOTH oids at BOTH ends, and bounds them at 7 and 40', () => {
    // Every piece of `^[0-9a-f]{7,40}$ && ^[0-9a-f]{7,40}$`, one crafted row at
    // a time. bash's `=~` SEARCHES unless anchored, so each anchor has its own
    // survivor: with `^` gone `origin/deadbeef1` matches on its 9-hex tail and
    // reaches `git cat-file -e "origin/deadbeef1^{commit}"`, `merge-base
    // --is-ancestor` and `diff --stat` — precisely the "resolves as a REVISION
    // and binds" case the guard is written to stop. With `$` gone a trailing
    // `^{commit}` rides in on the head of the string. The floor of 7 and the
    // ceiling of 40 each have one too.
    //
    // The verdict, not merely "a refusal", is the assertion: with any of these
    // six pieces removed the row passes the guard and the audit refuses
    // `merge-commit-missing` one fetch later — a refusal either way, so
    // `refusal()` alone would pin nothing.
    const OK = 'a'.repeat(40);
    const GARBAGE = `${'b'.repeat(24)}^{commit}`;
    const cases: [string, string, string][] = [
      ['origin/deadbeef1', OK, 'mergeCommit with leading garbage — the `^`'],
      [GARBAGE, OK, 'mergeCommit with trailing garbage — the `$`'],
      ['abc', OK, 'mergeCommit under the floor — `abc` is a resolvable ref'],
      [OK, 'origin/deadbeef1', 'headRefOid with leading garbage — the `^`'],
      [OK, GARBAGE, 'headRefOid with trailing garbage — the `$`'],
      [OK, 'f'.repeat(41), 'headRefOid over the ceiling of 40'],
      // The gate measured that floor and ceiling were each pinned on only ONE
      // of the two fields — `{7,40}`→`{1,40}` on headRefOid alone survived,
      // and a short headRefOid is exactly the resolves-as-a-REVISION half the
      // guard exists for. Both bounds, both fields (gate finding N7).
      [OK, 'abc', 'headRefOid under the floor — `abc` is a resolvable ref'],
      ['f'.repeat(41), OK, 'mergeCommit over the ceiling of 40'],
    ];
    const { wt } = squashMovedBase();
    for (const [m, hd, why] of cases) {
      const a = refusal(wt, pickRow(m, hd));
      expect(a.verdict, why).toBe('pr-fields-malformed');
      // Both names in the refusal, so the reader can see WHICH field was bad.
      expect(a.detail).toContain(m);
      expect(a.detail).toContain(hd);
    }
    // And the control: the same route with two well-formed oids gets PAST this
    // guard. Without it every case above would pass for the wrong reason — a
    // shadow that refused everything would look identical.
    expect(refusal(wt, pickRow(OK, OK)).verdict).toBe('merge-commit-missing');
    // Nine `cmd_ws_audit` runs against one fixture, which is over vitest's 5 s
    // default. The eight cases are ONE claim (every piece of that regex is
    // load-bearing on BOTH fields) and splitting them into `it`s to fit a
    // default would pay repeated fixture builds to say it. One of the explicit
    // timeouts here; another names what an unbudgeted one cost.
  }, 30000);

  it('refuses branch-missing when refs/heads/<branch> does not resolve', () => {
    // Unreachable by DELETING the ref — measured, `<branch>@{upstream}` still
    // resolves from config afterwards, so `rev-list --count` fails first and
    // `unpushed-commits` is what answers. The rung is still what stops Phase C
    // building a proof out of an empty tip (`REAP_TIP` is the fingerprint's
    // third field and `_ws_merge_proof`'s third argument), so it is failed
    // directly rather than left unpinned on the strength of being unreachable
    // through one route.
    const { wt } = squashMovedBase();
    const NOTIP = `git() { [[ "$*" == *'rev-parse --verify refs/heads/ws/quiet-basin'* ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOTIP).verdict).toBe('branch-missing');
  });

  it('publishes a NUMBER for commitsAheadOfBase even when the count fails', () => {
    // `[[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0` in the VERB, not the evaluator.
    // Without it a failed `rev-list --count` prints `"commitsAheadOfBase":` and
    // the whole manifest stops being JSON — including the refusal it was
    // carrying, so the sheet would show a parse error instead of a sentence.
    const { wt } = squashMovedBase();
    const NOCOUNT = `git() { [[ "$*" == *"rev-list --count"* ]] && return 128; command git "$@"; };`;
    const a = refusal(wt, NOCOUNT);
    expect(a.verdict).toBe('unpushed-commits');
    expect(a.commitsAheadOfBase).toBe(0);
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
    // The `-n "$REAP_WTHEAD"` half of `headMatchesRegistry`, which nothing else
    // can reach: this is the one state where BOTH sides of the comparison are
    // empty, and a bare equality would publish `true` — "git's record and ccrc's
    // registry agree" — about a registry that names no branch at all.
    expect(a.headMatchesRegistry).toBe(false);
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
    // are separately load-bearing. `sha256sum` is what fails ONLY the digest:
    // the enumeration has already succeeded by the time the records are hashed,
    // so what refuses is the collector's own `^[0-9a-f]{64}$` rung over an
    // empty hash. An empty digest here is the exact forgery deviation 6 closed
    // — it hashes identically on the reap side, so the consent check matches.
    //
    // TWO stubs, because under `set -o pipefail` the first one does not reach
    // the rung it looks like it tests: a `sha256sum` that EXITS non-zero makes
    // the pipeline's status the assignment's, and the assignment is the
    // collector's last statement, so it returns 1 with the shape check deleted.
    // Measured as a mutation survivor for exactly that reason. The rung is for
    // a `sha256sum` that SUCCEEDS and answers something that is not a digest —
    // the case `_ws_ignored_digest` keeps its own `^[0-9a-f]{64}$` for, and the
    // one that matters, because a STABLE non-digest is computed identically on
    // the reap side and the consent check then matches.
    const { wt } = squashMovedBase();
    expect(refusal(wt, 'sha256sum() { return 1; };').verdict).toBe('tree-unreadable');
    expect(refusal(wt, 'sha256sum() { echo "not-a-digest"; };').verdict).toBe('tree-unreadable');
  });

  it('removes the inside-scan\'s scratch files too, on every path that refuses', () => {
    // The scan inside a collapsed ignored directory allocates its own two temp
    // files and has four exits of its own, and the collector gained a FIFTH
    // exit for it. Same rule as the sibling test above: one fixture pins
    // nothing, because with any single `rm` deleted a fixture for a different
    // failure still cleans up. `find` appears once in ccd, at this scan.
    const { wt } = squashMovedBase(['dist/']);
    fs.mkdirSync(path.join(wt, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'a'), 'a');
    const tmp = path.join(h.home, 'tmpdir2');
    fs.mkdirSync(tmp);
    // `GH_STUB` for its `timeout`, and that is not incidental: ccd bounds the
    // scan with `timeout "$left" find …`, and the REAL `timeout` execs the
    // `find` BINARY — a shell function named `find` is invisible to it, so
    // without the stub these two cases silently run the genuine walk and the
    // collector answers rc=0. Measured, and it is the same reason `timeout` is
    // shadowed for gh: a wrapper the stub cannot see is a wrapper the test is
    // not exercising.
    const run = (pre: string): string => h.sh(
      `${GH_STUB} ${ARCH} ${pre} _ws_reap_reset; _ws_collect_ignored "${wt}"; echo "rc=$?"`,
      { TMPDIR: tmp });

    // (a) the scan fails by EXIT CODE, silently.
    expect(run('find() { command find "$@" 2>/dev/null; return 1; };')).toBe('rc=1');
    expect(fs.readdirSync(tmp), 'the scan exit-code refusal leaked a scratch file').toEqual([]);

    // (b) the scan exits 0 and WARNS.
    expect(run('find() { command find "$@"; echo "find: nope" >&2; };')).toBe('rc=1');
    expect(fs.readdirSync(tmp), 'the scan diagnostic refusal leaked a scratch file').toEqual([]);

    // (c) and (d) the scan's OWN allocations fail. The collector takes the
    // first two, so the third and fourth are the scan's; the counter is a file
    // for the reason the sibling gives (a variable dies with the subshell).
    const nth = (k: number): string => `mktemp() { local c="$HOME/mkcount${k}" n;`
      + ` n=$(( $(cat "$c" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$c";`
      + ` (( n >= ${k} )) && return 1; command mktemp; };`;
    expect(run(nth(3))).toBe('rc=1');
    expect(fs.readdirSync(tmp), 'the scan outf-allocation refusal leaked a scratch file').toEqual([]);
    expect(run(nth(4))).toBe('rc=1');
    expect(fs.readdirSync(tmp), 'the scan errf-allocation refusal leaked a scratch file').toEqual([]);

    // (e) and the path that succeeds, which allocates all four.
    expect(run('')).toBe('rc=0');
    expect(fs.readdirSync(tmp), 'a successful scan leaked a scratch file').toEqual([]);
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
  it('fingerprints thirteen DISTINCT facts, and nothing else', () => {
    // The token is what `ws-reap --expect` re-proves against at the instant of
    // deletion, so every field has to be in it and no two fields may be
    // interchangeable. Moving one fact at a time through the helper is the only
    // way to say that: the behavioural token test can only move the one fact a
    // fixture can move without changing the verdict.
    //
    // The thirteenth is `clipsDigest`: `~/.cc-clips/<id>` is `rm -rf`'d by the
    // reap, so a clip pasted between the sheet and the tap is deleted — and
    // until it was fingerprinted the token did not move when one was.
    const facts = ['id', 'branch', 'tip', 'head', 'merge', 'proof',
      '0', 'igndigest', 'sensdigest', '0', 'wthead', 'baseoid', 'clipsdigest'];
    const call = (a: string[]): string => h.sh(`_ws_fingerprint ${a.map((x) => `'${x}'`).join(' ')}`);
    const first = call(facts);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(call(facts), 'same thirteen facts, same token').toBe(first);
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
    // The ignored digest is over the RECORDS the collector builds
    // (`sensitive\tbytes\tpath`), not over the paths `_ws_ignored_digest`
    // hashes — that is what makes a grown ignored file move the token — so it is
    // rebuilt here BY HAND rather than read back from the producer under test.
    const ignBytes = h.sh(`du -sb "${wt}/node_modules" | head -n1 | cut -f1`);
    const igndigest = h.sh(
      `printf '%s\\0' "0"$'\\t'"${ignBytes}"$'\\t'"node_modules/" | sort -z | sha256sum | cut -d' ' -f1`);
    // No clips directory for this session, so the manifest is the empty array.
    const clipsdigest = h.sh(`printf '[]\\n' | sha256sum | cut -d' ' -f1`);
    const baseOid = h.git(main, 'rev-parse', '--verify', 'origin/main');
    // The empty-set sensitive digest. It is a CONSTANT in every state that
    // reaches a token, because a non-empty set is `sensitive-ignored` and
    // refuses — which is why its `sort` cannot be pinned behaviourally.
    const sensdigest = h.sh(`printf '%s\\n' "" | sort | sha256sum | cut -d' ' -f1`);
    const args = ['demo-quiet-basin', 'ws/quiet-basin', tip, tip, merge, 'patch-id',
      '0', igndigest, sensdigest, '0', 'ws/quiet-basin', baseOid, clipsdigest];
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

  // Pre-merge fix round, finding F — the ninth instance of the
  // measurement-forgery class (deviation 10). This is the figure
  // `ReapSheet.tsx`'s primary Remove button prints, so a `du` that could only
  // partly read the worktree must not hand it a real-looking, understated
  // number. `chmod 000` on a real subdirectory — not a `du() { … }` shell
  // shadow, which does not reproduce how GNU `du` actually fails.
  it('worktreeBytes is null, not an understated number, when a subdirectory is unreadable', () => {
    const { wt } = squashMovedBase();
    const readable = path.join(wt, 'readable_sub');
    const blocked = path.join(wt, 'blocked_sub');
    fs.mkdirSync(readable, { recursive: true });
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(readable, 'f'), Buffer.alloc(102_400));
    fs.writeFileSync(path.join(blocked, 'f'), Buffer.alloc(921_600));
    fs.chmodSync(blocked, 0o000);
    try {
      expect(audit().worktreeBytes).toBeNull();
    } finally {
      fs.chmodSync(blocked, 0o755);
    }
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
  }, 30000);
});
