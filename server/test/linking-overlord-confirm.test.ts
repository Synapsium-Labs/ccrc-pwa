// Linear hierarchy wave 8, D-8809 (Task 8.5): `POST /api/linking/confirm`, the Overlord's confirm of one current team candidate
// for a project with no key, through the REAL gate runner (`overlordGateRun`, every step of the order: attribution, the
// designation, the server word, the authority guard, the operator's rung, the term, the act key, generation and counter over a
// real fixture coord.db, the witness, the card read, the generation and the rung), as `overlord-gate-run.test.ts` stands it up.
// The link and its call are written in one transaction; the call is a big call under `linear-sync` that names the team and
// the workspace by NAME, never by key. Fixture names only: teams `AAA`/`BBB`, projects `project-a`, sessions `lane-a`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { overlordGateRun, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { actKeyFact, advanceCounterGuarded, recordFenceRefusal } from '../src/coord/overlordGateStore.js';
import { registerLinkingRoutes } from '../src/linking/routes.js';
import { Bus } from '../src/bus.js';
import type { NoticeSink } from '../src/notice.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import type { Rung } from '../../shared/overlord-ladder.js';
import type { TeamCandidateWire } from '../../shared/linking.js';
import { ACT_COUNTER_HEADER, ACT_GENERATION_HEADER, ACT_KEY_HEADER, WITNESS_KEY_HEADER } from '../../shared/continuity-door.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { readLinearStore, type LinearStoreRead } from '../src/linear/store.js';
import { seedSlot, WS } from './linearProxyRig.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'a'.repeat(64);
const BODY = 'lane-a-overlord';            // the Overlord's session id
const COORDINATOR = 'lane-b-project-a';    // another coordinator
const INC = 'inc-1';
// The candidates' workspaces are the fixture slots' (`linearProxyRig.ts`): the confirm re-checks the pair in the live store.
const WS_A = WS.a.id;
const WS_B = WS.b.id;
const DESIGNATED = {
  kind: 'designated', sessionId: BODY, term: 1,
  row: { bound: { sessionId: BODY, generation: INC }, pending: null, term: 1, designatedTerm: 1 },
} as unknown as DesignationRead;
const MEASURED = { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: 100 } as const;
const ALPHA: TeamCandidateWire = { key: 'AAA', name: 'Alpha Team', evidence: { kind: 'ticket-ids', ids: 9, of: 10 }, workspaceId: WS_A, workspaceName: 'Workspace A' };
const BETA: TeamCandidateWire = { key: 'BBB', name: 'Beta Team', evidence: { kind: 'name-match', matched: 'repo', on: 'name' }, workspaceId: WS_B, workspaceName: 'Workspace B' };

let s: CoordStore;
let seq = 0;
beforeAll(() => { s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-link-confirm-'), '.ccrc', 'coord.db'))); });
afterAll(removeTmpFixtures);
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  s.db.exec('DELETE FROM project_linking; DELETE FROM coordinator_calls; DELETE FROM overlord_fence_refusals');
});

