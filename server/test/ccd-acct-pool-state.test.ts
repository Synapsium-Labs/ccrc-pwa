// `$REG/pool-epoch` — the account-pool PROJECTION's reader, the account side's
// answer to `_project_pool_state`'s question. Modelled on
// `server/test/ccd-project-pool.test.ts:1-88` — see that file's own header
// for why a fresh `CcdHarness` per test (not a shared one with a `.reset()`)
// is the idiom: `CcdHarness` exposes no `reset()`, only `cleanup()`.
//
// Fix round 1 (coordinator review of the original Task 1 submission) dropped
// the process memoisation entirely (T1-R1 — `_pool_ok` calls this through a
// `$( )` command substitution, which forks a subshell, so a cache built
// there never reaches the caller) and hardened the reader against six
// measured fail-open defects (C1, I2-I6, M1-M3). This file's cases below are
// organised to match that review, each one commented with the finding it
// pins.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('acct-pool-state'); });
afterEach(() => { h.cleanup(); });

/** Plant the projection with the given body; returns its path. */
function plant(body: string): string {
  const reg = path.join(h.home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const f = path.join(reg, 'pool-epoch');
  writeFileSync(f, body, 'utf8');
  return f;
}
const state = (id: string): string => h.sh(`_acct_pool_state ${id}`);

describe('_acct_pool_state', () => {
  it('answers `unreadable` when the file does not exist — absence is NOT untagged', () => {
    expect(state('acct-a')).toBe('unreadable');
  });

  it('answers `untagged` for a synced document that tags nobody', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\n');
    expect(state('acct-a')).toBe('untagged');
  });

  it('answers `named <n>` for a tagged account', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('named pool-a');
  });

  it('answers `untagged` for an account the document does not name', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-b')).toBe('untagged');
  });

  it('answers `stale` past the lease — and `stale` is NOT `unreadable`', () => {
    plant('epoch 43\nissued 1000\nlease 1001\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('stale');
  });

  it('answers `malformed` for a pool name off the grammar', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a Pool_A\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `malformed` when the document carries no epoch line', () => {
    plant('acct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `malformed` for a line whose key this reader does not recognise', () => {
    // The `*)` wildcard arm, not `epoch`/`issued`/`lease`/`acct`/blank — a
    // document shape this reader cannot parse must not be served as fact,
    // exactly like an off-grammar pool name poisons the whole document.
    plant('epoch 1\nissued 1\nlease 9\nbogus x\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `unreadable` when the file exists but cannot be read', () => {
    const f = plant('epoch 43\nissued 1000\nlease 9999999999\n');
    chmodSync(f, 0o000);
    expect(state('acct-a')).toBe('unreadable');
  });

  // A `$REG`-unsearchable case was deliberately NOT included here (pre-flight
  // ruling 2, task-1-report.md): with no `pool-epoch` file planted, the
  // `-e "$f"` file-absence check ALSO reads false under an unsearchable
  // `$REG` (the OS denies the stat before the reader's own `-d && -x` guard
  // is even reached), so the verdict comes out `unreadable` whether or not
  // that guard exists — verified by neutralising the guard directly (`true
  // || { …unreadable… }`) and observing every case, including this shape,
  // stay green. A test that cannot fail for the reason it names is worse
  // than no test; deleted rather than kept as decoration.

  // T1-R1 / M4: the process-memoisation behavioural test ("reads the file
  // ONCE — a second call answers from memory, not the disk") is GONE, not
  // merely renamed. It pinned a cache that could never work in the shape
  // `_pool_ok` actually calls this in (a `$( )` subshell), so keeping it
  // around — even fixed — would pin a design fix round 1 reverted. Mutation
  // row 5 (the old load-guard mutation) is deleted with it; there is no
  // more load guard to mutate.

  // --- C1: an indented line must not be swallowed as blank ---
  it('answers `malformed` for an `acct` line with a leading space, not `untagged`', () => {
    // `k=${line%% *}` on a leading-space line yields the empty string — the
    // SAME `$k` a genuinely blank line produces — so the old blank-line arm
    // swallowed it and the account read `untagged`: the fail-open the whole
    // design exists to prevent.
    plant('epoch 43\nissued 1000\nlease 9999999999\n acct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `malformed` for an `acct` line with a leading tab, not `untagged`', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\n\tacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  // --- I2: an embedded NUL byte must not fabricate a legal token ---
  it('answers `malformed` when an `acct` row carries an embedded NUL byte', () => {
    // The reviewer's own measured case: `acct acct-a pool\0-a` used to
    // answer `named pool-a` — a token that appears NOWHERE in the file,
    // because bash drops the NUL once the bytes reach a normal string.
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool\0-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  // --- I3: the document is size-capped, never read unbounded ---
  it('answers `malformed` for a document over the 64 KiB cap, even if every row is otherwise legal', () => {
    // Every row here is independently well-formed (`acct acct-<n> pool-a`),
    // and the queried id is not among them — so an UNCAPPED reader would
    // correctly and legitimately answer `untagged`. Answering `malformed`
    // instead is the cap firing, not some other guard: proof the size gate
    // is real and not merely load-bearing prose.
    const rows = Array.from({ length: 4000 }, (_, i) => `acct acct-${i} pool-a`).join('\n');
    const body = `epoch 43\nissued 1000\nlease 9999999999\n${rows}\n`;
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(65536);
    plant(body);
    expect(state('ghost-account')).toBe('malformed');
  });

  // --- I4: a truncated `acct` row must not fabricate a tag ---
  it('answers `malformed` for an `acct` row missing its pool field', () => {
    // `${v#* }` on `acct-a` (no space left to strip) used to hand
    // `_pool_name_valid` the ACCOUNT ID as if it were the pool name.
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('answers `malformed` for a bare `acct` row with nothing after it', () => {
    // Same defect, more truncated still: `${v#* }` on the literal word
    // `acct` used to hand `_pool_name_valid` the word `acct` itself.
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct\n');
    expect(state('acct-a')).toBe('malformed');
  });

  // --- I5: an empty/absent id must not touch the filesystem or leak stderr ---
  it('answers `untagged` for an absent id, with nothing on stderr', () => {
    // No file planted at all: if the guard is missing, indexing an unset
    // `$1` prints `bad array subscript` to stderr and falls through to
    // `untagged` anyway — same stdout, but the stderr leaks into a `$( )`
    // capture in the real caller. Capturing stderr here is what makes this
    // test able to see that difference; a bare stdout check could not.
    const out = h.sh('{ _acct_pool_state; } 2>&1');
    expect(out).toBe('untagged');
  });

  // --- M2: `issued` is validated numeric exactly like `epoch` ---
  it('answers `malformed` when `issued` is not numeric', () => {
    plant('epoch 43\nissued abc\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  // --- M3: two `acct` rows for the same id is a self-contradictory document ---
  it('answers `malformed` for a duplicate `acct` row naming the same id twice', () => {
    plant(
      'epoch 43\nissued 1000\nlease 9999999999\n'
      + 'acct acct-a pool-a\nacct acct-a pool-b\n');
    expect(state('acct-a')).toBe('malformed');
  });
});
