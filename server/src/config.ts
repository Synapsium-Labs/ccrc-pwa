import os from 'node:os';
import path from 'node:path';
import { defaultCoordDbPath } from './coord/db.js';
import { ACCOUNTS, isWrapper, type Wrapper } from '../../shared/api.js';

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
  /** One entry per `shared/api.ts` `ACCOUNTS` member — built by `loadConfig`
   *  from `configDirFor`, below, so a wrapper cannot be added to the roster
   *  without also gaining a config dir here. Index it through `configDirFor`
   *  (an untrusted `SessionRecord.wrapper` needs the `undefined` case this
   *  gives; a known `Wrapper` never does) rather than `wrappers[x]` — see
   *  `single-definition.test.ts`. */
  wrappers: Record<Wrapper, string>;
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
}

/**
 * THE ONE place a wrapper becomes a directory — every other reader of an
 * account's config dir (`fleet.ts`, `server.ts`, `commands.ts`, `watch.ts`,
 * `sessionws.ts`) calls this instead of indexing the `wrappers` map on
 * `CcrcConfig` directly by wrapper name (`single-definition.test.ts`
 * enforces it). `undefined` for anything `isWrapper` rejects — a
 * `SessionRecord.wrapper` read off disk is an untrusted string (a stale
 * build, a hand-edited registry file, or the
 * `'ghost-wrapper'` fixture `pr-sweep.test.ts` writes on purpose), and the
 * whole point of this function existing is that callers get one `undefined`
 * to check rather than a bare index into a map that might not have the key.
 */
export function configDirFor(home: string, wrapper: string): string | undefined {
  return isWrapper(wrapper) ? path.join(home, ACCOUNTS[wrapper].configDirSuffix) : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CcrcConfig {
  const home = env.CCRC_HOME ?? os.homedir();
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
    // Every `ACCOUNTS` member gets an entry, DERIVED — the 5th account
    // (`claude-dev0`) was missing here for its entire life (see the git
    // history of this line) because this used to be a hand-typed literal
    // beside the roster instead of built from it; that class of bug is what
    // `configDirFor(home, w) as string` closes: `w` ranges over
    // `Object.keys(ACCOUNTS)`, so a member added to the roster gets a
    // config dir here with no second edit, and none can be silently
    // skipped the way a hand-typed object literal could be.
    wrappers: Object.fromEntries(
      (Object.keys(ACCOUNTS) as Wrapper[]).map((w) => [w, configDirFor(home, w) as string]),
    ) as Record<Wrapper, string>,
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
  };
}
