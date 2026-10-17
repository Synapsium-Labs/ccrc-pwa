// `_sync_uuid` learns the fork. Claude Code 2.1.278 forks a live session into a
// daemon-hosted bg PTY under a NEW sessionId and leaves the pane process
// publishing the OLD one, so the pane-pid read this function has always done
// cannot see it. The registry is the authority — `--resume` reads it — so it
// follows the transcript's own `continued-in` pointer as well.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness, WIDE_PANE_IF_UP } from './ccdWsHelpers.js';
import { mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync, symlinkSync, appendFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { mungePath } from '../src/munge.js';
import { eventsOf } from './lifecycleHelpers.js';

/** A pane tmux cannot find — `_ws_status` reads it idle (D-5240's manual swap gate). */
const GONE = 'case "${1:-}" in has-session) echo "can\'t find session: x" >&2; return 1 ;; esac; return 0;';
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

// D-4940: the marker is read by the rule all three readers share — newest
// line first, top-level records only — and `continued-in-parity.test.ts` runs
// `_continued_in_of` over the whole table. These are the two effects on the
// REGISTRY that the old last-line, substring reader got wrong.
describe('_sync_uuid and the marker rule (D-4940)', () => {
  const lastPrompt = `${JSON.stringify({ type: 'last-prompt', lastPrompt: 'go on', sessionId: A })}\n`;
  const aiTitle = `${JSON.stringify({ type: 'ai-title', aiTitle: 'a title', sessionId: A })}\n`;

  it('follows a marker that metadata was re-stamped after (review finding ccd-last-line-only-marker)', () => {
    // Claude Code re-stamps last-prompt / ai-title when its process exits;
    // its own reader steps over them. Measured before this fix: six ticks
    // and the registry still A.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}${lastPrompt}${aiTitle}`);
    plant('/w', B, turnLine('two'));
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(B);
  });

  it('a supervisor restart with a re-stamped marker does not write the stale pane id back (review finding ccd-last-line-only-marker, the restart case)', () => {
    // The same restart shape as the F3 test below — registry already C, pane
    // still publishing A, every memo empty — with metadata after A's marker.
    // Measured before this fix: tick 1 wrote A back and it stayed A, because
    // the pane check (then `_ci_pane_superseded`) read only A's last line.
    const C = 'c'.repeat(36);
    row('/w', C);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}${lastPrompt}`);
    plant('/w', C, turnLine('two'));
    const cfg = h.sh(`_cfg_dir ${W}`);
    const sdir = path.join(cfg, 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, '4242.json'), JSON.stringify({ sessionId: A, status: 'idle' }));
    const tmuxStub = `tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };`;
    const out = h.sh(`${tmuxStub} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"; _sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"`);
    expect(/T1:(\S+)/.exec(out)?.[1]).toBe(C);
    expect(/T2:(\S+)/.exec(out)?.[1]).toBe(C);
  });

  it('never moves the registry onto a uuid named inside a tool call\'s input (review finding F1)', () => {
    // The tool-call line stays LAST for the whole of a long tool run or a
    // permission wait, and its own top-level sessionId (late on the line, as
    // Claude Code orders the keys) satisfied the old authorship check.
    // Measured before this fix: three ticks and the registry was B, the
    // operator's live conversation in A gone dark.
    row('/w', A);
    plant('/w', A, `${turnLine('call a tool')}${JSON.stringify({
      parentUuid: 'u-1',
      message: { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__x__y',
        input: { type: 'continued-in', continuedInSessionId: B } }], stop_reason: 'tool_use' },
      type: 'assistant', uuid: 'a-1', sessionId: A,
    })}\n`);
    plant('/w', B, turnLine('an unrelated, earlier conversation'));
    ticks(3);
    expect(h.reg(ID, 'uuid')).toBe(A);
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

// ── The second review round of #189: four holes the walk above leaves open ──
//
// Everything below models what Claude Code 2.1.296 itself writes, read out of
// its own code rather than assumed:
//   - every live process publishes ONE compact-JSON line at
//     `<cfg>/sessions/<pid>.json` — `pid`, `sessionId`, `cwd`, …, `kind`
//     (`interactive` | `bg` | `daemon` | `daemon-worker`), and on a `bg`
//     worker `jobId`, the job's 8-hex short, which is the first 8 characters
//     of the forked session's own id;
//   - it rewrites that line IN PLACE when its session id rotates (`/clear`),
//     so `sessionId` there is always the process's CURRENT id;
//   - a left-arrow fork marks the PANE's own record `parkedJobId: <job>` —
//     "this window's session moved to the background" — and leaves its
//     `sessionId` on the pre-fork id.
const C = 'c'.repeat(36), D = 'd'.repeat(36);
const JOB = C.slice(0, 8);

/** The pane's own record, the way 2.1.296 writes it. `parked` is the
 *  `parkedJobId` a left-arrow fork stamps on it. `updatedAt` is NOW unless a
 *  test says otherwise: 2.1.296 stamps `updatedAt: Date.now()` on every write
 *  of this record — a rotation, a park, an unpark, every status change — so a
 *  record whose id just rotated is a record written just now (D-4943's age
 *  rule reads exactly that). */
const paneRecord = (sid: string, parked?: string, updatedAt: number = Date.now()): string => JSON.stringify({
  pid: 4242, sessionId: sid, cwd: '/w', startedAt: 1, procStart: 'x', version: '2.1.296',
  peerProtocol: 1, kind: 'interactive', entrypoint: 'cli',
  ...(parked === undefined ? {} : { parkedJobId: parked }), updatedAt,
});
function plantPane(record: string): void {
  const sdir = path.join(h.sh(`_cfg_dir ${W}`), 'sessions');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(path.join(sdir, '4242.json'), record);
}
const TMUX_PANE = 'tmux() { case "$1" in list-panes) echo 4242 ;; esac; return 0; };';

/** bash that publishes a LIVE background worker's record. The pid is the
 *  snippet's own `$$` unless a test names another (a bash expression such as
 *  `$w1`), so a liveness probe answers alive for exactly as long as that
 *  process runs — a fixture pid nobody holds would read as a dead worker.
 *
 *  `procStart` is what 2.1.296 itself records: `ps -o lstart= -p <pid>` under
 *  `LC_ALL=C TZ=UTC`, trimmed (measured on a real background worker's record:
 *  the two strings are equal). A test may pass a string to record instead —
 *  one that does NOT match is a recycled pid — or `null` to leave the field
 *  out, as a record from a build that never wrote it would. */
const bgRecord = (sid: string, job: string, pid = '$$', procStart?: string | null, wrapper: string = W): string => {
  const ps = procStart === undefined
    ? `"$(LC_ALL=C TZ=UTC ps -o lstart= -p ${pid} | sed 's/ *$//')"`
    : `'${procStart ?? ''}'`;
  const field = procStart === null ? '' : '"procStart":"%s",';
  const arg = procStart === null ? '' : `"$__ps"`;
  return `mkdir -p "$(_cfg_dir ${wrapper})/sessions"; __ps=${ps}; `
    + `printf '{"pid":%s,"sessionId":"%s","cwd":"/w","startedAt":1,${field}"version":"2.1.296",`
    + `"peerProtocol":1,"kind":"bg","entrypoint":"cli","jobId":"%s"}' "${pid}" '${sid}' ${arg} '${job}' `
    + `> "$(_cfg_dir ${wrapper})/sessions/${pid}.json"; `;
};

const pick = (out: string, tag: string): string | undefined => new RegExp(`${tag}:(\\S+)`).exec(out)?.[1];

