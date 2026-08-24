// server/test/ccd-lifecycle-pairs.test.ts
//
// D4. The measured hole this closes: `$REG/.reap-<id>.lock` — 12 files on the
// live box, one with a lock and no tombstone, a reap attempted and refused,
// recorded nowhere.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CCD, WS_ADD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { makePrHarness, mergedRow, GH_STUB, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, generationsOf, lcDir } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-pairs-'); });
afterEach(() => { h.cleanup(); });

const half = (act: string, outcome: string): Record<string, unknown>[] =>
  eventsOf(h.home, act).filter((e) => e['outcome'] === outcome);

/** A real worktree on a real branch, so `_ws_wt_branch` and `git branch -d`
 *  both answer for real. */
const workspace = (id = 'demo-still-river'): { main: string; wt: string } => {
  const main = h.makeRepo('demo');
  h.git(main, 'commit', '--allow-empty', '-m', 'base');
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
  h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo
    _reg_set ${id} workspace still-river; _reg_set ${id} branch ws/still-river
    _reg_set ${id} workdir ${wt}`);
  return { main, wt };
};

const STUB = `_ws_unsupervise() { :; }; _tmux() { echo t; }; tmux() { :; };`;

/** Runs one snippet with raw `spawnSync`, not `h.sh` — `h.sh` only ever
 *  returns stdout, so a leaked diagnostic on stderr (bash's own, not
 *  `_lc_*`'s) would pass silently. Same idiom `ccd-lifecycle-purge.test.ts`'s
 *  `runContained` and `ccd-lifecycle-gen.test.ts`'s "leaks nothing to
 *  stderr" both use. */
const runContained = (home: string, snippet: string): ReturnType<typeof spawnSync> => {
  const env = ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true });
  return spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], { encoding: 'utf8', cwd: home, env });
};

describe('ws-rm writes an intent/done pair sharing one tx', () => {
  it('brackets the destruction, names the verb, and the intent precedes the teardown', () => {
    workspace();
    h.sh(`_ws_unsupervise() { echo unsup >> "$HOME/order"; }; _tmux() { echo t; }; tmux() { :; }
      cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const i = half('destroy', 'intent'); const d = half('destroy', 'done');
    expect(i, 'no intent line').toHaveLength(1);
    expect(d, 'no done line').toHaveLength(1);
    expect(i[0]!['tx']).toBe(d[0]!['tx']);
    expect(String(i[0]!['tx'])).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect(i[0]!['verb']).toBe('ws-rm');
    expect(fs.existsSync(path.join(h.home, 'order')), 'the teardown really ran').toBe(true);
  });

  it('leaves an intent with NO sibling when the process dies mid-destroy', () => {
    // Mutant: emit both lines adjacently at the end -> this fails with
    // `expected 0 to be 1`, and a half-destroyed workspace becomes
    // indistinguishable from one that was never touched.
    workspace();
    try {
      // `kill -9 $$` kills the SOURCING shell, so execFileSync throws on the
      // signal and `|| true` is never reached. Catching it IS the case.
      h.sh(`_ws_unsupervise() { kill -9 $$; }; _tmux() { echo t; }; tmux() { :; }
        cmd_ws_rm demo-still-river`);
    } catch { /* the point of the case: the process died mid-destroy */ }
    expect(half('destroy', 'intent'), 'the intent must survive the kill').toHaveLength(1);
    expect(half('destroy', 'done'), 'the done line must not exist').toHaveLength(0);
  });

  // `branchDeleted` IS TOP-LEVEL, NEVER INSIDE `meas` — a second defect this
  // task's brief shipped with, caught the same way as the `gc-prune` one: by
  // running it. `_lc_json`'s own `TOP` tuple (ccd:1331) is
  // `("detail", "refusal", "verb", "branchDeleted")` — the identical shape
  // `lifecycleHelpers.ts`'s `refusalsOf` already documents for `refusal` and
  // `detail` ("TOP-LEVEL on the wire, never inside `meas`"). Reading through
  // `measOf(...)['branchDeleted']` finds nothing there BY CONSTRUCTION, so the
  // first of these two assertions would fail forever and the second — an
  // OMITS check — would pass for the right reason AND for a wrong one (a bug
  // that put `branchDeleted` on the record unconditionally would still read
  // as "omitted" through the wrong accessor). Both now read the event itself.
  it('records branchDeleted as a fact when the branch survives', () => {
    const { wt } = workspace();
    fs.writeFileSync(path.join(wt, 'f.txt'), 'unmerged');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'unmerged');
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    // FIX ROUND 1(c): a hard guard before the dereference, matching the other
    // three tests in this describe. Without it a regression that deletes the
    // `_lc_done` call altogether reds here as a raw
    // `TypeError: Cannot read properties of undefined (reading 'branchDeleted')`
    // instead of a clean assertion message — proven by removing the call and
    // running this file: still red, just with the worse failure shape.
    const [d] = half('destroy', 'done');
    expect(d, 'no done line for ws-rm').toBeTruthy();
    expect(d!['branchDeleted'], 'git refuses an unmerged branch').toBe('false');
  });

  // FIX ROUND 1(d): the `true` state was previously only INFERRED from the
  // shared if/else that the `false` test exercises the other arm of. The
  // record's whole design point is that a wrong answer here is permanent and
  // uncheckable once the workspace is gone, so `true` gets its own direct,
  // end-to-end assertion rather than a deduction: a clean branch (identical
  // to `main`, no divergent commits — `workspace()`'s own default shape),
  // a real `git branch -d` that actually succeeds, and the branch verified
  // gone on the wire AND in git.
  it('records branchDeleted as true when the branch is actually deleted', () => {
    const { main } = workspace();
    h.sh(`${STUB} cmd_ws_rm demo-still-river 2>/dev/null || true`);
    const [d] = half('destroy', 'done');
    expect(d, 'no done line for ws-rm').toBeTruthy();
    expect(d!['branchDeleted'], 'the branch was fully merged and git deleted it').toBe('true');
    expect(h.git(main, 'branch', '--list', 'ws/still-river'), 'the branch is really gone').toBe('');
  });

  it('OMITS branchDeleted when there was no branch at all', () => {
    // Mutant: `[[ -n "$branch" ]] && … && echo false || echo true` -> this
    // fails with `expected 'true' to be undefined`. On a detached-HEAD
    // workspace (`ccd-workspaces.test.ts:970` is the fixture) that expression
    // answers "the branch was deleted" about a workspace that never had one —
    // a fabricated fact on the one record that outlives the workspace.
    const { main } = workspace('demo-detached');
    const wt = path.join(h.home, 'worktrees', 'demo', 'detached');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '--detach', wt);
    h.sh(`_reg_set demo-detached workdir ${wt}; rm -f "$REG/demo-detached.branch"
      _reg_set demo-detached workspace detached`);
    h.sh(`${STUB} cmd_ws_rm demo-detached 2>/dev/null || true`);
    const [d] = half('destroy', 'done');
    expect(d, 'no done line for the detached workspace').toBeTruthy();
    expect(d!).not.toHaveProperty('branchDeleted');
  });
});

