// The ladder's vocabulary and deciders (Overlord W1 ladder, plan `w1-ladder.md` Task 1). L0 words are checked here; the
// deciders' cases live in `sim/ladderSets.ts`, written once for this file and for the every-run mutation floors, and
// this file runs them against the real module.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, ts } from './scan/parse.js';
import * as m from '../src/coord/overlordLadder.js';
import * as L0 from '../../shared/overlord-ladder.js';
import {
  effectiveRungCases, highestHeldRungCases, narrowingStateCases, offStepCases, rungMoveVerdictCases, rungStepCases,
  rungWordReadingCases, degradedReadingCases,
} from './sim/ladderSets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('the rung words', () => {
  it('every rung word round-trips through isRung, and the ranks order them off < chat < advise < full', () => {
    expect(L0.RUNGS).toEqual(['off', 'chat', 'advise', 'full']);
    for (const r of L0.RUNGS) expect(L0.isRung(r)).toBe(true);
    expect(L0.RUNGS.map(L0.rungRank)).toEqual([0, 1, 2, 3]);
    for (const bad of ['', 'Off', 'chatty', 'constructor', 'toString', '__proto__', null, undefined, 1, {}]) expect(L0.isRung(bad)).toBe(false);
  });
  it('each rung\'s needs word: none for off and chat, the W2 and W3 words above', () => {
    expect(L0.RUNGS.map(L0.rungNeeds)).toEqual([null, null, 'overlord-route-v1', 'overlord-answer-v1']);
  });
  it('the default rung is chat', () => { expect(L0.LADDER_DEFAULT_RUNG).toBe('chat'); });
});

