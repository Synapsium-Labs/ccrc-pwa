// The approvals lane's shared fixture (coordinator-first routing plan Task 16, D-5298): a fixture HOME with a registry,
// a real `CoordStore`, a `FleetWatcher` sharing one `deps` with `buildServer`, a stubbed tmux, and the request a
// child's PermissionRequest hook sends, built from Task 13's committed capture (every key kept, only `cwd`, `agent_id`
// and `tool_input` varied). Neutral ids only (the plan's Global constraints). Nothing here touches the live HOME.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import type { Runner } from '../src/exec.js';
import type { PushPayload } from '../src/push.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { approvalDigestBytes, CHILD_DENY_SETTINGS_FILE } from '../../shared/api.js';

export const TOKEN = 'f'.repeat(64);
export const TOK = { 'x-ccrc-mail-token': TOKEN };

export const CHILD = 'project-a-quiet-basin';
export const CHILD2 = 'project-a-still-cove';
export const PARENT = 'project-a-calm-mesa';
export const DUNE = 'project-a-open-dune';
export const FAR = 'project-b-far-ridge';
export const FAR_C = 'project-c-open-dune';
export const uuidOf = (id: string): string => `u-${id}`;
export const workdirOf = (id: string): string => `/w/project-a/${id}`;
export const VERIFIED = '2.1.302';

/** Task 13's committed 2.1.302 PermissionRequest payloads (main thread and subagent), every key kept. */
const capture = (scenario: 'permission-main' | 'permission-subagent'): Record<string, unknown> => {
  const f = path.join(__dirname, 'fixtures', 'approvals', 'captures', '2.1.302', `${scenario}.json`);
  const doc = JSON.parse(readFileSync(f, 'utf8')) as { events: { event: string; payload: Record<string, unknown> }[] };
  const ev = doc.events.find((e) => e.event === 'PermissionRequest');
  if (ev === undefined) throw new Error(`${scenario}: no PermissionRequest in the capture`);
  return ev.payload;
};
export const MAIN_PAYLOAD = capture('permission-main');
export const SUB_PAYLOAD = capture('permission-subagent');

