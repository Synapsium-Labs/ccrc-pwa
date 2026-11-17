// Overlord W1a, the renewal act (plan `w1a-renewal-act.md` Task 3): the checkpoint the lane assembles (`assembleCheckpoint`, L1,
// its cases written once in `sim/checkpointSets.ts` so the mutation floors run the same ones), the rows that carry a
// coordinator's rulings (measured in `w1a-renewal-act/departures.md`), the store that keeps the checkpoint and the renew calls,
// and the card that reads it back at a renewal only. In-memory `coord.db` fixtures only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { isDigestCorrectionSubject, digestCorrectionSubject } from '../src/coord/digest.js';
import { isTickMailSubject, itemMailSubject, tickMail } from '../src/coord/ledgersMail.js';
import * as checkpoint from '../src/continuity/checkpoint.js';
import { renderCard, snapshotFactsOf } from '../src/continuity/card.js';
import * as cardModule from '../src/continuity/card.js';
import { gatherCardFacts, type CardFactsDeps } from '../src/continuity/cardFacts.js';
import type { Checkpoint, Ruling } from '../src/continuity/checkpoint.js';
import type { ChildMark, ChildReclaimGeneration } from '../../shared/api.js';
import type { GenerationOutcome } from '../../shared/continuity.js';
import { CARD_REGISTRY_UNREAD } from '../src/continuity/card.js';
import { checkpointCases, checkpointRenderCases, rulingOf } from './sim/checkpointSets.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ME = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-checkpoint-'), '.ccrc', 'coord.db')));

describe('assembleCheckpoint (L1)', () => {
  for (const [name, run] of Object.entries(checkpointCases(checkpoint))) it(name, run);
});

describe('the card renders a checkpoint', () => {
  for (const [name, run] of Object.entries(checkpointRenderCases(cardModule))) it(name, run);
});

// ---------------------------------------------------------------------------------------------------- the rulings' rows
describe('rulingRowsOf: the rows that carry a coordinator\'s rulings', () => {
  const mail = (c: CoordStore, over: Partial<{ fromId: string; toId: string; runId: number | null; subject: string; body: string; kind: 'answer' | 'finding' | 'status' }>): void => {
    c.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: ME, runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [], ...over });
  };
  const item = (id: number, title = `title ${id}`) => ({ id, title, program: 'prog-a', kind: 'do' as const });
  const tick = (c: CoordStore, id: number, answer: string | null, to = ME): void => {
    const m = tickMail(item(id), answer);
    if (!m.ok) throw new Error('tick');
    mail(c, { toId: to, kind: 'answer', subject: m.subject, body: m.body });
  };

  it('a tick and a digest correction are rulings, newest first, the body verbatim, each with its source', () => {
    const c = store();
    tick(c, 1, 'merge it, then stop');
    mail(c, { kind: 'finding', subject: digestCorrectionSubject('ask', 7), body: '  Use postgres here.\n  Not sqlite. ' });
    tick(c, 2, null);
    const r = c.rulingRowsOf(ME, 10);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.rulings.map((x) => [x.source, x.subject])).toEqual([
      ['tick', itemMailSubject(item(2))], ['correction', 'Operator correction on ask 7'], ['tick', itemMailSubject(item(1))]]);
    expect(r.rulings[1]!.text).toBe('  Use postgres here.\n  Not sqlite. ');
    expect(r.rulings[2]!.text).toBe(tickMail(item(1), 'merge it, then stop').ok ? (tickMail(item(1), 'merge it, then stop') as { body: string }).body : '');
    expect(r.rulings[2]!.text).toContain("The operator's answer: merge it, then stop");
  });

  it('the cap is applied to rulings, not to mail: operator notices in between do not use it up', () => {
    const c = store();
    tick(c, 1, 'one');
    for (let i = 0; i < 30; i++) mail(c, { kind: 'finding', subject: `stall: run ${i}`, body: 'stall notice' });
    tick(c, 2, 'two');
    const r = c.rulingRowsOf(ME, 2);
    expect(r.ok && r.rulings.map((x) => x.subject)).toEqual([itemMailSubject(item(2)), itemMailSubject(item(1))]);
    const one = c.rulingRowsOf(ME, 1);
    expect(one.ok && one.rulings).toHaveLength(1);
  });

  it('what is not a ruling is not read: another sender, another recipient, mail on a run, a notice of the operator\'s watcher', () => {
    const c = store();
    const run = (c.openRun({ program: 'prog-a', title: 'A', project: 'project-a', wave: 1, waveOf: 1, claimedBy: ME }) as { id: number }).id;
    const t = tickMail(item(5), 'x');
    if (!t.ok) throw new Error('tick');
    mail(c, { fromId: OTHER, subject: t.subject, body: t.body, kind: 'answer' });                         // a session cannot speak as the operator
    mail(c, { toId: OTHER, subject: t.subject, body: t.body, kind: 'answer' });                           // another coordinator's
    mail(c, { runId: run, subject: t.subject, body: t.body, kind: 'answer' });                            // rides a run
    mail(c, { kind: 'finding', subject: 'Operator correction on thing 7', body: 'x' });                  // not a row kind
    mail(c, { kind: 'finding', subject: 'Operator correction on ask 07', body: 'x' });                   // not an id
    mail(c, { kind: 'status', subject: 'stall-check: run 5', body: 'x' });                               // the stall watch
    mail(c, { kind: 'status', subject: 'ask:5', body: 'x' });                                            // the ask nudge
    mail(c, { kind: 'status', subject: 'done: item x: nope', body: 'x' });
    expect(c.rulingRowsOf(ME, 10)).toEqual({ ok: true, rulings: [] });
  });

  it('the two subject predicates agree with their builders', () => {
    expect(isTickMailSubject(itemMailSubject(item(12, '')))).toBe(true);
    expect(isTickMailSubject(itemMailSubject(item(12, 'a\nb')))).toBe(true);
    expect(isTickMailSubject('done: item 0: x')).toBe(false);
    expect(isTickMailSubject('done: items 3: x')).toBe(false);
    for (const k of ['ask', 'approval', 'call'] as const) expect(isDigestCorrectionSubject(digestCorrectionSubject(k, 31))).toBe(true);
    expect(isDigestCorrectionSubject(`${digestCorrectionSubject('ask', 3)} and more`)).toBe(false);
  });

  it('a failed read is ok: false with detail, never an empty list', () => {
    const c = store();
    c.db.exec('ALTER TABLE mail RENAME TO mail_gone');
    const r = c.rulingRowsOf(ME, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/mail read failed/);
  });
});

