// Programme lifecycle W1, tasks 4, 5, 7, 8 and 9: the one writer (`programmeLifecycleStore.ts`), the D-51 removal, the open
// rungs, the binding through `reclaimProgram`, and the boot re-measure. Neutral names only.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as lifecycle from '../src/coord/programmeLifecycleStore.js';
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
    expect(s.claimsProgramme('lane-a-one', 'programme-a')).toBe(true);   // an Idle programme's coordinator still owns it
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
    expect(s.claimsProgramme('lane-a-one', 'programme-a')).toBe(false);
  });

  it('an heir that owns another live programme is refused and nothing moves', () => {
    const s = store();
    const a = idOf(open(s, 'programme-a', 'lane-a-one'));
    idOf(open(s, 'programme-b', 'lane-a-two'));
    expect(s.reclaimProgram(a, 'lane-a-two', 10, 'project-a')).toEqual({ ok: false, kind: 'owns-another-programme', by: 'programme-b' });
    expect(row(s, 'programme-a').coordinator).toBe('lane-a-one');
    expect((s.db.prepare('SELECT claimedBy FROM runs WHERE id = ?').get(a) as { claimedBy: string }).claimedBy).toBe('lane-a-one');
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