describe('every exported union has its runtime list', () => {
  it('the lists hold exactly the members', () => {
    expect(L0.LADDER_CAUSES).toEqual(['generation-degraded', 'off-model', 'rung-word-missing', 'unwitnessed-third']);
    expect(L0.LADDER_READERS).toEqual(['launch-profile-unmet']);
    expect(L0.LADDER_NOTICES).toEqual(['none', 'push', 'item']);
    expect(L0.LADDER_ACT_KINDS).toEqual(['read', 'write-note', 'acknowledge', 'link-team']);
    expect(L0.CONDITION_READINGS).toEqual(['standing', 'lifted', 'unmeasured']);
    expect(L0.NARROWING_WHYS).toEqual(['no-witness-yet', 'witness-unmeasured', 'not-journalled']);
    expect(L0.LADDER_EFFECT_KINDS).toEqual(['cap', 'one-under-operator', 'read-by', 'server-words']);
    expect(L0.NARROWING_STATES).toEqual(['done', 'taking-effect']);
  });
  it('the L1 file exports no type or interface the wire carries (it declares no wire type of its own)', () => {
    const parsed = parseFile(path.join(ROOT, 'server/src/coord/overlordLadder.ts'));
    const source = ts.createSourceFile(parsed.path, parsed.text, ts.ScriptTarget.Latest, true);
    const exported = source.statements.filter((s) => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s))
      && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((s) => (s as ts.InterfaceDeclaration | ts.TypeAliasDeclaration).name.text);
    expect(exported.sort()).toEqual(['CurrentRung', 'DoorClass', 'EffectiveRung', 'LadderFacts', 'LadderWriterRefusal', 'RungMove']);
    const wireRefs: string[] = [];
    const visit = (node: ts.Node): void => { if (ts.isIdentifier(node) && node.text === 'LadderWire') wireRefs.push(node.text); node.forEachChild(visit); };
    visit(source);
    expect(wireRefs).toEqual([]);
  });
  it('the L1 file imports only from shared/', () => {
    const specs = parseFile(path.join(ROOT, 'server/src/coord/overlordLadder.ts')).imports.map((edge) => edge.specifier);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(s).toMatch(/^\.\.\/\.\.\/\.\.\/shared\/[\w-]+\.js$/);
  });
  it('the L0 file imports nothing', () => {
    const src = readFileSync(path.join(ROOT, 'shared/overlord-ladder.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\bfrom\s+['"]/);
  });
});

describe('ladder kebab census', () => {
  it('admits the vocabulary owners and refuses unrecognised words', () => {
    for (const word of [...L0.LADDER_EFFECT_KINDS, ...L0.NARROWING_STATES, ...L0.NARROWING_WHYS,
      ...L0.LADDER_CAUSES, ...L0.LADDER_READERS, ...L0.LADDER_ACT_KINDS,
      'rung-unreadable', 'card-probe-note', 'not-yet', 'row-changed']) expect(m.isLadderKebab(word)).toBe(true);
    for (const word of ['read-bye', 'server-word', 'rung-unknown', 'row-change', 'some-other-word', '']) {
      expect(m.isLadderKebab(word)).toBe(false);
    }
  });
});

describe('the cause table', () => {
  it('its keys match the cause key shape, and its rows are the two W1 conditions', () => {
    for (const k of L0.LADDER_CAUSES) { expect(k).toMatch(L0.LADDER_CAUSE_KEY_RE); expect(L0.isLadderCauseKey(k)).toBe(true); }
    expect(L0.LADDER_CAUSE_MAP['generation-degraded']).toMatchObject({ kind: 'condition', effect: { kind: 'cap', cap: 'chat' }, notice: 'none' });
    expect(L0.LADDER_CAUSE_MAP['rung-word-missing']).toMatchObject({ kind: 'condition', effect: { kind: 'server-words' }, notice: 'none' });
    expect(L0.LADDER_CAUSE_MAP['rung-word-missing'].spec).toContain('RV8');
  });
  it('the cause key shape is the authority journal\'s: kebab words, at most 64 bytes', () => {
    expect(L0.LADDER_CAUSE_MAX).toBe(64);
    expect(L0.LADDER_CAUSE_KEY_RE.source).toBe('^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$');
    for (const ok of ['a', 'latch-a', 'condition-a', 'a1-b2-c3', 'restore-detected', 'a'.repeat(64)]) expect(L0.isLadderCauseKey(ok)).toBe(true);
    for (const bad of ['', 'A', '1a', '-a', 'a-', 'a--b', 'a_b', 'a b', 'a.b', 'é', 'a'.repeat(65), null, undefined, 3, {}]) expect(L0.isLadderCauseKey(bad)).toBe(false);
  });
  it('every reader word, notice and effect shape a row carries is a member of its list', () => {
    for (const k of L0.LADDER_CAUSES) {
      const r: L0.LadderCauseRow = L0.LADDER_CAUSE_MAP[k];
      expect(L0.LADDER_NOTICES).toContain(r.notice);
      if (r.effect.kind === 'read-by') expect(L0.LADDER_READERS).toContain(r.effect.reader);
      if (r.effect.kind === 'cap') expect(L0.isRung(r.effect.cap)).toBe(true);
    }
  });
});

describe('the rung cells', () => {
  it('W1\'s act kinds each have a cell at chat, advise and full, and off has none', () => {
    for (const act of L0.LADDER_ACT_KINDS) expect(Object.keys(L0.RUNG_CELLS[act])).toEqual(['chat', 'advise', 'full']);
    for (const act of ['read', 'write-note', 'acknowledge'] as const) {
      for (const c of Object.values(L0.RUNG_CELLS[act])) expect(c).toBe('allow');
    }
  });
  it('D-8809: the Overlord\'s team link is allowed at full only', () => {
    expect(L0.RUNG_CELLS['link-team']).toEqual({ chat: 'refuse', advise: 'refuse', full: 'allow' });
  });
});

describe('effectiveRung', () => {
  for (const [name, fn] of Object.entries(effectiveRungCases(m))) it(name, fn);
});
describe('highestHeldRung', () => {
  for (const [name, fn] of Object.entries(highestHeldRungCases(m))) it(name, fn);
});
describe('rungWordReading', () => {
  for (const [name, fn] of Object.entries(rungWordReadingCases(m))) it(name, fn);
});
describe('rungMoveVerdict', () => {
  for (const [name, fn] of Object.entries(rungMoveVerdictCases(m))) it(name, fn);
});
describe('offStep', () => {
  for (const [name, fn] of Object.entries(offStepCases(m))) it(name, fn);
});
describe('rungStep', () => {
  for (const [name, fn] of Object.entries(rungStepCases(m))) it(name, fn);
});
describe('degradedReading', () => {
  for (const [name, fn] of Object.entries(degradedReadingCases(m))) it(name, fn);
});
describe('narrowingState', () => {
  for (const [name, fn] of Object.entries(narrowingStateCases(m))) it(name, fn);
});
