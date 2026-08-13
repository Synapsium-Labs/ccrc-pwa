import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { configDirFor, type CcrcConfig } from './config.js';
import type { BuildInfo } from './buildinfo.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import { assembleFleet, liveStatus } from './fleet.js';
import { readLimits, projectHome } from './limits.js';
import { defaultCachePath, loadSnapshot, type FleetState } from './fleetstate.js';
import { CCD_ARGV, verbSupported, type CcdArgv } from './ccdargv.js';
import { parsePrLines, prView, unknownView } from './prstate.js';
import { parseAudit, parseReap } from './wsaudit.js';
import { readTasks } from './tasks/read.js';
import { Bus, type Notice } from './bus.js';
import type { FleetWatcher } from './watch.js';
import { SessionStream, parseSince } from './sessionws.js';
import { KeyedQueue } from './inject/queue.js';
import { sendPrompt, answerDialog, interrupt, submitEnter, type SendDeps } from './inject/send.js';
import { answerAsk, type AskDeps } from './inject/ask.js';
import { measuredIdentity, readRegistry, readSessionRecord } from './registry.js';
import { readHookState } from './hookstate.js';
import { listProjects, type CcdResult } from './lifecycle.js';
import { sessionCommands } from './commands.js';
import { CLIP_NAME_RE, clipPath, isSafeSessionId, stageUpload } from './clip.js';
import type { SpawnPty } from './pty.js';
import type { PushService } from './push.js';
import type { NotifyLog } from './notifylog.js';
import { Presence } from './presence.js';
import { MAIL_TOKEN_HEADER, checkMailToken } from './coord/token.js';
import { registerCoordRoutes } from './coord/routes.js';
import { toRunSummary, type CoordStore } from './coord/store.js';
import {
  FLEET_PROTO, FLEET_PROTO_MIN,
  type AccountsResponse, type AccountUsage, type CoordStatus, type FleetMsg, type FleetSession,
  type RunSummary,
  type SessionClientMsg, type SessionStreamMsg, type TaskItem,
} from '../../shared/api.js';

/**
 * A client frame off the per-session socket, or null if it isn't one.
 *
 * VALIDATED against `SessionClientMsg` rather than cast to it: `JSON.parse`
 * hands back `any` from a browser we do not control, and `as SessionClientMsg`
 * would assert the very thing this is asked to check — the same rule
 * `shared/api.ts`'s revivers are built on. Restating the frame's shape inline
 * here was a second copy of a contract in the one file whose whole discipline
 * is not having one (whole-branch review, Minor 5): the type is the contract,
 * so a member added to it lands here as a compile error rather than as a frame
 * silently ignored.
 */
function asSessionClientMsg(raw: unknown): SessionClientMsg | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o['type'] !== 'visible' || typeof o['visible'] !== 'boolean') return null;
  return { type: 'visible', visible: o['visible'] };
}

/** Post-downscale ceiling for one attachment. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Ceiling on attachments per prompt — a sanity bound, not a UX limit. */
const MAX_ATTACHMENTS = 4;

/** Content-Type for the clip route, keyed by the (real) extension `clipName` wrote. */
const CLIP_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};

export interface Deps {
  cfg: CcrcConfig;
  /** The deploy's build stamp (buildinfo.ts, read once at boot from
   *  `cfg.buildInfoPath`). `null` on a dev checkout or an unstamped box;
   *  absent has the same meaning — `/health` treats both as null. */
  build?: BuildInfo | null;
  /** The ONLY path to `ccd`. There is deliberately no raw `run` here: with one,
   *  "every ccd argv is built in ccdargv.ts" is enforceable only by scanning
   *  source text, which was defeated four times in four rounds. The parameter
   *  type is the enforcement now — see task 13S and `CcdArgv`. */
  runCcd: (argv: CcdArgv) => Promise<CcdResult>;
  tmux: Tmux; io: FleetIO; spawnPty?: SpawnPty;
  /** Remote-mode reachability, straight from `connectFleet().state` — absent
   *  (or ignored) in local mode, where the fleet is always "connected". */
  fleetState?: FleetState;
  /** Remote mode only. Local mode reads ccd directly and has nothing to
   *  refresh, so its absence is the mode test — the same shape `fleetState`
   *  already uses. */
  refreshCaps?: () => Promise<void>;
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
  /** The box token every fleet->server POST must carry (coord/token.ts).
   *  Optional the same way `push`/`notifyLog` are: a box with none configured
   *  keeps working, unauthenticated, and says so once at boot. NOT optional the
   *  way `queue` refuses to be — there is no fallback here that could quietly
   *  construct a second, different token. */
  mailToken?: string | null;
  /** The coordination database (Build 7). Optional exactly like `push` and
   *  `notifyLog`: absent means the coord routes answer 501 and the mail lane
   *  never runs, which is what a box with no coordination configured should
   *  do. */
  coord?: CoordStore;
}

/** dist-pwa/ lives at the server package root (next to dist/); walk up from this
 *  module — src/ in dev, dist/server/src/ compiled — to the first package.json. */
