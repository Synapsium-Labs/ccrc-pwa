import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldLastRuns, releasedFrom, type LastRun, type ReleasedInput } from '../src/coord/released.js';

const run = (over: Partial<LastRun> = {}): LastRun => ({
  sessionId: 'ccrc-pwa-amber-delta', runId: 41, state: 'done', program: 'lifecycle', programTitle: 'Workspace lifecycle',
  claimedBy: 'ccrc-pwa-calm-mesa', closedAt: 1_790_000_000_000, ...over,
});

const input = (over: Partial<ReleasedInput> = {}): ReleasedInput => ({
  workspace: 'amber-delta', held: false, archived: false, child: false,
  lastRun: run(), openAsWorker: false, openAsClaimant: false, ...over,
});

describe('releasedFrom — the six conditions (workspace lifecycle spec §5.1)', () => {
  it('answers the newest run when all six hold', () => {
    expect(releasedFrom(input())).toEqual({
      runId: 41, program: 'lifecycle', programTitle: 'Workspace lifecycle',
      claimedBy: 'ccrc-pwa-calm-mesa', closedAt: 1_790_000_000_000, child: false,
    });
  });

  it('a `failed` run releases too — both members of TERMINAL_RUN_STATES', () => {
    expect(releasedFrom(input({ lastRun: run({ state: 'failed' }) }))?.runId).toBe(41);
  });

  it.each([
    ['a main checkout', { workspace: null }],
    ['a held workspace', { held: true }],
    ['an archived workspace', { archived: true }],
    ['a session no run ever named', { lastRun: null }],
    ['a newest run still working', { lastRun: run({ state: 'working' }) }],
    ['a newest run still planned', { lastRun: run({ state: 'planned' }) }],
    ['a newest run awaiting review', { lastRun: run({ state: 'awaiting-review' }) }],
    ['a state this build cannot name', { lastRun: run({ state: 'escalated' }) }],
    ['a terminal run with no readable close time', { lastRun: run({ closedAt: null }) }],
    ['an older run still open on the session', { openAsWorker: true }],
    ['a session that now coordinates a live run', { openAsClaimant: true }],
  ] as const)('is null for %s', (_label, over) => {
    expect(releasedFrom(input(over as Partial<ReleasedInput>))).toBeNull();
  });

  it('carries the child reading through, and a null title as null', () => {
    expect(releasedFrom(input({ child: true, lastRun: run({ programTitle: null, claimedBy: null }) })))
      .toMatchObject({ child: true, programTitle: null, claimedBy: null });
  });
});

describe('foldLastRuns', () => {
  it('keeps the NEWEST run per session whatever order the rows arrive in', () => {
    const a = run({ runId: 7, state: 'working' });
    const b = run({ runId: 9, state: 'done' });
    for (const rows of [[a, b], [b, a]]) {
      expect(foldLastRuns(rows, [], [])('ccrc-pwa-amber-delta').lastRun?.runId).toBe(9);
    }
  });

  it('answers "no runs" for a session the read never mentions', () => {
    expect(foldLastRuns([run()], [], [])('someone-else')).toEqual({ lastRun: null, openAsWorker: false, openAsClaimant: false });
  });

  it('reads the two open sets by exact id', () => {
    const look = foldLastRuns([], ['w-1'], ['c-1']);
    expect(look('w-1')).toMatchObject({ openAsWorker: true, openAsClaimant: false });
    expect(look('c-1')).toMatchObject({ openAsWorker: false, openAsClaimant: true });
  });
});

describe('released.ts is the pure module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'released.ts'), 'utf8');
  // Comments blanked, positions preserved: the docstring NAMES fs, fastify and coord.db while promising not to use them.
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code', () => {
    expect(code()).toContain('export function releasedFrom');
    expect(code()).toContain('export function foldLastRuns');
  });

  it('has no clock, no node builtin, no store', () => {
    expect(code()).not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
    expect(code()).not.toMatch(/from\s+'node:|\bfs\s*\.|require\s*\(/);
    expect(code()).not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\.|\breply\b|\bFastify/);
  });

  it('imports only L0', () => {
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!.trim());
    expect(imports).toEqual([
      "import { TERMINAL_RUN_STATES, type ReleasedFrom, type RunState } from '../../../shared/api.js';",
    ]);
  });
});
