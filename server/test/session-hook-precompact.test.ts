// The PreCompact line (Overlord W1a, context readings; W0-05). An automatic compaction can fire PreCompact with no
// PostCompact after it, so PreCompact writes one line to `$REG/<id>.precompact`, its OWN file: every PostCompact commit
// re-checks the whole `.compactions` journal against JOURNAL_RECORD_PRED, and a second line shape there would refuse
// every later commit. One writer (`_hook_compact_pre_line`), inside PreCompact's first held section of the row's
// `.compactions.lock`, so a PreCompact whose scope does not resolve (it returns before that section) writes none;
// dot-free, so `_reg_purge` takes it with the row; bounded by rotation to `.precompactprev` at PRECOMPACT_KEEP lines.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME (the harness shape of session-hook-compact-carry.test.ts,
// copied: a test file cannot import another). `_reg_purge` runs through makeCcdHarness's fixture HOME, never the live one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { holdCompactLock } from './lifecycleHelpers.js';
import { makeCcdHarness } from './ccdWsHelpers.js';

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
const preFile = (): string => path.join(reg(), `${ID}.precompact`);
const prevFile = (): string => path.join(reg(), `${ID}.precompactprev`);
const journal = (): string => path.join(reg(), `${ID}.compactions`);
const linesOf = (p: string): Array<Record<string, unknown>> => fs.existsSync(p)
  ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
  : [];

const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home,
  PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242',
  CCRC_SESSION_GENERATION: GENERATION, ...over,
});
const run = (payload: object, over: NodeJS.ProcessEnv = {}): void => {
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: env(over) });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
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

describe('PreCompact writes one line to its own file (W0-05)', () => {
  it('the hook\'s PRECOMPACT_KEEP is the bound this suite tests', () => {
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

  // The line rides PreCompact's first held section, which a transcript that cannot be read never reaches: no line,
  // and the reader answers that session's file absent rather than a count of 0.
  it('a PreCompact whose scope does not resolve writes no line', () => {
    run(preCompact('auto', '/rig/absent/transcript.jsonl'));
    expect(fs.existsSync(preFile())).toBe(false);
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

  it('a row whose generation is not this session\'s gets no line', () => {
    run(preCompact('auto', transcript()), { CCRC_SESSION_GENERATION: '0189abcd-0000-0000-0000-000000000000' });
    expect(fs.existsSync(preFile())).toBe(false);
  });

  it('a FIFO at the pathname is never opened: the run returns and writes nothing', () => {
    expect(spawnSync('mkfifo', [preFile()]).status).toBe(0);
    const t0 = Date.now();
    run(preCompact('auto', transcript()));
    expect(Date.now() - t0).toBeLessThan(20_000);
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

describe('the line is written under the row\'s .compactions.lock', () => {
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

describe('the file is bounded by rotation, with no temp file', () => {
  const seedLines = (n: number): string => {
    const text = Array.from({ length: n }, (_, i) =>
      `${JSON.stringify({ at: 1_800_000_000_000 + i, trigger: 'auto', scope: 'main', transcript: null, phase: 'pre' })}\n`).join('');
    fs.writeFileSync(preFile(), text);
    return text;
  };

  it(`at ${KEEP} lines the file moves to .precompactprev whole, and the new line starts a fresh file`, () => {
    const text = seedLines(KEEP);
    run(preCompact('manual', transcript()));
    expect(fs.readFileSync(prevFile(), 'utf8')).toBe(text);
    expect(linesOf(preFile()).map((l) => l['trigger'])).toEqual(['manual']);
    expect(fs.readdirSync(reg()).filter((n) => n.startsWith(`.${ID}.precompact`) || n.endsWith('.tmp')), 'no temp file').toEqual([]);
  });

  it(`below ${KEEP} lines it appends in place and leaves no .precompactprev`, () => {
    seedLines(KEEP - 1);
    run(preCompact('auto', transcript()));
    expect(linesOf(preFile())).toHaveLength(KEEP);
    expect(fs.existsSync(prevFile())).toBe(false);
  });
});

describe('PostCompact and its journal are untouched by the line', () => {
  it('a PreCompact then a PostCompact: one pre line in .precompact, one record in .compactions with no phase', () => {
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

describe('the row\'s purge takes both files (dot-free, so the suffix glob covers them)', () => {
  it('_reg_purge removes .precompact and .precompactprev with the row', () => {
    const h = makeCcdHarness('ccrc-precompact-purge-');
    try {
      const id = 'demo-still-river';
      h.sh(`_reg_set ${id} project demo
        _reg_set ${id} workspace still-river`);
      const r = path.join(h.home, '.cc-sessions');
      fs.writeFileSync(path.join(r, `${id}.precompact`), '{"phase":"pre"}\n');
      fs.writeFileSync(path.join(r, `${id}.precompactprev`), '{"phase":"pre"}\n');
      h.sh(`_reg_purge ${id}`);
      expect(fs.existsSync(path.join(r, `${id}.precompact`))).toBe(false);
      expect(fs.existsSync(path.join(r, `${id}.precompactprev`))).toBe(false);
    } finally { h.cleanup(); }
  });

  it('the hook names both files dot-free: no dot inside the suffix, none before the id', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(src).toContain('local f="$REG/$id.precompact"');
    expect(src).toContain('"$REG/$id.precompactprev"');
  });
});