describe('forget writes an intent/done pair', () => {
  it('brackets the purge and names the verb', () => {
    h.sh(`_reg_set s uuid u; _reg_set s wrapper claude-corp
      ${STUB} _session_verdict() { echo gone; }
      cmd_forget s`);
    expect(eventsOf(h.home, 'forget').map((e) => e['outcome'])).toEqual(['intent', 'done']);
    const [i, d] = eventsOf(h.home, 'forget');
    expect(i!['tx']).toBe(d!['tx']);
    expect(i!['verb']).toBe('forget');
  });
});

describe('ws-gc --prune writes a pair per destroyed row', () => {
  // ACT IS `destroy`, NOT `gc-prune` — a defect in this task's own brief,
  // caught by running it: `_LC_ACTS` (ccd:842-844) and L0's `LifecycleAct`
  // (shared/api.ts:3396) are a CLOSED, cross-checked vocabulary with no
  // `gc-prune` member, and L0's own doc comment says why — `destroy` is
  // shared by `ws-rm` and `ws-gc --prune` on purpose ("a reader asking what
  // destroyed this must not have to know which ran"); `verb: ws-gc` is what
  // tells the two apart. Passing `gc-prune` silently degrades every event to
  // `act: unknown, badact: gc-prune` (`_lc_emit`, ccd:1418-1419) — invisible
  // to `eventsOf`, which filters by `act`. `lifecycle-vocabulary.test.ts`'s
  // own instruction is explicit: "If it goes red on the SET, fix ccd — never
  // LIFECYCLE_ACTS." So ccd was fixed, not the vocabulary.
  it('brackets the dead-reg purge', () => {
    h.sh(`_reg_set demo-slug uuid u; _reg_purge() { :; }
      _gc_reclaimed() { :; }; _gc_declined() { :; }; _gc_row() { :; }
      GC_RECLAIMED=0; GC_DECLINED=0
      _ws_gc_prune_row dead-reg demo slug /nowhere 0`);
    expect(eventsOf(h.home, 'destroy').map((e) => e['outcome'])).toEqual(['intent', 'done']);
    expect(eventsOf(h.home, 'destroy')[0]!['verb']).toBe('ws-gc');
  });

  it('writes NOTHING for a declined row — a refusal is not a destruction', () => {
    h.sh(`_gc_declined() { :; }; _gc_row() { :; }; GC_RECLAIMED=0; GC_DECLINED=0
      _ws_gc_prune_row foreign-stale demo slug /nowhere 0`);
    expect(eventsOf(h.home, 'destroy')).toHaveLength(0);
  });

  // FIX ROUND 1(b). `cmd_ws_gc --prune`'s row loop (`while … done <<< "$rows"`,
  // ccd:8448-8455) is NOT a subshell, so a real run calls `_ws_gc_prune_row` —
  // and therefore `_lc_tx` — more than once in ONE process. `_lc_tx`'s own
  // uniqueness rests on a fresh `$BASHPID` per `$(...)` fork plus a
  // nanosecond clock read (ccd:868-880), which is structurally safe, but this
  // plan keeps disproving "structurally safe" claims by measurement. Two
  // rows, one process, two independent pairs, and neither pair may borrow the
  // other's tx.
  it('prunes two rows in one process with distinct, correctly paired tx values', () => {
    h.sh(`_reg_set demo-slug-a uuid ua; _reg_set demo-slug-b uuid ub
      _gc_reclaimed() { :; }; _gc_declined() { :; }; _gc_row() { :; }
      GC_RECLAIMED=0; GC_DECLINED=0
      _ws_gc_prune_row dead-reg demo slug-a /nowhere 0
      _ws_gc_prune_row dead-reg demo slug-b /nowhere 0`);
    const events = eventsOf(h.home, 'destroy');
    expect(events, 'two full pairs, one process').toHaveLength(4);
    const aEvents = events.filter((e) => e['id'] === 'demo-slug-a');
    const bEvents = events.filter((e) => e['id'] === 'demo-slug-b');
    expect(aEvents, 'row a wrote exactly its own pair').toHaveLength(2);
    expect(bEvents, 'row b wrote exactly its own pair').toHaveLength(2);
    const aIntent = aEvents.find((e) => e['outcome'] === 'intent');
    const aDone = aEvents.find((e) => e['outcome'] === 'done');
    const bIntent = bEvents.find((e) => e['outcome'] === 'intent');
    const bDone = bEvents.find((e) => e['outcome'] === 'done');
    expect(aIntent, 'row a intent').toBeTruthy();
    expect(aDone, 'row a done').toBeTruthy();
    expect(bIntent, 'row b intent').toBeTruthy();
    expect(bDone, 'row b done').toBeTruthy();
    expect(aIntent!['tx'], 'row a self-pairs').toBe(aDone!['tx']);
    expect(bIntent!['tx'], 'row b self-pairs').toBe(bDone!['tx']);
    expect(aIntent!['tx'], 'the two rows never share a tx').not.toBe(bIntent!['tx']);
  });
});

