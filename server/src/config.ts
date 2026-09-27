import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultCoordDbPath } from './coord/db.js';
import { defaultSessionsPath } from './auth/sessions.js';
import { defaultPasskeysPath } from './auth/credentials.js';
import { parseRoster, RosterError, type Roster } from '../../shared/roster.js';
import { isNodeRole, type NodeRole } from '../../shared/api.js';

export type FleetMode = 'local' | 'remote';

/**
 * Where `CcrcConfig.role` came from (D-3174). The server had no
 * role before the update control plane (design 2026-09-20 §6, §9); the box's
 * recorded one is `CCRC_ROLE` in `~/.ccrc/ccrc.env`, written by `ccrc install`'s
 * first write of that file and handed to this process by `ccrc.service`'s
 * EnvironmentFile. THREE words, never two: `derived-absent` (nothing recorded
 * — every box `deploy.sh` seeded, D-3106) and `derived-invalid` (a token
 * outside `NodeRole`) have different remedies, so one never stands for the other.
 */
export type RoleSource = 'recorded' | 'derived-absent' | 'derived-invalid';

/** The GitHub owner/repo the catalogue poller lists (design 2026-09-20 §7). */
export interface ReleaseSource { owner: string; repo: string }

/**
 * The release source as READ (D-3175), failure included. No TS
 * root may spell the org (`single-definition.test.ts`), so the pair reaches
 * this process at runtime only: from the INSTALLED tree's `ccd/ccrc` — its two
 * release-source lines, the same pair `ccrc update` downloads from — or from
 * `CCRC_RELEASE_OWNER` + `CCRC_RELEASE_REPO` when BOTH are set. Every failure is a
 * `why`, never a throw: `loadConfig` must boot a box whose tree is elsewhere,
 * and the poller reports the failure as `no-release-source` and sends nothing.
 * `tree-absent` (ENOENT) and `tree-unreadable` (any other errno — EACCES,
 * EISDIR) are kept apart for `loadRoster`'s reason: a file that plainly exists
 * is not fixed by reinstalling. `env-malformed` (D-3196)
 * is an override the operator set and this process cannot use; it refuses
 * rather than quietly polling the tree's pair instead.
 */
export type ReleaseSourceRead =
  | { ok: true; owner: string; repo: string; from: 'env' | 'tree' }
  | { ok: false; why: 'tree-absent' | 'tree-unreadable' | 'tree-malformed'; path: string }
  | { ok: false; why: 'env-malformed'; path: null };

/** The releases API root (design 2026-09-20 §7) — the sibling of `ccd/ccrc`'s
 *  `CCRC_RELEASE_BASE_URL`, so a fixture server stands in for GitHub in tests. */
export const DEFAULT_RELEASE_API_URL = 'https://api.github.com';
/** How long an update may run before the server calls it failed (§10). Stored
 *  from W2; nothing reads it until W4's dispatcher. */
export const DEFAULT_UPDATE_DEADLINE_MS = 15 * 60_000;

/** One owner or repo name: GitHub's own character set, at most 100, and never
 *  a name made only of dots — `..` matches the character class and would walk
 *  `/repos/{owner}/{repo}/releases` up a segment (D-3196). */
const RELEASE_SOURCE_VALUE = /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/;

/**
 * This box's role: the recorded `CCRC_ROLE` when it is a `NodeRole`, else
 * DERIVED from the fleet mode — `remote` is the server box of a two-box
 * fleet, `local` is the single box that is both. A bare `CCRC_ROLE=` line is
 * absent (the house `||` rule); any other non-member is invalid, and says so.
 */
export function deriveRole(env: NodeJS.ProcessEnv, fleetMode: FleetMode): { role: NodeRole; roleSource: RoleSource } {
  const raw = env.CCRC_ROLE;
  if (isNodeRole(raw)) return { role: raw, roleSource: 'recorded' };
  const role: NodeRole = fleetMode === 'remote' ? 'server' : 'both';
  return { role, roleSource: raw === undefined || raw === '' ? 'derived-absent' : 'derived-invalid' };
}

/**
 * `roleSource`'s reader (D-3174): the one boot line that says a role
 * was DERIVED, and why. `NodeWire` carries the role and never where it came
 * from, so without this line a `deploy.sh` box that never recorded one (D-3106)
 * reads exactly like a box that did. `null` for a recorded role, which is not
 * news. `index.ts` warns it once; the words are pinned here, not by a boot.
 */
export function derivedRoleNote(c: Pick<CcrcConfig, 'role' | 'roleSource' | 'fleetMode'>): string | null {
  if (c.roleSource === 'recorded') return null;
  const why = c.roleSource === 'derived-absent' ? 'absent' : 'invalid';
  return `ccrc-server: CCRC_ROLE is ${why} in the environment — this box's role reads ${c.role} ` +
    `(derived from CCRC_FLEET=${c.fleetMode})`;
}

