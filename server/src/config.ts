import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultCoordDbPath } from './coord/db.js';
import { defaultSessionsPath } from './auth/sessions.js';
import { defaultPasskeysPath } from './auth/credentials.js';
import { parseRoster, RosterError, type Roster } from '../../shared/roster.js';

export type FleetMode = 'local' | 'remote';

export interface CcrcConfig {
  host: string;
  port: number;
  home: string;
  registryDir: string;
  limitsDir: string;
  clipsDir: string;
  uploadsDir: string;
  ccdBin: string;
  projectsRoot: string;
  /** The parsed, validated account roster (`shared/roster.ts`) — one entry
   *  per account this box knows about, in declaration order. `configDirFor`,
   *  below, is the one place an entry's `configDirSuffix` becomes an actual
   *  directory; nothing else should index `roster.byId` for that purpose
   *  (`single-definition.test.ts` enforces it, the same way it enforced the
   *  rule for the `wrappers` map this field replaces). */
  roster: Roster;
  /** Where `roster` was read from — `~/.ccrc/accounts.json` by default,
   *  overridable via `CCRC_ACCOUNTS` (tests point this at a fixture without
   *  needing a real `$HOME`). Kept on the config so a diagnostic can name
   *  the file it came from. */
  accountsPath: string;
  /** 'remote' drives the fleet through ccrc-agent instead of local node:fs/exec — see server/src/remote/. */
  fleetMode: FleetMode;
  agentUrl: string | null;
  agentToken: string | null;
  hetznerToken: string | null;
  fleetServerId: string | null;
  vapidPublic: string | null;
  vapidPrivate: string | null;
  vapidSubject: string;
  /** The coordination database, on THIS box (see coord/db.ts). Overridable so
   *  a test can point at a fixture home without exporting CCRC_HOME. */
  coordDbPath: string;
  /** Where THIS box keeps its copy of the box token (coord/token.ts). The
   *  fleet host keeps the same value at `~/.cc-secrets/ccrc-mail.token`;
   *  neither box can read the other's, which is why there are two copies of
   *  one secret and not one copy read twice. */
  mailTokenPath: string;
  /** The deploy's build stamp (deploy.sh stamp_build). Absent = dev boot. */
  buildInfoPath: string;
  /**
   * Stage 3a's session gate — is it ARMED? `false` is the shipped default and
   * the whole deploy story: with the flag off `server/src/auth/gate.ts`'s one
   * `onRequest` hook is a passthrough and this box behaves exactly as it did
   * before the slice landed, so the mechanism can ship to a live fleet before
   * anyone decides to turn it on.
   *
   * An ENUMERATED POSITIVE TEST (`fleetMode`'s idiom, :159): only the exact
   * string `'on'` arms the gate. Every other value — `'1'`, `'true'`, `'yes'`,
   * a bare `CCRC_AUTH=` line in an EnvironmentFile, an unset variable — is OFF.
   * That polarity is deliberate and it is the SAFE one for THIS key, and only
   * for this key: an operator who meant to arm the gate and typed `'1'` finds
   * an unauthenticated box and says so out loud, where the inverse mistake
   * (anything-but-off arms it) would take a box off the air on a typo in a file
   * nobody re-reads. `cookieSecure` below is the mirror image, for the mirror
   * reason.
   */
  authEnabled: boolean;
  /**
   * `Secure` on the session cookie — ON by default, and off ONLY for the
   * explicit localhost-http dev opt-out `CCRC_COOKIE_INSECURE=on`.
   *
   * DRIVEN BY CONFIG, NEVER BY THE REQUEST. Deriving it from `req.protocol`
   * (or from `X-Forwarded-Proto`) is the shape that fails silently behind a
   * TLS-terminating proxy: `tailscale serve` speaks https to the browser and
   * plain http to this process, so a scheme-derived flag would drop `Secure`
   * on exactly the deployment that needs it most. The proxy-trust decision
   * (`trustProxy`) belongs to Stage 3b, when Caddy terminates TLS; until then
   * this is a value the operator states, not one the server guesses.
   *
   * The positive test is inverted relative to `authEnabled` — anything that is
   * not exactly `'on'` leaves the cookie `Secure` — because here the fail-safe
   * direction is the strict one: a mistyped opt-out costs a developer a
   * confusing localhost session, where a mistyped opt-IN would ship a session
   * cookie over plaintext.
   */
  cookieSecure: boolean;
  /**
   * The passphrase file `server/src/auth/secret.ts` reads. The ONE TypeScript
   * spelling of this path — `ccd/ccrc`'s `cmd_passwd` (Task 9) is the only
   * other place it appears, in bash, and it is the file's sole writer.
   */
  authSecretPath: string;
  /**
   * The flat-file session store (`server/src/auth/sessions.ts`). Built through
   * `defaultSessionsPath(home)` rather than a second inline `path.join`, for
   * `coordDbPath`'s reason one field up: the same string built twice, once
   * tested and once not, is how a rename in one place silently reads a
   * different (or brand-new, empty) file in the other.
   */
  sessionsPath: string;
  /**
   * THE WEBAUTHN RELYING-PARTY ID — the registrable domain a passkey is scoped
   * to (`server/src/auth/webauthn.ts`, Task 8).
   *
   * IT IS CONFIGURED AND NEVER DERIVED, and that is the single most dangerous
   * line in this file to "simplify". The obvious derivation — take the request's
   * `Host` and strip a label — walks straight into the PUBLIC SUFFIX LIST: this
   * fleet's own hostname is `server-box.tailnet-example.ts.net` and **`ts.net` is a
   * public suffix**, as is `duckdns.org`, the other host shape this project
   * documents. Stripping one label off `server-box.tailnet-example.ts.net` gives
   * `tailnet-example.ts.net`, which is right; stripping two gives `ts.net`, which
   * would scope the credential to EVERY tailnet on the internet, and a browser
   * would (correctly) refuse it — or, on a host shape where the suffix has one
   * label fewer, quietly widen it. There is no way to know how many labels to
   * strip without a copy of the PSL, which is a dependency this repo does not
   * take. So the operator states it.
   *
   * Default `'localhost'` — the dev value, and deliberately one that CANNOT
   * silently work in production: a credential enrolled under `localhost` is
   * recorded with `localhost` in its own row (`credentials.ts`), so a box that
   * later gets a real name refuses that credential and says WHY ("enrolled for
   * localhost — re-enrol"), rather than failing an opaque signature check.
   *
   * `||`, not `??`, for the `accountsPath` reason at :185-191.
   */
  rpId: string;
  /**
   * THE FULL ORIGIN a browser must be at — scheme, host and port, serialized
   * exactly as `clientDataJSON.origin` carries it (`https://host:port`, NO
   * trailing slash, no path).
   *
   * Two consumers, and they are why this is one value rather than two:
   *  1. every passkey assertion is checked against the origin RECORDED ON THE
   *     CREDENTIAL at enrolment (`webauthn.ts`), which is this value;
   *  2. the `/ws/*` upgrade's Origin check (`gate.ts`) — the cross-site
   *     WebSocket hijack that `SameSite=Lax` does NOT stop, because `ts.net` is
   *     a public suffix and so every node on one tailnet is SAME-SITE with
   *     every other. A page on a sibling tailnet node can open a `wss://`
   *     socket to this box with the session cookie attached; only an Origin
   *     check refuses it.
   *
   * Default `http://localhost:<port>`, built from the port resolved above so
   * the two cannot drift. Same fail-loud property as {@link rpId}.
   */
  origin: string;
  /**
   * The flat-file passkey credential store (`server/src/auth/credentials.ts`).
   * `defaultPasskeysPath(home)`, for `sessionsPath`'s reason one field up.
   */
  passkeysPath: string;
}

