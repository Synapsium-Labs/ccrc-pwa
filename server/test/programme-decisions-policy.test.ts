// Programme lifecycle W3 (spec 2026-11-24 §13, R9; D-8990): the backfill door's L1 decisions, entry by entry. Pure: no store,
// no clock, no registry. Neutral slugs only (prog-a).
import { describe, expect, it } from 'vitest';
import {
  conflictGroups, decisionsAnswer, entryPlan, entryRow, parseDecisions, repeatedSlugs, type DecisionEntry, type DecisionFacts,
} from '../src/coord/programmeDecisionsPolicy.js';
import { PROGRAMME_DECISION_TARGETS, PROGRAMME_DECISIONS_MAX, PROGRAMME_LIFECYCLES } from '../../shared/programmeLifecycle.js';
import { ITEM_TEXT_MAX } from '../../shared/ledgers.js';

const idle: DecisionFacts = { slug: 'prog-a', title: 'A', state: 'active', placeholder: null, coordinator: null, coordinatorUuid: null,
  open: 0, dispatched: true, conflict: null, planEnd: null };
const entry = (to: DecisionEntry['to'], why: string | null = 'operator decided'): DecisionEntry => ({ slug: 'prog-a', to, why });
const q = { repeated: false, reserved: false };
const plan = (to: DecisionEntry['to'], f: Partial<DecisionFacts> = {}) => entryPlan(entry(to), { ...idle, ...f }, q);
const row = (to: DecisionEntry['to'], f: Partial<DecisionFacts> = {}, applied = false) => {
  const facts = { ...idle, ...f };
  return entryRow(entry(to), entryPlan(entry(to), facts, q), facts, applied);
};

describe('parseDecisions: the file is a list of {slug, to, why}, read whole or not at all', () => {
  it('reads every target, and never `unknown`', () => {
    expect([...PROGRAMME_DECISION_TARGETS].sort()).toEqual(['abandoned', 'active', 'done', 'idle', 'open', 'paused']);
    const all = parseDecisions(PROGRAMME_DECISION_TARGETS.map((to) => ({ slug: `prog-${to}`, to, why: ' w ' })));
    expect(all).toEqual({ ok: true, entries: PROGRAMME_DECISION_TARGETS.map((to) => ({ slug: `prog-${to}`, to, why: 'w' })) });
    expect(parseDecisions([{ slug: 'prog-a', to: 'unknown', why: 'w' }])).toMatchObject({ ok: false, detail: expect.stringContaining('entry 1') });
  });
  it('refuses the file on a shape fault, naming the entry', () => {
    for (const raw of [undefined, {}, [], 'x', Array.from({ length: PROGRAMME_DECISIONS_MAX + 1 }, () => ({ slug: 'a', to: 'done', why: 'w' }))]) {
      expect(parseDecisions(raw)).toMatchObject({ ok: false });
    }
    expect(parseDecisions([{ slug: 'prog-a', to: 'done', why: 'w' }, { to: 'done', why: 'w' }])).toMatchObject({ ok: false, detail: expect.stringContaining('entry 2') });
    expect(parseDecisions([null])).toMatchObject({ ok: false, detail: expect.stringContaining('entry 1') });
  });
  it('a missing, blank or over-long why is the entry\'s refusal, not the file\'s', () => {
    for (const why of [undefined, '  ', 7, 'x'.repeat(ITEM_TEXT_MAX + 1)]) {
      expect(parseDecisions([{ slug: 'prog-a', to: 'done', why }])).toEqual({ ok: true, entries: [{ slug: 'prog-a', to: 'done', why: null }] });
    }
  });
});

