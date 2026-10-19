import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import {
  ACCOUNT_OP_KILL_GRACE_MS, ACCOUNT_OP_OUTPUT_MAX_BYTES, ACCOUNT_SUBS, ACCOUNT_SUB_TIMEOUT_MS, type AccountSub,
} from '../../../shared/api.js';
import { updateLauncherPath } from '../../../shared/agent-protocol.js';
import { ACCOUNT_ID_RE } from '../../../shared/roster.js';
import type { CcrcConfig } from '../config.js';
import type { FleetClient } from '../remote/client.js';

/**
 * THE `AccountOps` PORT (spec §13.2, G13; plan Task A7): how an account route runs `ccrc account <sub>` on the fleet
 * node. L2, declared here by its consumer (the account routes, A14 onward); two L3 arms below.
 *
 * WHICH BOX. The arm is chosen by `cfg.fleetMode` ONLY ({@link accountOpsFor}): local mode gets the local spawner,
 * remote mode the agent's `account` op. In remote mode the local arm is NEVER CONSTRUCTED: the controller keeps
 * only its own `~/.ccrc/accounts.json` mirror, and `index.ts` already runs a local spawner for updates there
 * (`localUpdateSpawnFor`), so wiring this port the same way would run `ccrc account add` on the controller.
 *
 * THE CHILD'S ENVIRONMENT IS EXPLICIT (D-5513): exactly `{HOME, PATH, LANG}` ({@link accountSpawnEnv}, after the
 * agent's `tokenSyncEnv`), never `process.env`, which is the server unit's and carries `CCRC_AGENT_TOKEN`,
 * `CCRC_VAPID_PRIVATE` and `CCRC_HETZNER_TOKEN` (`~/.ccrc/ccrc.env`); an inherited environment would reach every
 * verb's `claude`, `codex`, `curl` and `jq` children.
 *
 * THE SECRET'S PATH (D-5513): `stdin` only, never argv, never a log line. Nothing here logs the sub's output either:
 * the answer's stdout goes to the caller, and its stderr is drained and dropped, because no child program's output
 * reaches the browser and the caller builds refusal text from codes.
 */

/** The typed fields a sub takes. A8's argv builder turns them into flags with spec §13.2's bounds. */
export type AccountOpFields = Readonly<Record<string, string>>;

/** What one run answered. Every arm keeps these apart; none folds into another. */
export type AccountOpResult =
  /** The verb ran and exited with `code`. `stdout` is its whole output (the verbs answer one JSON document). */
  | { kind: 'exited'; code: number; stdout: string }
  /** The sub outran its bound: SIGTERM to its process group, then SIGKILL after the grace. The outcome is UNKNOWN:
   *  the caller reconciles and never retries on its own (D-5518). */
  | { kind: 'timeout' }
  /** The output passed the cap; the child was killed. Unknown outcome, as `timeout`. */
  | { kind: 'too-large' }
  /** The launcher could not be started (absent, not executable). Nothing ran. */
  | { kind: 'not-started' }
  /** Refused before any spawn: an id off the roster grammar, a sub outside the union, or typed fields while no argv
   *  builder exists yet (`fields-unbuilt`, D-5620). Nothing ran. */
  | { kind: 'refused'; why: 'bad-id' | 'bad-sub' | 'fields-unbuilt' }
  /** This arm cannot run the sub: the remote arm until the agent carries the `account` op (A8), or an older agent
   *  answering `bad-request`. Nothing ran. */
  | { kind: 'unsupported' };

/** The port. */
export interface AccountOps {
  /** Which arm this is, for the composition root's own check and the tests. Never a decision input for a route. */
  readonly arm: 'local' | 'remote';
  /** Runs `ccrc account <sub>` for lane `id` (`null` for the subs that name none: `roster`, the management subs),
   *  with `fields` as typed flags and `stdin` (a secret or a code) as the child's stdin. Never throws. */
  run(sub: AccountSub, id: string | null, fields: AccountOpFields, stdin?: Buffer): Promise<AccountOpResult>;
}

/** The child's whole environment. Nothing else from the server's own environment reaches it. */
export interface AccountSpawnEnv { HOME: string; PATH: string; LANG: string }

/** The explicit environment: the configured home and two names of the server's own environment (`tokenSyncEnv`). A
 *  PATH the server lacks is the system directories; the launcher itself is absolute. */
export function accountSpawnEnv(home: string, from: NodeJS.ProcessEnv = process.env): AccountSpawnEnv {
  return { HOME: home, PATH: from.PATH ?? '/usr/bin:/bin', LANG: from.LANG ?? 'C' };
}

const SUBS: ReadonlySet<string> = new Set(ACCOUNT_SUBS);

export interface LocalAccountOpsOpts {
  /** `cfg.home`: the launcher is `<home>/.local/bin/ccrc`, the unit's PATH lacking `~/.local/bin`. */
  home: string;
  /** Tests only: each sub's bound. Production reads `ACCOUNT_SUB_TIMEOUT_MS`. */
  timeoutMs?: (sub: AccountSub) => number;
  /** Tests only: the SIGTERM → SIGKILL grace. */
  killGraceMs?: number;
  /** Tests only: the stdout cap. */
  maxOutputBytes?: number;
}