describe('D-4942: a declined hop is retried — without re-reading the marked file', () => {
  it('marker present, successor absent, two ticks, successor written, one tick: it follows', () => {
    // THE REVIEW'S REPRODUCTION, verbatim. `_CI_DONE` used to be committed
    // BEFORE the successor checks, and A never changes again after its marker,
    // so every later tick returned at "already examined" and the hop the
    // decline deferred was never taken — measured 20 more ticks still on A.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    const dir = projectDir('/w');
    const tB = turnLine('two').trimEnd();
    const out = h.sh(
      `_sync_uuid ${ID}; _sync_uuid ${ID}; echo "DECLINED:$(_reg_get ${ID} uuid)"; `
      + `printf '%s\\n' '${tB}' > "${dir}/${B}.jsonl"; `
      + `_sync_uuid ${ID}; echo "RETRIED:$(_reg_get ${ID} uuid)"; echo "PEND:\${#_CI_PEND[@]}"`,
    );
    expect(pick(out, 'DECLINED')).toBe(A);
    expect(pick(out, 'RETRIED')).toBe(B);
    // The decline's memo is dropped by the hop that resolved it — one entry
    // per id while it waits, none after.
    expect(pick(out, 'PEND')).toBe('0');
  });

  it('a successor that was EMPTY at the first read and has since been written is followed too', () => {
    // The other decline. Claude Code's own supersession test treats a
    // successor as real only once it holds a `"parentUuid":` line, so "named
    // but empty" is a state it produces and plans for.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, '');
    const dir = projectDir('/w');
    const tB = turnLine('two').trimEnd();
    const out = h.sh(
      `_sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; echo "DECLINED:$(_reg_get ${ID} uuid)"; `
      + `printf '%s\\n' '${tB}' >> "${dir}/${B}.jsonl"; `
      + `_sync_uuid ${ID}; echo "RETRIED:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'DECLINED')).toBe(A);
    expect(pick(out, 'RETRIED')).toBe(B);
  });

  it('the declined state reads the marked transcript ONCE, however many ticks it waits', () => {
    // WHY THE RETRY DOES NOT SIMPLY UN-COMMIT `_CI_DONE`. The review's own
    // suggested fix did that, and A — quiescent, unchanged, marked — would then
    // be tail-read on every tick for as long as its successor stays unwritten,
    // which on a successor that never comes (a fork the daemon gave up on) is
    // for ever. The retry re-asks only the successor's address, with builtins.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plantCountingTail();
    ticks(8);
    expect(h.reg(ID, 'uuid')).toBe(A);
    expect(tailCalls()).toHaveLength(1);
  });
});

describe('D-4943: a restarted supervisor refuses a PARKED pane id, whatever the disk still holds', () => {
  it('registry C, pane parked on pre-fork A whose transcript is GONE, a fresh process: never writes A', () => {
    // THE REVIEW'S P2, in the shape 2.1.296 actually leaves: the pane that
    // forked is still alive, still names A, and carries `parkedJobId`. Every
    // memo is empty after the restart and A's transcript is gone, so neither
    // the walk nor the marker test can refuse A — measured before this fix:
    // T1 reads A, and the next `--resume` takes the session back to before the
    // fork. The parked flag is Claude Code's own statement that this window's
    // id moved away, and it is on disk, so it survives every restart.
    row('/w', C);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A, JOB));
    const out = h.sh(
      `${TMUX_PANE} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "T3:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'T1')).toBe(C);
    expect(pick(out, 'T2')).toBe(C);
    expect(pick(out, 'T3')).toBe(C);
  });

  it('an UNPARKED pane id with no transcript yet still wins at once — a /clear is untouched', () => {
    // THE GUARD STATED THE OTHER WAY, and the reason the review's first
    // suggestion ("a pane id whose transcript cannot be found is not new
    // information") was not taken: a `/clear` mints an id whose transcript
    // does not exist until Claude Code's first write (the F7 window above),
    // so that rule would hold the registry on the cleared conversation for
    // exactly that window, on every `/clear` on the fleet.
    row('/w', C);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(D));
    const out = h.sh(`${TMUX_PANE} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T1')).toBe(D);
  });

  it('registry C, an UNPARKED pane on pre-fork A whose transcript is GONE and whose record is an hour old: never writes A', () => {
    // THE VERIFIER'S P2, in the shape 2.1.296 can leave: the left-arrow fork's
    // fallback (the in-process agents view throws, a `claude agents` child runs)
    // clears `parkedJobId` when it returns, so the pane sits UNPARKED on the
    // pre-fork A. Its transcript ends in a marker, so the marker test refuses
    // A — until the transcript is gone (Claude Code's own age-based cleanup
    // deletes it by mtime, and a pane left on A is a pane nobody writes A
    // from). Then a restarted supervisor read A as new and wrote it: the next
    // resume asks for a transcript that no longer exists. A /clear's id is
    // stamped NOW (every rotation writes `updatedAt: Date.now()`), so an id
    // with nothing on disk under a record nobody has touched for minutes is
    // not one.
    row('/w', C);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A, undefined, Date.now() - 3600_000));
    const out = h.sh(
      `${TMUX_PANE} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "T3:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'T1')).toBe(C);
    expect(pick(out, 'T2')).toBe(C);
    expect(pick(out, 'T3')).toBe(C);
  });

  it('an OLD record whose id HAS a transcript still wins — age alone refuses nothing', () => {
    // A pane that resumed Z an hour ago and has sat idle since is the holder
    // of Z, and Z is written: that is the pane's authority, as it always was.
    const Z = '9'.repeat(36);
    row('/w', C);
    plant('/w', C, turnLine('two'));
    plant('/w', Z, turnLine('mine'));
    plantPane(paneRecord(Z, undefined, Date.now() - 3600_000));
    const out = h.sh(`${TMUX_PANE} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T1')).toBe(Z);
  });

  it('the refused stale pane costs one address resolution, not one per tick', () => {
    // The stuck state is permanent — the pane keeps publishing A — so the
    // refusal is paid on every tick of it. It is answered from a memo of
    // where A's transcript could be, with `[[ -f ]]` builtins.
    row('/w', C);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A, undefined, Date.now() - 3600_000));
    const log = path.join(h.home, 'addrs-calls');
    const wrap = `eval "_ci_addrs_orig() $(declare -f _ci_addrs | tail -n +2)"; `
      + `_ci_addrs() { echo "$3" >> "${log}"; _ci_addrs_orig "$@"; }; `;
    h.sh(`${wrap} ${TMUX_PANE} ${Array.from({ length: 8 }, () => `_sync_uuid ${ID}`).join('; ')}`);
    expect(h.reg(ID, 'uuid')).toBe(C);
    const calls = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
    expect(calls.filter((u) => u === A)).toHaveLength(1);
  });
});

describe('D-4945: the forked session’s own id is followed through its background holder', () => {
  it('after a hop, a /clear inside the bg session (its record rotates C -> D) moves the registry to D', () => {
    // THE HOLE ONE ROTATION PAST THE FORK. A `/clear` in the bg session writes
    // no `continued-in` record (2.1.296 writes one only on the background
    // handoff), and the pane keeps publishing the pre-fork id, so before this
    // nothing ever told the registry — the chat went dark again and the hook's
    // pane-less fallback stopped matching. The bg worker's own record is where
    // Claude Code publishes the new id.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    const dir = projectDir('/w');
    const tD = turnLine('three').trimEnd();
    const out = h.sh(
      `${bgRecord(C, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "HOP:$(_reg_get ${ID} uuid)"; `
      + `printf '%s\\n' '${tD}' > "${dir}/${D}.jsonl"; ${bgRecord(D, JOB)}`
      + `_sync_uuid ${ID}; echo "ROT:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'HOP')).toBe(C);
    expect(pick(out, 'ROT')).toBe(D);
  });

  it('a rotated id with no transcript in THIS project dir is not followed until one appears', () => {
    // The one positive check before a write: the new id must have a non-empty
    // transcript under this row's own workdir. A bg session can be isolated
    // into a worktree of its own, and its transcript then lives under another
    // project directory this row does not own.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    const dir = projectDir('/w');
    const tD = turnLine('three').trimEnd();
    const out = h.sh(
      `${bgRecord(C, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; ${bgRecord(D, JOB)}`
      + `_sync_uuid ${ID}; _sync_uuid ${ID}; echo "WAIT:$(_reg_get ${ID} uuid)"; `
      + `printf '%s\\n' '${tD}' > "${dir}/${D}.jsonl"; `
      + `_sync_uuid ${ID}; echo "HEALED:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'WAIT')).toBe(C);
    expect(pick(out, 'HEALED')).toBe(D);
  });

  it('after a RESTART, the parked pane names the job and the job’s worker names the id', () => {
    // Nothing in memory, no hop this process: the parked pane's `parkedJobId`
    // is the link to the worker, and the worker's record is the current id.
    row('/w', C);
    plant('/w', C, turnLine('two'));
    plant('/w', D, turnLine('three'));
    plantPane(paneRecord(A, JOB));
    const out = h.sh(`${TMUX_PANE} ${bgRecord(D, JOB)} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T1')).toBe(D);
  });

  it('a pane that takes the conversation back (a genuine rotation) ends the following — no flap', () => {
    // The operator leaves the agents view and starts over in the pane: its
    // record un-parks and names a NEW id. That is the pane's authority, as it
    // always was. Without letting the worker go at that moment, the next tick
    // follows the worker's id back over it — and having written the worker's
    // id, the pane's own is then a walked id and is refused for good.
    const Z = '9'.repeat(36);
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plant('/w', Z, turnLine('new start'));
    plantPane(paneRecord(A, JOB));
    const pf = path.join(h.sh(`_cfg_dir ${W}`), 'sessions', '4242.json');
    const zRec = paneRecord(Z).replace(/'/g, '');
    const out = h.sh(
      `${TMUX_PANE} ${bgRecord(C, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "HOP:$(_reg_get ${ID} uuid)"; `
      + `printf '%s' '${zRec}' > "${pf}"; `
      + `${Array.from({ length: 4 }, () => `_sync_uuid ${ID}`).join('; ')}; echo "AFTER:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'HOP')).toBe(C);
    expect(pick(out, 'AFTER')).toBe(Z);
  });

  it('a remembered pid that now runs a DIFFERENT job is not followed', () => {
    // Pids are reused. The job is the worker's identity; the pid is only where
    // to look first.
    const OTHER = 'e'.repeat(36);
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plant('/w', OTHER, turnLine('someone else'));
    const out = h.sh(
      `${bgRecord(C, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "HOP:$(_reg_get ${ID} uuid)"; `
      + `${bgRecord(OTHER, OTHER.slice(0, 8))} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "AFTER:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'HOP')).toBe(C);
    expect(pick(out, 'AFTER')).toBe(C);
  });

  it('an ordinary session never looks for a background holder — the common path pays nothing', () => {
    // The supervise loop runs this every five seconds for every session on a
    // CPU-saturated box. A session whose pane agrees with the registry has
    // nothing in the background to follow, and must not scan for it.
    row('/w', A);
    plant('/w', A, turnLine('one'));
    plantPane(paneRecord(A));
    const log = path.join(h.home, 'scan-calls');
    const wrap = `eval "_ci_bg_scan_orig() $(declare -f _ci_bg_scan | tail -n +2)"; `
      + `_ci_bg_scan() { echo x >> "${log}"; _ci_bg_scan_orig "$@"; }; `;
    h.sh(`${wrap} ${TMUX_PANE} ${Array.from({ length: 6 }, () => `_sync_uuid ${ID}`).join('; ')}`);
    expect(existsSync(log)).toBe(false);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });
});

describe('D-4944: every resume follows the chain before it resumes', () => {
  /** The tmux substrate as `ccd-spawn-split.test.ts` models it: ONE file,
   *  `$HOME/pane-up`, says whether the pane exists. */
  const TMUX = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      ${WIDE_PANE_IF_UP}
      case "$1" in
        new-session)  : > "$HOME/pane-up" ;;
        kill-session) rm -f "$HOME/pane-up" ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        capture-pane) printf '%s' '? for shortcuts' ;;
      esac
    };`;
  /** A `--resume` that Claude Code refuses (the pane never comes up) while a
   *  `--session-id` one would. */
  const RESUME_REFUSED = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      ${WIDE_PANE_IF_UP}
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
  const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));

  it('a pane that died inside the quiescence window resumes the successor, not the pre-fork id', () => {
    // THE REVIEW'S MISSED ITEM. The exit dialog's "background" choice writes
    // the marker and exits the pane within milliseconds, so no supervise tick
    // ever sees A quiescent, and the respawn built `--resume A` from the raw
    // registry — Claude Code's explicit-id resume does no continued-in check,
    // so the pane came back on the pre-fork conversation.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()).toHaveLength(1);
    expect(newSessions()[0]).toContain(`--resume '${C}'`);
    expect(h.reg(ID, 'uuid')).toBe(C);
  });

  it('follows a chain of two forks to its end', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, B)}`);
    plant(h.home, B, `${turnLine('two')}${marker(B, C)}`);
    plant(h.home, C, turnLine('three'));
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()[0]).toContain(`--resume '${C}'`);
    expect(h.reg(ID, 'uuid')).toBe(C);
  });

  it('a successor that has not been written is not followed — the resume names the registry id', () => {
    // EMPTY, not absent: an absent one never resolves at all, so only an empty
    // one reaches the `-s` check — the case Claude Code produces between the
    // handoff and the worker's first write.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, '');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()[0]).toContain(`--resume '${A}'`);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('a successor a LIVE background job holds: says so, and spawns nothing — not it, not the pre-fork id (RR-2)', () => {
    // MEASURED IN THE 2.1.296 BINARY, not assumed: `--resume <id>` first asks
    // whether a live non-interactive record holds that id, and if one does it
    // exits with "… is running in the background (<job>). Run `claude attach
    // <job>` …" — it would attach only for a launch that carries no session
    // flags, and every ccd spawn carries --dangerously-skip-permissions. So no
    // second writer comes of the resume. The `--session-id` retry is the
    // dangerous half: it refuses an id whose transcript exists ("already in
    // use"), but an id whose worker has not written yet it would START — a
    // second writer under the same id.
    //
    // #189 review round 2 (RR-2): the refused resume used to be spawned
    // anyway — the pane died at once, the unit restarted into the same
    // refusal and spent StartLimitBurst. Nothing is spawned now: the answer is
    // `_CI_HELD_RC`, and the supervisor waits for the job (`_ci_held_wait`).
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    const out = h.sh(`${bgRecord(C, JOB)} ${RESUME_REFUSED} rm -f "$HOME/pane-up"; { _spawn_start ${ID} resume; echo "RC:$?"; } 2>&1`);
    expect(out).toContain(JOB);
    expect(pick(out, 'RC')).toBe(h.sh('echo $_CI_HELD_RC'));
    expect(newSessions()).toEqual([]);
    expect(h.reg(ID, 'uuid')).toBe(C);   // C is WRITTEN, so the registry follows it
  });

  it('a chain that loops stops at its first repeat', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, B)}`);
    plant(h.home, B, marker(B, A));
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()[0]).toContain(`--resume '${B}'`);
  });

  it('follows at most _CI_WALK_CAP hops, however long the chain', () => {
    // The supervise walk's own bound. Twenty distinct ids, so the visited set
    // alone would walk all of them; the cap stops it at hop sixteen.
    const N = 20;
    const ids = Array.from({ length: N }, (_, i) => `${i.toString(16).padStart(2, '0')}${'0'.repeat(34)}`);
    row(h.home, ids[0]!);
    for (let i = 0; i < N - 1; i++) plant(h.home, ids[i]!, marker(ids[i]!, ids[i + 1]!));
    plant(h.home, ids[N - 1]!, turnLine('end'));
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()[0]).toContain(`--resume '${ids[16]}'`);
  });

  it('a record whose process is gone is not a holder — the ordinary retry still runs', () => {
    // A SIGKILLed worker leaves its record behind. Treating that as a live
    // holder would take away the `--session-id` rescue from a row whose
    // resume failed for an unrelated reason.
    row(h.home, A);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} uuid ${C}`);
    const sdir = path.join(h.sh(`_cfg_dir ${W}`), 'sessions');
    mkdirSync(sdir, { recursive: true });
    // A pid no process holds: above every default pid_max.
    writeFileSync(path.join(sdir, '4194304999.json'),
      JSON.stringify({ pid: 4194304999, sessionId: C, kind: 'bg', jobId: JOB }));
    h.sh(`${RESUME_REFUSED} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()).toHaveLength(2);
    expect(newSessions()[1]).toContain('--session-id');
  });

  /** cmd_swap's own teardown and carry, stubbed to calls a test can read — the
   *  pattern `ccd-account-ok.test.ts` drives the verb with. */
  // The pane is GONE on `has-session`: D-5240's manual gate reads `_ws_status`
  // first, and `tmux() { :; }` alone is an alive pane with no pid (unreadable).
  const SWAP_STUBS = `sleep() { :; }; tmux() { ${GONE} };\n`
    + '_svc_stop() { echo "svc_stop $*" >> "$HOME/ccd-calls"; }; _svc_start() { :; };\n'
    + '_swap_beat() { :; }; _swap_beat_stop() { :; }; _swap_carry_sidecars() { :; };\n'
    + '_swap_carry_jsonl() { echo "carry $3" >> "$HOME/ccd-calls"; return 0; };\n';
  const swapId = 'claude-demo';

  it('a swap carries the successor, not the superseded transcript', () => {
    // The carry is keyed on the registry id, and it runs BEFORE the spawn, in
    // the SOURCE account: following only inside the spawn would look for the
    // successor in a config dir it was never copied to.
    h.sh(`_reg_set ${swapId} wrapper ${W}; _reg_set ${swapId} workdir "$HOME"; _reg_set ${swapId} uuid ${A}`);
    const dir = path.join(h.sh(`_cfg_dir ${W}`), 'projects', h.sh('_munge_wd "$(_ws_realpath "$HOME")"'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${A}.jsonl`), `${turnLine('one')}${marker(A, C)}`);
    writeFileSync(path.join(dir, `${C}.jsonl`), turnLine('two'));
    try { h.sh(`${SWAP_STUBS} cmd_swap ${swapId} claude-a`); } catch { /* the landing is not under test */ }
    expect(h.calls().filter((c) => c.startsWith('carry '))).toEqual([`carry ${C}`]);
    expect(h.reg(swapId, 'uuid')).toBe(C);
  });

  it('a swap refuses, before any teardown, a conversation a live background job is still writing', () => {
    // ACROSS ACCOUNTS CLAUDE CODE CANNOT SEE THE HOLDER. Its live-session check
    // reads the sessions directory of ITS OWN config dir, so on the target
    // account `--resume <id>` finds nobody holding the id and starts — while
    // the job keeps writing the source account's copy. Two writers, one id.
    //
    // ON A LANE THAT IS NOT THE DEFAULT, so the refusal's "stop it" is pinned
    // to the ROW's wrapper (review round 3, DOCS-R2-4): a job lives under its
    // own config dir's `jobs/`, and `claude stop <job>` on a `claude-a` row
    // asks the default config dir, where the job does not exist.
    const lane = 'claude-a';
    h.sh(`_reg_set ${swapId} wrapper ${lane}; _reg_set ${swapId} workdir "$HOME"; _reg_set ${swapId} uuid ${A}`);
    const dir = path.join(h.sh(`_cfg_dir ${lane}`), 'projects', h.sh('_munge_wd "$(_ws_realpath "$HOME")"'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${A}.jsonl`), `${turnLine('one')}${marker(A, C)}`);
    writeFileSync(path.join(dir, `${C}.jsonl`), turnLine('two'));
    let status = 0;
    try { h.sh(`${SWAP_STUBS} ${bgRecord(C, JOB, '$$', undefined, lane)} cmd_swap ${swapId} ${W}`); } catch (e) { status = (e as { status?: number }).status ?? 1; }
    expect(status).not.toBe(0);
    expect(h.calls().join('\n')).not.toContain('svc_stop');
    expect(h.calls().filter((c) => c.startsWith('carry '))).toEqual([]);
    expect(h.reg(swapId, 'wrapper')).toBe(lane);
    const blocked = h.reg(swapId, 'swapblocked') ?? '';
    expect(blocked).toContain(JOB);
    expect(blocked).toContain(`(${lane} stop ${JOB})`);
    expect(blocked).not.toContain(`claude stop`);
  });

  // ── Fix-forward (second verifier round) ─────────────────────────────────────

  /** The job's own state file, the way 2.1.296's daemon writes it: pretty
   *  JSON at `<cfg>/jobs/<short>/state.json`, beside `<cfg>/sessions/`.
   *  Measured on a real background job: the state file exists about half a
   *  second BEFORE the handoff appends its marker, the worker's sessions
   *  record about a second AFTER it, and the successor's first line later
   *  still. `ageSec` backdates the file. */
  function jobState(job: string, state: string, ageSec = 0): void {
    const d = path.join(h.sh(`_cfg_dir ${W}`), 'jobs', job);
    mkdirSync(d, { recursive: true });
    const f = path.join(d, 'state.json');
    writeFileSync(f, `${JSON.stringify({ state, detail: 'x', tempo: 'active', template: 'bg', sessionId: C, daemonShort: job, backend: 'daemon' }, null, 2)}\n`);
    const t = Date.now() / 1000 - ageSec;
    utimesSync(f, t, t);
  }

  it('an ABSENT successor a live job holds is not resumed, and neither is A — the pane that died right at the handoff (P3, RR-1)', () => {
    // THE VERIFIER'S P3. The exit dialog's "background" writes the marker and
    // exits the pane at once; the worker writes the successor's first line
    // only once it has booted and loaded A, while the respawn lands three to
    // eight seconds after the exit. An unwritten successor was never taken, so
    // the respawn resumed A — which nothing holds any more — and Claude Code
    // appended to A after its own marker: the chain broken for good.
    //
    // #189 review round 2 (RR-1): the unwritten C used to be resumed AND
    // written into the registry; a job that then died before its first line
    // left the row resuming a conversation that never existed. Nothing is
    // spawned, and the registry stays on the last WRITTEN id.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    const out = h.sh(`${bgRecord(C, JOB)} ${RESUME_REFUSED} rm -f "$HOME/pane-up"; { _spawn_start ${ID} resume; echo "RC:$?"; } 2>&1`);
    expect(newSessions()).toEqual([]);
    expect(h.reg(ID, 'uuid')).toBe(A);
    expect(out).toContain(JOB);
    expect(pick(out, 'RC')).toBe(h.sh('echo $_CI_HELD_RC'));
  });

  it('an EMPTY successor a live job holds, the same (P3b)', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, '');
    h.sh(`${bgRecord(C, JOB)} ${RESUME_REFUSED} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null; true`);
    expect(newSessions()).toEqual([]);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('the live job is found by its SHORT as well — whatever id its record names at that instant', () => {
    // The record is rewritten in place on every rotation, so the id in it is
    // whatever the worker holds right now; the job short is the fork's own
    // name for itself, and it never changes.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    h.sh(`${bgRecord(D, JOB)} ${RESUME_REFUSED} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null; true`);
    expect(newSessions()).toEqual([]);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('a job still STARTING — its state file written, no worker record yet — holds its unwritten successor too', () => {
    // The window P3 leaves: on a loaded box the worker can take longer to
    // register than the respawn takes to land. The job's state file is there
    // before the marker is.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    jobState(JOB, 'working');
    const out = h.sh(`${RESUME_REFUSED} rm -f "$HOME/pane-up"; { _spawn_start ${ID} resume; echo "RC:$?"; } 2>&1`);
    expect(newSessions()).toEqual([]);
    expect(h.reg(ID, 'uuid')).toBe(A);
    expect(out).toContain(JOB);
  });

  it('a job that is OVER does not hold an unwritten successor — A is still the conversation', () => {
    // A fork that failed before its first line leaves A as what there is to
    // resume; taking the unwritten id would leave the row nothing to resume.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    jobState(JOB, 'failed');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()[0]).toContain(`--resume '${A}'`);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('a job whose state has not moved for minutes is not "starting" — a dead daemon leaves such files behind', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    jobState(JOB, 'working', 600);
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()[0]).toContain(`--resume '${A}'`);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('a swap refuses, before any teardown, a fork whose successor is not written yet', () => {
    h.sh(`_reg_set ${swapId} wrapper ${W}; _reg_set ${swapId} workdir "$HOME"; _reg_set ${swapId} uuid ${A}`);
    const dir = path.join(h.sh(`_cfg_dir ${W}`), 'projects', h.sh('_munge_wd "$(_ws_realpath "$HOME")"'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${A}.jsonl`), `${turnLine('one')}${marker(A, C)}`);
    let status = 0;
    try { h.sh(`${SWAP_STUBS} ${bgRecord(C, JOB)} cmd_swap ${swapId} claude-a`); } catch (e) { status = (e as { status?: number }).status ?? 1; }
    expect(status).not.toBe(0);
    expect(h.calls().join('\n')).not.toContain('svc_stop');
    expect(h.reg(swapId, 'swapblocked') ?? '').toContain(JOB);
  });

  it('a swap refuses a fork whose job is still STARTING — no worker record to scan for yet', () => {
    h.sh(`_reg_set ${swapId} wrapper ${W}; _reg_set ${swapId} workdir "$HOME"; _reg_set ${swapId} uuid ${A}`);
    const dir = path.join(h.sh(`_cfg_dir ${W}`), 'projects', h.sh('_munge_wd "$(_ws_realpath "$HOME")"'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${A}.jsonl`), `${turnLine('one')}${marker(A, C)}`);
    jobState(JOB, 'working');
    let status = 0;
    try { h.sh(`${SWAP_STUBS} cmd_swap ${swapId} claude-a`); } catch (e) { status = (e as { status?: number }).status ?? 1; }
    expect(status).not.toBe(0);
    expect(h.calls().join('\n')).not.toContain('svc_stop');
    expect(h.reg(swapId, 'swapblocked') ?? '').toContain(JOB);
  });

  it('a swap refuses a conversation whose job has rotated past it — the job is known by its short (NP2)', () => {
    // The registry is on C, written; the worker has just taken a /clear to D,
    // which has no line yet, so its record names D while its job is still C's
    // short. A swap would resume the pre-/clear C on the target while the job
    // keeps writing D here.
    h.sh(`_reg_set ${swapId} wrapper ${W}; _reg_set ${swapId} workdir "$HOME"; _reg_set ${swapId} uuid ${C}`);
    const dir = path.join(h.sh(`_cfg_dir ${W}`), 'projects', h.sh('_munge_wd "$(_ws_realpath "$HOME")"'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${C}.jsonl`), turnLine('two'));
    let status = 0;
    try { h.sh(`${SWAP_STUBS} ${bgRecord(D, JOB)} cmd_swap ${swapId} claude-a`); } catch (e) { status = (e as { status?: number }).status ?? 1; }
    expect(status).not.toBe(0);
    expect(h.calls().join('\n')).not.toContain('svc_stop');
    expect(h.reg(swapId, 'swapblocked') ?? '').toContain(JOB);
  });

  it('the background-job refusal never offers `--force` — it does not bypass this one (NP1)', () => {
    h.sh(`_reg_set ${swapId} wrapper ${W}; _reg_set ${swapId} workdir "$HOME"; _reg_set ${swapId} uuid ${C}`);
    const dir = path.join(h.sh(`_cfg_dir ${W}`), 'projects', h.sh('_munge_wd "$(_ws_realpath "$HOME")"'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${C}.jsonl`), turnLine('two'));
    const out = h.sh(`${SWAP_STUBS} ${bgRecord(C, JOB)} out=$( { cmd_swap ${swapId} claude-a; } 2>&1 ); echo "RC:$?"; printf '%s\\n' "$out"`);
    expect(out).toContain('RC:1');
    expect(out).toContain('refusing to swap');
    expect(out).not.toContain(`swap --force ${swapId}`);
    const forced = h.sh(`${SWAP_STUBS} ${bgRecord(C, JOB)} out=$( { cmd_swap --force ${swapId} claude-a; } 2>&1 ); echo "RC:$?"`);
    expect(forced).toContain('RC:1');
  });

  it('the spawn knows the job by its short too: no --session-id retry, and it names the job (NP2)', () => {
    row(h.home, C);
    plant(h.home, C, turnLine('two'));
    const out = h.sh(`${bgRecord(D, JOB)} ${RESUME_REFUSED} rm -f "$HOME/pane-up"; { _spawn_start ${ID} resume; echo "RC:$?"; } 2>&1`);
    expect(newSessions()).toEqual([]);
    expect(out).toContain(JOB);
  });

  it('a record whose pid now belongs to ANOTHER process is not a holder — procStart, as Claude Code checks it', () => {
    // A SIGKILLed or OOM-killed worker leaves its record, and its pid can be
    // handed to anything. Claude Code's own listing compares the record's
    // `procStart` with `ps -o lstart=` for that pid; kill -0 alone would keep
    // a dead job "live" — refusing every swap of the row, auto-swap included,
    // and taking away the `--session-id` rescue.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`${bgRecord(C, JOB, '$$', 'Thu Jan  1 00:00:00 1970')} ${RESUME_REFUSED} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()).toHaveLength(2);
    expect(newSessions()[1]).toContain('--session-id');
  });

  it('a record with NO procStart is judged on kill -0 alone, as Claude Code judges it', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`${bgRecord(C, JOB, '$$', null)} ${RESUME_REFUSED} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null; true`);
    expect(newSessions()).toEqual([]);   // held: nothing spawned
  });

  it('a sessions record that is a SYMLINK is never read — a holder is a file Claude Code wrote there', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`${bgRecord(C, JOB)} s="$(_cfg_dir ${W})/sessions/$$.json"; mv "$s" "$HOME/elsewhere.json"; ln -s "$HOME/elsewhere.json" "$s"; `
      + `${RESUME_REFUSED} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(newSessions()).toHaveLength(2);
  });

  it('a FIFO in the sessions directory never blocks a scan', () => {
    // `read < fifo` blocks in open() until a writer appears — on the supervise
    // loop, for ever.
    const sdir = path.join(h.sh(`_cfg_dir ${W}`), 'sessions');
    mkdirSync(sdir, { recursive: true });
    h.sh(`mkfifo "${sdir}/777.json"`);
    const out = h.sh(
      `( _ci_bg_scan "$(_cfg_dir ${W})" ${C} ""; : > "$HOME/scan-done" ) & p=$!; `
      + 'for i in $(seq 1 50); do [[ -e "$HOME/scan-done" ]] && break; command sleep 0.1; done; '
      + 'if [[ -e "$HOME/scan-done" ]]; then echo DONE; else echo HUNG; kill -9 $p 2>/dev/null; fi; wait $p 2>/dev/null; true',
    );
    expect(out).toBe('DONE');
  });
});

describe('fix-forward pins: the background follow’s own guards', () => {
  const tD = turnLine('three').trimEnd();

  it('a rotated id whose transcript exists but is EMPTY is not followed until it holds a line', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    const dir = projectDir('/w');
    const out = h.sh(
      `${bgRecord(C, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; ${bgRecord(D, JOB)} : > "${dir}/${D}.jsonl"; `
      + `_sync_uuid ${ID}; _sync_uuid ${ID}; echo "EMPTY:$(_reg_get ${ID} uuid)"; `
      + `printf '%s\\n' '${tD}' >> "${dir}/${D}.jsonl"; _sync_uuid ${ID}; echo "WRITTEN:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'EMPTY')).toBe(C);
    expect(pick(out, 'WRITTEN')).toBe(D);
  });

  it('a job that is gone is let go after _CI_BG_MISS_CAP ticks, and a parked pane naming it is not rescanned', () => {
    // The parked pane names a job no worker answers for (it finished). The
    // follow looks for a respawn for a minute of ticks, then lets go, and
    // remembers the job as gone — or the parked pane would start the search
    // over on the very next tick, for ever.
    row('/w', C);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A, JOB));
    const log = path.join(h.home, 'scan-calls');
    const wrap = `eval "_ci_bg_scan_orig() $(declare -f _ci_bg_scan | tail -n +2)"; `
      + `_ci_bg_scan() { echo scan >> "${log}"; _ci_bg_scan_orig "$@"; }; `;
    h.sh(`${wrap} ${TMUX_PANE} for i in $(seq 1 30); do echo "tick $i" >> "${log}"; _sync_uuid ${ID}; done`);
    const lines = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
    const at = lines.indexOf('tick 21');
    expect(lines.slice(0, at).filter((l) => l === 'scan').length).toBeGreaterThan(0);
    expect(lines.slice(at).filter((l) => l === 'scan')).toEqual([]);
    expect(h.reg(ID, 'uuid')).toBe(C);
  });

  it('a worker naming an id the walk has LEFT is not followed back — the fork it was made from', () => {
    // Two forks: A -> B, then B -> C. B is no origin, but it is on the walk,
    // and its transcript ends in a marker. Following a worker back to it would
    // park the registry on a superseded id the walk then refuses to leave
    // (C is on the walk too).
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, `${turnLine('two')}${marker(B, C)}`);
    plant('/w', C, turnLine('three'));
    const out = h.sh(
      `${bgRecord(C, JOB)} ${Array.from({ length: 5 }, () => `_sync_uuid ${ID}`).join('; ')}; echo "END:$(_reg_get ${ID} uuid)"; `
      + `${bgRecord(B, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "BACK:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'END')).toBe(C);
    expect(pick(out, 'BACK')).toBe(C);
  });

  it('a follow is a placement like a hop: the walk goes on from the same origin, it does not restart', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    const dir = projectDir('/w');
    const out = h.sh(
      `${bgRecord(C, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; `
      + `printf '%s\\n' '${tD}' > "${dir}/${D}.jsonl"; ${bgRecord(D, JOB)} _sync_uuid ${ID}; _sync_uuid ${ID}; `
      + `echo "NOW:$(_reg_get ${ID} uuid)"; echo "ORIGIN:\${_CI_ORIGIN[${ID}]}"; `
      + `_ci_walk_has ${ID} ${C} && echo "LEFT:C"`,
    );
    expect(pick(out, 'NOW')).toBe(D);
    expect(pick(out, 'ORIGIN')).toBe(A);
    expect(pick(out, 'LEFT')).toBe('C');
  });

  it('a worker that died WITHOUT removing its record is not read as current — its respawn is found by job', () => {
    // SIGKILL and the OOM killer leave the record behind. Read as live, it
    // names the id the worker held when it died, for ever, and the respawned
    // worker under a new pid — the same job — is never looked for.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plant('/w', D, turnLine('three'));
    const out = h.sh(
      `command sleep 60 & w1=$!; ${bgRecord(C, JOB, '$w1')} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "HOP:$(_reg_get ${ID} uuid)"; `
      + `kill -9 $w1; wait $w1 2>/dev/null; ${bgRecord(D, JOB)} _sync_uuid ${ID}; echo "AFTER:$(_reg_get ${ID} uuid)"`,
    );
    expect(pick(out, 'HOP')).toBe(C);
    expect(pick(out, 'AFTER')).toBe(D);
  });
});

// ── #189 review round 2 ─────────────────────────────────────────────────────
// RR-1: the registry never names a successor that has no transcript.
// RR-2: a conversation a live background job holds is waited for, not spawned
//       into (the supervisor's wait state, `_ci_held_wait`).
// RR-3: the pane's pre-fork id is refused on the CURRENT verdict of its own
//       transcript, not on what this supervisor remembers.
// RR-4: a tail/jq read that failed is "not measured", never "no marker".

const asst = (text: string): string =>
  `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } })}\n`;

/** The job's state file, as 2.1.296's daemon writes it (see `jobState` in the
 *  D-4944 describe above, which this mirrors). */
function jobStateAt(job: string, state: string, ageSec = 0): string {
  const d = path.join(h.sh(`_cfg_dir ${W}`), 'jobs', job);
  mkdirSync(d, { recursive: true });
  const f = path.join(d, 'state.json');
  writeFileSync(f, `${JSON.stringify({ state, detail: 'x', tempo: 'active', template: 'bg', sessionId: C, daemonShort: job, backend: 'daemon' }, null, 2)}\n`);
  const t = Date.now() / 1000 - ageSec;
  utimesSync(f, t, t);
  return f;
}

/** A `jq` on PATH that fails (as the OOM killer or a refused fork leaves it:
 *  exit 137) on its first `n` calls, and is the real jq after that. */
function plantFailingJq(n: number): void {
  const real = execSync('command -v jq', { shell: '/bin/bash', encoding: 'utf8',
    env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' } }).trim();
  const bin = path.join(h.home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const cnt = path.join(h.home, 'jq-n');
  writeFileSync(path.join(bin, 'jq'),
    `#!/bin/sh\nn=$(cat "${cnt}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${cnt}"\n`
    + `if [ "$n" -le ${n} ]; then cat >/dev/null; exit 137; fi\nexec ${real} "$@"\n`, { mode: 0o755 });
}
const jqCalls = (): number => {
  const f = path.join(h.home, 'jq-n');
  return existsSync(f) ? Number(readFileSync(f, 'utf8').trim()) : 0;
};

