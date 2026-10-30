// The lanes' words (T2c, D-6329): a window's one reading, the row's name and a lane card's name. The reading and the
// row's name moved from fleet-pieces.test.tsx, their expected words changed in the commit that made them
// windowReading's and lanesRowLabel's; the card's name (laneDoorLabel) and the shared words were added beside them.
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { AccountUsage } from '../../shared/api';
import { parseTs } from './literalWalker';
import { lanesByFree } from '../src/fleet/laneOrder';
import { ALL_ACCOUNTS, laneDoorLabel, lanesRowLabel, NO_READING, windowReading } from '../src/fleet/laneWords';

const nowSec = Math.floor(Date.now() / 1000);
const lane = (wrapper: string, five: number | null, seven: number | null, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

describe('the lanes\' words', () => {
  it('a rolled-over window shows 0% and says it reset and the 0% is inferred', () => {
    expect(windowReading(0, true)).toEqual({ shown: '0%', spoken: '0%, inferred: the window reset' });
    // The rolled-over flag wins over whatever percentage came with it: the server zeroed the window.
    expect(windowReading(37, true)).toEqual({ shown: '0%', spoken: '0%, inferred: the window reset' });
  });

  it('a window never measured reads — and not measured, even when it carries a rolled-over flag', () => {
    expect(windowReading(null, true)).toEqual({ shown: '—', spoken: 'not measured' });
  });

  it('a measured window shows its percentage and speaks the same words; one never measured shows — and says not measured', () => {
    expect(windowReading(80, false)).toEqual({ shown: '80%', spoken: '80%' });
    // A measured zero is still measured.
    expect(windowReading(0, false)).toEqual({ shown: '0%', spoken: '0%' });
    expect(windowReading(null, false)).toEqual({ shown: '—', spoken: 'not measured' });
  });

  it('the row\'s name with no lane read is \'account usage, no reading\'', () => {
    expect(lanesRowLabel([], [])).toBe('account usage, no reading');
    expect(lanesRowLabel([lane('lane-a', null, null)], [])).toBe('account usage, no reading');
  });

  it('the row\'s name names the fullest of every lane, the last in lanesByFree\'s order included, and ends in no \'open accounts\'', () => {
    const lanes = [lane('lane-a', 30, 80), lane('lane-b', 90, null)];
    const label = lanesRowLabel(lanes, []);
    expect(label).toBe('account usage, highest lane-b 90%');
    expect(label).not.toMatch(/open accounts/);
    // Seven lanes: the fullest is the last in lanesByFree's order (most free first), past any first-four cut.
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, i) => lane(`lane-${x}`, 10 + i * 10, null));
    expect(lanesByFree(many).at(-1)?.wrapper).toBe('lane-g');
    expect(lanesRowLabel(many, [])).toBe('account usage, highest lane-g 70%');
    // A lane whose sign-in expired sorts last in lanesByFree's order; it is still a lane given.
    expect(lanesRowLabel([lane('lane-a', 20, null), lane('lane-b', 95, null, { authDead: true })], [])).toBe('account usage, highest lane-b 95%');
  });

  it('both names take the spoken words', () => {
    // The binding window rolled over: the row's name says it reset and the zero is inferred.
    expect(lanesRowLabel([lane('lane-a', 0, null, { fiveRolledOver: true })], [])).toBe(
      'account usage, highest lane-a 0%, inferred: the window reset',
    );
    // The 5h window rolled over but the 7d one binds and was measured.
    expect(lanesRowLabel([lane('lane-a', 0, 40, { fiveRolledOver: true })], [])).toBe('account usage, highest lane-a 40%');
    // A measured zero beside a rolled-over zero is still measured.
    expect(lanesRowLabel([lane('lane-a', 0, 0, { fiveRolledOver: true })], [])).toBe('account usage, highest lane-a 0%');
    // The card's name takes the same spoken words for its window.
    expect(laneDoorLabel(lane('lane-a', 0, null, { fiveRolledOver: true, fiveResetAt: nowSec + 600 }), [], nowSec)).toContain(
      '5h 0%, inferred: the window reset, resets in 10m',
    );
  });

  it('the shared words are named once', () => {
    expect(ALL_ACCOUNTS).toBe('All accounts');
    expect(NO_READING).toBe('no reading');
  });

  it('a card\'s name says its lane, each window\'s reading and its reset, and where it opens', () => {
    const card = lane('lane-a', 40, 0, { fiveResetAt: nowSec + 2 * 3600 + 10 * 60 + 30, sevenResetAt: nowSec + 3 * 86400 + 60, sevenRolledOver: true });
    expect(laneDoorLabel(card, [], nowSec)).toBe(
      'lane-a: 5h 40%, resets in 2h 10m; 7d 0%, inferred: the window reset, resets in 3d — opens lane-a on the Accounts screen',
    );
    // Only a window the lane has is named (a weekly-only lane has no 5h), and a missing reset time is said so.
    expect(laneDoorLabel(lane('lane-b', null, 25), [], nowSec)).toBe('lane-b: 7d 25%, no reset time — opens lane-b on the Accounts screen');
    expect(laneDoorLabel(lane('lane-b', 25, null, { fiveResetAt: nowSec - 5 }), [], nowSec)).toBe('lane-b: 5h 25%, resets now — opens lane-b on the Accounts screen');
  });

  it('a never-read lane\'s name says no reading, never 0%', () => {
    const label = laneDoorLabel(lane('lane-a', null, null), [], nowSec);
    expect(label).toBe('lane-a: no reading — opens lane-a on the Accounts screen');
    expect(label).not.toMatch(/0%/);
  });

  // R48: every window everywhere prints a percentage, and `windowReading` is the one place that says how. A source scan,
  // parsed with TypeScript so a comment that names "reset" is not counted (as control-census.test.ts reads the app).
  it('every reading comes from windowReading', () => {
    for (const file of ['AccountMeterRow.tsx', 'AccountRow.tsx']) {
      const path = join(__dirname, '..', 'src', 'fleet', file);
      const src = parseTs(path);
      let imported = false;
      const resetLiterals: string[] = [];
      const percentTemplates: string[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n)) {
          const bindings = n.importClause?.namedBindings;
          if (bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some((e) => (e.propertyName ?? e.name).text === 'windowReading')) imported = true;
        }
        // The word itself, whole: a class name (`acct-reset`) or a sentence ("resets") is no reading.
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) && n.text.trim().toLowerCase() === 'reset') resetLiterals.push(n.text);
        // `${...}%`: a template whose last span ends the string on a percent sign.
        if (ts.isTemplateExpression(n) && n.templateSpans.at(-1)?.literal.text === '%') percentTemplates.push(n.getText(src));
        ts.forEachChild(n, visit);
      };
      visit(src);
      expect(imported, `${file} imports windowReading`).toBe(true);
      expect(resetLiterals, `${file} holds no "reset" string of its own`).toEqual([]);
      expect(percentTemplates, `${file} holds no percentage template of its own`).toEqual([]);
    }
  });

  // Review 940's A1: the precedence (never measured, then rolled over) is windowReading's alone. A second copy in the
  // Gauge broke once, at e03335345, with swap-sheet red until 327f5bffe. So the Gauge hands windowReading its clamped
  // value, whatever consts that value passes through, and the flag as the second argument, and decides no rollover.
  it('the picker\'s Gauge hands windowReading its clamped value and decides no rollover of its own', () => {
    const src = parseTs(join(__dirname, '..', 'src', 'fleet', 'AccountRow.tsx'));
    let gauge: ts.FunctionDeclaration | undefined;
    ts.forEachChild(src, (n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'Gauge') gauge = n; });
    expect(gauge, 'AccountRow.tsx declares Gauge').toBeDefined();
    const consts = new Map<string, ts.Expression>();
    const calls: ts.CallExpression[] = [];
    const collect = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) consts.set(n.name.text, n.initializer);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'windowReading') calls.push(n);
      ts.forEachChild(n, collect);
    };
    collect(gauge!.body!);
    expect(calls, 'Gauge calls windowReading once').toHaveLength(1);
    // Every identifier the first argument reads, following Gauge's own consts transitively.
    const reached = new Set<string>();
    const reach = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        if (reached.has(n.text)) return;
        reached.add(n.text);
        const init = consts.get(n.text);
        if (init !== undefined) reach(init);
      }
      ts.forEachChild(n, reach);
    };
    const [reading, flag] = calls[0]!.arguments;
    reach(reading!);
    expect([...reached], 'the reading Gauge hands windowReading names no rollover').not.toContain('rolledOver');
    expect(flag!.getText(src), 'the flag is passed through as windowReading\'s second argument').toBe('rolledOver');
  });
});
