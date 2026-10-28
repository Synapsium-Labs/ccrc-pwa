// The lanes' one order and one binding-window decider (T2c, D-6329): `bindingWindow` names the window that binds a lane,
// and (once it lands) `lanesByFree` orders lanes by it, most free first.
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { AccountUsage } from '../../shared/api';
import { bindingWindow, lanesByFree } from '../src/fleet/laneOrder';
import * as order from '../src/fleet/laneOrder';
import { parseTs } from './literalWalker';

const lane = (wrapper: string, five: number | null, seven: number | null, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five, seven, ts: 1, fiveResetAt: 1000, sevenResetAt: 2000, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false, ...over,
});

describe('bindingWindow', () => {
  it('is the fuller window, 7d on a tie, the one measured window alone, null with neither', () => {
    expect(bindingWindow(lane('lane-a', 80, 20))).toEqual({ label: '5h', pct: 80, resetAt: 1000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 20, 80))).toEqual({ label: '7d', pct: 80, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 50, 50))).toEqual({ label: '7d', pct: 50, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', null, 30))).toEqual({ label: '7d', pct: 30, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 30, null))).toEqual({ label: '5h', pct: 30, resetAt: 1000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', null, null))).toBeNull();
  });

  it('a tie reads rolled over only when every window at it rolled over', () => {
    expect(bindingWindow(lane('lane-a', 0, 0, { sevenRolledOver: true }))).toEqual({ label: '7d', pct: 0, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 0, 0, { fiveRolledOver: true }))).toEqual({ label: '7d', pct: 0, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 0, 0, { fiveRolledOver: true, sevenRolledOver: true }))).toEqual({ label: '7d', pct: 0, resetAt: 2000, rolledOver: true });
    // Off a tie only the binding window counts: the other one's flag is not the lane's.
    expect(bindingWindow(lane('lane-a', 0, 40, { fiveRolledOver: true }))).toEqual({ label: '7d', pct: 40, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 0, 40, { sevenRolledOver: true }))).toEqual({ label: '7d', pct: 40, resetAt: 2000, rolledOver: true });
    expect(bindingWindow(lane('lane-a', null, 0, { sevenRolledOver: true }))?.rolledOver).toBe(true);
  });
});

