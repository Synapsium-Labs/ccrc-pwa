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

/** Plant the projection with the given body EXACTLY as given — no
 *  terminator is added. Used only where a test needs precise control over
 *  whether `end` is present, which is the T1-R3 terminator's own tests. */
function plantRaw(body: string): string {
  const reg = path.join(h.home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const f = path.join(reg, 'pool-epoch');
  writeFileSync(f, body, 'utf8');
  return f;
}

/** Plant the projection with the given body PLUS its required terminator
 *  (T1-R3, fix round 3) — every fixture in this file except the
 *  terminator's own tests wants a well-formed document, and retyping
 *  `\nend\n` at ~30 call sites would just be noise. */
function plant(body: string): string {
  return plantRaw(body.endsWith('\n') ? `${body}end\n` : `${body}\nend\n`);
}
const state = (id: string): string => h.sh(`_acct_pool_state ${id}`);

/** Like `state()`, but also returns the REAL exit code — `h.sh` alone only
 *  sees stdout, so a defect that empties stdout AND breaks rc (fix round 2's
 *  C2 — a `bad array subscript` unwinding the whole function) is invisible
 *  to a word-only assertion.
 *
 *  FIX ROUND 3 CORRECTION: this comment used to claim `echo "RC:$?"` runs
 *  "whether or not `_acct_pool_state` produced any stdout — ccd has no
 *  `set -e`, so a failing statement inside it does not abort the
 *  surrounding `;` list." That is FALSE for the exact shape C2 measures,
 *  and the false claim is exactly M1's own standard turned back on this
 *  file. Measured directly: with the id-grammar guard deleted, a bad array
 *  subscript is fatal to the WHOLE invoking shell — neither `RC:` nor a
 *  trailing `echo AFTER` ever runs, and `h.sh` (whose `execFileSync`
 *  throws on a nonzero exit) throws instead of returning truncated
 *  output.
 *
 *  FIX ROUND 4 CORRECTION: this comment used to attribute that fatality
 *  to the statement living inside a SOURCED file — a measured claim, but
 *  one whose control was not isolated (two variables moved at once,
 *  sourced-vs-inline AND which statement, and the effect landed on the
 *  wrong one). Re-measured on four cells, crossing read-only
 *  (`${seen[$v]+x}`) vs. the assignment (`seen[$v]=1`) with inline-in-`-c`
 *  vs. sourced: the fatal statement is the ASSIGNMENT `seen[$v]=1`, not
 *  the read `${seen[$v]+x}` that precedes it — bash treats a bad
 *  subscript in an assignment as a fatal expansion error that exits a
 *  non-interactive shell, while the same bad subscript in a parameter
 *  expansion merely prints and yields empty. This is identical whether
 *  `ccd` is sourced or the function is defined inline, and independent of
 *  `set -e` and `set -u`. The pin below still holds either way: it is
 *  `h.sh`'s `execFileSync` throwing on the nonzero exit, not a printed
 *  `RC:` line, that fails the assertion when this shape regresses. */
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
  it('answers `unreadable` for an absent id, with nothing on stderr', () => {
    // No file planted at all: if the guard is missing, indexing an unset
    // `$1` prints `bad array subscript` to stderr and falls through
    // regardless — the stderr leaks into a `$( )` capture in the real
    // caller. Capturing stderr here is what makes this test able to see
    // that difference; a bare stdout check could not.
    //
    // T1-R4 (fix round 3): the WORD changed from `untagged` to
    // `unreadable` — see the T1-R4 test below for why, and for the
    // measurement that distinguishes them on the same document.
    const out = h.sh('{ _acct_pool_state; } 2>&1');
    expect(out).toBe('unreadable');
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

  // ============================================================
  // Fix round 3 (second re-review) — the M7 predicate hole, the document
  // terminator (T1-R3, plus the security-scanner addendum), and T1-R4.
  // ============================================================

  // --- M7's guard used EMPTINESS as its "not seen yet" proxy, which has a
  // hole: a malformed `lease` line with an EMPTY value reads as unseen ---
  it('fix round 3: a malformed empty `lease` line no longer lets a later real one silently win', () => {
    // Measured before this fix: `lease \nlease 9999999999\n…` answered
    // `named pool-a`. `-z "$lease"` could not tell "never saw a lease
    // line" from "saw one that was empty (malformed)" — the SECOND, valid
    // line passed the (broken) dup check and silently overwrote the first.
    // Two defects in one hole: a duplicate that should refuse instead won,
    // and a malformed empty row that should refuse was silently discarded
    // — C1/C4's class, one more field over.
    plant('epoch 43\nissued 1000\nlease \nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  // --- T1-R3: the document terminator, distinct claims kept as distinct tests ---
  it('T1-R3: a document with NO `end` line at all is malformed', () => {
    // Distinct from the torn-row test below on purpose — one guard proving
    // two different claims means a regression cannot tell you which one
    // broke.
    plantRaw('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('T1-R3: a document torn mid-`acct`-row no longer fabricates `named <prefix>`', () => {
    // The reviewer's own measured case: `acct acct-a pool-alp` with no
    // trailing newline (and, by construction here, no terminator either)
    // used to answer `named pool-alp` — a POSITIVE word naming a pool the
    // file never finished spelling, with PLACEMENT proceeding onto it.
    plantRaw('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-alp');
    expect(state('acct-a')).toBe('malformed');
  });

  it('T1-R3: the minimum well-formed document is four lines — zero `acct` rows, still legal', () => {
    plantRaw('epoch 43\nissued 1000\nlease 9999999999\nend\n');
    expect(state('acct-a')).toBe('untagged');
  });

  it('T1-R3: `end` with no trailing newline is still accepted, matching the per-line loop\'s own tolerance', () => {
    plantRaw('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\nend');
    expect(state('acct-a')).toBe('named pool-a');
  });

  it('T1-R3: content after `end`, even a trailing blank line, is refused', () => {
    plantRaw('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a pool-a\nend\n\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('T1-R3: a stray `end`-prefixed line before the true terminator poisons the document', () => {
    plantRaw('epoch 43\nissued 1000\nend extra\nlease 9999999999\nacct acct-a pool-a\nend\n');
    expect(state('acct-a')).toBe('malformed');
  });

  // --- Security-scanner addendum: position AND cardinality, not just presence ---
  it('addendum: `end` appearing mid-document, with a second `end` truly last, is two documents concatenated — refused', () => {
    // Checking only "the last line is `end`" would accept this: it IS
    // `end` on the last line. The document is still broken — a torn write
    // landing inside a previous one, or two documents concatenated — and
    // only a count, not a position check alone, can see it. `epoch`,
    // `issued` and `lease` each appear exactly ONCE here, deliberately —
    // so this fails ONLY via the new `endSeen` guard, not incidentally via
    // M7's unrelated duplicate-field checks, which a document with two
    // full concatenated headers would also trip.
    plantRaw('epoch 43\nissued 1000\nlease 9999999999\nend\nacct acct-a pool-a\nend\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('addendum: `end` with a value (`end 1`) is refused — the terminator takes no argument', () => {
    // Placed BEFORE the true terminator, deliberately: as the document's
    // OWN last line, the up-front structural check alone would already
    // refuse this (its last line is `end 1`, not `end`), which would pin
    // that check instead of the per-line `[[ "$v" == end ]]` one. Mid-
    // document, the structural check passes (the true last line genuinely
    // is `end`), so only the per-line check can catch this shape.
    plantRaw('epoch 43\nissued 1000\nend 1\nlease 9999999999\nacct acct-a pool-a\nend\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('addendum: `end` with a trailing space and nothing after it is refused', () => {
    plantRaw('epoch 43\nissued 1000\nend \nlease 9999999999\nacct acct-a pool-a\nend\n');
    expect(state('acct-a')).toBe('malformed');
  });

  it('addendum: a pool literally named `end` is unambiguous — parsed as a payload value, not the terminator', () => {
    // `^[a-z][a-z0-9-]{0,31}$` legally admits `end`. The reader keys on the
    // FIRST token of the line (`acct`, not `end`), so there is no
    // confusion — confirmed, not assumed.
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct acct-a end\n');
    expect(state('acct-a')).toBe('named end');
  });

  it('addendum: an account id literally named `end` is unambiguous — parsed as a payload value, not the terminator', () => {
    plant('epoch 43\nissued 1000\nlease 9999999999\nacct end pool-a\n');
    expect(state('end')).toBe('named pool-a');
  });

  // --- T1-R4: an empty/absent id is unmeasurable, not untagged ---
  it('T1-R4: an absent id answers `unreadable`, distinguishable from a real id\'s `stale` on the SAME document', () => {
    // Measured: against an EXPIRED document, a real id correctly answers
    // `stale`; an ABSENT id used to answer `untagged` on the SAME
    // document — a positive word with no document behind it at all. An
    // account this function cannot even NAME is unmeasurable, not
    // untagged; `unreadable` is the fail-shut direction and reuses the
    // existing vocabulary rather than inventing a sixth word.
    plant('epoch 43\nissued 1000\nlease 1001\nacct acct-a pool-a\n');
    expect(state('acct-a')).toBe('stale');
    const out = h.sh('{ _acct_pool_state; } 2>&1');
    expect(out).toBe('unreadable');
  });
});