/** A hook input: the captured shape, with this request's working directory, agent and command. */
export function hookInput(o: { cwd?: string | null; agentId?: string; command?: string; tool?: string; toolInput?: Record<string, unknown> }):
  Record<string, unknown> {
  const base = { ...(o.agentId === undefined || o.agentId === '' ? MAIN_PAYLOAD : SUB_PAYLOAD) };
  if (o.agentId !== undefined && o.agentId !== '') base['agent_id'] = o.agentId;
  if (o.cwd === null) delete base['cwd']; else base['cwd'] = o.cwd ?? workdirOf(CHILD);
  base['tool_name'] = o.tool ?? 'Bash';
  base['tool_input'] = o.toolInput ?? { command: o.command ?? 'rm -rf build', description: 'Remove the build directory' };
  return base;
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The request body the hook sends for `input` (`ApprovalRequestBody`): the canonical array, its digest, a fresh nonce. */
export function requestBody(input: Record<string, unknown>, id = CHILD): Record<string, unknown> {
  const canonical = approvalDigestBytes(input);
  if (canonical === null) throw new Error('the fixture input has no canonical form');
  return { v: 1, sessionId: id, sessionUuid: uuidOf(id), canonical, digest: sha256(canonical), nonce: randomBytes(16).toString('hex') };
}

export interface Approvals {
  home: string; coord: CoordStore; app: FastifyInstance; watcher: FleetWatcher; log: NotifyLog;
  sent: PushPayload[]; panes: Map<string, string>; gone: Set<string>; unmeasured: Set<string>;
  /** A registry row: wrapper `claude`, the project, a workdir, a uuid, and a live state file naming `version`. */
  seed(id: string, project: string, version?: string | null): void;
  /** Make `id` a dispatched child of `runId`, spawned with Task 15's two fields (the managed deny digest and bash). */
  child(id: string, runId: number, o?: { deny?: string | null; shell?: string | null }): void;
  /** Open a run claimed by `claimedBy` (attributed: stamped `coordProject`) naming `sessionId`. */
  run(claimedBy: string | null, sessionId: string, o?: { project?: string; coordProject?: string | null; unattributed?: boolean; program?: string }): number;
  request(body: Record<string, unknown>): ReturnType<FastifyInstance['inject']>;
  rule(id: number, from: string, verdict: 'allow' | 'deny', extra?: Record<string, unknown>): ReturnType<FastifyInstance['inject']>;
  release(id: number, from: string): ReturnType<FastifyInstance['inject']>;
  ruling(id: number, nonce: string): ReturnType<FastifyInstance['inject']>;
  close(): Promise<void>;
}

const DENY_FILE = '{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}\n';
export const DENY_DIGEST = sha256(DENY_FILE);

export async function approvalsFixture(over: { role?: 'server' | 'both' } = {}): Promise<Approvals> {
  const home = mkTmp('ccrc-approvals-');
  const reg = path.join(home, '.cc-sessions');
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, CHILD_DENY_SETTINGS_FILE), DENY_FILE);
  const pids = new Map<string, number>();
  const panes = new Map<string, string>();
  const gone = new Set<string>();
  const unmeasured = new Set<string>();
  let nextPid = 61000;
  let runSeq = 0;
  const runner: Runner = async (_cmd, args) => {
    const target = args[2] ?? '';
    const id = /^=cc-(.*):$/.exec(target)?.[1] ?? '';
    if (args[0] === 'has-session') {
      if (unmeasured.has(id)) return { code: 1, stdout: '', stderr: 'server exited unexpectedly' };
      return gone.has(id) ? { code: 1, stdout: '', stderr: `can't find session: cc-${id}` } : { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'list-panes') {
      const pid = pids.get(id);
      return pid === undefined ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: `${pid}\n`, stderr: '' };
    }
    if (args[0] === 'capture-pane') return { code: 0, stdout: panes.get(id) ?? 'ready\n❯ \n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const log = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await log.load();
  const sent: PushPayload[] = [];
  const base = testDeps(home, runner);
  const deps = {
    ...base, cfg: { ...base.cfg, role: over.role ?? 'server' }, mailToken: TOKEN, coord, notifyLog: log,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
  };
  const watcher = new FleetWatcher(deps, new Bus(), 10_000);
  const app = await buildServer(deps, new Bus(), watcher);
  const put = (id: string, field: string, v: string): void => writeFileSync(path.join(reg, `${id}.${field}`), v);
  const f: Approvals = {
    home, coord, app, watcher, log, sent, panes, gone, unmeasured,
    seed(id, project, version = VERIFIED) {
      for (const [k, v] of Object.entries({ wrapper: 'claude', project, workdir: workdirOf(id), uuid: uuidOf(id), started: '1' })) put(id, k, v);
      nextPid += 1;
      pids.set(id, nextPid);
      writeFileSync(path.join(cfgDir, 'sessions', `${nextPid}.json`), JSON.stringify({
        pid: nextPid, sessionId: uuidOf(id), cwd: workdirOf(id), status: 'busy', statusUpdatedAt: Date.now(),
        ...(version === null ? {} : { version }),
      }));
    },
    child(id, runId, o = {}) {
      put(id, 'child', String(runId));
      if (o.deny !== null) put(id, 'deny-settings', o.deny ?? DENY_DIGEST);
      else rmSync(path.join(reg, `${id}.deny-settings`), { force: true });
      if (o.shell !== null) put(id, 'childshell', o.shell ?? '/bin/bash');
      else rmSync(path.join(reg, `${id}.childshell`), { force: true });
    },
    run(claimedBy, sessionId, o = {}) {
      const project = o.project ?? 'project-a';
      runSeq += 1;
      const r = coord.openRun({
        program: o.program ?? `prog-${runSeq}`, title: 'Prog', project, wave: 1, waveOf: null,
        claimedBy: claimedBy ?? 'nobody-yet', coordProject: o.coordProject === undefined ? project : o.coordProject as string,
      }) as { id?: number };
      if (typeof r.id !== 'number') throw new Error(`fixture: the run open was refused (${JSON.stringify(r)})`);
      coord.setSession(r.id, sessionId);
      if (claimedBy === null) coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(r.id);
      if (o.unattributed) coord.db.prepare('UPDATE runs SET unattributed = 1 WHERE id = ?').run(r.id);
      if (o.coordProject === null) coord.db.prepare('UPDATE runs SET coordProject = NULL WHERE id = ?').run(r.id);
      return r.id as number;
    },
    request: (body) => app.inject({ method: 'POST', url: '/api/approvals', headers: TOK, payload: body }),
    rule: (id, from, verdict, extra = {}) => app.inject({
      method: 'POST', url: `/api/approvals/${id}/rule`, headers: TOK,
      payload: { fromId: from, fromUuid: uuidOf(from), verdict, reason: `${verdict} by the fixture`, ...extra },
    }),
    release: (id, from) => app.inject({
      method: 'POST', url: `/api/approvals/${id}/release`, headers: TOK, payload: { fromId: from, fromUuid: uuidOf(from) },
    }),
    ruling: (id, nonce) => app.inject({ method: 'GET', url: `/api/approvals/${id}/ruling?nonce=${nonce}`, headers: TOK }),
    close: async () => { await app.close(); },
  };
  return f;
}

/** The standard family: a parent and its child in `project-a`, a second child, an operator-created session of the
 *  same project, and sessions in two other projects; the child dispatched by an attributed run of the parent. */
export async function standardFixture(over: { role?: 'server' | 'both' } = {}): Promise<Approvals & { runId: number }> {
  const f = await approvalsFixture(over);
  f.seed(PARENT, 'project-a');
  f.seed(CHILD, 'project-a');
  f.seed(CHILD2, 'project-a');
  f.seed(DUNE, 'project-a');
  f.seed(FAR, 'project-b');
  f.seed(FAR_C, 'project-c');
  const runId = f.run(PARENT, CHILD);
  f.child(CHILD, runId);
  return { ...f, runId };
}

export const approvalCount = (coord: CoordStore): number =>
  (coord.db.prepare('SELECT COUNT(*) AS n FROM approvals').get() as { n: number }).n;
