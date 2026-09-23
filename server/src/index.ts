import { buildServer, type Deps } from './server.js';
import { derivedRoleNote, loadConfig } from './config.js';
import { readBuildInfo, type BuildInfo } from './buildinfo.js';
import { realRunner, Tmux } from './exec.js';
import { ccdRunner } from './lifecycle.js';
import { localIO } from './io.js';
import { attachPty } from './pty.js';
import { Bus } from './bus.js';
import { FleetWatcher } from './watch.js';
import { connectFleet } from './remote/client.js';
import { makeRefreshCaps } from './refreshcaps.js';
import { PushService } from './push.js';
import { NotifyLog } from './notifylog.js';
import { Presence } from './presence.js';
import { KeyedQueue } from './inject/queue.js';
import { readMailToken } from './coord/token.js';
import { openCoordDb } from './coord/db.js';
import { CoordStore } from './coord/store.js';
import { PoolEdgeLog, defaultPoolEdgeLogPath } from './coord/pooledgelog.js';
import { readLocalCcdCaps } from './localcaps.js';
import { apiBaseProblem, createCataloguePoller } from './update/catalogue.js';
import path from 'node:path';

const cfg = loadConfig();

// Read once at boot: what THIS box's deploy stamped it as, or null on a dev
// checkout / never-stamped box. See buildinfo.ts — never a throw.
const build = readBuildInfo(cfg.buildInfoPath);

// Web Push is optional — only wired when a VAPID keypair is configured.
const push = cfg.vapidPublic && cfg.vapidPrivate
  ? new PushService(
      { publicKey: cfg.vapidPublic, privateKey: cfg.vapidPrivate, subject: cfg.vapidSubject },
      path.join(cfg.home, '.ccrc', 'push-subs.json'),
    )
  : undefined;

// Unlike `push`, these need no configuration — the catch-up log and presence
// suppression are useful even on a box with no VAPID keys, so both are always
// wired. Same directory as the push subscription store.
const notifyLog = new NotifyLog(path.join(cfg.home, '.ccrc', 'notify-log.json'));
const presence = new Presence();

// D-57 (Task 11 review): this line said /api/notify AND /api/mail "accept
// unauthenticated callers" — true the day it landed (eb9c88a), false since
// D-39 (Task 7 fix round) made `checkMailToken(null, …)` answer
// `'unconfigured'`, which BOTH mail gates (`routes.ts`'s ingress and ack)
// treat as `verdict !== 'ok'` and refuse with 401 — in their own words,
// "/api/mail fails shut on an unconfigured token, it does not fail open."
// Only `/api/notify` still passes an unconfigured token through (`server.ts`
// has no `'unconfigured'` arm on that gate, and logs nothing on that path
// either). The two routes now have OPPOSITE postures on a missing token, and
// this was the one line an operator would grep the journal for.
const mailToken = readMailToken(cfg.mailTokenPath);
if (mailToken === null) {
  console.warn(`ccrc-server: no box token at ${cfg.mailTokenPath} — /api/notify accepts ` +
    'unauthenticated callers (its one-deploy legacy tolerance), while /api/mail and ' +
    '/api/mail/:id/ack FAIL SHUT and refuse every caller with 401 — the mail bus is dead, not ' +
    'open. Ship a token with deploy.sh (see deploy/ccrc-mail.token.example).');
}

// Opened at the root, before the watcher: a database that cannot be migrated
// must stop the process, not be discovered by the first sweep that touches
// it. The throw is deliberately uncaught — `deploy.sh`'s `verify-service.sh
// ccrc.service` (added this build) is what turns it into a failed deploy with
// the journal tail attached, rather than a green deploy in front of a
// three-second crash loop.
const coord = new CoordStore(openCoordDb(cfg.coordDbPath));

// The process's ONE `PoolEdgeLog` — beside `coord`, same reason as
// `routes.ts`'s `LedgerLog`: `CoordStore.setAccountPools` calls `log.append`
// INSIDE its transaction, so every caller needs to share this one instance
// rather than each route constructing its own.
const poolEdgeLog = new PoolEdgeLog(defaultPoolEdgeLogPath(cfg.home));

// The process's ONE catalogue poller (design 2026-09-20 §7), beside `coord`
// because its only write is `coord.applyReleaseListing`. Its state and ETag
// are memory (D-3182). A box whose release source
// could not be read (Task 9, D-3175) still builds one: every poll
// then answers `no-release-source` and sends nothing — said once, here.
const catalogue = createCataloguePoller({ source: cfg.releaseSource, apiUrl: cfg.releaseApiUrl, store: coord });
if (cfg.releaseSource.ok === false) {
  // `env-malformed` carries `path: null` (Task 9): the fault is the env pair, not a file.
  const where = cfg.releaseSource.why === 'env-malformed'
    ? 'CCRC_RELEASE_OWNER/CCRC_RELEASE_REPO are both set and one is not a plain GitHub name'
    : cfg.releaseSource.path;
  console.warn(`ccrc-server: no release source (${cfg.releaseSource.why}: ${where}) — the update ` +
    'catalogue will not poll. Set BOTH CCRC_RELEASE_OWNER and CCRC_RELEASE_REPO in ~/.ccrc/ccrc.env, or run the ' +
    'server from an installed tree whose ccd/ccrc carries its release-source lines.');
}
// D-3209: validated once, beside the release-source check above — a bad
// `apiUrl` is just as fatal to the catalogue lane as a missing owner/repo.
const releaseApiUrlProblem = apiBaseProblem(cfg.releaseApiUrl);
if (releaseApiUrlProblem !== null) {
  console.warn(`ccrc-server: ${releaseApiUrlProblem} — the update catalogue will not poll.`);
}

