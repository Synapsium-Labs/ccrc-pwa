import type { CcrcConfig } from './config.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import { readRegistry } from './registry.js';
import { readLimits } from './limits.js';
import { readLiveState } from './livestate.js';
import type { Statusline } from './pane/statusline.js';
import type { FleetSession, SessionStatus } from '../../shared/api.js';

export function idHomeWrapper(id: string): string {
  for (const w of ['claude-corp', 'claude2', 'claude', 'gpt']) if (id.startsWith(`${w}-`)) return w;
  return 'claude';
}

/**
 * Authoritative live status for one session — the same signal the fleet uses:
 * dead if no tmux session, else busy/idle from the live status file. Used by the
 * interrupt route, since the --remote-control pane carries no busy marker.
 */
export async function liveStatus(io: FleetIO, cfg: CcrcConfig, tmux: Tmux, id: string): Promise<SessionStatus> {
  const rec = (await readRegistry(io, cfg)).find((r) => r.id === id);
  if (!rec || !(await tmux.hasSession(id))) return 'dead';
  const pid = await tmux.panePid(id);
  const cfgDir = cfg.wrappers[rec.wrapper];
  if (!pid || !cfgDir) return 'idle';
  const live = await readLiveState(io, cfgDir, pid);
  return live?.status === 'busy' ? 'busy' : 'idle';
}

export async function assembleFleet(
  io: FleetIO,
  cfg: CcrcConfig,
  tmux: Tmux,
  now = Math.floor(Date.now() / 1000),
  pendingDialogs?: Set<string>,
  statuslines?: Map<string, Statusline>,
): Promise<FleetSession[]> {
  const [records, limits] = await Promise.all([readRegistry(io, cfg), readLimits(io, cfg, now)]);
  return Promise.all(records.map(async (r): Promise<FleetSession> => {
    const alive = await tmux.hasSession(r.id);
    let status: SessionStatus = 'dead';
    let name: string | null = null, statusUpdatedAt: number | null = null, version: string | null = null;
    if (alive) {
      status = 'idle';
      const pid = await tmux.panePid(r.id);
      const cfgDir = cfg.wrappers[r.wrapper];
      if (pid && cfgDir) {
        const live = await readLiveState(io, cfgDir, pid);
        if (live) {
          status = live.status === 'busy' ? 'busy' : 'idle';
          name = live.name; statusUpdatedAt = live.statusUpdatedAt; version = live.version;
        }
      }
    }
    const acct = limits[r.wrapper];
    const sl = statuslines?.get(r.id);
    // A running Workflow leaves the orchestrator reporting idle while it waits
    // on subagents — surface it as busy so it doesn't read as finished.
    if (sl?.workflowActive && status === 'idle') status = 'busy';
    return {
      id: r.id, wrapper: r.wrapper, home: r.home ?? idHomeWrapper(r.id),
      project: r.project, workdir: r.workdir, name, status, statusUpdatedAt,
      limits: acct ? { five: acct.five, seven: acct.seven } : null,
      dialogPending: pendingDialogs?.has(r.id) ?? false, version,
      model: sl?.model ?? null, effort: sl?.effort ?? null,
      ultracode: sl?.ultracode ?? false, branch: sl?.branch ?? null,
    };
  }));
}
