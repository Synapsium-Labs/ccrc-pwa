import type { FleetIO } from './io.js';
import type {
  CoordDbState, FloorState, ProjectReadiness, SkillState, TokenState,
} from '../../shared/api.js';
import { foldSkillStates, readyVerdict } from '../../shared/api.js';
import { COORDINATOR_SKILL_DIR, WORKER_SKILL_DIR, readSkillState } from './skillstate.js';

/**
 * The program-ready measurement (program-leverage wave 3, F3).
 *
 * Lives OUTSIDE `server/src/coord/` on purpose: it must not import
 * `coord/db.js` or `node:sqlite`, and the one coord fact it needs — whether a
 * project's deviation floor row exists — arrives as a PORT its consumer
 * declares, the way wave 2's `configDir` port did (D-1015).
 *
 * Split in two because the two halves have different clocks. The FLEET-WIDE
 * half (both skills in every rostered HOME, the box token, the coordination
 * database) costs `2 * homes + 1` `readFileMeasured` calls — in remote fleet
 * mode that is one agent round trip each, with a 15 s ceiling apiece and no
 * batch op in the protocol — so it belongs on a slow sweep and never on a
 * request. The PER-PROJECT half is one indexed SELECT and is composed at the
 * route.
 *
 * Nothing here decides anything about a REQUEST: it measures, and hands back
 * values. The refusal, the rendering and the caching all live with their own
 * consumers.
 */

/** One rostered HOME, already resolved. `configDir` is `undefined` for a
 *  wrapper this box's roster does not carry — a missing PATH, which is not a
 *  missing skill, and `readSkillState` keeps the two apart. */
export interface ReadinessHome {
  readonly wrapper: string;
  readonly configDir: string | undefined;
}

export interface ReadinessDeps {
  readonly io: Pick<FleetIO, 'readFileMeasured'>;
  readonly homes: readonly ReadinessHome[];
  /**
   * `cfg.mailTokenPath` — re-measured here rather than reported from the token
   * the composition root already holds, because THAT read has only two
   * outcomes: a string, or a process that never started (`coord/token.ts`
   * returns null for a proven ENOENT and throws uncaught for everything else).
   * Re-measuring is what makes `unmeasurable` a reachable answer instead of a
   * decorative one (D-1025), and it also catches a token removed or made
   * unreadable AFTER boot, which a boot snapshot never could.
   */
  readonly mailTokenPath: string;
  /** Whether the coordination database answers. A closure, not a store handle:
   *  this module may not import `node:sqlite`, and the probe's own failure
   *  mode is its consumer's to catch. */
  readonly coordProbe: () => CoordDbState;
  readonly now?: () => number;
}

/** The half that is true of the BOX, not of any one project. */
export interface FleetReadiness {
  readonly worker: SkillState;
  readonly coordinator: SkillState;
  readonly boxToken: TokenState;
  readonly coordDb: CoordDbState;
  readonly at: number;
}

export async function measureFleetReadiness(deps: ReadinessDeps): Promise<FleetReadiness> {
  const now = deps.now ?? Date.now;
  const worker: SkillState[] = [];
  const coordinator: SkillState[] = [];
  // SERIAL, not `Promise.all`: in remote fleet mode each of these is an agent
  // round trip over ONE socket, so firing 2N at once buys no wall clock while
  // making a wedged agent's per-request timeouts overlap into a single
  // unreadable stall. The sweep that calls this is on a ten-minute clock and
  // has no deadline to race.
  for (const home of deps.homes) {
    worker.push(await readSkillState(deps.io, home.configDir, WORKER_SKILL_DIR));
    coordinator.push(await readSkillState(deps.io, home.configDir, COORDINATOR_SKILL_DIR));
  }
  const token = await deps.io.readFileMeasured(deps.mailTokenPath);
  // MEASURABILITY ONLY. The content is a shared box secret; `configured` is the
  // whole answer, and the bytes are never carried, logged or returned.
  const boxToken: TokenState = token.ok
    ? 'configured'
    : token.reason === 'absent' ? 'absent' : 'unmeasurable';
  return {
    worker: foldSkillStates(worker),
    coordinator: foldSkillStates(coordinator),
    boxToken,
    coordDb: deps.coordProbe(),
    at: now(),
  };
}

/** Join one project's floor to the swept fleet half. The verdict is DERIVED
 *  here and nowhere else, so every consumer renders one answer rather than
 *  folding five fields a second time and disagreeing at the edges. */
export function projectReadiness(fleet: FleetReadiness, floor: FloorState): ProjectReadiness {
  const facts = {
    worker: fleet.worker,
    coordinator: fleet.coordinator,
    floor,
    boxToken: fleet.boxToken,
    coordDb: fleet.coordDb,
  };
  return { ...facts, verdict: readyVerdict(facts), at: fleet.at };
}
