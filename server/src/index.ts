import { buildServer, type Deps } from './server.js';
import { loadConfig } from './config.js';
import { realRunner, Tmux } from './exec.js';
import { attachPty } from './pty.js';
import { Bus } from './bus.js';
import { FleetWatcher } from './watch.js';

const cfg = loadConfig();
const deps: Deps = { cfg, run: realRunner, tmux: new Tmux(realRunner), spawnPty: attachPty };
const bus = new Bus();
const watcher = new FleetWatcher(deps, bus);

const app = await buildServer(deps, bus, watcher);
watcher.start();
await app.listen({ host: cfg.host, port: cfg.port });
console.log(`ccrc-server on ${cfg.host}:${cfg.port}`);
