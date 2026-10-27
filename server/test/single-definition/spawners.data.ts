/**
 * D-7056 (W8 Task C8d; ARCH-73 (#808); spec K17 "Audited one at a time"): every process spawner in `server/src`,
 * `agent/src` and `shared/`, one row per `file#symbol`, each with why it is its own spawner and not a call of another.
 * `census-w8/spawn.ts#processSpawnSites` is the census; `kernel-tail-spawn.test.ts` holds its keys equal to this set
 * in both directions (a new spawner needs a row and a reason here; a row whose site is gone is red), and the set may
 * only shrink. Each spawner is audited one at a time: C8d audited `localcaps.ts`; C8e audits the account-op pair and
 * edits its two rows. The shape is the ring rules' `EntrySet` (`rings/exemptions.ts`).
 */
import type { EntrySet } from '../rings/exemptions.js';

export const PROCESS_SPAWNERS: EntrySet = {
  'server/src/exec.ts#realRunner': {
    reason: "C2's CcdArgv ACL runner for tmux and ccd: no bound and no group kill, by design (a swap verb runs minutes)",
    since: '2026-10-27',
  },
  'shared/spawn.mjs#boundedSpawn': {
    reason: 'the one bounded update spawner (D-7055): its own group, stdin closed, SIGKILL at the bound, a drain deadline',
    since: '2026-10-27',
  },
  'shared/spawn.mjs#boundedStdinSpawn': {
    reason: 'the one account-op spawner (D-7057, OA-C8a (a)): the secret on stdin (D-5513), an explicit env, TERM to the group, KILL after the grace',
    since: '2026-10-27',
  },
  'server/src/pty.ts#attachPty': {
    reason: "the terminal drawer's local tmux attach through node-pty: an interactive pty, not a bounded read",
    since: '2026-10-27',
  },
  'agent/src/pty.ts#spawnFleetPty': {
    reason: "the terminal drawer's remote tmux attach through node-pty, the agent half of attachPty",
    since: '2026-10-27',
  },
  'agent/src/tokensync.ts#makeTokenSyncSpawn': {
    reason: 'its own bounded body by D-4390: the claim code on stdin, an explicit env, SIGTERM before SIGKILL',
    since: '2026-10-27',
  },
  'agent/src/server.ts#runExec': {
    reason: "the agent's exec op: only whitelisted argv reaches it, bounded by execFile's own timeout",
    since: '2026-10-27',
  },
  'server/src/accounts/ops.ts#localAccountOps.run': {
    reason: "KEPT against exec.ts by the C8e audit (D-7057): the secret on stdin (D-5513), an explicit env, a bound, TERM to the group then KILL; the agent's twin",
    since: '2026-10-27',
  },
  'agent/src/accountop.ts#makeAccountOpSpawn': {
    reason: "KEPT against exec.ts by the C8e audit (D-7057): the local arm's twin, one difference (a non-ESRCH group kill falls back to the child)",
    since: '2026-10-27',
  },
  'server/src/localcaps.ts#execCapped': {
    reason: 'KEPT by the C8d audit (D-7056): SIGTERM then SIGKILL after a 2 s grace, stderr ignored, its own reason words',
    since: '2026-10-27',
  },
};