/**
 * THE ONE place a wrapper becomes a directory — every other reader of an
 * account's config dir (`fleet.ts`, `server.ts`, `commands.ts`, `watch.ts`,
 * `sessionws.ts`) calls this instead of indexing `cfg.roster.byId` directly
 * by wrapper name (`single-definition.test.ts` enforces it). `undefined` for
 * any id the roster does not have — a `SessionRecord.wrapper` read off disk
 * is an untrusted string (a stale build, a hand-edited registry file, or the
 * `'ghost-wrapper'` fixture `pr-sweep.test.ts` writes on purpose), and the
 * whole point of this function existing is that callers get one `undefined`
 * to check rather than a bare index into a map that might not have the key.
 *
 * The lookup is DATA, not a hand-typed table, and that is load-bearing: the
 * account roster's 5th member (`claude-dev0`) was once missing from a
 * hand-typed sibling of this map for its entire life (see this file's git
 * history), because that map used to be a second literal kept BESIDE the
 * roster instead of derived FROM it. Going through `cfg.roster.byId` — built
 * once, by `loadConfig`, straight from `~/.ccrc/accounts.json` — closes that
 * class of bug structurally: an account added to the roster gets a config
 * dir here with no second edit, and none can be silently skipped the way a
 * hand-typed table could be.
 */
