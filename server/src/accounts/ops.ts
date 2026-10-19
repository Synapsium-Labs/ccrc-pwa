import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import {
  ACCOUNT_OP_KILL_GRACE_MS, ACCOUNT_OP_OUTPUT_MAX_BYTES, ACCOUNT_SUB_TIMEOUT_MS, type AccountSub,
} from '../../../shared/api.js';
import {
  ACCOUNT_OP, accountOpRequestTimeoutMs, readAccountOpAnswer, updateLauncherPath, type AccountOpReq,
} from '../../../shared/agent-protocol.js';
import { buildAccountArgv, isAccountStdin, type AccountArgvRefusal } from '../../../shared/account-argv.js';
import type { CcrcConfig } from '../config.js';
import { AgentOpError, LinkNotSentError, type FleetClient } from '../remote/client.js';

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

/** The typed fields a sub takes. `buildAccountArgv` (`shared/account-argv.ts`, A8) turns them into flags with spec
 *  §13.2's bounds, for both arms. */
export type AccountOpFields = Readonly<Record<string, string>>;

/** What one run answered. Every arm keeps these apart; none folds into another. The remote arm adds the node's
 *  `fleetIdentity` from the agent's answer (spec §13.2, "every answer carries `fleetIdentity`"); the local arm, whose
 *  node is this box, sends none, and the verbs' own JSON carries theirs (§3.9). */
export type AccountOpResult = AccountOpOutcomeKinds & { readonly fleetIdentity?: string | null };

type AccountOpOutcomeKinds =
  /** The verb ran and exited with `code`. `stdout` is its whole output (the verbs answer one JSON document). */
  | { kind: 'exited'; code: number; stdout: string }
  /** The sub outran its bound: SIGTERM to its process group, then SIGKILL after the grace. The outcome is UNKNOWN:
   *  the caller reconciles and never retries on its own (D-5518). */
  | { kind: 'timeout' }
  /** The output passed the cap; the child was killed. Unknown outcome, as `timeout`. */
  | { kind: 'too-large' }
  /** The launcher could not be started (absent, not executable). Nothing ran. */
  | { kind: 'not-started' }
  /** Refused before any spawn by the builder (`AccountArgvRefusal`: a sub outside the union, an id off the roster
   *  grammar, a field off its bound, stdin off its bytes rule), by this arm or by the agent. Nothing ran. */
  | { kind: 'refused'; why: AccountArgvRefusal }
  /** This arm cannot run the sub: an agent that does not name the `account` op in its ready frame (nothing is
   *  sent), or an older agent answering `bad-request`. Nothing ran. */
  | { kind: 'unsupported' }
  /** Remote arm only: the frame left and no answer came back (the link's deadline, a disconnect, an agent error
   *  after the send, or an answer off its grammar). The outcome is UNKNOWN, as `timeout`: the caller reconciles and
   *  never retries on its own (D-5518). */
  | { kind: 'lost' };

/** The port. */
export interface AccountOps {
  /** Which arm this is, for the composition root's own check and the tests. Never a decision input for a route. */
  readonly arm: 'local' | 'remote';
  /** Runs `ccrc account <sub>` for lane `id` (`null` for the subs that name none: `roster`, the management subs),
   *  with `fields` as typed flags and `stdin` (a secret or a code, 1 to 8 KiB, no C0 or DEL) as the child's stdin.
   *  Never throws. */
  run(sub: AccountSub, id: string | null, fields: AccountOpFields, stdin?: Buffer): Promise<AccountOpResult>;
}

/** The child's whole environment. Nothing else from the server's own environment reaches it. */
export interface AccountSpawnEnv { HOME: string; PATH: string; LANG: string }

/** The explicit environment: the configured home and two names of the server's own environment (`tokenSyncEnv`). A
 *  PATH the server lacks is the system directories; the launcher itself is absolute. */
