// The Flows doors (spec 2026-11-19 §8). Ring: L4, context Coordination (C5): the operator's doors, session-gated when
// the auth gate is armed, and no box token — a session never edits a flow. They decide nothing: each asks
// `doors.ts` (L1) and acts on the answer through the store's delegates.
import type { FastifyInstance } from 'fastify';
import type { FlowAnswer, FlowProgrammeRow, FlowsListAnswer } from '../../../shared/flows.js';
import { refuseRoute } from '../refuse.js';
import type { CoordStore } from '../coord/store.js';
import { decideCreate, decideDefault, decideDraft, decidePublish, flowIdOf, problemsOf, type DoorRefusal } from './doors.js';
import { FLOW_TEMPLATES } from './templates.js';
import { flowPositionOf } from './position.js';

export interface FlowsRouteOpts {
  /** The coordination store; undefined (a test, a script): `unavailable`. */
  coord: CoordStore | undefined;
  now?: () => number;
}

export function registerFlowsRoutes(app: FastifyInstance, opts: FlowsRouteOpts): void {
  const now = opts.now ?? Date.now;
  const refuse = (reply: Parameters<typeof refuseRoute>[0], r: DoorRefusal) =>
    refuseRoute(reply, r.refusal, { detail: r.detail, ...(r.refusal === 'conflict' && r.problems ? { problems: r.problems } : {}) });

  app.get('/api/flows', async (_req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const list = opts.coord.listFlows();
    if (!list.ok) return refuseRoute(reply, 'unavailable', { detail: list.detail });
    const answer: FlowsListAnswer = { flows: list.value, templates: [...FLOW_TEMPLATES], defaultFlowId: opts.coord.readDefaultFlow() };
    return answer;
  });

  // Wave 2: the flow new programmes pin. Registered before the `:id` routes.
  app.put('/api/flows/default', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const d = decideDefault(req.body);
    if (!d.ok) return refuse(reply, d);
    const done = opts.coord.setDefaultFlow(d.flowId);
    if (!done.ok) {
      return done.refused === 'not-found' ? refuseRoute(reply, 'not-found')
        : refuseRoute(reply, 'conflict', { detail: 'the flow has no published version' });
    }
    return { ok: true, defaultFlowId: d.flowId };
  });

  app.get('/api/flows/:id', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const id = flowIdOf((req.params as { id?: unknown }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'id' });
    const read = opts.coord.readFlow(id);
    if (!read.ok) return refuseRoute(reply, 'unavailable', { detail: read.detail });
    if (read.value === null) return refuseRoute(reply, 'not-found');
    const { draft, versions, ...flow } = read.value;
    const answer: FlowAnswer = { flow, draft, problems: problemsOf(draft), versions, isDefault: opts.coord.readDefaultFlow() === id };
    return answer;
  });

  // Wave 3a: the programmes that pin this flow, each with where it is, derived on this read (`position.ts`).
  app.get('/api/flows/:id/programmes', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const id = flowIdOf((req.params as { id?: unknown }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'id' });
    const flow = opts.coord.readFlow(id);
    if (!flow.ok) return refuseRoute(reply, 'unavailable', { detail: flow.detail });
    if (flow.value === null) return refuseRoute(reply, 'not-found');
    const read = opts.coord.flowProgrammes(id);
    if (!read.ok) return refuseRoute(reply, 'unavailable', { detail: read.detail });
    const docs = new Map<number, ReturnType<typeof opts.coord.readFlowVersion>>();
    const programmes: FlowProgrammeRow[] = read.value.map((p) => {
      if (!docs.has(p.version)) docs.set(p.version, opts.coord!.readFlowVersion(id, p.version));
      const v = docs.get(p.version)!;
      const doc = v.ok && v.value !== null ? v.value.doc : null;
      return { slug: p.slug, title: p.title, version: p.version, position: flowPositionOf(doc, p.facts) };
    });
    return { programmes };
  });

  app.get('/api/flows/:id/versions/:version', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const p = req.params as { id?: unknown; version?: unknown };
    const id = flowIdOf(p.id);
    const version = flowIdOf(p.version);
    if (id === null || version === null) return refuseRoute(reply, 'bad-request', { detail: 'id or version' });
    const read = opts.coord.readFlowVersion(id, version);
    if (!read.ok) return refuseRoute(reply, 'unavailable', { detail: read.detail });
    if (read.value === null) return refuseRoute(reply, 'not-found');
    return read.value;
  });

  app.post('/api/flows', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const d = decideCreate(req.body);
    if (!d.ok) return refuse(reply, d);
    return { ok: true, id: opts.coord.createFlow(d.doc, d.source, now()) };
  });

  app.put('/api/flows/:id/draft', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const id = flowIdOf((req.params as { id?: unknown }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'id' });
    const d = decideDraft(req.body);
    if (!d.ok) return refuse(reply, d);
    if (!opts.coord.saveFlowDraft(id, d.doc, now()).changed) return refuseRoute(reply, 'not-found');
    return { ok: true, problems: d.problems };
  });

  app.post('/api/flows/:id/publish', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const id = flowIdOf((req.params as { id?: unknown }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'id' });
    const read = opts.coord.readFlow(id);
    if (!read.ok) return refuseRoute(reply, 'unavailable', { detail: read.detail });
    const d = decidePublish(read.value?.draft ?? null);
    if (!d.ok) return refuse(reply, d);
    const done = opts.coord.publishFlow(id, d.doc, now());
    if (!done.ok) return done.reason === 'absent' ? refuseRoute(reply, 'not-found') : refuseRoute(reply, 'superseded');
    return { ok: true, version: done.version };
  });

  app.delete('/api/flows/:id', async (req, reply) => {
    if (opts.coord === undefined) return refuseRoute(reply, 'unavailable');
    const id = flowIdOf((req.params as { id?: unknown }).id);
    if (id === null) return refuseRoute(reply, 'bad-request', { detail: 'id' });
    const done = opts.coord.deleteFlow(id);
    if ('refused' in done) return refuseRoute(reply, 'conflict', { detail: `pinned by ${done.by} programme${done.by === 1 ? '' : 's'}` });
    if (!done.changed) return refuseRoute(reply, 'not-found');
    return { ok: true };
  });
}