// D7, restated for THIS task's own additions: the journal is best-effort and
// never gates the act. `_reg_purge`'s own backstop (Task 17,
// `ccd-lifecycle-purge.test.ts`) already proves this for every verb at the
// LAST emit site; what is new here is the intent/fail calls THIS task adds
// BEFORE and AROUND the irreversible act — a regression in any of the four
// would abort a destructive verb on a journal write failure, which is the one
// inversion this whole design exists to forbid. Same fixture shape as
// `ccd-lifecycle-purge.test.ts`'s own "$_LC_DIR unwritable" block: chmod the
// journal directory read-only, run the verb through `spawnSync` so stderr is
// actually inspectable, and prove the destructive act still completed.
describe('none of the four verbs abort when the journal cannot be written (D7)', () => {
  it('ws-rm still removes the workspace', () => {
    const { wt } = workspace();
    const dir = lcDir(h.home);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      r = runContained(h.home, `${STUB} cmd_ws_rm demo-still-river`);
    } finally {
      fs.chmodSync(dir, 0o755);   // restore so afterEach's own cleanup can remove the tree
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(fs.existsSync(wt), 'the worktree was really removed').toBe(false);
    expect.soft(h.reg('demo-still-river', 'uuid'), 'the registry was really purged').toBeNull();
  });

  it('forget still purges the registry entry', () => {
    h.sh(`_reg_set s uuid u; _reg_set s wrapper claude-corp`);
    const dir = lcDir(h.home);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      r = runContained(h.home, `${STUB} _session_verdict() { echo gone; }; cmd_forget s`);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(h.reg('s', 'uuid'), 'the registry was really purged').toBeNull();
  });

  it('ws-gc --prune still purges a dead-reg row', () => {
    h.sh(`_reg_set demo-slug uuid u`);
    const dir = lcDir(h.home);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    let r: ReturnType<typeof spawnSync>;
    try {
      r = runContained(h.home, `_gc_reclaimed() { :; }; _gc_declined() { :; }; _gc_row() { :; }
        GC_RECLAIMED=0; GC_DECLINED=0
        _ws_gc_prune_row dead-reg demo slug /nowhere 0`);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect.soft(h.reg('demo-slug', 'uuid'), 'the registry row was really purged').toBeNull();
  });

  describe('ws-reap', () => {
    // ws-reap is HUMAN-ONLY BY CONTRACT on a live box — this exercises its
    // code path only inside the isolated-HOME harness, exactly as
    // `ccd-ws-reap.test.ts` does throughout; nothing here touches a real
    // tmux or a live session.
    let hr: PrHarness;
    beforeEach(() => { hr = makePrHarness('ccrc-lc-pairs-reap-'); });
    afterEach(() => { hr.cleanup(); });

    const ARCH = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn() { :; };
      _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
      tmux() { return 1; }; _session_verdict() { echo gone; };`;

    /** The full setup `cmd_ws_reap` needs to run for real: a merged PR, an
     *  archived workspace, and a fetched audit token. Factored out — FIX
     *  ROUND 1(a) needs a second scenario sharing every step of it up to the
     *  chmod. */
    const readyForReap = (): { main: string; wt: string; tok: string } => {
      const main = hr.makeGhRepo('demo');
      hr.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
      const wt = path.join(hr.home, 'worktrees', 'demo', 'quiet-basin');
      fs.writeFileSync(path.join(wt, 'f1.txt'), 'work 1\n');
      hr.git(wt, 'add', 'f1.txt'); hr.git(wt, 'commit', '-m', 'work 1');
      const tip = hr.git(wt, 'rev-parse', 'HEAD');
      fs.writeFileSync(path.join(main, 'f1.txt'), 'work 1\n');
      hr.git(main, 'add', '-A'); hr.git(main, 'commit', '-m', 'squash (#42)');
      const merge = hr.git(main, 'rev-parse', 'HEAD');
      hr.git(main, 'push', 'origin', 'main');
      hr.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
      hr.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
      hr.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
      const tok = JSON.parse(hr.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`)).token;
      return { main, wt, tok };
    };

    it('still completes the reap', () => {
      const { main, wt, tok } = readyForReap();
      const dir = lcDir(hr.home);
      fs.mkdirSync(dir, { recursive: true });
      fs.chmodSync(dir, 0o555);
      let r: ReturnType<typeof spawnSync>;
      try {
        r = runContained(hr.home,
          `${GH_STUB} ${ARCH} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
      } finally {
        fs.chmodSync(dir, 0o755);
      }
      expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
      let out: Record<string, unknown> = {};
      expect.soft(() => { out = JSON.parse(String(r.stdout)); }, `stdout: ${r.stdout}`).not.toThrow();
      expect.soft(out['reaped'], `stdout: ${r.stdout}`).toBe('demo-quiet-basin');
      expect.soft(fs.existsSync(wt), 'the worktree was really removed').toBe(false);
      expect.soft(hr.git(main, 'branch', '--list', 'ws/quiet-basin'),
        'the branch was really deleted').toBe('');
    }, 30000);

    // FIX ROUND 1(a). The test above only proves that APPENDING to an
    // EXISTING generation file survives a read-only `.lifecycle` — its own
    // setup (`cmd_ws_add`/`cmd_ws_archive`/`cmd_ws_audit`) mints one before
    // the chmod. The true worst case for `_lc_live` is a directory that is
    // BOTH unwritable AND holds no generation file at all: `_lc_live` cannot
    // mint one there and must return empty, and `_lc_emit`'s own
    // `[[ -n "$live" ]] || { _lc_err; return 0; }` guard has to survive that
    // without dying. Deleting every generation file first, then chmodding
    // with zero files present, is what actually exercises that path — the
    // task report's mutant proof of this exact guard used a synthetic `die`
    // there, not this fixture, so this pins the real scenario in the suite
    // rather than leaving it in a transcript.
    it('still completes the reap with zero generation files and a read-only directory', () => {
      const { main, wt, tok } = readyForReap();
      const dir = lcDir(hr.home);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      expect(generationsOf(hr.home), 'the worst case starts with NO generation file')
        .toHaveLength(0);
      fs.chmodSync(dir, 0o555);
      let r: ReturnType<typeof spawnSync>;
      try {
        r = runContained(hr.home,
          `${GH_STUB} ${ARCH} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
      } finally {
        fs.chmodSync(dir, 0o755);
      }
      expect.soft(r.status, `stderr: ${r.stderr}`).toBe(0);
      let out: Record<string, unknown> = {};
      expect.soft(() => { out = JSON.parse(String(r.stdout)); }, `stdout: ${r.stdout}`).not.toThrow();
      expect.soft(out['reaped'], `stdout: ${r.stdout}`).toBe('demo-quiet-basin');
      expect.soft(fs.existsSync(wt), 'the worktree was really removed').toBe(false);
      expect.soft(hr.git(main, 'branch', '--list', 'ws/quiet-basin'),
        'the branch was really deleted').toBe('');
      expect.soft(generationsOf(hr.home),
        'the directory really was unwritable throughout — nothing got minted').toHaveLength(0);
    }, 30000);
  });
});
