// `_sync_uuid` learns the fork. Claude Code 2.1.278 forks a live session into a
// daemon-hosted bg PTY under a NEW sessionId and leaves the pane process
// publishing the OLD one, so the pane-pid read this function has always done
// cannot see it. The registry is the authority — `--resume` reads it — so it
// follows the transcript's own `continued-in` pointer as well.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { mungePath } from '../src/munge.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('sync-uuid'); });
afterEach(() => { h.cleanup(); });

const A = 'a'.repeat(36), B = 'b'.repeat(36);
const marker = (from: string, to: string): string =>
  `${JSON.stringify({ type: 'continued-in', sessionId: from, continuedInSessionId: to })}\n`;
const turnLine = (text: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

/** A `tail` stub on PATH that records every invocation — the read budget is a
 *  claim about how often this function reads, so the test measures the reads
 *  rather than trusting the comment. Plant it in the harness's own bin dir, the
 *  way the other ccd suites plant stubs, and read the log back here. */
function plantCountingTail(): void {
  const bin = path.join(h.home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'tail'),
    `#!/bin/sh\necho "$@" >> "${path.join(h.home, 'tail-calls')}"\nexec /usr/bin/tail "$@"\n`,
    { mode: 0o755 });
}
const tailCalls = (): string[] => {
  const f = path.join(h.home, 'tail-calls');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
};

const W = 'claude';               // a home-able wrapper from the fixture roster —
                                  // read ccd-acct-pool-state.test.ts for the constant
const ID = 'demo-quiet-basin';

/** The registry row, written through ccd's own setter so this test encodes no
 *  registry layout of its own. */
function row(workdir: string, uuid: string): void {
  h.sh(`_reg_set ${ID} wrapper ${W}; _reg_set ${ID} workdir ${workdir}; _reg_set ${ID} uuid ${uuid}`);
}

/** The project directory Claude Code would write under, asked of ccd rather
 *  than re-derived here — `_munge_wd` is the one spelling of that rule. */
function projectDir(workdir: string): string {
  const cfg = h.sh(`_cfg_dir ${W}`);
  return path.join(cfg, 'projects', h.sh(`_munge_wd "$(_ws_realpath "${workdir}")"`));
}

/** Plant a transcript and age it, so a single tick sees a file that is not
 *  growing. `utimesSync` alone is what makes quiescence testable without
 *  sleeping. */
function plant(workdir: string, uuid: string, body: string): string {
  const d = projectDir(workdir);
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${uuid}.jsonl`);
  writeFileSync(f, body, 'utf8');
  const old = Date.now() / 1000 - 600;
  utimesSync(f, old, old);
  return f;
}

/** BOTH TICKS IN ONE PROCESS. The quiescence memo lives in shell variables,
 *  and `ccd supervise` is one long-lived process per session — two separate
 *  `h.sh` calls are two processes and would never see a second tick at all. */
const ticks = (n: number): string =>
  h.sh(Array.from({ length: n }, () => `_sync_uuid ${ID}`).join('; '));

/** Like `plant`, but the mtime is given rather than derived from "now" — the
 *  only way to make two DIFFERENT files answer the exact same
 *  `stat -c '%s:%Y'` stamp deterministically (two independent `plant()` calls
 *  each computing "600s ago" a few milliseconds apart could straddle a second
 *  boundary and land on different integer mtimes by accident). Review round
 *  F1/F2's shared-stamp fixture needs that coincidence GUARANTEED, not likely. */
function plantAt(workdir: string, uuid: string, body: string, mtimeSec: number): string {
  const d = projectDir(workdir);
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${uuid}.jsonl`);
  writeFileSync(f, body, 'utf8');
  utimesSync(f, mtimeSec, mtimeSec);
  return f;
}