describe('lanesByFree', () => {
  const names = (lanes: readonly AccountUsage[]): string[] => lanesByFree(lanes).map((l) => l.wrapper);

  it('lanes sort by binding use, lowest first, ties in roster order', () => {
    // c and d tie on everything but the name (binding use, its reset, the other window's use): only then the roster decides.
    // b binds at 35, off the tie, so the reset cannot reorder it past c and d.
    const lanes = [lane('lane-a', 70, 10), lane('lane-b', 5, 35), lane('lane-c', 40, 20), lane('lane-d', 40, 20), lane('lane-e', 0, 0)];
    expect(names(lanes)).toEqual(['lane-e', 'lane-b', 'lane-c', 'lane-d', 'lane-a']);
    // Ties (c, d at 40) keep the input order whichever way it runs.
    expect(names([lanes[3]!, lanes[2]!])).toEqual(['lane-d', 'lane-c']);
    // The input is not reordered in place.
    expect(lanes.map((l) => l.wrapper)).toEqual(['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-e']);
  });

  it("lanes that tie on binding use sort by the binding window's reset, soonest first", () => {
    // All bind at 30 on the 5h window; the resets differ, and a past reset (a rolled-over window) is just the smallest.
    const lanes = [
      lane('lane-a', 30, 10, { fiveResetAt: 5000 }), lane('lane-b', 30, 10, { fiveResetAt: 3000 }),
      lane('lane-c', 30, 10, { fiveResetAt: 4000 }), lane('lane-d', 30, 10, { fiveResetAt: 1 }),
      lane('lane-e', 20, 10, { fiveResetAt: 9000 }), lane('lane-f', 31, 10, { fiveResetAt: 1 }),
    ];
    // Binding use is still the first key: e (20) before the 30s, f (31) after them.
    expect(names(lanes)).toEqual(['lane-e', 'lane-d', 'lane-b', 'lane-c', 'lane-a', 'lane-f']);
  });

  it('a tie with no reset time sorts after one with a reset time', () => {
    const lanes = [
      lane('lane-a', 30, 10, { fiveResetAt: null }), lane('lane-b', 30, 10, { fiveResetAt: 900000 }),
      lane('lane-c', 30, 10, { fiveResetAt: null }),
    ];
    // b has the latest reset yet still precedes both lanes without one, which keep roster order between them.
    expect(names(lanes)).toEqual(['lane-b', 'lane-a', 'lane-c']);
  });

  it("a tie on use and reset sorts by the other window's use, lowest first", () => {
    // All bind at 30 on 5h with the same reset; the 7d window is the other one. A null other window is unmeasured:
    // it goes after every measured one.
    const lanes = [
      lane('lane-a', 30, 20), lane('lane-b', 30, 5), lane('lane-c', 30, null), lane('lane-d', 30, 5), lane('lane-e', 30, 12),
    ];
    expect(names(lanes)).toEqual(['lane-b', 'lane-d', 'lane-e', 'lane-a', 'lane-c']);
    // When 7d binds, the other window is the 5h one.
    const sevens = [lane('lane-a', 25, 60), lane('lane-b', 3, 60), lane('lane-c', null, 60), lane('lane-d', 14, 60)];
    expect(names(sevens)).toEqual(['lane-b', 'lane-d', 'lane-a', 'lane-c']);
  });

  it("the reset outranks the other window's use, and the other window's use outranks the roster", () => {
    // Both bind at 30 on 5h. lane-b is later in the roster, resets sooner and has the HIGHER other-window use: the
    // reset decides, so b leads.
    const byReset = [lane('lane-a', 30, 5, { fiveResetAt: 9000 }), lane('lane-b', 30, 25, { fiveResetAt: 3000 })];
    expect(names(byReset)).toEqual(['lane-b', 'lane-a']);
    // Same reset: the later-roster lane with the LOWER other-window use leads.
    const byOther = [lane('lane-a', 30, 25), lane('lane-b', 30, 5)];
    expect(names(byOther)).toEqual(['lane-b', 'lane-a']);
  });

  it('only then in roster order', () => {
    const lanes = [lane('lane-a', 30, 10), lane('lane-b', 30, 10), lane('lane-c', 30, 10)];
    expect(names(lanes)).toEqual(['lane-a', 'lane-b', 'lane-c']);
    expect(names([lanes[2]!, lanes[0]!, lanes[1]!])).toEqual(['lane-c', 'lane-a', 'lane-b']);
  });

  it('the tie-break reads the reset through bindingWindow', () => {
    // 50/50 ties on use, and bindingWindow picks the 7d window on a tie, so the 7d reset decides: b (500) before a
    // (9000), though a's 5h reset (100) is the soonest of the four resets.
    const lanes = [
      lane('lane-a', 50, 50, { fiveResetAt: 100, sevenResetAt: 9000 }), lane('lane-b', 50, 50, { fiveResetAt: 9999, sevenResetAt: 500 }),
    ];
    expect(names(lanes)).toEqual(['lane-b', 'lane-a']);
  });

  it('never-read and expired lanes still go last, in roster order, whatever their resets', () => {
    const lanes = [
      lane('lane-a', null, null, { fiveResetAt: 3, sevenResetAt: 3 }), lane('lane-b', 30, 10, { fiveResetAt: 8000 }),
      lane('lane-c', 5, 5, { authDead: true, fiveResetAt: 2, sevenResetAt: 2 }), lane('lane-d', 30, 10, { fiveResetAt: 7000 }),
      lane('lane-e', null, null, { authDead: true, fiveResetAt: 1, sevenResetAt: 1 }),
    ];
    // The last group's resets (a 3, c 2, e 1) descend in roster order, so sorting it by reset would show.
    expect(names(lanes)).toEqual(['lane-d', 'lane-b', 'lane-a', 'lane-c', 'lane-e']);
  });

  it('a never-read lane and an expired sign-in sort last', () => {
    const lanes = [
      lane('lane-a', null, null), lane('lane-b', 90, 10), lane('lane-c', 5, 5, { authDead: true }),
      lane('lane-d', 20, 20), lane('lane-e', null, null, { authDead: true }), lane('lane-f', 0, null),
    ];
    // Read and signed in by use, then the never-read and the expired ones in their own relative order.
    expect(names(lanes)).toEqual(['lane-f', 'lane-d', 'lane-b', 'lane-a', 'lane-c', 'lane-e']);
  });
});