/** Mint the Overlord identity's next generation with its own act key (the gate-run rig's `fresh`), serving (`active`). */
function fresh(): { gen: GenRow; key: string } {
  seq += 1;
  const key = createHash('sha256').update(`key-${seq}`).digest('hex');
  const r0 = s.insertStart({ sessionId: BODY, reportId: `rr-${seq}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: NOW + seq, receivedAt: NOW + seq, doorNonceSha256: null });
  if (!r0.ok) throw new Error('start not recorded');
  const live = s.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((g) => g.identity === 'overlord');
  const mint: MintInput = { identity: 'overlord', sessionId: BODY, role: 'coordinator', term: 1, rowIncarnation: null, startId: r0.id,
    startReportedAt: NOW + seq, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000 + seq,
    proc: `p${seq}`, now: NOW };
  const m = s.mintGeneration(mint, old === undefined ? null : genExpectOf(old), true);
  if (!m.ok) throw new Error('not minted');
  // A live mint starts at `carded`; this door's order reads step 9, so the fixture stands the generation where it serves
  // (`active`), as the walk leaves it once the card and the probe are done.
  s.db.prepare("UPDATE continuity_generations SET state = 'active', deadlineAt = NULL WHERE id = ?").run(m.id);
  const after = s.liveGenerations();
  if (!after.ok) throw new Error(after.detail);
  const gen = after.rows.find((g) => g.id === m.id)!;
  const issued = issueActKey(s.db, { generationId: gen.id, nonceSha256: createHash('sha256').update(`n-${seq}`).digest('hex'),
    keySha256: createHash('sha256').update(key, 'utf8').digest('hex'), issuedAt: NOW });
  if (!issued.ok) throw new Error('key not issued');
  return { gen, key };
}

interface Rig { app: FastifyInstance; notices: Array<{ title: string; body: string; mode: string }>; waiting: () => number; act: () => Record<string, string> }
/** The live Linear store the confirm re-reads (final review I3): `both` ws-a holding AAA and ws-b BBB; `shared` ws-b holding AAA
 *  too; `lost-a` only ws-b (ws-a's slot is gone); `throw` and `unreadable` a store that cannot be read. */
type Linear = 'both' | 'shared' | 'lost-a' | 'throw' | 'unreadable';
async function linearOf(kind: Linear): Promise<() => Promise<LinearStoreRead>> {
  if (kind === 'throw') return async () => { throw new Error('the store is gone'); };
  if (kind === 'unreadable') return async () => ({ kind: 'unreadable', code: 'EIO' }) as LinearStoreRead;
  const ccrcDir = path.join(mkTmp('ccrc-link-confirm-linear-'), '.ccrc');
  if (kind !== 'lost-a') await seedSlot(ccrcDir, 'a');
  await seedSlot(ccrcDir, 'b', kind === 'shared' ? { teams: [...WS.b.teams, { id: 'bbbbbbbb-1111-4000-8000-0000000000b2', key: 'AAA', name: 'Team A' }] } : {});
  return () => readLinearStore(ccrcDir);
}

/** The door over the real gate runner; `rung` is the effective rung the ladder port reads, `card` the card read. */
async function rig(over: { rung?: Rung; card?: 'current' | 'none'; linear?: Linear } = {}): Promise<Rig> {
  const { gen, key } = fresh();
  let counter = 0;
  const deps: OverlordGateDeps = {
    identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: INC }) as never,
    },
    designation: () => DESIGNATED,
    authority: () => ({ kind: 'coherent' }),
    ladder: () => ({ kind: 'read', rung: { rung: over.rung ?? 'full', operatorRung: over.rung ?? 'full', binding: [], readBy: [] } }),
    generations: () => s.liveGenerations(),
    continuityLive: () => true,
    cardRead: () => ({ ok: true, read: over.card === 'none' ? null : ({ current: true } as never) }),
    actKey: (g, k) => actKeyFact(s.db, g, k),
    counter: (g, c) => advanceCounterGuarded(s.db, g, c),
    witness: () => ({ kind: 'witnessed', witnessId: 7 }),
    recordWitness: () => true,
    recordFenceRefusal: (r) => { recordFenceRefusal(s.db, r); },
    serverWords: () => ['overlord-v1'],
    now: () => NOW,
  };
  const notices: Rig['notices'] = [];
  const notice: NoticeSink = (e, mode) => { notices.push({ title: e.title ?? '', body: e.body ?? '', mode }); return { ok: true } as never; };
  const bus = new Bus();
  let waiting = 0;
  bus.on('waiting', () => { waiting += 1; });
  const app = Fastify({ logger: false });
  apps.push(app);
  registerLinkingRoutes(app, {
    coord: s, by: () => 'device-a', now: () => NOW, mailToken: () => TOKEN, gate: overlordGateRun(deps), notice, bus, build: 'v-test',
    readLinearStore: await linearOf(over.linear ?? 'both'),
  });
  await app.ready();
  return {
    app, notices, waiting: () => waiting,
    act: () => {
      counter += 1;
      return { [ACT_KEY_HEADER]: key, [ACT_GENERATION_HEADER]: String(gen.n), [ACT_COUNTER_HEADER]: String(counter), [WITNESS_KEY_HEADER]: 'w-1' };
    },
  };
}

const confirm = (r: Rig, body: Record<string, unknown>, who = BODY): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url: '/api/linking/confirm', headers: { 'x-ccrc-mail-token': TOKEN, ...r.act() },
    payload: { byId: who, byUuid: 'u-1', project: 'project-a', team: 'AAA', workspace: WS_A, ...body } });
/** A listed project with no key and the pass's two candidates. */
const seed = (project = 'project-a'): void => {
  s.recordLinkingReading(project, MEASURED);
  s.recordTeamCandidates(project, [ALPHA, BETA]);
};
const callCount = (): number => (s.db.prepare('SELECT COUNT(*) AS n FROM coordinator_calls').get() as { n: number }).n;
const refused = (res: LightMyRequestResponse, word: string): void => {
  expect(res.json()).toMatchObject({ ok: false, error: word });
  expect(res.statusCode).toBe(REFUSAL_STATUS[word as keyof typeof REFUSAL_STATUS]);
};
const unlinked = (): void => {
  expect(s.linkingOf('project-a')).toMatchObject({ teamKey: null });
  expect(callCount()).toBe(0);
};

describe('POST /api/linking/confirm (D-8809)', () => {
  it("the Overlord's confirm links and records a call", async () => {
    const r = await rig();
    seed();
    const res = await confirm(r, {});
    expect(res.statusCode).toBe(200);
    const body = res.json() as { callId: number };
    expect(body).toEqual({
      ok: true, project: 'project-a', callId: expect.any(Number),
      link: { key: 'AAA', teamName: 'Alpha Team', workspaceId: WS_A, workspaceName: 'Workspace A', evidence: ALPHA.evidence },
    });
    // The link: the Overlord's, stored as auto beside the call's id, its workspace written, the candidates cleared.
    expect(s.linkingOf('project-a')).toMatchObject({
      teamKey: 'AAA', teamWorkspace: WS_A, teamCandidates: [],
      teamLink: { source: 'overlord', teamName: 'Alpha Team', evidence: ALPHA.evidence, at: NOW, callId: body.callId },
    });
    expect({ ...s.db.prepare("SELECT teamSource, teamCallId FROM project_linking WHERE project = 'project-a'").get() }).toEqual({ teamSource: 'auto', teamCallId: body.callId });
    // Exactly one call, under linear-sync, made by the Overlord, big and reversible, in "calls made for you".
    expect(callCount()).toBe(1);
    const call = s.callById(body.callId)!;
    expect(call).toMatchObject({ program: 'linear-sync', madeBy: BODY, class: 'big', reversible: true, runId: null, build: 'v-test' });
    expect(s.callsForOperator(NOW).open.map((c) => c.id)).toEqual([body.callId]);
    // Its text names the project, the team and the workspace by NAME, and the evidence, never a team key.
    const text = JSON.stringify([call.question, call.options, call.chosen, call.why]);
    expect(call.question).toContain('project-a');
    expect(call.chosen).toBe('Alpha Team in Workspace A');
    expect(call.options).toEqual(['Alpha Team in Workspace A', 'Beta Team in Workspace B', 'Leave project-a unlinked']);
    expect(call.why).toContain("9 of 10 ticket ids in its branches, pull requests and commits use this team's key");
    // The words the server writes name no key. ITS LIMIT: a coordinator's suggested reason is that coordinator's own text,
    // already refused for ticket ids and private names (`suggestionReasonVerdict`) when it was suggested, and the call shows
    // it as written; a reason that spells a team key is not caught here.
    expect(text).not.toMatch(/\bAAA\b|\bBBB\b/);
    // Announced as the call record's route announces a big call: one record-only notice and the waiting rebuild.
    expect(r.notices).toEqual([{ title: 'Call made · linear-sync', body: `${call.question} → ${call.chosen}`, mode: 'record-only' }]);
    expect(r.waiting()).toBe(1);
  });

  it('the answer is the link and the call only: no slug, override, visibility or other candidate', async () => {
    const r = await rig();
    seed();
    const res = await confirm(r, {});
    expect(Object.keys(res.json()).sort()).toEqual(['callId', 'link', 'ok', 'project']);
    expect(Object.keys(res.json().link).sort()).toEqual(['evidence', 'key', 'teamName', 'workspaceId', 'workspaceName']);
    for (const leak of ['owner/repo', 'override', 'visibility', 'mode', 'BBB', 'Beta Team', 'teamCandidates']) expect(res.body).not.toContain(leak);
  });

  it('a manual key refuses it', async () => {
    const r = await rig();
    seed();
    // The operator set a key and then cleared it: decided, so neither the pass nor the Overlord links it.
    s.setLinking('project-a', { teamKey: 'BBB', override: null }, 'device-a', NOW - 2);
    s.setLinking('project-a', { teamKey: null, override: null }, 'device-a', NOW - 1);
    s.recordTeamCandidates('project-a', [ALPHA]);
    refused(await confirm(r, {}), 'team-set');
    expect(s.linkingOf('project-a').teamLink).toEqual({ source: 'manual', at: NOW - 1 });
    unlinked();
    expect(r.notices).toEqual([]);
  });

  it("another coordinator's confirm is refused", async () => {
    const r = await rig();
    seed();
    refused(await confirm(r, {}, COORDINATOR), 'not-the-overlord');
    unlinked();
    expect(s.linkingOf('project-a').teamCandidates).toHaveLength(2);
  });

  it('a confirm below full is refused rung-below and links nothing', async () => {
    for (const rung of ['chat', 'advise'] as const) {
      const r = await rig({ rung });
      seed();
      const res = await confirm(r, {});
      refused(res, 'rung-below');
      expect(res.json().step).toBe('10');
      unlinked();
    }
  });

  it('the door runs the card step: a generation that has not read its card is refused card-unread', async () => {
    const r = await rig({ card: 'none' });
    seed();
    refused(await confirm(r, {}), 'card-unread');
    unlinked();
  });

  it('a project with a key already set links nothing', async () => {
    const r = await rig();
    seed();
    s.linkTeamAuto('project-a', { key: 'BBB', name: 'Beta Team', evidence: BETA.evidence, workspace: WS_B }, NOW - 5);
    refused(await confirm(r, {}), 'team-set');
    expect(s.linkingOf('project-a')).toMatchObject({ teamKey: 'BBB', teamLink: { source: 'auto' } });
    expect(callCount()).toBe(0);
  });

  it('a pair that is not a current candidate is team-unknown', async () => {
    const r = await rig();
    seed();
    for (const body of [{ team: 'AAA', workspace: WS_B }, { team: 'CCC' }, { team: 'AAA', workspace: null }]) {
      refused(await confirm(r, body), 'team-unknown');
    }
    unlinked();
  });

  it("a coordinator's suggestion is a candidate the Overlord may confirm; one stored without a workspace links with the one slot that holds its key", async () => {
    const r = await rig();
    s.recordLinkingReading('project-a', MEASURED);
    expect(s.recordTeamSuggestion('project-a', { by: 'lane-c', key: 'BBB', workspaceId: null, workspaceName: null, teamName: 'Beta Team', why: 'the branches say so', at: 1 })).toBe('written');
    const res = await confirm(r, { team: 'BBB', workspace: null });
    expect(res.statusCode).toBe(200);
    // The routed slot's workspace is stored, never the candidate's null: a later operator Save of the same key sends that
    // slot's id, which must not read as a pair change (D-8809).
    expect(res.json().link).toEqual({ key: 'BBB', teamName: 'Beta Team', workspaceId: WS_B, workspaceName: 'Workspace B', evidence: { kind: 'suggested', by: 'lane-c', why: 'the branches say so' } });
    const call = s.callById(res.json().callId)!;
    expect(call.chosen).toBe('Beta Team');
    expect(call.why).toContain('suggested by lane-c: the branches say so');
    expect(s.linkingOf('project-a')).toMatchObject({ teamKey: 'BBB', teamWorkspace: WS_B, teamLink: { source: 'overlord' } });
  });

  it('a slot that no longer holds the pair is team-unknown: no link, no call (final review I3)', async () => {
    const r = await rig({ linear: 'lost-a' });
    seed();
    refused(await confirm(r, {}), 'team-unknown');
    unlinked();
    expect(r.notices).toEqual([]);
    expect(s.linkingOf('project-a').teamCandidates).toHaveLength(2);
  });

  it('a Linear store that cannot be read is unavailable, never team-unknown: no link, no call (final review I3)', async () => {
    for (const linear of ['throw', 'unreadable'] as const) {
      const r = await rig({ linear });
      seed();
      refused(await confirm(r, {}), 'unavailable');
      unlinked();
    }
  });

  it('a candidate with no workspace whose key two workspaces hold is team-ambiguous: no link, no call (final review I3)', async () => {
    const r = await rig({ linear: 'shared' });
    s.recordLinkingReading('project-a', MEASURED);
    expect(s.recordTeamSuggestion('project-a', { by: 'lane-c', key: 'AAA', workspaceId: null, workspaceName: null, teamName: 'Team A', why: 'the branches say so', at: 1 })).toBe('written');
    refused(await confirm(r, { team: 'AAA', workspace: null }), 'team-ambiguous');
    unlinked();
    // The same key named with its workspace is a pair the store holds: it links.
    s.recordTeamCandidates('project-a', [ALPHA]);
    expect((await confirm(r, {})).statusCode).toBe(200);
  });

  it('a project with no row is no-project (404) and mints no row', async () => {
    const r = await rig();
    refused(await confirm(r, { project: 'project-none' }), 'no-project');
    expect(s.linkingAll().size).toBe(0);
    expect(callCount()).toBe(0);
  });

  it("the operator's write after an Overlord link makes the key manual (overturn)", async () => {
    const r = await rig();
    seed();
    expect((await confirm(r, {})).statusCode).toBe(200);
    const res = await r.app.inject({ method: 'POST', url: '/api/projects/project-a/linking', payload: { teamKey: null, override: null } });
    expect(res.statusCode).toBe(200);
    expect(s.linkingOf('project-a')).toMatchObject({ teamKey: null, teamLink: { source: 'manual', at: NOW } });
    expect({ ...s.db.prepare("SELECT teamSource, teamCallId FROM project_linking WHERE project = 'project-a'").get() }).toEqual({ teamSource: 'manual', teamCallId: null });
    // Decided now: the Overlord cannot link it again.
    s.recordTeamCandidates('project-a', [ALPHA]);
    refused(await confirm(r, {}), 'team-set');
  });

  it('the token comes first, then the body, both before the gate', async () => {
    const r = await rig();
    seed();
    const noToken = await r.app.inject({ method: 'POST', url: '/api/linking/confirm', payload: { byId: BODY, byUuid: 'u-1', project: 'project-a', team: 'AAA', workspace: WS_A } });
    refused(noToken, 'unauthenticated');
    for (const [body, field] of [[{ extra: 1 }, 'body'], [{ workspace: undefined }, 'workspace'], [{ team: 'a b' }, 'team'], [{ project: '../x' }, 'project']] as const) {
      const res = await confirm(r, body as Record<string, unknown>);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad-request', detail: field });
    }
    unlinked();
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM overlord_fence_refusals').get() as { n: number }).n).toBe(0);
  });
});
