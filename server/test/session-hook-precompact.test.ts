// The PreCompact line (Overlord W1a, context readings; W0-05). An automatic compaction can fire PreCompact with no
// PostCompact after it, so PreCompact writes one line to `$REG/<id>.compactevents`, its OWN file: every PostCompact commit
// re-checks the whole `.compactions` journal against JOURNAL_RECORD_PRED, and a second line shape there would refuse
// every later commit. One writer (`_hook_compact_pre_line`), an arm of its own after `_hook_compact_pre` and
// `_hook_history_pre`, so the card's early returns (its off switch, an unresolved scope, its lock miss) never drop the
// line; under the row's `.compactions.lock`; dot-free, so `_reg_purge` takes it with the row; bounded by rotation to
// `.compacteventsprev` at PRECOMPACT_KEEP lines.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME (the harness shape of session-hook-compact-carry.test.ts,
// copied: a test file cannot import another). `_reg_purge` runs through makeCcdHarness's fixture HOME, never the live one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { holdCompactLock } from './lifecycleHelpers.js';
import { makeCcdHarness } from './ccdWsHelpers.js';
import { compactionsSince, type CompactionLine } from '../src/continuity/compactions.js';
import { IMPLS, hookArgv, runHook, type Impl } from './hookTwin.js';
import { coreBinary } from './coreBuild.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const HELPER_SRC = path.resolve(__dirname, '../../ccd/compact-card.mjs');
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const KEEP = 32;   // PRECOMPACT_KEEP, read from the hook below so a drift is a red, not a stale literal

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-precompact-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (): string => path.join(home, '.cc-sessions');
const preFile = (): string => path.join(reg(), `${ID}.compactevents`);
const prevFile = (): string => path.join(reg(), `${ID}.compacteventsprev`);
const journal = (): string => path.join(reg(), `${ID}.compactions`);
const linesOf = (p: string): Array<Record<string, unknown>> => fs.existsSync(p)
  ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
  : [];

const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home,
  PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242',
  CCRC_SESSION_GENERATION: GENERATION, ...over,
});
/** The implementation the running describe asks for (Go core wave 2, Task 8b): each behaviour describe runs once per
 *  implementation, in its own fixture HOME, so every case reads that implementation's own files. */
let impl: Impl = 'bash';
const run = (payload: object, over: NodeJS.ProcessEnv = {}): void => {
  // Bounded (review 1927 M6): hookTwin's runHook spawns through spawnSyncGroup (#896), which also ends the hook's
  // process group, under a timeout, so a hung hook fails the case rather than the event loop.
  const r = runHook({ home, env: (e = {}) => e }, impl, payload, env(over));
  expect(r.status, 'the hook contract: exit 0 on every path (a timeout reads as status null; review 1937 F5)').toBe(0);
};
/** A transcript that exists, so `_hook_compact_scope` resolves `main` for a manual compaction. */
const transcript = (): string => {
  const proj = path.join(home, '.claude', 'projects', '-rig-repo');
  fs.mkdirSync(proj, { recursive: true });
  const t = path.join(proj, `${UUID}.jsonl`);
  fs.writeFileSync(t, '{"type":"user"}\n');
  const old = Math.floor(Date.now() / 1000) - 600;
  fs.utimesSync(t, old, old);
  return t;
};
const preCompact = (trigger: string, transcriptPath: string): object => ({
  session_id: UUID, transcript_path: transcriptPath, cwd: path.join(home, 'repo'),
  hook_event_name: 'PreCompact', trigger, custom_instructions: null,
});
const postCompact = (trigger: string, transcriptPath: string): object => ({
  session_id: UUID, transcript_path: transcriptPath, cwd: path.join(home, 'repo'),
  hook_event_name: 'PostCompact', trigger, compact_summary: 'fixture summary',
});

