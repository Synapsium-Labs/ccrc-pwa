import { buildServer, type Deps } from './server.js';
import { loadConfig } from './config.js';
import { realRunner, Tmux } from './exec.js';
import { ccdRunner } from './lifecycle.js';
import { localIO } from './io.js';
import { attachPty } from './pty.js';
import { Bus } from './bus.js';
import { FleetWatcher } from './watch.js';
import { connectFleet } from './remote/client.js';
import { PushService } from './push.js';
import path from 'node:path';

const cfg = loadConfig();

// Web Push is optional — only wired when a VAPID keypair is configured.
const push = cfg.vapidPublic && cfg.vapidPrivate
  ? new PushService(
      { publicKey: cfg.vapidPublic, privateKey: cfg.vapidPrivate, subject: cfg.vapidSubject },
      path.join(cfg.home, '.ccrc', 'push-subs.json'),
    )
  : undefined;

let deps: Deps;
if (cfg.fleetMode === 'remote') {
  if (!cfg.agentUrl || !cfg.agentToken) {
    console.error('ccrc-server: CCRC_FLEET=remote requires CCRC_AGENT_URL and CCRC_AGENT_TOKEN');
    process.exit(1);
  }
  const fleet = connectFleet({ url: cfg.agentUrl, token: cfg.agentToken });
  // The composition root is the ONLY place a raw `Runner` is in scope: it binds
  // one into `runCcd` and hands the other to `Tmux`'s constructor. Nothing
  // downstream holds a runner, which is what makes `CcdArgv` total (task 13S).
  deps = {
    cfg, runCcd: ccdRunner(fleet.runner, cfg), tmux: new Tmux(fleet.runner), io: fleet.io,
    spawnPty: fleet.spawnPty, fleetState: fleet.state, push,
    refreshCaps: async () => {
      const verbs = await fleet.client.caps();
      if (verbs !== null) fleet.state.ccdVerbs = verbs;
    },
  };
} else {
  deps = { cfg, runCcd: ccdRunner(realRunner, cfg), tmux: new Tmux(realRunner), io: localIO, spawnPty: attachPty, push };
}

const bus = new Bus();
const watcher = new FleetWatcher(deps, bus);

const app = await buildServer(deps, bus, watcher);
watcher.start();
await app.listen({ host: cfg.host, port: cfg.port });
console.log(`ccrc-server on ${cfg.host}:${cfg.port} (fleet=${cfg.fleetMode})`);
