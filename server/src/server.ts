import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { CcrcConfig } from './config.js';
import type { Runner, Tmux } from './exec.js';
import { assembleFleet } from './fleet.js';
import { Bus, type Notice } from './bus.js';
import type { FleetWatcher } from './watch.js';
import { SessionStream, parseSince } from './sessionws.js';
import { KeyedQueue } from './inject/queue.js';
import { sendPrompt, answerDialog, interrupt, type SendDeps } from './inject/send.js';
import { readRegistry } from './registry.js';
import { ccd, listProjects } from './lifecycle.js';
import type { FleetSession, SessionStreamMsg } from '../../shared/api.js';

export interface Deps { cfg: CcrcConfig; run: Runner; tmux: Tmux }

export async function buildServer(deps: Deps, bus = new Bus(), watcher?: FleetWatcher): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  app.get('/health', async () => ({ ok: true }));

  app.get('/api/fleet', async () => ({ sessions: await assembleFleet(deps.cfg, deps.tmux) }));

  app.get('/ws/fleet', { websocket: true }, (socket) => {
    const onFleet = (sessions: FleetSession[]) => socket.send(JSON.stringify({ type: 'fleet', sessions }));
    const onNotice = (n: Notice) => socket.send(JSON.stringify({ type: 'notice', ...n }));
    void assembleFleet(deps.cfg, deps.tmux).then(onFleet);
    bus.on('fleet', onFleet);
    bus.on('notice', onNotice);
    socket.on('close', () => {
      bus.off('fleet', onFleet);
      bus.off('notice', onNotice);
    });
  });

  app.get('/ws/session/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const since = parseSince((req.query as { since?: string }).since);
    const stream = new SessionStream(deps, bus, id, (m: SessionStreamMsg) => socket.send(JSON.stringify(m)), since);
    void stream.start();
    socket.on('close', () => stream.stop());
  });

  // Write routes: serialized per session through one KeyedQueue; injection
  // errors map to 409 with the {ok:false,...} body, unknown session ids to 404.
  const sendDeps: SendDeps = { tmux: deps.tmux, queue: new KeyedQueue() };
  const knownId = async (id: string): Promise<boolean> =>
    (await readRegistry(deps.cfg)).some((r) => r.id === id);

  app.post('/api/sessions/:id/prompt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { text?: unknown; replaceDraft?: unknown };
    if (typeof body.text !== 'string' || body.text.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await sendPrompt(sendDeps, id, body.text, { replaceDraft: body.replaceDraft === true });
    return res.ok ? res : reply.code(409).send(res);
  });

  app.post('/api/sessions/:id/dialog', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { dialogId?: unknown; optionIndex?: unknown };
    if (typeof body.dialogId !== 'string' || typeof body.optionIndex !== 'number') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await answerDialog(sendDeps, id, body.dialogId, body.optionIndex);
    return res.ok ? res : reply.code(409).send(res);
  });

  app.post('/api/sessions/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const res = await interrupt(sendDeps, id);
    return res.ok ? res : reply.code(409).send(res);
  });

  // Lifecycle + projects routes: shell out to ccd; failures map to 502 with stderr.
  const runCcd = async (reply: FastifyReply, args: string[]) => {
    const res = await ccd(deps.run, deps.cfg, args);
    return res.ok ? { ok: true } : reply.code(502).send({ ok: false, stderr: res.stderr });
  };

  app.get('/api/projects', async () => listProjects(deps.cfg));

  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as { wrapper?: unknown; project?: unknown; workdir?: unknown; enable?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0
      || typeof body.project !== 'string' || body.project.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const sub = body.enable === false ? 'start' : 'enable';   // enable = start + systemd enable
    const workdir = typeof body.workdir === 'string' && body.workdir.length > 0 ? [body.workdir] : [];
    return runCcd(reply, [sub, body.wrapper, body.project, ...workdir]);
  });

  app.post('/api/sessions/:id/ensure', async (req, reply) => {
    const { id } = req.params as { id: string };
    return runCcd(reply, ['ensure', id]);
  });

  app.post('/api/sessions/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = (await readRegistry(deps.cfg)).find((r) => r.id === id);
    if (!rec) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    return runCcd(reply, ['stop', rec.wrapper, rec.project]);
  });

  app.post('/api/sessions/:id/swap', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { wrapper?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    return runCcd(reply, ['swap', id, body.wrapper]);
  });

  if (watcher) app.addHook('onClose', async () => { watcher.stop(); });
  return app;
}
