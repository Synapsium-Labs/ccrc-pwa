// Programme lifecycle W1, tasks 4, 5, 7, 8 and 9: the one writer (`programmeLifecycleStore.ts`), the D-51 removal, the open
// rungs, the binding through `reclaimProgram`, and the boot re-measure. Neutral names only.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as lifecycle from '../src/coord/programmeLifecycleStore.js';
import { readCoordinatorOfRun } from '../src/coord/bindingReads.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-lifecycle-store-'), '.ccrc', 'coord.db')));
const OP = { kind: 'operator' as const, id: 'operator' };
const open = (s: CoordStore, program: string, claimedBy: string, wave = 1, claimedByUuid: string | null = null) =>
  s.openRun({ program, title: `wave ${wave}`, project: 'project-a', wave, waveOf: null, claimedBy, claimedByUuid });
const idOf = (r: ReturnType<typeof open>): number => { if (!('id' in r)) throw new Error(JSON.stringify(r)); return r.id; };
const events = (s: CoordStore, slug: string) =>
  s.db.prepare('SELECT edge, fromState, toState, actorKind, actor, why, session, detail FROM programme_events WHERE program = ? ORDER BY id')
    .all(slug) as { edge: string; fromState: string | null; toState: string | null; actorKind: string; actor: string; why: string;
      session: string | null; detail: string | null }[];
const row = (s: CoordStore, slug: string) => s.programmeLifecycleRow(slug)!;

describe('decideInTx: the one writer of the decision', () => {
  it('an end writes the record equal to the state, releases the binding and names it in the ended event; an equal target writes nothing', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    s.db.prepare("UPDATE runs SET state = 'failed'").run();
    const r = s.decideProgramme({ slug: 'programme-a', to: 'done', edge: 'ended', actor: OP, why: 'objective met' }, 50);
    expect(r).toMatchObject({ ok: true, changed: true, from: 'active', released: 'lane-a-one' });
    expect(row(s, 'programme-a')).toMatchObject({ state: 'done', planEnd: 'done', coordinator: null });
    const ended = events(s, 'programme-a').at(-1)!;
    expect(ended).toMatchObject({ edge: 'ended', fromState: 'active', toState: 'done', actorKind: 'operator', why: 'objective met' });
    expect(JSON.parse(ended.detail!)).toMatchObject({ released: 'lane-a-one' });
    const before = events(s, 'programme-a').length;
    expect(s.decideProgramme({ slug: 'programme-a', to: 'done', edge: 'ended', actor: OP, why: 'again' }, 60)).toMatchObject({ changed: false });
    expect(events(s, 'programme-a')).toHaveLength(before);
  });

  it('a reopen clears the record; the reopened programme has no coordinator', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    s.decideProgramme({ slug: 'programme-a', to: 'abandoned', edge: 'ended', actor: OP, why: 'dropped' }, 50);
    s.decideProgramme({ slug: 'programme-a', to: 'active', edge: 'reopened', actor: OP, why: 'back on' }, 60);
    expect(row(s, 'programme-a')).toMatchObject({ state: 'active', planEnd: null, coordinator: null });
    expect(s.db.prepare("SELECT planEndWhy, planEndAt FROM programs WHERE slug = 'programme-a'").get()).toEqual({ planEndWhy: null, planEndAt: null });
  });

  it('a repair records the unreadable value it replaces', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    s.db.prepare("UPDATE programs SET state = 'archived'").run();
    s.decideProgramme({ slug: 'programme-a', to: 'paused', edge: 'repaired', actor: OP, why: 'read again' }, 70);
    expect(events(s, 'programme-a').at(-1)).toMatchObject({ edge: 'repaired', fromState: 'archived', toState: 'paused' });
  });

  it('mintInTx admits an initial paused programme for the system only', () => {
    const s = store();
    expect(() => tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'programme-a', title: 'A', state: 'paused', actor: OP, why: 'x' }, 1)))
      .toThrow(/only the system/);
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'programme-a', title: 'A', state: 'paused', actor: { kind: 'system', id: 'map' }, why: 'backlog' }, 1));
    expect(row(s, 'programme-a').state).toBe('paused');
  });
});