describe.each(IMPLS)('PreCompact writes one line to its own file (W0-05) (%s)', (which) => {
  beforeEach(() => { impl = which; });
  const itBash = which === 'bash' ? it : it.skip;
  itBash('the hook\'s PRECOMPACT_KEEP is the bound this suite tests (the bash\'s text; TestCompactConstantsPinned holds the Go one)', () => {
    expect(fs.readFileSync(HOOK, 'utf8')).toMatch(new RegExp(`^PRECOMPACT_KEEP=${KEEP}$`, 'm'));
  });

  it('a manual PreCompact on a resolvable transcript writes {at, trigger, scope, transcript, phase:"pre"}', () => {
    const t = transcript();
    fs.mkdirSync(path.join(home, 'repo'));
    const before = Date.now();
    run(preCompact('manual', t));
    const lines = linesOf(preFile());
    expect(lines).toEqual([{ at: expect.any(Number), trigger: 'manual', scope: 'main', transcript: t, phase: 'pre' }]);
    expect(lines[0]!['at'] as number).toBeGreaterThanOrEqual(before);
    expect(lines[0]!['at'] as number).toBeLessThanOrEqual(Date.now());
    expect(fs.existsSync(journal()), 'PreCompact writes no journal record').toBe(false);
  });

  it('an automatic PreCompact on a resolvable transcript with no live agents writes scope main', () => {
    const t = transcript();
    run(preCompact('auto', t));
    expect(linesOf(preFile())).toEqual([{ at: expect.any(Number), trigger: 'auto', scope: 'main', transcript: t, phase: 'pre' }]);
  });

  // Plan review 1890 C1: the card's early returns must not drop the line, or a missing line reads as a measured zero.
  it('a PreCompact whose scope does not resolve still writes its line, scope and transcript null', () => {
    run(preCompact('auto', '/rig/absent/transcript.jsonl'));
    expect(linesOf(preFile())).toEqual([{ at: expect.any(Number), trigger: 'auto', scope: null, transcript: null, phase: 'pre' }]);
  });

  // Plan review 1896 B2: the line carries the scope verdict even when the card did not run, because every PreCompact
  // payload names the parent's transcript and the verdict is all that tells a subagent's compaction apart.
  it('with the compaction card switched off the line is still written, with the hook\'s own scope verdict', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'compact-card-off'), '');
    const t = transcript();
    run(preCompact('auto', t));
    expect(fs.existsSync(path.join(reg(), `${ID}.compactset`)), 'the card did not run').toBe(false);
    expect(linesOf(preFile())).toEqual([{ at: expect.any(Number), trigger: 'auto', scope: 'main', transcript: t, phase: 'pre' }]);
  });

  // Review 1937 F3: the rule's own answer is unset with CS_SCOPE, so a value inherited from the pane never stands in for
  // a verdict this run did not reach (the card off: its scope step, which sets them, does not run).
  it('CS_RULE_SCOPE and CS_RULE_TRANSCRIPT inherited from the environment are not read: the line says main', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'compact-card-off'), '');
    const t = transcript();
    run(preCompact('auto', t), { CS_RULE_SCOPE: 'subagent', CS_RULE_TRANSCRIPT: '/elsewhere/agent.jsonl', CS_REFUSED: '1' });
    expect(linesOf(preFile())).toEqual([{ at: expect.any(Number), trigger: 'auto', scope: 'main', transcript: t, phase: 'pre' }]);
  });

  it('a subagent\'s automatic compaction is written with scope subagent and its own transcript', () => {
    const t = transcript();
    const agents = path.join(path.dirname(t), UUID, 'subagents');
    fs.mkdirSync(agents, { recursive: true });
    const live = path.join(agents, 'agent-a1.jsonl');
    fs.writeFileSync(live, '{"type":"user"}\n');
    run(preCompact('auto', t));
    // as the bash names it: `${tp%.jsonl}/subagents`, then find's `/` and the name (on Windows the transcript's own
    // backslashes, then two slashes; on Linux and macOS this is `live`)
    const named = `${t.slice(0, -'.jsonl'.length)}/subagents/${path.basename(live)}`;
    expect(linesOf(preFile())).toEqual([{ at: expect.any(Number), trigger: 'auto', scope: 'subagent', transcript: named, phase: 'pre' }]);
  });

  it('a trigger outside auto and manual is written as other, never verbatim', () => {
    run(preCompact('$(boom)', transcript()));
    expect(linesOf(preFile()).map((l) => l['trigger'])).toEqual(['other']);
  });

  it('each PreCompact appends: two runs, two lines in order', () => {
    run(preCompact('auto', transcript()));
    run(preCompact('manual', transcript()));
    const lines = linesOf(preFile());
    expect(lines.map((l) => l['trigger'])).toEqual(['auto', 'manual']);
    expect(lines[0]!['at'] as number).toBeLessThanOrEqual(lines[1]!['at'] as number);
  });

  // Review 1927 I1: the line carries the scope RULE's answer, never the card's overlap degrade. A PreCompact with no
  // PostCompact (W0-05) leaves its set unconsumed for twenty minutes, and the card reads every PreCompact inside them as
  // ambiguous; the counter counts main lines only, so a second main compaction there would read as none.
  it('a PreCompact-only compaction, then a second within twenty minutes: two main lines, and both are counted', () => {
    fs.copyFileSync(HELPER_SRC, path.join(reg(), 'compact-card.mjs'));
    const t = transcript();
    fs.mkdirSync(path.join(home, 'repo'));
    const since = Date.now();
    run(preCompact('auto', t));
    expect(fs.existsSync(path.join(reg(), `${ID}.compactset`)), 'the unconsumed set the card reads as an overlap').toBe(true);
    run(preCompact('manual', t));
    const lines = linesOf(preFile());
    expect(lines).toEqual([
      { at: expect.any(Number), trigger: 'auto', scope: 'main', transcript: t, phase: 'pre' },
      { at: expect.any(Number), trigger: 'manual', scope: 'main', transcript: t, phase: 'pre' },
    ]);
    expect(compactionsSince(lines as unknown as CompactionLine[], since)).toBe(2);
  });

  it('a row whose generation is not this session\'s gets no line', () => {
    run(preCompact('auto', transcript()), { CCRC_SESSION_GENERATION: '0189abcd-0000-0000-0000-000000000000' });
    expect(fs.existsSync(preFile())).toBe(false);
  });

  // not on Windows: an MSYS2 FIFO is invisible to a native program (D-TBD-go-hook-windows-fifo)
  it.skipIf(process.platform === 'win32')('a FIFO at the pathname is never opened: the run returns and writes nothing', () => {
    expect(spawnSync('mkfifo', [preFile()]).status).toBe(0);
    const t0 = performance.now();
    run(preCompact('auto', transcript()));
    expect(performance.now() - t0).toBeLessThan(20_000);
    expect(fs.lstatSync(preFile()).isFIFO()).toBe(true);
  }, 30_000);

  it('a symlink at the pathname is not written through', () => {
    const target = path.join(home, 'elsewhere');
    fs.writeFileSync(target, '');
    fs.symlinkSync(target, preFile());
    run(preCompact('auto', transcript()));
    expect(fs.readFileSync(target, 'utf8')).toBe('');
  });
});

