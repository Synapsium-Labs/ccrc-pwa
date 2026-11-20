// D-8181: migration 59 (the plan model) and the plan store (`coord/planStore.ts`), over a real coord.db.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import {
  NO_PLAN_CHANGES, addSettledProbe, applyPlanChanges, attachTicketInTx, clearSyncDue, closePlan, deferSync, dueSyncs, heldSyncUntil, insertTicket, markCheckpointMet, markSyncDue,
  markSyncDueInTx, onRunAdvancedInTx, planEndOf, planOf, planOwnerOf, planStorePort, settleEpicInTx, ticketById, updateTicket,
  type NewTicket, type PlanChanges,
} from '../src/coord/planStore.js';
import { linkingOf } from '../src/coord/linkingStore.js';
import { hierarchySettingsOf, setHierarchySettings } from '../src/coord/planStore.js';
import {
  clearSettledProbes, driftEventsOf, driftMarkOf, driftRestoresOf, inboundByState, inboundOf, inboundWaiting, lastDriftCommentAt,
  managedTeams, markDriftCommented, recordDrift, setDriftItem, setDriftMark, setDriftSince, setInboundState, setStreak, settledProbes,
  streaksOf, upsertInbound, managedSince, bindingByLinearId, dueKeyOfBinding, ensurePending, markBound, markFailed, issueBound, graceBindingsOf,
  lastDriftEventOf, retireInbound, retireInboundInTx, setInboundNote, inboundNoteOf,
} from '../src/coord/planStore.js';
import {
  ADOPTED_FINGERPRINT, adoptIssueBindingInTx, bindingsOf, ensureUpkeepEpicInTx, inboundByIdentifier, inboundTicketInTx, moveTicketToProgrammeInTx,
  placeInboundInUpkeep, takeInboundIntoEpic, takeUpkeepTicket, upkeepEpicOf, upkeepPlanOf, upkeepTicketByIdentifier,
  boundLinearIdsOf, upkeepProjectsOf, ticketOfRun, dropPutBack, retireBindingInTx, MIGRATION_PLAN_BY,
} from '../src/coord/planStore.js';
import { LINEAR_SYNC_PROGRAMME, PLAN_BOUNDS, UPKEEP_EPIC_KEY, UPKEEP_EPIC_TITLE } from '../../shared/plan.js';
import { mkTmp } from './tmpHelpers.js';

const PLAN_SLOT = 59;   // the plan model's migration (the plan's own number was 57; slots 55 to 58 went first)
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
const openWork = (program = 'prog-a', wave = 1, kind: 'work' | 'review' = 'work', reviews?: number) => {
  const r = store.openRun({ program, title: 'w', project: 'project-a', wave, waveOf: 2, claimedBy: 'coord-a', homeProject: 'project-a', kind, reviews });
  if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
  return r;
};
const dispatch = (runId: number) => store.dispatchRun({ runId, sessionId: 's1', workspace: 'ws', branch: 'b', resumed: false, clearedAt: null, items: [] });