describe('bindCoordinatorInTx: one incarnation owns one live real programme (R11)', () => {
  it('refuses owns-another-programme, naming it; and the partial unique index refuses it with the check gone', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one', 1, 'u-1'));
    idOf(open(s, 'programme-b', 'lane-a-two'));
    const r = tx(s.db, () => lifecycle.bindCoordinatorInTx(s.db, 'programme-b', { session: 'lane-a-one', uuid: 'u-1' }, OP, 'x', 1));
    expect(r).toEqual({ ok: false, kind: 'owns-another-programme', by: 'programme-a' });
    expect(() => s.db.prepare("UPDATE programs SET coordinator = 'lane-a-one', coordinatorUuid = 'u-1' WHERE slug = 'programme-b'").run())
      .toThrow(/UNIQUE/);
  });

  it('the index refuses two null-uuid bindings of one session id (the IFNULL)', () => {
    const s = store();
    tx(s.db, () => {
      lifecycle.mintInTx(s.db, { slug: 'programme-a', title: 'A', state: 'active', actor: OP, why: 'x' }, 1);
      lifecycle.mintInTx(s.db, { slug: 'programme-b', title: 'B', state: 'active', actor: OP, why: 'x' }, 1);
    });
    s.db.prepare("UPDATE programs SET coordinator = 'lane-a-one' WHERE slug = 'programme-a'").run();
    expect(() => s.db.prepare("UPDATE programs SET coordinator = 'lane-a-one' WHERE slug = 'programme-b'").run()).toThrow(/UNIQUE/);
  });

  it('a session moving from its unfiled placeholder to a real programme clears the placeholder\'s binding first', () => {
    const s = store();
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'p-1', title: 'p-1', state: 'active', placeholder: 'unfiled', actor: OP, why: 'spawn',
      coordinator: { session: 'lane-a-one', uuid: 'u-1' } }, 1));
    // The first run of a new programme files the placeholder into it and binds the session there.
    idOf(open(s, 'programme-a', 'lane-a-one', 1, 'u-1'));
    expect(row(s, 'p-1')).toMatchObject({ placeholder: 'filed', filedInto: 'programme-a', coordinator: null });
    expect(row(s, 'programme-a')).toMatchObject({ coordinator: 'lane-a-one', coordinatorUuid: 'u-1' });
    expect(events(s, 'programme-a').map((e) => e.edge)).toEqual(['started', 'filed', 'coordinator']);
  });
});

describe('closeRun: D-51 deleted (task 5)', () => {
  it('closing the last run leaves stored active, which shows Idle; a failed last run shows Idle too', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(s.advance(a, 'dispatched', 'coordinator').ok).toBe(true);
    expect(s.closeRun({ runId: a, finalState: 'failed', causedBy: 'coordinator', handoffCommit: null, program: 'programme-a', viaClosing: true }))
      .toMatchObject({ ok: true });
    expect(row(s, 'programme-a').state).toBe('active');
    expect(lifecycle.runFactsOf(s.db, 'programme-a')).toEqual({ open: 0, dispatched: true });
    expect(s.claimsProgramme('lane-a-one', 'programme-a', null)).toBe(true);   // an Idle programme's coordinator still owns it
  });
});