describe('the line is the last PreCompact arm (plan review 1890 I1)', () => {
  // The refusal arm, `_hook_compact_refuse`, writes its own `refused` line through this arm's function before it prints
  // its block (review 2004 F1), and a delivered block (`CS_REFUSED`) skips this last call; its cases are
  // session-hook-precompact-refuse.test.ts's.
  it('the dispatch calls _hook_compact_refuse first and _hook_compact_pre_line last: refuse, card, history, line', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    const at = (call: string): number => {
      const cond = call === '_hook_compact_pre_line' ? ' && -z "${CS_REFUSED-}"' : '';
      const line = `if [[ "$event" == PreCompact${cond} ]]; then ${call} || true; fi`;
      expect(src.split(line).length - 1, `${call} is dispatched once`).toBe(1);
      return src.indexOf(line);
    };
    const card = src.indexOf('if [[ "$event" == PreCompact  ]]; then _hook_compact_pre  || true; fi');
    expect(card, 'the card arm\'s dispatch').toBeGreaterThan(-1);
    expect(at('_hook_compact_pre_line')).toBeGreaterThan(at('_hook_history_pre'));
    expect(at('_hook_history_pre')).toBeGreaterThan(card);
    expect(card, 'the refusal is decided before the card (refusal-ahead-of-the-card)').toBeGreaterThan(at('_hook_compact_refuse'));
  });
});