describe('entryPlan: each refusal, writing nothing', () => {
  it('every entry of a repeated slug is refused, whichever target it names', () => {
    const es = [entry('done'), { ...entry('idle'), slug: 'prog-b' }, entry('idle')];
    expect([...repeatedSlugs(es)]).toEqual(['prog-a']);
    expect(entryPlan(es[0]!, idle, { repeated: true, reserved: false })).toMatchObject({ kind: 'refused', code: 'duplicate-entry' });
  });
  it('the reserved row, an unknown slug, a placeholder (whatever its own state) and a missing why', () => {
    expect(entryPlan(entry('done'), null, { repeated: false, reserved: true })).toMatchObject({ code: 'reserved-programme' });
    expect(entryPlan(entry('done'), null, q)).toMatchObject({ code: 'unknown-programme' });
    for (const placeholder of ['unfiled', 'filed', 'withdrawn']) expect(plan('active', { placeholder })).toMatchObject({ code: 'programme-provisional' });
    expect(entryPlan(entry('active', null), idle, q)).toMatchObject({ kind: 'refused', code: 'why-required' });
  });
  it('done and abandoned over open runs are refused from every stored state: the file never abandons a run', () => {
    for (const to of ['done', 'abandoned'] as const) {
      for (const [state, planEnd] of [['active', null], ['paused', null], ['unknown', null], ['weird', null], ['done', null], ['abandoned', 'abandoned']] as const) {
        expect(plan(to, { state, planEnd, open: 2 }), `${state} to ${to}`)
          .toEqual({ kind: 'refused', code: 'programme-runs-open', detail: '2 open runs: the file never abandons a run' });
      }
    }
  });
  it('a recorded end is never overturned by another end or a pause: a reopen comes first', () => {
    expect(plan('abandoned', { state: 'done', planEnd: 'done' })).toMatchObject({ code: 'programme-ended' });
    expect(plan('paused', { state: 'done', planEnd: 'done' })).toMatchObject({ code: 'programme-ended' });
    expect(plan('paused', { state: 'done', planEnd: null })).toMatchObject({ code: 'programme-ended' });
  });
});

describe('entryPlan: what each decision writes', () => {
  it('equal targets write nothing, so a second run writes nothing', () => {
    for (const to of ['active', 'idle', 'open'] as const) expect(plan(to)).toEqual({ kind: 'none' });
    expect(plan('paused', { state: 'paused' })).toEqual({ kind: 'none' });
    for (const s of ['done', 'abandoned'] as const) expect(plan(s, { state: s, planEnd: s })).toEqual({ kind: 'none' });
  });
  it('active, idle and open are one decision: resume, reopen or repair to stored active', () => {
    for (const to of ['active', 'idle', 'open'] as const) {
      expect(plan(to, { state: 'paused' })).toMatchObject({ to: 'active', event: 'resume', why: 'operator decided', detail: { decided: to } });
      expect(plan(to, { state: 'done' })).toMatchObject({ to: 'active', event: 'reopened' });
      expect(plan(to, { state: 'abandoned', planEnd: 'abandoned' })).toMatchObject({ to: 'active', event: 'reopened' });
      expect(plan(to, { state: 'unknown' })).toMatchObject({ to: 'active', event: 'repaired', detail: { decided: to, unreadable: 'unknown' } });
    }
  });
  it('paused is the pause, or a repair', () => {
    expect(plan('paused', { open: 3 })).toMatchObject({ to: 'paused', event: 'pause' });
    expect(plan('paused', { state: 'retired-by-hand' })).toMatchObject({ to: 'paused', event: 'repaired', detail: { unreadable: 'retired-by-hand' } });
  });
  it('done and abandoned end a live programme, repair an unreadable one, and record an end the migration kept, as either outcome', () => {
    for (const to of ['done', 'abandoned'] as const) {
      expect(plan(to)).toMatchObject({ to, event: 'ended' });
      expect(plan(to, { state: 'paused' })).toMatchObject({ to, event: 'ended' });
      expect(plan(to, { state: 'unknown' })).toMatchObject({ to, event: 'repaired' });
      expect(plan(to, { state: 'done', planEnd: null })).toMatchObject({ to, event: 'ended' });
      expect(plan(to, { state: 'abandoned', planEnd: null })).toMatchObject({ to, event: 'ended' });
    }
  });
});