// ONE queue, above the mode branch, so both modes and both consumers get the
// same object. Serialising the naming sweep's rename against
// POST /workspace/reap is the point; a per-consumer queue would serialise a
// call only against itself.
const queue = new KeyedQueue();

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
    cfg, build, runCcd: ccdRunner(fleet.runner, cfg), tmux: new Tmux(fleet.runner), io: fleet.io,
    spawnPty: fleet.spawnPty, fleetState: fleet.state, push, notifyLog, presence, queue, mailToken, coord,
    poolEdgeLog,
    catalogue,
    refreshCaps: makeRefreshCaps(fleet.client, fleet.state),
  };
} else {
  // Fix round 3 (task 14, Important #3): real evidence, not an absent
  // `fleetState` — `stopSurfaceSupported` (and any future capability that
  // adopts its inverted, refuse-on-no-evidence default) would otherwise be
  // permanently dead in this, the DEFAULT deployment mode.
  //
  // NOT AWAITED (fix round 4, task 14, Important #1): `readLocalCcdCaps` is
  // bounded (`LOCAL_CAPS_TIMEOUT_MS`), but bounded is still a delay on the
  // boot path if this line blocks on it — measured against a `ccd` stub
  // that merely sleeps: the whole point of NOT gating `app.listen()` on
  // this is that the server should be answering `/health` immediately,
  // with `ccdVerbs: null` (no evidence — the honest, already-safe answer
  // both `verbSupported` and `stopSurfaceSupported` give it) until the
  // real read resolves and mutates this object in place — the exact
  // pattern `refreshcaps.ts`'s `makeRefreshCaps` already uses for the
  // remote-mode timer, applied once here instead of on a schedule.
  const fleetState = {
    connected: true, downSince: null, ccdVerbs: null as string[] | null,
    // `rosterFp` stays null in local mode BY MEASUREMENT, not by omission:
    // there is no second box, so there is no installed projection to compare
    // ours against, and `rosterAgreement` maps null to `'unknown'` — never
    // `'divergent'`. Reporting a digest here would be reporting agreement
    // with ourselves, which is the one answer the banner must not show.
    rosterFp: null as string | null,
    // Null for the same reason, one comparison down: `build` on this object
    // means "what the OTHER box reported", and in local mode there is no other
    // box. Putting this process's own stamp here would make `buildAgreement`
    // compare it with itself and answer `'agreed'` — a green tick for a check
    // that never ran, and the one answer worse than saying nothing.
    build: null as BuildInfo | null,
    // `observedEpoch` is OMITTED entirely (review T8-R1, F6), not set to an
    // explicit `null` the way `rosterFp`/`build` are just above — and this is
    // a DIFFERENT reason, not the same one restated. Those two are
    // cross-box COMPARISONS with no second box to compare against in local
    // mode, so `null` there is a considered "not applicable". `observedEpoch`
    // is not a comparison — it is a fact about what pool epoch THIS box
    // holds, which this box, running its own `ccd` locally, could in
    // principle answer. Nothing here reads `~/.cc-sessions/pool-epoch` to
    // populate it, so the omission is an honest gap (no evidence gathered),
    // not a decided absence — `fleetstate.ts`'s own comment on this field
    // says the same. `FleetState` declares the field OPTIONAL, so the
    // omitted key reads as `undefined` on access either way.
  };
  void readLocalCcdCaps(cfg.ccdBin).then((verbs) => {
    if (verbs !== null) fleetState.ccdVerbs = verbs;
  });
  deps = {
    cfg, build, runCcd: ccdRunner(realRunner, cfg), tmux: new Tmux(realRunner), io: localIO,
    spawnPty: attachPty, push, notifyLog, presence, queue, mailToken, coord,
    poolEdgeLog,
    catalogue,
    // `connected`/`downSince` are inert for local mode — every reader of
    // them is gated on `cfg.fleetMode === 'remote'` first (server.ts,
    // watch.ts) — so `true`/`null` are placeholders, never read as a claim
    // about remote fleet reachability. `ccdVerbs` is the one field this
    // object exists to carry — `rosterFp` is inert here for the reason
    // stated at its own initializer above.
    fleetState,
  };
}

// Loaded before anything that could touch it (the watcher's first tick can
// fire a push the instant it starts) — a load racing a record would let a
// freshly-minted epoch silently supersede the one events were just recorded
// under.
await notifyLog.load();

const bus = new Bus();
const watcher = new FleetWatcher(deps, bus);

const app = await buildServer(deps, bus, watcher);
watcher.start();
await app.listen({ host: cfg.host, port: cfg.port });
console.log(`ccrc-server on ${cfg.host}:${cfg.port} (fleet=${cfg.fleetMode})`);

// Said once at boot, beside the line above: a role DERIVED because CCRC_ROLE
// is absent or invalid (D-3174) is visible nowhere else — the
// inventory's server row carries the role, never where it came from.
const roleNote = derivedRoleNote(cfg);
if (roleNote !== null) console.warn(roleNote);
