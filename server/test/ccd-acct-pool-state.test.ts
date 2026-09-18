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

/** Like `state()`, but also returns the REAL exit code — `h.sh` alone only
 *  sees stdout, so a defect that empties stdout AND breaks rc (fix round 2's
 *  C2 — a `bad array subscript` unwinding the whole function) is invisible
 *  to a word-only assertion. `echo "RC:$?"` runs whether or not
 *  `_acct_pool_state` itself produced any stdout — ccd has no `set -e`, so a
 *  failing statement inside it does not abort the surrounding `;` list. */
function stateRc(id: string): { out: string; rc: number } {
  const raw = h.sh(`_acct_pool_state ${id}; echo "RC:$?"`);
  const lines = raw.split('\n');
  const last = lines.pop() ?? '';
  const m = /^RC:(-?\d+)$/.exec(last);
  if (!m) throw new Error(`stateRc(${id}): no RC line in [${raw}]`);
  return { out: lines.join('\n'), rc: Number(m[1]) };
}

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

  // ============================================================
  // Fix round 2 (re-review of round 1's own new lines) — C2-C4, M5-M7.
  // ============================================================

  // --- C2: an empty id after the split must not reach `seen`, and the
  // "always rc 0" contract must hold even when it is refused ---
  it('C2: two spaces after `acct` (empty id) answers `malformed` at rc 0, not empty stdout at rc 1', () => {
    // Measured before this fix: `${v%% *}` on an all-whitespace remainder
    // strips it to nothing, so `v` (the id) comes out EMPTY; indexing
    // `seen[$v]`/`seen[$v]=1` with an empty subscript is `bad array
    // subscript`, a hard bash error that unwinds the WHOLE function —
    // empty stdout, rc 1. `{1,64}` in C4's grammar requires at least one
    // character, so the id-grammar check below closes this before `seen`
    // is ever touched.
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct  pool-a\n');
    const { out, rc } = stateRc('acct-a');
    expect(out).toBe('malformed');
    expect(rc).toBe(0);
  });

  // --- C3: epoch/issued/lease must refuse a leading zero, never parse it as octal ---
  it('C3: a leading-zero `lease` is refused in the grammar, never reaches the octal `((  ))`', () => {
    // Measured before this fix: `lease 0000000009` (expired in 1970) threw
    // `value too great for base` inside `(( now > lease ))` — bash reads a
    // leading-zero operand as octal, and `9` is not a valid octal digit —
    // and because that arithmetic error does not abort the function, fell
    // through the (skipped) stale gate to `named pool-a`, serving an
    // expired tag as current.
    plant('epoch 43\nissued 1000\nlease 0000000009\nacct acct-a pool-a\n');
    const { out, rc } = stateRc('acct-a');
    expect(out).toBe('malformed');
    expect(rc).toBe(0);
  });

  it('C3: a leading-zero `epoch` is refused', () => {
    plant('epoch 007\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('C3: a leading-zero `issued` is refused', () => {
    plant('epoch 43\nissued 007\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('C3: a bare `0` (not leading-zero-padded) is still a legal numeric value', () => {
    // The grammar is `^(0|[1-9][0-9]*)$`, not "no zero anywhere" — the
    // single digit `0` is the one legal way to spell zero.
    plant('epoch 0\nissued 0\nlease 9999999999\n');
    expect(state('acct-a')).toBe('untagged');
  });

  // --- C4: the account-id field is validated against the same grammar
  // Task 3's writer uses, and an off-grammar id poisons the document ---
  it('C4: an id with an embedded tab is refused, not silently discarded to `untagged`', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct \tacct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('C4: a quoted id is refused, not silently discarded to `untagged`', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct "acct-a" pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('C4: a glob-shaped id is refused, not silently discarded to `untagged`', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct */.. pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('C4: an uppercase id is WITHIN the grammar — a different, well-formed id, not a poison', () => {
    // `^[A-Za-z0-9._-]{1,64}$` allows both cases, matching Task 3's writer
    // exactly. `ACCT-A` is a legitimate row for a DIFFERENT account than
    // the one queried, so this document is well-formed and the query for
    // the lowercase `acct-a` correctly reads `untagged` — not `malformed`.
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct ACCT-A pool-a\n');
    expect(state('acct-a')).toBe('untagged');
  });

  // --- M7: duplicate epoch/issued/lease lines are self-contradictory too ---
  it('M7: a duplicate `epoch` line is a self-contradictory document', () => {
    plant('epoch 43\nepoch 44\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('M7: a duplicate `issued` line is a self-contradictory document', () => {
    plant('epoch 43\nissued 1000\nissued 1001\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('M7: a duplicate `lease` line is a self-contradictory document', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nlease 8888888888\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  // --- rc-0 sweep across every `malformed` shape this round touched ---
  it('every `malformed` verdict stays rc 0, swept across this round\'s shapes', () => {
    // The reviewer's own point: a word-only assertion misses an rc
    // violation entirely (C2 produced EMPTY stdout, which no existing
    // `toBe('malformed')` check could have distinguished from a passing
    // test that merely forgot to plant a fixture). Each shape here is
    // independently pinned above; this sweep is the general net.
    const shapes = [
      'epoch 43\nissued 1000\nlease 9999999999\nacct acct-a Pool_A\n',        // bad pool grammar
      'epoch 43\nissued 1000\nlease 9999999999\nacct  pool-a\n',              // C2: empty id
      'epoch 43\nissued 1000\nlease 0000000009\nacct acct-a pool-a\n',        // C3: octal lease
      'epoch 43\nissued 1000\nlease 9999999999\nacct \tacct-a pool-a\n',      // C4: tab in id
      'epoch 43\nissued 1000\nlease 9999999999\nacct "acct-a" pool-a\n',      // C4: quoted id
      'epoch 43\nepoch 44\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n', // M7: dup epoch
    ];
    for (const body of shapes) {
      plant(body);
      const { out, rc } = stateRc('acct-a');
      expect(out).toBe('malformed');
      expect(rc).toBe(0);
    }
  });
});
