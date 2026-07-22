import { buildServer, type Deps } from './server.js';
import { loadConfig } from './config.js';
import { realRunner, Tmux } from './exec.js';
import { localIO } from './io.js';
import { attachPty } from './pty.js';
import { Bus } from './bus.js';
import { FleetWatcher } from './watch.js';
import { connectFleet } from './remote/client.js';

const cfg = loadConfig();

let deps: Deps;
if (cfg.fleetMode === 'remote') {
  if (!cfg.agentUrl || !cfg.agentToken) {
    console.error('ccrc-server: CCRC_FLEET=remote requires CCRC_AGENT_URL and CCRC_AGENT_TOKEN');
    process.exit(1);
  }
  const fleet = connectFleet({ url: cfg.agentUrl, token: cfg.agentToken });
  deps = { cfg, run: fleet.runner, tmux: new Tmux(fleet.runner), io: fleet.io, spawnPty: fleet.spawnPty, fleetState: fleet.state };
} else {
  deps = { cfg, run: realRunner, tmux: new Tmux(realRunner), io: localIO, spawnPty: attachPty };
}

const bus = new Bus();
const watcher = new FleetWatcher(deps, bus);

const app = await buildServer(deps, bus, watcher);
watcher.start();
await app.listen({ host: cfg.host, port: cfg.port });
console.log(`ccrc-server on ${cfg.host}:${cfg.port} (fleet=${cfg.fleetMode})`);
