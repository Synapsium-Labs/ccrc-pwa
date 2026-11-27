// The ladder's 95% cause row (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 7; Table 7.5a, §6.8; ruled F1, F3): the
// Overlord's accounts past the 95% load line cap the rung at `chat`; an unmeasured line caps by the ladder's rule.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { LOAD_FRESH_S } from '../../shared/loadLines.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { LADDER_CAUSE_MAP } from '../../shared/overlord-ladder.js';
import { parseRoster } from '../../shared/roster.js';
import { loadFactsOf, loadLineReading } from '../src/accountLoad.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { ladderConditionInputs, ladderRead, NO_WITNESS_YET, type LadderConditionInputs } from '../src/coord/overlordLadderRead.js';
import type { AccountFacts } from '../src/coord/overlordDesignation.js';
import type { AccountLimits } from '../src/limits.js';

const otherConditions = {
  'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted',
  'shared-user': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted',
} satisfies Omit<LadderConditionInputs, 'load-past-95'>;
// @ts-expect-error The 95% row cannot ship without its input.
const missing: LadderConditionInputs = otherConditions;
void missing;

const NOW = 2_000_000_000;
const ALL_WORDS = ['overlord-route-v1', 'overlord-answer-v1'];
const roster = parseRoster({ version: 1, accounts: [
  { id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    pool: 'pool-a', fableBilling: 'included', continuity: { recordedAt: 1 } },
  { id: 'lane-b', label: 'lane-b', configDirSuffix: '.lane-b', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic',
    pool: 'pool-a', fableBilling: 'included', continuity: { recordedAt: 1 } },
] });
const lim = (pct: number, ago = 60): AccountLimits => ({
  five: pct, seven: pct, ts: NOW - ago, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false,
});
const designated: DesignationRead = { kind: 'designated', sessionId: 'overlord-a', term: 1,
  row: { model: 'opus', accountPools: { pools: ['pool-a'], untagged: false } } as unknown as DesignationView };
const facts = (a: number, b: number, agoB = 60): AccountFacts => loadFactsOf(roster, { 'lane-a': lim(a), 'lane-b': lim(b, agoB) }, new Map(), NOW, { ok: true, lanes: [] });

function ladderWith(designationRead: () => DesignationRead, facts: () => AccountFacts | null) {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
  db.exec("INSERT INTO overlord_ladder VALUES (1, 'full', 'actor', 1, 7, NULL, 1)");
  const coord = new CoordStore(db);
  const accountFacts = vi.fn(facts);
  const inputs = ladderConditionInputs({ coord: { designationRead } as never, serverCaps: ALL_WORDS, accountFacts });
  const only = { ...otherConditions, 'load-past-95': inputs['load-past-95'] };
  const r = ladderRead(coord, only, NO_WITNESS_YET, ALL_WORDS);
  db.close();
  if (r.kind !== 'measured') throw new Error(r.why);
  return { rung: r.effective.rung, reading: r.conditions.find((c) => c.cause === 'load-past-95')!.reading, binding: r.effective.binding, accountFacts };
}
const ladder = (read: DesignationRead, f: AccountFacts | null) => ladderWith(() => read, () => f);

describe('the 95% row (Table 7.5a)', () => {
  it('is a condition that caps at chat with no push', () => {
    expect(LADDER_CAUSE_MAP['load-past-95']).toMatchObject({ kind: 'condition', effect: { kind: 'cap', cap: 'chat' }, notice: 'none' });
    expect(LADDER_CAUSE_MAP['load-past-95'].spec).toContain('95%');
  });
  it('every candidate fresh at 96%: standing, the rung capped at chat', () => {
    expect(ladder(designated, facts(96, 97))).toMatchObject({ rung: 'chat', reading: 'standing' });
  });
  it.each([98, 99])('every candidate at %i percent, where serviceability refuses opus at the ceiling: still standing (F1)', (pct) => {
    expect(ladder(designated, facts(pct, pct))).toMatchObject({ rung: 'chat', reading: 'standing' });
  });
  it('one candidate fresh under 95: lifted, no cap', () => {
    expect(ladder(designated, facts(96, 94))).toMatchObject({ rung: 'full', reading: 'lifted', binding: [] });
  });
  it('one stale-under candidate and the rest past: unmeasured, capped at chat and listed unmeasured', () => {
    const r = ladder(designated, facts(96, 40, LOAD_FRESH_S + 1));
    expect(r).toMatchObject({ rung: 'chat', reading: 'unmeasured' });
    expect(r.binding).toEqual([expect.objectContaining({ cause: 'load-past-95', reading: 'unmeasured', cap: 'chat' })]);
  });
  it('every account left out for non-load words: unmeasured (no-candidate), capped', () => {
    const f = facts(10, 10);
    const noRecord = { ...f, lanes: Object.fromEntries(Object.entries(f.lanes).map(([k, v]) => [k, { ...v, continuity: 'none' as const }])) };
    expect(ladder(designated, noRecord)).toMatchObject({ rung: 'chat', reading: 'unmeasured' });
  });
  it('nobody designated: lifted; an unreadable designation: unmeasured, capped', () => {
    expect(ladder({ kind: 'not-designated', row: null }, null)).toMatchObject({ rung: 'full', reading: 'lifted' });
    expect(ladder({ kind: 'unmeasured', why: 'x' }, facts(10, 10))).toMatchObject({ rung: 'chat', reading: 'unmeasured' });
  });
  it('no reading this tick (no facts) is unmeasured, never under', () => {
    expect(ladder(designated, null)).toMatchObject({ rung: 'chat', reading: 'unmeasured' });
  });
  it('a facts read that throws, or a designation read that throws, is unmeasured and capped, never lifted (review 3330 F3)', () => {
    expect(ladderWith(() => designated, () => { throw new Error('limits gone'); })).toMatchObject({ rung: 'chat', reading: 'unmeasured' });
    expect(ladderWith(() => { throw new Error('coord gone'); }, () => facts(10, 10))).toMatchObject({ rung: 'chat', reading: 'unmeasured' });
  });
  it('the input reads its facts once per evaluation', () => {
    expect(ladder(designated, facts(96, 97)).accountFacts).toHaveBeenCalledTimes(1);
  });
  it('reads the chat line, not the hard one: a candidate at 90 lifts it', () => {
    expect(ladder(designated, facts(90, 90))).toMatchObject({ rung: 'full', reading: 'lifted' });
  });
  it('loadLineReading never folds an unreadable designation into nobody designated', () => {
    expect(loadLineReading({ kind: 'unmeasured', why: 'x' }, () => [], null, 'chat')).toBe('unmeasured');
    expect(loadLineReading({ kind: 'not-designated', row: null }, () => { throw new Error('not asked'); }, null, 'chat')).toBe('lifted');
  });
});
