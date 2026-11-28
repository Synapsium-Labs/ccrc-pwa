// The act catalogue whole (Overlord W2, plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` Task A2):
// every column's words, the plan's Table 4 written out as data against the rows, Table 4b, `effectiveClasses`, the real
// rows' rung cells through `rungStep`, and the door table naming only catalogue kinds. The deciders' cases live once in
// `sim/actCatalogueSets.ts`, which the every-run mutation floors run against each mutant.
import { describe, expect, it } from 'vitest';
import * as cat from '../../shared/overlord.js';
import { rungStep } from '../src/coord/overlordLadder.js';
import { OVERLORD_DOORS } from '../src/coord/overlordDoors.js';
import { actRowCases, effectiveClassesCases } from './sim/actCatalogueSets.js';

type R = cat.OverlordActRow;
// Table 4 (and the fourth W1 kind, ruled in call 1816), one line per kind: classes; answer; carrier; may carry;
// reversibility; covers; least strength; compensator; actor; verb class; and the cells at chat, advise, full.
type Line = [R['classes'], boolean, boolean, R['mayCarry'], R['reversibility'], R['covers'], R['leastStrength'],
  R['compensator'], R['actor'], R['verbClass'], string, string, string];
const own = (): Line => [[], false, false, [], 'reversible', [], 'attributed', null, 'overlord', 'operate', 'allow', 'allow', 'allow'];
const route = (): Line => [[], false, false, [], 'reversible', [], 'attributed', null, 'overlord', 'operate', 'refuse', 'allow', 'allow'];
const never = (classes: R['classes'], rev: R['reversibility']): Line =>
  [classes, false, false, [], rev, [], 'operator', null, 'overlord', 'operate', 'refuse', 'refuse', 'refuse'];
const TABLE_4: Readonly<Record<string, Line>> = {
  read: [[], false, false, [], 'n/a', [], 'attributed', null, 'overlord', 'view', 'allow', 'allow', 'allow'],
  'write-note': own(), acknowledge: own(), 'open-request': own(), 'model-write': own(), 'seal-prediction': own(),
  relay: [[], false, false, ['widen-scope'], 'compensable', [], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'allow', 'allow'],
  'drop-request': [[], false, false, [], 'compensable', [], 'attributed', 'new-request', 'overlord', 'operate', 'refuse', 'allow', 'allow'],
  'close-request': route(), 'escalate-request': route(), 'attach-brief': route(), escalate: route(), 'return-over-asked': route(),
  object: route(), 'propose-grant': route(), 'propose-command': route(), 'propose-retire': route(), 'propose-practice': route(),
  'nudge-owner': route(), 'raise-item': route(),
  'answer-item': [[], true, true, 'question-effect', 'compensable', [], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'refuse', 'armed'],
  'answer-ask': [[], true, true, 'question-effect', 'compensable', [], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'refuse', 'armed'],
  'start-programme': [['O3'], false, false, [], 'compensable', ['operator-request', 'command'], 'attributed', 'end-programme', 'overlord', 'operate', 'refuse', 'proposal', 'allow'],
  'rekick-coordinator': [[], false, false, [], 'compensable', [], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'proposal', 'allow'],
  'approve-spec': [['O3'], false, false, [], 'compensable', ['grant', 'command'], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'refuse', 'by-grant'],
  'approve-dod': [['O3'], false, false, [], 'compensable', ['grant', 'command'], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'refuse', 'by-grant'],
  'widen-scope': [['O3'], false, false, [], 'compensable', ['grant', 'command', 'operator-request'], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'refuse', 'by-grant'],
  'state-a-fact': [['O5'], true, false, [], 'compensable', ['stated-entry'], 'attributed', 'correction-mail', 'overlord', 'operate', 'refuse', 'refuse', 'allow'],
  'accept-limit': never(['O3'], 'compensable'),
  'message-people': never(['O1'], 'irreversible'), publish: never(['O1'], 'irreversible'), deploy: never(['O1'], 'compensable'),
  'live-box-act': never(['O1'], 'irreversible'), 'account-management': never(['O1', 'O4'], 'irreversible'),
  spend: never(['O2'], 'irreversible'), 'secret-or-access': never(['O4'], 'irreversible'),
  'reassign-programme': never(['O4'], 'irreversible'), 'override-a-person': never(['O6'], 'irreversible'),
  renew: [[], false, false, [], 'reversible', [], 'attributed', null, 'server', 'operate', 'allow', 'allow', 'allow'],
  'link-team': [[], false, false, [], 'compensable', [], 'attributed', 'operator-relink', 'overlord', 'operate', 'refuse', 'refuse', 'allow'],
};
const lineOf = (r: R): Line => [r.classes, r.answer, r.carrier, r.mayCarry, r.reversibility, r.covers, r.leastStrength,
  r.compensator, r.actor, r.verbClass, r.rungs.chat, r.rungs.advise, r.rungs.full];