/** `cmd_supervise` as a PROGRAM (it ends in `exit 1`), bounded by spawnSync's
 *  own timeout so a wait that never ends is one failed case, not a hung suite —
 *  the ccd-substrate.test.ts idiom. */
const runSup = (snippet: string): { code: number; out: string; err: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 30000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
};
/** The supervise loop's collaborators, quiet: every probe says `gone` (so the
 *  loop exits after one ensure), and `cmd_ensure` records the registry uuid it
 *  would resume and the wait tick it was reached at. */
const SUP_STUBS = `systemctl() { :; }; launchctl() { :; }; _svc_enable() { :; };
  _session_probe() { PROBE_VERDICT=gone; PROBE_DETAIL=""; };
  cmd_ensure() { echo "ensure uuid=$(_reg_get "$1" uuid) tick=\${__t:-0}" >> "$HOME/ccd-calls"; };`;
const TMUX_UP = `tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      ${WIDE_PANE_IF_UP}
      case "$1" in
        new-session)  : > "$HOME/pane-up" ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        capture-pane) printf '%s' '? for shortcuts' ;;
      esac
    };`;
const REFUSE_RESUME = `tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      ${WIDE_PANE_IF_UP}
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
const spawnedArgs = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));

describe('#189 round 2 (RR-1): no unwritten successor ever reaches the registry', () => {
  it('a spawn while the job is STARTING, the job then FAILS, a second spawn: --resume A — the real conversation is not orphaned', () => {
    // THE REVIEWER'S X5. Spawn 1 lands while the fork's job is still starting
    // (its state file fresh, no worker record, C not written). It used to take
    // C as the chain's end and WRITE it into the registry; the job then failed
    // before its first line, and spawn 2 resumed C — a conversation that
    // never existed — then retried it as --session-id, while A, the real one,
    // sat on disk with nothing pointing at it.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    const st = jobStateAt(JOB, 'working');
    const out = h.sh(`sleep() { :; }; ${TMUX_UP} rm -f "$HOME/pane-up"; `
      + `{ _spawn_start ${ID} resume; echo "S1:$?"; } 2>/dev/null; echo "REG1:$(_reg_get ${ID} uuid)"; `
      + `printf '%s\\n' '{"state": "failed"}' > '${st}'; rm -f "$HOME/pane-up"; `
      + `{ _spawn_start ${ID} resume; echo "S2:$?"; } 2>/dev/null; echo "REG2:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'REG1')).toBe(A);
    expect(pick(out, 'REG2')).toBe(A);
    expect(spawnedArgs()).toHaveLength(1);
    expect(spawnedArgs()[0]).toContain(`--resume '${A}'`);
    expect(h.calls().join('\n')).not.toContain(C);
  });

  it('two spawns while the job is still STARTING: neither starts the unwritten id (no --session-id C) — the likelier twin', () => {
    // THE VERIFIER'S V2. Spawn 2 used to walk from the C spawn 1 had
    // persisted, find no transcript and no worker record (the elif asked only
    // for a record, never `_ci_job_starting`), and take the --session-id
    // retry: a second writer under the id the booting worker was about to
    // write.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    jobStateAt(JOB, 'working');
    h.sh(`sleep() { :; }; ${REFUSE_RESUME} rm -f "$HOME/pane-up"; `
      + `{ _spawn_start ${ID} resume; _spawn_start ${ID} resume; } 2>/dev/null; true`);
    expect(h.calls().join('\n')).not.toContain('--session-id');
    expect(spawnedArgs()).toEqual([]);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('a held resume leaves an archived row archived — a pane that is not created does not wake the workspace', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    jobStateAt(JOB, 'working');
    h.sh(`_reg_set ${ID} archived "$(date +%s)"; _reg_set ${ID} archivedreason test`);
    const out = h.sh(`sleep() { :; }; ${TMUX_UP} { _spawn_start ${ID} resume; echo "RC:$?"; } 2>&1`);
    expect(pick(out, 'RC')).toBe(h.sh('echo $_CI_HELD_RC'));
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.archived`))).toBe(true);
    expect(spawnedArgs()).toEqual([]);
  });

  it('a swap of a fork mid-handoff names the id the job holds, and leaves the registry on A', () => {
    const swapId = 'claude-demo';
    h.sh(`_reg_set ${swapId} wrapper ${W}; _reg_set ${swapId} workdir "$HOME"; _reg_set ${swapId} uuid ${A}`);
    const dir = path.join(h.sh(`_cfg_dir ${W}`), 'projects', h.sh('_munge_wd "$(_ws_realpath "$HOME")"'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${A}.jsonl`), `${turnLine('one')}${marker(A, C)}`);
    jobStateAt(JOB, 'working');
    const out = h.sh(`sleep() { :; }; tmux() { ${GONE} }; _svc_stop() { echo svc_stop >> "$HOME/ccd-calls"; }; `
      + `out=$( { cmd_swap ${swapId} claude-a; } 2>&1 ); echo "RC:$?"; printf '%s\\n' "$out"`);
    expect(pick(out, 'RC')).toBe('1');
    expect(h.reg(swapId, 'swapblocked') ?? '').toContain(`conversation ${C}`);
    expect(h.reg(swapId, 'uuid')).toBe(A);
  });
});