describe('entryRow: the runs decide what shows; a mismatch is reported and never forced', () => {
  it('unchanged, would-apply and applied', () => {
    expect(row('idle')).toMatchObject({ outcome: 'unchanged', stored: 'active', shown: 'idle', edge: null });
    expect(row('paused')).toMatchObject({ outcome: 'would-apply', stored: 'active', shown: 'paused', edge: 'pause' });
    expect(row('paused', {}, true)).toMatchObject({ outcome: 'applied', edge: 'pause' });
  });
  it('a mismatch, with and without a decision to write', () => {
    expect(row('idle', { open: 1 })).toMatchObject({ outcome: 'mismatch', shown: 'active', openRuns: 1, edge: null });
    expect(row('active')).toMatchObject({ outcome: 'mismatch', shown: 'idle', edge: null });
    expect(row('open', { open: 1 })).toMatchObject({ outcome: 'mismatch', shown: 'active' });
    expect(row('idle', { state: 'done', dispatched: false })).toMatchObject({ outcome: 'mismatch', shown: 'open', edge: 'reopened' });
    expect(row('idle', { state: 'paused', open: 1 }, true)).toMatchObject({ outcome: 'mismatch', shown: 'active', edge: 'resume' });
  });
  it('a refused entry shows its programme as it stands, and one that names no programme shows nothing', () => {
    expect(row('done', { open: 1 })).toMatchObject({ outcome: 'refused:programme-runs-open', stored: 'active', shown: 'active', edge: null });
    expect(entryRow(entry('done'), entryPlan(entry('done'), null, q), null, true))
      .toMatchObject({ outcome: 'refused:unknown-programme', stored: null, shown: null, openRuns: null });
    expect(row('done', { placeholder: 'unfiled' })).toMatchObject({ outcome: 'refused:programme-provisional', shown: null });
  });
});

describe('decisionsAnswer: the listed counts, and everything the file does not name apart from them', () => {
  const f = (slug: string, over: Partial<DecisionFacts> = {}): DecisionFacts => ({ ...idle, slug, ...over });
  it('every real programme is in exactly one of listed and unlisted; a placeholder is in neither', () => {
    const after = [f('prog-a'), f('prog-b', { state: 'paused' }), f('prog-c', { open: 1 }), f('p-one', { placeholder: 'unfiled' }), f('p-two', { placeholder: 'filed' })];
    const entries = ['prog-a', 'prog-a', 'prog-b', 'p-one', 'prog-none'].map((slug) => {
      const facts = after.find((x) => x.slug === slug) ?? null;
      const e = { slug, to: 'idle' as const, why: 'w' };
      return entryRow(e, entryPlan(e, facts, { repeated: slug === 'prog-a', reserved: false }), facts, false);
    });
    const a = decisionsAnswer({ apply: false, entries, after, reservedRow: true });
    expect(a).toMatchObject({ ok: true, apply: false, listed: 2, placeholders: 1, reservedRow: true, unlisted: [{ slug: 'prog-c', shown: 'active' }] });
    // prog-a, named twice, is counted once as it stands; prog-b as the decision would leave it.
    expect(a.counts).toEqual({ ...Object.fromEntries(PROGRAMME_LIFECYCLES.map((l) => [l, 0])), idle: 2 });
  });
  it('groups the conflicts by the one session, or by the one programme', () => {
    expect(conflictGroups([
      f('prog-a', { open: 1, conflict: { kind: 'session-in-several', claimants: ['lane-a'] } }),
      f('prog-b', { open: 3, conflict: { kind: 'session-in-several', claimants: ['lane-a'] } }),
      f('prog-c', { open: 2, conflict: { kind: 'programme-several-claimants', claimants: ['lane-b', 'lane-c'] } }),
      f('prog-d'),
    ])).toEqual([
      { kind: 'session-in-several', session: 'lane-a', programmes: [{ slug: 'prog-a', openRuns: 1 }, { slug: 'prog-b', openRuns: 3 }] },
      { kind: 'programme-several-claimants', slug: 'prog-c', claimants: ['lane-b', 'lane-c'], openRuns: 2 },
    ]);
  });
});
