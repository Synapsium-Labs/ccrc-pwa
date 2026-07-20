import type { CcrcConfig } from './config.js';
import type { Tmux } from './exec.js';
import { readRegistry } from './registry.js';
import { readLimits } from './limits.js';
import { readLiveState } from './livestate.js';
import type { FleetSession, SessionStatus } from '../../shared/api.js';

export function idHomeWrapper(id: string): string {
  for (const w of ['claude-corp', 'claude2', 'claude', 'gpt']) if (id.startsWith(`${w}-`)) return w;
  return 'claude';
}

export async function assembleFleet(cfg: CcrcConfig, tmux: Tmux, now = Math.floor(Date.now() / 1000)): Promise<FleetSession[]> {
  const [records, limits] = await Promise.all([readRegistry(cfg), readLimits(cfg, now)]);
  return Promise.all(records.map(async (r): Promise<FleetSession> => {
    const alive = await tmux.hasSession(r.id);
    let status: SessionStatus = 'dead';
    let name: string | null = null, statusUpdatedAt: number | null = null, version: string | null = null;
    if (alive) {
      status = 'idle';
      const pid = await tmux.panePid(r.id);
      const cfgDir = cfg.wrappers[r.wrapper];
      if (pid && cfgDir) {
        const live = await readLiveState(cfgDir, pid);
        if (live) {
          status = live.status === 'busy' ? 'busy' : 'idle';
          name = live.name; statusUpdatedAt = live.statusUpdatedAt; version = live.version;
        }
      }
    }
    const acct = limits[r.wrapper];
    return {
      id: r.id, wrapper: r.wrapper, home: r.home ?? idHomeWrapper(r.id),
      project: r.project, workdir: r.workdir, name, status, statusUpdatedAt,
      limits: acct ? { five: acct.five, seven: acct.seven } : null,
      dialogPending: false, version,
    };
  }));
}
