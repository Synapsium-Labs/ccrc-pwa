// The lanes' one order and one binding-window decider (T2c, D-6329): `bindingWindow` names the window that binds a lane,
// and (once it lands) `lanesByFree` orders lanes by it, most free first.
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { AccountUsage } from '../../shared/api';
import { bindingWindow, lanesByFree } from '../src/fleet/laneOrder';
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

  it('a never-read lane and an expired sign-in sort last', () => {
    const lanes = [
      lane('lane-a', null, null), lane('lane-b', 90, 10), lane('lane-c', 5, 5, { authDead: true }),
      lane('lane-d', 20, 20), lane('lane-e', null, null, { authDead: true }), lane('lane-f', 0, null),
    ];
    // Read and signed in by use, then the never-read and the expired ones in their own relative order.
    expect(names(lanes)).toEqual(['lane-f', 'lane-d', 'lane-b', 'lane-a', 'lane-c', 'lane-e']);
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
