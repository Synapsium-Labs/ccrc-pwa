// D-8181: migration 58 (the plan model) and the plan store (`coord/planStore.ts`), over a real coord.db.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import {
  NO_PLAN_CHANGES, applyPlanChanges, attachTicketInTx, closePlan, dueSyncs, insertTicket, markCheckpointMet, markSyncDue,
  markSyncDueInTx, onRunAdvancedInTx, planEndOf, planOf, planOwnerOf, planStorePort, settleEpicInTx, ticketById, updateTicket,
  type NewTicket, type PlanChanges,
} from '../src/coord/planStore.js';
import { linkingOf } from '../src/coord/linkingStore.js';
import { hierarchySettingsOf, setHierarchySettings } from '../src/coord/planStore.js';
import { LINEAR_SYNC_PROGRAMME } from '../../shared/plan.js';
import { mkTmp } from './tmpHelpers.js';

const PLAN_SLOT = 58;   // the plan model's migration (the plan's own number was 57; slots 55 to 57 went first)
let dir: string;
let db: DatabaseSync;
let store: CoordStore;

beforeEach(() => {
  dir = mkTmp('ccrc-plan-store-');
  db = openCoordDb(path.join(dir, 'coord.db'));
  store = new CoordStore(db);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });
const epicIn = (key: string, waves: number[], ordinal = 0) => ({ key, project: 'project-a', waves, ordinal, title: key, summary: 's' });
const cpIn = (epicKey: string, key: string) => ({ epicKey, key, ordinal: 0, title: key, kind: 'acceptance' as const, proves: [], itemId: null });
const tkIn = (epicKey: string, key: string, over: Partial<NewTicket> = {}): NewTicket => ({
  program: 'prog-a', epicKey, checkpointKey: null, key, kind: 'work', title: key, body: '', project: 'project-a', source: 'plan', ...over,
});

/** A programme with one epic (one checkpoint) and one ticket, declared as `plan put` would. */
function declare(program = 'prog-a'): void {
  applyPlanChanges(db, program, changes({
    epics: { insert: [epicIn('e1', [1])], update: [], drop: [] },
    checkpoints: { insert: [cpIn('e1', 'c1')], update: [], drop: [] },
    tickets: { insert: [tkIn('e1', 't1', { program, checkpointKey: 'c1' })], update: [], drop: [] },
  }), 'coord-a', 10, { home: 'project-a', title: 'Prog A' });
}
const openWork = (program = 'prog-a', wave = 1, kind: 'work' | 'review' = 'work', reviews?: number) =>
  store.openRun({ program, title: 'w', project: 'project-a', wave, waveOf: 2, claimedBy: 'coord-a', homeProject: 'project-a', kind, reviews });
const dispatch = (runId: number) => store.dispatchRun({ runId, sessionId: 's1', workspace: 'ws', branch: 'b', resumed: false, clearedAt: null, items: [] });