export function accountSpawnEnv(home: string, from: NodeJS.ProcessEnv = process.env): AccountSpawnEnv {
  return { HOME: home, PATH: from.PATH ?? '/usr/bin:/bin', LANG: from.LANG ?? 'C' };
}

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
  const env = accountSpawnEnv(opts.home);
  const timeoutOf = opts.timeoutMs ?? ((sub: AccountSub) => ACCOUNT_SUB_TIMEOUT_MS[sub]);
  const grace = opts.killGraceMs ?? ACCOUNT_OP_KILL_GRACE_MS;
  const cap = opts.maxOutputBytes ?? ACCOUNT_OP_OUTPUT_MAX_BYTES;

  const run: AccountOps['run'] = async (sub, id, fields, stdin) => {
    // NO FREE ARGV. The ONE bounded builder both arms call (`shared/account-argv.ts`, A8, D-5622), and the one
    // stdin bytes rule; a refusal spawns nothing.
    if (stdin !== undefined && !isAccountStdin(stdin)) return { kind: 'refused', why: 'key-charset' };
    const built = buildAccountArgv(sub, id, fields, stdin !== undefined);
    if (!built.ok) return { kind: 'refused', why: built.why };
    const argv = [...built.argv];
    // The same absolute shim the update op and the token sync spawn: the one spelling of the launcher's path.
    // Resolved per call, as `localUpdateSpawnFor` does, so a home it refuses (relative, or ending in `/`) answers
    // `not-started` here and never crashes the boot that builds this arm (D-5621).
    let launcher: string;
    try { launcher = updateLauncherPath(opts.home); } catch { return { kind: 'not-started' }; }
    return new Promise<AccountOpResult>((resolve) => {
      let settled = false;
      let child: ReturnType<typeof spawn>;
      const chunks: Buffer[] = [];
      let bytes = 0;
      let ended: AccountOpResult | null = null;
      const settle = (r: AccountOpResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(bound);
        // Once `stop` has fired, the group's KILL is NOT cancelled here (D-5621): the leader's exit raises `close`,
        // but a group member that ignores TERM and closed its stdio is still running and still gets KILL.
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
        setTimeout(() => signal('SIGKILL'), grace).unref();
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
  /** The one agent connection (`index.ts`): its `request`, and its `state.agentOps` (the ready frame's `ops`). */
  client: Pick<FleetClient, 'request' | 'state'>;
}

/**
 * The remote arm: the agent's typed `account` op (spec §13.2; A8). The frame is built here from the SAME builder the
 * agent runs (so a refusal never reaches the wire), and sent only to an agent whose ready frame names the op: an
 * agent that does not is answered `unsupported` with nothing sent, so a secret never travels to a peer that cannot
 * spawn it. An older agent that answers `bad-request` anyway maps to `unsupported` too (D-5620 (5)).
 *
 * The secret is `stdinB64` on the one frame: the frame is built in `sendAccountFrame` and kept by neither this arm
 * across its await nor the client while the answer is pending (`remote/client.ts`; both proved by a WeakRef and a
 * collector run, D-5623), and nothing here logs a frame, a field or an answer's stdout. The caller's `stdin`
 * buffer is the caller's: it lives as long as the route holds it.
 */
/** Builds the one `account` frame and hands it to the client; the frame is this call's alone and dies with it. */
function sendAccountFrame(
  client: Pick<FleetClient, 'request'>, sub: AccountSub, id: string | null, fields: AccountOpFields, stdin: Buffer | undefined,
): ReturnType<FleetClient['request']> {
  const frame: Omit<AccountOpReq, 'id'> = { t: 'req', op: ACCOUNT_OP, sub, laneId: id, fields: { ...fields } };
  if (stdin !== undefined) frame.stdinB64 = stdin.toString('base64');
  return client.request(frame, accountOpRequestTimeoutMs(sub));
}

export function remoteAccountOps(opts: RemoteAccountOpsOpts): AccountOps {
  const { client } = opts;
  const run: AccountOps['run'] = async (sub, id, fields, stdin) => {
    if (stdin !== undefined && !isAccountStdin(stdin)) return { kind: 'refused', why: 'key-charset' };
    const built = buildAccountArgv(sub, id, fields, stdin !== undefined);
    if (!built.ok) return { kind: 'refused', why: built.why };
    if (!(client.state.agentOps ?? []).includes(ACCOUNT_OP)) return { kind: 'unsupported' };
    try {
      // D-5623: the frame is built and handed over inside `sendAccountFrame`, so this async frame never names it and
      // nothing here keeps it (or its `stdinB64`) alive across the await. `stdin` itself is the caller's buffer and
      // lives as long as the caller (the route) keeps it.
      const res = await sendAccountFrame(client, sub, id, fields, stdin);
      const answer = readAccountOpAnswer(res);
      return answer ?? { kind: 'lost' };
    } catch (e) {
      if (e instanceof AgentOpError && e.code === 'bad-request') return { kind: 'unsupported' };
      // The frame never left: nothing ran.
      if (e instanceof LinkNotSentError) return { kind: 'not-started' };
      return { kind: 'lost' };
    }
  };
  return { arm: 'remote', run };
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
  link: { client: Pick<FleetClient, 'request' | 'state'> | null },
  makers: AccountOpsMakers = MAKERS,
): AccountOps {
  if (cfg.fleetMode === 'remote') {
    if (link.client === null) throw new Error('accountOpsFor: remote fleet mode needs the agent connection');
    return makers.remote({ client: link.client });
  }
  return makers.local({ home: cfg.home });
}
