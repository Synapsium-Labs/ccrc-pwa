// PR lineage — the prhistory chokepoint (inside `_pr_py`'s `state` mode, right
// before its one `clear('prnumber')`) and its fold into the archive manifest.
// A NEW FILE rather than an extension of ccd-hold.test.ts: that file's harness
// is the plain `CcdHarness` (no gh stubbing at all — `ccd-hold`'s own header
// says reaching gh there is meant to be visible, not stubbed), where driving
// `cmd_pr_state` needs the PR harness's `GH_STUB`/`ghRows` from
// ccd-pr-state.test.ts's own idiom. Mixing the two into one file would leave
// every existing ccd-hold test one missing `GH_STUB` away from a live gh call.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prhistory-'); });
afterEach(() => { h.cleanup(); });

/** `demo-quiet-basin`, with no commit of its own — the same zero-commit shape
 *  ccd-pr-state.test.ts's "agrees that ahead === 0 …" test uses. `is_ours`
 *  accepts a `headRefOid` equal to the branch's own tip (a commit is an
 *  ancestor of itself), so the fixture needs no extra commit to bind, and
 *  `ahead` stays 0 across every sweep in this file — which is exactly what the
 *  between-waves-gap test needs: gh answering no rows must read as
 *  `no-commits`/`None`, not `none`/`None` for the wrong reason. */
