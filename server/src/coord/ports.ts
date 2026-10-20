// L2 ports (ARCH-03, D-6003): the two capabilities the coordination lanes and the turn reads take from their L4
// hosts, declared here beside their consumers so no file below L4 imports `server.ts` or `watch.ts`, even for a
// type. Every top-level statement is a type: tsc emits nothing for this file's declarations.
import type { CcdArgv } from '../ccdargv.js';
import type { Unmeasured } from '../unmeasured.js';
import type { Statusline } from '../pane/statusline.js';

/** `killed` and `signal` are REQUIRED here, unlike their `ExecResult`
 *  counterparts: no test anywhere builds a `CcdResult` literal, and only a
 *  handful of whole-object `toEqual`s in `lifecycle.test.ts` observe them — so
 *  requiring them costs nothing and forces every producer to answer.
 *
 *  REQUIRED, so they carry the TOKEN rather than an absence (`exec.ts`'s
 *  vocabulary paragraph). §1.7: `killed: boolean` USED to be the answer and was
 *  wrong in one direction only — `r.killed === true` collapsed an ABSENT
 *  optional into `false`, telling every caller "this child was not killed" when
 *  the truth was "nobody measured whether it was". The adoption gate handles
 *  those two differently on purpose, and an older agent, the transport catch
 *  path and `local` mode all land in the second. */
export interface CcdResult {
  ok: boolean; stdout: string; stderr: string;
  killed: boolean | Unmeasured;
  signal: string | null | Unmeasured;
}

/** The single ccd capability: run one `ccd` verb. Failure contract: a non-zero exit is `ok: false` with the verb's
 *  stderr, and whether the child was cut short is `killed`/`signal`, `Unmeasured` when nobody measured it.
 *  `Deps.runCcd` is this type, and `lifecycle.ts`'s `CcdRunner` names it. */
export type RunCcd = (argv: CcdArgv) => Promise<CcdResult>;

/** The watcher's newest pane-scraped reads, as the turn reads take them (`turnverdict.ts`'s `turnReadDeps`).
 *  `FleetWatcher` satisfies it. Failure contract: both reads are synchronous snapshots of the last sweep, never a
 *  throw, each a fresh copy; an empty set or map means the last sweep saw none, and no watcher at all is the
 *  caller's `undefined`. */
export interface FleetWatcherView {
  currentPending(): Set<string>;
  currentStatuslines(): Map<string, Statusline>;
}
