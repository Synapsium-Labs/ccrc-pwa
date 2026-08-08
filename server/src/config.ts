import os from 'node:os';
import path from 'node:path';
import { defaultCoordDbPath } from './coord/db.js';

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
  wrappers: Record<string, string>;
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
    wrappers: {
      claude: path.join(home, '.claude'),
      claude2: path.join(home, '.claude-personal'),
      'claude-corp': path.join(home, '.claude-corp'),
      gpt: path.join(home, '.claude-gpt'),
    },
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