describe('the catalogue\'s words', () => {
  it('every list holds exactly its words, in order', () => {
    expect(cat.RUNG_CELL_WORDS).toEqual(['allow', 'refuse', 'proposal', 'armed', 'by-grant']);
    expect(cat.OVERLORD_CLASSES).toEqual(['O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'unknown']);
    expect(cat.REVERSIBILITIES).toEqual(['n/a', 'reversible', 'compensable', 'irreversible']);
    expect(cat.COVER_KINDS).toEqual(['grant', 'command', 'operator-request', 'stated-entry']);
    expect(cat.COMPENSATORS).toEqual(['correction-mail', 'new-request', 'end-programme', 'operator-relink']);
    expect(cat.CEILING_CELL_KINDS).toEqual(['counted', 'held-by', 'never']);
  });
  it('every row\'s columns are words of their lists, and its keys are Table 4a\'s', () => {
    const keys = ['what', 'actor', 'classes', 'answer', 'carrier', 'mayCarry', 'reversibility', 'covers', 'verbClass', 'compensator', 'ceiling', 'leastStrength', 'rungs'];
    for (const k of cat.OVERLORD_ACT_KIND_LIST) {
      const r = cat.OVERLORD_ACT_KINDS[k];
      expect(Object.keys(r).sort(), k).toEqual([...keys].sort());
      expect(r.what.length, k).toBeGreaterThan(0);
      for (const c of r.classes) expect(cat.OVERLORD_CLASSES.filter((w) => w !== 'unknown'), k).toContain(c);
      expect(cat.REVERSIBILITIES, k).toContain(r.reversibility);
      for (const c of r.covers) expect(cat.COVER_KINDS, k).toContain(c);
      if (r.compensator !== null) expect(cat.COMPENSATORS, k).toContain(r.compensator);
      expect(cat.CEILING_CELL_KINDS, k).toContain(r.ceiling.kind);
      if (r.ceiling.kind === 'counted') expect(cat.CEILING_GROUPS, k).toContain(r.ceiling.group);
      expect(Object.keys(r.rungs), k).toEqual(['chat', 'advise', 'full']);
      for (const w of Object.values(r.rungs)) expect(cat.isRungCellWord(w), `${k}: ${w}`).toBe(true);
      if (r.mayCarry !== 'question-effect') for (const e of r.mayCarry) expect(cat.isOverlordActKind(e), `${k} carries ${e}`).toBe(true);
    }
    expect(cat.isRungCellWord('shadow')).toBe(false);
  });
});

describe('the rows are Table 4', () => {
  it('the catalogue is total over Table 4\'s kinds and the fourth W1 kind, and holds no other', () => {
    expect([...cat.OVERLORD_ACT_KIND_LIST].sort()).toEqual(Object.keys(TABLE_4).sort());
  });
  it('each row equals its line of Table 4, escalate-request and the completion rows included', () => {
    for (const [k, line] of Object.entries(TABLE_4)) expect(lineOf(cat.OVERLORD_ACT_KINDS[k as cat.OverlordActKind]), k).toEqual(line);
  });
  it('no row is a timer: a timer is no act kind (§3.3.12)', () => {
    expect(cat.OVERLORD_ACT_KIND_LIST.filter((k) => /timer/.test(k))).toEqual([]);
  });
  it('CLASS_COVERS is Table 4b', () => {
    expect(cat.CLASS_COVERS).toEqual({
      O1: [], O2: [], O3: ['grant', 'command', 'operator-request'], O4: [], O5: ['stated-entry'], O6: [], unknown: [],
    });
  });
  it('each compensator names its door', () => {
    expect(Object.fromEntries(cat.COMPENSATORS.map((c) => [c, cat.compensatorDoor(c)]))).toEqual({
      'correction-mail': 'POST /api/digest/correct', 'new-request': 'POST /api/overlord/requests',
      'end-programme': 'POST /api/sessions/:id/archive', 'operator-relink': 'POST /api/projects/:project/linking',
    });
  });
});

describe('actRow', () => {
  for (const [name, fn] of Object.entries(actRowCases(cat))) it(name, fn);
});
describe('effectiveClasses', () => {
  for (const [name, fn] of Object.entries(effectiveClassesCases(cat))) it(name, fn);
});

describe('the real rows through rungStep', () => {
  const rungs = ['chat', 'advise', 'full'] as const;
  it('each row passes at each rung whose cell is not refuse, naming the cell, and refuses elsewhere', () => {
    for (const k of cat.OVERLORD_ACT_KIND_LIST) for (const r of rungs) {
      const cell = TABLE_4[k]![rungs.indexOf(r) + 10] as string;
      const v = rungStep(r, 'other', k);
      expect(v.pass ? v.cell : 'refuse', `${k} at ${r}`).toBe(cell);
    }
  });
  it('rung-below names the lowest rung whose cell is not refuse, and null for a kind refused at every rung', () => {
    const lowest = (k: string): string | null => rungs.find((r) => TABLE_4[k]![rungs.indexOf(r) + 10] !== 'refuse') ?? null;
    for (const k of cat.OVERLORD_ACT_KIND_LIST) {
      const v = rungStep('off', 'other', k);
      expect(v.pass ? 'pass' : v.needs, k).toBe(lowest(k));
    }
    for (const k of ['accept-limit', 'deploy', 'live-box-act', 'account-management', 'spend'] as const) {
      expect(rungStep('full', 'other', k), k).toEqual({ pass: false, word: 'rung-below', needs: null });
    }
  });
  it('card, probe and note at off are skipped for every kind', () => {
    for (const k of cat.OVERLORD_ACT_KIND_LIST) expect(rungStep('off', 'card-probe-note', k), k).toEqual({ pass: true, cell: 'skipped' });
  });
});

describe('the door table names catalogue kinds', () => {
  const overlordRows = Object.entries(OVERLORD_DOORS).filter(([, r]) => r.group === 'overlord') as [string, { act: string | null }][];
  it('every Overlord door row names a catalogue kind or null, and only the three timer rows are null', () => {
    expect(overlordRows.length).toBeGreaterThan(0);
    for (const [k, r] of overlordRows) if (r.act !== null) expect(cat.isOverlordActKind(r.act), k).toBe(true);
    expect(overlordRows.filter(([, r]) => r.act === null).map(([k]) => k).sort()).toEqual(['timer-cancel', 'timer-list', 'timer-set']);
  });
  it('no door row names renew, the server\'s own act (F15)', () => {
    expect(overlordRows.filter(([, r]) => r.act === 'renew').map(([k]) => k)).toEqual([]);
    expect(cat.OVERLORD_ACT_KINDS.renew.actor).toBe('server');
    for (const k of cat.OVERLORD_ACT_KIND_LIST) if (k !== 'renew') expect(cat.OVERLORD_ACT_KINDS[k].actor, k).toBe('overlord');
  });
});
