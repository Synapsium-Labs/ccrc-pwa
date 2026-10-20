// The ports the composition root hands the delivery layer (ARCH-03, #541; D-6003): `Deps`, the one bag `index.ts`
// builds and `buildServer` and `FleetWatcher` take, and `CollectLaneDeps`, one of its members. They are declared here,
// not in `server.ts`, so a consumer below L4 that takes `Deps` (`commands.ts`) reads inward only. This file is
// type-only and emits nothing: a composition-root type, not a domain layer. `server.ts` re-exports both names, so
// every caller that imports them from there still compiles.
import type { CcrcConfig } from './config.js';
import type { BuildInfo } from './buildinfo.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import type { FleetState } from './fleetstate.js';
import type { CcdArgv } from './ccdargv.js';
import type { CcdResult } from './lifecycle.js';
import type { SpawnPty } from './pty.js';
import type { SecretMasker } from './accounts/mask.js';
import type { FleetIdentityCell } from './fleetidentity.js';
import type { KeyedQueue } from './inject/queue.js';
import type { PushService } from './push.js';
import type { NotifyLog } from './notifylog.js';
import type { Presence } from './presence.js';
import type { ChildReclaimOutcome, ChildReclaimRequest } from './coord/childReclaim.js';
import type { BoxTokenHolder } from './coord/token.js';
import type { TokenRouteDriver } from './token/routes.js';
import type { CoordStore } from './coord/store.js';
import type { PoolEdgeLog } from './coord/pooledgelog.js';
import type { CataloguePoller } from './update/catalogue.js';
import type { UpdateIntentLog } from './coord/updateintentlog.js';
import type { CollectLaneJournal } from './collectLane.js';
import type { LocalUpdateSpawn, SendUpdateOp } from './update/converge.js';
import type { AccountAudit } from './accounts/audit.js';
import type { AccountOps } from './accounts/ops.js';

/** The collector switch's composition (path-identity spec 2026-10-12 §5.2, §5.6), built once in `index.ts`: the ONE
 *  generation journal `CoordStore.setCollectLane` appends to inside its transaction, and this process's boot nonce,
 *  which only the switch route's confirm key reads. One object, so "no journal" has one spelling: `Deps.collectLane`
 *  absent. */
export interface CollectLaneDeps { readonly journal: CollectLaneJournal; readonly bootNonce: string }

