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