describe('migration 58', () => {
  it('applies on a file one version older and an older build\'s statements still run', () => {
    const p = path.join(mkTmp('ccrc-plan-mig-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < PLAN_SLOT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${PLAN_SLOT - 1}`); });
    raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('old', 'Old', 1, 'active')");
    raw.close();
    const stepped = openCoordDb(p);
    expect((stepped.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    expect(COORD_SCHEMA_VERSION).toBe(PLAN_SLOT);
    // The pre-existing programme is legacy; an older build's INSERT/SELECT lists (which name no new column) still run.
    expect(stepped.prepare("SELECT planRequired FROM programs WHERE slug = 'old'").get()).toEqual({ planRequired: 0 });
    stepped.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('older-build', 'X', 1, 'active')").run();
    stepped.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('older-build', 1, 1, 'demo', 'working', 'c', 1)").run();
    stepped.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-a', 'KEY')").run();
    expect(stepped.prepare("SELECT teamKey FROM project_linking WHERE project = 'project-a'").get()).toEqual({ teamKey: 'KEY' });
    stepped.close();
  });

  it('every pre-existing programme reads planRequired 0 and a new one 1', () => {
    expect(planOf(db, 'new-programme').required).toBe(true);   // an absent row requires a plan
    store.openRun({ program: 'prog-a', title: 'w', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'c', homeProject: 'project-a' });
    expect(db.prepare("SELECT planRequired FROM programs WHERE slug = 'prog-a'").get()).toEqual({ planRequired: 1 });
  });

  it('linear-sync exists after the migration, paused', () => {
    expect(db.prepare("SELECT state, planRequired FROM programs WHERE slug = ?").get(LINEAR_SYNC_PROGRAMME)).toEqual({ state: 'paused', planRequired: 0 });
  });

  it('one real active programme plus linear-sync: soleActiveCoordinator still answers its claimant', () => {
    openWork();
    expect(store.soleActiveCoordinator()).toBe('coord-a');
  });

  it('a reconstructed programme reads planRequired 0', () => {
    store.reconstruct({
      ledger: { slug: 'rebuilt', title: 'Rebuilt', waves: [{ wave: 1, of: 1, handoffCommit: 'abc' }] },
      registry: { sessionId: 's', project: 'project-a', workspace: 'ws', branch: 'b', held: null }, prHistory: [],
    });
    expect(planOf(db, 'rebuilt').required).toBe(false);
  });

  it('two Upkeep epics for one project are refused by the index', () => {
    const ins = () => db.prepare("INSERT INTO plan_epics (program, project, waves, key, ordinal, title, summary, state) VALUES (NULL, 'project-a', '[]', ?, 0, 'Upkeep', '', 'active')");
    ins().run('upkeep');
    expect(() => ins().run('upkeep-2')).toThrow(/UNIQUE/);
  });
});

describe('applyPlanChanges', () => {
  it('with newRow inserts the programme row active with its home, and a second call leaves it unchanged', () => {
    declare();
    expect(db.prepare("SELECT state, homeProject, planRequired, planBy FROM programs WHERE slug = 'prog-a'").get())
      .toEqual({ state: 'active', homeProject: 'project-a', planRequired: 1, planBy: 'coord-a' });
    applyPlanChanges(db, 'prog-a', NO_PLAN_CHANGES(), 'coord-b', 20, { home: 'project-z', title: 'Other' });
    expect(db.prepare("SELECT title, homeProject, planBy, planAt FROM programs WHERE slug = 'prog-a'").get())
      .toEqual({ title: 'Prog A', homeProject: 'project-a', planBy: 'coord-a', planAt: 10 });
  });

  it('a dropped key keeps its row with droppedWhy (an epic, a checkpoint and a ticket)', () => {
    declare();
    const p = planOf(db, 'prog-a');
    const e = p.epics[0]!;
    applyPlanChanges(db, 'prog-a', changes({
      epics: { insert: [], update: [], drop: [{ id: e.id, why: 'no longer needed' }] },
      checkpoints: { insert: [], update: [], drop: [{ id: e.checkpoints[0]!.id, why: 'cp why' }] },
      tickets: { insert: [], update: [], drop: [{ id: e.tickets[0]!.id, why: 'tk why' }] },
    }), 'coord-a', 20, null);
    const q = planOf(db, 'prog-a').epics[0]!;
    expect([q.state, q.droppedWhy]).toEqual(['dropped', 'no longer needed']);
    expect([q.checkpoints[0]!.state, q.checkpoints[0]!.droppedWhy]).toEqual(['dropped', 'cp why']);
    expect([q.tickets[0]!.state, q.tickets[0]!.droppedWhy]).toEqual(['dropped', 'tk why']);
  });

  it('marks the programme due and puts an Upkeep epic under upkeep:<project>', () => {
    declare();
    expect(dueSyncs(db, 10)).toEqual(['prog-a']);
    db.prepare("INSERT INTO plan_epics (program, project, waves, key, ordinal, title, summary, state) VALUES (NULL, 'project-a', '[]', 'upkeep', 0, 'Upkeep', '', 'active')").run();
    insertTicket(db, tkIn('upkeep', 'u1', { program: null }), 30);
    expect(dueSyncs(db, 30)).toEqual(['prog-a', 'upkeep:project-a']);
  });
});

describe('the epic settles', () => {
  it('plan met on the last checkpoint after the last run closes the epic', () => {
    declare();
    const runId = openWork().id;
    const e = planOf(db, 'prog-a').epics[0]!;
    tx(db, () => attachTicketInTx(db, runId, { kind: 'existing', id: e.tickets[0]!.id, epicId: e.id, reproject: null }, 20));
    dispatch(runId);
    store.closeRun({ runId, finalState: 'done', causedBy: 'coordinator', handoffCommit: null, program: 'prog-a', viaClosing: true });
    expect(planOf(db, 'prog-a').epics[0]!.state).toBe('active');   // the checkpoint is still open
    markCheckpointMet(db, e.checkpoints[0]!.id, { pr: 7 }, 40);
    const done = planOf(db, 'prog-a').epics[0]!;
    expect([done.state, done.doneAt]).toEqual(['done', 40]);
    expect(done.checkpoints[0]!.evidence).toEqual({ pr: 7 });
  });

  it('dropping the last open ticket closes the epic', () => {
    applyPlanChanges(db, 'prog-a', changes({
      epics: { insert: [epicIn('e1', [1])], update: [], drop: [] },
      tickets: { insert: [tkIn('e1', 't1'), tkIn('e1', 't2')], update: [], drop: [] },
    }), 'c', 1, { home: 'project-a', title: 'P' });
    const e = planOf(db, 'prog-a').epics[0]!;
    db.prepare("UPDATE plan_tickets SET state = 'done' WHERE id = ?").run(e.tickets[0]!.id);
    updateTicket(db, e.tickets[1]!.id, { state: 'dropped', droppedWhy: 'not needed' }, 5);
    expect(planOf(db, 'prog-a').epics[0]!.state).toBe('done');
  });

  it('a ticket moved out of an epic settles the source epic', () => {
    applyPlanChanges(db, 'prog-a', changes({
      epics: { insert: [epicIn('e1', [1], 0), epicIn('e2', [2], 1)], update: [], drop: [] },
      tickets: { insert: [tkIn('e1', 't1'), tkIn('e1', 't2'), tkIn('e2', 't3')], update: [], drop: [] },
    }), 'c', 1, { home: 'project-a', title: 'P' });
    const [e1, e2] = planOf(db, 'prog-a').epics;
    db.prepare("UPDATE plan_tickets SET state = 'done' WHERE id = ?").run(e1!.tickets[0]!.id);
    updateTicket(db, e1!.tickets[1]!.id, { epicId: e2!.id }, 5);
    const after = planOf(db, 'prog-a').epics;
    expect(after[0]!.state).toBe('done');
    expect(after[1]!.state).toBe('planned');
  });

  it('an Upkeep epic never settles done', () => {
    db.prepare("INSERT INTO plan_epics (program, project, waves, key, ordinal, title, summary, state) VALUES (NULL, 'project-a', '[]', 'upkeep', 0, 'Upkeep', '', 'active')").run();
    const id = (db.prepare("SELECT id FROM plan_epics WHERE program IS NULL").get() as { id: number }).id;
    const t = insertTicket(db, tkIn('upkeep', 'u1', { program: null }), 1);
    db.prepare("UPDATE plan_tickets SET state = 'done' WHERE id = ?").run(t);
    tx(db, () => settleEpicInTx(db, id, 2));
    expect((db.prepare('SELECT state FROM plan_epics WHERE id = ?').get(id) as { state: string }).state).toBe('active');
  });

  it('an epic with nothing in it is not done', () => {
    applyPlanChanges(db, 'prog-a', changes({ epics: { insert: [epicIn('e1', [1])], update: [], drop: [] } }), 'c', 1, { home: 'project-a', title: 'P' });
    expect(planOf(db, 'prog-a').epics[0]!.state).toBe('planned');
  });
});

describe('runs and tickets', () => {
  it('dispatchRun starts the ticket and activates its epic', () => {
    declare();
    const runId = openWork().id;
    const e = planOf(db, 'prog-a').epics[0]!;
    tx(db, () => attachTicketInTx(db, runId, { kind: 'existing', id: e.tickets[0]!.id, epicId: e.id, reproject: null }, 20));
    expect(ticketById(db, e.tickets[0]!.id)).toMatchObject({ state: 'open', runId });
    dispatch(runId);
    const q = planOf(db, 'prog-a').epics[0]!;
    expect(q.state).toBe('active');
    expect(q.openedAt).not.toBeNull();
    expect(q.tickets[0]).toMatchObject({ state: 'started', runId });
  });

  it('closeRun done closes the ticket, failed reopens it', () => {
    declare();
    const e = planOf(db, 'prog-a').epics[0]!;
    const r1 = openWork().id;
    tx(db, () => attachTicketInTx(db, r1, { kind: 'existing', id: e.tickets[0]!.id, epicId: e.id, reproject: null }, 20));
    dispatch(r1);
    store.closeRun({ runId: r1, finalState: 'failed', causedBy: 'coordinator', handoffCommit: null, program: 'prog-a', viaClosing: true });
    expect(ticketById(db, e.tickets[0]!.id)).toMatchObject({ state: 'open', runId: null });
    const r2 = openWork('prog-a', 2).id;
    tx(db, () => attachTicketInTx(db, r2, { kind: 'existing', id: e.tickets[0]!.id, epicId: e.id, reproject: null }, 30));
    dispatch(r2);
    store.closeRun({ runId: r2, finalState: 'done', causedBy: 'coordinator', handoffCommit: null, program: 'prog-a', viaClosing: true });
    expect(ticketById(db, e.tickets[0]!.id)).toMatchObject({ state: 'done', runId: r2 });
  });

  it('a review run\'s advance moves no ticket', () => {
    declare();
    const e = planOf(db, 'prog-a').epics[0]!;
    const work = openWork().id;
    tx(db, () => attachTicketInTx(db, work, { kind: 'existing', id: e.tickets[0]!.id, epicId: e.id, reproject: null }, 20));
    const review = openWork('prog-a', 1, 'review', work).id;
    dispatch(review);
    expect(ticketById(db, e.tickets[0]!.id)).toMatchObject({ state: 'open', runId: work });
    expect(planOf(db, 'prog-a').epics[0]!.state).toBe('planned');
  });

  it('attaches an auto ticket keyed run-<id>, once, and re-projects a named one', () => {
    declare();
    const e = planOf(db, 'prog-a').epics[0]!;
    const r = openWork().id;
    const auto = { kind: 'new', epicId: e.id, project: 'project-b', title: 'auto' } as const;
    expect(tx(db, () => attachTicketInTx(db, r, auto, 20))).toEqual({ ok: true });
    expect(tx(db, () => attachTicketInTx(db, r, auto, 21))).toEqual({ ok: true });   // a retried open attaches nothing twice
    expect(planOf(db, 'prog-a').epics[0]!.tickets.filter((t) => t.key === `run-${r}`)).toHaveLength(1);
    const r2 = openWork('prog-a', 2).id;
    expect(tx(db, () => attachTicketInTx(db, r2, { kind: 'existing', id: e.tickets[0]!.id, epicId: e.id, reproject: 'project-c' }, 22))).toEqual({ ok: true });
    expect(ticketById(db, e.tickets[0]!.id)!.project).toBe('project-c');
  });

  it('refuses a closed plan, a dropped epic and an unavailable ticket', () => {
    declare();
    const e = planOf(db, 'prog-a').epics[0]!;
    const named = { kind: 'existing', id: e.tickets[0]!.id, epicId: e.id, reproject: null } as const;
    const r = openWork().id;
    db.prepare("UPDATE plan_tickets SET state = 'done' WHERE id = ?").run(e.tickets[0]!.id);
    expect(tx(db, () => attachTicketInTx(db, r, named, 20))).toEqual({ ok: false, refused: 'ticket-unavailable' });
    db.prepare("UPDATE plan_epics SET state = 'dropped' WHERE id = ?").run(e.id);
    expect(tx(db, () => attachTicketInTx(db, r, named, 20))).toEqual({ ok: false, refused: 'wave-epic-mismatch' });
    closePlan(db, 'prog-a', 'done', null, 30);
    expect(tx(db, () => attachTicketInTx(db, r, named, 20))).toEqual({ ok: false, refused: 'plan-closed' });
  });

  it('planOwnerOf prefers the newest claimant, then planBy', () => {
    declare();
    expect(planOwnerOf(db, 'prog-a')).toBe('coord-a');   // planBy
    store.openRun({ program: 'prog-a', title: 'w', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'coord-a', homeProject: 'project-a' });
    db.prepare("UPDATE runs SET claimedBy = 'coord-b' WHERE program = 'prog-a'").run();
    expect(planOwnerOf(db, 'prog-a')).toBe('coord-b');
  });
});

describe('the queue and the plan end', () => {
  it('markSyncDue keeps the earlier dueAt', () => {
    markSyncDue(db, 'prog-a', 100);
    markSyncDue(db, 'prog-a', 50);
    markSyncDue(db, 'prog-a', 200);
    expect(db.prepare("SELECT dueAt FROM plan_sync_due WHERE program = 'prog-a'").get()).toEqual({ dueAt: 50 });
  });

  it('the reserved programme is never queued', () => {
    markSyncDue(db, LINEAR_SYNC_PROGRAMME, 1);
    expect(dueSyncs(db, 10)).toEqual([]);
  });

  it('closePlan writes the end once', () => {
    declare();
    closePlan(db, 'prog-a', 'abandoned', 'scope cut', 50);
    closePlan(db, 'prog-a', 'done', null, 60);
    expect(planEndOf(db, 'prog-a')).toEqual({ outcome: 'abandoned', why: 'scope cut', at: 50 });
  });

  it('the port is the same functions without the handle', () => {
    const port = planStorePort(db);
    declare();
    expect(port.planOf('prog-a')).toEqual(planOf(db, 'prog-a'));
  });
});

describe('the handle ring', () => {
  it('no planStore InTx writer opens a transaction (called inside tx, none throws)', () => {
    declare();
    const e = planOf(db, 'prog-a').epics[0]!;
    const r = openWork().id;
    expect(() => tx(db, () => {
      markSyncDueInTx(db, 'prog-a', 1);
      settleEpicInTx(db, e.id, 2);
      attachTicketInTx(db, r, { kind: 'new', epicId: e.id, project: 'project-a', title: 't' }, 3);
      onRunAdvancedInTx(db, r, 'planned', 'dispatched', 4);
    })).not.toThrow();
  });

  it('planStore.ts is a declared handle holder', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'single-definition/core-vocab.test.ts'), 'utf8');
    expect(src).toMatch(/HANDLE_HOLDERS = new Set\([^)]*'planStore\.ts'/);
  });
});

describe('the hierarchy settings', () => {
  it('a project with no row reads the defaults; ownsTeam on project-b clears it on project-a with the same key', () => {
    expect(hierarchySettingsOf(db, 'project-a')).toEqual({ initiatives: 'on', linearOwner: null, ownsTeam: false });
    db.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-a', 'KEY'), ('project-b', 'KEY'), ('project-c', 'OTHER')").run();
    setHierarchySettings(db, 'project-a', { initiatives: 'off', linearOwner: 'coord-a', ownsTeam: true }, 'op', 1);
    setHierarchySettings(db, 'project-c', { initiatives: 'on', linearOwner: null, ownsTeam: true }, 'op', 2);
    setHierarchySettings(db, 'project-b', { initiatives: 'on', linearOwner: null, ownsTeam: true }, 'op', 3);
    expect(linkingOf(db, 'project-a')).toMatchObject({ initiatives: 'off', linearOwner: 'coord-a', ownsTeam: false, teamKey: 'KEY' });
    expect(linkingOf(db, 'project-b').ownsTeam).toBe(true);
    expect(linkingOf(db, 'project-c').ownsTeam).toBe(true);   // another key is left alone
  });
});