const workspace = (): { id: string; tip: string } => {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  return { id: 'demo-quiet-basin', tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') };
};

const hist = (id: string): unknown[] => {
  const p = path.join(h.home, '.cc-sessions', `${id}.prhistory`);
  return fs.existsSync(p)
    ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
};

/** One `cmd_pr_state --session <id>` sweep, gh answering either a single row
 *  bound to this workspace's branch/base/tip (so `bound`/`is_ours` both pass)
 *  carrying `number`/`state`, or — when `number` is `null` — no PR at all
 *  (`gh pr list` returning `[]`, the "the PR is gone" shape
 *  ccd-pr-state.test.ts's own persistence tests use). Reuses `mergedRow`'s
 *  defaults for every field the predicate reads that this file never varies. */
const runPrStateWithGhAnswering = (
  id: string, tip: string, ans: { number: number | null; state?: string },
): void => {
  h.ghRows(ans.number === null ? [] : [mergedRow({
    number: ans.number, headRefOid: tip,
    ...(ans.state && ans.state !== 'MERGED' ? { state: ans.state, mergedAt: null, mergeCommit: null } : {}),
  })]);
  h.sh(`${GH_STUB} cmd_pr_state --session ${id}`);
};

/** ws-archive reaches tmux and systemd; stub exactly those, the same three
 *  ccd-archive.test.ts's own `ARCH` stubs (and ccd-hold.test.ts's `ARCH`
 *  after it) — `_alive` returning 1 is the affirmative idle `cmd_ws_archive`
 *  demands, and no status file is needed for it: ccd-archive.test.ts archives
 *  a fresh workspace with nothing but this block, repeatedly. */
const ARCH_STUBS = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn() { :; };
  tmux() { return 1; }; _alive() { return 1; };`;

describe('prhistory — the one chokepoint', () => {
  it('appends the outgoing record when prnumber is REPLACED by a different number', () => {
    const { id, tip } = workspace();
    // Sweep 1: gh answers PR #591 merged -> prnumber 591, no history yet.
    runPrStateWithGhAnswering(id, tip, { number: 591, state: 'MERGED' });
    expect(hist(id)).toEqual([]);
    // Sweep 2: gh answers PR #601 open -> 591 retires into history.
    runPrStateWithGhAnswering(id, tip, { number: 601, state: 'OPEN' });
    const rows = hist(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pr: 591, phase: 'merged' });
    expect(typeof (rows[0] as { recordedAt: number }).recordedAt).toBe('number');
  });

  it('does NOT append when the number is unchanged across sweeps', () => {
    const { id, tip } = workspace();
    runPrStateWithGhAnswering(id, tip, { number: 591, state: 'MERGED' });
    runPrStateWithGhAnswering(id, tip, { number: 591, state: 'MERGED' });
    expect(hist(id)).toEqual([]);
  });

  it('appends when a real number gives way to NO number — the between-waves gap must not lose the record', () => {
    const { id, tip } = workspace();
    runPrStateWithGhAnswering(id, tip, { number: 591, state: 'MERGED' });
    runPrStateWithGhAnswering(id, tip, { number: null });   // branch reset for wave 2, PR not yet opened
    expect(hist(id)).toHaveLength(1);
    expect(hist(id)[0]).toMatchObject({ pr: 591 });
    // And the next real PR does not re-append 591:
    runPrStateWithGhAnswering(id, tip, { number: 601, state: 'OPEN' });
    expect(hist(id)).toHaveLength(1);
  });

  it('ws-archive folds the history into the manifest', () => {
    const { id } = workspace();
    h.sh(`printf '%s\\n' '{"pr":577,"branch":"ws/demo","phase":"merged","recordedAt":1786000000}' `
      + `> "$HOME/.cc-sessions/${id}.prhistory"`);
    h.sh(`${ARCH_STUBS} cmd_ws_archive --session ${id}`);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.archivemanifest`), 'utf8'));
    expect(manifest.prHistory).toEqual([{ pr: 577, branch: 'ws/demo', phase: 'merged', recordedAt: 1786000000 }]);
  });

  it('a corrupt prhistory line does not break the manifest — it degrades to [] with the raw file left intact', () => {
    const { id } = workspace();
    h.sh(`printf 'not json\\n' > "$HOME/.cc-sessions/${id}.prhistory"`);
    h.sh(`${ARCH_STUBS} cmd_ws_archive --session ${id}`);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.archivemanifest`), 'utf8'));
    expect(manifest.prHistory).toEqual([]);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.prhistory`), 'utf8')).toContain('not json');
  });

  it('an absent prhistory file folds to [] too — never a refusal', () => {
    const { id } = workspace();
    h.sh(`${ARCH_STUBS} cmd_ws_archive --session ${id}`);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.archivemanifest`), 'utf8'));
    expect(manifest.prHistory).toEqual([]);
  });
});

// Fix-round finding 2. A ledger that EXISTS and cannot be READ is not a parse
// failure and must not read as `[]` — `[]` here is the most reassuring answer
// there is ("this workspace retired no PRs") in the record whose own header
// says a manifest that lies pristine is a manifest that authorises a deletion.
// The pre-fix `except Exception` collapsed absent, malformed and unopenable
// into that one value at exit 0; both tests below FAIL against it (they got
// rc 0 and a manifest carrying `"prHistory":[]`).
describe('an unreadable prhistory refuses — it is not an empty one', () => {
  const ledger = (id: string): string => path.join(h.home, '.cc-sessions', `${id}.prhistory`);

  const expectRefusal = (id: string): void => {
    const r = h.run(`${ARCH_STUBS} cmd_ws_archive --session ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/PR ledger/);
    // NOTHING WAS TOUCHED, which is the half a bare rc check would miss: no
    // manifest on disk, and — because `cmd_ws_archive` refuses before its
    // markers go down — no `archived`/`archivedreason` either, so the next
    // sweep re-tries instead of filing the workspace as archived on a record
    // it could not tell truthfully.
    expect(h.reg(id, 'archivemanifest')).toBeNull();
    expect(h.reg(id, 'archived')).toBeNull();
    expect(h.reg(id, 'archivedreason')).toBeNull();
  };

  it('chmod 000 on the ledger refuses the archive rather than folding []', () => {
    const { id } = workspace();
    h.sh(`printf '%s\\n' '{"pr":577,"branch":"ws/quiet-basin","phase":"merged","recordedAt":1786000000}' `
      + `> "$HOME/.cc-sessions/${id}.prhistory"`);
    fs.chmodSync(ledger(id), 0o000);
    try {
      expectRefusal(id);
      // The raw ledger is still on disk, unread and undeleted — the refusal
      // costs the archive, never the lineage.
      expect(fs.existsSync(ledger(id))).toBe(true);
    } finally {
      // rmSync in the harness cleanup can unlink a 0o000 file, but the mode is
      // restored anyway so a failure here leaves a readable fixture behind.
      fs.chmodSync(ledger(id), 0o600);
    }
  });

  it('a DIRECTORY at the ledger path refuses too — the root-proof shape of the same fault', () => {
    // `chmod 000` is readable to uid 0, so on a root CI box that test alone
    // would silently stop exercising the rung. `open()` on a directory raises
    // IsADirectoryError for every uid, and it is the same OSError arm.
    const { id } = workspace();
    fs.mkdirSync(ledger(id));
    expectRefusal(id);
    expect(fs.statSync(ledger(id)).isDirectory()).toBe(true);
  });
});

