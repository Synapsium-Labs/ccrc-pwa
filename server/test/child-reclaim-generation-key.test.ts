// Child-reclamation wave 8 (spec §5.5): the registry generation, `$REG/<id>.generation`, as the sweep's THIRD key.
// Two layers are pinned here; the lane that wires them is `child-reclaim-generation-lane.test.ts`.
// - L1 (`childReclaimSweep.ts`): the one key predicate, the entry's third key, and the verdict's doubt word
//   `identity-unmeasured` for an unreadable read.
// - The ONE read (`childReclaimGenerationRead`): byte-exact, three answers, a port's rejection left to its caller
//   (H5), and its stated residual
//   (a symlink is followed) pinned as measured behaviour.
// Fixture directories only: every path is under a `mkTmp` directory, never a live registry.
import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { childReclaimGenerationRead } from '../src/coord/childReclaim.js';
import {
  childReclaimFirstSighting, childReclaimSameGeneration, childReclaimSameGenerationKey, childReclaimSweepVerdict,
  isChildReclaimGenerationKey, type ChildReclaimSweepInput,
} from '../src/childReclaimSweep.js';
import type { ChildReclaimGenerationKey } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const G1 = '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';
const G2 = '7c9d0e1f-2a3b-4c5d-8e6f-1a2b3c4d5e6f';
const BOM = String.fromCharCode(0xfeff);
const value = (v: string): ChildReclaimGenerationKey => ({ kind: 'value', v });
const ABSENT: ChildReclaimGenerationKey = { kind: 'absent' };

describe('childReclaimSameGenerationKey, the one generation predicate (spec §5.5)', () => {
  it.each<readonly [string, ChildReclaimGenerationKey, ChildReclaimGenerationKey, boolean]>([
    ['an equal value matches', value(G1), value(G1), true],
    ['a different value does not', value(G1), value(G2), false],
    ['a value one byte apart does not', value(G1), value(`${G1.slice(0, 35)}c`), false],
    ['absent matches absent', ABSENT, ABSENT, true],
    ['a value does not match absent', value(G1), ABSENT, false],
    ['absent does not match a value', ABSENT, value(G1), false],
  ])('%s', (_label, a, b, same) => {
    expect(childReclaimSameGenerationKey(a, b)).toBe(same);
  });

  it('a read is a key unless it is unreadable', () => {
    expect(isChildReclaimGenerationKey(value(G1))).toBe(true);
    expect(isChildReclaimGenerationKey(ABSENT)).toBe(true);
    expect(isChildReclaimGenerationKey({ kind: 'unreadable' })).toBe(false);
  });
});

describe('the entry describes one workspace generation by THREE keys (spec §5.5, §5.6)', () => {
  const BORN = 1_789_000_000_000;
  const RUN = 7;

  it('a first sighting carries the generation it was sighted under', () => {
    expect(childReclaimFirstSighting(5_000, BORN, RUN, value(G1)).generation).toEqual(value(G1));
    expect(childReclaimFirstSighting(5_000, BORN, RUN, ABSENT).generation).toEqual(ABSENT);
  });

  it('the same birth and the same marker run under ANOTHER generation is a new workspace', () => {
    const e = childReclaimFirstSighting(5_000, BORN, RUN, value(G1));
    expect(childReclaimSameGeneration(e, BORN, RUN, value(G1))).toBe(true);
    expect(childReclaimSameGeneration(e, BORN, RUN, value(G2)), 'a same-run re-mint: only the generation moved')
      .toBe(false);
    expect(childReclaimSameGeneration(e, BORN, RUN, ABSENT)).toBe(false);
    expect(childReclaimSameGeneration(childReclaimFirstSighting(5_000, BORN, RUN, ABSENT), BORN, RUN, ABSENT)).toBe(true);
  });

  it('the other two keys still decide, and a null birth never matches whatever the generation', () => {
    expect(childReclaimSameGeneration(childReclaimFirstSighting(5_000, null, RUN, value(G1)), null, RUN, value(G1)))
      .toBe(false);
    const e = childReclaimFirstSighting(5_000, BORN, RUN, value(G1));
    expect(childReclaimSameGeneration(e, BORN + 1, RUN, value(G1))).toBe(false);
    expect(childReclaimSameGeneration(e, BORN, RUN + 1, value(G1))).toBe(false);
  });
});