describe('openRun: the ownership rungs (task 7)', () => {
  it('refuses paused, unknown and provisional programmes, and an ended one plan-closed', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    for (const [state, code] of [['paused', 'programme-paused'], ['archived', 'programme-unknown'], ['done', 'plan-closed']] as const) {
      s.db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run(state, 'programme-a');
      expect(open(s, 'programme-a', 'lane-a-one', 2)).toMatchObject({ refused: code });
    }
    s.db.prepare("UPDATE programs SET state = 'active', placeholder = 'unfiled' WHERE slug = 'programme-a'").run();
    expect(open(s, 'programme-a', 'lane-a-one', 2)).toMatchObject({ refused: 'programme-provisional' });
  });

  it('another binding refuses claimed-by-another naming it; no binding refuses not-your-programme; a run never binds', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(open(s, 'programme-a', 'lane-a-two', 2)).toEqual({ refused: 'claimed-by-another', by: 'lane-a-one' });
    s.db.prepare("UPDATE programs SET coordinator = NULL WHERE slug = 'programme-a'").run();
    expect(open(s, 'programme-a', 'lane-a-two', 2)).toMatchObject({ refused: 'not-your-programme' });
    expect(row(s, 'programme-a').coordinator).toBeNull();
  });

  it('a reused session id with a new uuid owns nothing', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one', 1, 'u-1'));
    expect(open(s, 'programme-a', 'lane-a-one', 2, 'u-2')).toEqual({ refused: 'claimed-by-another', by: 'lane-a-one' });
    expect(s.claimsProgramme('lane-a-one', 'programme-a', 'u-2')).toBe(false);
  });

  it('a coordinator owning A is refused a new slug owns-another-programme, and a free programme B not-your-programme', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(open(s, 'programme-new', 'lane-a-one')).toEqual({ refused: 'owns-another-programme', by: 'programme-a' });
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'programme-b', title: 'B', state: 'active', actor: OP, why: 'x' }, 1));
    expect(open(s, 'programme-b', 'lane-a-one')).toMatchObject({ refused: 'not-your-programme' });
  });

  it('a conflict\'s party (open runs in A and B, owning neither) opening a new slug is refused owns-another-programme', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-two'));
    const b = idOf(open(s, 'programme-b', 'lane-a-three'));
    s.db.prepare("UPDATE runs SET claimedBy = 'lane-a-one' WHERE id = ?").run(b);
    s.db.prepare("UPDATE programs SET coordinator = NULL WHERE slug = 'programme-b'").run();
    expect(open(s, 'programme-new', 'lane-a-one')).toEqual({ refused: 'owns-another-programme', by: 'programme-b' });
  });

  it('a coordinator whose programme ended is refused a new slug not-your-programme (it has been joined)', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    s.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(a);
    s.decideProgramme({ slug: 'programme-a', to: 'done', edge: 'ended', actor: OP, why: 'met' }, 1);
    expect(open(s, 'programme-new', 'lane-a-one')).toMatchObject({ refused: 'not-your-programme' });
  });
});

describe('reclaimProgram: the binding moves with the claims (task 8)', () => {
  it('a hand-over moves every claimed run and the binding, and writes a coordinator event', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a')).toMatchObject({ ok: true });
    expect(row(s, 'programme-a').coordinator).toBe('lane-a-two');
    expect(events(s, 'programme-a').at(-1)).toMatchObject({ edge: 'coordinator', session: 'lane-a-two' });
    expect(s.claimsProgramme('lane-a-one', 'programme-a', null)).toBe(false);
  });

  it('an heir that owns another live programme is refused and nothing moves', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    idOf(open(s, 'programme-b', 'lane-a-two'));
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a')).toEqual({ ok: false, kind: 'owns-another-programme', by: 'programme-b' });
    expect(row(s, 'programme-a').coordinator).toBe('lane-a-one');
    expect((s.db.prepare('SELECT claimedBy FROM runs WHERE id = ?').get(a) as { claimedBy: string }).claimedBy).toBe('lane-a-one');
  });

  // Programme lifecycle W3: R11 rule 4's one exception (spec §13). Without it a session-in-several conflict's party is refused
  // each of its programmes because of the other, so the operator could never give it the one it keeps.
  it('a conflict\'s party is given a programme whose runs it holds by the hand-over door alone, and only while it owns none', () => {
    const s = store();
    for (const p of ['programme-a', 'programme-b', 'programme-c']) {
      s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, 'active')").run(p, p);
    }
    const run = (p: string, by: string): void => {
      s.db.prepare("INSERT INTO runs (program, wave, project, state, claimedBy, openedAt, kind) VALUES (?, 1, 'project-a', 'working', ?, 1, 'work')").run(p, by);
    };
    run('programme-a', 'lane-a-one'); run('programme-b', 'lane-a-one'); run('programme-c', 'lane-a-two');
    const give = (p: string, to: string, party: boolean) => s.reclaimProgramme(p, null, to, 10, 'project-a', { ...(party ? { party } : {}) });
    // Every other caller keeps the rule: the reclaim, archive and stop doors.
    expect(give('programme-a', 'lane-a-one', false)).toEqual({ ok: false, kind: 'owns-another-programme', by: 'programme-b' });
    // Holding runs somewhere else is no claim on this one.
    expect(give('programme-a', 'lane-a-two', true)).toEqual({ ok: false, kind: 'owns-another-programme', by: 'programme-c' });
    expect(give('programme-a', 'lane-a-one', true)).toMatchObject({ ok: true });
    expect(row(s, 'programme-a').coordinator).toBe('lane-a-one');
    // It owns one now, so the other goes to somebody else; its runs there stay its own until it does.
    expect(give('programme-b', 'lane-a-one', true)).toEqual({ ok: false, kind: 'owns-another-programme', by: 'programme-a' });
    expect(row(s, 'programme-b').coordinator).toBeNull();
    expect(give('programme-b', 'lane-a-three', true)).toMatchObject({ ok: true });
  });

  it('a release clears the binding; the next coordinator\'s open is refused until a hand-over binds it', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(s.reclaimProgram(a, null, 10, null)).toMatchObject({ ok: true });
    expect(row(s, 'programme-a').coordinator).toBeNull();
    expect(open(s, 'programme-a', 'lane-a-two', 2)).toMatchObject({ refused: 'not-your-programme' });
  });
});

