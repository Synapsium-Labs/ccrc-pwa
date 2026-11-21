// D-8186 (Linear hierarchy plan, wave 7): the shared rig of the migration suites. A real coord.db, the real Linear store on a tmp
// dir, the real `PlanSync` and `LinearMigration`; Linear is faked at the `call` port (as plan-sync.test.ts does) with a small
// issue table, so an `issueUpdate` the sync or the migration sends changes what `teamOpenIssues` and `issueOwned` answer next.
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CoordStore } from '../src/coord/store.js';
import {
  NO_PLAN_CHANGES, applyPlanChanges, migratingLocals, planStorePort, type PlanChanges, type PlanStorePort,
} from '../src/coord/planStore.js';
import type { CcrcOpAsk, CcrcOpOutcome } from '../src/linear/ccrcCall.js';
import type { LinearDirectoryEntries } from '../src/linear/ops.js';
import { LinearMigration, type LinearMigrationDeps } from '../src/linear/migration.js';
import { PlanSync } from '../src/linear/planSync.js';
import { readLinearStore } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import type { MapBody, MapEntry } from '../../shared/plan.js';
import { memCoordDb } from './linearServicesFake.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

export const T = 1_800_000_000_000;
export const U = (n: number): string => `00000000-0006-4000-8000-${String(n).padStart(12, '0')}`;
export const VIEWER = U(900);
export const OWNER = 'coord-a';
export const SLUG = 'prog-a';
export const TEAM_ID = WS.a.teams[0].id;

export const DIRECTORY: LinearDirectoryEntries = {
  viewerId: VIEWER, labels: [], projects: [], users: [], initiatives: 'on',
  states: [
    { id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }, { id: U(22), name: 'Doing', type: 'started', teamKey: 'AAA' },
    { id: U(23), name: 'Done', type: 'completed', teamKey: 'AAA' }, { id: U(24), name: 'Nope', type: 'canceled', teamKey: 'AAA' },
  ],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};

export interface FakeIssue {
  id: string; identifier: string; title: string; description: string; teamKey: string; stateType: string;
  projectId: string | null; milestoneId: string | null; parentId: string | null;
}
export type Override = (ask: CcrcOpAsk, n: number) => CcrcOpOutcome | undefined | Promise<CcrcOpOutcome | undefined>;
export const ok = (value: Record<string, unknown> = {}, created: string | null = null): CcrcOpOutcome => ({ ok: true, value, created });
export const fail = (word: Extract<CcrcOpOutcome, { ok: false; maybeSent: boolean }>['word'], maybeSent = false): CcrcOpOutcome => ({ ok: false, word, maybeSent });

export interface MigRig {
  db: DatabaseSync; coord: CoordStore; plan: PlanStorePort; ccrcDir: string; t: { now: number };
  asks: CcrcOpAsk[]; issues: Map<string, FakeIssue>;
  /** Consulted first for every ask; an answer replaces the fake's. */
  override: { current: Override | null };
  /** Called with every ask before it is answered (to look at the stores at that moment). */
  watch: { current: ((ask: CcrcOpAsk) => void) | null };
  sync: PlanSync; mig: LinearMigration; workspaceId: string;
  /** Another PlanSync-built object counter for created ids. */
  addIssue(n: number, over?: Partial<FakeIssue>): FakeIssue;
  /** A programme row (no plan unless `plan` is true), its state and the runs it holds. */
  addProgramme(slug: string, state: 'active' | 'done' | 'paused', opts?: { home?: string }): void;
  openRun(slug: string, state: string): number;
  /** start + readOpen + storeProposal as the owner; the migration id and the raised item. */
  propose(entries: MapEntry[], extra?: Partial<Pick<MapBody, 'backlog' | 'epics'>>, caller?: string): Promise<{ migrationId: number; itemId: number }>;
  /** propose + approve. */
  approved(entries: MapEntry[], extra?: Partial<Pick<MapBody, 'backlog' | 'epics'>>): Promise<number>;
  /** One lane tick with the clock moved on by `ms`. */
  tick(ms?: number): Promise<void>;
  /** Ticks until `done()` or `max` ticks. */
  until(done: () => boolean, max?: number): Promise<number>;
  opsOf(op: string): CcrcOpAsk[];
  stateOf(id: number): string;
  /** A new `LinearMigration` over the same stores and port: the process restarted. */
  restart(): void;
  /** approved + ticks until `applied`; the migration id. */
  applied(entries: MapEntry[], extra?: Partial<Pick<MapBody, 'backlog' | 'epics'>>): Promise<number>;
}