describe('an unreadable generation makes the row’s identity unmeasured (spec §5.5)', () => {
  const NOW = 1_790_000_000_000;
  const base = (over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
    sessionId: 'demo-a', child: { kind: 'child', runId: 7 }, identityMeasured: true, generation: value(G1),
    workspace: 'demo-a', held: { kind: 'none' }, terminal: false,
    mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 3_600_000,
      openedAt: NOW - 3_600_000 } },
    reviewedRun: { kind: 'not-a-review' }, siblings: { ok: true, open: 0 }, coordinatorClaim: undefined,
    childBornAt: NOW - 3_600_000, skewMs: 120_000, nowMs: NOW, ...over,
  });

  it('a value and absent judge as before', () => {
    expect(childReclaimSweepVerdict(base())).toEqual({ eligible: true, runId: 7 });
    expect(childReclaimSweepVerdict(base({ generation: ABSENT }))).toEqual({ eligible: true, runId: 7 });
  });

  it('unreadable is the doubt word identity-unmeasured: never eligible, so it seeds no entry', () => {
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' } })))
      .toEqual({ eligible: false, why: 'identity-unmeasured' });
  });

  it('it answers ahead of every hold: a retired programme hold over it is no hold-retired sighting', () => {
    const retired = { kind: 'program', reason: 'r', program: 'p', accountedRunId: 7, open: { ok: true, count: 0 } } as const;
    expect(childReclaimSweepVerdict(base({ held: retired })), 'CONTROL: readable, it is hold-retired')
      .toMatchObject({ eligible: false, why: 'hold-retired' });
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' }, held: retired })))
      .toEqual({ eligible: false, why: 'identity-unmeasured' });
  });

  it('the marker still answers first', () => {
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' }, child: { kind: 'unreadable' } })))
      .toEqual({ eligible: false, why: 'marker-unreadable' });
    expect(childReclaimSweepVerdict(base({ generation: { kind: 'unreadable' }, child: { kind: 'none' } })))
      .toEqual({ eligible: false, why: 'not-a-child' });
  });
});

describe('childReclaimGenerationRead, the ONE read, byte-exact (spec §5.5)', () => {
  const reg = (): string => {
    const d = path.join(mkTmp('ccrc-cr-gen-read-'), '.cc-sessions');
    mkdirSync(d, { recursive: true });
    return d;
  };
  const at = (d: string): string => path.join(d, 'demo-a.generation');

  it('a file holding exactly the grammar is that value, byte for byte', async () => {
    const d = reg();
    writeFileSync(at(d), G1);
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'value', v: G1 });
  });

  it('no file is absent', async () => {
    expect(await childReclaimGenerationRead(localIO, reg(), 'demo-a')).toEqual({ kind: 'absent' });
  });

  it.each<readonly [string, string]>([
    ['a trailing LF, which a trim would strip', `${G1}\n`],
    ['a leading byte-order mark, which a trim would strip', `${BOM}${G1}`],
    ['a trailing NUL', `${G1}\0`],
    ['a leading space', ` ${G1}`],
    ['upper case', G1.toUpperCase()],
    ['an empty file', ''],
  ])('%s is unreadable: nothing is stripped', async (_label, content) => {
    const d = reg();
    writeFileSync(at(d), content);
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'unreadable' });
  });

  it('a directory at the name is unreadable, never absent', async () => {
    const d = reg();
    mkdirSync(at(d));
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'unreadable' });
  });

  it('a failed read is unreadable, never absent', async () => {
    const failing: Pick<FleetIO, 'readFileMeasured'> = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    expect(await childReclaimGenerationRead(failing, '/reg', 'demo-a')).toEqual({ kind: 'unreadable' });
  });

  // H5: the read does NOT catch a rejecting port, as `childReclaimPauseRead` does not. Each caller's try answers it:
  // the sweep's gather folds it to `unreadable` for that row, the executor's re-read defers `marker-unreadable`, and
  // the release job answers `failed`.
  it('a rejecting port is not caught: the rejection propagates to the caller', async () => {
    const rejecting: Pick<FleetIO, 'readFileMeasured'> = { readFileMeasured: async () => { throw new Error('agent gone'); } };
    await expect(childReclaimGenerationRead(rejecting, '/reg', 'demo-a')).rejects.toThrow('agent gone');
  });

  it('reads `$REG/<id>.generation` and nothing else', async () => {
    const asked: string[] = [];
    const io: Pick<FleetIO, 'readFileMeasured'> = {
      readFileMeasured: async (p) => { asked.push(p); return { ok: true, content: G1 }; },
    };
    expect(await childReclaimGenerationRead(io, '/home/u/.cc-sessions', 'demo-a.b')).toEqual({ kind: 'value', v: G1 });
    expect(asked).toEqual(['/home/u/.cc-sessions/demo-a.b.generation']);
  });

  // THE STATED RESIDUAL (spec §5.5): both adapters follow a link, where ccd's own read refuses one. Pinned as
  // measured, so a change in either direction is a decision rather than a drift.
  it('a link to a valid file reads as that value, and a dangling link reads absent', async () => {
    const d = reg();
    writeFileSync(path.join(d, 'target'), G1);
    symlinkSync(path.join(d, 'target'), at(d));
    expect(await childReclaimGenerationRead(localIO, d, 'demo-a')).toEqual({ kind: 'value', v: G1 });
    const e = reg();
    symlinkSync(path.join(e, 'nowhere'), at(e));
    expect(await childReclaimGenerationRead(localIO, e, 'demo-a')).toEqual({ kind: 'absent' });
  });
});
