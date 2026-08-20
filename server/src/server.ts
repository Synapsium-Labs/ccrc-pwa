import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { configDirFor, type CcrcConfig } from './config.js';
import type { BuildInfo } from './buildinfo.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import { assembleFleet, liveStatus } from './fleet.js';
import { readLimits, projectHome } from './limits.js';
import { buildAgreement, defaultCachePath, loadSnapshot, rosterAgreement, type FleetState } from './fleetstate.js';
// The first `.mjs` imports in `server/src/`. Those two files are deliberately
// not TypeScript — `deploy/deploy.sh` runs them under a bare `node`, with no
// build step (see `shared/mark.mjs`'s header) — so reaching them from here
// needed `allowJs` plus `../shared/**/*.mjs` in `server/tsconfig.json`, or tsc
// emits only the `.ts` files and the BUILT server dies at startup on a module
// it cannot resolve. `server/test/module-format.test.ts` is what keeps that
// include list and the ESM-emit invariant honest.
import { generateAccountsSh } from '../../shared/generate.mjs';
import { bodyDigest } from '../../shared/mark.mjs';
import { CCD_ARGV, stopSurfaceSupported, verbSupported, type CcdArgv } from './ccdargv.js';
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
import { readAuthSecret, verifyPassphrase } from './auth/secret.js';
import { ABSOLUTE_TTL_MS, SessionStore } from './auth/sessions.js';
import { LoginRateLimiter, PASSKEY_MAX_FAILURES } from './auth/ratelimit.js';
import { SESSION_COOKIE, expireCookie, parseCookies, serializeCookie } from './auth/cookie.js';
import { SECRET_UNREAD, installGate, measureSecret, sessionVerdict } from './auth/gate.js';
import { PasskeyStore } from './auth/credentials.js';
import {
  ChallengeStore, relyingPartyProblem, userHandleFor, verifyAssertion, verifyRegistration,
} from './auth/webauthn.js';
import {
  FLEET_PROTO, FLEET_PROTO_MIN,
  type AccountsResponse, type AccountUsage, type AuthStatus, type CoordStatus, type Divergence,
  type FleetHealth, type FleetMsg,
  type FleetSession,
  type PasskeyAssertStart, type PasskeyListResponse, type PasskeyRegisterStart,
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

/**
 * Which `AuthStatus` fields an UNAUTHENTICATED caller may see on the exempt
 * `GET /api/auth/status`. The whole enumerated leak, in one place: the gate is
 * armed, how many passkeys exist (so the login screen knows whether to offer the
 * button), and whether the login window is currently closed (so it knows whether
 * to offer a field that cannot succeed).
 *
 * A `Record<keyof AuthStatus, boolean>`, NOT a list of key names, and that is the
 * mechanism rather than the decoration: a field added to `AuthStatus` tomorrow is
 * a TS2739 here ("missing the following properties") until someone decides,
 * deliberately, whether an anonymous browser may see it. A spread or a
 * hand-written key list would let the next field widen the leak silently, which
 * is the failure this exists to prevent — the same shape `PR_REASON_MAP` and
 * `AUTH_VERDICT_MAP` use in `shared/api.ts`.
 *
 * Every field is visible today, so the anonymous body and the full one happen to
 * coincide. That is a fact about this build, not the contract.
 */
const ANON_VISIBLE: Record<keyof AuthStatus, boolean> = {
  authed: true, passkeysEnrolled: true, mode: true,
};

/** `full`, reduced to {@link ANON_VISIBLE}'s fields. */
function anonymousStatus(full: AuthStatus): Partial<AuthStatus> {
  return Object.fromEntries(
    Object.entries(full).filter(([k]) => ANON_VISIBLE[k as keyof AuthStatus]),
  ) as Partial<AuthStatus>;
}

/**
 * Which `PasskeyAssertStart` fields an UNAUTHENTICATED caller may see —
 * {@link ANON_VISIBLE}'s discipline applied to the other anonymous body on this
 * server, which had none (Task 8 review).
 *
 * All three are visible, because the ceremony cannot run without any of them: a
 * browser needs the challenge to sign, the `rpId` to scope the request, and the
 * credential ids to ask the authenticator for a non-discoverable key. A
 * credential id is an opaque handle, useless without the private key, and the
 * COUNT is already published by `AuthStatus.passkeysEnrolled` under the same
 * ruling.
 *
 * The point is not today's answer but tomorrow's: `PasskeySummary` exists now,
 * carrying `label`, `enrolledAt` and `lastUsedAt`, and "just send the summaries
 * here too" is a one-line change that would hand an anonymous tailnet caller a
 * fingerprint of the operator's devices. As a `Record<keyof …, boolean>` that
 * change is a TS2739 until somebody decides it deliberately.
 */
const ASSERT_START_VISIBLE: Record<keyof PasskeyAssertStart, boolean> = {
  challengeB64url: true, rpId: true, allowCredentialIdsB64url: true,
};

/** `full`, reduced to {@link ASSERT_START_VISIBLE}'s fields. */
function anonymousAssertStart(full: PasskeyAssertStart): Partial<PasskeyAssertStart> {
  return Object.fromEntries(
    Object.entries(full).filter(([k]) => ASSERT_START_VISIBLE[k as keyof PasskeyAssertStart]),
  ) as Partial<PasskeyAssertStart>;
}

export interface Deps {
  cfg: CcrcConfig;
  /** The deploy's build stamp (buildinfo.ts, read once at boot from
   *  `cfg.buildInfoPath`). `null` on a dev checkout or an unstamped box;
   *  absent has the same meaning — `/health` treats both as null, and so does
   *  `/api/fleet/health`, where this is now also the OWN side of the two-box
   *  skew comparison (`buildAgreement`, against `fleetState.build`). Which is
   *  why an unstamped server answers `'unknown'` rather than manufacturing a
   *  disagreement with the fleet host out of a stamp it never had. */
  build?: BuildInfo | null;
  /** The ONLY path to `ccd`. There is deliberately no raw `run` here: with one,
   *  "every ccd argv is built in ccdargv.ts" is enforceable only by scanning
   *  source text, which was defeated four times in four rounds. The parameter
   *  type is the enforcement now — see task 13S and `CcdArgv`. */
  runCcd: (argv: CcdArgv) => Promise<CcdResult>;
  tmux: Tmux; io: FleetIO; spawnPty?: SpawnPty;
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

  // ── The session gate (Stage 3a) ───────────────────────────────────────
  //
  // Owned HERE rather than threaded through `Deps`, unlike `push`/`coord`/
  // `notifyLog`, and for a reason those three do not have: the store must be
  // LOADED exactly once, at boot, before any request can reach `verify` — a
  // second live-time `load()` re-reads the file into memory and can clobber a
  // create that has not flushed yet (`sessions.ts:152`, D-109's write-side
  // mirror). `buildServer` is the one async function every caller — index.ts,
  // every test — goes through exactly once, so putting the store here makes
  // "loaded once" structural instead of a rule each composition root has to
  // remember. An optional `Deps.auth` with a local fallback would be the
  // "second KeyedQueue" shape `Deps.queue`'s own docstring warns about.
  const authStore = new SessionStore(deps.cfg.sessionsPath);
  // One limiter per server (the `CoordMutex` model, not a module singleton):
  // independent test servers in one process must not share a lockout window.
  const loginLimiter = new LoginRateLimiter();
  // ── the passkey lane (Task 8) ─────────────────────────────────────────
  //
  // Owned here for `authStore`'s reason (loaded exactly once, at boot), and
  // built even when the gate is dark so the four routes can be REGISTERED
  // unconditionally — a route that exists only under a flag is a route the
  // gate sweep cannot measure in both flag positions, which is the property
  // `auth-gate.test.ts` rests on. Nothing is READ off it while dark: the
  // routes 501 before they touch it, and `load()` is only called when armed,
  // so a dark box still touches no disk.
  const passkeys = new PasskeyStore(deps.cfg.passkeysPath);
  // TWO challenge stores, not one. A challenge issued to enrol a key must never
  // satisfy a login — `webauthn.ts`'s `ChallengeStore` docstring has the
  // argument; the split is what makes purpose confusion structurally impossible
  // rather than dependent on the `clientDataJSON.type` check alone.
  const registerChallenges = new ChallengeStore('register');
  const assertChallenges = new ChallengeStore('assert');
  // A SEPARATE, LOOSER budget from the passphrase door — see
  // `PASSKEY_MAX_FAILURES`. Separate STATE too: a passkey flood must not be able
  // to close the passphrase window, which would lock the operator out of the one
  // door that still works.
  const passkeyLimiter = new LoginRateLimiter(Date.now(), PASSKEY_MAX_FAILURES);
  if (deps.cfg.authEnabled) {
    // BOOT REFUSAL, uncaught on purpose: `readAuthSecret` throws
    // `AuthSecretUnusable` for a secret that is PRESENT but unreadable or
    // garbled, and `secret.ts`'s contract is that this kills the process rather
    // than starting on a secret the box cannot trust (`coord/db.ts`'s
    // `CoordDbUnmigratable` and `coord/token.ts`'s own refusals are the same
    // stance). `deploy.sh`'s `verify-service.sh` turns it into a failed deploy
    // with the journal attached. The gate re-reads per request too
    // (`measureSecret`) — that read never throws, because at REQUEST time the
    // answer must be a 401, not a 500.
    const secret = readAuthSecret(deps.cfg.authSecretPath);
    if (secret === null) {
      // ARMED WITH NO PASSPHRASE — every request will answer 401
      // `'unconfigured'` and nobody can log in. Not a boot refusal: the file is
      // absent, which is the honest "never configured" state, and `ccrc passwd`
      // creates it without a restart. But it is worth exactly one line in the
      // journal, because the symptom (a box that refuses a passphrase nobody
      // ever set) is otherwise indistinguishable from a wrong one.
      console.warn(`ccrc-server: CCRC_AUTH=on but no passphrase file at ${deps.cfg.authSecretPath} — ` +
        'the gate is ARMED and FAILING SHUT: every route answers 401 and no login can succeed. ' +
        'Run `ccrc passwd` on this box.');
    }
    // A MISCONFIGURED RELYING PARTY IS A WARNING, NOT A BOOT REFUSAL, and the
    // asymmetry with `readAuthSecret` above is deliberate: a bad `CCRC_RP_ID`
    // breaks PASSKEYS, while the passphrase door — the one every box has — keeps
    // working. Refusing to boot would take a working box off the air over an
    // optional feature. The routes answer 501 (see `rpProblem`), and this line
    // is what tells the operator why at deploy time rather than at the first tap.
    const rp = relyingPartyProblem(deps.cfg.rpId, deps.cfg.origin);
    if (rp !== null) {
      // WORDING MATTERS HERE and the first version got it wrong (Task 8 review):
      // it said "passkeys are disabled, the passphrase still works", which is
      // true of a bad `CCRC_RP_ID` and FALSE of a bad `CCRC_ORIGIN` — the same
      // unvalidated `cfg.origin` also goes to `installGate`, where every
      // websocket upgrade and every non-exempt write is compared against it. A
      // refused origin does not merely disable passkeys; it leaves a console
      // that can read and cannot act. The per-refusal warning in `gate.ts` is
      // the better diagnostic when it happens; this is the one that fires at
      // deploy time, before anyone has tried.
      console.warn(`ccrc-server: WebAuthn config is refused — ${rp}. Passkeys are DISABLED. ` +
        'If CCRC_ORIGIN is the bad value, every /ws/* upgrade and every non-exempt write will ' +
        'ALSO be refused for any browser that is not at it. The passphrase login itself still ' +
        'works. Fix CCRC_RP_ID / CCRC_ORIGIN and redeploy.');
    }
    await authStore.load();
    await passkeys.load();
    authStore.startSweep();
    app.addHook('onClose', async () => { authStore.stopSweep(); await authStore.flush(); });
  }
  // Unconditional — the flag is decided INSIDE the hook (`authVerdict`'s first
  // line), so there is exactly one place in the tree that answers "is this
  // request allowed", and the sweep in `auth-gate.test.ts` measures the same
  // hook in both flag positions.
  installGate(app, {
    enabled: deps.cfg.authEnabled, secretPath: deps.cfg.authSecretPath, store: authStore,
    cookieSecure: deps.cfg.cookieSecure, origin: deps.cfg.origin,
  });

  /** The session row's human-facing note — the device that logged in. NEVER a
   *  decision input (`sessions.ts`), and never logged; truncated because a
   *  user-agent is attacker-controlled text landing in a file we rewrite. */
  const deviceLabel = (req: FastifyRequest): string => {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' && ua.trim() !== '' ? ua.slice(0, 120) : 'unknown device';
  };

  /** The measured secret for THIS moment — `SECRET_UNREAD` when the flag is off,
   *  so nothing touches the disk on a box whose gate is dark. */
  const secretNow = () => (deps.cfg.authEnabled ? measureSecret(deps.cfg.authSecretPath) : SECRET_UNREAD);

  /**
   * `POST /api/auth/login` — one of the two EXEMPT auth routes (`gate.ts`'s
   * table); a gate that gated its own door would be a box nobody can enter.
   *
   * THE BRAKE ADMITS, IT DOES NOT MERELY READ (review Important 1). The first
   * act is `reserve()`, which takes a slot against the SAME `MAX_FAILURES`
   * budget the recorded failures spend, and the slot is held until this handler
   * returns. The distinction is the whole defence: a brake that only READ the
   * failure count would bound a sequential attacker and nothing else, because a
   * failure is not recorded until the ~100 ms scrypt derivation resolves — so N
   * requests fired AT ONCE would all see `count === 0`, all pass, and all queue
   * a 64 MiB / N=65536 derivation onto libuv's 4-slot threadpool, starving every
   * `fs/promises` caller in this server (fleet assembly, clip reads, the session
   * store's own flush) for as long as the flood lasted. That was a remote DoS
   * against an armed box, reachable by anyone who can open a socket, and the
   * earlier version of this comment — "a flood cannot make this box spend
   * scrypt" — was true request-at-a-time and false under concurrency. What is
   * true now: at most `MAX_FAILURES` derivations can be in flight at once, and a
   * flood is refused 429 rather than queued.
   *
   * `finally { slot.release() }` IS LOAD-BEARING. Every exit path — 400, the
   * unconfigured 401, the wrong-passphrase 401, the 204, and a throw out of
   * `verifyPassphrase` — must give the slot back, because a leaked slot never
   * times out: `MAX_FAILURES` of them brick login until the process restarts.
   * `release` is idempotent, so this cannot double-decrement either.
   *
   * The passphrase is verified with the ASYNC `crypto.scrypt`
   * (`verifyPassphrase`): at N=65536 a sync derivation is ~100 ms of stalled
   * event loop, and this server runs pty and websocket lanes on it. Only a
   * proven-correct passphrase reaches `store.create`.
   *
   * FAILURES ARE COUNTED, ATTEMPTS ARE NOT (`ratelimit.ts`): a malformed body or
   * an unconfigured box spends none of the window — neither is a guess. It still
   * spends a SLOT for its (very short) lifetime, which is the concurrency half
   * of the same budget and is what stops a flood of any shape.
   *
   * 204 + `Set-Cookie` on success, with NO body, and `shared/api.ts` deliberately
   * declares no `LoginResponse` to go with it: the cookie IS the response.
   *
   * NEVER LOGS THE PRESENTED PASSPHRASE, the minted token, or the cookie — the
   * rule `/api/notify` states for the box token (:443-446), with more force.
   */
  app.post('/api/auth/login', async (req, reply) => {
    if (!deps.cfg.authEnabled) return reply.code(501).send({ ok: false, error: 'not-configured' });
    const now = Date.now();
    const slot = loginLimiter.reserve(now);
    if (!slot.ok) {
      // 429 with `Retry-After` in SECONDS (the header's unit), rounded UP so a
      // client that obeys it never returns while the window is still closed.
      // `retryAfter` is the window's end, which is an UPPER bound when the
      // refusal came from concurrency rather than from recorded failures (those
      // slots free themselves in ~100 ms) — the window is the only clock this
      // policy has, and erring long is the safe direction for a brake.
      // The verdict rides in the body for the same reason every other refusal
      // here carries one: the login screen's sentence is "wait", not "retry".
      return reply.code(429).header('retry-after', String(Math.ceil(slot.retryAfter / 1000)))
        .send({ ok: false, error: 'unauthenticated', verdict: 'locked-out', retryAfter: slot.retryAfter });
    }
    try {
      const body = (req.body ?? {}) as { passphrase?: unknown };
      if (typeof body.passphrase !== 'string' || body.passphrase === '') {
        return reply.code(400).send({ ok: false, error: 'bad-request' });
      }
      const measured = secretNow();
      if (measured.kind !== 'ok') {
        if (measured.kind === 'unusable') {
          // The file was broken WHILE the server ran (boot would have refused
          // otherwise). One journal line naming the state, never its contents.
          console.warn(`ccrc-server: /api/auth/login cannot read ${deps.cfg.authSecretPath} — ` +
            'the passphrase file is present but unusable, so no login can succeed. ' +
            'Re-run `ccrc passwd` on this box.');
        }
        // ONE verdict for both `'absent'` and `'unusable'`, and that is a wire
        // limit rather than a collapse: `AuthVerdict` has six members and none of
        // them is "present but unreadable". Both mean the same thing to the person
        // typing — nothing you enter can match, run `ccrc passwd` — while the two
        // stay distinct where it matters, in `SecretState` and in the journal.
        return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: 'unconfigured' });
      }
      if (!(await verifyPassphrase(measured.secret, body.passphrase))) {
        // Recorded INSIDE the try, released after: for the instant between them
        // this attempt counts twice against the budget (once as a failure, once
        // as a slot). Conservative in the safe direction — it can only refuse a
        // concurrent caller slightly sooner, never admit one.
        loginLimiter.fail(now);
        return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: 'wrong' });
      }
      loginLimiter.succeed(now);
      const { token } = await authStore.create(deviceLabel(req), measured.secret.generation, now);
      // `Max-Age` mirrors the session's own ABSOLUTE ttl, derived from the store's
      // constant rather than re-typed: a jar that outlives the server's record
      // would keep presenting a token that can only ever answer `'expired'`.
      return reply
        .header('set-cookie', serializeCookie(SESSION_COOKIE, token, {
          secure: deps.cfg.cookieSecure, maxAgeSeconds: Math.floor(ABSOLUTE_TTL_MS / 1000),
        }))
        .code(204).send();
    } finally {
      slot.release();
    }
  });

  /**
   * `POST /api/auth/logout` — NOT exempt, deliberately: logging out is something
   * only a logged-in caller can do, and an ungated logout is a way for anyone on
   * the tailnet to revoke a session id they guessed.
   *
   * Revokes THIS session only (`revokeThis`, not `revokeAll`) — the phone
   * logging out must not sign the laptop out too. The "log out everywhere"
   * control is `revokeAll`, and the passphrase rotation that invalidates every
   * session at once is `ccrc passwd`'s generation bump.
   *
   * The cookie is expired through `expireCookie`, which shares
   * `serializeCookie`'s attributes — a browser only replaces a cookie whose
   * name/Path/Domain all match.
   */
  app.post('/api/auth/logout', async (req, reply) => {
    if (!deps.cfg.authEnabled) return reply.code(501).send({ ok: false, error: 'not-configured' });
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (token !== undefined) await authStore.revokeThis(token);
    return reply
      .header('set-cookie', expireCookie(SESSION_COOKIE, { secure: deps.cfg.cookieSecure }))
      .code(204).send();
  });

  // ── the passkey ceremonies (Task 8) ───────────────────────────────────
  //
  // FOUR ROUTES, TWO GATE DECISIONS, and the split is the security design:
  //
  //   register/start, register/finish → GATED. Enrolling a key requires already
  //     being signed in. This is what makes `attestation: 'none'` safe (see
  //     `webauthn.ts`) — an ungated enrol route would let anyone on the tailnet
  //     register their own authenticator and own the box forever.
  //   assert/start, assert/finish     → EXEMPT (`gate.ts`, reason 5). These ARE
  //     the door; gating them would make every enrolled key unusable, exactly as
  //     gating `POST /api/auth/login` would.
  //
  // ALL FOUR ARE FLAG-AWARE: with `CCRC_AUTH` off they answer `501
  // not-configured`, like login and logout, because there is no session gate to
  // enrol into or to log into. `auth-gate.test.ts`'s `FLAG_AWARE` set names them.
  //
  // NEVER LOGS a credential id's owner, a cookie, a token or a passphrase. The
  // refusal REASON goes to the journal and NEVER to the wire — every failure
  // below answers one indistinguishable `401 { verdict: 'wrong' }`, so the
  // endpoint cannot be used as an oracle ("that id exists but its counter is
  // stale" is a very different sentence from "no such credential").

  /** The box's WebAuthn config, re-measured per request — `null` when it is
   *  coherent. Measured rather than cached so `ccrc doctor`'s eventual fix takes
   *  effect without a restart, and because it is two string comparisons. */
  const rpProblem = (): string | null => relyingPartyProblem(deps.cfg.rpId, deps.cfg.origin);

  /** The shared preamble of all four routes: the flag, then the config. Returns
   *  `true` when the route has already answered and the handler must stop.
   *
   *  THE CONFIG PROBLEM IS LOGGED, NOT SENT. On `assert/*` the caller is
   *  unauthenticated, and "your CCRC_RP_ID is a public suffix" published to the
   *  tailnet is a free map of the box's misconfiguration. One journal line, one
   *  bare 501. */
  /**
   * The RP problems already written to the journal, so an anonymous caller
   * cannot make this box write log lines by looping a bodyless POST at a
   * misconfigured route (found by the Task 8 review).
   *
   * A SET RATHER THAN A BOOLEAN because the value it guards is a string an
   * operator may fix and re-break differently, and the second, different problem
   * deserves its own line. It is bounded by construction: `relyingPartyProblem`
   * returns one of a fixed handful of sentences derived from two config values
   * that do not change while the process runs, so this cannot grow with traffic.
   * Per-server, not module-level, for `loginLimiter`'s reason — independent test
   * servers in one process must not silence each other's warnings.
   */
  const warnedRpProblems = new Set<string>();
  const passkeyUnavailable = (reply: FastifyReply): boolean => {
    if (!deps.cfg.authEnabled) {
      void reply.code(501).send({ ok: false, error: 'not-configured' });
      return true;
    }
    const problem = rpProblem();
    if (problem !== null) {
      if (!warnedRpProblems.has(problem)) {
        warnedRpProblems.add(problem);
        console.warn(`ccrc-server: refusing a passkey ceremony — ${problem}`);
      }
      void reply.code(501).send({ ok: false, error: 'not-configured' });
      return true;
    }
    return false;
  };

  /**
   * `POST /api/auth/passkey/register/start` — GATED. Issues a single-use,
   * two-minute registration challenge.
   *
   * `rpId` is SENT to the client rather than left for it to infer from its own
   * origin, and `shared/api.ts`'s `PasskeyRegisterStart` carries the argument:
   * the client deriving it by stripping labels off `location.hostname` is the
   * public-suffix hazard with a different author. One configured value, echoed,
   * so the ceremony and the stored binding cannot disagree.
   */
  app.post('/api/auth/passkey/register/start', async (_req, reply): Promise<PasskeyRegisterStart | void> => {
    if (passkeyUnavailable(reply)) return;
    return {
      challengeB64url: registerChallenges.issue(Date.now()),
      rpId: deps.cfg.rpId,
      userHandleB64url: userHandleFor(deps.cfg.rpId),
    };
  });

  /**
   * `POST /api/auth/passkey/register/finish` — GATED. Verifies the ceremony and
   * stores the credential.
   *
   * NO RATE LIMIT, deliberately: the caller has already proven the passphrase,
   * so there is no credential here to guess, and the only budget worth bounding
   * is the row count (`MAX_CREDENTIALS`) and the challenge map (which is capped
   * and self-evicting). A limiter here would only be a way for the operator to
   * lock themselves out of enrolling.
   *
   * `rpId`/`origin` are RECORDED ON THE ROW from config, which is the property
   * that makes a Stage 3b rename fail LOUDLY — see `StoredCredential`.
   */
  app.post('/api/auth/passkey/register/finish', async (req, reply) => {
    if (passkeyUnavailable(reply)) return;
    const now = Date.now();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = verifyRegistration({
      credentialIdB64url: body['credentialIdB64url'],
      publicKeySpkiB64url: body['publicKeySpkiB64url'],
      algorithm: body['algorithm'],
      authenticatorDataB64url: body['authenticatorDataB64url'],
      clientDataJsonB64url: body['clientDataJsonB64url'],
    }, { rpId: deps.cfg.rpId, origin: deps.cfg.origin }, registerChallenges, now);
    if (!result.ok) {
      // The REASON is worth a journal line here, unlike on the assertion path,
      // because the caller is the operator and the answer is actionable ("your
      // key cannot do user verification").
      console.warn(`ccrc-server: passkey enrolment refused (${result.reason}): ${result.detail}`);
      return reply.code(400).send({ ok: false, error: 'bad-request', reason: result.reason });
    }
    const stored = await passkeys.add({
      credentialId: result.credentialId,
      spkiB64url: result.spkiB64url,
      algorithm: result.algorithm,
      rpId: deps.cfg.rpId,
      origin: deps.cfg.origin,
      signCount: result.signCount,
      uvAtEnrollment: result.uv,
      enrolledAt: now,
      lastUsedAt: now,
      label: deviceLabel(req),
    });
    // A DISCRIMINATED RESULT, not a boolean (D-120): three different things can
    // stop an enrolment and the operator needs a different sentence for each.
    // `write-failed` especially — that used to answer `204 Passkey added` for a
    // credential that would vanish on the next restart.
    if (!stored.ok) {
      const status = stored.reason === 'full' ? 409 : stored.reason === 'unusable' ? 409 : 500;
      console.warn(`ccrc-server: passkey enrolment could not be stored (${stored.reason})`);
      return reply.code(status).send({ ok: false, error: `passkey-store-${stored.reason}` });
    }
    return reply.code(204).send();
  });

  /**
   * `GET /api/auth/passkeys` — the enrolment screen's view. GATED, like the
   * register pair and for the same reason: which keys exist, when they were
   * enrolled and when each was last used is the operator's own inventory, and it
   * is exactly the fingerprinting material that must not leave the box to an
   * anonymous caller. `assert/start` publishes the bare ids because the ceremony
   * cannot run without them; this publishes the rest because the REVOCATION
   * decision cannot be made without them. Two audiences, two shapes.
   */
  app.get('/api/auth/passkeys', async (_req, reply): Promise<PasskeyListResponse | void> => {
    if (passkeyUnavailable(reply)) return;
    return {
      credentials: passkeys.list(),
      // NOT derivable from an empty list — see `PasskeyListResponse` (D-119).
      storeUnreadable: !passkeys.canEnroll(),
    };
  });

  /**
   * `DELETE /api/auth/passkey/:id` — REVOCATION. GATED.
   *
   * WHY THIS EXISTS AT ALL (operator ruling, Task 8 review). Without it a lost or
   * compromised authenticator could not be un-enrolled: `PasskeyStore.remove`
   * had no caller, there was no list in the UI, and the obvious workaround —
   * `rm ~/.ccrc/passkeys.json` — DOES NOT WORK on a running server. `load()`
   * happens once at boot and `ensureLoaded()` caches the promise forever, while
   * `add`/`recordUse` re-serialize the whole in-memory array, so the next
   * accepted assertion RESURRECTS the deleted row. The correct recovery was
   * "`rm` plus a service restart", documented nowhere, and the store's own
   * docstring ("it is removed when the operator removes it") rested on a
   * lifecycle step that had never been built.
   *
   * IT TAKES EFFECT IMMEDIATELY IN THE RUNNING PROCESS — in-memory removal first,
   * then the flush — which is the whole point given the resurrection above. No
   * restart, and a revoked credential's very next assertion is refused as
   * `unknown-credential`.
   *
   * `ccrc passwd` KEEPS ITS CURRENT MEANING: it bumps the secret generation,
   * which invalidates SESSIONS, not authenticators. There is deliberately no
   * generation stamp on `StoredCredential` — a passkey is a credential in its own
   * right, exactly as it is on any ordinary service, and the documented emergency
   * procedure is "revoke the passkey, then rotate the passphrase". Conflating the
   * two would mean a passphrase rotation silently un-enrolled every device, which
   * is a surprise in the direction of a lockout.
   *
   * 404 for an id that is not enrolled — the caller is already authenticated, so
   * there is no oracle to protect here, and "that key is already gone" is the
   * true and useful answer.
   */
  app.delete('/api/auth/passkey/:id', async (req, reply) => {
    if (passkeyUnavailable(reply)) return;
    const { id } = req.params as { id: string };
    const removed = await passkeys.remove(id);
    if (!removed) return reply.code(404).send({ ok: false, error: 'no-such-passkey' });
    return reply.code(204).send();
  });

  /**
   * `POST /api/auth/passkey/assert/start` — EXEMPT. Issues a login challenge and
   * the credential ids the ceremony cannot run without.
   *
   * WHAT THIS PUBLISHES TO AN ANONYMOUS CALLER, stated rather than incidental: a
   * fresh random challenge, the configured `rpId`, and the list of enrolled
   * credential ids. A credential id is an opaque handle — useless without the
   * private key, which never leaves the authenticator — and the COUNT is already
   * published by `GET /api/auth/status`'s `passkeysEnrolled` under the same
   * ruling (`ANON_VISIBLE`). A box with no keys answers an empty list, and the
   * client falls back to the passphrase rather than prompting for a key that
   * cannot exist.
   */
  app.post('/api/auth/passkey/assert/start', async (_req, reply): Promise<Partial<PasskeyAssertStart> | void> => {
    if (passkeyUnavailable(reply)) return;
    const now = Date.now();
    const slot = passkeyLimiter.reserve(now);
    if (!slot.ok) {
      void reply.code(429).header('retry-after', String(Math.ceil(slot.retryAfter / 1000)))
        .send({ ok: false, error: 'unauthenticated', verdict: 'locked-out', retryAfter: slot.retryAfter });
      return;
    }
    try {
      // ISSUANCE SPENDS THE BUDGET (D-118). Without this the route was
      // effectively unmetered: the handler is `async` but has no `await` —
      // `issue()` and `ids()` are synchronous — so the reservation was released
      // in the same tick and `inFlight` never exceeded 1, and nothing here ever
      // called `fail()`. `loginVerdict` therefore evaluated `0 + 0 < 60` on
      // every request, forever. An anonymous peer looping this route evicted the
      // operator's in-flight challenge (the map is 64 entries, oldest-first)
      // faster than a Face ID prompt can resolve, turning a legitimate sign-in
      // into "That passphrase didn't match" for the duration of the flood.
      //
      // `spend`, not `fail`: minting a challenge is not a failed guess. Same
      // window, same reducer, honest name at the call site (`ratelimit.ts`).
      passkeyLimiter.spend(now);
      const full: PasskeyAssertStart = {
        challengeB64url: assertChallenges.issue(now),
        rpId: deps.cfg.rpId,
        allowCredentialIdsB64url: passkeys.ids(),
      };
      // ENUMERATED, like `ANON_VISIBLE` on the status route, and for the same
      // reason: this body goes to an UNAUTHENTICATED caller, so a field added to
      // `PasskeyAssertStart` next month must be a compile error here — a
      // deliberate decision — rather than a leak that ships with tsc clean and
      // nothing red.
      return anonymousAssertStart(full);
    } finally {
      slot.release();
    }
  });

  /**
   * `POST /api/auth/passkey/assert/finish` — EXEMPT. THE PASSKEY DOOR.
   *
   * Every check lives in `webauthn.ts`'s `verifyAssertion` (pure, no fastify, no
   * disk); this handler is the delivery half — the brake, the lookup, the
   * counter write and the cookie.
   *
   * `slot.release()` IN A `finally` IS LOAD-BEARING, exactly as on the passphrase
   * door: a leaked slot never times out, and `PASSKEY_MAX_FAILURES` of them brick
   * the passkey lane until the process restarts.
   *
   * THE UNCONFIGURED-SECRET ARM IS NOT AN OVERSIGHT. A session is stamped with
   * the passphrase secret's GENERATION (`sessions.ts`) — that is how `ccrc
   * passwd` invalidates every live session at once — so there is no session to
   * mint on a box with no passphrase file. It is also the D-39 inversion applied
   * consistently: an unconfigured box must never be enterable, by ANY door. In
   * practice the state is unreachable, because enrolling a key requires a session
   * and a session requires the passphrase; it is spelled out anyway, denying,
   * because "unreachable" is a claim about today's routes.
   *
   * ONE REFUSAL SHAPE FOR EVERY FAILURE — unknown credential, wrong origin, stale
   * counter, bad signature — so the route is not an oracle. The reason goes to
   * the journal.
   */
  app.post('/api/auth/passkey/assert/finish', async (req, reply) => {
    if (passkeyUnavailable(reply)) return;
    const now = Date.now();
    const slot = passkeyLimiter.reserve(now);
    if (!slot.ok) {
      return reply.code(429).header('retry-after', String(Math.ceil(slot.retryAfter / 1000)))
        .send({ ok: false, error: 'unauthenticated', verdict: 'locked-out', retryAfter: slot.retryAfter });
    }
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const credentialId = body['credentialIdB64url'];
      if (typeof credentialId !== 'string' || credentialId === '') {
        return reply.code(400).send({ ok: false, error: 'bad-request' });
      }
      const measured = secretNow();
      if (measured.kind !== 'ok') {
        return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: 'unconfigured' });
      }
      const cred = passkeys.find(credentialId);
      // A failure, counted, and the SAME body an unverifiable signature gets.
      if (cred === undefined) {
        passkeyLimiter.fail(now);
        // A DIFFERENT SENTENCE from the verifier's own `unknown-credential`
        // (which means "the id does not match the row supplied"): these are two
        // different facts — "no such credential is enrolled here" versus "the
        // caller was handed the wrong row" — and one log line for both would
        // make the two indistinguishable in the only place they are allowed to
        // differ. The WIRE answer stays identical; see this route's docstring.
        console.warn('ccrc-server: passkey assertion refused (unknown-credential): ' +
          'no credential with that id is enrolled on this box');
        return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: 'wrong' });
      }
      const result = verifyAssertion({
        credentialIdB64url: credentialId,
        authenticatorDataB64url: body['authenticatorDataB64url'],
        clientDataJsonB64url: body['clientDataJsonB64url'],
        signatureB64url: body['signatureB64url'],
      }, cred, assertChallenges, now);
      if (!result.ok) {
        passkeyLimiter.fail(now);
        console.warn(`ccrc-server: passkey assertion refused (${result.reason}): ${result.detail}`);
        return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: 'wrong' });
      }
      // THE COUNTER IS ADVANCED BEFORE THE SESSION IS MINTED. In-memory first and
      // unconditionally (`credentials.ts`), so a replay of this exact assertion
      // is refused by the counter even if the disk write fails — the challenge is
      // already spent too, which is the second, independent wall.
      await passkeys.recordUse(cred.credentialId, result.signCount, now);
      passkeyLimiter.succeed(now);
      const { token } = await authStore.create(deviceLabel(req), measured.secret.generation, now);
      return reply
        .header('set-cookie', serializeCookie(SESSION_COOKIE, token, {
          secure: deps.cfg.cookieSecure, maxAgeSeconds: Math.floor(ABSOLUTE_TTL_MS / 1000),
        }))
        .code(204).send();
    } finally {
      slot.release();
    }
  });

  /**
   * `GET /api/auth/status` — the box's standing gate posture (`AuthStatus`).
   *
   * EXEMPT, by operator ruling, and the ruling is "exempt with a MINIMIZED
   * anonymous body". The plan's exempt list named `/api/auth/login` and no other
   * auth route; Task 1's own `AuthStatus` docstring contradicts it in three
   * places — "what the login screen reads BEFORE anyone types anything", the
   * `passkeysEnrolled > 0` decision about whether to draw the passkey button,
   * and `'locked-out'` existing so "a browser arriving mid-window needs to be
   * told to wait before it offers a field that cannot succeed". Gated, all three
   * are unreachable and `authed` is a dead field. So it is exempt, and the leak
   * that buys is ENUMERATED rather than incidental — see {@link ANON_VISIBLE}.
   *
   * `authed` IS COMPUTED FROM THE COOKIE PATH, never from `decision.allow`.
   * `allow` is true for three different reasons (`GateDecision.reason`), and on
   * an EXEMPT route it is true because the route is exempt — before the cookie
   * or the secret has been looked at at all. Reading `authed` off it would tell
   * every anonymous browser it was signed in, and would do so most loudly on a
   * box whose secret is `'absent'`, which is exactly the state the D-39 arm
   * exists to refuse. `reason === 'session'` is the only value that means a
   * credential verified.
   *
   * `passkeysEnrolled` IS A REAL COUNT since Task 8 — the number of rows in
   * `~/.ccrc/passkeys.json` — and it is `0` on a DARK box regardless of what is
   * enrolled, because the store is only loaded when the flag is armed. That is
   * not a lie: with the gate off there is no login screen to draw a passkey
   * button on, `mode: 'off'` already tells the PWA to do nothing, and loading
   * the file would break the "a dark box touches no disk" property
   * `auth-gate.test.ts` pins.
   *
   * `mode` never says "armed but no secret file" — `AuthVerdict`'s
   * `'unconfigured'`. That omission is `AuthStatus`'s own, deliberately: this
   * route is unauthenticated, and publishing it here would advertise exactly
   * which boxes are unenterable-but-open. `ccrc doctor` (Task 9) reports it, and
   * the login route says it to someone who has actually tried to get in.
   */
  app.get('/api/auth/status', async (req): Promise<Partial<AuthStatus>> => {
    const now = Date.now();
    // `sessionVerdict`, NOT `authVerdict`: this route is EXEMPT, so `authVerdict`
    // would answer `allow: true, reason: 'exempt'` and never look at the cookie
    // at all. The credential question has to be asked directly.
    const decision = sessionVerdict(req, {
      enabled: deps.cfg.authEnabled, secret: secretNow(), store: authStore,
    }, now);
    // `check()` is a READ that never increments and never admits (`ratelimit.ts`);
    // it only rolls an expired window forward, which is the same thing the next
    // login would do.
    const mode = !deps.cfg.authEnabled
      ? 'off'
      : loginLimiter.check(now).ok ? 'passphrase' : 'locked-out';
    // With the gate dark, everyone is authed — `AuthStatus`'s own definition of
    // `'off'`. Armed, only a verified session counts.
    const authed = !deps.cfg.authEnabled || decision.reason === 'session';
    // Typed as `AuthStatus` HERE, at the producer, so a field added to the wire
    // type is a compile error in this handler rather than a silently missing key
    // (the `FleetHealth` precedent, :211).
    const full: AuthStatus = { authed, passkeysEnrolled: passkeys.count(), mode };
    return authed ? full : anonymousStatus(full);
  });

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

  // The digest of the projection THIS box's roster produces, computed once:
  // `deps.cfg.roster` is loaded at boot and never reloaded (`loadConfig` is
  // called at module top level in index.ts), so re-deriving it per poll would
  // be a sha256 every 15 seconds for an answer that cannot have changed.
  const ownRosterFp = bodyDigest(generateAccountsSh(deps.cfg.roster));

  // Typed at the producer (`FleetHealth`, shared/api.ts): before this
  // annotation the two returns below were structurally checked against
  // nothing, so a typo like `roster: 'unknowable'` compiled clean — measured
  // directly (Stage 2d Task 4): mutating the local-mode arm's `'unknown'` to
  // `'unknowable'` with NO annotation on this handler left `tsc --noEmit`
  // green; the SAME mutation with the annotation below refuses
  // (`TS2322: Type '"unknowable"' is not assignable to type '"agreed" |
  // "divergent" | "unknown" | undefined'`). Both branches already conformed —
  // this closes the gap between them and the wire contract PWA reads
  // (`pwa/src/lib/api.ts`'s `fleetHealth()`), rather than changing behavior.
  app.get('/api/fleet/health', async (): Promise<FleetHealth> => {
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState) {
      return {
        mode: 'remote',
        connected: deps.fleetState.connected,
        downSince: deps.fleetState.downSince,
        roster: rosterAgreement(deps.fleetState.rosterFp, ownRosterFp),
        // `deps.build` is what THIS box's deploy stamped, read once at boot
        // (`index.ts`); `fleetState.build` is what the fleet host said about
        // itself on the last `ready`. `?? null` because `Deps.build` is
        // optional for callers that build `Deps` some other way (tests,
        // scripts) — an absent stamp and a null one are the same condition,
        // exactly as `/health` treats them.
        build: buildAgreement(deps.fleetState.build, deps.build ?? null),
      };
    }
    // Local mode drives ccd on this same box, off this same roster: there is
    // no second copy to disagree with, so the question does not arise. Said as
    // `'unknown'` rather than `'agreed'` on purpose — nothing was compared,
    // and a reader that later learns to show `'agreed'` as a green tick would
    // otherwise be showing one for a check that never ran. The build answer is
    // `'unknown'` for the identical reason, one box down: there is only one
    // build here, and a box cannot be skewed against itself.
    return {
      mode: deps.cfg.fleetMode, connected: true, downSince: null,
      roster: 'unknown', build: 'unknown',
    };
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
    // §1.6's census. NO COLD START, deliberately: the sweep's own byte-equality
    // guard re-broadcasts to every connected client the next time the census
    // changes, and there is no `currentDivergences()` to serve — a fabricated
    // empty census on connect would claim a measurement this process may not
    // have taken yet, which is exactly the rule `onCoord`'s own `null` follows
    // two lines below.
    const onDivergence = (divergences: Divergence[]) =>
      socket.send(JSON.stringify({ type: 'divergence', divergences } satisfies FleetMsg));
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
    bus.on('divergence', onDivergence);
    socket.on('close', () => {
      bus.off('fleet', onFleet);
      bus.off('notice', onNotice);
      bus.off('runs', onRuns);
      bus.off('coord', onCoord);
      bus.off('divergence', onDivergence);
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
    const q = req.query as { since?: string; sinceFile?: string };
    const since = parseSince(q.since, q.sinceFile);
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
    // `pwa` is hard-coded here, not threaded from the request: this route is
    // the PWA's own stop button and has exactly one caller (grep confirms
    // it — nothing else in server/ or pwa/ reaches CCD_ARGV.stopId/
    // stopPair), so there is no other identity this declaration could
    // honestly carry. `null` — omit the flag — when the deployed ccd is not
    // KNOWN to understand it (fix round 2, task 14, Important #1): a bare
    // `['stop', id]` is what every ccd generation has always understood,
    // where `['stop', id, '--surface', 'pwa']` against an old one parses as
    // a stop of a session named `<id>---surface` — exit 0, nothing real
    // touched, and `runCcdOr502` reads that as `200 {ok:true}`. This is the
    // deploy-ordering hazard `deploy/deploy.sh` itself does not close (the
    // agent target installs `ccd`; the default server target never does,
    // and neither cross-checks the other's version), so the check has to
    // live here instead of being a rollout note.
    const surface = stopSurfaceSupported(deps.fleetState) ? 'pwa' : null;
    // A workspace id is `<project>-<slug>` and encodes no wrapper at all, so
    // there is nothing to reverse: the prefix rule below would fall through to
    // identity.wrapper and ccd would recompute `<wrapper>-<project>` — a
    // DIFFERENT, live session, killed while the workspace kept running and
    // the PWA reported success. ccd stop's one-argument form takes the id
    // whole.
    if (rec.workspace !== null) return runCcdOr502(reply, CCD_ARGV.stopId(id, surface));
    // Legacy ids DO encode a wrapper, and ccd stop's two-argument form
    // recomputes them — so it needs the ORIGINAL wrapper baked into the id, not
    // identity.wrapper, which a prior swap flips to the new account while the
    // id/tmux name keep the old prefix.
    const originalWrapper = id.endsWith(`-${rec.project}`)
      ? id.slice(0, id.length - rec.project.length - 1)
      : identity.wrapper;
    return runCcdOr502(reply, CCD_ARGV.stopPair(originalWrapper, rec.project, surface));
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

  /**
   * The by-hand archive — one tap in the PWA's PR sheet and one in the
   * session actions sheet.
   *
   * WAVE 2: it now knows about coordination, because `ws-archive` has no hold
   * rung in ccd (deliberately: this route is the reason) and `archiveMerged`'s
   * own gate cannot help a request that never goes through it. An open run
   * naming this session is refused `409 run-open`, NAMING the runs so the
   * client can render a sentence rather than a slug.
   *
   * NOT a hard refusal — that would reverse a stated policy: README's holds
   * section blesses archiving a held workspace by hand, and this sheet is
   * where it says to do it. `{force:true}` proceeds. The operator's own hands
   * stay able to do it; they just have to mean it.
   *
   * NO `coordMutex`, decided rather than defaulted: the mutex is instantiated
   * INSIDE `registerCoordRoutes` (one per server, deliberately not a module
   * singleton) and this file holds no handle on it. The refusal path is a
   * SYNCHRONOUS read and a reply in the same tick, so no lock could make it
   * more current. The FORCED path CAN race an in-flight dispatch or close,
   * and this build does not close that race — a forced archive is an operator
   * overriding a refusal they have just read. If that is ever judged too
   * loose, the change is to have `registerCoordRoutes` return its mutex.
   *
   * NO box token, also decided: this route carries none today, and adding a
   * coordination REFUSAL is not the same as making it a coordination WRITE.
   * Its tokenless reachability from the phone is exactly what README blesses.
   */
  app.post('/api/sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { force?: unknown };
    if (body.force !== true) {
      // ABOVE the `verbSupported` gate on purpose: a claimed workspace is
      // refused as CLAIMED even on a host whose ccd predates the verb — the
      // claim is the more specific fact, and 501 would send the operator
      // chasing a fleet upgrade that was never the obstacle.
      //
      // `?.` — a server with coordination switched off archives exactly as it
      // did before this wave.
      const runs = deps.coord?.openRunsForSession(id) ?? [];
      if (runs.length > 0) return reply.code(409).send({ ok: false, error: 'run-open', runs });
    }
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