describe('_continued_in_of', () => {
  it('prints the successor named by the last line', () => {
    const f = plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe(B);
  });

  it('prints nothing for a file whose last line is another record', () => {
    const f = plant('/w', A, `${marker(A, B)}${turnLine('after')}`);
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });

  it('prints nothing for a marker another session wrote', () => {
    const f = plant('/w', A, marker('c'.repeat(36), B));
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });

  it('refuses a marker whose sessionId is present but not a valid 36-char uuid', () => {
    // Review round finding: PRESENCE must be VALID, not just present.
    // `"sessionId":"not-a-uuid"` used to extract to the SAME empty string a
    // genuinely absent field produces, and absence-permits then waved the
    // marker through — accepting an author claim this file cannot even
    // parse. The TypeScript reader refuses any author that is not this
    // file's own uuid; a malformed field must refuse too, not fall back to
    // "nobody claimed it".
    const body = `${JSON.stringify({ type: 'continued-in', sessionId: 'not-a-uuid', continuedInSessionId: B })}\n`;
    const f = plant('/w', A, body);
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });

  it('prints nothing for a half-written last line', () => {
    const f = plant('/w', A, marker(A, B).slice(0, 40));
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });

  it('prints nothing when the successor is the file’s own uuid', () => {
    const f = plant('/w', A, marker(A, A));
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });
});

