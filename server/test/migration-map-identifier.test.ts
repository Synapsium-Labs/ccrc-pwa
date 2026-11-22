// D-8186 follow-up: `plan map-propose` takes the visible identifier without the issue UUID. The REAL route over the REAL
// `LinearMigration`: an identifier-only entry resolves against the measured open rows, the legacy pair stays accepted, and a
// pair that disagrees, a twice-listed issue or an identifier that is not an open row of the migration is refused at the route.
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerPlanRoutes, type PlanRouteOpts } from '../src/coord/planRoutes.js';
import { applyPlanChanges, NO_PLAN_CHANGES, type NewTicket } from '../src/coord/planStore.js';
import { readLinearStore } from '../src/linear/store.js';
import { NO_SESSION } from '../src/auth/gate.js';
import type { MapEntry } from '../../shared/plan.js';
import { NOT_DESIGNATED_READS } from './otherLanesFixture.js';
import { cleanMigRigs, migRig, ok, OWNER, SLUG, U, type MigRig } from './migrationRig.js';
import { WS } from './linearProxyRig.js';

const TOKEN = 'k'.repeat(64);
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); cleanMigRigs(); });

const target = { programme: SLUG, epic: 'e1', checkpoint: 'c1', ticketKey: 'k1' };
const byIdentifier = (identifier: string, tgt: MapEntry['target'] = target) => ({ identifier, class: 'leaf', target: tgt });
const legacy = (n: number, tgt: MapEntry['target'] = target) => ({ issue: U(100 + n), identifier: `AAA-${n}`, class: 'leaf', target: tgt });

/** A rig with the migration started and the real route over it. */
async function routed(setup: (r: MigRig) => void = (r) => { r.addIssue(1); r.addIssue(2); }) {
  const r = await migRig();
  setup(r);
  const started = r.mig.start('project-a', await r.mig.workspaceOfProject('project-a'));
  if (!started.ok) throw new Error(`start refused: ${started.word}`);
  const app = Fastify();
  const opts: PlanRouteOpts = {
    coord: r.coord, plan: r.plan, serial: (fn) => fn(), mailToken: () => TOKEN, attribute: async () => ({ ok: true }),
    otherLaneReads: NOT_DESIGNATED_READS, sessionAuth: () => NO_SESSION, authEnabled: false,
    readLinearStore: () => readLinearStore(r.ccrcDir), runOfSession: () => null, now: () => r.t.now, presenceOf: () => 'alive',
    migration: r.mig,
  };
  registerPlanRoutes(app, opts);
  await app.ready();
  apps.push(app);
  r.asks.length = 0;
  const post = async (body: unknown) => {
    const res = await app.inject({
      method: 'POST', url: `/api/teams/aaa/plan/map?byId=${OWNER}&byUuid=u-${OWNER}`, payload: body as never, headers: { 'x-ccrc-mail-token': TOKEN },
    });
    return { status: res.statusCode, json: res.json() as { error?: string; detail?: string } };
  };
  return { r, post };
}
const itemsOf = (r: MigRig): unknown[] => r.db.prepare("SELECT id FROM operator_items WHERE action LIKE '%linear-map%'").all();
const stored = (r: MigRig) => { const m = r.plan.migrationsOf()[0]!; return { state: m.state, entries: m.map?.entries ?? null, snapshot: m.map?.snapshot ?? null }; };
const writes = (r: MigRig): string[] => r.asks.map((a) => a.op).filter((op) => op !== 'teamOpenIssues');

