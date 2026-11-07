// Delegation broker wave 5, PR7 (Task 5.7.2, W5-D12; D-7832): adoption only for fixture-proven correlation classes. For every lane
// version in the capture corpus (`fixtures/delegation/matrix.json`), each scenario below is REPLAYED to a checkpoint: the real
// session hook writes the captured payloads into a fixture spool, the lane ingests and correlates them against a census built from the
// capture's own admin records and metas, and the adoption decider is given the audit answer the scenario's name states and a settled
// watch. Every home is a fixture: nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`, and the tmux the hook asks is a stub.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { FleetWatcher, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { DELEGATION_CHECKPOINT_FILE, decodeDelegationCheckpoint } from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_EVENTS_CAP, formatDelegationInstant, type DelegationCensusRecord, type DelegationCheckpointV1 } from '../src/coord/delegation-model.js';
import type { DelegationCensusPass } from '../src/coord/gitref.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import {
  DELEGATION_ADOPTABLE_SOURCES, DELEGATION_ADOPT_SETTLE_MS, decideAdoption, type AdoptionDecision,
} from '../src/coord/delegation-adoption.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

const FIXTURES = path.resolve(__dirname, 'fixtures/delegation');
const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const OWNER = 'demo-a';
const INC = '0189abcd-1234-5678-9abc-0123456789ab';
const PROJECT = 'repo';
const CELL_MS = 240_000;

type Captured = { seq: number; event: string; envSid: string; payload: Record<string, unknown> };
interface Capture {
  events: Captured[];
  disk: { admin: Record<string, { gitdir: string; head: string; claudeBase: string | null; locked: boolean; firstLogSha: string | null }>;
    metas: Record<string, unknown> };
}
const MATRIX = JSON.parse(readFileSync(path.join(FIXTURES, 'matrix.json'), 'utf8')) as { versions: string[]; cells: Record<string, { status: string }> };
const VERSIONS = [...MATRIX.versions];
/** The audit each scenario's name states (rule 7): the tree changed, was left dirty, or was left unchanged. */
const AUDIT: Record<string, boolean> = { 'agent-iso-changed': true, 'agent-iso-dirty': true, 'agent-iso-unchanged': false,
  'raw-worktree': true, 'wf-iso': true, 'wf-limit-pause': true };
const SCENARIOS = Object.keys(AUDIT);
const measured = (v: string, s: string): boolean => MATRIX.cells[`${v}/${s}`]?.status === 'measured';

afterEach(() => { vi.restoreAllMocks(); });