/** The local arm: the verb spawned on this box, which in local fleet mode IS the fleet node. */
export function localAccountOps(opts: LocalAccountOpsOpts): AccountOps {
  // The same absolute shim the update op and the token sync spawn: the one spelling of the launcher's path.
  const launcher = updateLauncherPath(opts.home);
  const env = accountSpawnEnv(opts.home);
  const timeoutOf = opts.timeoutMs ?? ((sub: AccountSub) => ACCOUNT_SUB_TIMEOUT_MS[sub]);
  const grace = opts.killGraceMs ?? ACCOUNT_OP_KILL_GRACE_MS;
  const cap = opts.maxOutputBytes ?? ACCOUNT_OP_OUTPUT_MAX_BYTES;

  const run: AccountOps['run'] = async (sub, id, fields, stdin) => {
    if (typeof sub !== 'string' || !SUBS.has(sub)) return { kind: 'refused', why: 'bad-sub' };
    if (id !== null && (typeof id !== 'string' || !ACCOUNT_ID_RE.test(id) || id.startsWith('-'))) {
      return { kind: 'refused', why: 'bad-id' };
    }
    // NO FREE ARGV. The bounded builder that turns typed fields into flags is the agent's op's (A8), and both arms
    // will call that one builder; until it exists a sub with fields is refused rather than spelled twice (D-5620).
    if (Object.keys(fields).length > 0) return { kind: 'refused', why: 'fields-unbuilt' };
    const argv = id === null ? ['account', sub] : ['account', sub, `--id=${id}`];
    return new Promise<AccountOpResult>((resolve) => {
      let settled = false;
      let child: ReturnType<typeof spawn>;
      const chunks: Buffer[] = [];
      let bytes = 0;
      let ended: AccountOpResult | null = null;
      let killTimer: NodeJS.Timeout | undefined;
      const settle = (r: AccountOpResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(bound);
        if (killTimer !== undefined) clearTimeout(killTimer);
        resolve(r);
      };
      /** SIGTERM to the whole group (the verb's `claude`, `curl`, `jq` too), then SIGKILL after the grace. */
      const stop = (why: AccountOpResult): void => {
        if (ended !== null) return;
        ended = why;
        const signal = (s: NodeJS.Signals): void => {
          if (child.pid === undefined) return;
          try { process.kill(-child.pid, s); } catch { /* the group is already gone */ }
        };
        signal('SIGTERM');
        killTimer = setTimeout(() => signal('SIGKILL'), grace);
      };
      try {
        child = spawn(launcher, argv, { env: { ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
      } catch {
        resolve({ kind: 'not-started' });
        return;
      }
      const bound = setTimeout(() => stop({ kind: 'timeout' }), timeoutOf(sub));
      child.on('error', () => settle({ kind: 'not-started' }));
      child.stdout!.on('data', (b: Buffer) => {
        bytes += b.length;
        if (bytes > cap) { stop({ kind: 'too-large' }); return; }
        chunks.push(b);
      });
      // Drained so a chatty verb cannot block on a full pipe; never kept, never logged.
      child.stderr!.on('data', () => {});
      child.stdin!.on('error', () => { /* the verb closed stdin early; its exit says the rest */ });
      child.on('close', (code, signal) => {
        if (ended !== null) { settle(ended); return; }
        // A signal that was not ours reads as the shell's `128 + signo`, as the agent's token-sync port does.
        const exit = code ?? (signal === null ? 1 : 128 + (osConstants.signals[signal] ?? 0));
        settle({ kind: 'exited', code: exit, stdout: Buffer.concat(chunks).toString('utf8') });
      });
      child.stdin!.end(stdin ?? Buffer.alloc(0));
    });
  };
  return { arm: 'local', run };
}

export interface RemoteAccountOpsOpts {
  /** The one agent connection (`index.ts`). A8 sends the typed `account` op through it. */
  client: Pick<FleetClient, 'request'>;
}

/**
 * The remote arm: the agent's typed `account` op (A8). Until the agent carries it, every sub answers `unsupported`
 * and nothing is sent, which is exactly what an older agent's `bad-request` maps to (spec §13.2), so a route over
 * this arm narrows in place rather than reaching the controller's own `ccrc` (D-5620).
 */
export function remoteAccountOps(opts: RemoteAccountOpsOpts): AccountOps {
  void opts.client;
  return { arm: 'remote', run: async () => ({ kind: 'unsupported' }) };
}

/** The arm constructors, a parameter so a test can prove which one ran. */
export interface AccountOpsMakers {
  local: (opts: LocalAccountOpsOpts) => AccountOps;
  remote: (opts: RemoteAccountOpsOpts) => AccountOps;
}

const MAKERS: AccountOpsMakers = { local: localAccountOps, remote: remoteAccountOps };

/**
 * THE ONE CHOICE (G13): `cfg.fleetMode` and nothing else. Remote mode with no agent connection is a composition
 * error and throws; it never falls back to the local spawner.
 */
export function accountOpsFor(
  cfg: Pick<CcrcConfig, 'fleetMode' | 'home'>,
  link: { client: Pick<FleetClient, 'request'> | null },
  makers: AccountOpsMakers = MAKERS,
): AccountOps {
  if (cfg.fleetMode === 'remote') {
    if (link.client === null) throw new Error('accountOpsFor: remote fleet mode needs the agent connection');
    return makers.remote({ client: link.client });
  }
  return makers.local({ home: cfg.home });
}