export function configDirFor(cfg: CcrcConfig, wrapper: string): string | undefined {
  const account = cfg.roster.byId.get(wrapper);
  return account ? path.join(cfg.home, account.configDirSuffix) : undefined;
}

/**
 * Reads and validates `accountsPath` — synchronously, on purpose:
 * `server/src/index.ts` calls `loadConfig()` at module top level with no
 * `await`, so this must never become async, and `readFileSync` is what keeps
 * it that way.
 *
 * In remote fleet mode this still reads the LOCAL box's copy, unconditionally
 * — the server may run on a different machine from the accounts it manages
 * (that is the production topology), but deploy ships the same
 * `accounts.json` to both boxes, so there is no agent round-trip to make
 * here and no FleetIO indirection to add.
 *
 * Throws `RosterError` — never returns a partial or empty roster — when the
 * file is missing, unreadable, not valid JSON, or fails `parseRoster`'s
 * validation. MISSING and UNREADABLE are deliberately distinct outcomes,
 * same discipline as the registry ladder's "not listed" vs "listed but
 * unreadable": a `chmod 000` `accounts.json` plainly EXISTS, and reporting
 * it as absent would send an operator to `ccrc install`, which overwrites
 * nothing and fixes nothing — the actual fix is a permissions change on a
 * file that was never missing.
 */