const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });
export const leaf = (n: number, key?: string, over: Partial<MapEntry['target']> = {}): MapEntry => ({
  issue: U(100 + n), identifier: `AAA-${n}`, class: 'leaf', target: { programme: SLUG, epic: 'e1', checkpoint: 'c1', ...(key === undefined ? {} : { ticketKey: key }), ...over },
});
export const entry = (n: number, cls: MapEntry['class'], target?: MapEntry['target']): MapEntry => ({
  issue: U(100 + n), identifier: `AAA-${n}`, class: cls, ...(target === undefined ? {} : { target }),
});

let dirs: string[] = [];
export function cleanMigRigs(): void {
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } }
  dirs = [];
}

let counter = 5000;
export async function migRig(o: { synced?: boolean } = {}): Promise<MigRig> {
  const dir = mkTmp('ccrc-migration-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  await seedSlot(ccrcDir, 'a');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-a', 'AAA', 'private');
  applyPlanChanges(db, SLUG, changes({
    epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1], ordinal: 0, title: 'Epic one', summary: 'Summary' }], update: [], drop: [] },
    checkpoints: { insert: [{ epicKey: 'e1', key: 'c1', ordinal: 0, title: 'Checkpoint one', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] },
  }), OWNER, T, { home: 'project-a', title: 'Programme A' });
  const plan = planStorePort(db);
  const r = {
    db, coord, plan, ccrcDir, t: { now: T }, asks: [] as CcrcOpAsk[], issues: new Map<string, FakeIssue>(),
    override: { current: null as Override | null }, watch: { current: null as ((ask: CcrcOpAsk) => void) | null }, workspaceId: WS.a.id,
  } as unknown as MigRig;

  const typeOf = (stateId: unknown): string | null => DIRECTORY.states.find((s) => s.id === stateId)?.type ?? null;
  const nodeOf = (i: FakeIssue) => ({ ...i });
  const call = async (ask: CcrcOpAsk): Promise<CcrcOpOutcome> => {
    r.asks.push(ask);
    r.watch.current?.(ask);
    const over = await r.override.current?.(ask, r.asks.length);
    if (over !== undefined) return over;
    const inp = ask.input;
    switch (ask.op) {
      case 'teamOpenIssues': {
        const nodes = [...r.issues.values()].filter((i) => i.teamKey === inp['team'] && i.stateType !== 'completed' && i.stateType !== 'canceled').map(nodeOf);
        return ok({ nodes, next: null });
      }
      case 'issueOwned': {
        const i = r.issues.get(String(inp['id']));
        return i === undefined ? fail('not-found') : ok({ issue: nodeOf(i) });
      }
      case 'issueUpdate': {
        const i = r.issues.get(String(inp['id']));
        if (i === undefined) return fail('not-found');
        if ('stateId' in inp) { const t = typeOf(inp['stateId']); if (t !== null) i.stateType = t; }
        if ('teamId' in inp) i.teamKey = inp['teamId'] === TEAM_ID ? 'AAA' : 'ZZZ';
        if ('projectId' in inp) i.projectId = (inp['projectId'] as string | null) ?? null;
        if ('projectMilestoneId' in inp) i.milestoneId = (inp['projectMilestoneId'] as string | null) ?? null;
        if ('parentId' in inp) i.parentId = (inp['parentId'] as string | null) ?? null;
        if ('title' in inp) i.title = String(inp['title']);
        if ('description' in inp) i.description = String(inp['description'] ?? '');
        return ok({ id: i.id, identifier: i.identifier });
      }
      default:
    }
    if (ask.op.endsWith('Create')) {
      const id = U(counter++);
      return ok(ask.op === 'issueCreate' ? { id, identifier: `AAA-${counter}` } : { id }, id);
    }
    if (ask.op.endsWith('Update')) return ok({ id: ask.target });
    if (ask.op === 'initiativesByName' || ask.op === 'projectsByName') return ok({ nodes: [] });
    if (ask.op === 'issueComment' || ask.op === 'issueRelationCreate') return ok({ id: U(counter++) });
    return fail('not-found');
  };

  r.sync = new PlanSync({
    coord, plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir), migrating: () => migratingLocals(db),
    call,
    directory: { get: () => DIRECTORY, filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
    directoryMiss: () => undefined,
    markSlotRejected: async () => undefined,
    now: () => r.t.now, privateTrackerKeys: [],
  });
  const deps: LinearMigrationDeps = {
    coord, plan, planSync: r.sync, readLinearStore: () => readLinearStore(ccrcDir), call,
    directory: { get: () => DIRECTORY, filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
    presenceOf: () => 'alive', now: () => r.t.now,
  };
  r.mig = new LinearMigration(deps);
  r.restart = () => { r.mig = new LinearMigration(deps); };

  r.addIssue = (n, over = {}) => {
    const i: FakeIssue = {
      id: U(100 + n), identifier: `AAA-${n}`, title: `Issue ${n}`, description: `Body ${n}`, teamKey: 'AAA', stateType: 'unstarted',
      projectId: null, milestoneId: null, parentId: null, ...over,
    };
    r.issues.set(i.id, i);
    return i;
  };
  r.addProgramme = (slug, state, opts = {}) => {
    db.prepare('INSERT INTO programs (slug, title, createdAt, state, homeProject) VALUES (?, ?, ?, ?, ?)').run(slug, `Programme ${slug}`, T, state, opts.home ?? 'project-a');
  };
  r.openRun = (slug, state) => Number(db.prepare(
    "INSERT INTO runs (program, wave, project, state, kind, openedAt) VALUES (?, 1, 'project-a', ?, 'work', ?)",
  ).run(slug, state, T).lastInsertRowid);
  r.propose = async (entries, extra = {}, caller = OWNER) => {
    const started = r.mig.start('project-a', { ok: true, workspaceId: WS.a.id });
    if (!started.ok) throw new Error(`start refused: ${started.word}`);
    const open = await r.mig.readOpen('AAA', WS.a.id);
    if (!open.ok) throw new Error(`readOpen refused: ${open.detail}`);
    const stored = r.mig.storeProposal('AAA', caller, { entries, ...extra }, open);
    if (!stored.ok) throw new Error(`storeProposal refused: ${stored.word} ${stored.detail}`);
    const m = plan.migrationById(stored.migrationId)!;
    return { migrationId: m.id, itemId: m.itemId! };
  };
  r.approved = async (entries, extra = {}) => {
    const { migrationId, itemId } = await r.propose(entries, extra);
    const a = r.mig.act(itemId, migrationId, 'approve', null);
    if (!a.ok) throw new Error(`approve refused: ${a.word}`);
    return migrationId;
  };
  r.tick = async (ms = 31_000) => { r.t.now += ms; await r.mig.tick(); };
  r.until = async (done, max = 40) => {
    let n = 0;
    while (!done() && n < max) { n += 1; await r.tick(); }
    return n;
  };
  r.applied = async (entries, extra = {}) => {
    const id = await r.approved(entries, extra);
    await r.until(() => r.stateOf(id) === 'applied');
    if (r.stateOf(id) !== 'applied') throw new Error(`the migration stands ${r.stateOf(id)}`);
    return id;
  };
  r.opsOf = (op) => r.asks.filter((a) => a.op === op);
  r.stateOf = (id) => plan.migrationById(id)!.state;

  if (o.synced !== false) {
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    r.asks.length = 0;
  }
  return r;
}

export const digestOfFixtureKey = (): string => valueDigestHex(WS.a.key);
