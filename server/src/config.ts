import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultCoordDbPath } from './coord/db.js';
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
  return {
    host: env.CCRC_HOST ?? '127.0.0.1',
    port: Number(env.CCRC_PORT ?? 7788),
    home,
    registryDir: path.join(home, '.cc-sessions'),
    limitsDir: path.join(home, '.cc-limits'),
    clipsDir: path.join(home, '.cc-clips'),
    uploadsDir: path.join(home, '.cc-clips', 'uploads'),
    ccdBin: path.join(home, '.local', 'bin', 'ccd'),
    projectsRoot: env.CCRC_PROJECTS_ROOT ?? '/data/projects',
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
  };
}
