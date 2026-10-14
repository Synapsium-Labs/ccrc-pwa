// The current-lane fixture census (delegation broker wave 3, Task 6; mutation W3-M73).
//
// The parser and correlation code of wave 3 (Tasks 9 and 11) may rely only on payload shapes the capture rig measured
// on the Claude Code versions the fleet's live sessions run. Those shapes live in the committed corpus,
// `fixtures/delegation/<version>/<scenario>.json`, and `matrix.json` is what `build-matrix.mjs` derives from it
// (`delegation-rig.test.ts` pins the derivation). This file pins what that corpus must HOLD before any parser reads it:
//
//   - every current-lane version has a corpus directory with a fixture for every scenario of the rig, and a matrix cell
//     for each (W3-M73: omit a current-lane recapture, or any one of its fixtures, and the first row reds);
//   - the matrix's unmeasured cells are exactly the ones a controller ruled on, so a new unmeasured cell, or one that
//     silently becomes measured, reds and forces a ruling instead of passing unseen;
//   - the corpus directories and the matrix's own version list agree.
//
// No row starts Claude Code or probes the box: the lane list below is a COMMITTED measurement, and a new lane is added
// to it by the recapture that measured it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FIX = path.resolve(__dirname, 'fixtures/delegation');
const SCEN = path.resolve(__dirname, 'delegation-rig/scenarios');

/** The Claude Code versions the fleet's live sessions ran, by process executable, when Task 6 measured them
 *  (2026-10-14): 2.1.291 (1 session), 2.1.296 (40), 2.1.299 (15). `rig.sh versions` listed five installed
 *  (2.1.291, 2.1.294, 2.1.295, 2.1.296, 2.1.299); the corpus held 2.1.280 to 2.1.292 before that recapture. */
const CURRENT_LANES = ['2.1.291', '2.1.296', '2.1.299'] as const;

/** Every unmeasured cell of the matrix, with the reason `build-matrix.mjs` recorded, and what was ruled (Task 6, R15):
 *  `interrupt-exit` (spec question 6: exit with a background agent) was captured on 2.1.294 and never reached its third
 *  mock label on 2.1.295, 2.1.296 and 2.1.299 (the parent's turn ended instead of hanging), so those three cells are
 *  UNMEASURED, never absence, and no parser or correlation may rely on that scenario's shape for 2.1.295 and later. The
 *  scenario or mock fix is a follow-up outside this file; when it lands, this list shrinks in the same commit. */
const UNMEASURED: ReadonlyArray<{ cell: string; reason: string }> = [
  { cell: '2.1.295/interrupt-exit', reason: 'waitLabels ["sub-hang","main-hang"]: timeout' },
  { cell: '2.1.296/interrupt-exit', reason: 'waitLabels ["sub-hang","main-hang"]: timeout' },
  { cell: '2.1.299/interrupt-exit', reason: 'waitLabels ["sub-hang","main-hang"]: timeout' },
];

type Cell = { status: string; reason?: string };
type Matrix = { versions: string[]; scenarios: string[]; cells: Record<string, Cell> };

const matrix: Matrix = JSON.parse(fs.readFileSync(path.join(FIX, 'matrix.json'), 'utf8'));
/** The rig's scenarios, read from the directory: a scenario added there is a census row that reds until it is recaptured. */
const scenarios = fs.readdirSync(SCEN).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length)).sort();
const byVersion = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

describe('the current-lane fixture census (W3-M73)', () => {
  it('names at least one lane, each a plain x.y.z version, and the rig has scenarios to cover', () => {
    expect(CURRENT_LANES.length).toBeGreaterThan(0);
    for (const v of CURRENT_LANES) expect(v, v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it.each(CURRENT_LANES)('%s: the corpus has a directory with a fixture for every scenario of the rig, and the matrix a cell for each', (version) => {
    expect(fs.existsSync(path.join(FIX, version)), `${version}/ is in the corpus`).toBe(true);
    for (const s of scenarios) {
      expect(fs.existsSync(path.join(FIX, version, `${s}.json`)), `${version}/${s}.json is in the corpus`).toBe(true);
      expect(matrix.cells[`${version}/${s}`], `matrix cell ${version}/${s}`).toBeDefined();
    }
    expect(matrix.versions, 'matrix.json lists the lane').toContain(version);
  });

  it.each(CURRENT_LANES)('%s: the version directory holds exactly the rig\'s scenarios, no stray file', (version) => {
    expect(fs.existsSync(path.join(FIX, version)), `${version}/ is in the corpus`).toBe(true);
    const files = fs.readdirSync(path.join(FIX, version)).sort();
    expect(files).toEqual(scenarios.map((s) => `${s}.json`).sort());
  });

  it('the matrix\'s unmeasured cells are exactly the ruled list, with their reasons (a new one, or a silently fixed one, needs a ruling)', () => {
    const unmeasured = Object.entries(matrix.cells)
      .filter(([, c]) => c.status !== 'measured')
      .map(([cell, c]) => ({ cell, reason: c.reason }))
      .sort((a, b) => byVersion(a.cell, b.cell));
    expect(unmeasured).toEqual([...UNMEASURED]);
    // anti-vacuity: the ruled cells are real cells of this matrix, and none of them is a measured one
    for (const u of UNMEASURED) expect(matrix.cells[u.cell]?.status, u.cell).toBe('unmeasured');
  });

  it('every ruled-unmeasured cell still has its fixture file: unmeasured is a recorded outcome, never a missing capture', () => {
    for (const u of UNMEASURED) {
      const [version, scenario] = u.cell.split('/') as [string, string];
      expect(fs.existsSync(path.join(FIX, version, `${scenario}.json`)), u.cell).toBe(true);
    }
  });

  it('the corpus directories on disk are exactly the matrix\'s version list, in numeric order, and every lane is among them', () => {
    const onDisk = fs.readdirSync(FIX, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(byVersion);
    expect(matrix.versions).toEqual(onDisk);
    expect([...matrix.versions].sort(byVersion)).toEqual(matrix.versions);
    for (const v of CURRENT_LANES) expect(onDisk, v).toContain(v);
    expect(matrix.scenarios).toEqual(scenarios);
  });
});