describe('#189 round 2 (RR-2): the supervisor waits for a live background job, it does not spawn', () => {
  /** The wait's clock: `sleep` advances `__t`, and on tick `k` the snippet in
   *  `act` runs (the job ending, its state changing, …). */
  const clock = (act: string): string =>
    `__t=0; sleep() { __t=$((__t+1)); echo "tick $__t" >> "$HOME/ccd-calls"; ${act} };`;

  it('a written successor its live job holds: no spawn until the job ends, then the successor is resumed', () => {
    // THE ORDINARY LEFT-ARROW FORK, once its agents view is closed: the pane
    // process exits (2.1.296 exits unconditionally there), the registry is on
    // C, and C's worker stays up — idle — long after its turn. Every respawn
    // used to be refused by Claude Code, and five of them inside 120 s left
    // the unit FAILED for good.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    const r = runSup(`${SUP_STUBS} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      ${clock('(( __t == 3 )) && { kill -9 $w; wait $w 2>/dev/null; };')}
      cmd_supervise ${ID}`);
    const calls = h.calls();
    const ensure = calls.filter((c) => c.startsWith('ensure '));
    expect(ensure, r.err).toEqual([`ensure uuid=${C} tick=3`]);   // not one tick before the job ended
    expect(calls.indexOf('tick 3')).toBeLessThan(calls.indexOf(ensure[0]!));
    const bw = h.reg(ID, 'bgwait') ?? '';
    expect(bw).toContain('state=closed');
    expect(bw).toContain(`job=${JOB}`);
    expect(bw).toContain('end=over');
    const log = readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8');
    expect(log).toMatch(new RegExp(`bgwait ${ID}: background job ${JOB} holds ${C}`));
    expect(log).toMatch(new RegExp(`bgwait-end ${ID}: job=${JOB} .*end=over resuming=${C}`));
    expect(r.err).toContain(`attach ${JOB}`);
  });

  it('an unwritten successor held by a job still STARTING: waits; the job FAILS; A — the conversation there is — is resumed', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    const st = jobStateAt(JOB, 'working');
    h.sh(`_reg_set ${ID} started 1`);
    runSup(`${SUP_STUBS} ${clock(`(( __t == 2 )) && printf '%s\\n' '{"state": "failed"}' > '${st}';`)}
      cmd_supervise ${ID}`);
    expect(h.calls().filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${A} tick=2`]);
  });

  it('a STARTING job whose worker registers and writes C: the wait pins the worker, and resumes C once it ends', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    jobStateAt(JOB, 'working');
    h.sh(`_reg_set ${ID} started 1`);
    const dir = projectDir(h.home);
    const tC = turnLine('two').trimEnd();
    runSup(`${SUP_STUBS} ${clock(`
        if (( __t == 2 )); then printf '%s\\n' '${tC}' > "${dir}/${C}.jsonl"; command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')} fi
        (( __t == 5 )) && { kill -9 $w; wait $w 2>/dev/null; };`)}
      cmd_supervise ${ID}`);
    expect(h.calls().filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${C} tick=5`]);
  });

  it('while it waits, the registry follows a /clear inside the background session — the resume takes the id the job ended on', () => {
    // D-4945's follow runs in `_sync_uuid`, i.e. only while a pane lives. A
    // wait that did not follow would resume C — the conversation from before
    // the background session's `/clear` — once the job ended.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    const dir = projectDir(h.home);
    const tD = turnLine('three').trimEnd();
    runSup(`${SUP_STUBS} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      ${clock(`echo "reg@$__t=$(_reg_get ${ID} uuid)" >> "$HOME/ccd-calls";
        (( __t == 2 )) && { ${bgRecord(D, JOB, '$w')} };
        (( __t == 3 )) && printf '%s\\n' '${tD}' > "${dir}/${D}.jsonl";
        (( __t == 6 )) && { kill -9 $w; wait $w 2>/dev/null; };`)}
      cmd_supervise ${ID}`);
    const calls = h.calls();
    expect(calls).toContain(`reg@5=${D}`);   // followed before the job ended
    expect(calls.filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${D} tick=6`]);
  });

  it('while it waits, the registry takes the forked id at its first line — not only when the job ends', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    h.sh(`_reg_set ${ID} started 1`);
    const dir = projectDir(h.home);
    const tC = turnLine('two').trimEnd();
    runSup(`${SUP_STUBS} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      ${clock(`echo "reg@$__t=$(_reg_get ${ID} uuid)" >> "$HOME/ccd-calls";
        (( __t == 2 )) && printf '%s\\n' '${tC}' > "${dir}/${C}.jsonl";
        (( __t == 5 )) && { kill -9 $w; wait $w 2>/dev/null; };`)}
      cmd_supervise ${ID}`);
    const calls = h.calls();
    expect(calls).toContain(`reg@1=${A}`);
    expect(calls).toContain(`reg@4=${C}`);
    expect(calls.filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${C} tick=5`]);
  });

  it('the wait keeps the heartbeat fresh, so the row reads `restarting`, not orphan', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    runSup(`${SUP_STUBS} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      eval "_reg_set_orig() $(declare -f _reg_set | tail -n +2)"
      _reg_set() { [[ "$2" == supervised ]] && echo "stamp tick=\${__t:-0}" >> "$HOME/ccd-calls"; _reg_set_orig "$@"; }
      ${clock('(( __t == 13 )) && { kill -9 $w; wait $w 2>/dev/null; };')}
      cmd_supervise ${ID}`);
    const stamps = h.calls().filter((c) => c.startsWith('stamp tick=')).map((c) => Number(c.slice(11)));
    // one before the wait (cmd_supervise's own), then every 30 s of ticks
    expect(stamps.filter((t) => t > 0 && t < 13)).toEqual([6, 12]);
  });

  it('`ccd ensure` / `ccd start` say the supervisor is waiting, instead of timing out on a pane that is not coming', () => {
    // The record is written by `_ci_bgwait_open` in the SAME shell that then
    // polls: it names its supervisor, and that supervisor must still run for
    // the wait to be reported (PR4, below).
    h.sh(`_reg_set ${ID} wrapper ${W}`);
    const out = h.sh(`_ci_bgwait_open ${ID} ${JOB} ${C} ${W} 2>/dev/null; _reg_set ${ID} supervised "$(date +%s)"; `
      + `SUPERVISED_START_WAIT=3; sleep() { echo slept >> "$HOME/ccd-calls"; }; _have_systemctl() { return 0; }; `
      + '_svc_reset_failed() { :; }; _svc_enable_now() { return 0; }; _alive() { return 1; }; '
      + `{ _supervised_start ${ID}; echo "RC:$?"; } 2>&1`);
    expect(pick(out, 'RC')).toBe('1');
    expect(out).toContain(`background job ${JOB} holds conversation ${C}`);
    expect(h.calls().filter((c) => c === 'slept')).toEqual([]);   // said at once
  });

  it('a wait recorded by a supervisor that is no longer heartbeating is not reported', () => {
    // Its supervisor still runs (the record names this very shell), so it is
    // the HEARTBEAT that refuses here — a stalled supervisor, not a dead one.
    h.sh(`_reg_set ${ID} wrapper ${W}`);
    const out = h.sh(`_ci_bgwait_open ${ID} ${JOB} ${C} ${W} 2>/dev/null; _reg_set ${ID} supervised 1000; `
      + `SUPERVISED_START_WAIT=2; sleep() { :; }; _have_systemctl() { return 0; }; `
      + '_svc_reset_failed() { :; }; _svc_enable_now() { return 0; }; _alive() { return 1; }; _svc_status_hint() { :; }; '
      + `{ _supervised_start ${ID}; echo "RC:$?"; } 2>&1`);
    expect(out).not.toContain('is waiting');
    expect(out).toContain('no pane appeared');
  });

  it('the per-tick liveness check pins the worker by its /proc start time: a recycled pid does not hold the row', () => {
    // `kill -0` alone says only that SOME process has the pid. The start time
    // (stat field 22) is fixed for a process's life; the command name may hold
    // spaces and parentheses, so fields are counted after the LAST ") ".
    const out = h.sh(`_CI_PROC="$HOME/proc"; mkdir -p "$HOME/proc/$$"; `
      + `printf '%s (we) ird) S 1 1 1 0 -1 4194560 1 0 0 0 0 0 0 0 20 0 1 0 12345 0 0\\n' $$ > "$HOME/proc/$$/stat"; `
      + `_ci_proc_start $$; echo "PST:$_CI_PSTART"; _ci_hold_live $$ 12345 '' && echo "SAME:yes"; `
      + `printf '%s (we) ird) S 1 1 1 0 -1 4194560 1 0 0 0 0 0 0 0 20 0 1 0 99999 0 0\\n' $$ > "$HOME/proc/$$/stat"; `
      + `_ci_hold_live $$ 12345 '' || echo "REUSED:yes"`);
    expect(pick(out, 'PST')).toBe('12345');
    expect(pick(out, 'SAME')).toBe('yes');
    expect(pick(out, 'REUSED')).toBe('yes');
  });

  it('without /proc, the record’s procStart against `ps` is the check — Claude Code’s own rule', () => {
    const out = h.sh(`_CI_PROC="$HOME/no-proc"; ps0="$(LC_ALL=C TZ=UTC ps -o lstart= -p $$ | sed 's/ *$//')"; `
      + `_ci_hold_live $$ '' "$ps0" && echo "LIVE:yes"; _ci_hold_live $$ '' 'Thu Jan  1 00:00:00 1970' || echo "OTHER:yes"`);
    expect(pick(out, 'LIVE')).toBe('yes');
    expect(pick(out, 'OTHER')).toBe('yes');
  });

  it('a wait tick forks nothing where /proc answers — the cost is a builtin read', () => {
    // Counted with `ps` and `cat` shims: the record's liveness is asked of `ps`
    // once, when the wait finds its holder, and the worker's record (the
    // in-wait follow) is read with builtins — neither runs per tick.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    const bin = path.join(h.home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ps'), `#!/bin/sh\necho "ps tick=\${__T:-?}" >> "${path.join(h.home, 'ps-calls')}"\nexec /bin/ps "$@"\n`, { mode: 0o755 });
    writeFileSync(path.join(bin, 'cat'), `#!/bin/sh\necho "cat tick=\${__T:-?}" >> "${path.join(h.home, 'ps-calls')}"\nexec /bin/cat "$@"\n`, { mode: 0o755 });
    runSup(`${SUP_STUBS} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      _CI_PROC="$HOME/proc"; mkdir -p "$HOME/proc/$w"; printf '%s (claude) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 777 0 0\\n' $w > "$HOME/proc/$w/stat"
      ${clock('export __T=$__t; (( __t == 10 )) && { kill -9 $w; wait $w 2>/dev/null; };')}
      cmd_supervise ${ID}`);
    const ps = existsSync(path.join(h.home, 'ps-calls')) ? readFileSync(path.join(h.home, 'ps-calls'), 'utf8').split('\n').filter(Boolean) : [];
    expect(ps.filter((l) => /tick=([1-9])$/.test(l))).toEqual([]);   // no ps, no cat on ticks 1..9
    expect(h.calls().filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${C} tick=10`]);
  });

  it('a supervisor restarted mid-wait keeps the wait’s onset; another job is a new wait', () => {
    h.sh(`_reg_set ${ID} bgwait "state=open job=${JOB} id=${C} since=1 wrapper=${W}"`);
    h.sh(`_ci_bgwait_open ${ID} ${JOB} ${C} ${W} 2>/dev/null`);
    expect(h.reg(ID, 'bgwait')).toContain('since=1 ');
    h.sh(`_ci_bgwait_open ${ID} eeeeeeee ${'e'.repeat(36)} ${W} 2>/dev/null`);
    expect(h.reg(ID, 'bgwait')).toMatch(/^state=open job=eeeeeeee .*since=(?!1 )\d+/);
  });

  it('a row with nothing in the background is not held up at all', () => {
    row(h.home, A);
    plant(h.home, A, turnLine('one'));
    h.sh(`_reg_set ${ID} started 1`);
    runSup(`${SUP_STUBS} ${clock('')} cmd_supervise ${ID}`);
    expect(h.calls().filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${A} tick=0`]);
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.bgwait`))).toBe(false);
  });

  // ── Review round 3 (RR2-W1-1): the pre-flight's verdict is re-taken after a wait ──
  // The pre-flight probes ONCE, before the wait, and the wait lasts as long
  // as the background worker lives (hours, measured). A tmux server that
  // wedges silent during the wait, with the job ending inside the wedge, used
  // to send the supervisor into cmd_ensure on the pre-wait `gone`, and from
  // there into `_tmux_new_session`, whose list-sessions/new-session carry no
  // deadline: the hang the pre-flight exists to refuse.
  /** A probe that answers `gone` until `$HOME/wedged` exists, then `unknown`
   *  with a silent (not absent) substrate twice, then `gone` again so the
   *  loop leaves by its own exit. Every answer is logged with its tick. */
  const WEDGING_PROBE = `systemctl() { :; }; launchctl() { :; }; _svc_enable() { :; };
    _substrate_mark() { echo "mark tick=\${__t:-0}" >> "$HOME/ccd-calls"; };
    __u=0; _session_probe() {
      if [[ -e "$HOME/wedged" ]] && (( ++__u <= 2 )); then PROBE_VERDICT=unknown; PROBE_SUBSTRATE=unmeasured
      else PROBE_VERDICT=gone; PROBE_SUBSTRATE=present; fi
      PROBE_DETAIL=""; echo "probe $PROBE_VERDICT tick=\${__t:-0}" >> "$HOME/ccd-calls"; };
    cmd_ensure() { echo "ensure tick=\${__t:-0}" >> "$HOME/ccd-calls"; };`;

  it('a wait that ends inside a substrate fault re-probes, and does not ensure into the wedge — the loop is entered on `unknown`', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    const r = runSup(`${WEDGING_PROBE} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      ${clock('(( __t == 2 )) && : > "$HOME/wedged"; (( __t == 3 )) && { kill -9 $w; wait $w 2>/dev/null; };')}
      cmd_supervise ${ID}`);
    const calls = h.calls();
    expect(calls.filter((c) => c.startsWith('ensure ')), r.err).toEqual([]);
    // the pre-flight's own probe, then the re-probe the moment the wait ended
    expect(calls.filter((c) => c.startsWith('probe ')).slice(0, 2)).toEqual(['probe gone tick=0', 'probe unknown tick=3']);
    expect(calls).toContain('mark tick=3');   // the loop's `unknown` arm, not cmd_ensure
  });

  it('a wait that ends on a healthy substrate still ensures, after its re-probe', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    const r = runSup(`${WEDGING_PROBE} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      ${clock('(( __t == 3 )) && { kill -9 $w; wait $w 2>/dev/null; };')}
      cmd_supervise ${ID}`);
    const calls = h.calls();
    expect(calls.slice(0, calls.indexOf('ensure tick=3') + 1).filter((c) => /^(probe|ensure) /.test(c)), r.err)
      .toEqual(['probe gone tick=0', 'probe gone tick=3', 'ensure tick=3']);
  });

  it('with nothing to wait for, the pre-flight probes ONCE before it ensures — the re-probe costs the common path nothing', () => {
    row(h.home, A);
    plant(h.home, A, turnLine('one'));
    h.sh(`_reg_set ${ID} started 1`);
    const r = runSup(`${WEDGING_PROBE} ${clock('')} cmd_supervise ${ID}`);
    const calls = h.calls();
    expect(calls.slice(0, calls.indexOf('ensure tick=0') + 1).filter((c) => /^(probe|ensure) /.test(c)), r.err)
      .toEqual(['probe gone tick=0', 'ensure tick=0']);
  });
});

describe('#189 round 2 (RR-3): the pane’s pre-fork id follows the CURRENT verdict, not memory', () => {
  it('in one process: hop A -> C, then a finished turn in A cancels the marker — the pane writing A wins', () => {
    // THE REVIEWER'S X3. The walk's origin A used to be refused for the life
    // of the supervisor, while a restarted one wrote it at once: the registry
    // depended on how long the supervisor had been up.
    row('/w', A);
    const fA = plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A));
    const out = h.sh(`${TMUX_PANE} _sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; echo "HOP:$(_reg_get ${ID} uuid)"; `
      + `printf '%s' '${(turnLine('back in the pane') + asst('ok')).replace(/'/g, "'\\''")}' >> '${fA}'; `
      + `_sync_uuid ${ID}; echo "T4:$(_reg_get ${ID} uuid)"; _sync_uuid ${ID}; _sync_uuid ${ID}; _sync_uuid ${ID}; echo "T7:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'HOP')).toBe(C);
    expect(pick(out, 'T4')).toBe(A);
    expect(pick(out, 'T7')).toBe(A);
  });

  it('after a restart: refused while superseded, written the moment a finished turn cancels the marker (X2)', () => {
    row('/w', C);
    const fA = plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A));
    const out = h.sh(`${TMUX_PANE} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"; `
      + `printf '%s' '${turnLine('back in the pane').replace(/'/g, "'\\''")}' >> '${fA}'; `
      + `_sync_uuid ${ID}; echo "T3:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T2')).toBe(C);
    expect(pick(out, 'T3')).toBe(A);
  });

  it('a quiescent superseded pane id is read ONCE, then answered by its stamp', () => {
    row('/w', C);
    const fA = plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A));
    plantCountingTail();
    ticks(1);   // the registry's own first sight
    h.sh(`${TMUX_PANE} ${Array.from({ length: 8 }, () => `_sync_uuid ${ID}`).join('; ')}`);
    expect(h.reg(ID, 'uuid')).toBe(C);
    expect(tailCalls().filter((l) => l.includes(fA))).toHaveLength(1);
  });

  it('a parked pane is refused before any of it — no read of its transcript at all', () => {
    row('/w', C);
    const fA = plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A, JOB));
    plantCountingTail();
    h.sh(`${TMUX_PANE} ${Array.from({ length: 4 }, () => `_sync_uuid ${ID}`).join('; ')}`);
    expect(h.reg(ID, 'uuid')).toBe(C);
    expect(tailCalls().filter((l) => l.includes(fA))).toEqual([]);
  });
});

describe('#189 round 2 (RR-4): a read that failed is not measured — never "no marker"', () => {
  it('`_continued_in_of` answers rc 2 when jq or tail fails, rc 0 when it measured', () => {
    const f = plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    const g = plant('/w', B, turnLine('two'));
    plantFailingJq(1);
    const out = h.sh(`x=$(_continued_in_of '${f}' ${A}); echo "JQFAIL:$?:[$x]"; `
      + `x=$(_continued_in_of '${f}' ${A}); echo "OK:$?:[$x]"; `
      + `x=$(_continued_in_of '${g}' ${B}); echo "NONE:$?:[$x]"; `
      + `x=$(_continued_in_of "$HOME/gone.jsonl" ${A}); echo "TAILFAIL:$?:[$x]"`);
    expect(pick(out, 'JQFAIL')).toBe('2:[]');
    expect(pick(out, 'OK')).toBe(`0:[${B}]`);
    expect(pick(out, 'NONE')).toBe('0:[]');
    expect(pick(out, 'TAILFAIL')).toBe('2:[]');
  });

  it('a jq that fails ONCE does not lose the follow: the next quiescent tick reads again and hops', () => {
    // THE REVIEWER'S X4. The stamp used to be committed before the read, and
    // a marked file's stamp never changes again: 20 ticks on A.
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    plantFailingJq(1);
    const out = h.sh(`_sync_uuid ${ID}; _sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"; _sync_uuid ${ID}; echo "T3:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T2')).toBe(A);
    expect(pick(out, 'T3')).toBe(B);
  });

  it('a read that keeps failing is retried on a backoff, not on every tick — and still follows once it heals', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    plantFailingJq(3);   // fails at the examinations of ticks 2, 3 and 5; tick 9 reads
    const out = h.sh(`${Array.from({ length: 8 }, () => `_sync_uuid ${ID}`).join('; ')}; echo "T8:$(_reg_get ${ID} uuid)"; `
      + `_sync_uuid ${ID}; echo "T9:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T8')).toBe(A);
    expect(pick(out, 'T9')).toBe(B);
    expect(jqCalls()).toBe(4);
  });

  it('a box whose jq never works reads a quiescent row a handful of times in 30 ticks, not 29', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    plantFailingJq(1000);
    ticks(30);
    expect(h.reg(ID, 'uuid')).toBe(A);
    expect(jqCalls()).toBeLessThanOrEqual(6);
  });

  it('a failed read of the pane’s pre-fork id refuses it for that tick — it does not let it back in', () => {
    row('/w', C);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A));
    plantFailingJq(1);
    const out = h.sh(`${TMUX_PANE} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"; _sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T1')).toBe(C);
    expect(pick(out, 'T2')).toBe(C);
  });

  it('a failed read on the resume walk does not hop, and says so', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    plantFailingJq(1);
    const out = h.sh(`_ci_chain_end ${ID} "$(_cfg_dir ${W})"; echo "END:$_CI_END UNREAD:\${_CI_END_UNREAD:-0}"`);
    expect(pick(out, 'END')).toBe(A);
    expect(pick(out, 'UNREAD')).toBe('1');
  });

  it('the supervisor reads a failed chain again before it resumes — a resume of the unread pre-fork id would cancel its marker for good', () => {
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    plantFailingJq(1);
    runSup(`${SUP_STUBS} __t=0; sleep() { __t=$((__t+1)); }; cmd_supervise ${ID}`);
    expect(h.calls().filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${C} tick=1`]);
  });
});

// ── #189 review round 2, the verifier's gaps ──────────────────────────────────
// Each guard the round-2 change added that nothing pinned (V1, V2, V3, V6, V7,
// V9), the false "waiting" report (PR4), and the two residuals it found: a
// pane read that keeps failing was re-read every tick, and a restore of a held
// row left it unsupervised.

/** A real binary's path, resolved outside the harness PATH (the shims below
 *  exec it). */
const realBin = (name: string): string => execSync(`command -v ${name}`, { shell: '/bin/bash', encoding: 'utf8',
  env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' } }).trim();

/** A shim on the harness PATH that FAILS (exit 137, the OOM killer's) whenever
 *  its arguments name `needle` — at most `times` times, or until
 *  `$HOME/<name>-heal` exists — logging each failure, and is the real binary
 *  otherwise. A failing `jq` drains its stdin first, as a killed one would
 *  leave its pipe. */
function plantFailingFor(name: string, needle: string, opts: { times?: number } = {}): void {
  const real = realBin(name);
  const bin = path.join(h.home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const log = path.join(h.home, `${name}-fails`);
  const heal = path.join(h.home, `${name}-heal`);
  const limit = opts.times === undefined ? ''
    : `  n=0; [ -f "${log}" ] && n=$(grep -c x "${log}"); [ "$n" -ge ${opts.times} ] && exec ${real} "$@"\n`;
  const drain = name === 'jq' ? 'cat >/dev/null; ' : '';
  writeFileSync(path.join(bin, name),
    `#!/bin/sh\ncase "$*" in *${needle}*)\n  [ -e "${heal}" ] && exec ${real} "$@"\n${limit}`
    + `  echo x >> "${log}"; ${drain}exit 137 ;;\nesac\nexec ${real} "$@"\n`, { mode: 0o755 });
}
const failsOf = (name: string): number => {
  const f = path.join(h.home, `${name}-fails`);
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
};

describe('#189 round 2, verifier pins: every guard the wait and the three-way reads added', () => {
  const clock = (act: string): string =>
    `__t=0; sleep() { __t=$((__t+1)); echo "tick $__t" >> "$HOME/ccd-calls"; ${act} };`;

  it('a supervisor restarted while the pane is LIVE (its agents view still open) supervises it — it does not wait for the job (V1)', () => {
    // A deploy's try-restart lands while the pane still shows the agents view:
    // the conversation's chain end is held by a live job, but the PANE is up.
    // A supervisor that waited here would leave that live pane unsupervised —
    // no _sync_uuid, no auto-swap, no compact — for the job's whole life.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    const r = runSup(`systemctl() { :; }; launchctl() { :; }; _svc_enable() { :; };
      __n=0; _session_probe() { __n=$((__n+1)); if (( __n <= 2 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; PROBE_DETAIL=""; };
      _sync_uuid() { echo "sync tick=\${__t:-0}" >> "$HOME/ccd-calls"; }; _auto_stale_check() { :; }; _auto_swap_check() { :; }; _auto_compact_check() { :; }; _route_apply_check() { :; };
      cmd_ensure() { echo "ensure tick=\${__t:-0}" >> "$HOME/ccd-calls"; };
      command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w')}
      ${clock('(( __t > 4 )) && { kill -9 $w; wait $w 2>/dev/null; };')}
      cmd_supervise ${ID}`);
    const calls = h.calls();
    expect(calls.filter((c) => c.startsWith('ensure ')), r.err).toEqual(['ensure tick=0']);
    expect(calls).toContain('sync tick=0');   // the live pane is supervised at once
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.bgwait`))).toBe(false);
  });

  it('a `stat` of the pane’s pre-fork id that FAILS refuses it for that tick — not measured is not "let in" (V2)', () => {
    // A restarted supervisor (no walk memory), the pane unparked on A, A
    // superseded by C. The size/mtime stat is the stamp the verdict is keyed
    // by; without it nothing was measured, so A is refused this tick.
    row('/w', C);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A));
    plantFailingFor('stat', `${A}.jsonl`, { times: 1 });
    const out = h.sh(`${TMUX_PANE} _sync_uuid ${ID}; echo "T1:$(_reg_get ${ID} uuid)"; _sync_uuid ${ID}; echo "T2:$(_reg_get ${ID} uuid)"`);
    expect(failsOf('stat')).toBe(1);
    expect(pick(out, 'T1')).toBe(C);
    expect(pick(out, 'T2')).toBe(C);
  });

  it('a pane id the walk remembers stays refused when its addresses cannot be resolved — an unreadable workdir is not "no transcript" (V3)', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A));
    const out = h.sh(`${TMUX_PANE} _sync_uuid ${ID}; _sync_uuid ${ID}; echo "HOP:$(_reg_get ${ID} uuid)"; `
      + `rm -f "$REG/${ID}.workdir"; _sync_uuid ${ID}; echo "T3:$(_reg_get ${ID} uuid)"; _sync_uuid ${ID}; echo "T4:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'HOP')).toBe(C);
    expect(pick(out, 'T3')).toBe(C);
    expect(pick(out, 'T4')).toBe(C);
  });

  it('the failed-read backoff is keyed by the STAMP: a changed file is read at once, and its first failure counts from one (V6)', () => {
    // jq fails on its first four calls. Ticks 2, 3 and 5 fail (the third
    // failure puts the next read off for three ticks); then A changes (Claude
    // Code re-stamps metadata after the marker — D-4940 steps over it), and the
    // new stamp is read at tick 7 (fails: the fourth) and again at tick 8 —
    // not after the OLD stamp's countdown, and not after a fourth-failure one.
    row('/w', A);
    const fA = plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    plantFailingJq(4);
    const meta = JSON.stringify({ type: 'last-prompt', lastPrompt: 'go on', sessionId: A });
    const out = h.sh(`${Array.from({ length: 5 }, () => `_sync_uuid ${ID}`).join('; ')}; echo "T5:$(_reg_get ${ID} uuid)"; `
      + `printf '%s\\n' '${meta}' >> '${fA}'; `
      + `_sync_uuid ${ID}; _sync_uuid ${ID}; echo "T7:$(_reg_get ${ID} uuid)"; _sync_uuid ${ID}; echo "T8:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T5')).toBe(A);
    expect(pick(out, 'T7')).toBe(A);
    expect(jqCalls()).toBe(5);
    expect(pick(out, 'T8')).toBe(B);
  });

  it('without /proc, the wait asks `ps` for the worker’s recorded procStart every tick — a recycled pid ends it (V7)', () => {
    // The pid-reuse check on a box with no /proc compares the procStart the
    // worker's record carried when the wait began with `ps -o lstart=` now.
    // Here `ps` starts answering another start time at tick 3 — the pid has
    // been handed to another process — and the wait ends there, not when the
    // worker is finally killed at tick 8.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1`);
    const T0 = 'Mon Jan  1 00:00:00 2024', T1 = 'Tue Jan  2 00:00:00 2024';
    const bin = path.join(h.home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ps'), '#!/bin/sh\ncase "$*" in *lstart*)\n'
      + `  if [ "\${__T:-0}" -ge 3 ]; then echo '${T1}'; else echo '${T0}'; fi; exit 0 ;;\nesac\nexec ${realBin('ps')} "$@"\n`, { mode: 0o755 });
    runSup(`${SUP_STUBS} command sleep 60 >/dev/null 2>&1 & w=$!; trap 'kill -9 $w 2>/dev/null' EXIT; ${bgRecord(C, JOB, '$w', T0)}
      _CI_PROC="$HOME/no-proc"
      ${clock('export __T=$__t; (( __t == 8 )) && { kill -9 $w; wait $w 2>/dev/null; };')}
      cmd_supervise ${ID}`);
    expect(h.calls().filter((c) => c.startsWith('ensure '))).toEqual([`ensure uuid=${C} tick=3`]);
  });

  it('a CLOSED wait is never reported, even with its supervisor up and its heartbeat fresh — the pane is on its way (V9)', () => {
    // The supervisor that closed the wait is the one now resuming the
    // conversation (a long resume can take minutes before the pane is up).
    h.sh(`_reg_set ${ID} wrapper ${W}`);
    const out = h.sh(`_ci_bgwait_open ${ID} ${JOB} ${C} ${W} 2>/dev/null; _ci_bgwait_close ${ID} over ${C}; _reg_set ${ID} supervised "$(date +%s)"; `
      + `SUPERVISED_START_WAIT=5; __n=0; _alive() { __n=$((__n+1)); (( __n >= 3 )); }; sleep() { :; }; _have_systemctl() { return 0; }; `
      + '_svc_reset_failed() { :; }; _svc_enable_now() { return 0; }; '
      + `{ _supervised_start ${ID}; echo "RC:$?"; } 2>&1`);
    expect(h.reg(ID, 'bgwait')).toMatch(/^state=closed .*sup=\d+ /);
    expect(out).not.toContain('is waiting');
    expect(pick(out, 'RC')).toBe('0');
  });

  it('a wait left OPEN by a supervisor that was stopped is not reported on the NEXT supervisor’s first heartbeat (PR4)', () => {
    // `ccd stop` mid-wait SIGTERMs the supervisor (KillMode=process, the wait
    // has no trap): the record stays state=open. The job then ends, `ccd
    // start` starts a new supervisor, and that one stamps `supervised` at its
    // first line — long before its pre-flight closes the record. The pane
    // comes up moments later; nothing holds the conversation.
    h.sh(`_reg_set ${ID} wrapper ${W}`);
    h.sh(`"$BASH" -c 'source "${CCD}"; _ci_bgwait_open ${ID} ${JOB} ${C} ${W}' 2>/dev/null`);   // a supervisor, now gone
    expect(h.reg(ID, 'bgwait')).toMatch(/^state=open .*sup=\d+/);
    const out = h.sh(`_reg_set ${ID} supervised "$(date +%s)"; `
      + `SUPERVISED_START_WAIT=5; __n=0; _alive() { __n=$((__n+1)); (( __n >= 3 )); }; sleep() { :; }; _have_systemctl() { return 0; }; `
      + '_svc_reset_failed() { :; }; _svc_enable_now() { return 0; }; '
      + `{ _supervised_start ${ID}; echo "RC:$?"; } 2>&1`);
    expect(out).not.toContain('is waiting');
    expect(pick(out, 'RC')).toBe('0');
  });

  it('a supervisor restarted mid-wait takes the open record over — the onset kept, its own name written — and is reported (PR4)', () => {
    h.sh(`_reg_set ${ID} wrapper ${W}`);
    h.sh(`"$BASH" -c 'source "${CCD}"; _ci_bgwait_open ${ID} ${JOB} ${C} ${W}' 2>/dev/null`);
    const since = /since=(\d+)/.exec(h.reg(ID, 'bgwait') ?? '')?.[1];
    const out = h.sh(`_ci_bgwait_open ${ID} ${JOB} ${C} ${W} 2>/dev/null; echo "ME:$$"; _reg_set ${ID} supervised "$(date +%s)"; `
      + `SUPERVISED_START_WAIT=3; sleep() { :; }; _have_systemctl() { return 0; }; `
      + '_svc_reset_failed() { :; }; _svc_enable_now() { return 0; }; _alive() { return 1; }; '
      + `{ _supervised_start ${ID}; echo "RC:$?"; } 2>&1`);
    const rec = h.reg(ID, 'bgwait') ?? '';
    expect(rec).toContain(`since=${since} `);
    expect(rec).toContain(`sup=${pick(out, 'ME')} `);
    expect(out).toContain(`background job ${JOB} holds conversation ${C}`);
    expect(pick(out, 'RC')).toBe('1');
    const log = readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8');
    expect(log.match(/ bgwait demo-quiet-basin:/g) ?? []).toHaveLength(1);   // one entry: the onset, not the take-over
  });

  it('a record naming a supervisor pid that another process now holds is not reported — the /proc start time decides (PR4)', () => {
    const run = (supst: string): string => h.sh(`_CI_PROC="$HOME/proc"; mkdir -p "$HOME/proc/$$"; `
      + `printf '%s (bash) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 777 0 0\\n' $$ > "$HOME/proc/$$/stat"; `
      + `_reg_set ${ID} bgwait "state=open job=${JOB} id=${C} since=1 wrapper=${W} sup=$$ supst=${supst}"; _reg_set ${ID} supervised "$(date +%s)"; `
      + 'SUPERVISED_START_WAIT=2; sleep() { :; }; _have_systemctl() { return 0; }; _svc_reset_failed() { :; }; _svc_enable_now() { return 0; }; '
      + `_alive() { return 1; }; _svc_status_hint() { :; }; { _supervised_start ${ID}; echo "RC:$?"; } 2>&1`);
    h.sh(`_reg_set ${ID} wrapper ${W}`);
    expect(run('12345')).not.toContain('is waiting');   // the pid answers, but it is not the process that wrote the record
    expect(run('777')).toContain('is waiting');         // the same pid, the same start time: the supervisor itself
  });

  it('a box whose jq never works for the pane’s id re-reads it on a backoff, refusing it meanwhile — and a changed stamp is read at once (residual a)', () => {
    // A restarted supervisor, the pane unparked on superseded A. Every read of
    // A fails: it is refused each tick, and read at ticks 1, 2, 4 and 8 — not
    // 10 times in 10 ticks. Then a finished turn lands in A (the session went
    // on in it: D-4940 cancels the marker) and jq works again: the next tick
    // reads the new stamp at once, and the pane writing A wins.
    row('/w', C);
    const fA = plant('/w', A, `${turnLine('one')}${marker(A, C)}`);
    plant('/w', C, turnLine('two'));
    plantPane(paneRecord(A));
    plantFailingFor('jq', A);
    const turn = (turnLine('back in the pane') + asst('ok')).replace(/'/g, "'\\''");
    const out = h.sh(`${TMUX_PANE} ${Array.from({ length: 10 }, () => `_sync_uuid ${ID}`).join('; ')}; `
      + `echo "T10:$(_reg_get ${ID} uuid) F10:$(grep -c x "$HOME/jq-fails")"; `
      + `printf '%s' '${turn}' >> '${fA}'; : > "$HOME/jq-heal"; _sync_uuid ${ID}; echo "T11:$(_reg_get ${ID} uuid)"`);
    expect(pick(out, 'T10')).toBe(C);
    expect(pick(out, 'F10')).toBe('4');
    expect(pick(out, 'T11')).toBe(A);
  });

  it('a ws-restore of a row whose conversation a live background job holds leaves it SUPERVISED — the wait takes over (residual b)', () => {
    // `_spawn_start` declines (rc `_CI_HELD_RC`) after the archive stamps are
    // already gone; the row used to end unarchived, paneless and unsupervised,
    // with nothing to revive it when the job ended.
    row(h.home, A);
    plant(h.home, A, `${turnLine('one')}${marker(A, C)}`);
    plant(h.home, C, turnLine('two'));
    h.sh(`_reg_set ${ID} started 1; _reg_set ${ID} archived 1787000000; _reg_set ${ID} archivedreason test`);
    const out = h.sh(`sleep() { :; }; ${TMUX_UP} _spawn_settle() { :; }; _ws_supervise() { echo "supervise $1" >> "$HOME/ccd-calls"; }; `
      + `command sleep 60 >/dev/null 2>&1 & w=$!; ${bgRecord(C, JOB, '$w')} `
      + `{ cmd_ws_restore --session ${ID}; echo "RC:$?"; } 2>&1; kill -9 $w`);
    expect(pick(out, 'RC')).toBe(h.sh('echo $_CI_HELD_RC'));
    expect(h.calls()).toContain(`supervise ${ID}`);
    expect(spawnedArgs()).toEqual([]);
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.archived`))).toBe(false);
    expect(JSON.stringify(eventsOf(h.home, 'restore'))).toContain(`background job ${JOB} holds its conversation`);
  });
});