describe.each(IMPLS)('the line is written under the row\'s .compactions.lock (%s)', (which) => {
  beforeEach(() => { impl = which; });
  const itBash = which === 'bash' ? it : it.skip;
  // THE MUTANT this pins: the append moved out of the locked section writes while another holder has the row.
  it('while another process holds the lock, PreCompact waits it out and writes nothing', async () => {
    const release = await holdCompactLock(home, ID, 30);
    try {
      run(preCompact('auto', transcript()));
      expect(fs.existsSync(preFile()), 'no line written past a held lock').toBe(false);
    } finally { release(); }
  }, 60_000);

  it('CONTROL: with the lock free the same run writes its line', () => {
    run(preCompact('auto', transcript()));
    expect(linesOf(preFile())).toHaveLength(1);
  });
});

describe.each(IMPLS)('the file is bounded by rotation, with no temp file (%s)', (which) => {
  beforeEach(() => { impl = which; });
  const itBash = which === 'bash' ? it : it.skip;
  const seedLines = (n: number): string => {
    const text = Array.from({ length: n }, (_, i) =>
      `${JSON.stringify({ at: 1_800_000_000_000 + i, trigger: 'auto', scope: 'main', transcript: null, phase: 'pre' })}\n`).join('');
    fs.writeFileSync(preFile(), text);
    return text;
  };

  it(`at ${KEEP} lines the file moves to .compacteventsprev whole, and the new line starts a fresh file`, () => {
    const text = seedLines(KEEP);
    run(preCompact('manual', transcript()));
    expect(fs.readFileSync(prevFile(), 'utf8')).toBe(text);
    expect(linesOf(preFile()).map((l) => l['trigger'])).toEqual(['manual']);
    expect(fs.readdirSync(reg()).filter((n) => n.startsWith(`.${ID}.compactevents`) || n.endsWith('.tmp')), 'no temp file').toEqual([]);
  });

  // Review 1927 M5: GNU mv moves a file INTO a directory destination, so an unchecked rotation would take the lines out
  // of the path the server reads, and a rotation that kept failing would let the current file grow without bound.
  it('a .compacteventsprev that is a directory: no line, both left alone', () => {
    const text = seedLines(KEEP);
    fs.mkdirSync(prevFile());
    run(preCompact('manual', transcript()));
    expect(fs.readFileSync(preFile(), 'utf8'), 'the current file is untouched').toBe(text);
    expect(fs.readdirSync(prevFile()), 'nothing moved into it').toEqual([]);
  });

  // Review 1937 F1: a link at .compacteventsprev used to silence every later line while the reader followed it. Under the
  // lock it is removed (`rm -f` takes the link, never its target), and the line is written: at the bound by rotating into
  // the freed name, below it in place.
  it.each(['dangling', 'to a file', 'to a directory'] as const)('a .compacteventsprev that is a symlink %s: the link goes, its target stays, the rotation happens', (kind) => {
    const text = seedLines(KEEP);
    const target = path.join(home, 'elsewhere');
    if (kind === 'to a file') fs.writeFileSync(target, 'kept\n');
    if (kind === 'to a directory') fs.mkdirSync(target);
    fs.symlinkSync(target, prevFile());
    run(preCompact('manual', transcript()));
    expect(fs.lstatSync(prevFile()).isSymbolicLink(), 'the link is gone').toBe(false);
    expect(fs.readFileSync(prevFile(), 'utf8'), 'the full file rotated into the freed name').toBe(text);
    expect(linesOf(preFile()).map((l) => l['trigger'])).toEqual(['manual']);
    if (kind === 'to a file') expect(fs.readFileSync(target, 'utf8')).toBe('kept\n');
    if (kind === 'to a directory') expect(fs.readdirSync(target)).toEqual([]);
    if (kind === 'dangling') expect(fs.existsSync(target)).toBe(false);
  });

  it('below the bound, a dangling link at .compacteventsprev is removed and the line is appended in place', () => {
    seedLines(3);
    fs.symlinkSync(path.join(home, 'nowhere'), prevFile());
    run(preCompact('auto', transcript()));
    expect(linesOf(preFile())).toHaveLength(4);
    expect(fs.lstatSync(prevFile(), { throwIfNoEntry: false }), 'the link is gone').toBeUndefined();
  });

  // Review 1937 F2: a rotation that is due and fails appends nothing, so the file never passes its bound.
  // BASH ONLY: the fault is a stub `mv` on PATH, which the Go hook never runs (it renames with rename(2)); the same failure
  // through the Go port is TestPreLineFailedRotationAppendsNothing.
  itBash('a rotation whose mv fails appends nothing: the file keeps its lines and does not grow past the bound', () => {
    const text = seedLines(KEEP);
    // Only the rotation's mv fails: the lock's own renames go through, so the run reaches the append and decides it.
    fs.writeFileSync(path.join(home, 'bin', 'mv'), '#!/bin/sh\ncase "$*" in *compacteventsprev*) exit 1 ;; esac\nexec /bin/mv "$@"\n', { mode: 0o755 });
    run(preCompact('manual', transcript()));
    expect(fs.readFileSync(preFile(), 'utf8'), 'no line appended after a failed rotation').toBe(text);
    expect(fs.existsSync(prevFile())).toBe(false);
    fs.rmSync(path.join(home, 'bin', 'mv'));
    run(preCompact('manual', transcript()));
    expect(fs.readFileSync(prevFile(), 'utf8'), 'CONTROL: with mv working the same run rotates').toBe(text);
  });

  it(`below ${KEEP} lines it appends in place and leaves no .compacteventsprev`, () => {
    seedLines(KEEP - 1);
    run(preCompact('auto', transcript()));
    expect(linesOf(preFile())).toHaveLength(KEEP);
    expect(fs.existsSync(prevFile())).toBe(false);
  });
});