describe('migration 59', () => {
  it('applies on a file one version older and an older build\'s statements still run', () => {
    const p = path.join(mkTmp('ccrc-plan-mig-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { for (let v = 0; v < PLAN_SLOT - 1; v++) raw.exec(MIGRATIONS[v]!); raw.exec(`PRAGMA user_version = ${PLAN_SLOT - 1}`); });
    raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('old', 'Old', 1, 'active')");
    raw.close();
    const stepped = openCoordDb(p);
    expect((stepped.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    // Slot 59 is the plan model's, and later migrations (60, claude_builds, D-8289) may follow it: the opener runs them too.
    expect(MIGRATIONS[PLAN_SLOT - 1]).toMatch(/CREATE TABLE plan_epics\b/);
    expect(MIGRATIONS.slice(0, PLAN_SLOT - 1).some((m) => /CREATE TABLE plan_epics\b/.test(m))).toBe(false);
    expect(COORD_SCHEMA_VERSION).toBeGreaterThanOrEqual(PLAN_SLOT);
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

  it('A7/A12: a row deferred for a failure keeps its dueAt against markSyncDue; an ordinary wait does not', () => {
    const dueOf = (): unknown => db.prepare("SELECT dueAt FROM plan_sync_due WHERE program = 'prog-a'").get();
    markSyncDue(db, 'prog-a', 100);
    deferSync(db, 'prog-a', 30_100, 'failure');
    markSyncDue(db, 'prog-a', 200);                       // a plan write, a run transition, an attach
    tx(db, () => markSyncDueInTx(db, 'prog-a', 300));
    expect(dueOf()).toEqual({ dueAt: 30_100 });
    expect(heldSyncUntil(db, 'prog-a', 300)).toBe(30_100);
    expect(heldSyncUntil(db, 'prog-a', 30_100)).toBeNull();       // the backoff has passed: nothing holds it
    deferSync(db, 'prog-a', 40_000, 'wait');               // a directory wait: an ordinary deferral
    markSyncDue(db, 'prog-a', 400);
    expect(dueOf()).toEqual({ dueAt: 400 });
    expect(heldSyncUntil(db, 'prog-a', 300)).toBeNull();
    deferSync(db, 'prog-a', 50_000, 'failure');
    clearSyncDue(db, 'prog-a');                            // settled: the next mark is an ordinary one
    markSyncDue(db, 'prog-a', 500);
    expect(dueOf()).toEqual({ dueAt: 500 });
    expect(heldSyncUntil(db, 'prog-b', 0)).toBeNull();
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

describe('programmeRowId (C6)', () => {
  it('answers the programs row rowid through the port, and null for an unknown slug', () => {
    declare('prog-a');
    const port = planStorePort(db);
    const rid = (db.prepare("SELECT rowid AS r FROM programs WHERE slug = 'prog-a'").get() as { r: number }).r;
    expect(port.programmeRowId('prog-a')).toBe(rid);
    expect(port.programmeRowId('nope')).toBeNull();
  });
});

describe('requeueFailed (C17)', () => {
  it('to bound keeps the linear id and the stored fingerprint; to pending only a binding no object backs', () => {
    declare('prog-a');
    const port = planStorePort(db);
    const epicId = port.planOf('prog-a').epics[0]!.id;
    const made = port.ensurePending('epic', epicId, 'ws-a', 'AAA');
    port.markBound(made.id, 'lin-1', null, 'fp-1', 10);
    port.markFailed(made.id, 'linear-forbidden', 'in-1', 20);
    expect(port.requeueFailed({ bindingId: made.id, to: 'pending' })).toBe(0);          // an object is known: never pending
    expect(port.requeueFailed({ bindingId: made.id, to: 'bound' })).toBe(1);
    expect(port.bindingOf('epic', epicId, 'ws-a')).toMatchObject({
      state: 'bound', linearId: 'lin-1', fingerprint: 'fp-1', failedAt: null, failedWord: null, failedInputs: null,
    });
    const cpId = port.planOf('prog-a').epics[0]!.checkpoints[0]!.id;
    const never = port.ensurePending('checkpoint', cpId, 'ws-a', 'AAA');
    port.markFailed(never.id, 'status-missing', 'in-2', 30);
    expect(port.requeueFailed({ bindingId: never.id, to: 'bound' })).toBe(0);             // nothing to be bound to
    expect(port.requeueFailed({ bindingId: never.id, to: 'pending' })).toBe(1);
    expect(port.bindingOf('checkpoint', cpId, 'ws-a')).toMatchObject({ state: 'pending', linearId: null, failedAt: null });
  });
});

// ── Migration 87 and the drift, migration and inbound stores (D-8183, Task 4.1) ───────────────────────────────────────

const NEW_TABLES = ['linear_drift_marks', 'linear_drift_events', 'linear_migrations', 'linear_migration_moves', 'linear_inbound',
  'linear_sync_streaks', 'linear_probe_settled'];
const insertMigration = (ws: string, team: string, state: string): void => {
  db.prepare('INSERT INTO linear_migrations (workspaceId, teamKey, state, createdAt, updatedAt) VALUES (?, ?, ?, 1, 1)').run(ws, team, state);
};
const inboundIn = (linearId: string, over: Partial<Parameters<typeof upsertInbound>[1]> = {}) => ({
  linearId, workspaceId: 'ws-a', teamKey: 'AAA', identifier: `KEY-${linearId}`, title: 'T', body: 'B', seenAt: 5, ...over,
});

describe("wave 4's migration (D-8183)", () => {
  // Found by its content, not its slot: the entry is renumbered whenever another PR lands its migration first (D-8673).
  it('applies after the plan model (59) and the decision-model records, once', () => {
    const at = MIGRATIONS.findIndex((m) => /CREATE TABLE linear_drift_marks\b/.test(m));
    expect(at).toBeGreaterThan(MIGRATIONS.findIndex((m) => /CREATE TABLE plan_epics\b/.test(m)));
    expect(at).toBeGreaterThan(MIGRATIONS.findIndex((m) => /CREATE TABLE decision_records\b/.test(m)));
    expect(MIGRATIONS.filter((m) => /CREATE TABLE linear_drift_marks\b/.test(m))).toHaveLength(1);
    for (const t of NEW_TABLES) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t).toBeDefined();
    }
    db.prepare("INSERT INTO linear_migration_moves (migrationId, subject, kind, after) VALUES (1, 'epic:e1', 'epic', '{}')").run();
    expect(() => db.prepare("INSERT INTO linear_migration_moves (migrationId, subject, kind, after) VALUES (1, 'epic:e1', 'epic', '{}')").run())
      .toThrow(/UNIQUE/);
    db.prepare("INSERT INTO linear_migration_moves (migrationId, subject, kind, after) VALUES (2, 'epic:e1', 'epic', '{}')").run();
  });
});

describe('managed teams', () => {
  it('managedTeams answers applied migrations only', () => {
    insertMigration('ws-b', 'BBB', 'applied');
    insertMigration('ws-a', 'AAA', 'applied');
    insertMigration('ws-a', 'AAA', 'applied');
    insertMigration('ws-a', 'CCC', 'proposed');
    insertMigration('ws-a', 'DDD', 'put-back');
    expect(managedTeams(db)).toEqual([{ workspaceId: 'ws-a', teamKey: 'AAA' }, { workspaceId: 'ws-b', teamKey: 'BBB' }]);
    expect(planStorePort(db).managedTeams()).toEqual(managedTeams(db));
  });
});

describe('managedSince (D-8183)', () => {
  it('is the earliest appliedAt of a workspace\'s applied migrations, null for none', () => {
    const ins = db.prepare('INSERT INTO linear_migrations (workspaceId, teamKey, state, createdAt, updatedAt, appliedAt) VALUES (?, ?, ?, 1, 1, ?)');
    ins.run('ws-a', 'AAA', 'applied', 500); ins.run('ws-a', 'BBB', 'applied', 300); ins.run('ws-a', 'CCC', 'proposed', 100); ins.run('ws-b', 'DDD', 'applied', 900);
    expect(managedSince(db, 'ws-a')).toBe(300);
    expect(managedSince(db, 'ws-b')).toBe(900);
    expect(managedSince(db, 'ws-c')).toBeNull();
    expect(planStorePort(db).managedSince('ws-a')).toBe(300);
  });
});

describe('drift marks and events', () => {
  it('a drift mark is upserted per workspace, one watermark per changed* kind (review 2386 A3)', () => {
    expect(driftMarkOf(db, 'ws-a')).toBeNull();
    setDriftMark(db, 'ws-a', { initiative: 'i1', project: 'p1', milestone: 'm1', issue: 's1' }, 10);
    setDriftMark(db, 'ws-a', { initiative: 'i2', project: 'p1', milestone: 'm2', issue: 's2' }, 20);
    expect(driftMarkOf(db, 'ws-a')).toEqual({ watermarks: { initiative: 'i2', project: 'p1', milestone: 'm2', issue: 's2' }, passAt: 20 });
    expect(driftMarkOf(db, 'ws-b')).toBeNull();
  });
  it('lastDriftEventOf answers a binding\'s newest event of one field (review 2386 A4)', () => {
    expect(lastDriftEventOf(db, 1, 'milestoneIds')).toBeNull();
    recordDrift(db, { bindingId: 1, at: 10, field: 'milestoneIds', value: 'a', actor: 'not read', restored: false });
    recordDrift(db, { bindingId: 1, at: 20, field: 'milestoneIds', value: 'b', actor: 'not read', restored: false });
    recordDrift(db, { bindingId: 1, at: 30, field: 'name', value: 'c', actor: 'not read', restored: true });
    recordDrift(db, { bindingId: 2, at: 40, field: 'milestoneIds', value: 'd', actor: 'not read', restored: true });
    expect(lastDriftEventOf(db, 1, 'milestoneIds')).toEqual({ value: 'b', restored: false });
    expect(lastDriftEventOf(db, 1, 'name')).toEqual({ value: 'c', restored: true });
  });
  it('graceBindingsOf answers a workspace\'s ticket bindings whose grace stands (review 2386 F1)', () => {
    declare('prog-a');
    const tk = (db.prepare("SELECT id FROM plan_tickets WHERE program = 'prog-a'").get() as { id: number }).id;
    const b = ensurePending(db, 'ticket', tk, 'ws-a', 'AAA');
    markBound(db, b.id, 'lin-7', 'AAA-7', 'fp', 5);
    expect(graceBindingsOf(db, 'ws-a')).toEqual([]);
    setDriftSince(db, b.id, 99);
    expect(graceBindingsOf(db, 'ws-a').map((x) => x.id)).toEqual([b.id]);
    expect(graceBindingsOf(db, 'ws-b')).toEqual([]);
    expect(planStorePort(db).graceBindingsOf('ws-a').map((x) => x.id)).toEqual([b.id]);
  });
  it('recordDrift and driftRestoresOf', () => {
    const a = recordDrift(db, { bindingId: 1, at: 100, field: 'projectId', value: 'x', actor: 'not read', restored: true });
    const b = recordDrift(db, { bindingId: 1, at: 50, field: 'title', value: 'y', actor: 'not read', restored: true });
    recordDrift(db, { bindingId: 1, at: 70, field: 'title', value: 'z', actor: 'not read', restored: false });
    recordDrift(db, { bindingId: 2, at: 60, field: 'title', value: 'z', actor: 'not read', restored: true });
    expect(b).toBeGreaterThan(a);
    expect(driftRestoresOf(db, 1, 0)).toEqual([50, 100]);
    expect(driftRestoresOf(db, 1, 60)).toEqual([100]);
    expect(driftEventsOf(db, 1, 60).map((e) => [e.at, e.field, e.restored])).toEqual([[70, 'title', false], [100, 'projectId', true]]);
    expect(lastDriftCommentAt(db, 1)).toBeNull();
    markDriftCommented(db, a, 111);
    markDriftCommented(db, b, 99);
    expect(lastDriftCommentAt(db, 1)).toBe(111);
  });
  it('the binding drift columns have one writer each', () => {
    declare('prog-a');
    const port = planStorePort(db);
    const b = port.ensurePending('epic', port.planOf('prog-a').epics[0]!.id, 'ws-a', 'AAA');
    setDriftSince(db, b.id, 77);
    setDriftItem(db, b.id, 9);
    expect(port.bindingOf('epic', b.localId, 'ws-a')).toMatchObject({ driftSince: 77, heldItemId: 9 });
    setDriftSince(db, b.id, null);
    setDriftItem(db, b.id, null);
    expect(port.bindingOf('epic', b.localId, 'ws-a')).toMatchObject({ driftSince: null, heldItemId: null });
  });
});

describe('inbound', () => {
  it('upsertInbound keeps the state of a known row', () => {
    expect(upsertInbound(db, inboundIn('L1'))).toBe('new');
    expect(inboundOf(db, 'L1')).toMatchObject({ state: 'waiting', title: 'T', body: 'B', mailedTo: null });
    setInboundState(db, 'L1', { state: 'mailed', mailedTo: 'coord-a', mailedAt: 6 });
    expect(upsertInbound(db, inboundIn('L1', { title: 'T2', body: null, seenAt: 99 }))).toBe('known');
    expect(inboundOf(db, 'L1')).toMatchObject({ state: 'mailed', title: 'T2', body: null, mailedTo: 'coord-a', mailedAt: 6, seenAt: 5 });
    expect(inboundOf(db, 'nope')).toBeNull();
    setInboundState(db, 'L1', { state: 'closed', reason: 'duplicate', actedAt: 8 });
    expect(inboundOf(db, 'L1')).toMatchObject({ state: 'closed', reason: 'duplicate', actedAt: 8, mailedTo: 'coord-a' });
  });
  it('setInboundState called outside a transaction is one transaction of its own: a failing note delete leaves the state unchanged (review 2834 A3)', () => {
    upsertInbound(db, inboundIn('L1'));
    db.exec('DROP TABLE linear_inbound_notes');       // the second statement (the note's delete) now throws
    expect(db.isTransaction).toBe(false);
    expect(() => setInboundState(db, 'L1', { state: 'handed', handedTo: 'coord-a' })).toThrow();
    expect(inboundOf(db, 'L1')).toMatchObject({ state: 'waiting', handedTo: null });
  });
  it('upsertInbound truncates a long title and body visibly, on a code point (D-8705)', () => {
    const title = '😀'.repeat(300);
    const body = 'é'.repeat(40_000) + '😀';   // 80 003 bytes
    upsertInbound(db, inboundIn('L1', { title, body }));
    const row = inboundOf(db, 'L1')!;
    expect([...row.title].length).toBe(PLAN_BOUNDS.titleChars);
    expect(row.title.endsWith('…')).toBe(true);
    expect(Buffer.byteLength(row.body!, 'utf8')).toBeLessThanOrEqual(PLAN_BOUNDS.bodyBytes);
    expect(row.body!.endsWith('\n…')).toBe(true);
    expect(row.body).not.toContain('\uFFFD');
    upsertInbound(db, inboundIn('L2', { title: 'short', body: 'short' }));
    expect(inboundOf(db, 'L2')).toMatchObject({ title: 'short', body: 'short' });
    upsertInbound(db, inboundIn('L1', { title, body }));   // a refresh cuts the same way
    expect([...inboundOf(db, 'L1')!.title].length).toBe(PLAN_BOUNDS.titleChars);
  });
  it('inboundByState filters by workspace and state', () => {
    upsertInbound(db, inboundIn('L1'));
    upsertInbound(db, inboundIn('L2', { workspaceId: 'ws-b' }));
    setInboundState(db, 'L2', { state: 'handed', handedTo: 'coord-a' });
    expect(inboundByState(db, null, ['waiting', 'handed']).map((r) => r.linearId)).toEqual(['L1', 'L2']);
    expect(inboundByState(db, 'ws-b', ['waiting', 'handed']).map((r) => r.linearId)).toEqual(['L2']);
    expect(inboundByState(db, null, ['taken'])).toEqual([]);
    expect(inboundByState(db, null, [])).toEqual([]);
  });
  it("inboundWaiting counts the project's team's waiting rows", () => {
    db.prepare("INSERT INTO project_linking (project, teamKey) VALUES ('project-a', 'aaa')").run();
    upsertInbound(db, inboundIn('L1'));
    upsertInbound(db, inboundIn('L2'));
    upsertInbound(db, inboundIn('L3'));
    upsertInbound(db, inboundIn('L4', { teamKey: 'BBB' }));
    setInboundState(db, 'L3', { state: 'mailed' });
    expect(inboundWaiting(db, 'project-a')).toBe(2);
    expect(inboundWaiting(db, 'project-none')).toBe(0);
  });
});

describe('streaks and settled probes', () => {
  it('streaks and settled probes round-trip', () => {
    setStreak(db, 'k1', { keyDigest: 'd1', since: 1, lastFilledAt: 2, refills: 3 });
    setStreak(db, 'k1', { keyDigest: 'd1', since: 1, lastFilledAt: 5, refills: 4 });
    setStreak(db, 'k2', { keyDigest: 'd2', since: 9, lastFilledAt: 9, refills: 1 });
    expect([...streaksOf(db)]).toEqual([['k1', { keyDigest: 'd1', since: 1, lastFilledAt: 5, refills: 4 }], ['k2', { keyDigest: 'd2', since: 9, lastFilledAt: 9, refills: 1 }]]);
    setStreak(db, 'k1', null);
    expect([...streaksOf(db).keys()]).toEqual(['k2']);

    addSettledProbe(db, 'ws-a', 'prog-a');
    addSettledProbe(db, 'ws-a', 'prog-a');
    addSettledProbe(db, 'ws-a', 'prog-b');
    addSettledProbe(db, 'ws-b', 'prog-a');
    expect([...settledProbes(db).get('ws-a')!].sort()).toEqual(['prog-a', 'prog-b']);
    clearSettledProbes(db, 'ws-a');
    expect([...settledProbes(db).keys()]).toEqual(['ws-b']);
  });
  it('every new function joins the port', () => {
    const port = planStorePort(db);
    for (const f of ['managedTeams', 'driftMarkOf', 'setDriftMark', 'recordDrift', 'driftRestoresOf', 'lastDriftCommentAt', 'markDriftCommented',
      'driftEventsOf', 'setDriftSince', 'setDriftItem', 'upsertInbound', 'inboundOf', 'setInboundState', 'inboundByState', 'inboundWaiting',
      'streaksOf', 'setStreak', 'settledProbes', 'addSettledProbe', 'clearSettledProbes', 'graceBindingsOf', 'lastDriftEventOf']) {
      expect(typeof (port as unknown as Record<string, unknown>)[f], f).toBe('function');
    }
  });
});

describe('the drift pass\'s two lookups (D-8183)', () => {
  const idOf = (sql: string): number => (db.prepare(sql).get() as { id: number }).id;
  it('bindingByLinearId finds a binding by its workspace and Linear id, and only there', () => {
    declare('prog-a');
    const ep = idOf("SELECT id FROM plan_epics WHERE program = 'prog-a'");
    const b = ensurePending(db, 'epic', ep, 'ws-a', 'AAA');
    markBound(db, b.id, 'lin-1', null, 'fp', 5);
    expect(bindingByLinearId(db, 'ws-a', 'lin-1')?.id).toBe(b.id);
    expect(bindingByLinearId(db, 'ws-b', 'lin-1')).toBeNull();
    expect(bindingByLinearId(db, 'ws-a', 'lin-2')).toBeNull();
    expect(planStorePort(db).bindingByLinearId('ws-a', 'lin-1')?.id).toBe(b.id);
  });
  it('issueBound matches a ticket binding holding the issue whatever its state, a failed one included (review 2386 F4)', () => {
    declare('prog-a');
    const tk = idOf("SELECT id FROM plan_tickets WHERE program = 'prog-a'");
    const b = ensurePending(db, 'ticket', tk, 'ws-a', 'AAA');
    expect(issueBound(db, 'ws-a', { id: null, identifier: null })).toBe(false);          // a pending binding holds no issue
    markBound(db, b.id, 'lin-9', 'AAA-9', 'fp', 5);
    expect(issueBound(db, 'ws-a', { id: 'lin-9', identifier: null })).toBe(true);
    markFailed(db, b.id, 'linear-forbidden', 'in', 6);                                   // a refused write keeps the id (D-8680)
    expect(issueBound(db, 'ws-a', { id: 'lin-9', identifier: null })).toBe(true);
    expect(issueBound(db, 'ws-a', { id: null, identifier: 'AAA-9' })).toBe(true);
    expect(issueBound(db, 'ws-b', { id: 'lin-9', identifier: 'AAA-9' })).toBe(false);
    expect(issueBound(db, 'ws-a', { id: 'lin-8', identifier: 'AAA-8' })).toBe(false);
  });
  it('dueKeyOfBinding names the programme\'s slug for each kind of binding, and upkeep:<project> for an Upkeep epic', () => {
    declare('prog-a');
    const rid = planStorePort(db).programmeRowId('prog-a')!;
    const ep = idOf("SELECT id FROM plan_epics WHERE program = 'prog-a'");
    const cp = idOf('SELECT id FROM plan_checkpoints');
    const tk = idOf("SELECT id FROM plan_tickets WHERE program = 'prog-a'");
    const kinds = [['programme', rid], ['epic', ep], ['checkpoint', cp], ['ticket', tk]] as const;
    for (const [kind, id] of kinds) expect(dueKeyOfBinding(db, ensurePending(db, kind, id, 'ws-a', null).id), kind).toBe('prog-a');
    const up = db.prepare("INSERT INTO plan_epics (program, project, waves, key, ordinal, title, summary, state) VALUES (NULL, 'project-a', '[]', 'upkeep', 0, 'Upkeep', '', 'active')").run();
    const upBinding = ensurePending(db, 'epic', Number(up.lastInsertRowid), 'ws-a', null);
    expect(dueKeyOfBinding(db, upBinding.id)).toBe('upkeep:project-a');
    expect(dueKeyOfBinding(db, 99999)).toBeNull();
    expect(typeof planStorePort(db).dueKeyOfBinding).toBe('function');
  });
});


// ── The Upkeep epic and the inbound ticket (D-8183, Task 4.3) ──

describe('the Upkeep epic (D-8183)', () => {
  const dueKeys = (): string[] => (db.prepare('SELECT program FROM plan_sync_due ORDER BY program').all() as { program: string }[]).map((r) => r.program);
  it('ensureUpkeepEpicInTx inserts the project\'s epic once: no programme, key upkeep, no waves, active, never settled', () => {
    expect(upkeepEpicOf(db, 'project-a')).toBeNull();
    expect(upkeepPlanOf(db, 'project-a')).toEqual({ program: 'upkeep:project-a', planBy: null, required: false, epics: [] });
    const id = tx(db, () => ensureUpkeepEpicInTx(db, 'project-a', 50));
    expect(tx(db, () => ensureUpkeepEpicInTx(db, 'project-a', 60))).toBe(id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM plan_epics WHERE program IS NULL").get()).toEqual({ n: 1 });
    expect(upkeepEpicOf(db, 'project-a')).toMatchObject({
      id, program: null, project: 'project-a', key: UPKEEP_EPIC_KEY, title: UPKEEP_EPIC_TITLE, waves: [], state: 'active', openedAt: 50,
      summary: 'Issues filed in Linear that no programme has taken yet.', checkpoints: [], tickets: [],
    });
    expect(upkeepPlanOf(db, 'project-a').epics.map((e) => e.id)).toEqual([id]);
    expect(upkeepEpicOf(db, 'project-b')).toBeNull();
    tx(db, () => settleEpicInTx(db, id, 70));
    expect(upkeepEpicOf(db, 'project-a')!.state).toBe('active');
  });
  it('inboundTicketInTx makes an inbound task, open, with the reporter text, and marks its due key', () => {
    const epicId = tx(db, () => ensureUpkeepEpicInTx(db, 'project-a', 50));
    const id = tx(db, () => inboundTicketInTx(db, { program: null, epicId, checkpointId: null, key: 'inbound-aaa-12', title: 'Title', body: 'Body', project: 'project-a' }, 51));
    expect(ticketById(db, id)).toMatchObject({ program: null, epicId, key: 'inbound-aaa-12', kind: 'task', source: 'inbound', state: 'open', title: 'Title', body: 'Body', project: 'project-a', runId: null });
    expect(dueKeys()).toEqual(['upkeep:project-a']);
    expect(upkeepEpicOf(db, 'project-a')!.tickets.map((t) => t.id)).toEqual([id]);
  });
  it('adoptIssueBindingInTx binds the ticket at the existing issue with the adopted fingerprint', () => {
    const epicId = tx(db, () => ensureUpkeepEpicInTx(db, 'project-a', 50));
    const id = tx(db, () => inboundTicketInTx(db, { program: null, epicId, checkpointId: null, key: 'inbound-aaa-12', title: 'T', body: '', project: 'project-a' }, 51));
    tx(db, () => adoptIssueBindingInTx(db, id, 'ws-a', 'AAA', 'lin-12', 'AAA-12', 52));
    expect(bindingsOf(db, 'upkeep:project-a').filter((b) => b.localKind === 'ticket')).toEqual([
      expect.objectContaining({ localId: id, workspaceId: 'ws-a', teamKey: 'AAA', linearId: 'lin-12', identifier: 'AAA-12', fingerprint: ADOPTED_FINGERPRINT, state: 'bound', syncedAt: 52 }),
    ]);
    expect(ADOPTED_FINGERPRINT).toBe('adopted');
    expect(upkeepTicketByIdentifier(db, 'ws-a', 'AAA-12')?.id).toBe(id);
    expect(upkeepTicketByIdentifier(db, 'ws-a', 'AAA-99')).toBeNull();
    // keyed by workspace (review 2524 A1): another workspace's identifier is not this one's; no workspace resolves only a unique one
    expect(upkeepTicketByIdentifier(db, 'ws-b', 'AAA-12')).toBeNull();
    expect(upkeepTicketByIdentifier(db, null, 'AAA-12')?.id).toBe(id);
  });
  it('moveTicketToProgrammeInTx changes program, epic and checkpoint in one statement, marks both due keys and settles both epics', () => {
    declare('prog-a');
    const target = (db.prepare("SELECT id FROM plan_epics WHERE program = 'prog-a'").get() as { id: number }).id;
    const cp = (db.prepare('SELECT id FROM plan_checkpoints').get() as { id: number }).id;
    const up = tx(db, () => ensureUpkeepEpicInTx(db, 'project-a', 50));
    const id = tx(db, () => inboundTicketInTx(db, { program: null, epicId: up, checkpointId: null, key: 'inbound-aaa-12', title: 'T', body: '', project: 'project-a' }, 51));
    db.prepare('DELETE FROM plan_sync_due').run();
    // the target epic is settled done while its other ticket is done: moving an open ticket in does not close it, and a done epic would reopen on a run, not here
    tx(db, () => moveTicketToProgrammeInTx(db, id, 'prog-a', target, cp, 60));
    expect(ticketById(db, id)).toMatchObject({ program: 'prog-a', epicId: target, checkpointId: cp, source: 'inbound' });
    expect(dueKeys()).toEqual(['prog-a', 'upkeep:project-a']);
    expect(upkeepEpicOf(db, 'project-a')!.tickets).toEqual([]);
    expect(planOf(db, 'prog-a').epics[0]!.tickets.map((t) => t.key)).toEqual(['t1', 'inbound-aaa-12']);
    expect(upkeepEpicOf(db, 'project-a')!.state).toBe('active');
  });
  it('a ticket moved out of a finished epic does not leave it half done, and a source epic with nothing open settles', () => {
    declare('prog-a');
    const e1 = (db.prepare("SELECT id FROM plan_epics WHERE program = 'prog-a'").get() as { id: number }).id;
    applyPlanChanges(db, 'prog-a', changes({ epics: { insert: [epicIn('e2', [2], 1)], update: [], drop: [] } }), 'coord-a', 11, null);
    const e2 = (db.prepare("SELECT id FROM plan_epics WHERE program = 'prog-a' AND key = 'e2'").get() as { id: number }).id;
    const t = ticketById(db, (db.prepare("SELECT id FROM plan_tickets WHERE key = 't1'").get() as { id: number }).id)!;
    // e1 has c1 (open) and t1: meet c1 and finish t1, leaving only an inbound ticket open in e1
    db.prepare("UPDATE plan_checkpoints SET state = 'met' WHERE epicId = ?").run(e1);
    const extra = tx(db, () => inboundTicketInTx(db, { program: 'prog-a', epicId: e1, checkpointId: null, key: 'inbound-aaa-13', title: 'T', body: '', project: 'project-a' }, 12));
    db.prepare("UPDATE plan_tickets SET state = 'done' WHERE id = ?").run(t.id);
    expect(planOf(db, 'prog-a').epics.find((e) => e.id === e1)!.state).toBe('planned');
    tx(db, () => moveTicketToProgrammeInTx(db, extra, 'prog-a', e2, null, 13));
    expect(planOf(db, 'prog-a').epics.find((e) => e.id === e1)!.state).toBe('done');
  });
  it('the composites are one transaction each: place in Upkeep, take an inbound row into an epic, take an Upkeep ticket', () => {
    upsertInbound(db, inboundIn('L12', { identifier: 'AAA-12', title: 'Reporter title', body: 'Reporter body' }));
    const placed = placeInboundInUpkeep(db, { linearId: 'L12', project: 'project-a', now: 70 });
    expect(placed).toMatchObject({ ok: true });
    expect(inboundOf(db, 'L12')!.state).toBe('placed');
    const t = upkeepTicketByIdentifier(db, 'ws-a', 'AAA-12')!;
    expect(t).toMatchObject({ title: 'Reporter title', body: 'Reporter body', source: 'inbound', key: 'inbound-aaa-12' });
    expect(inboundByIdentifier(db, 'ws-a', 'AAA-12')?.linearId).toBe('L12');
    expect(inboundByIdentifier(db, 'ws-b', 'AAA-12')).toBeNull();
    expect(inboundByIdentifier(db, null, 'AAA-12')?.linearId).toBe('L12');
    expect(inboundByIdentifier(db, 'ws-a', 'AAA-77')).toBeNull();
    expect(dueKeys()).toContain('upkeep:project-a');
    declare('prog-a');
    const e1 = (db.prepare("SELECT id FROM plan_epics WHERE program = 'prog-a'").get() as { id: number }).id;
    expect(takeUpkeepTicket(db, { ticketId: t.id, program: 'prog-a', epicId: e1, checkpointId: null, now: 80 })).toMatchObject({ ok: true });
    expect(ticketById(db, t.id)!.program).toBe('prog-a');
    upsertInbound(db, inboundIn('L13', { identifier: 'AAA-13', title: 'Second', body: null }));
    setInboundState(db, 'L13', { state: 'handed', handedTo: 'coord-a' });
    expect(takeInboundIntoEpic(db, { linearId: 'L13', program: 'prog-a', epicId: e1, checkpointId: null, project: 'project-a', now: 90 })).toMatchObject({ ok: true });
    expect(inboundOf(db, 'L13')!.state).toBe('taken');
    const mine = planOf(db, 'prog-a').epics[0]!.tickets.find((x) => x.key === 'inbound-aaa-13')!;
    expect(mine).toMatchObject({ source: 'inbound', title: 'Second', body: '', kind: 'task', project: 'project-a' });
    expect(bindingsOf(db, 'prog-a').find((b) => b.localKind === 'ticket' && b.localId === mine.id)).toMatchObject({ linearId: 'L13', fingerprint: ADOPTED_FINGERPRINT, identifier: 'AAA-13' });
  });
  it('boundLinearIdsOf lists the workspace\'s bound Linear ids, and upkeepProjectsOf the projects with an Upkeep epic', () => {
    declare('prog-a');
    const ep = (db.prepare("SELECT id FROM plan_epics WHERE program = 'prog-a'").get() as { id: number }).id;
    markBound(db, ensurePending(db, 'epic', ep, 'ws-a', 'AAA').id, 'lin-2', null, 'fp', 5);
    ensurePending(db, 'epic', ep + 100, 'ws-a', 'AAA');                  // pending, no Linear id
    markBound(db, ensurePending(db, 'epic', ep + 101, 'ws-b', 'AAA').id, 'lin-9', null, 'fp', 5);
    markBound(db, ensurePending(db, 'ticket', 7, 'ws-a', 'AAA').id, 'lin-1', 'AAA-1', 'fp', 5);
    expect(boundLinearIdsOf(db, 'ws-a')).toEqual(['lin-1', 'lin-2']);
    expect(boundLinearIdsOf(db, 'ws-none')).toEqual([]);
    expect(upkeepProjectsOf(db)).toEqual([]);
    tx(db, () => { ensureUpkeepEpicInTx(db, 'project-b', 1); ensureUpkeepEpicInTx(db, 'project-a', 1); });
    expect(upkeepProjectsOf(db)).toEqual(['project-a', 'project-b']);
  });
  it('inTransaction runs its function in one transaction and rolls it back when it throws', () => {
    const port = planStorePort(db);
    upsertInbound(db, inboundIn('L12'));
    expect(() => port.inTransaction(() => { port.setInboundState('L12', { state: 'handed', handedTo: 'prog-a' }); throw new Error('mail failed'); })).toThrow('mail failed');
    expect(inboundOf(db, 'L12')!.state).toBe('waiting');
    expect(port.inTransaction(() => { port.setInboundState('L12', { state: 'handed', handedTo: 'prog-a' }); return 7; })).toBe(7);
    expect(inboundOf(db, 'L12')).toMatchObject({ state: 'handed', handedTo: 'prog-a' });
  });
  it('a composite that fails half way leaves nothing behind', () => {
    upsertInbound(db, inboundIn('L12', { identifier: 'AAA-12' }));
    declare('prog-a');
    const e1 = (db.prepare("SELECT id FROM plan_epics WHERE program = 'prog-a'").get() as { id: number }).id;
    // an existing ticket with the derived key makes the insert fail on UNIQUE(program, key), after the state would have changed
    insertTicket(db, tkIn('e1', 'inbound-aaa-12'), 5);
    expect(() => takeInboundIntoEpic(db, { linearId: 'L12', program: 'prog-a', epicId: e1, checkpointId: null, project: 'project-a', now: 9 })).toThrow();
    expect(inboundOf(db, 'L12')!.state).toBe('waiting');
    expect(bindingsOf(db, 'prog-a').filter((b) => b.linearId === 'L12')).toEqual([]);
  });
  it('every new function joins the port', () => {
    const port = planStorePort(db) as unknown as Record<string, unknown>;
    for (const f of ['inTransaction', 'boundLinearIdsOf', 'upkeepProjectsOf', 'upkeepEpicOf', 'upkeepPlanOf', 'ensureUpkeepEpicInTx', 'inboundTicketInTx', 'adoptIssueBindingInTx', 'moveTicketToProgrammeInTx',
      'inboundByIdentifier', 'handedInboundByIdentifier', 'bindingsInWorkspace', 'upkeepTicketByIdentifier', 'placeInboundInUpkeep', 'takeInboundIntoEpic', 'takeUpkeepTicket']) {
      expect(typeof port[f], f).toBe('function');
    }
  });
});

describe('the one retire of an inbound row (review 2457 F4, A6; D-8735)', () => {
  const note = { kind: 'returned', program: 'prog-a', note: 'not mine', at: 9 } as const;

  it('writes the state and its cause and deletes the row\'s note in one act, whatever the cause', () => {
    for (const why of ['completed', 'canceled', 'ccrc-own', 'moved-out'] as const) {
      upsertInbound(db, inboundIn(`L-${why}`));
      setInboundNote(db, `L-${why}`, note);
      expect(retireInbound(db, `L-${why}`, why)).toBe(true);
      expect(inboundOf(db, `L-${why}`)).toMatchObject({ state: 'retired', retiredWhy: why });
      expect(inboundNoteOf(db, `L-${why}`), why).toBeNull();
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM linear_inbound_notes').get()).toEqual({ n: 0 });
  });

  it('leaves a row that may not be retired as it is: taken, placed, an acted close, a retired row, and no row at all', () => {
    for (const [id, patch] of [
      ['L-taken', { state: 'taken' }], ['L-placed', { state: 'placed' }], ['L-acted', { state: 'closed', reason: 'r', actedAt: 4 }],
      ['L-retired', { state: 'retired', retiredWhy: 'completed' }],
    ] as const) {
      upsertInbound(db, inboundIn(id));
      setInboundState(db, id, patch);
      setInboundNote(db, id, note);
      expect(retireInbound(db, id, 'moved-out'), id).toBe(false);
      expect(inboundOf(db, id)!.state, id).toBe(patch.state);
      expect(inboundOf(db, id)!.retiredWhy, id).toBe('retiredWhy' in patch ? patch.retiredWhy : null);
      expect(inboundNoteOf(db, id), id).not.toBeNull();
    }
    expect(retireInbound(db, 'nope', 'moved-out')).toBe(false);
    // an unacted close, a raised and a handed row are retirable
    for (const [id, patch] of [['L-closed', { state: 'closed', reason: 'r' }], ['L-raised', { state: 'raised' }], ['L-handed', { state: 'handed', handedTo: 'prog-a' }]] as const) {
      upsertInbound(db, inboundIn(id));
      setInboundState(db, id, patch);
      expect(retireInbound(db, id, 'moved-out'), id).toBe(true);
    }
  });

  it('the InTx form opens no transaction of its own: a caller that holds one writes through it, and a rollback undoes it', () => {
    upsertInbound(db, inboundIn('L1'));
    setInboundNote(db, 'L1', note);
    expect(() => tx(db, () => { retireInboundInTx(db, 'L1', 'completed'); throw new Error('stop'); })).toThrow('stop');
    expect(inboundOf(db, 'L1')).toMatchObject({ state: 'waiting', retiredWhy: null });
    expect(inboundNoteOf(db, 'L1')).not.toBeNull();
  });

  it('an unknown stored cause reads as null, never as a cause, and a reopen clears it', () => {
    upsertInbound(db, inboundIn('L1'));
    db.prepare("UPDATE linear_inbound SET state = 'retired', retiredWhy = 'a-newer-word' WHERE linearId = 'L1'").run();
    expect(inboundOf(db, 'L1')).toMatchObject({ state: 'retired', retiredWhy: null });
    retireInbound(db, 'L1', 'completed');     // already retired: left as it is
    setInboundState(db, 'L1', { state: 'waiting', retiredWhy: null });
    expect(db.prepare("SELECT retiredWhy FROM linear_inbound WHERE linearId = 'L1'").get()).toEqual({ retiredWhy: null });
  });

  it('a reopened note carries the cause the row was retired with, or none (review 2524 A4)', () => {
    for (const was of ['completed', 'canceled', 'ccrc-own', 'moved-out', null] as const) {
      setInboundNote(db, 'L-r', { kind: 'reopened', at: 9, was });
      expect(inboundNoteOf(db, 'L-r'), String(was)).toEqual({ kind: 'reopened', at: 9, was });
    }
    // an unknown stored word reads as no cause, never as one
    db.prepare("UPDATE linear_inbound_notes SET note = 'a-newer-word' WHERE linearId = 'L-r'").run();
    expect(inboundNoteOf(db, 'L-r')).toEqual({ kind: 'reopened', at: 9, was: null });
  });

  it('the port carries both forms', () => {
    const port = planStorePort(db);
    expect(typeof port.retireInbound).toBe('function');
    expect(typeof port.retireInboundInTx).toBe('function');
  });
});

describe('a row\'s note lives only while its row is waiting (round 4 F2)', () => {
  const note = { kind: 'returned', program: 'prog-a', note: 'not mine', at: 9 } as const;
  const fresh = (id: string) => { upsertInbound(db, inboundIn(id)); setInboundNote(db, id, note); };

  it('setInboundState to any state but waiting deletes the note', () => {
    for (const state of ['mailed', 'handed', 'closed', 'raised', 'placed', 'taken', 'retired'] as const) {
      fresh(`L-${state}`);
      setInboundState(db, `L-${state}`, { state });
      expect(inboundNoteOf(db, `L-${state}`), state).toBeNull();
    }
  });

  it('a patch with no state, or with state waiting, keeps the note', () => {
    fresh('L1');
    setInboundState(db, 'L1', { actedAt: 5 });
    setInboundState(db, 'L1', { state: 'waiting', mailedTo: null });
    expect(inboundNoteOf(db, 'L1')).toEqual(note);
  });

  it('inside the caller\'s transaction the delete is the same transaction: a rollback keeps the note and the state', () => {
    fresh('L1');
    expect(() => tx(db, () => { setInboundState(db, 'L1', { state: 'placed' }); throw new Error('stop'); })).toThrow('stop');
    expect(inboundOf(db, 'L1')!.state).toBe('waiting');
    expect(inboundNoteOf(db, 'L1')).toEqual(note);
  });
});

describe('review 2892 fix round 1 (D-8186)', () => {
  it('F9: ticketOfRun, the one reader of a run\'s ticket, leaves out a ticket put back', () => {
    declare();
    const runId = openWork().id;
    const e = planOf(db, 'prog-a').epics[0]!;
    const t = e.tickets[0]!;
    tx(db, () => attachTicketInTx(db, runId, { kind: 'existing', id: t.id, epicId: e.id, reproject: null }, 20));
    expect(ticketOfRun(db, runId)).toEqual({ ticketId: t.id, key: 't1' });
    dropPutBack(db, { epics: [], checkpoints: [], tickets: [t.id] }, 30);
    expect(ticketById(db, t.id)!.putBackAt).not.toBeNull();
    expect(ticketOfRun(db, runId)).toEqual({ ticketId: null, key: null });
  });

  it('F1: a coordinator\'s first plan write takes over a plan the migration declared; nothing else rewrites planBy', () => {
    applyPlanChanges(db, 'prog-m', changes({ epics: { insert: [epicIn('em', [])], update: [], drop: [] } }), MIGRATION_PLAN_BY, 10, { home: 'project-a', title: 'M' });
    expect(planOf(db, 'prog-m').planBy).toBe(MIGRATION_PLAN_BY);
    applyPlanChanges(db, 'prog-m', changes({ epics: { insert: [epicIn('em2', [], 1)], update: [], drop: [] } }), MIGRATION_PLAN_BY, 11, null);
    expect(planOf(db, 'prog-m').planBy).toBe(MIGRATION_PLAN_BY);          // a follow-up map's own write keeps it the map's
    applyPlanChanges(db, 'prog-m', changes({ epics: { insert: [epicIn('ec', [2], 2)], update: [], drop: [] } }), 'coord-m', 12, null);
    expect(planOf(db, 'prog-m').planBy).toBe('coord-m');
    applyPlanChanges(db, 'prog-m', changes({ epics: { insert: [epicIn('em3', [], 3)], update: [], drop: [] } }), MIGRATION_PLAN_BY, 13, null);
    applyPlanChanges(db, 'prog-m', changes({ epics: { insert: [epicIn('ec2', [3], 4)], update: [], drop: [] } }), 'coord-x', 14, null);
    expect(planOf(db, 'prog-m').planBy).toBe('coord-m');                   // a coordinator's plan stays theirs
  });

  it('F5: a retired binding keeps its row and holds its issue for no reader: plan-owned, inbound, the drift pass, the map', () => {
    declare();
    const t = planOf(db, 'prog-a').epics[0]!.tickets[0]!;
    const port = planStorePort(db);
    const b = port.ensurePending('ticket', t.id, 'ws-a', 'AAA');
    port.markBound(b.id, 'lin-9', 'AAA-9', 'fp', 10);
    expect(issueBound(db, 'ws-a', { id: 'lin-9', identifier: null })).toBe(true);
    tx(db, () => retireBindingInTx(db, b.id));
    expect(db.prepare('SELECT state, linearId, identifier FROM linear_bindings WHERE id = ?').get(b.id)).toEqual({ state: 'retired', linearId: 'lin-9', identifier: 'AAA-9' });
    expect(issueBound(db, 'ws-a', { id: 'lin-9', identifier: 'AAA-9' })).toBe(false);
    expect(bindingByLinearId(db, 'ws-a', 'lin-9')).toBeNull();
    expect(boundLinearIdsOf(db, 'ws-a')).not.toContain('lin-9');
    expect(port.bindingsInWorkspace('ws-a').map((x) => x.id)).not.toContain(b.id);
  });
});