/**
 * The pair from a `ccd/ccrc` text: `CCRC_RELEASE_OWNER="…"` and
 * `CCRC_RELEASE_REPO="…"` at the START of a line, each EXACTLY once (a second
 * assignment is two answers, and this parser does not pick one), each value a
 * plain name. `null` on anything else. The URL lines that READ the variables
 * (`…/$CCRC_RELEASE_OWNER/…`) never match: they do not start with the name.
 * Split on `\n` and anchored per line WITHOUT the `m` flag, so `$` is the end
 * of the line: under `m`, `$` also matches before a bare `\r`, and a CRLF line
 * would parse (measured with node, 2026-09-23).
 */
export function parseReleaseSource(ccrcText: string): ReleaseSource | null {
  const lines = ccrcText.split('\n');
  const pick = (re: RegExp): RegExpExecArray[] =>
    lines.map((l) => re.exec(l)).filter((m): m is RegExpExecArray => m !== null);
  const owners = pick(/^CCRC_RELEASE_OWNER="([^"]+)"$/);
  const repos = pick(/^CCRC_RELEASE_REPO="([^"]+)"$/);
  if (owners.length !== 1 || repos.length !== 1) return null;
  const owner = owners[0]![1]!;
  const repo = repos[0]![1]!;
  return RELEASE_SOURCE_VALUE.test(owner) && RELEASE_SOURCE_VALUE.test(repo) ? { owner, repo } : null;
}

/**
 * Synchronous, for `loadRoster`'s reason: `index.ts` calls `loadConfig()` at
 * module top level with no `await`. BOTH env keys set → they decide, valid or
 * refused; one set without the other is ignored (a half-written override is
 * not an override) and the tree decides.
 */