describe.each(IMPLS)('PostCompact and its journal are untouched by the line (%s)', (which) => {
  beforeEach(() => { impl = which; });
  const itBash = which === 'bash' ? it : it.skip;
  it('a PreCompact then a PostCompact: one pre line in .compactevents, one record in .compactions with no phase', () => {
    fs.copyFileSync(HELPER_SRC, path.join(reg(), 'compact-card.mjs'));
    const t = transcript();
    fs.mkdirSync(path.join(home, 'repo'));
    run(preCompact('manual', t));
    run(postCompact('manual', t));
    expect(linesOf(preFile()).map((l) => l['phase'])).toEqual(['pre']);
    const recs = linesOf(journal());
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ trigger: 'manual', scope: 'main', transcript: t });
    expect(recs[0]).not.toHaveProperty('phase');
  });

  it('a second PostCompact still commits after a pre line exists (the journal\'s whole-file check never sees it)', () => {
    fs.copyFileSync(HELPER_SRC, path.join(reg(), 'compact-card.mjs'));
    const t = transcript();
    fs.mkdirSync(path.join(home, 'repo'));
    for (let i = 0; i < 2; i += 1) { run(preCompact('manual', t)); run(postCompact('manual', t)); }
    expect(linesOf(preFile())).toHaveLength(2);
    expect(linesOf(journal())).toHaveLength(2);
  });
});

// Task 9 switches the hook mid-session, so one compaction can be opened by one implementation and settled by the other,
// and each commits onto a journal the other wrote: the bash's stage predicate re-validates every line Go committed, and
// Go's every line the bash did (Go core wave 2, Task 8b).
describe('a compaction crosses implementations: each settles the other\'s set and appends to the other\'s journal', () => {
  it.each([['go', 'bash'], ['bash', 'go']] as const)('PreCompact in %s, PostCompact in %s, then the other way round: two records', (a, b) => {
    fs.copyFileSync(HELPER_SRC, path.join(reg(), 'compact-card.mjs'));
    const t = transcript();
    fs.mkdirSync(path.join(home, 'repo'));
    try {
      impl = a; run(preCompact('manual', t));
      impl = b; run(postCompact('manual', t));
      impl = b; run(preCompact('manual', t));
      impl = a; run(postCompact('manual', t));
    } finally { impl = 'bash'; }
    const recs = linesOf(journal());
    expect(recs, 'both settlements committed, the second onto the first').toHaveLength(2);
    for (const r of recs) expect(r).toMatchObject({ trigger: 'manual', scope: 'main', transcript: t });
    expect(linesOf(preFile()).map((l) => l['phase'])).toEqual(['pre', 'pre']);
    expect(fs.readdirSync(reg()).filter((n) => /compactpost|compactions-(stage|snapshot)|compactset/.test(n)), 'claims, stages and sets consumed').toEqual([]);
  });
});