/** Every `/rig/...` string of the capture, re-rooted under `root` (the capture's own paths name its synthetic `/rig`). */
const reroot = <T>(v: T, root: string): T => JSON.parse(JSON.stringify(v).replace(/"\/rig\//g, `"${root}/rig/`).replace(/([ =:>])\/rig\//g, `$1${root}/rig/`)) as T;

/** One capture, replayed to the lane's checkpoint. */
async function replay(version: string, scenario: string): Promise<{ checkpoint: DelegationCheckpointV1; census: DelegationCensusRecord[]; capture: Capture }> {
  vi.restoreAllMocks();                                               // the previous replay's clock
  const home = mkTmp('ccrc-adopt-corpus-');
  const capture = reroot(JSON.parse(readFileSync(path.join(FIXTURES, version, `${scenario}.json`), 'utf8')) as Capture, home);
  // the fixture box: a registry row with its generation, the owner's spool directory, a stub tmux that names the owner
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(path.join(reg, 'delegation', 'spool', OWNER), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(reg, `${OWNER}.generation`), INC);
  mkdirSync(path.join(home, 'bin'), { recursive: true });
  writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\ntrap '' TERM\necho "cc-${OWNER}"\n`, { mode: 0o755 });
  mkdirSync(path.join(home, 'rig', PROJECT), { recursive: true });
  // the capture's metas, where the parent's transcript tree would hold them (`cfg/<project dir>/...` under the config's projects)
  for (const [rel, body] of Object.entries(capture.disk.metas)) {
    const file = path.join(home, 'rig', 'fixhome', 'cfg', 'projects', rel.replace(/^cfg\//, ''));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
  }
  // the lane, primed before the first event (the lane was ready before the delegated work began)
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: path.join(home, 'rig') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), monotonicMs: () => Date.now(), cfg, io: localIO, coord,
    fleetState: { connected: true, downSince: null, ccdVerbs: ['caps', DELEGATION_EVENTS_CAP] }, runCcd: async () => { throw new Error('no ccd in the corpus replay'); } };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  try {
    const session = { id: OWNER, project: PROJECT, status: 'idle' as const, stoppedBy: null, archivedAt: null };
    const census = (records: DelegationCensusRecord[], at: number): void => {
      const pass: DelegationCensusPass = { measuredAt: at, projects: new Map([[PROJECT, { read: { ok: true, records: [] }, delegation: records }]]),
        incarnations: new Map([[OWNER, { kind: 'measured', incarnation: INC }]]) };
      (watcher as unknown as { delegationCensus: DelegationCensusPass | null }).delegationCensus = pass;
    };
    const sweep = async (at: number, records: DelegationCensusRecord[]): Promise<void> => {
      vi.spyOn(Date, 'now').mockReturnValue(at);
      census(records, at);
      await watcher.sweepDelegation([session] as never, [{ id: OWNER, project: PROJECT, child: { kind: 'none' } }] as never);
    };
    // the ready instant is followed by the clock-skew allowance, inside which a call's start is held as unseen: prime well before it
    const primed = Date.now() - 5 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(primed);
    census([], primed);
    await watcher.sweepDelegation([], []);                            // ready over no session and an empty census (the watch rig's prime)
    vi.restoreAllMocks();
    // the real hook, once per captured event, in order. The repository's admin directory is what the hook lists for a Bash call: it
    // is empty before the first delegating call and holds the capture's admin records from that call's start on.
    const admin = path.join(home, 'rig', PROJECT, '.git', 'worktrees');
    mkdirSync(admin, { recursive: true });
    let born = false;
    for (const e of capture.events) {
      const r = spawnSyncGroup('bash', [HOOK], { input: JSON.stringify(e.payload), encoding: 'utf8', timeout: 60_000, env: {
        ...process.env, OSTYPE: '', HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`, TMUX_PANE: '%1',
        CLAUDE_CODE_SESSION_ID: e.envSid, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: INC, CLAUDE_CODE_EXECPATH: '' } });
      expect(r.status, `${version}/${scenario} seq ${e.seq}: the hook exits 0`).toBe(0);
      if (!born && e.event === 'PreToolUse' && ['Bash', 'Agent', 'Task', 'Workflow'].includes(String(e.payload['tool_name']))) {
        born = true;
        for (const name of Object.keys(capture.disk.admin)) mkdirSync(path.join(admin, name), { recursive: true });
      }
    }
    // the census the capture left: every admin record, present, at its recorded path
    const records: DelegationCensusRecord[] = Object.entries(capture.disk.admin).map(([adminRecord, a]) => ({
      project: PROJECT, adminRecord, canonicalPath: a.gitdir.replace(/\/\.git$/, ''),
      headBranch: a.head.startsWith('ref: refs/heads/') ? a.head.slice('ref: refs/heads/'.length) : null, headSha: null,
      claudeBase: a.claudeBase, locked: a.locked, baseAgreesFirstLog: a.claudeBase === null ? null : a.claudeBase === a.firstLogSha,
      state: 'present', diagnostic: null,
    } as DelegationCensusRecord));
    const t1 = Date.now() + 1000;
    for (let n = 0; n < 6; n += 1) await sweep(t1 + n * DELEGATION_SWEEP_MS, records);   // the birth wait, the link and the lease
    const file = path.join(home, '.ccrc', DELEGATION_CHECKPOINT_FILE);
    expect(existsSync(file), `${version}/${scenario}: the lane wrote a checkpoint`).toBe(true);
    return { checkpoint: decodeDelegationCheckpoint(new Uint8Array(readFileSync(file))) as DelegationCheckpointV1, census: records, capture };
  } finally {
    await watcher.closeDelegation().catch(() => undefined);
    vi.restoreAllMocks();
  }
}

/** The decider over the replay's leases, each laid at generation 1 with its carrier read back (the carrier machinery is PR6's, not this
 *  row's subject), a live parent at its incarnation, a settled watch, and the scenario's audit answer. */
function decide(scenario: string, cp: DelegationCheckpointV1, census: readonly DelegationCensusRecord[]): readonly AdoptionDecision[] {
  const leases = cp.leases.map((l) => ({ ...l, generation: 1, carrierGenerationSeen: 1 }));
  const at = Math.max(Date.now(), ...cp.activities.flatMap((a) => (a.endedAt === null ? [] : [Date.parse(a.endedAt)]))) + DELEGATION_ADOPT_SETTLE_MS + 60_000;
  return decideAdoption({
    now: formatDelegationInstant(at), checkpoint: { ...cp, leases },
    carriers: new Map(leases.map((l) => [l.leaseId, { kind: 'carrier', body: { generation: 1, state: 'ephemeral' } } as never])),
    treePresent: new Set(census.map((r) => delegationTreeKey(r.project, r.adminRecord))), censused: new Set([PROJECT]),
    audits: new Map(leases.map((l) => [l.leaseId, { ok: true, changed: AUDIT[scenario]! } as never])),
    watch: new Map(leases.map((l) => [l.leaseId, { generation: 1, terminalAt: formatDelegationInstant(at - DELEGATION_ADOPT_SETTLE_MS - 60_000), passes: 2 }])),
    parents: new Map([[OWNER, { registry: 'present', incarnation: INC, deadSince: null, ccd: true, alive: true, deathRetracted: false }]]), conflicting: new Set(),
    boxHolds: true, breaker: 'clear', marker: 'present',
  }).decisions;
}

/** Whether the capture holds the Workflow run's terminal task notification (a `<status>` other than running). */
const workflowNotified = (c: Capture): boolean => c.events.some((e) => e.event === 'UserPromptSubmit'
  && /^<task-notification>[\s\S]*<task-id>w[\s\S]*<status>(completed|failed|killed|stopped)<\/status>/.test(String(e.payload['prompt'] ?? '')));

/** The versions whose `wf-iso` adopted: the corpus-wide control below holds that the workflow arm is not vacuous. */
const workflowAdopted: string[] = [];

describe('W5-D12: adoption is fixture-proven for agent and workflow trees, on every lane version in the corpus', () => {
  it('the adoptable sources are exactly agent and workflow, and the corpus covers the scenarios this row replays', () => {
    expect([...DELEGATION_ADOPTABLE_SOURCES]).toEqual(['agent', 'workflow']);
    expect(VERSIONS.length).toBeGreaterThanOrEqual(14);
    for (const v of VERSIONS) for (const s of SCENARIOS) expect(measured(v, s), `${v}/${s} is measured`).toBe(true);
  });

  it.each(VERSIONS)('%s: changed and dirty agent trees adopt once, an unchanged one never; a raw tree never; a workflow tree only once its run notified; a paused workflow never', async (version) => {
    const adopts = async (scenario: string): Promise<{ n: number; capture: Capture; sources: string[] }> => {
      const { checkpoint, census, capture } = await replay(version, scenario);
      return { n: decide(scenario, checkpoint, census).filter((d) => d.kind === 'adopt').length, capture, sources: checkpoint.leases.map((l) => l.sourceKind) };
    };
    for (const s of ['agent-iso-changed', 'agent-iso-dirty']) {
      const r = await adopts(s);
      expect(r.sources, `${version}/${s}: the replay leased the agent's tree`).toEqual(['agent']);
      expect(r.n, `${version}/${s}`).toBe(1);
    }
    // Claude Code removes an unchanged isolated tree itself, so the capture leaves no admin record and the replay no lease; were one
    // left, the audit's `changed: false` keeps it ephemeral. Either way it never adopts.
    const unchanged = await adopts('agent-iso-unchanged');
    expect(unchanged.sources.every((s) => s === 'agent'), `${version}/agent-iso-unchanged: no lease but an agent's`).toBe(true);
    expect(unchanged.n).toBe(0);
    const raw = await adopts('raw-worktree');
    expect(raw.sources, `${version}/raw-worktree: leased as raw`).toEqual(['raw']);
    expect(raw.n).toBe(0);
    const wf = await adopts('wf-iso');
    expect(wf.sources.every((s) => s === 'workflow') && wf.sources.length > 0, `${version}/wf-iso: leased as workflow`).toBe(true);
    expect(wf.n > 0, `${version}/wf-iso: adopts iff the run's terminal notification is in the replay`).toBe(workflowNotified(wf.capture));
    if (wf.n > 0) workflowAdopted.push(version);
    expect((await adopts('wf-limit-pause')).n, `${version}/wf-limit-pause: a paused workflow never adopts`).toBe(0);
  }, CELL_MS);

  it('CONTROL: the workflow arm adopted on at least one lane version (it runs after the versions above)', () => {
    expect(workflowAdopted.length, 'no wf-iso replay adopted').toBeGreaterThan(0);
  });
});