export function readReleaseSource(env: NodeJS.ProcessEnv, installedCcrcPath: string): ReleaseSourceRead {
  const envOwner = env.CCRC_RELEASE_OWNER;
  const envRepo = env.CCRC_RELEASE_REPO;
  if (envOwner && envRepo) {
    return RELEASE_SOURCE_VALUE.test(envOwner) && RELEASE_SOURCE_VALUE.test(envRepo)
      ? { ok: true, owner: envOwner, repo: envRepo, from: 'env' }
      : { ok: false, why: 'env-malformed', path: null };
  }
  let text: string;
  try {
    text = readFileSync(installedCcrcPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      why: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'tree-absent' : 'tree-unreadable',
      path: installedCcrcPath,
    };
  }
  const src = parseReleaseSource(text);
  return src ? { ok: true, ...src, from: 'tree' } : { ok: false, why: 'tree-malformed', path: installedCcrcPath };
}

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
  /** This box's role in the update control plane (design 2026-09-20 §6, §9):
   *  the role of its own `nodes` row, and whether this process writes its own
   *  `~/.ccrc/update-intent` (`server`/`both` do). `deriveRole` decides it. */
  role: NodeRole;
  /** Where `role` came from — recorded, or derived because the record was
   *  absent or invalid (D-3174). */
  roleSource: RoleSource;
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
  /** `<home>/.ccrc` — the directory the update control plane's node files live
   *  in (`NODE_FILES`, `shared/agent-protocol.ts`). ONLY the W2 paths route
   *  through it; the older `.ccrc` paths above keep their own spellings. In
   *  remote mode the fleet node's files are read at this same absolute path
   *  over the agent, the same-path assumption `registryDir` already makes. */
  ccrcDir: string;
  /** `<home>/ccrc/ccd/ccrc` — the INSTALLED tree's `ccrc`, the tree
   *  `ccrc.service`'s ExecStart runs from; `releaseSource` is read from it. */
  installedCcrcPath: string;
  /** The catalogue's owner/repo, or why there is none (`readReleaseSource`). */
  releaseSource: ReleaseSourceRead;
  /** `CCRC_RELEASE_API_URL`, trailing slashes trimmed; `DEFAULT_RELEASE_API_URL`
   *  when unset, a bare line, or nothing but slashes. */
  releaseApiUrl: string;
  /** `CCRC_UPDATE_DEADLINE_MS` as a positive safe integer, else
   *  `DEFAULT_UPDATE_DEADLINE_MS`. Read by W4; carried from W2. */
  updateDeadlineMs: number;
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
   * TLS-terminating proxy: `tailscale serve` and Caddy alike speak https to
   * the browser and plain http to this process, so a scheme-derived flag
   * would drop `Secure` on exactly the deployment that needs it most. This
   * is a value the operator states, not one the server guesses.
   *
   * The proxy-trust decision is settled: none (spec 3b D5). Fastify is
   * constructed without `trustProxy`, and the 2026-08-21 survey measured ZERO
   * consumers of `req.ip` / `req.protocol` / `req.hostname` / `X-Forwarded-*`
   * in this package: the rate limiter is deliberately global (its own
   * docstring names spoofable `X-Forwarded-For` as the reason), and `Secure`
   * and the Origin check are config-driven by design. Turning proxy trust on
   * would buy nothing today and would create a spoof surface for whatever
   * reads `req.ip` NEXT — a consumer that arrives armed by a setting nobody
   * re-audits. `auth-routes.test.ts` pins the settlement: the string
   * `trustProxy` appears nowhere in `server/src` outside this docstring.
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
   * fleet's own hostname is a tailnet name, `<box>.<tailnet>.ts.net`, and
   * **`ts.net` is a public suffix**, as is `duckdns.org`, the other host shape
   * this project documents. Stripping one label off `<box>.<tailnet>.ts.net`
   * gives `<tailnet>.ts.net`, which is right; stripping two gives `ts.net`, which
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
 * (that is the production topology). It is NOT that the two boxes hold one
 * file: `ship_roster` (`deploy/deploy.sh`) seeds `~/.ccrc/accounts.json` only
 * when the box has none and never overwrites it afterwards, so each box's copy
 * is hand-owned and the two can differ — which is precisely why
 * `rosterAgreement` (`server/src/fleetstate.ts`) compares the generated
 * projections continuously and the PWA banners `divergent`. What follows from
 * that is the opposite of an argument for an agent round-trip: THIS box's
 * roster is the one this server serves, answers `GET /api/accounts` from and
 * builds argv against, so reading it locally is reading the right file, and a
 * FleetIO indirection here would silently swap in the OTHER box's answer.
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
  // VALIDATED, WHICH IS THE HOUSE `||` RULE AND MORE (D-130).
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
  // Hoisted for the `port`/`origin` reason above: `role` is derived FROM the
  // fleet mode, and one expression read twice is how the two come to disagree.
  const fleetMode: FleetMode = env.CCRC_FLEET === 'remote' ? 'remote' : 'local';
  const { role, roleSource } = deriveRole(env, fleetMode);
  const installedCcrcPath = path.join(home, 'ccrc', 'ccd', 'ccrc');
  const releaseApiUrl = (env.CCRC_RELEASE_API_URL || '').replace(/\/+$/, '');
  const deadlineNum = Number(env.CCRC_UPDATE_DEADLINE_MS);
  return {
    // `||`, not `??`: a bare `CCRC_HOST=` EnvironmentFile line yields '', and
    // `listen({host: ''})` binds ALL interfaces — the opposite of the loopback
    // confinement 3b rests on (D-130's bug class, closed for CCRC_PORT above).
    host: env.CCRC_HOST || '127.0.0.1',
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
    fleetMode,
    role,
    roleSource,
    agentUrl: env.CCRC_AGENT_URL ?? null,
    agentToken: env.CCRC_AGENT_TOKEN ?? null,
    hetznerToken: env.CCRC_HETZNER_TOKEN ?? null,
    fleetServerId: env.CCRC_FLEET_SERVER_ID ?? null,
    vapidPublic: env.CCRC_VAPID_PUBLIC ?? null,
    vapidPrivate: env.CCRC_VAPID_PRIVATE ?? null,
    // A VAPID contact must PARSE, not resolve (RFC 8292 wants a URI, push
    // services only log it) — and the old default named the reference server
    // box. `localhost` parses everywhere and names nobody's machine (S5).
    vapidSubject: env.CCRC_VAPID_SUBJECT ?? 'mailto:ccrc@localhost',
    // `defaultCoordDbPath`, not a second inline `path.join` — the same string
    // built twice, once tested and once not, is how a rename in one place
    // silently opens a different (or brand-new, empty) database in the other.
    coordDbPath: env.CCRC_COORD_DB ?? defaultCoordDbPath(home),
    mailTokenPath: env.CCRC_MAIL_TOKEN_PATH ?? path.join(home, '.ccrc', 'mail.token'),
    buildInfoPath: path.join(home, '.ccrc', 'build.json'),
    ccrcDir: path.join(home, '.ccrc'),
    installedCcrcPath,
    releaseSource: readReleaseSource(env, installedCcrcPath),
    // `||` in effect for both knobs: '' trims to '' and falls to the default,
    // and `Number('')` is 0, which the positive test refuses.
    releaseApiUrl: releaseApiUrl || DEFAULT_RELEASE_API_URL,
    updateDeadlineMs: Number.isSafeInteger(deadlineNum) && deadlineNum > 0 ? deadlineNum : DEFAULT_UPDATE_DEADLINE_MS,
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
