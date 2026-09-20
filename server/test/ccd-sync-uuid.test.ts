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
    // THE ONLY FIXTURE THAT DISCRIMINATES ORDER, and it is the production one:
    // a forked session's pane process carries on publishing the PRE-FORK id
    // while the fork runs under a new one. Pane read first, chain second, and
    // the pane read is a harmless no-op. Reverse them and the pane drags the
    // registry back off the successor on every tick — the follow writes, the
    // pane undoes, for ever. Every other fixture in this file answers the same
    // uuid under both orders, which is why nothing pinned this until now.
    const C = 'c'.repeat(36);
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    const cfg = h.sh(`_cfg_dir ${W}`);
    const sdir = path.join(cfg, 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, '4242.json'), JSON.stringify({ sessionId: A, status: 'idle' }));
    const tmuxStub = `tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };`;
    h.sh(`${tmuxStub} _sync_uuid ${ID}; _sync_uuid ${ID}`);
    expect(h.reg(ID, 'uuid')).toBe(C);
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
});