export interface Deps {
  cfg: CcrcConfig;
  /** The deploy's build stamp (buildinfo.ts, read once at boot from
   *  `cfg.buildInfoPath`). `null` on a dev checkout or an unstamped box;
   *  absent has the same meaning — `/health` treats both as null, and so does
   *  `/api/fleet/health` when no coordination database is wired, where this
   *  is the OWN side of the two-box skew comparison (`buildAgreement`,
   *  against `fleetState.build`); with one, the inventory's server row is
   *  (design 2026-09-20 §14). Either way an unstamped server answers
   *  `'unknown'` rather than manufacturing a disagreement with the fleet host
   *  out of a stamp it never had. */
  build?: BuildInfo | null;
  /** The ONLY path to `ccd`. There is deliberately no raw `run` here: with one,
   *  "every ccd argv is built in ccdargv.ts" is enforceable only by scanning
   *  source text, which was defeated four times in four rounds. The parameter
   *  type is the enforcement now — see task 13S and `CcdArgv`. */
  runCcd: (argv: CcdArgv) => Promise<CcdResult>;
  tmux: Tmux; io: FleetIO; spawnPty?: SpawnPty;
  /** The egress mask (D-5513, accounts plan Task A10): every server egress of session-derived text passes it. Absent
   *  (a test, mainly): `SHAPE_ONLY_MASKER`, so the shapes are masked even where nothing wires the table. */
  masker?: SecretMasker;
  /** Remote-mode reachability, straight from `connectFleet().state` — its
   *  `connected`/`downSince` fields are ignored in local mode (the fleet is
   *  always "connected" there; every reader gates on `cfg.fleetMode ===
   *  'remote'` first). `ccdVerbs`, though, is populated in BOTH modes as of
   *  fix round 3 (task 14): `index.ts`'s local branch measures its own
   *  box's `ccd caps` at boot (`localcaps.ts`) rather than leaving this
   *  whole object absent, which is what made `stopSurfaceSupported`'s
   *  inverted no-evidence default a dead feature in local mode before this
   *  fix. Genuinely absent only if a caller builds `Deps` some OTHER way
   *  (a test, mainly) and omits it outright. */
  fleetState?: FleetState;
  /** Remote mode only — local mode measures its ccd ONCE, at boot
   *  (`index.ts`), rather than on a timer, so it has nothing to refresh;
   *  its absence is still the local/remote mode test for THIS field, even
   *  though `fleetState` itself is no longer the same tell. */
  refreshCaps?: () => Promise<void>;
  /** The connection-bound fleet node identity (path-identity spec 2026-10-12 §5.2).
   *  - Remote mode: the agent client's own cell (`fleet.identity`). It is invalidated on every ready and close, and
   *    only the inventory's fleet sweep publishes into it, under the epoch it captured.
   *  - Local mode: a cell nothing invalidates (epoch 0). The server row's own sweep publishes into it, because this
   *    box is the fleet node.
   *  It is optional so that the hand-built Deps in tests stay valid. A reader of an absent cell uses
   *  `NO_FLEET_IDENTITY`, which is never known, so nothing arms through it. Production carries it in both arms
   *  (text pins over index.ts). */
  fleetIdentity?: FleetIdentityCell;
  /** The ONE per-session write queue for the process. Built in `index.ts` and
   *  handed to both `buildServer` and `FleetWatcher`, because the naming
   *  sweep's `ws-rename` has to serialise against `POST /workspace/reap` — and
   *  two `KeyedQueue`s serialise nothing at all. Required, not optional: an
   *  absent field with a local fallback is exactly how a second queue gets
   *  built with every suite green. */
  queue: KeyedQueue;
  /** Override for tests; defaults to `fleetstate.ts`'s `defaultCachePath()`. */
  stateCachePath?: string;
  /** Web Push — present only when VAPID keys are configured. */
  push?: PushService;
  /** The seq+epoch record of what was actually pushed, so a reconnecting
   *  client can catch up on what it missed. Independent of `push`: it is
   *  useful even on a box with no VAPID keys configured. */
  notifyLog?: NotifyLog;
  /** Which sessions a human is currently looking at, so `FleetWatcher` can
   *  suppress a push for the pane already on screen. */
  presence?: Presence;
  /** The child-reclaim sweep's call into wave 3's executor, as a SEAM
   *  (child-reclamation wave 4). Production leaves it UNSET: the watcher then
   *  composes the one executor both triggers share — `reclaimChild` on the
   *  session's own `KeyedQueue` — so a close and a sweep reclaim identically.
   *  A test sets it to assert what the lane asks for without a fleet box. */
  childReclaimExec?: (req: ChildReclaimRequest) => Promise<ChildReclaimOutcome>;
  /** The process's monotonic clock in ms, read by the child-reclaim sweep lane alone. Unset in production: the lane
   *  reads `performance.now()`. A test sets it. */
  monotonicMs?: () => number;
  /** The box token every fleet->server POST must carry (coord/token.ts).
   *  Optional the same way `push`/`notifyLog` are in what a test must supply: a
   *  box with none configured (no holder, or a holder with no current value
   *  because its mint failed) refuses every box-token lane with a 401, verdict
   *  `unconfigured`, and boot says so; there is no unauthenticated mode. NOT optional the
   *  way `queue` refuses to be — there is no fallback here that could quietly
   *  construct a second, different token. A `BoxTokenHolder` since the box-token
   *  lifecycle (spec 4.2): the process's one accept-set, mutated in place by the
   *  driver, so every lane reads it here at request time and a rotation needs no
   *  restart. A literal string is what tests inject, with today's meaning. */
  mailToken?: string | BoxTokenHolder | null;
  /** The box-token driver as the token routes see it (`token/routes.ts`): the
   *  claim door, the hand-out commit, "Rotate now" and the view. Read at request
   *  time. Absent (tests, or a box whose driver was not built) means the claim
   *  door answers `404 no-claim` and the rotate route `501 not-configured`. */
  tokenDriver?: TokenRouteDriver;
  /** The coordination database (Build 7). Optional exactly like `push` and
   *  `notifyLog`: absent means the coord routes answer 501 and the mail lane
   *  never runs, which is what a box with no coordination configured should
   *  do. */
  coord?: CoordStore;
  /** The flat-file journal under `pool_edges`/`pool_epoch` (account-pool
   *  membership, design 2026-09-18 §5.2). Constructed in `index.ts` beside
   *  `coord`, not inside a route: `CoordStore.setAccountPools` calls
   *  `PoolEdgeLog.append` INSIDE its transaction, so the route needs the
   *  process's one instance, not a fixture-homed one — same shape as `coord`
   *  itself. Optional the same way `coord` is: a box with no coordination
   *  configured serves no pool-membership routes either. */
  poolEdgeLog?: PoolEdgeLog;
  /** The release-catalogue poller (design 2026-09-20 §7, `update/catalogue.ts`).
   *  Constructed in `index.ts` beside `coord`, whose one catalogue writer it
   *  calls; `FleetWatcher` polls it on its own 30-minute clock and
   *  `POST /api/updates/refresh` on demand. Optional the way `coord` is:
   *  absent, the lane never runs and the update routes read "never checked". */
  catalogue?: CataloguePoller;
  /** The flat-file journal under `update_intent`/`update_epoch` (design
   *  2026-09-20 §6), `poolEdgeLog`'s twin and for its reason:
   *  `CoordStore.setIntent` appends to it INSIDE its transaction, so
   *  `POST /api/updates/intent` needs the process's one instance, built in
   *  `index.ts` beside `coord`. Optional the same way `coord` is: absent, the
   *  intent route answers `501 not-configured`. */
  updateIntentLog?: UpdateIntentLog;
  /** The collector switch's journal and boot nonce (`CollectLaneDeps`), `updateIntentLog`'s twin for the journal's
   *  reason: the route and the collector's latch share the process's one instance. Optional the way `coord` is.
   *  Absent: `GET` and `POST /api/coord/collect-lane` answer `501 not-configured`, and the collector reads its control
   *  state as `journal-not-configured`, never as a missing journal, which would be the bootstrap. */
  collectLane?: CollectLaneDeps;
  /** Design 2026-09-20 §10 (wave 5): the SERVER-role node's own move, spawned on this box with the same absolute
   *  argv the agent uses. A two-template capability, never a raw `Runner` — a runner here would give every
   *  route a way around `runCcd` (D-3397). `localUpdateSpawnFor(realRunner, cfg.home)` in
   *  `index.ts`, both arms; absent → the dispatcher notes the server row and moves nothing there. */
  updateRunner?: LocalUpdateSpawn;
  /** Design 2026-09-20 §10 (wave 5): the fleet link's `request()` narrowed to the `update` op, with
   *  `UPDATE_OP_TIMEOUT_MS`. Remote mode only — in local mode no node is link-reached. */
  sendUpdateOp?: SendUpdateOp;
  /** D-5516 (accounts plan Task A7): the account audit over this process's one coord.db, built in `index.ts`.
   *  Absent → no row is written (a test, a script). */
  accountAudit?: AccountAudit;
  /** Spec §13.2, G13 (accounts plan Task A7): the ONE `AccountOps` arm, chosen in `index.ts` by `cfg.fleetMode` only
   *  (`accountOpsFor`). The account routes (A14 onward) are its consumers. */
  accountOps?: AccountOps;
}