function loadRoster(accountsPath: string): Roster {
  let raw: string;
  try {
    raw = readFileSync(accountsPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RosterError(
        `no account roster at ${accountsPath}.`,
        `Run \`ccrc install\` (or ship deploy/accounts.default.json to ${accountsPath}).`,
      );
    }
    // EACCES (permission bits), EISDIR (accounts.json is a directory), or
    // anything else `readFileSync` can throw for a path that DOES exist —
    // none of these are "run the installer", they are "fix what's there".
    throw new RosterError(
      `${accountsPath} exists but could not be read: ${(err as Error).message}.`,
      `Check permissions on ${accountsPath} (and that it is a regular file, not a directory) — ` +
        'it must be readable by the ccrc server process.',
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new RosterError(
      `${accountsPath} is not valid JSON: ${(err as Error).message}.`,
      `Fix the JSON syntax in ${accountsPath}, or reinstall ccrc to restore the shipped default.`,
    );
  }
  return parseRoster(json);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CcrcConfig {
  const home = env.CCRC_HOME ?? os.homedir();
  // `||`, not `??`: an EnvironmentFile's bare `CCRC_ACCOUNTS=` line — which is
  // exactly how deploy/ccrc.env.example ships this key, along with every other
  // value whose default lives HERE rather than in that file (`CCRC_AGENT_URL`,
  // `CCRC_PROJECTS_ROOT`, the VAPID trio, …) — yields an empty string, which
  // `??` treats as "set" and `||` correctly treats the same as unset. The
  // alternative silently resolves to `no account roster at .`, naming a path
  // nobody wrote.
  const accountsPath = env.CCRC_ACCOUNTS || path.join(home, '.ccrc', 'accounts.json');
  const roster = loadRoster(accountsPath);
  // Hoisted out of the literal below because `origin`'s default is built FROM
  // it: `http://localhost:7788` and `port: 7788` must be the same 7788, and a
  // second `Number(env.CCRC_PORT ?? 7788)` inside a template string is exactly
  // the "same value derived twice" shape `coordDbPath` warns about.
  //
  // VALIDATED, WHICH IS THE HOUSE `||` RULE AND MORE (D-117).
  //
  // THE BUG: `port` used to be `Number(env.CCRC_PORT ?? 7788)`, and it is the
  // one auth-adjacent key that never got the empty-string treatment
  // `accountsPath` documents at :185-191. `Number('') === 0`, so a bare
  // `CCRC_PORT=` line in an EnvironmentFile — exactly how `deploy/ccrc.env.example`
  // ships a key whose default lives here — yielded `port: 0` AND a default
  // origin of `http://localhost:0`. That origin is not obviously broken to
  // anything downstream: `new URL` parses it, and `originProblem` ACCEPTS it
  // (loopback host, http scheme, serializes to itself), so the boot warning
  // stayed SILENT while every `/ws/*` upgrade and every non-exempt write was
  // refused for an origin no browser will ever send.
  //
  // ONE MECHANISM, NOT TWO. The obvious fix is `||` plus a range check, and that
  // is what this first was — but the range check already refuses `0`, so the
  // `||` became a guard whose deletion changed nothing and could not be tested
  // (measured: mutating it back to `??` left the whole config suite green).
  // A guard that cannot be measured is a defect here, not defence in depth, so
  // there is one operator: everything that is not a plausible TCP port —
  // `undefined`, `''`, `'abc'`, `'0'`, `'-1'`, `'80.5'`, `'70000'` — falls back
  // to the default. That is a SUPERSET of the `||` rule, and `config.test.ts`
  // enumerates the cases.
  //
  // Refusing `NaN` here rather than downstream is deliberate too: `new URL(
  // 'http://localhost:NaN')` throws, which `originProblem`'s `try` would turn
  // into a merely-loud "not a URL" — but a `NaN` handed to `listen()` is not
  // something to carry that far.
  //
  // AND IT SAYS SO WHEN IT REJECTS ONE. The fallback above is strictly safer
  // than the old `Number(env.CCRC_PORT ?? 7788)`, but it is also QUIETER, and
  // that regression is worth one line: `CCRC_PORT=70000` and `CCRC_PORT=abc`
  // used to reach `listen()` and crash with `ERR_SOCKET_BAD_PORT`, which is
  // ugly and unmissable. Falling back silently would turn a loud typo into a
  // box quietly listening somewhere the operator did not ask for.
  //
  // The ABSENT and EMPTY cases stay silent on purpose — 7788 is the correct
  // answer for both, and warning about a key nobody set is noise in every
  // journal on every boot.
  const portNum = Number(env.CCRC_PORT);
  const portOk = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535;
  if (!portOk && env.CCRC_PORT !== undefined && env.CCRC_PORT !== '') {
    console.warn(`ccrc-server: CCRC_PORT=${JSON.stringify(env.CCRC_PORT.slice(0, 40))} is not a ` +
      'TCP port (want an integer 1-65535); falling back to 7788. Both the listening port AND the ' +
      'default CCRC_ORIGIN come from this value.');
  }
  const port = portOk ? portNum : 7788;
  return {
    host: env.CCRC_HOST ?? '127.0.0.1',
    port,
    home,
    registryDir: path.join(home, '.cc-sessions'),
    limitsDir: path.join(home, '.cc-limits'),
    clipsDir: path.join(home, '.cc-clips'),
    uploadsDir: path.join(home, '.cc-clips', 'uploads'),
    ccdBin: path.join(home, '.local', 'bin', 'ccd'),
    // Spec §2's three-way reconciliation: the agent and ccd already default an
    // unconfigured box to `$HOME/projects`; `/data/projects` was this server's
    // lone holdout, a path specific to the reference fleet's own volume
    // layout rather than a portable default. The reference fleet is
    // unaffected — both its env files set `CCRC_PROJECTS_ROOT` explicitly.
    projectsRoot: env.CCRC_PROJECTS_ROOT ?? path.join(home, 'projects'),
    roster,
    accountsPath,
    fleetMode: env.CCRC_FLEET === 'remote' ? 'remote' : 'local',
    agentUrl: env.CCRC_AGENT_URL ?? null,
    agentToken: env.CCRC_AGENT_TOKEN ?? null,
    hetznerToken: env.CCRC_HETZNER_TOKEN ?? null,
    fleetServerId: env.CCRC_FLEET_SERVER_ID ?? null,
    vapidPublic: env.CCRC_VAPID_PUBLIC ?? null,
    vapidPrivate: env.CCRC_VAPID_PRIVATE ?? null,
    vapidSubject: env.CCRC_VAPID_SUBJECT ?? 'mailto:ccrc@server-box',
    // `defaultCoordDbPath`, not a second inline `path.join` — the same string
    // built twice, once tested and once not, is how a rename in one place
    // silently opens a different (or brand-new, empty) database in the other.
    coordDbPath: env.CCRC_COORD_DB ?? defaultCoordDbPath(home),
    mailTokenPath: env.CCRC_MAIL_TOKEN_PATH ?? path.join(home, '.ccrc', 'mail.token'),
    buildInfoPath: path.join(home, '.ccrc', 'build.json'),
    // The auth keys. Task 5 added ONLY the ones the gate itself consumes (the
    // plan parks config in Task 10, but there is no gating a route on a key
    // that does not exist); Task 8 adds `rpId`/`origin`/`passkeysPath`; Task 10
    // documents all of them in `deploy/ccrc.env.example` and the runbook.
    authEnabled: env.CCRC_AUTH === 'on',
    cookieSecure: env.CCRC_COOKIE_INSECURE !== 'on',
    // `||`, not `??`, for both paths — the `accountsPath` lesson at :133-140:
    // a bare `CCRC_AUTH_SECRET_PATH=` line in an EnvironmentFile yields an
    // empty string, which `??` treats as "set" and `||` correctly treats as
    // unset. With `??` the gate would look for the secret at `''` (ENOENT) and
    // fail SHUT on a box that is configured correctly — a lockout with no red
    // anywhere and a path nobody wrote.
    authSecretPath: env.CCRC_AUTH_SECRET_PATH || path.join(home, '.ccrc', 'auth.scrypt'),
    sessionsPath: env.CCRC_SESSIONS_PATH || defaultSessionsPath(home),
    // `||` for all three, same reason: a bare `CCRC_RP_ID=` line in an
    // EnvironmentFile is an empty string, and an empty rpId is not "the
    // operator chose the empty domain" — it is an unset key. With `??` the
    // enrolment ceremony would be handed `rpId: ''`, which every browser
    // refuses with an opaque `SecurityError` and no server-side trace.
    rpId: env.CCRC_RP_ID || 'localhost',
    origin: env.CCRC_ORIGIN || `http://localhost:${port}`,
    passkeysPath: env.CCRC_PASSKEYS_PATH || defaultPasskeysPath(home),
  };
}
