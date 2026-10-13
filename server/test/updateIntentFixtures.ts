// The node side of the update-intent projection (design 2026-09-20 §9), run
// for real from a test. `ccd/ccrc` is SOURCED in a fixture HOME — its
// BASH_SOURCE guard (ccrc-cli.test.ts, 'the BASH_SOURCE guard actually
// guards') means sourcing defines every function and dispatches no verb — and
// `_upd_intent_state`, the ONE reader every `ccrc update` with no `--to` and
// every `ccrc channel` goes through (W4a Task 8), is asked for its answer.
//
// A module, not a helper inside a .test.ts: two files drive it —
// update-intent-cross-side.test.ts (a fleet node's pulled copy) and
// update-projection.test.ts (a server-role node's own file) — and importing a
// .test.ts would register its tests inside the importer. One copy, so the two
// cross-side pins cannot drift apart (pool-accounts-route.test.ts hoisted its
// `syncInto` for the same reason).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghContainedEnv } from './ccdWsHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The repo's own script under test — never an installed copy. */
export const CCRC = path.join(REPO, 'ccd', 'ccrc');

/** A contained environment for a node HOME: HOME and TMPDIR inside the
 *  fixture, `gh` and the three service-manager binaries poisons first on PATH
 *  (`ghContainedEnv`, systemd opt-in — this reader and the watchdog must never
 *  reach a real user manager), and none of the runner's own update knobs
 *  leaking into the child. */
export function nodeEnv(home: string): NodeJS.ProcessEnv {
  const tmp = path.join(home, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const base: NodeJS.ProcessEnv = { ...process.env, HOME: home, TMPDIR: tmp };
  for (const k of ['CCRC_UPDATE_DEADLINE_MS', 'CCRC_UPDATE_HEALTH_S', 'CCRC_RELEASE_BASE_URL',
    'CCRC_UPDATE_LOCK_HELD', 'CCRC_UPDATE_VERIFIED']) delete base[k];
  return ghContainedEnv(home, base, { systemd: true });
}

export type NodeRoleWord = 'fleet' | 'server' | 'both';

/** Records the node's role where `cmd_install` does (`~/.ccrc/ccrc.env`,
 *  `CCRC_ROLE=`), and for a FLEET node plants the puller's timer unit FILE —
 *  what "configured" means to the reader on a fleet box (W4a Task 8, the
 *  `_pool_sync_installed` rule: the unit file, never the projection's own
 *  absence). Zero bytes; nothing reads the unit's content. */
export function plantNode(home: string, role: NodeRoleWord): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), `CCRC_ROLE=${role}\n`);
  if (role === 'fleet') {
    const units = path.join(home, '.config', 'systemd', 'user');
    mkdirSync(units, { recursive: true });
    writeFileSync(path.join(units, 'ccd-update-sync.timer'), '');
  }
}

export interface IntentRead {
  state: string; role: string; why: string;
  epoch: string; issued: string; lease: string; channel: string;
  desired: string; desiredStable: string; desiredDev: string; auto: string;
}

/** Each field and the global `_upd_intent_state` sets it in (Task 8). */
const FIELDS: ReadonlyArray<readonly [keyof IntentRead, string]> = [
  ['state', 'UPD_INTENT_STATE'], ['role', 'UPD_INTENT_ROLE'], ['why', 'UPD_INTENT_WHY'],
  ['epoch', 'UPD_INTENT_EPOCH'], ['issued', 'UPD_INTENT_ISSUED'], ['lease', 'UPD_INTENT_LEASE'],
  ['channel', 'UPD_INTENT_CHANNEL'], ['desired', 'UPD_INTENT_DESIRED'],
  ['desiredStable', 'UPD_INTENT_DESIRED_STABLE'], ['desiredDev', 'UPD_INTENT_DESIRED_DEV'],
  ['auto', 'UPD_INTENT_AUTO'],
];

/** The REAL reader's answer for the node at `home`. `${VAR-}` because the
 *  eight document fields are set only on `ok`/`none`, and ccrc runs `set -u`. */
export function readIntent(home: string): IntentRead {
  const script = [
    'source "$1" >/dev/null || exit 90',
    '_upd_intent_state',
    ...FIELDS.map(([k, v]) => `printf '%s=%s\\n' ${k} "\${${v}-}"`),
  ].join('\n');
  const r = spawnSync('bash', ['-c', script, '_', CCRC], { env: nodeEnv(home), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`_upd_intent_state did not run (exit ${r.status}): ${r.stderr}`);
  const got: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) got[line.slice(0, i)] = line.slice(i + 1);
  }
  const out = {} as IntentRead;
  for (const [k] of FIELDS) out[k] = got[k] ?? '';
  return out;
}
