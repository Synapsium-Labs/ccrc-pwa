// program-leverage wave 2 (F2), spec section 4 item 2
// (`docs/superpowers/plans/2026-08-28-program-leverage-wave2-f2.md`).
//
// The floor measurement, lifted out of `FleetWatcher` so an HTTP request can
// run it. ONE reader, TWO policies, and the difference is the whole point:
//
//   The hourly sweep TOLERATES a partial scan. It mints nothing, so a floor it
//   under-measures costs a delay and the next pass raises it.
//
//   A synchronous seed REFUSES one. It mints numbers immediately, from a floor
//   that only ever rises, so a scan that missed the file carrying the highest
//   ref hands out numbers already in use. Reissuing a number once cost 394
//   rewritten D-ref lines across 30 files.
//
// Every `D-` ref below is spelled SPLIT. `deviation-refs.test.ts` runs the real
// `floorFromScan` over the whole tracked tree, so a contiguous fixture ref reds
// it and — because the live floor only ever rises — would poison the fleet's
// own seed permanently.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { localIO } from '../src/io.js';
import type { FleetIO } from '../src/io.js';
import {
  isSafeProjectSegment, measureLedgerFloor, readLedgerDocs,
} from '../src/coord/ledgerseed.js';

const REF = (n: number): string => `D-${n}`;

const fixture = () => {
  const projectsRoot = mkTmp('ccrc-ledgerseed-');
  const plant = (project: string, dir: string, name: string, text: string): void => {
    const d = path.join(projectsRoot, project, 'docs', 'superpowers', dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, name), text);
  };
  return { projectsRoot, plant, deps: { io: localIO, projectsRoot } };
};

describe('measureLedgerFloor — the sweep measurement, standalone and bounded', () => {
  it('measures a floor from plans and specs together', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} something`);
    f.plant('demo', 'specs', 'b.md', `bullet ${REF(240)}`);
    const m = await measureLedgerFloor(f.deps, 'demo');
    expect(m.ok).toBe(true);
    // `floorFromScan` owns the gap arithmetic (LEDGER_SEED_GAP = 50); this
    // module only applies it.
    expect(m.ok && m.scan.floor).toBe(240 + 50);
  });

  it('answers no-refs when the documents are measured and carry no global D-ref', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', 'a plan with nothing numbered in it');
    expect(await measureLedgerFloor(f.deps, 'demo')).toEqual({ ok: false, why: 'no-refs' });
  });

  it('answers no-refs, not unmeasurable, for a project whose docs tree has no plans dir', async () => {
    // A dir the PARENT listing does not name is genuinely absent. That is a
    // measurement, and reporting it as a failure to measure would make the
    // ordinary shape of a young project look like a broken box.
    const f = fixture();
    f.plant('demo', 'specs', 'b.md', 'nothing numbered');
    expect(await measureLedgerFloor(f.deps, 'demo')).toEqual({ ok: false, why: 'no-refs' });
  });

  it('answers unmeasurable when the docs tree itself will not list', async () => {
    const f = fixture();
    expect(await measureLedgerFloor(f.deps, 'no-such-project'))
      .toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('answers unmeasurable when a dir the parent NAMED will not list', async () => {
    // The evidence ladder: `readdir` collapses absent and unreadable (D-114),
    // so the parent's own listing is what tells them apart. Named-then-missing
    // is a failure, not an absence.
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} x`);
    const io: FleetIO = {
      ...localIO,
      readdir: async (p: string) => (p.endsWith(`${path.sep}plans`) ? null : localIO.readdir(p)),
    };
    expect(await measureLedgerFloor({ ...f.deps, io }, 'demo'))
      .toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('answers unmeasurable when ANY listed file could not be read', async () => {
    // THE safety property. Note the fixture: the file that fails to read is the
    // one carrying the HIGHER ref, so a tolerant reader would seed 211+50=261
    // and immediately mint numbers that collide with the 9000-block sitting in
    // the file it skipped. Under-seeding is not "the safe direction" for a
    // caller that mints; it is the failure.
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} x`);
    f.plant('demo', 'plans', 'b.md', `### ${REF(9000)} much higher`);
    const io: FleetIO = {
      ...localIO,
      readFile: async (p: string) => (p.endsWith('b.md') ? null : localIO.readFile(p)),
    };
    expect(await measureLedgerFloor({ ...f.deps, io }, 'demo'))
      .toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('answers unmeasurable when the budget expires mid-walk, and never seeds a partial scan', async () => {
    // A wall-clock budget with an INJECTED clock, so this proves the bound
    // without spending it (`inject/send.ts`'s CLEAR_BUDGET_MS idiom).
    const f = fixture();
    for (const n of ['a', 'b', 'c']) f.plant('demo', 'plans', `${n}.md`, `### ${REF(211)} x`);
    let t = 0;
    const m = await measureLedgerFloor(
      { ...f.deps, budgetMs: 5, now: () => (t += 10) }, 'demo');
    expect(m).toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('refuses a project segment that could walk out of projectsRoot, without touching the fs', async () => {
    // D-1017: this name arrives in an HTTP body and is interpolated into a
    // path. The box token gates the route, but a token is a credential, not a
    // sandbox.
    for (const bad of ['..', '../etc', 'a/b', '.', '', 'a\0b', '-lead']) {
      expect(isSafeProjectSegment(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const good of ['demo', 'ccrc-pwa', 'a.b_c-1']) {
      expect(isSafeProjectSegment(good), good).toBe(true);
    }
    const f = fixture();
    const reads: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readdir: async (p: string) => { reads.push(p); return localIO.readdir(p); },
    };
    expect(await measureLedgerFloor({ ...f.deps, io }, '../..'))
      .toEqual({ ok: false, why: 'unmeasurable' });
    expect(reads, 'an unsafe project name reached the filesystem').toEqual([]);
  });
});

describe('readLedgerDocs — one reader, two policies', () => {
  it('reports completeness separately from content, so two callers can differ', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} x`);
    f.plant('demo', 'plans', 'b.md', 'x');
    const io: FleetIO = {
      ...localIO,
      readFile: async (p: string) => (p.endsWith('b.md') ? null : localIO.readFile(p)),
    };
    const r = await readLedgerDocs({ ...f.deps, io }, 'demo', ['plans']);
    // The watcher takes the files it got; the inline seed refuses. Neither
    // policy lives in here — the field is what lets each caller state its own.
    expect(r.files).toHaveLength(1);
    expect(r.complete).toBe(false);
  });

  it('sorts names so the evidence string is deterministic', async () => {
    // `floorFromScan` breaks a tie with the FIRST file naming the max, and
    // explicitly delegates determinism to its caller's sort.
    const f = fixture();
    f.plant('demo', 'plans', 'z.md', `### ${REF(300)} z`);
    f.plant('demo', 'plans', 'a.md', `### ${REF(300)} a`);
    const r = await readLedgerDocs(f.deps, 'demo', ['plans']);
    expect(r.files.map((x) => x.path)).toEqual([
      'docs/superpowers/plans/a.md', 'docs/superpowers/plans/z.md',
    ]);
  });

  it('ignores files that are not markdown', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} x`);
    f.plant('demo', 'plans', 'notes.txt', `### ${REF(9000)} not a plan`);
    const r = await readLedgerDocs(f.deps, 'demo', ['plans']);
    expect(r.files.map((x) => x.path)).toEqual(['docs/superpowers/plans/a.md']);
    expect(r.complete).toBe(true);
  });
});