describe('the boot re-measure (task 9)', () => {
  it('a done written with no event over an open run becomes active; one with no open run is kept and recorded; a second boot writes nothing', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    const b = idOf(open(s, 'programme-b', 'lane-a-two'));
    s.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(b);
    s.db.prepare("UPDATE programs SET state = 'done'").run();   // an older build's D-51, no event
    const first = s.remeasureProgrammesAtBoot(100);
    expect(row(s, 'programme-a').state).toBe('active');
    expect(row(s, 'programme-b')).toMatchObject({ state: 'done', coordinator: null });
    expect(first.states).toBe(2);
    const n = (s.db.prepare('SELECT count(*) AS c FROM programme_events').get() as { c: number }).c;
    expect(s.remeasureProgrammesAtBoot(200)).toEqual({ started: 0, states: 0, released: 0, bound: 0 });
    expect((s.db.prepare('SELECT count(*) AS c FROM programme_events').get() as { c: number }).c).toBe(n);
  });

  it('rows with no started event get one; a second programme one session claims under an older build is left unbound', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    const b = idOf(open(s, 'programme-b', 'lane-a-two'));
    s.db.prepare("UPDATE runs SET claimedBy = 'lane-a-one' WHERE id = ?").run(b);   // an older build's openRun
    s.db.prepare("UPDATE programs SET coordinator = NULL WHERE slug = 'programme-b'").run();
    s.db.prepare("DELETE FROM programme_events WHERE program = 'programme-b'").run();
    const r = s.remeasureProgrammesAtBoot(100);
    expect(r.started).toBe(1);
    expect(row(s, 'programme-b').coordinator).toBeNull();
  });
});

// ── W1 review: the tests the plan names that the first cut left out, and the review's fixes ─────────────────────────────

describe('openRun: the rungs the review found untested (task 7, S6)', () => {
  it('a coordinator whose programme was handed over is refused a new slug not-your-programme: it is given one, never takes one', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a')).toMatchObject({ ok: true });
    expect(open(s, 'programme-new', 'lane-a-one')).toMatchObject({ refused: 'not-your-programme' });
    expect(s.programmeLifecycleRow('programme-new')).toBeNull();
  });

  it('a programme whose coordinator exited is not taken by a run: its binding stands until a hand-over (R7, rule 8)', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    // lane-a-one has exited: the store keeps its binding (the registry lane's `coordinator-gone` is W4's), so a run from
    // another session is refused naming it, never admitted as a takeover.
    expect(open(s, 'programme-a', 'lane-a-two', 2)).toEqual({ refused: 'claimed-by-another', by: 'lane-a-one' });
    expect(row(s, 'programme-a').coordinator).toBe('lane-a-one');
  });

  it('a Linear backlog programme (minted paused by the map) refuses its first wave programme-paused', () => {
    const s = store();
    // `applyPlanChangesInTx`'s backlog arm, as the Linear map's `declareMapStructure` reaches it: minted paused by the system.
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'programme-b', title: 'B', homeProject: 'project-a', state: 'paused', planRequired: 1,
      actor: { kind: 'system', id: 'linear-map' }, why: 'backlog' }, 1));
    expect(row(s, 'programme-b')).toMatchObject({ state: 'paused', coordinator: null });
    expect(open(s, 'programme-b', 'lane-a-one')).toMatchObject({ refused: 'programme-paused' });
    expect(s.db.prepare("SELECT count(*) AS c FROM runs WHERE program = 'programme-b'").get()).toEqual({ c: 0 });
  });

  it('a recycled slug cannot be ended and opened again: the ended row refuses plan-closed and nothing is minted over it', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(a);
    s.decideProgramme({ slug: 'programme-a', to: 'done', edge: 'ended', actor: OP, why: 'met' }, 5);
    const started = events(s, 'programme-a').filter((e) => e.edge === 'started').length;
    expect(open(s, 'programme-a', 'lane-a-two', 2)).toEqual({ refused: 'plan-closed' });
    expect(row(s, 'programme-a')).toMatchObject({ state: 'done', coordinator: null });
    expect(events(s, 'programme-a').filter((e) => e.edge === 'started')).toHaveLength(started);
  });
});