describe('near-full lanes band by reset (near-full-lanes-band-by-reset)', () => {
  const names = (lanes: readonly AccountUsage[]): string[] => lanesByFree(lanes).map((l) => l.wrapper);

  it('NEAR_FULL_PCT is 95', () => {
    expect((order as Record<string, unknown>).NEAR_FULL_PCT).toBe(95);
  });

  it('below the band use still orders: 94 before 96 even when 96 resets sooner', () => {
    const lanes = [lane('lane-a', 96, 10, { fiveResetAt: 100 }), lane('lane-b', 94, 10, { fiveResetAt: 9000 })];
    expect(names(lanes)).toEqual(['lane-b', 'lane-a']);
    // Two lanes below 95 are not banded with each other either: 93 before 94 whatever their resets.
    expect(names([lane('lane-a', 94, 10, { fiveResetAt: 100 }), lane('lane-b', 93, 10, { fiveResetAt: 9000 })])).toEqual(['lane-b', 'lane-a']);
  });

  it('95, 97 and 100 read as one band, ordered by the binding reset, soonest first, whatever their use', () => {
    const lanes = [
      lane('lane-a', 95, 10, { fiveResetAt: 9000 }), lane('lane-b', 97, 10, { fiveResetAt: 3000 }),
      lane('lane-c', 100, 10, { fiveResetAt: 6000 }), lane('lane-d', 96, 10, { fiveResetAt: 1000 }),
    ];
    expect(names(lanes)).toEqual(['lane-d', 'lane-b', 'lane-c', 'lane-a']);
  });

  it('a rate-limited lane sits in the band, ordered by its reset among the 95+ lanes', () => {
    const lanes = [
      lane('lane-a', 96, 10, { fiveResetAt: 5000 }), lane('lane-five', 100, 20, { fiveResetAt: 2000 }), lane('lane-b', 98, 10, { fiveResetAt: 8000 }),
    ];
    expect(names(lanes)).toEqual(['lane-five', 'lane-a', 'lane-b']);
  });

  it('a band lane with no reset time goes after band lanes with one', () => {
    const lanes = [
      lane('lane-a', 99, 10, { fiveResetAt: null }), lane('lane-b', 95, 10, { fiveResetAt: 900000 }), lane('lane-c', 97, 10, { fiveResetAt: null }),
    ];
    expect(names(lanes)).toEqual(['lane-b', 'lane-a', 'lane-c']);
  });

  it('within the band a tie on reset goes by the other window, then the roster', () => {
    const lanes = [
      lane('lane-a', 97, 60, { fiveResetAt: 4000 }), lane('lane-b', 99, 30, { fiveResetAt: 4000 }), lane('lane-c', 96, 30, { fiveResetAt: 4000 }),
    ];
    expect(names(lanes)).toEqual(['lane-b', 'lane-c', 'lane-a']);
  });

  it('never-read and expired lanes still go last, after the band', () => {
    const lanes = [
      lane('lane-a', null, null), lane('lane-b', 99, 10, { fiveResetAt: 5000 }), lane('lane-c', 5, 5, { authDead: true }),
      lane('lane-d', 100, 10, { fiveResetAt: 1000 }), lane('lane-e', 98, 98, { authDead: true, fiveResetAt: 1, sevenResetAt: 1 }),
    ];
    expect(names(lanes)).toEqual(['lane-d', 'lane-b', 'lane-a', 'lane-c', 'lane-e']);
  });

  it('the band sorts after every lane below 95', () => {
    const lanes = [
      lane('lane-a', 100, 10, { fiveResetAt: 1 }), lane('lane-b', 95, 10, { fiveResetAt: 2 }), lane('lane-c', 94, 10, { fiveResetAt: 9000 }),
      lane('lane-d', 0, 0, { fiveResetAt: 9000 }), lane('lane-e', 60, 10, { fiveResetAt: 9000 }),
    ];
    expect(names(lanes)).toEqual(['lane-d', 'lane-e', 'lane-c', 'lane-a', 'lane-b']);
  });
});

describe('one bindingWindow', () => {
  const SRC = path.join(import.meta.dirname, '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir).sort().flatMap((e) => {
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) && !p.endsWith('.d.ts') ? [p] : [];
  });
  const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/');

  /** Every declaration of the name: a function, a variable, a class, or a parameter-free binding of it. */
  function declarations(file: string): number {
    let n = 0;
    const visit = (node: ts.Node): void => {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === 'bindingWindow') n += 1;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'bindingWindow') n += 1;
      ts.forEachChild(node, visit);
    };
    visit(parseTs(file));
    return n;
  }

  it('bindingWindow is defined once, in fleet/laneOrder.ts, and LaneSection imports it', () => {
    const all = files(SRC);
    expect(all.length).toBeGreaterThan(100); // the walk is not vacuously empty
    const declared = all.filter((f) => declarations(f) > 0).map((f) => `${rel(f)} x${declarations(f)}`);
    expect(declared).toEqual(['fleet/laneOrder.ts x1']);

    const lane = parseTs(path.join(SRC, 'inspector', 'LaneSection.tsx'));
    const imported = lane.statements.some((st) => ts.isImportDeclaration(st)
      && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === '../fleet/laneOrder'
      && st.importClause?.namedBindings !== undefined && ts.isNamedImports(st.importClause.namedBindings)
      && st.importClause.namedBindings.elements.some((el) => el.name.text === 'bindingWindow' && el.propertyName === undefined));
    expect(imported).toBe(true);
  });
});
