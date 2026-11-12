// D-8382 (#1442): the read behind `GET /api/fleet/overrides` (registered in `server.ts`, read only). Settings ›
// Automation › Overrides in force reads every override the switchboard declares (`overrideSwitchNames`,
// `shared/switches.ts`) with what the fleet host says of it, and Settings › Security's one approvals line reads the
// server box's approvals topology. The route is not in `auth/gate.ts`'s EXEMPT table, so with `CCRC_AUTH` armed it sits
// behind the session gate; it consults no box token, because no machine lane reads it and it writes nothing. It has no
// write twin on purpose: every override is placed and lifted at a terminal.
//
// Each override is read WHERE IT LIVES, through the fleet io (the agent in remote mode, this box in local mode): a
// registry marker off the one registry listing, through `readSwitches`, the reader the stall watch's held flags and
// every lane's switch read share; a `~/.ccrc` file through one `statMeasured` of it, which the fleet host's agent admits
// for exactly the switchboard's `~/.ccrc` names (`checkCcrcSwitchStat`). Neither path assumes the server box's HOME
// holds the fleet's files. A read that proved neither presence nor absence is `unmeasurable`, never `clear`.
//
// The approvals topology is the server box's own (the signing key and the opt-in live there), from
// `approvalsTopologyOf`, whose `rulings` is the ruling gate's own answer.
//
// L3: it reads through the fleet io and keeps every distinction it receives; what a reading means is `overridesOf`'s (L0).
import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { approvalsTopologyOf } from './coord/approvalsign.js';
import type { MarkerState } from '../../shared/api.js';
import type { OverridesView } from '../../shared/overrides.js';
import {
  SWITCHES, ccrcFileSwitchNames, overridesOf, readSwitches, type CcrcFileReading, type CcrcFileSwitchName,
} from '../../shared/switches.js';

/** What the route reads through. */
export interface OverridesReadDeps {
  readonly cfg: Pick<CcrcConfig, 'registryDir' | 'ccrcDir' | 'role' | 'fleetMode'>;
  readonly io: Pick<FleetIO, 'readdir' | 'statMeasured'>;
}

/** The fleet host's `~/.ccrc` rows, one `statMeasured` each, at `<ccrcDir>/<file>` (in remote mode the same absolute path
 *  on the fleet host, the same-path assumption `registryDir` makes). A file that stands is `'set'`, a proven absence
 *  `'clear'`, anything else (an agent that predates the admission refuses with `forbidden`) `'unmeasurable'`. */
export async function readCcrcFileSwitches(io: Pick<FleetIO, 'statMeasured'>, ccrcDir: string): Promise<CcrcFileReading> {
  const read = await Promise.all(ccrcFileSwitchNames.map(async (k): Promise<[CcrcFileSwitchName, MarkerState]> => {
    const r = await io.statMeasured(path.join(ccrcDir, SWITCHES[k].storage.ccrcFile));
    return [k, r.ok ? 'set' : r.reason === 'absent' ? 'clear' : 'unmeasurable'];
  }));
  return Object.fromEntries(read) as Record<CcrcFileSwitchName, MarkerState>;
}

/** One answer of the route: both reads at once, composed. */
export async function overridesViewNow(deps: OverridesReadDeps): Promise<OverridesView> {
  const [listing, files] = await Promise.all([
    deps.io.readdir(deps.cfg.registryDir),
    readCcrcFileSwitches(deps.io, deps.cfg.ccrcDir),
  ]);
  const { boxes, marker, file } = approvalsTopologyOf(deps.cfg.role, deps.cfg.fleetMode, deps.cfg.ccrcDir);
  return { overrides: overridesOf(readSwitches(listing), files), approvals: { boxes, marker, file } };
}
