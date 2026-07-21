import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { CcrcConfig } from './config.js';
import type { Runner, Tmux } from './exec.js';
import { assembleFleet } from './fleet.js';
import { Bus, type Notice } from './bus.js';
import type { FleetWatcher } from './watch.js';
import type { FleetSession } from '../../shared/api.js';

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

  if (watcher) app.addHook('onClose', async () => { watcher.stop(); });
  return app;
}