describe('_sync_uuid follows a fork', () => {
  it('leaves the registry alone on the first sight of a transcript', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    ticks(1);
    expect(h.reg(ID, 'uuid')).toBe(A);    // the first tick only records the stamp
  });

  it('writes the successor uuid on the second tick, once the file has proven quiescent', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(B);
  });

  it('never follows a transcript that is still growing', () => {
    row('/w', A);
    const f = plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    // One tick, then the file moves, then another: the stamps never match, so
    // the tail is never read and the registry never moves.
    h.sh(`_sync_uuid ${ID}; touch -m "${f}"; _sync_uuid ${ID}`);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('writes nothing when the successor transcript does not exist', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('writes nothing when the successor exists but is empty', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, '');
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('writes nothing when the registry names a uuid with no transcript at all', () => {
    row('/w', A);
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('reads one tail per quiescence, not one per tick', () => {
    row('/w', A);
    plant('/w', A, turnLine('one'));       // no marker: nothing to follow, ever
    plantCountingTail();
    ticks(4);                               // four ticks, one quiescence, one read
    expect(tailCalls()).toHaveLength(1);
  });

  it('still mirrors the pane pid’s sessionId first, as it always did', () => {
    // The existing /clear-rotation behaviour must be untouched: plant a
    // sessions/<pid>.json naming a THIRD uuid and assert the registry takes it,
    // with the follow running afterwards and finding nothing to do.
    const C = 'c'.repeat(36);
    row('/w', A);
    const cfg = h.sh(`_cfg_dir ${W}`);
    const sdir = path.join(cfg, 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, '4242.json'), JSON.stringify({ sessionId: C, status: 'idle' }));
    const tmuxStub = `tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };`;
    h.sh(`${tmuxStub} _sync_uuid ${ID}`);
    expect(h.reg(ID, 'uuid')).toBe(C);
  });

  it('the pane’s stale sessionId does not undo a chain the follow just wrote', () => {
    // THE PRODUCTION FIXTURE — but no longer an ORDERING fixture, and the
    // sentence that stood here said it was. What it claimed ("THE ONLY
    // FIXTURE THAT DISCRIMINATES ORDER, and it is the production one") was
    // falsified by a later measurement: with the pane-novelty guard in place,
    // BOTH orderings — pane read first then the chain, or the chain first
    // then the pane read — settle identically in every state tried here, so
    // swapping the two statements in `_sync_uuid` leaves this suite green.
    // The ordering is REDUNDANT; the guard is what holds this property, and
    // the whole-branch review's F3 is the proof of how load-bearing that
    // guard is (a restart empties the walk, and only the marker test then
    // stops the pane dragging the registry back). Pane read first is kept
    // because it reads better — a `/clear` is the ordinary case — not
    // because anything depends on it.
    //
    // The shape itself is still exactly production: a forked session's pane
    // process carries on publishing the PRE-FORK id while the fork runs under
    // a new one, and NEVER stops — Claude Code does not rewrite the pane's
    // own sessions file after a fork, so `sid` reads A on every tick, for
    // ever. The pane read is a no-op ONLY BEFORE the chain has moved; after
    // that it is stale BY DEFINITION — that is what a fork is.
    //
    // FIFTH REVIEW ROUND: the two-tick version of this test PASSED while the
    // property its own name claims was false from tick 3 onward — measured:
    // `A C A A A A A A A A` with the pane's write left unconditional. The
    // fix makes the pane's `sessionId` authoritative only when it is NEW
    // INFORMATION: a uuid already on `_CI_WALK` (the chain has already
    // visited it) is not new, it is the stale id the fork left behind, and
    // no longer overwrites the registry.
    //
    // MEASURED with the fix, 10 ticks: `A C C C C C C C C C` — one write,
    // then permanent silence, all ten ticks in ONE process (the walk memo
    // lives in shell variables).
    const C = 'c'.repeat(36);
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    const cfg = h.sh(`_cfg_dir ${W}`);
    const sdir = path.join(cfg, 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, '4242.json'), JSON.stringify({ sessionId: A, status: 'idle' }));
    const tmuxStub = `tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };`;
    const out = h.sh(
      `${tmuxStub} ${Array.from({ length: 10 }, () => `_sync_uuid ${ID}; echo "T:$(_reg_get ${ID} uuid)"`).join('; ')}`,
    );
    const vals = out.split('\n').filter((l) => l.startsWith('T:')).map((l) => l.slice(2));
    expect(vals).toHaveLength(10);
    expect(vals.every((v) => v === A || v === C)).toBe(true);
    expect(vals[1]).toBe(C);   // still writes C at tick 2, as always
    expect(vals[vals.length - 1]).toBe(C);   // and it is STILL C ten ticks later
    expect(vals.slice(1)).toEqual(Array(9).fill(C));   // never reverts to A again
  });

  it('advances past an intermediate transcript that shares a stamp with its predecessor', () => {
    // Review round, F1/F2. A -> B -> C where A's and B's transcripts have the
    // IDENTICAL size and mtime — guaranteed here by `plantAt`'s shared stamp
    // and by `marker(...)` always producing the same byte length regardless
    // of which fixed-length uuids it carries. Keyed by the stamp ALONE, the
    // walk would find "already read" true for B the instant it hops there
    // (B's stamp equals the one just recorded for A) and never read B's own
    // tail — pinned on a dead intermediate transcript forever. Keyed by
    // uuid+stamp, B's arrival is judged on its own two ticks.
    const C = 'c'.repeat(36);
    const stamp = Date.now() / 1000 - 600;
    const bodyA = marker(A, B);
    const bodyB = marker(B, C);
    row('/w', A);
    plantAt('/w', A, bodyA, stamp);
    plantAt('/w', B, bodyB, stamp);
    plant('/w', C, turnLine('three'));
    ticks(4);
    expect(h.reg(ID, 'uuid')).toBe(C);
  });

  it('a hop does not inherit its predecessor’s observation', () => {
    // Second review round finding (V4): a structural variant that keeps
    // `_CI_LAST[id]` as the bare stamp while `_CI_DONE`/`_CI_WALK` keep the
    // full uuid+stamp key stays GREEN on every other fixture in this file,
    // because it only shows on the shared-stamp fixture. A and B share a
    // stamp, so a variant that judges quiescence by the bare stamp alone
    // sees tick 3's "B:sharedStamp" as ALREADY equal to what it recorded at
    // tick 2 (A's bare stamp, identical) — it hops to C a tick early, at
    // tick 3, without ever having judged B's OWN two ticks of quiescence.
    // Measured against that variant: registry reaches C at tick 3, not 4.
    // The fix must observe B in its own right: tick 3 records A's
    // (uuid,stamp) hop, reads A and hops to B, still landing on B; only
    // tick 4 re-observes B as unchanged and reads its own tail to reach C.
    const C = 'c'.repeat(36);
    const stamp = Date.now() / 1000 - 600;
    row('/w', A);
    plantAt('/w', A, marker(A, B), stamp);
    plantAt('/w', B, marker(B, C), stamp);
    plant('/w', C, turnLine('three'));
    // ALL FOUR TICKS IN ONE PROCESS (the memo lives in shell variables — see
    // `ticks`'s own comment), with the tick-3 registry value captured
    // mid-script so both checkpoints are visible without a second process.
    const out = h.sh(
      `_sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; echo "AT3:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "AT4:$(_reg_get ${ID} uuid)"`,
    );
    const at3 = /AT3:(\S+)/.exec(out)?.[1];
    const at4 = /AT4:(\S+)/.exec(out)?.[1];
    expect(at3).toBe(B);
    expect(at4).toBe(C);
  });

  it('a cycle stops without ever completing a second lap', () => {
    // Review round, F1/F2, THEN the second review round's bounded-memo
    // rewrite (`_CI_WALK`). A -> B -> A, with DISTINCT sizes (mtime need not
    // coincide at all here — only the shared-stamp case above needs that).
    //
    // Measured trace over 12 ticks with the CURRENT (bounded-walk)
    // implementation: `a b b b b b b b b b b b` — ONE write (A->B at tick 2),
    // then permanent silence. `_ci_walk_add` records A on the walk the moment
    // it is examined (tick 2); when the chain is next asked to hop B->A
    // (tick 4), A is already on that walk, so the hop is refused BEFORE it
    // happens — the cycle never completes a second lap back to A at all. This
    // is a stricter stop than the first review round's global-set fix, which
    // let the walk return to A once (two writes: A->B, then B->A) before
    // recognising the repeat and going silent from there — both are correct
    // (neither flaps forever), but the exact trace changed with the bounded
    // rewrite, which is why this asserts the MEASURED value rather than the
    // one the previous round measured.
    row('/w', A);
    plant('/w', A, `${turnLine('start-A')}${marker(A, B)}`);   // longer body
    plant('/w', B, marker(B, A));                              // shorter body
    // Checkpoint at tick 4 — the tick where B's second hop (back to A) would
    // fire — is the one that actually discriminates the walk guard: with it,
    // the hop is refused and the registry stays at B; without it (the cycle
    // flapping unboundedly, period 4), tick 4 lands on A. A LATER checkpoint
    // alone does not discriminate reliably — this fixture's flap period is 4
    // ticks, so an assertion at a tick that happens to fall on the same
    // residue the flap would also produce (measured: tick 7's residue is `B`
    // under both the fix and the walk-guard-dropped flap) passes either way
    // and pins nothing. Both ticks are asserted in ONE process.
    const out = h.sh(
      `_sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; echo "AT4:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; echo "AT8:$(_reg_get ${ID} uuid)"`,
    );
    expect(/AT4:(\S+)/.exec(out)?.[1]).toBe(B);
    expect(/AT8:(\S+)/.exec(out)?.[1]).toBe(B);
  });

  it('follows a chain whose CURRENT transcript sits only at the raw spelling', () => {
    // Review round, F4. A workdir reached through a symlink writes its
    // transcript under the RAW (unresolved) munge on this very box —
    // `_transcript_path`'s own rung 2 (`ccd-archive.test.ts`'s "falls to the
    // RAW munge" case, same idiom). `_follow_continued_in` must try the same
    // two spellings for the CURRENT file or a session in this shape is never
    // followed at all — silently, since the pane-pid path cannot see a fork
    // either.
    const real = path.join(h.home, 'volume', 'demo');
    const link = path.join(h.home, 'projects-link');
    mkdirSync(real, { recursive: true });
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(path.join(h.home, 'volume'), link);
    const wd = path.join(link, 'demo');
    row(wd, A);
    const cfg = h.sh(`_cfg_dir ${W}`);
    const rawDir = path.join(cfg, 'projects', mungePath(wd));
    mkdirSync(rawDir, { recursive: true });
    const f = path.join(rawDir, `${A}.jsonl`);
    writeFileSync(f, `${turnLine('one')}${marker(A, B)}`, 'utf8');
    const old = Date.now() / 1000 - 600;
    utimesSync(f, old, old);
    plant(wd, B, turnLine('two'));   // the ordinary (resolved) spelling
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(B);
  });

  it('a cycle longer than the walk cap still terminates, by returning to its origin', () => {
    // Third review round, M1. `_CI_WALK_CAP` is 16; a cycle of 20 distinct
    // uuids outlives it — by the time the walk returns to node 0, the capped
    // walk itself has long since evicted it (it only remembers the last 16).
    // `_CI_ORIGIN` is what still catches this: a single O(1) value, set once
    // per walk and never evicted, so a return to it ends the cycle whatever
    // its length.
    //
    // MEASURED (this exact fixture, 80 ticks, node index after each tick):
    //   0 1 1 2 2 3 3 4 4 5 5 6 6 7 7 8 8 9 9 10 10 11 11 12 12 13 13 14 14
    //   15 15 16 16 17 17 18 18 19 19 19 19 19 ... (stays 19 forever)
    // 19 writes total (one hop per node, node 0 through 19), then PERMANENT
    // silence: the 20th hop (19 -> 0) is refused because 0 is the walk's
    // origin. Without `_CI_ORIGIN` this cycle never terminates at all — it
    // keeps flapping at the pre-memo rate (one write, one 8 KiB tail, every
    // two ticks) because the capped walk alone cannot see that far back.
    const N = 20;
    const uuids = Array.from({ length: N }, (_, i) => `${i.toString(16).padStart(2, '0')}${'0'.repeat(34)}`);
    row('/w', uuids[0]!);
    for (let i = 0; i < N; i++) {
      plant('/w', uuids[i]!, marker(uuids[i]!, uuids[(i + 1) % N]!));
    }
    // 45 ticks is comfortably past the ~40 needed to traverse all 20 nodes
    // (2 ticks/node); 60 more prove it has gone permanently silent rather
    // than merely paused.
    const out = h.sh(
      `${Array.from({ length: 45 }, () => `_sync_uuid ${ID}`).join('; ')}; echo "AT45:$(_reg_get ${ID} uuid)"; `
      + `${Array.from({ length: 60 }, () => `_sync_uuid ${ID}`).join('; ')}; echo "AT105:$(_reg_get ${ID} uuid)"`,
    );
    expect(/AT45:(\S+)/.exec(out)?.[1]).toBe(uuids[19]);
    expect(/AT105:(\S+)/.exec(out)?.[1]).toBe(uuids[19]);
  });

  it('a churning current file cannot flush a distinct uuid off the walk', () => {
    // Third review round, M2. `_ci_walk_add`'s own dedup is load-bearing:
    // without it, a uuid examined repeatedly (its file changes size, goes
    // quiescent, changes size again — the DONE-key differs each time, so
    // each quiescence re-triggers an examination) gets appended to the walk
    // AGAIN on every one of those re-examinations, and once enough
    // duplicates accumulate past the cap, an EARLIER, genuinely distinct
    // uuid falls off the walk — even though it was never revisited, only
    // crowded out.
    //
    // Fixture: O -> X -> CH (settle, 2 ticks each), then CH's file is
    // rewritten 20 times with growing padding before its constant last line
    // (a marker back to X) — CH's own uuid never changes, only its size, so
    // each rewrite is a fresh (uuid, stamp) pair that re-triggers
    // examination and re-attempts the walk_add call. X is NOT the walk's
    // origin (O is), so only `_ci_walk_has(id, X)` — not the origin check —
    // stands between this and a flap back to X.
    //
    // MEASURED with the real code: registry reaches CH after the settle and
    // NEVER moves again, through all 20 churns and 6 more ticks — silence.
    // MEASURED with `_ci_walk_add`'s dedup deleted (same mutant as the
    // table's M2 row): registry stays at CH through churn 1-15, then at
    // churn 16 — the point at which 16 duplicate CH entries have finally
    // flushed X off the capped walk — it flips to X and stays there: one
    // erroneous write the real code never makes.
    const O = 'e'.repeat(36), X = 'f'.repeat(36), CH = '1'.repeat(36);
    row('/w', O);
    plant('/w', O, marker(O, X));
    plant('/w', X, marker(X, CH));
    plant('/w', CH, marker(CH, X));   // initial CH file, so the X->CH hop has somewhere to land
    const chFile = path.join(projectDir('/w'), `${CH}.jsonl`);
    const mk = marker(CH, X).trimEnd();
    const churn = Array.from({ length: 20 }, (_, i) => {
      const n = i + 1;
      return `pad=$(printf 'x%.0s' $(seq 1 ${n})); printf '%s\\n%s' "$pad" '${mk}' > "${chFile}"; `
        + `_sync_uuid ${ID}; _sync_uuid ${ID};`;
    }).join(' ');
    const out = h.sh(
      `_sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; echo "SETTLED:$(_reg_get ${ID} uuid)"; `
      + `${churn} echo "AFTER_CHURN:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; _sync_uuid ${ID}; echo "FINAL:$(_reg_get ${ID} uuid)"`,
    );
    expect(/SETTLED:(\S+)/.exec(out)?.[1]).toBe(CH);
    expect(/AFTER_CHURN:(\S+)/.exec(out)?.[1]).toBe(CH);
    expect(/FINAL:(\S+)/.exec(out)?.[1]).toBe(CH);
  });

  it('a row with no transcript at EITHER spelling resolves ONCE, and still heals when the file appears', () => {
    // Whole-branch review, F7. `_ci_transcript_path` memoized SUCCESSES only,
    // so a row whose transcript is at neither spelling stored nothing and
    // re-paid the whole resolution every five seconds, for ever — a `$( )`
    // fork for the call, `_reg_get`'s own `cat` fork (`ccd/ccd`'s `_reg_get`
    // is a `cat`) and `_ws_realpath`'s subshell. That is not an exotic state:
    // it is every session between a `/clear` and Claude Code's first write.
    //
    // THE COUNTER IS THE MEASUREMENT. `_ci_addrs` is the expensive half —
    // registry read, realpath walk, two munges — so wrapping it counts
    // resolutions directly rather than trusting a comment about forks.
    // MEASURED against the pre-fix code: 6 calls for 6 ticks. With the memo:
    // 1, and the remaining ticks are `[[ -f ]]` builtins on remembered
    // addresses.
    //
    // IT COUNTS INTO A FILE, not a shell variable, and that is not a style
    // choice: every caller reads this function through `addrs=$( … )`, and a
    // command substitution is a SUBSHELL — a `CALLS=$((CALLS+1))` inside it
    // increments a copy that dies with the fork, and the counter reads 0 on
    // the real code and on every mutant alike (measured while building this
    // test: a fixture that could not fail for the reason it names).
    //
    // AND THE SECOND HALF IS WHY A VERDICT MEMO WAS REFUSED: remembering
    // "absent" would be remembering something that stops being true a second
    // later. The same script plants A's transcript mid-run and the chain must
    // still follow it — absence is re-measured every tick; only the ADDRESSES
    // are remembered.
    row('/w', A);
    const dir = projectDir('/w');
    const mkA = marker(A, B).trimEnd();
    const tB = turnLine('two').trimEnd();
    const log = path.join(h.home, 'addrs-calls');
    const wrap = `eval "_ci_addrs_orig() $(declare -f _ci_addrs | tail -n +2)"; `
      + `_ci_addrs() { echo x >> "${log}"; _ci_addrs_orig "$@"; }; `;
    const out = h.sh(
      wrap
      + `${Array.from({ length: 6 }, () => `_sync_uuid ${ID}`).join('; ')}; `
      + `echo "CALLS:$(wc -l < "${log}" 2>/dev/null || echo 0)"; `
      + `mkdir -p "${dir}"; printf '%s\\n' '${mkA}' > "${dir}/${A}.jsonl"; `
      + `printf '%s\\n' '${tB}' > "${dir}/${B}.jsonl"; `
      + `${Array.from({ length: 3 }, () => `_sync_uuid ${ID}`).join('; ')}; echo "HEALED:$(_reg_get ${ID} uuid)"`,
    );
    expect(/CALLS:\s*(\d+)/.exec(out)?.[1]).toBe('1');        // one resolution, not six
    expect(/HEALED:(\S+)/.exec(out)?.[1]).toBe(B);            // and the miss never became permanent
  });

  it('a supervisor RESTART does not let the stale pane regress the registry — not even for one tick', () => {
    // Whole-branch review, F3. `ccrc update`'s step-4 sweep restarts every
    // `claude-session@*` supervisor on a fleet rollout, and every memo in
    // this file lives in shell variables — so the box lands with the registry
    // already at C, the pane still publishing the pre-fork A, and NOTHING
    // remembered. The walk memo cannot help: A reads as "never walked"
    // because the walk is empty.
    //
    // A SEPARATE `h.sh` INVOCATION IS THE RESTART. That is the whole fixture:
    // this file's own `ticks()` helper exists because two `h.sh` calls are two
    // processes, and here that is the point rather than the hazard.
    //
    // MEASURED before the fix: T1 reads `aaa…` — the first tick writes A back
    // and `--resume` time-travels until the chain re-converges, about two
    // ticks per hop, on every rollout. With the fix the registry never leaves
    // C, because A's own transcript ends in a marker naming C and a
    // superseded id is never new information.
    const C = 'c'.repeat(36);
    row('/w', C);                                        // the chain had already converged
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);  // …and A says so itself
    plant('/w', C, turnLine('two'));
    const cfg = h.sh(`_cfg_dir ${W}`);
    const sdir = path.join(cfg, 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, '4242.json'), JSON.stringify({ sessionId: A, status: 'idle' }));
    const tmuxStub = `tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };`;
    const out = h.sh(
      `${tmuxStub} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "T3:$(_reg_get ${ID} uuid)"`,
    );
    expect(/T1:(\S+)/.exec(out)?.[1]).toBe(C);   // THE assertion: not even the first tick
    expect(/T2:(\S+)/.exec(out)?.[1]).toBe(C);
    expect(/T3:(\S+)/.exec(out)?.[1]).toBe(C);
  });

  it('a chain LONGER than the walk cap cannot be dragged back to its origin by a stale pane', () => {
    // Whole-branch review, F5 (parked at the previous round's fix cap, then
    // promoted). `_ci_walk_has` reads a list capped at `_CI_WALK_CAP` = 16,
    // and the walk's ORIGIN is the first uuid evicted from it — which is
    // exactly the uuid a permanently stale pane keeps publishing. So a chain
    // longer than the cap oscillates: measured 37 registry writes in 70 ticks
    // on a 22-hop chain.
    //
    // THE FIXTURE DELETES THE ORIGIN'S TRANSCRIPT, and that is what makes it
    // discriminate the ORIGIN guard rather than F3's marker test. With u0's
    // file still on disk the marker test alone refuses the write, and this
    // test would pass with `_CI_ORIGIN` never consulted. A chain head that
    // has been archived or reaped away — an ordinary fate for a superseded
    // transcript — has no marker left to read, and then the origin is the one
    // thing that still refuses. The deletion happens after the walk has
    // already left u0, so it takes nothing else away.
    //
    // MEASURED without the origin guard: at the tick where the 17th distinct
    // uuid is examined, u0 falls off the capped walk, the pane writes it back,
    // the walk-start reset points everything at u0 — and the chain then
    // STOPS DEAD, because u0's transcript is gone and there is no marker to
    // follow. Final registry: u0, the pre-fork id, for ever. With the guard:
    // u21, the end of the chain.
    const N = 22;
    const uuids = Array.from({ length: N }, (_, i) => `${i.toString(16).padStart(2, '0')}${'0'.repeat(34)}`);
    row('/w', uuids[0]!);
    for (let i = 0; i < N - 1; i++) plant('/w', uuids[i]!, marker(uuids[i]!, uuids[i + 1]!));
    plant('/w', uuids[N - 1]!, turnLine('end'));
    const originFile = path.join(projectDir('/w'), `${uuids[0]}.jsonl`);
    const cfg = h.sh(`_cfg_dir ${W}`);
    const sdir = path.join(cfg, 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, '4242.json'), JSON.stringify({ sessionId: uuids[0], status: 'idle' }));
    const tmuxStub = `tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };`;
    // Six ticks (three hops) of head start, then the chain head is removed,
    // then 70 more — comfortably past the 44 a 22-node chain needs and past
    // the ~35th tick where the cap evicts u0.
    const out = h.sh(
      `${tmuxStub} ${Array.from({ length: 6 }, () => `_sync_uuid ${ID}`).join('; ')}; `
      + `rm -f "${originFile}"; `
      + `${Array.from({ length: 70 }, () => `_sync_uuid ${ID}`).join('; ')}; `
      + `echo "FINAL:$(_reg_get ${ID} uuid)"`,
    );
    expect(/FINAL:(\S+)/.exec(out)?.[1]).toBe(uuids[N - 1]);
  });

  it('_CI_PATH stays at one entry across BOTH a hop and a genuine rotation', () => {
    // Fourth review round, M3's own follow-up: the existing memo-size check
    // (the shared-stamp/cycle fixtures above) never rotates via the pane, so
    // it could not see the reset path's leak — measured before this fix at
    // 50 `_CI_PATH` entries per id after 50 external rotations, because the
    // walk-start reset cleared origin/walk/expect but left the PRIOR uuid's
    // resolved path behind. This fixture does both: A -> B is a real hop
    // (via the chain), then a THIRD uuid Z — never walked, so the pane
    // keeps its ordinary authority over it — is a genuine external
    // rotation, exactly what a real `/clear` looks like from here.
    // ALL OF IT IN ONE PROCESS — `_CI_PATH` lives in shell variables exactly
    // like every other memo here, so a hop in one `h.sh` call followed by a
    // rotation in a SECOND one would start the second call with an empty
    // memo and could never see a leak either way. (Measured while building
    // this test: split across two `h.sh` calls, the assertion below passes
    // whether or not the reset-path eviction exists at all — a test that
    // cannot fail for the reason it names, caught before it was committed.)
    const Z = 'd'.repeat(36);
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    plant('/w', Z, turnLine('four'));   // so Z's OWN path resolves and gets cached too
    const cfg = h.sh(`_cfg_dir ${W}`);
    const sdir = path.join(cfg, 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, '4242.json'), JSON.stringify({ sessionId: Z, status: 'idle' }));
    const tmuxStub = `tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };`;
    const out = h.sh(
      `_sync_uuid ${ID}; _sync_uuid ${ID}; echo "AFTER_HOP:$(_reg_get ${ID} uuid)"; `
      + `${tmuxStub} _sync_uuid ${ID}; echo "AFTER_ROTATE:$(_reg_get ${ID} uuid)"; `
      + `echo "SIZE:\${#_CI_PATH[@]}"`,
    );
    expect(/AFTER_HOP:(\S+)/.exec(out)?.[1]).toBe(B);
    expect(/AFTER_ROTATE:(\S+)/.exec(out)?.[1]).toBe(Z);   // Z was never walked, so it still wins
    expect(/SIZE:(\d+)/.exec(out)?.[1]).toBe('1');
  });
});