describe('the binding: what the review found missing (task 8, S2, S3, S8, C4)', () => {
  it('after a hand-over the run-keyed coordinator (mail, the close check, the stall notices) is the heir, finished runs too', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    const b = idOf(open(s, 'programme-a', 'lane-a-one', 2));
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(a);
    expect(s.reclaimProgram(b, 'lane-a-two', 10, 'project-a', { toUuid: 'u-2' })).toMatchObject({ ok: true });
    expect([readCoordinatorOfRun(s, a), readCoordinatorOfRun(s, b)]).toEqual([{ ok: true, id: 'lane-a-two' }, { ok: true, id: 'lane-a-two' }]);
    expect(s.claimsProgramme('lane-a-one', 'programme-a', null)).toBe(false);
  });

  it('a hand-over binds the heir\'s measured uuid and records the caller\'s actor and why; a reused id with another uuid owns nothing', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one', 1, 'u-1'));
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a',
      { toUuid: 'u-2', actor: { kind: 'system', id: 'unmeasured' }, why: 'reclaimed through the reclaim door from lane-a-one' })).toMatchObject({ ok: true });
    expect(row(s, 'programme-a')).toMatchObject({ coordinator: 'lane-a-two', coordinatorUuid: 'u-2' });
    expect(events(s, 'programme-a').at(-1)).toMatchObject({ edge: 'coordinator', actorKind: 'system', actor: 'unmeasured',
      why: 'reclaimed through the reclaim door from lane-a-one', session: 'lane-a-two' });
    expect(s.claimsProgramme('lane-a-two', 'programme-a', 'u-2')).toBe(true);
    expect(s.claimsProgramme('lane-a-two', 'programme-a', 'u-3')).toBe(false);
  });

  it('re-naming the current coordinator (the identity path) never changes its incarnation', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one', 1, 'u-1'));
    expect(s.reclaimProgram(a, 'lane-a-one', 10, 'project-a', { toUuid: 'u-new' })).toMatchObject({ ok: true });
    expect(row(s, 'programme-a')).toMatchObject({ coordinator: 'lane-a-one', coordinatorUuid: 'u-1' });
  });

  it('a programme with no claimed run moves its binding alone (reclaimProgramme)', () => {
    const s = store();
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'programme-a', title: 'A', state: 'active', actor: OP, why: 'plan put',
      coordinator: { session: 'lane-a-one', uuid: 'u-1' } }, 1));
    expect(s.reclaimProgramme('programme-a', 'lane-a-one', 'lane-a-two', 10, 'project-a', { toUuid: 'u-2' }))
      .toMatchObject({ ok: true, runIds: [], from: 'lane-a-one' });
    expect(row(s, 'programme-a')).toMatchObject({ coordinator: 'lane-a-two', coordinatorUuid: 'u-2' });
    // a caller that is no longer the bound coordinator moves nothing
    expect(s.reclaimProgramme('programme-a', 'lane-a-one', null, 11, null)).toEqual({ ok: false, kind: 'no-claimant' });
    expect(s.reclaimProgramme('programme-z', 'lane-a-one', null, 11, null)).toEqual({ ok: false, kind: 'unknown-programme' });
  });

  it('a reclaim of an ended programme\'s run moves its claims but never binds anybody to it (R11 rule 1, C4)', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    // an end over an open run, as the migration's plan-end rule can leave one
    s.db.prepare("UPDATE programs SET state = 'done', planEnd = 'done', coordinator = NULL WHERE slug = 'programme-a'").run();
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a', { toUuid: 'u-2' })).toMatchObject({ ok: true });
    expect(row(s, 'programme-a').coordinator).toBeNull();
    expect(readCoordinatorOfRun(s, a)).toEqual({ ok: true, id: 'lane-a-two' });
    expect(s.claimsProgramme('lane-a-two', 'programme-a', 'u-2')).toBe(false);
    expect(tx(s.db, () => lifecycle.bindCoordinatorInTx(s.db, 'programme-a', { session: 'lane-a-two', uuid: 'u-2' }, OP, 'x', 1)))
      .toEqual({ ok: false, kind: 'programme-ended', by: 'programme-a' });
  });

  it('a withdrawn placeholder\'s session can then be handed a programme (its binding was cleared with the withdrawal)', () => {
    const s = store();
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'p-1', title: 'p-1', state: 'active', placeholder: 'unfiled', actor: OP, why: 'spawn',
      coordinator: { session: 'lane-a-two', uuid: 'u-2' } }, 1));
    expect(tx(s.db, () => lifecycle.fileInTx(s.db, 'p-1', { kind: 'withdrawn' }, OP, 'not a programme', 2))).toBe(true);
    expect(row(s, 'p-1')).toMatchObject({ placeholder: 'withdrawn', coordinator: null });
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a', { toUuid: 'u-2' })).toMatchObject({ ok: true });
    expect(row(s, 'programme-a').coordinator).toBe('lane-a-two');
  });

  it('an heir\'s unfiled placeholder is withdrawn when it is given a programme', () => {
    const s = store();
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'p-1', title: 'p-1', state: 'active', placeholder: 'unfiled', actor: OP, why: 'spawn',
      coordinator: { session: 'lane-a-two', uuid: 'u-2' } }, 1));
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a', { toUuid: 'u-2' })).toMatchObject({ ok: true });
    expect(row(s, 'p-1')).toMatchObject({ placeholder: 'withdrawn', coordinator: null });
    expect(row(s, 'programme-a')).toMatchObject({ coordinator: 'lane-a-two', coordinatorUuid: 'u-2' });
  });
});