function findPwaRoot(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'package.json'))) {
      const pwa = path.join(dir, 'dist-pwa');
      return existsSync(path.join(pwa, 'index.html')) ? pwa : null;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export async function buildServer(deps: Deps, bus = new Bus(), watcher?: FleetWatcher): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // Presence is cheap and needs no config, unlike `push` — a caller that
  // didn't wire one into Deps (an older test, a one-off script) still gets
  // working suppression. Written BACK onto `deps`, not just held locally:
  // `FleetWatcher.pushOne` reads `this.deps.presence` on every push, and a
  // presence instance only this route can see would be write-only — the
  // route marks visibility nobody ever reads, so nothing is actually
  // suppressed. `deps` is a shared reference (the same object `FleetWatcher`
  // was constructed with, or will be), so this makes both sides see the
  // SAME instance regardless of construction order.
  deps.presence ??= new Presence();
  const presence = deps.presence;

  app.get('/health', async () => ({ ok: true, build: deps.build ?? null }));

  const stateCachePath = deps.stateCachePath ?? defaultCachePath();

  // Degraded mode: while the remote fleet host is unreachable, serve the
  // last-known-good snapshot (fleetstate.ts, written by FleetWatcher on every
  // successful poll) instead of a live assemble that would otherwise read as
  // an empty fleet. `stale`/`downSince` let the PWA bannner explain why.
  app.get('/api/fleet', async () => {
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState && !deps.fleetState.connected) {
      const snap = await loadSnapshot(stateCachePath);
      if (snap) return { sessions: snap.sessions, stale: true, downSince: deps.fleetState.downSince };
    }
    return { sessions: await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates(), watcher?.currentHookStates()) };
  });

  app.get('/api/fleet/health', async () => {
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState) {
      return { mode: 'remote', connected: deps.fleetState.connected, downSince: deps.fleetState.downSince };
    }
    return { mode: deps.cfg.fleetMode, connected: true, downSince: null };
  });

  // Fleet-host reboot: guarded to remote mode with Hetzner creds configured.
  // The fleet box is shared with the rp-llm stack — the PWA's confirm dialog
  // names that collateral before this ever fires.
  app.post('/api/fleet/reboot', async (req, reply) => {
    if (deps.cfg.fleetMode !== 'remote') return reply.code(409).send({ ok: false, error: 'not-remote' });
    const { hetznerToken, fleetServerId } = deps.cfg;
    if (!hetznerToken || !fleetServerId) return reply.code(501).send({ ok: false, error: 'not-configured' });
    try {
      const res = await fetch(`https://api.hetzner.cloud/v1/servers/${fleetServerId}/actions/reboot`, {
        method: 'POST',
        headers: { authorization: `Bearer ${hetznerToken}`, 'content-type': 'application/json' },
      });
      if (!res.ok) return reply.code(502).send({ ok: false, error: 'hetzner-error' });
      return reply.code(202).send({ ok: true });
    } catch {
      return reply.code(502).send({ ok: false, error: 'hetzner-error' });
    }
  });

  // Web Push: the PWA fetches the VAPID public key, then registers its push
  // subscription here. Notifications fire from the FleetWatcher on a new
  // question or a busy→idle finish. 501 when push isn't configured.
  app.get('/api/push/key', async (_req, reply) => {
    if (!deps.push) return reply.code(501).send({ error: 'not-configured' });
    return { key: deps.push.publicKey };
  });
  app.post('/api/push/subscribe', async (req, reply) => {
    if (!deps.push) return reply.code(501).send({ error: 'not-configured' });
    const sub = req.body as { endpoint?: unknown; keys?: unknown };
    if (typeof sub?.endpoint !== 'string' || typeof sub?.keys !== 'object' || sub.keys === null) {
      return reply.code(400).send({ error: 'bad-subscription' });
    }
    await deps.push.subscribe(sub as never);
    return reply.code(201).send({ ok: true });
  });
  app.post('/api/push/unsubscribe', async (req, reply) => {
    const ep = (req.body as { endpoint?: unknown })?.endpoint;
    if (deps.push && typeof ep === 'string') await deps.push.unsubscribe(ep);
    return { ok: true };
  });

  // A phone that was offline (asleep, backgrounded past the SW's leash, or
  // simply off) has no way to learn what it missed — this is the pull side of
  // that gap. `resync: true` when the epoch moved or the client's seq predates
  // the retained ring: the honest answer is "I cannot prove you saw
  // everything", and the client's job is to drop its watermark and trust the
  // fresh fleet snapshot rather than fabricate badges for events it cannot
  // enumerate. 501 when no log is wired (same shape as the push routes above).
  app.get('/api/notifications/catchup', async (req, reply) => {
    if (!deps.notifyLog) return reply.code(501).send({ error: 'not-configured' });
    const q = req.query as { epoch?: string; seq?: string };
    const seq = Number(q.seq);
    return deps.notifyLog.catchUp(q.epoch ?? null, Number.isFinite(seq) ? seq : 0);
  });

  // Account usage read straight from telemetry (cc-limits), independent of which
  // sessions are running or where they've swapped — so it survives restarts,
  // respawns, and swaps. Ordered by the roster's declaration order.
  app.get('/api/accounts', async (): Promise<AccountsResponse> => {
    const limits = await readLimits(deps.io, deps.cfg);
    // Rebuilt per request from `deps.cfg.roster`, not hoisted to module scope:
    // the roster is runtime data read at boot (`~/.ccrc/accounts.json`), so a
    // module-level rank table would be built before any roster exists.
    //
    // The unknown-wrapper fallback is load-bearing and stays: a wrapper the
    // roster does not have — a stale `.cc-limits/<name>.json` from a removed
    // account, a typo'd registry write — sorts LAST rather than disappearing off
    // the screen, and `accounts-route.test.ts` pins exactly that.
    //
    // `order.length`, not the `99` it was written as: 99 was safe by
    // construction while `Wrapper` was a five-member union, and stopped being
    // safe the moment the roster became arbitrary JSON off disk. A 100th
    // account would have TIED with every unknown and fallen through to the
    // alphabetical tie-break below — the roster's declaration order silently
    // abandoned past the hundredth entry. This is the widening quietly dropping
    // a bound the compiler used to guarantee (review round 1, finding 3);
    // `order.length` is exact, is always one past the last real rank, and costs
    // nothing.
    const order = deps.cfg.roster.accounts.map((a) => a.id);
    const rank = (w: string): number => { const i = order.indexOf(w); return i < 0 ? order.length : i; };
    const accounts: AccountUsage[] = Object.entries(limits)
      .map(([wrapper, l]): AccountUsage => ({
        wrapper, five: l.five, seven: l.seven, ts: l.ts,
        fiveResetAt: l.fiveResetAt, sevenResetAt: l.sevenResetAt,
        fiveRolledOver: l.fiveRolledOver, sevenRolledOver: l.sevenRolledOver,
        disabled: l.disabled,
      }))
      .sort((a, b) => rank(a.wrapper) - rank(b.wrapper) || (a.wrapper < b.wrapper ? -1 : 1));
    // Where a new workspace would land, computed HERE from the same telemetry
    // rather than in the PWA: ccd's `_ws_least_loaded` is the routing rule and
    // this is already the second implementation of it — a third would drift
    // from both. The `+` only displays what this says.
    //
    // `roster` ships every account the box knows, including ones telemetry has
    // never mentioned — `accounts` above is built from `.cc-limits/*.json`, so
    // an account that has never run has no row there at all, and the PWA would
    // otherwise have no way to learn its label or colour. Only the fields a
    // browser can use (`RosterWire`): `exec`, `configDirSuffix` and `telemetry`
    // stay server-side.
    return {
      accounts,
      projected: projectHome(deps.cfg.roster, limits),
      roster: deps.cfg.roster.accounts.map((a) => ({
        id: a.id, label: a.label, hue: a.hue, homeAble: a.homeAble,
      })),
    };
  });

  app.get('/ws/fleet', { websocket: true }, (socket) => {
    // The dormant protocol handshake (Rider E): sent SYNCHRONOUSLY, before the
    // awaited assembleFleet below, so it is always the first frame a client
    // sees — the one thing a stale client needs to learn before anything else
    // arrives. Every already-deployed PWA drops an unknown frame type
    // silently (fleet.ts), so this costs nothing while FLEET_PROTO_MIN stays
    // at FLEET_PROTO; it only bites the day MIN is raised on purpose.
    socket.send(JSON.stringify({ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO_MIN } satisfies FleetMsg));
    const onFleet = (sessions: FleetSession[]) =>
      socket.send(JSON.stringify({ type: 'fleet', sessions } satisfies FleetMsg));
    const onNotice = (n: Notice) => socket.send(JSON.stringify({ type: 'notice', ...n } satisfies FleetMsg));
    const onRuns = (runs: RunSummary[]) =>
      socket.send(JSON.stringify({ type: 'runs', runs } satisfies FleetMsg));
    const onCoord = (coord: CoordStatus) =>
      socket.send(JSON.stringify({ type: 'coord', coord } satisfies FleetMsg));
    // The `runs` cold start is chained AFTER `fleet`'s own, not fired
    // alongside it: `fleet` is itself async (`assembleFleet` awaits tmux/IO),
    // while a `coord.runs()` read is synchronous, so firing both
    // independently would race — and often WIN, sending `runs` before
    // `fleet` ever resolves. Chaining pins the wire order every client (and
    // `fleetws.test.ts`) can rely on: hello, fleet, runs.
    void assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates(), watcher?.currentHookStates()).then((sessions) => {
      onFleet(sessions);
      // Cold start for THIS socket, same reasoning as the `fleet` push just
      // above: the `runs` frame is only emitted ON CHANGE (`FleetWatcher.
      // emitRuns`'s own byte-equality guard), so a client connecting into a
      // quiet fleet would otherwise see no runs until one moved. No `coord`
      // -> no frame at all, same as every other coord-gated surface here.
      //
      // GUARDED (review finding 1): `coord.runs()` is a synchronous
      // `node:sqlite` read, and this `.then()` callback has no `.catch`
      // anywhere on its chain — an unguarded throw here (a full disk, a
      // second connection holding coord.db's write lock) becomes an
      // unhandled promise rejection and kills the server for every socket,
      // not just the one client connecting. Skipping the cold-start `runs`
      // frame is the honest degrade: the socket still gets `hello`/`fleet`,
      // and the next real transition's `FleetWatcher.emitRuns` broadcast
      // reaches it exactly as it would any other already-connected client.
      if (deps.coord) {
        try { onRuns(deps.coord.runs().map(toRunSummary)); }
        catch (err) {
          console.warn(`ccrc-server: /ws/fleet cold-start runs() failed (${err instanceof Error ? err.message : String(err)})`);
        }
      }
      // Chained after `runs` inside this SAME `.then`, for the reason above:
      // the wire order every client and `fleetws.test.ts` rely on is hello,
      // fleet, runs, coord. Unlike `runs` this needs no `try` — it is a field
      // read off the watcher, no `node:sqlite` anywhere — and no `deps.coord`
      // gate either: a pause is a fleet-host file, and a box with no
      // coordination database still has one.
      //
      // A `null` current value sends NOTHING. That is the whole rule: this
      // process has never measured, and a fabricated `clear` here would render
      // "running" for a state nobody has looked at (Build 4, spec §4.2).
      const coordNow = watcher?.currentCoord();
      if (coordNow) onCoord(coordNow);
    });
    bus.on('fleet', onFleet);
    bus.on('notice', onNotice);
    bus.on('runs', onRuns);
    bus.on('coord', onCoord);
    socket.on('close', () => {
      bus.off('fleet', onFleet);
      bus.off('notice', onNotice);
      bus.off('runs', onRuns);
      bus.off('coord', onCoord);
    });
  });

  // Swap-notice ingestion: ccd's ~/.cc-sessions/notify.sh hook POSTs here.
  // Every notice fans out fleet-wide; a `cc swap:` message also targets the
  // moved session's stream so its chat surfaces the account change inline.
  //
  // AUTHENTICATED SINCE BUILD 7 (operator ruling, spec:150-155). This was the
  // one box->server ingress carrying zero identity while the server
  // regex-routed its body INTO a session's chat stream — see `checkMailToken`
  // for the one-deploy-generation tolerance and for when it comes out.
  app.post('/api/notify', async (req, reply) => {
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
    if (verdict === 'bad') {
      // `Fastify({ logger: false })` (above) means a bare 401 leaves NOTHING
      // in the journal — three silent layers stack on top of it too
      // (notify.sh's own `|| true`, and ccd invoking it with its output
      // redirected to `/dev/null`), so this line is the only place a wrong
      // token — a stray trailing space, a stale copy after a rotation — ever
      // becomes visible to an operator, the same way `legacy` already is
      // below. Never logs the presented value: that would put the secret
      // (or a caller's guess at it) in a log file readable by anyone who can
      // read the log.
      console.warn('ccrc-server: /api/notify refused a request with the WRONG box token (401) — ' +
        'check that deploy/ccrc-mail.token matches on both boxes byte-for-byte');
      return reply.code(401).send({ ok: false, error: 'unauthenticated' });
    }
    if (verdict === 'legacy') {
      console.warn('ccrc-server: /api/notify accepted a request with NO box token (legacy ' +
        'tolerance, one deploy generation) — deploy the agent to ship the new notify.sh');
    }
    const body = (req.body ?? {}) as { message?: unknown };
    if (typeof body.message !== 'string') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const message = body.message;
    bus.emit('notice', { message });
    const swap = /^cc swap: (\S+) moved (\S+) -> (\S+)/.exec(message);
    if (swap) bus.emit(`session:${swap[1]}`, { type: 'notice', message });
    return { ok: true };
  });

  // Build 7 coordination: mail ingress + ack (this build) and run routes
  // (Task 9) — registered from their own module because six-plus routes
  // sharing one token+attribution gate inline here would be a second copy of
  // that gate. 501 `{ok:false,error:'not-configured'}` without `deps.coord`,
  // the same shape as the push routes and `/api/notifications/catchup` above.
  registerCoordRoutes(app, deps, bus);

  app.get('/ws/session/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const since = parseSince((req.query as { since?: string }).since);
    const stream = new SessionStream(deps, bus, id, (m: SessionStreamMsg) => socket.send(JSON.stringify(m)), since);
    void stream.start();
    // A per-connection token, not the session id: one socket's close drops
    // only its OWN claim, so a second tab watching the same session doesn't
    // get un-notified by the first one's disconnect. It is the TTL, not this
    // key, that handles a socket dying WITHOUT a close frame — every frame
    // below re-stamps the claim, and the client sends one every
    // PRESENCE_REFRESH_MS for exactly that reason (see Presence's own doc).
    const token = Symbol('viewer');
    socket.on('message', (raw) => {
      try {
        const m = asSessionClientMsg(JSON.parse(String(raw)));
        if (m !== null) presence.setVisible(token, m.visible ? id : null);
      } catch { /* a client that sends garbage simply isn't reporting presence */ }
    });
    socket.on('close', () => {
      presence.drop(token);
      stream.stop();
    });
  });

  // Terminal drawer: attach a pty to the session's tmux window. Lazy-import the
  // native node-pty binding only when no stub is injected (keeps tests hermetic).
  const spawnPty: SpawnPty = deps.spawnPty ?? (await import('./pty.js')).attachPty;
  const dim = (v: string | undefined, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
  };

  app.get('/ws/pty/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { cols?: string; rows?: string };
    const p = spawnPty(id, dim(q.cols, 80), dim(q.rows, 24));
    const sub = p.onData((data) => socket.send(data));   // server->client: raw utf8 frames
    socket.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw)) as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
        if (m.type === 'input' && typeof m.data === 'string') p.write(m.data);
        else if (m.type === 'resize' && typeof m.cols === 'number' && typeof m.rows === 'number') {
          p.resize(m.cols, m.rows);
        }
      } catch { /* ignore malformed frames */ }
    });
    socket.on('close', () => {
      sub.dispose();
      p.kill();
      // Restore the canonical size ccd spawned with — a phone-sized drawer must
      // not leave the session shrunken (wrapped panes break capture parsing).
      void deps.tmux.resizeWindow(id, 220, 50);
    });
  });

  // Write routes: serialized per session through one KeyedQueue; injection
  // errors map to 409 with the {ok:false,...} body, unknown session ids to 404.
  const sendDeps: SendDeps = { tmux: deps.tmux, queue: deps.queue };
  // C0.2: `knownId` gates 16 routes on this id (12 POST, 4 GET — every one of
  // them a per-request check, not a periodic sweep) and previously called
  // `readRegistry` — up to 505 agent-WS round trips on a 24-session fleet, in
  // remote mode, in front of every human keystroke — purely to answer "does
  // this id exist". It carries no identity of its own: `isSafeSessionId` is
  // the real injection guard, and ccd re-checks `[[ -f "$REG/$id.uuid" ]]` on
  // the box regardless. One
  // `readdir` plus membership in the listing is the SAME evidence
  // `coord/routes.ts`'s `names.includes(`${fromId}.uuid`)` already trusts for
  // exactly this question, and it fails shut the same way `readRegistry`
  // always did: an unlistable registry directory reads as "unknown", never as
  // "known".
  //
  // Side benefit: this no longer runs `readRegistry`'s full per-session parse
  // (21 fields, each dropped whole on ANY single field read failing — see
  // `registry.ts`'s "incomplete registry entry" comment), so a transient
  // failure to read one of a LIVE session's own sibling fields (e.g.
  // `workdir`) can no longer 404 a prompt typed into that session.
  const knownId = async (id: string): Promise<boolean> => {
    const names = await deps.io.readdir(deps.cfg.registryDir);
    return names !== null && names.includes(`${id}.uuid`);
  };

  // Same queue/tmux as sendDeps — answerAsk and sendPrompt/answerDialog must
  // serialize through the ONE per-session lock, not independent ones.
  const askDeps: AskDeps = {
    ...sendDeps,
    // C0.3: one session's own row, not the whole registry — see
    // `registry.ts`'s `readSessionRecord`.
    readAsk: async (id: string) => {
      const read = await readSessionRecord(deps.io, deps.cfg, id);
      if (!read.found) return null;
      // Display/connectivity — DEGRADE-AND-HEAL: an unmeasured uuid would
      // look up hookstate under a value that matches no real file, reading
      // as "no ask" rather than "we don't know" — null here is the honest
      // answer and this route is polled, so it heals on the next read.
      const identity = measuredIdentity(read.record);
      if (identity === null) return null;
      const hs = await readHookState(deps.io, deps.cfg.registryDir, id, identity.uuid, Date.now());
      return hs === null ? null : { ask: hs.ask, state: hs.state };
    },
  };

  app.post('/api/sessions/:id/prompt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { text?: unknown; replaceDraft?: unknown; attachments?: unknown };
    const raw = Array.isArray(body.attachments) ? body.attachments : [];
    if (raw.length > MAX_ATTACHMENTS) {
      return reply.code(400).send({ ok: false, error: 'bad-attachment' });
    }
    const attachments: string[] = [];
    for (const a of raw) {
      if (typeof a !== 'string') return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      const name = a.slice(a.lastIndexOf('/') + 1);
      if (!CLIP_NAME_RE.test(name)) {
        return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      }
      let resolved: string;
      try {
        resolved = clipPath(deps.cfg.clipsDir, id, name);
      } catch {
        return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      }
      // The client must name the file that staging returned, in THIS session.
      if (resolved !== a) return reply.code(400).send({ ok: false, error: 'bad-attachment' });
      attachments.push(resolved);
    }
    if (typeof body.text !== 'string' || (body.text.length === 0 && attachments.length === 0)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await sendPrompt(sendDeps, id, body.text, { replaceDraft: body.replaceDraft === true, attachments });
    return res.ok ? res : reply.code(409).send(res);
  });

  app.post('/api/sessions/:id/dialog', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { dialogId?: unknown; optionIndex?: unknown };
    if (typeof body.dialogId !== 'string' || typeof body.optionIndex !== 'number') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await answerDialog(sendDeps, id, body.dialogId, body.optionIndex);
    return res.ok ? res : reply.code(409).send(res);
  });

  app.post('/api/sessions/:id/ask', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { askKey?: unknown; optionIndexes?: unknown };
    if (typeof body.askKey !== 'string' ||
        !Array.isArray(body.optionIndexes) ||
        !body.optionIndexes.every((n) => typeof n === 'number')) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await answerAsk(askDeps, id, body.askKey, body.optionIndexes);
    return res.ok ? res : reply.code(409).send(res);
  });

  app.get('/api/sessions/:id/commands', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    return sessionCommands(deps, id);
  });

  app.post('/api/sessions/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const res = await interrupt(sendDeps, id, async () => (await liveStatus(deps.io, deps.cfg, deps.tmux, id)) === 'busy');
    return res.ok ? res : reply.code(409).send(res);
  });

  app.post('/api/sessions/:id/submit', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    // `expect` is REQUIRED and must say something: this route presses Enter on
    // whatever the box holds, so a caller that cannot state what it believes is
    // there has no business submitting it (see `submitEnter`'s own doc). A
    // blank claim would gate on nothing — `draftOf` never returns a blank
    // non-empty row — so it is refused here rather than silently accepted.
    const body = (req.body ?? {}) as { expect?: unknown };
    if (typeof body.expect !== 'string' || body.expect.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await submitEnter(sendDeps, id, body.expect);
    return res.ok ? res : reply.code(409).send(res);
  });

  // Lifecycle + projects routes: shell out to ccd; failures map to 502 with
  // stderr. Named for the response shape it adds, not for the call it makes —
  // `deps.runCcd` is the call, and routes needing another shape (a 200 carrying
  // `phase:unknown`, a parsed WsAudit/ReapResult, a 501 hoisted out of a queued
  // fn) compose from `deps.runCcd` directly rather than reaching for a runner.
  const runCcdOr502 = async (reply: FastifyReply, argv: CcdArgv) => {
    const res = await deps.runCcd(argv);
    return res.ok ? { ok: true } : reply.code(502).send({ ok: false, stderr: res.stderr });
  };

  app.get('/api/projects', async () => listProjects(deps.io, deps.cfg));

  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as { wrapper?: unknown; project?: unknown; workdir?: unknown; enable?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0
      || typeof body.project !== 'string' || body.project.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // enable = start + systemd enable. The ternary picks the ENTRY rather than
    // interpolating a verb into an array, so both spellings are enumerated by
    // whitelist-subset.test.ts and neither can drift out of the agent's list.
    const workdir = typeof body.workdir === 'string' && body.workdir.length > 0 ? body.workdir : undefined;
    return runCcdOr502(reply, body.enable === false
      ? CCD_ARGV.start(body.wrapper, body.project, workdir)
      : CCD_ARGV.enable(body.wrapper, body.project, workdir));
  });

  app.post('/api/sessions/:id/ensure', async (req, reply) => {
    const { id } = req.params as { id: string };
    return runCcdOr502(reply, CCD_ARGV.ensure(id));
  });

  app.post('/api/projects/:project/workspaces', async (req, reply) => {
    const { project } = req.params as { project: string };
    return runCcdOr502(reply, CCD_ARGV.wsAdd(project));
  });

  app.post('/api/sessions/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    // C0.3: one session's own row, not the whole registry.
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      // Fix (blocking review finding 3): `reason: 'unlistable'` is the SAME
      // registry-unmeasurable fact the identity gate three lines below
      // already answers 503 for — the whole-fleet cousin of a degraded row,
      // and just as much not a proof this session is unknown ("404 would be
      // a LIE" applies here too: the whole-fleet collapse proves nothing
      // about THIS id one way or the other). Only `reason: 'absent'` — a
      // listing that plainly does not name this id at all — earns the
      // terminal unknown-session answer; a route that answered 404 for both
      // would be reopening the exact overloaded-null this 503 gate exists
      // to close, one branch over.
      return reply.code(read.reason === 'unlistable' ? 503 : 404)
        .send({ ok: false, error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session' });
    }
    // REFUSE, not degrade: this is identity, and stopPair below RECOMPUTES a
    // wrapper/project pair from these very fields to kill a tmux session by
    // name. Two unmeasured fields could otherwise conspire to name the WRONG
    // session — 404 unknown-session would be a LIE (the row is right there,
    // just unmeasured), so this answers 503, the fleet's own
    // registry-unmeasurable shape, instead.
    const identity = measuredIdentity(read.record);
    if (identity === null) {
      return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
    }
    const rec = read.record;
    // A workspace id is `<project>-<slug>` and encodes no wrapper at all, so
    // there is nothing to reverse: the prefix rule below would fall through to
    // identity.wrapper and ccd would recompute `<wrapper>-<project>` — a
    // DIFFERENT, live session, killed while the workspace kept running and
    // the PWA reported success. ccd stop's one-argument form takes the id
    // whole.
    if (rec.workspace !== null) return runCcdOr502(reply, CCD_ARGV.stopId(id));
    // Legacy ids DO encode a wrapper, and ccd stop's two-argument form
    // recomputes them — so it needs the ORIGINAL wrapper baked into the id, not
    // identity.wrapper, which a prior swap flips to the new account while the
    // id/tmux name keep the old prefix.
    const originalWrapper = id.endsWith(`-${rec.project}`)
      ? id.slice(0, id.length - rec.project.length - 1)
      : identity.wrapper;
    return runCcdOr502(reply, CCD_ARGV.stopPair(originalWrapper, rec.project));
  });

  // Image upload: stage the bytes under ~/.cc-clips/<id>/ and return the path.
  // Nothing is typed into the session — the prompt route injects it at send.
  app.post('/api/sessions/:id/upload', async (req, reply) => {
    const { id } = req.params as { id: string };
    // Both gates run BEFORE req.file(). Replying without consuming the multipart
    // body can cost the client the JSON response, so drain first — same reason
    // the 415 path below calls part.file.resume().
    if (!isSafeSessionId(id)) {
      req.raw.resume();
      return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    }
    if (!(await knownId(id))) {
      req.raw.resume();
      return reply.code(404).send({ ok: false, error: 'unknown-session' });
    }
    const part = await req.file();
    if (!part) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const m = /\.(png|jpe?g|webp)$/i.exec(part.filename ?? '');
    if (!m) {
      part.file.resume();   // drain the rejected stream so the request finishes cleanly
      return reply.code(415).send({ ok: false, error: 'unsupported-type' });
    }
    const data = await part.toBuffer();
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ ok: false, error: 'too-large' });
    }
    const clip = await stageUpload(deps.io, deps.cfg, id, data, m[1]!.toLowerCase());
    return { ok: true, clip };
  });

  // Thumbnails for sent messages. Names are unique, so the bytes behind one can
  // never change — hence `immutable`.
  app.get('/api/sessions/:id/clip/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    if (!isSafeSessionId(id) || !CLIP_NAME_RE.test(name)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // `ccd stop` leaves the registry entry, so a stopped session's thumbnails
    // still resolve.
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    let file: string;
    try {
      file = clipPath(deps.cfg.clipsDir, id, name);
    } catch {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const b64 = await deps.io.readFileB64(file);
    if (b64 === null) return reply.code(404).send({ ok: false, error: 'not-found' });
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    return reply
      .type(CLIP_MIME[ext] ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(Buffer.from(b64, 'base64'));
  });

  app.post('/api/sessions/:id/swap', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { wrapper?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    return runCcdOr502(reply, CCD_ARGV.swap(id, body.wrapper));
  });

  // ── PR lifecycle ────────────────────────────────────────────────
  // Every one of these calls isSafeSessionId FIRST: the deleted workspace
  // route did not, and an id is about to become part of an argv.
  const prTasks = async (id: string): Promise<TaskItem[] | null> => {
    const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
    const cfgDir = rec ? configDirFor(deps.cfg, rec.wrapper) : undefined;
    return rec && cfgDir ? readTasks(deps.io, cfgDir, rec.uuid) : null;
  };

  app.get('/api/sessions/:id/pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.prStateSession(id);
    // Both of these are ANSWERS, not errors and never 502s: the cap must still
    // render, name the reason and offer Retry. `unknownView` is the only way
    // either is built — a branch returning a bare `{}` with no `pr` key is the
    // silence §2 forbids, and the client would render it as "no control" rather
    // than "we could not look".
    if (!verbSupported(deps.fleetState, argv)) return unknownView('unsupported');
    const res = await deps.runCcd(argv);
    if (!res.ok) return unknownView('agent-down');
    const [first] = parsePrLines(res.stdout);
    return prView(first ?? null, await prTasks(id), null);
  });

  app.post('/api/sessions/:id/pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { title?: unknown; body?: unknown; draft?: unknown };
    if (typeof body.title !== 'string' || body.title.trim() === ''
      || typeof body.body !== 'string' || body.body.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const b64 = Buffer.from(body.body, 'utf8').toString('base64');
    const argv = CCD_ARGV.prOpen(id, body.title, b64, body.draft === true);
    // Hoisted OUT of the queued fn, mirroring the reap route below. A 501 sent
    // from inside the queue callback returns a FastifyReply, which has no `ok`,
    // so the old `'ok' in res` guard fell through and reply.code(502).send()
    // ran after send() had already fired — FST_ERR_REP_ALREADY_SENT.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    // Through the per-session queue, so it serialises with every other write.
    const r = await sendDeps.queue.run(id, () => deps.runCcd(argv));
    return r.ok ? { ok: true } : reply.code(502).send({ ok: false, stderr: r.stderr });
  });

  app.post('/api/sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.wsArchive(id);
    // `ws-archive` is the SAME verb generation as `ws-audit` and `ws-reap` —
    // all four were added by this branch and all four sit consecutively in
    // `ccd caps` — so a fleet host on an older ccd dies in the verb's own
    // usage check, and `runCcdOr502` renders that as a bare 502 "the archive
    // failed". Same 501 body as every sibling, so the client can tell
    // "this host cannot" from "it tried and could not".
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });

  app.post('/api/sessions/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.wsRestore(id);
    // Same generation, same skew, same answer as `/archive` above.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });

  app.post('/api/sessions/:id/forget', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.forget(id);
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    // Every gate that decides the removal — not a workspace, not held, not
    // alive — is re-proven by ccd on the box; the server adds nothing to that
    // judgement. Through the per-session queue like the reap, so a purge
    // cannot interleave with another write to the same session.
    const r = await sendDeps.queue.run(id, () => deps.runCcd(argv));
    return r.ok ? { ok: true } : reply.code(502).send({ ok: false, stderr: r.stderr });
  });

  app.post('/api/sessions/:id/hold', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { reason?: unknown };
    // A hold nobody can explain is an orphan by construction — reject it here
    // too, before building any argv, rather than letting an empty string cross
    // the wire and die in ccd's refusal.
    //
    // `.trim()`, and ccd's `cmd_ws_hold` now agrees: its guard was `[[ -n
    // "$reason" ]]`, which passed `--reason "   "` while this one refused it,
    // and `registry.ts`'s `field()` trims what it reads — so a whitespace
    // reason landed as `held: ''`, enforced everywhere and displayed nowhere
    // (fix-wave finding 9). The three layers refuse the same INPUT; they do
    // not all say the same thing about it, and nothing should claim they do:
    // this one answers a 400 `bad-request` code with no sentence at all, which
    // is what a non-PWA client gets, while ccd and the composer share
    // `HOLD_EMPTY_REASON_TEXT`'s wording.
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const argv = CCD_ARGV.wsHold(id, body.reason);
    // Same verb generation and same skew answer as `/archive`/`/restore`
    // above — ws-hold/ws-release ship in the same branch that added them.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });

  app.post('/api/sessions/:id/release', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.wsRelease(id);
    // Same generation, same skew, same answer as `/hold` above.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });

  app.get('/api/sessions/:id/workspace/audit', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const argv = CCD_ARGV.wsAudit(id);
    // integration New Finding 10 — against a fleet host running a ccd without
    // `ws-audit`, the call went out anyway, ccd answered on stderr, `parseAudit`
    // returned null and the route 502'd — so version skew rendered as a failure
    // of the workspace rather than as the "unsupported" answer the rest of the
    // branch gives. Same shape and same body as the reap route below, which is
    // the route this one exists to feed: a 501 the client can tell apart from
    // "ccd tried and could not".
    //
    // ROUND-3 CORRECTION. The sentence that stood here claimed this was "the
    // ONE ccd route with no `verbSupported` gate (measured: server.ts:434,
    // :456, :499 had it, the audit route did not)". That was FALSE, and the
    // measurement it cited is why: it grepped for the routes that ALREADY HAD
    // a gate, not for the routes that NEEDED one. `/archive`, `/restore` and
    // `FleetWatcher.archiveMerged` were all missing theirs, all three are the
    // same verb generation as this route, and all three were added by this
    // same branch. All three are gated now. The claim of completeness is no
    // longer made in prose: `verb-gate.test.ts` parses `server/src` for every
    // `CCD_ARGV.*` call site and fails on an ungated one it has not been told
    // about, so the next omission breaks a test instead of being asserted away
    // by a comment.
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    const res = await deps.runCcd(argv);
    const audit = parseAudit(res.stdout);
    if (audit === null) return reply.code(502).send({ ok: false, stderr: res.stderr });
    return audit;
  });

  app.post('/api/sessions/:id/workspace/reap', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { expect?: unknown };
    // The shape check is a courtesy, not the guard: the guard is that ccd
    // recomputes the fingerprint and compares it there.
    if (typeof body.expect !== 'string' || !/^[0-9a-f]{64}$/.test(body.expect)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const argv = CCD_ARGV.wsReap(body.expect, id);
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    const res = await sendDeps.queue.run(id, () => deps.runCcd(argv));
    return parseReap(res.stdout, res.ok ? 0 : 1, res.stderr);
  });

  // Static PWA (populated by Plan 2's build): serve dist-pwa/ at / with SPA
  // fallback to index.html; absent -> skip (API-only mode).
  const pwaRoot = findPwaRoot();
  if (pwaRoot) {
    await app.register(fastifyStatic, { root: pwaRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ ok: false, error: 'not-found' });
    });
  }

  if (watcher) app.addHook('onClose', async () => { watcher.stop(); });
  return app;
}