// Fix-round finding 1. CHARACTERIZATION, DISCLOSED: both of these pass against
// the pre-fix ccd as well, because the defect was in the prose — the comment
// above the field claimed the manifest is "the one record ws-reap later reads"
// and that the lineage therefore outlives the worktree, and this file disproves
// both. There is no behaviour change to catch, so what these pin is the pair of
// mechanisms the CORRECTED comment asserts: a future change that alters either
// one breaks a test here instead of quietly making the contract false again.
describe('what the folded lineage outlives', () => {
  it('the reap purge takes the manifest AND the raw ledger — neither outlives a reap', () => {
    const { id } = workspace();
    h.sh(`printf '%s\\n' '{"pr":577,"branch":"ws/quiet-basin","phase":"merged","recordedAt":1786000000}' `
      + `> "$HOME/.cc-sessions/${id}.prhistory"`);
    h.sh(`${ARCH_STUBS} cmd_ws_archive --session ${id}`);
    expect(h.reg(id, 'archivemanifest')).not.toBeNull();
    // The document that DOES outlive a reap, written at (b) — its field list is
    // fixed and `prHistory` is not in it, which is the half of the corrected
    // comment a purge assertion alone cannot show. The REAP_* globals are the
    // ones `_ws_reap_eval` populates before calling it; seeded here because
    // this test drives the writer, not the phase in front of it.
    const tomb = h.sh(`REAP_IGNORED=(); REAP_CHILDLINES=""; REAP_TIP=deadbee; REAP_MERGE=cafe;
      REAP_PROOF=merged; REAP_PRNUM=577; REAP_PRURL=https://example/577; REAP_SENSITIVE=();
      _ws_tombstone ${id} '[]' >/dev/null; cat "$HOME/.cc-sessions/.reaped/${id}.json"`);
    expect(JSON.parse(tomb)).not.toHaveProperty('prHistory');
    // Step (i) of `_ws_reap_tail`, called directly — the tail's own fixture
    // lives in ccd-ws-reap.test.ts; what is under test here is only which
    // files the purge's dot-free-suffix filter matches.
    h.sh(`_reg_purge ${id}`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.prhistory`))).toBe(false);
    expect(h.reg(id, 'archivemanifest')).toBeNull();
  });

  it('ws-restore takes the manifest and LEAVES the ledger — prhistory intact', () => {
    // The spec's own recovery path for an over-eagerly archived workspace
    // ("recoverable via ws-restore, prhistory intact"): the manifest is a
    // record OF an archive and goes with it, the ledger belongs to the
    // workspace and stays, so the re-archive after wave 2 is complete.
    const { id } = workspace();
    h.sh(`printf '%s\\n' '{"pr":577,"branch":"ws/quiet-basin","phase":"merged","recordedAt":1786000000}' `
      + `> "$HOME/.cc-sessions/${id}.prhistory"`);
    h.sh(`${ARCH_STUBS} cmd_ws_archive --session ${id}`);
    h.sh(`${ARCH_STUBS} cmd_ws_restore --session ${id}`);
    expect(h.reg(id, 'archivemanifest')).toBeNull();
    expect(h.reg(id, 'archived')).toBeNull();
    expect(hist(id)).toEqual([{ pr: 577, branch: 'ws/quiet-basin', phase: 'merged', recordedAt: 1786000000 }]);
  });
});