describe('decideInTx: the first recorded end stands (A6)', () => {
  it('a recorded end refuses a different end and writes nothing; a reopen still moves it', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(a);
    s.decideProgramme({ slug: 'programme-a', to: 'done', edge: 'ended', actor: OP, why: 'met' }, 5);
    const n = events(s, 'programme-a').length;
    expect(s.decideProgramme({ slug: 'programme-a', to: 'abandoned', edge: 'ended', actor: OP, why: 'second' }, 6))
      .toEqual({ ok: false, kind: 'already-ended', state: 'done' });
    expect(row(s, 'programme-a')).toMatchObject({ state: 'done', planEnd: 'done' });
    expect(events(s, 'programme-a')).toHaveLength(n);
    expect(s.decideProgramme({ slug: 'programme-a', to: 'active', edge: 'reopened', actor: OP, why: 'back' }, 7)).toMatchObject({ ok: true, changed: true });
  });

  it('a D-51 end the migration kept (planEnd unset) is not a recorded decision: the operator may decide either outcome', () => {
    const s = store();
    idOf(open(s, 'programme-a', 'lane-a-one'));
    s.db.prepare("UPDATE programs SET state = 'done', coordinator = NULL WHERE slug = 'programme-a'").run();
    expect(s.programmeEndDecided('programme-a')).toBe(false);
    expect(s.decideProgramme({ slug: 'programme-a', to: 'abandoned', edge: 'ended', actor: OP, why: 'decided' }, 6)).toMatchObject({ ok: true, changed: true });
    expect(row(s, 'programme-a')).toMatchObject({ state: 'abandoned', planEnd: 'abandoned' });
    expect(s.programmeEndDecided('programme-a')).toBe(true);
  });
});

describe('the boot re-measure: the index and the step-3 bind agree (A5)', () => {
  it('a claimant whose unfiled placeholder stands has it withdrawn before the bind, never a UNIQUE throw', () => {
    const s = store();
    const b = idOf(open(s, 'programme-b', 'lane-a-two'));
    s.db.prepare("UPDATE runs SET claimedBy = 'lane-a-one' WHERE id = ?").run(b);   // an older build's claim
    s.db.prepare("UPDATE programs SET coordinator = NULL WHERE slug = 'programme-b'").run();
    tx(s.db, () => lifecycle.mintInTx(s.db, { slug: 'p-1', title: 'p-1', state: 'active', placeholder: 'unfiled', actor: OP, why: 'spawn',
      coordinator: { session: 'lane-a-one', uuid: null } }, 1));
    expect(s.remeasureProgrammesAtBoot(100)).toMatchObject({ bound: 1 });
    expect(row(s, 'programme-b').coordinator).toBe('lane-a-one');
    expect(row(s, 'p-1')).toMatchObject({ placeholder: 'withdrawn', coordinator: null });
  });
});
