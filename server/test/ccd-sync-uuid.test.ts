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

  it('a cycle stops after one lap instead of flapping the registry', () => {
    // Review round, F1/F2. A -> B -> A, with DISTINCT sizes (mtime need not
    // coincide at all here — only F1/F2's shared-stamp case needs that).
    // Keyed by the stamp alone, the registry flaps forever once the chain
    // returns to A: on a live fleet, one `_reg_set` every two ticks. Keyed by
    // uuid+stamp, returning to a (uuid, stamp) pair already in the visited
    // set stops the walk there. Traced by hand for this exact fixture: the
    // fixed implementation converges by tick 6 and STAYS there — asserting on
    // tick 7 (an odd tick, inside the old code's 4-tick flap period) is what
    // actually discriminates a fix from a mutant that still flaps.
    row('/w', A);
    plant('/w', A, `${turnLine('start-A')}${marker(A, B)}`);   // longer body
    plant('/w', B, marker(B, A));                              // shorter body
    ticks(7);
    expect(h.reg(ID, 'uuid')).toBe(A);
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
});