describe('plan map-propose by visible identifier (D-8186)', () => {
  it('an identifier-only entry is stored exactly as the legacy pair is, with one item and only the open-issue read', async () => {
    const a = await routed((r) => r.addIssue(1));
    const resA = await a.post({ entries: [byIdentifier('AAA-1')] });
    expect(resA.status).toBe(200);
    expect(itemsOf(a.r)).toHaveLength(1);
    const b = await routed((r) => r.addIssue(1));
    const resB = await b.post({ entries: [legacy(1)] });
    expect(resB.status).toBe(200);
    expect(itemsOf(b.r)).toHaveLength(1);
    expect(stored(a.r)).toEqual(stored(b.r));
    expect(stored(a.r).entries).toEqual([{ issue: U(101), identifier: 'AAA-1', class: 'leaf', target }]);
    expect(Object.keys(stored(a.r).snapshot!)).toEqual([U(101)]);
    expect(a.r.asks.map((x) => x.op)).toEqual(['teamOpenIssues']);
    expect(a.r.asks.map((x) => x.op)).toEqual(b.r.asks.map((x) => x.op));
  });

  it('a lowercase identifier stores the canonical identifier with the row\'s UUID', async () => {
    const { r, post } = await routed((x) => x.addIssue(1));
    expect((await post({ entries: [byIdentifier('aaa-1')] })).status).toBe(200);
    expect(stored(r).entries).toEqual([{ issue: U(101), identifier: 'AAA-1', class: 'leaf', target }]);
  });

  it('a mixed map (one legacy pair, one identifier) is accepted in the order sent', async () => {
    const { r, post } = await routed();
    expect((await post({ entries: [byIdentifier('AAA-2', { ...target, ticketKey: 'k2' }), legacy(1)] })).status).toBe(200);
    expect(stored(r).entries!.map((e) => [e.identifier, e.issue])).toEqual([['AAA-2', U(102)], ['AAA-1', U(101)]]);
  });

  describe('refused at the route: no item, the migration still proposing with no map, and no write', () => {
    const refused = async (setup: ((r: MigRig) => void) | undefined, body: unknown, want: { status: number; error: string; detail: string }) => {
      const { r, post } = await routed(setup);
      const res = await post(body);
      expect(res.status).toBe(want.status);
      expect(res.json.error).toBe(want.error);
      expect(res.json.detail).toBe(want.detail);
      expect(itemsOf(r)).toEqual([]);
      expect(stored(r)).toEqual({ state: 'proposing', entries: null, snapshot: null });
      expect(writes(r)).toEqual([]);
    };
    const covering = [byIdentifier('AAA-1'), byIdentifier('AAA-2', { ...target, ticketKey: 'k2' })];

    it('a pair that disagrees (the UUID of AAA-2 with the identifier AAA-1)', async () => {
      await refused(undefined, { entries: [{ issue: U(102), identifier: 'AAA-1', class: 'leaf', target }, byIdentifier('AAA-2', { ...target, ticketKey: 'k2' })] },
        { status: 400, error: 'plan-bad-body', detail: 'issue-mismatch:AAA-1' });
    });
    it('a pair whose identifier is not open but whose UUID is', async () => {
      await refused(undefined, { entries: [{ issue: U(101), identifier: 'AAA-99', class: 'leaf', target }] },
        { status: 400, error: 'plan-bad-body', detail: 'issue-mismatch:AAA-99' });
    });
    it('one issue listed twice in mixed forms', async () => {
      await refused(undefined, { entries: [legacy(1), byIdentifier('AAA-1', { ...target, ticketKey: 'k9' }), ...covering.slice(1)] },
        { status: 409, error: 'map-incomplete', detail: 'twice:AAA-1' });
    });
    it('an identifier of another team', async () => {
      await refused((r) => { r.addIssue(1); r.addIssue(2); r.addIssue(7, { identifier: 'ZZZ-7', teamKey: 'ZZZ' }); },
        { entries: [...covering, byIdentifier('ZZZ-7')] }, { status: 409, error: 'map-incomplete', detail: 'not-open:ZZZ-7' });
    });
    it('a closed issue', async () => {
      await refused((r) => { r.addIssue(1); r.addIssue(2); r.addIssue(3, { stateType: 'completed' }); },
        { entries: [...covering, byIdentifier('AAA-3')] }, { status: 409, error: 'map-incomplete', detail: 'not-open:AAA-3' });
    });
    it('an identifier no issue ever had', async () => {
      await refused(undefined, { entries: [...covering, byIdentifier('AAA-404')] }, { status: 409, error: 'map-incomplete', detail: 'not-open:AAA-404' });
    });
    it('a URL in the identifier', async () => {
      const url = 'https://tracker.example/issue/AAA-1/some-title';
      await refused(undefined, { entries: [byIdentifier(url), covering[1]] }, { status: 409, error: 'map-incomplete', detail: `not-open:${url}` });
    });
    it('an issue the sync already binds', async () => {
      const { r, post } = await routed((x) => x.addIssue(1));
      const t: NewTicket = { program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key: 'own', kind: 'work', title: 'Our own ticket', body: 'Do it', project: 'project-a', source: 'plan' };
      applyPlanChanges(r.db, SLUG, { ...NO_PLAN_CHANGES(), tickets: { insert: [t], update: [], drop: [] } }, OWNER, r.t.now, null);
      await r.sync.passFor(SLUG, r.t.now + 60_000);
      const bound = r.plan.bindingOf('ticket', r.plan.planOf(SLUG).epics[0]!.tickets[0]!.id, WS.a.id)!;
      r.issues.set(bound.linearId!, { id: bound.linearId!, identifier: 'AAA-50', title: 'Our own ticket', description: 'x', teamKey: 'AAA', stateType: 'unstarted', projectId: null, milestoneId: null, parentId: null });
      r.asks.length = 0;
      const res = await post({ entries: [byIdentifier('AAA-1'), byIdentifier('AAA-50', { ...target, ticketKey: 'k5' })] });
      expect([res.status, res.json.error, res.json.detail]).toEqual([409, 'map-incomplete', 'not-open:AAA-50']);
      expect(itemsOf(r)).toEqual([]);
      expect(stored(r)).toEqual({ state: 'proposing', entries: null, snapshot: null });
      expect(writes(r)).toEqual([]);
    });
    it('an ambiguous measurement (two open nodes with one identifier)', async () => {
      const { r, post } = await routed((x) => { x.addIssue(1); x.addIssue(2); });
      r.override.current = (ask) => {
        if (ask.op !== 'teamOpenIssues') return undefined;
        const nodes = [...r.issues.values()].map((i) => ({ ...i }));
        return ok({ nodes: [...nodes, { ...nodes[0]!, id: U(190) }], next: null });
      };
      const res = await post({ entries: covering });
      expect([res.status, res.json.error, res.json.detail]).toEqual([409, 'map-incomplete', 'ambiguous:AAA-1']);
      expect(itemsOf(r)).toEqual([]);
      expect(stored(r)).toEqual({ state: 'proposing', entries: null, snapshot: null });
      expect(writes(r)).toEqual([]);
    });
    it('a non-string issue', async () => {
      await refused(undefined, { entries: [{ issue: 101, identifier: 'AAA-1', class: 'leaf', target }] },
        { status: 400, error: 'plan-bad-body', detail: "an entry's issue is not a string" });
    });
  });
});