describe('the row\'s purge takes both files (dot-free, so the suffix glob covers them)', () => {
  it('_reg_purge removes .compactevents and .compacteventsprev with the row', () => {
    const h = makeCcdHarness('ccrc-precompact-purge-');
    try {
      const id = 'demo-still-river';
      h.sh(`_reg_set ${id} project demo
        _reg_set ${id} workspace still-river`);
      const r = path.join(h.home, '.cc-sessions');
      fs.writeFileSync(path.join(r, `${id}.compactevents`), '{"phase":"pre"}\n');
      fs.writeFileSync(path.join(r, `${id}.compacteventsprev`), '{"phase":"pre"}\n');
      h.sh(`_reg_purge ${id}`);
      expect(fs.existsSync(path.join(r, `${id}.compactevents`))).toBe(false);
      expect(fs.existsSync(path.join(r, `${id}.compacteventsprev`))).toBe(false);
    } finally { h.cleanup(); }
  });

  it('a lone .compactevents or .compacteventsprev holds the slug, and _ws_slug_residue names it', () => {
    const h = makeCcdHarness('ccrc-precompact-slug-');
    try {
      const r = path.join(h.home, '.cc-sessions');
      fs.mkdirSync(r, { recursive: true });
      for (const field of ['compactevents', 'compacteventsprev']) {
        fs.writeFileSync(path.join(r, `demo-quiet-mesa.${field}`), '{"phase":"pre"}\n');
        expect(h.sh('_ws_slug_free demo quiet-mesa && echo free || echo held').trim(), field).toBe('held');
        expect(h.sh('_ws_slug_residue demo quiet-mesa'), field).toBe(`demo-quiet-mesa.${field}`);
        fs.rmSync(path.join(r, `demo-quiet-mesa.${field}`));
      }
      expect(h.sh('_ws_slug_free demo quiet-mesa && echo free || echo held').trim(), 'CONTROL').toBe('free');
    } finally { h.cleanup(); }
  });

  it('the hook names both files dot-free: no dot inside the suffix, none before the id', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(src).toContain('local f="$REG/$id.compactevents"');
    expect(src).toContain('"$REG/$id.compacteventsprev"');
  });
});