// ------------------------------------------------------------------------------------------------------- the store
describe('continuity_checkpoints and continuity_renew_calls', () => {
  let reports = 0;
  /** A recorded start and the generation minted from it, ending the identity's live one with `outcome`. */
  const mint = (c: CoordStore, outcome: GenerationOutcome = 'renewed', identity = ME): number => {
    reports += 1;
    const s = c.insertStart({ sessionId: identity, reportId: `r-${reports}`, uuid: 'u', source: 'clear', model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
    if (!s.ok) throw new Error('start');
    const gens = c.liveGenerations();
    if (!gens.ok) throw new Error(gens.detail);
    const prev = gens.rows.find((g) => g.identity === identity) ?? null;
    const m = c.mintGeneration({ identity, sessionId: identity, role: 'coordinator', term: 1, rowIncarnation: null, startId: s.id, startReportedAt: NOW,
      resumed: false, model: null, lane: 'lane-a', host: null, outcome, mono: 1, proc: 'p', now: NOW },
    prev === null ? null : { term: prev.term, n: prev.n, state: prev.state, shadowState: prev.shadowState, walk: prev.walk }, true);
    if (!m.ok) throw new Error(m.kind);
    return m.id;
  };
  const CP: Checkpoint = {
    notes: [{ id: 4, at: NOW - 5, kind: 'thread', key: { kind: 'run', id: 11 }, waitsOn: 'the review', next: 'rule on it' },
      { id: 9, at: NOW - 4, kind: 'caution', key: { kind: 'programme', slug: 'prog-a' }, waitsOn: 'w', next: 'n' }],
    rulings: [rulingOf(2), rulingOf(1, 'correction')],
    handover: { n: 1, dropped: 2, note: { threads: [{ ref: { kind: 'item', id: 3 }, waitsOn: 'w', next: 'n' }], cautions: ['c'], tone: 't' } },
  };

  it('a checkpoint round-trips, and a second put replaces the first', () => {
    const c = store();
    const g1 = mint(c);
    mint(c);
    expect(c.putCheckpoint({ generationId: g1, ...CP, at: NOW })).toEqual({ ok: true });
    const first = c.checkpointBefore(ME, g1 + 1);
    expect(first).toEqual({ ok: true, checkpoint: { generationId: g1, n: 1, outcome: 'renewed', ...CP, at: NOW } });
    expect(c.putCheckpoint({ generationId: g1, notes: [], rulings: [], handover: null, at: NOW + 1 })).toEqual({ ok: true });
    expect(c.checkpointBefore(ME, g1 + 1)).toEqual({ ok: true, checkpoint: { generationId: g1, n: 1, outcome: 'renewed', notes: [], rulings: [], handover: null, at: NOW + 1 } });
  });

  it('checkpointBefore finds the previous generation\'s row by its place in the line, with that generation\'s outcome', () => {
    const c = store();
    const g1 = mint(c);
    const g2 = mint(c, 'crashed');       // ends g1 by a crash
    const g3 = mint(c, 'renewed');       // ends g2 by a renewal
    c.putCheckpoint({ generationId: g1, ...CP, at: NOW });
    c.putCheckpoint({ generationId: g2, ...CP, rulings: [], at: NOW + 1 });
    mint(c, 'renewed', OTHER);
    expect(c.checkpointBefore(ME, g2)).toMatchObject({ ok: true, checkpoint: { generationId: g1, n: 1, outcome: 'crashed' } });
    // A start by the other identity changes nothing.
    expect(c.checkpointBefore(ME, g3)).toMatchObject({ ok: true, checkpoint: { generationId: g2, n: 2, outcome: 'renewed', rulings: [] } });
    // A first generation has no predecessor, and a generation that stored none is null.
    expect(c.checkpointBefore(ME, g1)).toEqual({ ok: true, checkpoint: null });
    expect(c.checkpointBefore(OTHER, 1)).toEqual({ ok: true, checkpoint: null });
    const g4 = mint(c);
    expect(c.checkpointBefore(ME, g4)).toEqual({ ok: true, checkpoint: null });
  });

  it('a failed read is a failure with detail, never null: a row that does not parse, an outcome this build does not know, a table that fails', () => {
    type Break = (db: CoordStore['db'], gen: number) => void;
    const breaks: Record<string, Break> = {
      'a rulings list that is not one': (db, g) => { db.prepare("UPDATE continuity_checkpoints SET rulings = '{}' WHERE generationId = ?").run(g); },
      'a ruling with a source this build does not know': (db, g) => {
        db.prepare("UPDATE continuity_checkpoints SET rulings = '[{\"at\":1,\"source\":\"x\",\"subject\":\"s\",\"text\":\"t\"}]' WHERE generationId = ?").run(g);
      },
      'notes that are not JSON': (db, g) => { db.prepare("UPDATE continuity_checkpoints SET notes = 'nope' WHERE generationId = ?").run(g); },
      'a handover that is not a note': (db, g) => { db.prepare("UPDATE continuity_checkpoints SET handover = '{\"n\":1}' WHERE generationId = ?").run(g); },
      'an outcome from a newer build': (db, g) => { db.prepare("UPDATE continuity_generations SET outcome = 'teleported' WHERE id = ?").run(g); },
      'a dropped table': (db) => { db.exec('DROP TABLE continuity_checkpoints'); },
    };
    const c = store();
    Object.entries(breaks).forEach(([what, breakIt], i) => {
      const identity = `lane-${i}-project-a`;
      const g1 = mint(c, 'renewed', identity);
      c.putCheckpoint({ generationId: g1, ...CP, at: NOW });
      const g2 = mint(c, 'renewed', identity);
      expect(c.checkpointBefore(identity, g2), `${what}: before the break`).toMatchObject({ ok: true });
      breakIt(c.db, g1);
      const r = c.checkpointBefore(identity, g2);
      expect(r.ok, what).toBe(false);
      if (!r.ok) expect(r.detail, what).toMatch(/continuity_checkpoints/);
    });
  });

  it('claimRenewCall: claimed once, not claimed the second time for the same (generation, episode, try); another try, renewal or generation is its own', () => {
    const c = store();
    const k = (generationId: number, episode: number, t: number) => ({ generationId, episode, try: t });
    expect(c.claimRenewCall(k(1, 100, 1), NOW)).toEqual({ ok: true, claimed: true });
    expect(c.claimRenewCall(k(1, 100, 1), NOW + 5)).toEqual({ ok: true, claimed: false });
    expect(c.claimRenewCall(k(1, 100, 2), NOW + 6)).toEqual({ ok: true, claimed: true });
    expect(c.claimRenewCall(k(2, 100, 1), NOW + 7)).toEqual({ ok: true, claimed: true });
    // A generation that went back to active and renews again starts at try 1 again, in its own episode (slug
    // renew-calls-keyed-by-episode).
    expect(c.claimRenewCall(k(1, 900, 1), NOW + 8)).toEqual({ ok: true, claimed: true });
    // The first claim's time stands, and an unanswered call reads answer null; each episode reads its own calls.
    expect(c.renewCallsOf(1, 100)).toEqual({ ok: true, calls: [{ generationId: 1, episode: 100, try: 1, at: NOW, answer: null },
      { generationId: 1, episode: 100, try: 2, at: NOW + 6, answer: null }] });
    expect(c.answerRenewCall(k(1, 900, 1), 'started')).toEqual({ ok: true, recorded: true });
    expect(c.renewCallsOf(1, 900)).toEqual({ ok: true, calls: [{ generationId: 1, episode: 900, try: 1, at: NOW + 8, answer: 'started' }] });
  });

  it('recordSoftRenewal: one row per soft due fed, counted across the identity\'s generations in one term', () => {
    const c = store();
    expect(c.recordSoftRenewal({ id: 1, identity: 'lane-a-project-a', term: 1 }, 10)).toEqual({ ok: true });
    expect(c.recordSoftRenewal({ id: 1, identity: 'lane-a-project-a', term: 1 }, 20)).toEqual({ ok: true });
    expect(c.recordSoftRenewal({ id: 2, identity: 'lane-a-project-a', term: 1 }, 30)).toEqual({ ok: true });
    expect(c.recordSoftRenewal({ id: 3, identity: 'lane-a-project-a', term: 2 }, 40)).toEqual({ ok: true });
    expect(c.softRenewalsOf('lane-a-project-a', 1)).toEqual({ ok: true, observedMs: [10, 20, 30] });
  });

  it('a write that fails is ok: false, kept apart from "already claimed"', () => {
    const c = store();
    c.db.exec('DROP TABLE continuity_renew_calls');
    expect(c.claimRenewCall({ generationId: 1, episode: 100, try: 1 }, NOW)).toEqual({ ok: false });
    expect(c.answerRenewCall({ generationId: 1, episode: 100, try: 1 }, 'started')).toEqual({ ok: false });
    const r = c.renewCallsOf(1, 100);
    expect(r.ok).toBe(false);
  });

  it('answerRenewCall records the word once; a try never claimed has no row to answer', () => {
    const c = store();
    const k = (t: number, episode = 100) => ({ generationId: 3, episode, try: t });
    c.claimRenewCall(k(1), NOW);
    expect(c.answerRenewCall(k(1), 'started')).toEqual({ ok: true, recorded: true });
    expect(c.answerRenewCall(k(1), 'unreachable')).toEqual({ ok: true, recorded: false });
    expect(c.answerRenewCall(k(2), 'started')).toEqual({ ok: true, recorded: false });
    expect(c.answerRenewCall(k(1, 900), 'started')).toEqual({ ok: true, recorded: false });
    expect(c.renewCallsOf(3, 100)).toEqual({ ok: true, calls: [{ generationId: 3, episode: 100, try: 1, at: NOW, answer: 'started' }] });
    expect(c.renewCallsOf(99, 100)).toEqual({ ok: true, calls: [] });
  });
});

// -------------------------------------------------------------------------------------------- the card reads it at a renewal
describe('the card\'s checkpoint fact', () => {
  let reports = 0;
  const mint = (c: CoordStore, outcome: GenerationOutcome): number => {
    reports += 1;
    const s = c.insertStart({ sessionId: ME, reportId: `q-${reports}`, uuid: 'u', source: 'clear', model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
    if (!s.ok) throw new Error('start');
    const gens = c.liveGenerations();
    if (!gens.ok) throw new Error(gens.detail);
    const prev = gens.rows.find((g) => g.identity === ME) ?? null;
    const m = c.mintGeneration({ identity: ME, sessionId: ME, role: 'coordinator', term: 1, rowIncarnation: null, startId: s.id, startReportedAt: NOW,
      resumed: false, model: null, lane: 'lane-a', host: null, outcome, mono: 1, proc: 'p', now: NOW },
    prev === null ? null : { term: prev.term, n: prev.n, state: prev.state, shadowState: prev.shadowState, walk: prev.walk }, true);
    if (!m.ok) throw new Error(m.kind);
    return m.id;
  };
  const deps = (coord: CoordStore): CardFactsDeps => ({
    coord, childMark: async (): Promise<ChildMark | typeof CARD_REGISTRY_UNREAD> => ({ kind: 'none' }),
    incarnation: async (): Promise<ChildReclaimGeneration> => ({ kind: 'value', v: '0b1c2d3e-4f50-4617-8899-aabbccddeeff' }), declaredIntent: () => false,
  });
  const facts = async (c: CoordStore) => (await gatherCardFacts(deps(c), ME, NOW)).facts;
  const rulings: Ruling[] = [rulingOf(2), rulingOf(1, 'correction')];

  it('is read when the generation that ended last ended by a renewal: the notes, the rulings and the handover, from the checkpoint row alone', async () => {
    const c = store();
    const g1 = mint(c, 'renewed');
    mint(c, 'renewed');
    // The notes piece's own handover row is NOT the source: only the checkpoint row is read.
    c.putHandover({ generationId: g1, note: { threads: [], cautions: ['from the notes row'], tone: 'ignored' }, dropped: 0, at: NOW });
    expect((await facts(c)).checkpoint).toEqual({ kind: 'read', value: null });
    c.putCheckpoint({ generationId: g1, notes: [{ id: 4, at: NOW - 5, kind: 'thread', key: { kind: 'run', id: 11 }, waitsOn: 'w', next: 'n' }], rulings,
      handover: { n: 1, dropped: 1, note: { threads: [{ ref: { kind: 'run', id: 4 }, waitsOn: 'w', next: 'n' }], cautions: ['c'], tone: 't' } }, at: NOW - 9 });
    expect((await facts(c)).checkpoint).toEqual({ kind: 'read', value: {
      at: NOW - 9,
      handover: { generation: 1, dropped: 1, threads: [{ ref: 'run 4', waitsOn: 'w', next: 'n' }], cautions: ['c'], tone: 't' },
      notes: [{ id: 4, at: NOW - 5, kind: 'thread', key: 'run 11', waitsOn: 'w', next: 'n' }],
      rulings: rulings.map((r) => ({ at: r.at, source: r.source, subject: r.subject, text: r.text })),
    } });
  });

  it('a hard renewal\'s checkpoint has a null handover on the card, and its rulings still ride', async () => {
    const c = store();
    const g1 = mint(c, 'renewed');
    mint(c, 'renewed');
    c.putCheckpoint({ generationId: g1, notes: [], rulings, handover: null, at: NOW });
    const v = (await facts(c)).checkpoint;
    expect(v.kind === 'read' && v.value?.handover).toBeNull();
    const text = renderCard('coordinator', await facts(c)).map((s) => s.text).join('\n');
    expect(text).toContain('Ruling 1 (tick,');
    expect(text).not.toContain('the handover note of generation');
  });

  it('is null at any other outcome: a crash, a swap, a wake or a clear leaves no checkpoint on the card', async () => {
    const c = store();
    const g1 = mint(c, 'renewed');
    mint(c, 'renewed');
    c.putCheckpoint({ generationId: g1, notes: [], rulings, handover: null, at: NOW });
    expect((await facts(c)).checkpoint).toMatchObject({ kind: 'read', value: { at: NOW } });
    for (const outcome of ['crashed', 'swapped', 'woken', 'woken-elsewhere', 'unmeasured', 'cleared', 'retired'] as const) {
      c.db.prepare('UPDATE continuity_generations SET outcome = ? WHERE id = ?').run(outcome, g1);
      expect((await facts(c)).checkpoint, outcome).toEqual({ kind: 'read', value: null });
    }
  });

  it('a failed read of the checkpoint is unmeasured, never null', async () => {
    const c = store();
    const g1 = mint(c, 'renewed');
    mint(c, 'renewed');
    c.putCheckpoint({ generationId: g1, notes: [], rulings, handover: null, at: NOW });
    c.db.prepare("UPDATE continuity_checkpoints SET rulings = 'nope'").run();
    expect((await facts(c)).checkpoint).toEqual({ kind: 'unmeasured', what: 'the checkpoint' });
  });

  it('a stored snapshot of the older shape, {at, handover} with no notes or rulings, still reads and still renders', async () => {
    const c = store();
    const g1 = mint(c, 'renewed');
    mint(c, 'renewed');
    c.putCheckpoint({ generationId: g1, notes: [], rulings: [], handover: { n: 1, dropped: 0, note: { threads: [], cautions: [], tone: 'calm' } }, at: NOW });
    const f = await facts(c);
    const old = { ...f, checkpoint: { kind: 'read', value: { at: NOW, handover: { generation: 1, dropped: 0, threads: [], cautions: [], tone: 'calm' } } } };
    const back = snapshotFactsOf(JSON.stringify(old), NOW);
    expect(back!.checkpoint).toEqual(old.checkpoint);
    expect(renderCard('coordinator', back!).map((s) => s.text).join('\n')).toContain('tone: calm');
  });
});
