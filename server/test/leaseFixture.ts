// Delegation broker wave 5: the lease fixture the carrier's suites share (PR2 Task 5.2.1 Step 1, extracted from
// `ccd-ws-lease-mark.test.ts` in a move commit of its own). Every helper takes the harness: each runs on a FIXTURE HOME
// (`makeCcdHarness`), never the live `~/.cc-sessions`.
import fs from 'node:fs';
import path from 'node:path';
import type { CcdHarness } from './ccdWsHelpers.js';

export const LEASE = '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab';
export const OTHER = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
export const THIRD = '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091';
export const INC = '11111111-2222-4333-8444-555555555555';
export const hex = (s: string): string => Buffer.from(s).toString('hex');

/** `ccd-ws-orphan-verb.test.ts`'s probe stubs, copied whole: nobody uses any path, and the collector's idle walk answers
 *  eight days quiet (the audit never asks it; PR4's orphan rung does). */
const NOW = Math.floor(Date.now() / 1000);
export const STUBS = '_ws_cwd_users() { return 0; };'
  + ' _ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
  + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(0); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=(""); done; return 0; };'
  + ` _ws_collect_idle() { _WS_IDLE_NEWEST_NS="${NOW - 8 * 86400}000000000"; _WS_IDLE_COUNT=7; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''; return 0; };`;

export const reg = (h: CcdHarness): string => path.join(h.home, '.cc-sessions');
export const leasesDir = (h: CcdHarness): string => path.join(reg(h), 'delegation', 'leases');
export const main = (h: CcdHarness): string => path.join(h.home, 'projects', 'demo');
export const agentTree = (h: CcdHarness, name = 'agent-a', at = path.join(main(h), '.claude', 'worktrees', name),
  from = main(h)): string => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  h.git(from, 'worktree', 'add', '-b', `claude/${name}`, '--', at);
  return fs.realpathSync(at);
};
export type Flags = Record<string, string | null>;
export const BASE: Flags = { lease: LEASE, generation: '1', project: 'demo', 'admin-record-hex': hex('agent-a'),
  parent: 'lane-a-demo', 'parent-incarnation': INC, activity: 'act-1', source: 'agent', state: 'ephemeral', 'journal-seq': '7' };
export interface Out { code: number; doc: Record<string, unknown>; lines: string[] }
export const run = (h: CcdHarness, argv: string, pre = ''): Out => {
  const out = h.sh(`${pre} cmd_ws_lease_mark ${argv}; echo "rc=$?"`).trim().split('\n');
  const code = Number(/^rc=(\d+)$/.exec(out.pop()!)![1]);
  return { code, lines: out, doc: JSON.parse(out[out.length - 1] ?? '{}') as Record<string, unknown> };
};
export const mark = (h: CcdHarness, over: Flags = {}, pre = ''): Out =>
  run(h, Object.entries({ ...BASE, ...over }).filter(([, v]) => v !== null).map(([k, v]) => `--${k} ${v}`).join(' '), pre);
export const carrierPath = (h: CcdHarness, id = LEASE): string => path.join(leasesDir(h), `${id}.json`);
export const carrier = (h: CcdHarness, id = LEASE): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(carrierPath(h, id), 'utf8')) as Record<string, unknown>;