// ── The bash and the Go core on ONE `.compactions.lock` (Go core wave 2, Task 8b) ──────────────────────────────────────
// Task 9 switches the hook mid-session, so a bash hook and a Go hook of one row can run at once: both must take the same
// stable lock and exclude each other. A plain `>>` append is atomic on its own and would pass with no lock at all, so the
// race is placed ACROSS THE ROTATION BOUNDARY, where the events line's read-count-then-rename-then-append is a
// check-then-act only the lock makes safe: the file holds PRECOMPACT_KEEP - 1 lines, and every racer appends one. Under
// the lock exactly one racer brings it to the bound, exactly one rotates it (prev holds the seed and that line,
// PRECOMPACT_KEEP lines), and the rest start the fresh file: no line lost, none torn, none doubled.
// THE RACERS ARE PARKED TOGETHER (fix round 1, F1): unparked, a Go racer is done before a bash one reaches its tail, so
// the two rarely meet. Each round a flock(1) holder takes canonical (minted beforehand: flock(1) on an absent path would
// make a different inode) before the eight start; while it holds, no racer may write (asserted), and its release lets
// them all contend at once. Mutants measured red: the Go hook's flock(2) wait answering at once (row_unix.go#flockWait),
// and the Go hook locking `.compactions.lockX` (a bash/Go split, which leaves Go-Go and bash-bash exclusion whole).
// Exclusion measured inside the section itself is core/internal/adapter/lock/row_cross_test.go#TestBashAndGoExcludeOnTheRow.
describe('the bash and the Go core contend on one .compactions.lock (Task 8b)', () => {
  const ITER = Number(process.env['CCRC_LOCK_RACE_ITER'] ?? '12');
  const racer = (impl: Impl, payload: object): Promise<{ code: number | null; stderr: string; impl: Impl }> =>
    new Promise((resolve, reject) => {
      const [cmd, args] = hookArgv(impl);
      const child = spawn(cmd, args, { env: env() });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr, impl }));
      child.stdin.end(JSON.stringify(payload));
    });
  // Linux and macOS only: on Windows each racer's held section starts several MSYS2 processes, so eight of them in a row
  // outrun the last one's COMPACT_LOCK_WAIT (5 s) and it gives up its line by design (measured: rounds 0 to 2 whole, then
  // one line short with no line torn or doubled and one rotation). Bash and Go excluding each other on Windows is
  // core/internal/adapter/lock/row_cross_test.go#TestBashAndGoExcludeOnTheRow, which runs there.
  it.skipIf(process.platform === 'win32')(`${ITER} rounds of four bash and four Go PreCompacts at the rotation bound: one rotation, no line lost or torn`, async () => {
    coreBinary();
    const t = transcript();
    run(preCompact('manual', t));                        // mints canonical, as any first compaction does
    const lock = path.join(reg(), `.${ID}.compactions.lock`);
    expect(fs.lstatSync(lock).isFile(), 'canonical minted').toBe(true);
    for (let round = 0; round < ITER; round += 1) {
      for (const f of [preFile(), prevFile()]) fs.rmSync(f, { force: true });
      const seed = Array.from({ length: KEEP - 1 }, (_, i) =>
        `${JSON.stringify({ at: 1_800_000_000_000 + i, trigger: 'auto', scope: 'main', transcript: null, phase: 'pre' })}\n`).join('');
      fs.writeFileSync(preFile(), seed);
      const holder = spawn('flock', ['-x', lock, 'sh', '-c', 'echo held; read -r _'], { stdio: ['pipe', 'pipe', 'ignore'] });
      await new Promise<void>((res, rej) => {
        holder.stdout.on('data', (d: Buffer) => { if (d.toString().includes('held')) res(); });
        holder.on('error', rej);
      });
      const impls: Impl[] = ['bash', 'go', 'bash', 'go', 'bash', 'go', 'bash', 'go'];
      const racing = Promise.all(impls.map((i) => racer(i, preCompact('manual', t))));
      await new Promise((res) => setTimeout(res, 800));  // every racer parked on the held lock (each waits up to 5 s)
      expect(fs.readFileSync(preFile(), 'utf8'), `round ${round}: a racer wrote while another process held the row`).toBe(seed);
      holder.stdin.end();                                 // the release: all eight contend at once
      const done = await racing;
      for (const d of done) expect([d.impl, d.code, d.stderr], `round ${round}: the hook contract`).toEqual([d.impl, 0, '']);
      const prev = fs.readFileSync(prevFile(), 'utf8');
      const cur = fs.readFileSync(preFile(), 'utf8');
      const lines = (s: string): string[] => s.split('\n').slice(0, -1);
      expect(prev.endsWith('\n') && cur.endsWith('\n'), `round ${round}: whole lines only`).toBe(true);
      expect(prev.startsWith(seed), `round ${round}: the seed rotated whole`).toBe(true);
      expect(lines(prev), `round ${round}: one rotation, at the bound`).toHaveLength(KEEP);
      expect(lines(cur), `round ${round}: the other racers started the fresh file`).toHaveLength(impls.length - 1);
      for (const l of [...lines(prev).slice(KEEP - 1), ...lines(cur)]) {
        expect(JSON.parse(l), `round ${round}: a whole line`).toMatchObject({ trigger: 'manual', scope: 'main', transcript: t, phase: 'pre' });
      }
      expect(fs.readdirSync(reg()).filter((n) => /lock-(open|init)|generation-read/.test(n)), `round ${round}: no lock residue`).toEqual([]);
    }
  }, 600_000);
});
