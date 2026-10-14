// The fleet-side delegation spool writer (delegation broker wave 3, Task 5; spec 2026-10-04 §5.3).
//
// `ccd/session-hook.sh` appends ONE bounded, owner-scoped evidence line per delegation event to
// `$REG/delegation/spool/<ccd-id>/<YYYYMMDDHH>.spool`; ccd creates that directory when it spawns the session and
// advertises `delegation-events-v1`. The hook never makes the directory (a missing one means skip), exits 0 on every
// path, forks nothing the event did not already fork, and writes nothing it cannot bound. Later tasks ingest these
// files on the server, so the grammar below is exactly `DelegationSpoolLineV1` in `shared/api.ts`: each variant accepts
// only its named keys, and `validate` is that union written out as a runtime check (the compile-time half is the
// exhaustive `KINDS` record).
//
// Mutations this file owns (plan §Mutation Matrix):
//   W3-M03  let the hook create its spool directory            -> 'a missing directory is skipped' rows
//   W3-M04  permit a serialized line of 4096 bytes or more      -> 'the strict line cap' rows
//   W3-M06  widen the hook's prune outside its owner directory  -> 'prune is contained' rows
//   W3-M60  omit the parent incarnation, or accept it after the owner's generation was reused -> 'incarnation binding'
// Amendment slugs carried by row titles: real-payloads-carry-scratchpad-dir, toolsearch-may-precede-a-workflow-call,
// parent-stop-does-not-bound-workflow-start, workflow-phase-is-not-always-written, agent-input-keys-are-the-callers.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { makeCcdHarness, WIDE_PANE_IF_UP, type CcdHarness } from './ccdWsHelpers.js';
import { DELEGATION_SPOOL_BOUNDS, type DelegationEventKind } from '../../shared/api.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const FIXTURES = path.resolve(__dirname, 'fixtures/delegation');
const OWNER = 'demo-quiet-basin';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const OTHER_GENERATION = '7f3c9a10-5555-4aaa-8bbb-0123456789cd';
const CLAUDE_SID = '6350faa0-a1be-4e78-939c-57485268f6fc';
const TRANSCRIPT = `/rig/fixhome/cfg/projects/-rig-repo/${CLAUDE_SID}.jsonl`;
const B = DELEGATION_SPOOL_BOUNDS;
const REAL_JQ = execFileSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).trim();

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The line grammar, written out. `DelegationSpoolLineV1` is a compile-time type; this is its runtime twin, closed.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const KINDS: Record<DelegationEventKind, true> = {
  SessionStart: true, PreToolUse: true, PostToolUse: true, SubagentStart: true, SubagentStop: true,
  UserPromptSubmit: true, SessionEnd: true,
};
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NAME_RE = /^[A-Za-z0-9._@+-]{1,64}$/;
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const COMMON = ['v', 'eventKind', 'observedAt', 'sessionId', 'parentIncarnation', 'claudeSessionId',
  'claudeVersion', 'cwd', 'transcriptPath', 'agentId', 'agentType', 'truncated'];

type Shape = { required: string[]; optional: string[] };
const shapeOf = (l: Record<string, unknown>): Shape | null => {
  switch (l['eventKind']) {
    case 'SessionStart': return { required: ['source'], optional: [] };
    case 'PreToolUse': return l['toolName'] === 'Bash'
      ? { required: ['toolName', 'toolUseId'], optional: ['listing'] }
      : { required: ['toolName', 'toolUseId', 'isolation'], optional: [] };
    case 'PostToolUse': return l['toolName'] === 'Bash'
      ? { required: ['toolName', 'toolUseId', 'outcome'], optional: ['listing'] }
      : { required: ['toolName', 'toolUseId', 'outcome', 'launch'], optional: [] };
    case 'SubagentStart': return { required: ['agentId', 'agentType'], optional: [] };
    case 'SubagentStop': return { required: ['agentId', 'agentType', 'agentTranscriptPath'], optional: [] };
    case 'UserPromptSubmit': return { required: ['notification'], optional: [] };
    case 'SessionEnd': return { required: ['reason'], optional: [] };
    default: return null;
  }
};
const strOk = (v: unknown, max: number): boolean => typeof v === 'string' && bytes(v) <= max;

/** Every way `line` is not a `DelegationSpoolLineV1` of this owner and generation. Empty means well-formed. */
const validate = (line: unknown, owner = OWNER, generation = expectGen): string[] => {
  const bad: string[] = [];
  if (typeof line !== 'object' || line === null || Array.isArray(line)) return ['not an object'];
  const l = line as Record<string, unknown>;
  const shape = shapeOf(l);
  if (!shape) return [`unknown eventKind ${JSON.stringify(l['eventKind'])}`];
  if (!(String(l['eventKind']) in KINDS)) bad.push('eventKind outside the closed set');
  const allowed = new Set([...COMMON, ...shape.required, ...shape.optional]);
  for (const k of Object.keys(l)) if (!allowed.has(k)) bad.push(`unknown key ${k}`);
  for (const k of shape.required) if (!(k in l)) bad.push(`missing required ${k}`);
  if (l['v'] !== 1) bad.push('v');
  if (typeof l['observedAt'] !== 'string' || !TS_RE.test(l['observedAt'])) bad.push('observedAt not canonical millisecond UTC');
  if (l['sessionId'] !== owner) bad.push('sessionId is not the owner');
  if (l['parentIncarnation'] !== generation || !UUID_RE.test(String(l['parentIncarnation']))) bad.push('parentIncarnation');
  if (typeof l['claudeSessionId'] !== 'string' || !ID_RE.test(l['claudeSessionId'])) bad.push('claudeSessionId');
  for (const k of ['claudeVersion']) if (k in l && !strOk(l[k], B.labelBytes)) bad.push(k);
  for (const k of ['cwd', 'transcriptPath']) if (k in l && !strOk(l[k], B.pathBytes)) bad.push(k);
  if ('agentId' in l && !(typeof l['agentId'] === 'string' && ID_RE.test(l['agentId']))) bad.push('agentId');
  if ('agentType' in l && l['agentType'] !== null && !strOk(l['agentType'], B.labelBytes)) bad.push('agentType');
  if ('truncated' in l && l['truncated'] !== true) bad.push('truncated must be true or absent');
  if ('toolUseId' in l && !(typeof l['toolUseId'] === 'string' && ID_RE.test(l['toolUseId']))) bad.push('toolUseId');
  if ('listing' in l) {
    const ls = l['listing'];
    if (!Array.isArray(ls) || ls.length > B.listingNames || ls.some((n) => typeof n !== 'string' || !NAME_RE.test(n))) bad.push('listing');
  }
  switch (l['eventKind']) {
    case 'SessionStart': if (!strOk(l['source'], B.labelBytes) || l['source'] === '') bad.push('source'); break;
    case 'SessionEnd': if (!strOk(l['reason'], B.labelBytes) || l['reason'] === '') bad.push('reason'); break;
    case 'PreToolUse':
      if (!['Agent', 'Task', 'Workflow', 'Bash'].includes(String(l['toolName']))) bad.push('toolName');
      if (l['toolName'] !== 'Bash' && l['isolation'] !== null && !strOk(l['isolation'], B.labelBytes)) bad.push('isolation');
      break;
    case 'PostToolUse': {
      if (!['Agent', 'Task', 'Workflow', 'Bash'].includes(String(l['toolName']))) bad.push('toolName');
      const outcomes = l['toolName'] === 'Bash' ? ['completed', 'failed', 'unknown'] : ['completed', 'failed', 'async-launched', 'unknown'];
      if (!outcomes.includes(String(l['outcome']))) bad.push('outcome');
      if (l['toolName'] === 'Agent' || l['toolName'] === 'Task') {
        const x = l['launch'] as Record<string, unknown> | null;
        if (x !== null) {
          if (typeof x !== 'object' || Object.keys(x).sort().join() !== 'agentId,isAsync,status') bad.push('agent launch keys');
          else if (!['async-launched', 'completed'].includes(String(x['status'])) || !ID_RE.test(String(x['agentId'])) || typeof x['isAsync'] !== 'boolean') bad.push('agent launch');
        }
      } else if (l['toolName'] === 'Workflow') {
        const x = l['launch'] as Record<string, unknown> | null;
        if (x !== null) {
          if (typeof x !== 'object' || Object.keys(x).sort().join() !== 'runId,scriptPath,status,taskId,taskType,transcriptDir,workflowName') bad.push('workflow launch keys');
          else if (!['async-launched', 'completed'].includes(String(x['status'])) || !ID_RE.test(String(x['taskId'])) || !ID_RE.test(String(x['runId']))
            || !strOk(x['taskType'], B.labelBytes) || !strOk(x['workflowName'], B.labelBytes)
            || !strOk(x['transcriptDir'], B.pathBytes) || !strOk(x['scriptPath'], B.pathBytes)) bad.push('workflow launch');
        }
      }
      break;
    }
    case 'SubagentStart': if (typeof l['agentId'] !== 'string') bad.push('agentId required'); break;
    case 'SubagentStop':
      if (typeof l['agentId'] !== 'string') bad.push('agentId required');
      if (l['agentTranscriptPath'] !== null && !strOk(l['agentTranscriptPath'], B.pathBytes)) bad.push('agentTranscriptPath');
      break;
    case 'UserPromptSubmit': {
      const n = l['notification'] as Record<string, unknown>;
      if (typeof n !== 'object' || n === null || Object.keys(n).sort().join() !== 'status,taskId,toolUseId') bad.push('notification keys');
      else if (!ID_RE.test(String(n['taskId'])) || !ID_RE.test(String(n['toolUseId'])) || !['completed', 'failed', 'cancelled', 'unknown'].includes(String(n['status']))) bad.push('notification');
      break;
    }
    default: break;
  }
  return bad;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// A fixture HOME with a stub tmux and the row's generation: the hook runs for real, the way session-hook.test.ts does.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
let home: string;
const reg = (): string => path.join(home, '.cc-sessions');
const spoolBase = (): string => path.join(reg(), 'delegation');
const ownerDir = (id = OWNER): string => path.join(spoolBase(), 'spool', id);
const genFile = (): string => path.join(reg(), `${OWNER}.generation`);
const plantOwnerDir = (id = OWNER): void => { fs.mkdirSync(ownerDir(id), { recursive: true, mode: 0o700 }); };

/** The generation the lines are expected to carry: a test that moves the row to a new incarnation moves this too. */
let expectGen = GENERATION;
/** `CLAUDE_CODE_EXECPATH` is blanked: the runner's own would put a `claudeVersion` in every line. */
const hookEnv = (env: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
  CLAUDE_CODE_EXECPATH: '', ...env,
});
type Ran = { stdout: string; stderr: string };
/** One hook run. Exit 0 is asserted here, once, for every caller: the hook's contract is exit 0 on every path. */
const run = (payload: object | string, env: Record<string, string> = {}): Ran => {
  const r = spawnSync('bash', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env), timeout: 120_000,
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return { stdout: r.stdout, stderr: r.stderr };
};

const bucketFiles = (dir = ownerDir()): string[] =>
  (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^\d{10}\.spool$/.test(f)).sort();
/** Every complete line of every bucket, in bucket order. A bucket must end in LF, and no line may be empty. */
const rawLines = (dir = ownerDir()): string[] => bucketFiles(dir).flatMap((f) => {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  expect(t === '' || t.endsWith('\n'), `${f} ends in LF`).toBe(true);
  const ls = t.split('\n').slice(0, -1);
  for (const l of ls) expect(l, `${f}: no empty line`).not.toBe('');
  return ls;
});
const lines = (dir = ownerDir()): any[] => rawLines(dir).map((l) => JSON.parse(l));
const allText = (dir = ownerDir()): string => bucketFiles(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');

/** The lines this payload appended: none or one, each valid, and the strict cap held for each. */
const emitted = (payload: object | string, env: Record<string, string> = {}): any[] => {
  const before = rawLines().length;
  run(payload, env);
  const added = rawLines().slice(before);
  for (const raw of added) {
    expect(bytes(raw) + 1, `a line plus its LF is under ${B.lineBytesBelow} bytes`).toBeLessThan(B.lineBytesBelow);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'utf8')), 'strict UTF-8').not.toThrow();
    expect(validate(JSON.parse(raw)), raw.slice(0, 300)).toEqual([]);
  }
  return added.map((l) => JSON.parse(l));
};
const one = (payload: object | string, env: Record<string, string> = {}): any => {
  const got = emitted(payload, env);
  expect(got, 'exactly one line').toHaveLength(1);
  return got[0];
};
const none = (payload: object | string, env: Record<string, string> = {}): void => {
  expect(emitted(payload, env), 'no line').toEqual([]);
};

// ── payload builders (the keys the captured lanes send) ──
const ev = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ session_id: CLAUDE_SID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', hook_event_name: name, ...extra });
const pre = (tool: string, input: Record<string, unknown>, id = 'toolu_01AAAA', extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ev('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, ...extra });
const post = (tool: string, input: Record<string, unknown>, resp: unknown, id = 'toolu_01AAAA', extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ev('PostToolUse', { tool_name: tool, tool_input: input, tool_response: resp, tool_use_id: id, ...extra });

type Captured = { seq: number; event: string; envSid: string; payload: Record<string, any> };
const load = (version: string, scenario: string): Captured[] =>
  (JSON.parse(fs.readFileSync(path.join(FIXTURES, version, `${scenario}.json`), 'utf8')) as { events: Captured[] }).events;
const find = (version: string, scenario: string, pred: (e: Captured) => boolean): Captured => {
  const e = load(version, scenario).find(pred);
  if (!e) throw new Error(`no matching event in ${version}/${scenario}`);
  return e;
};

const setup = (): void => {
  expectGen = GENERATION;
  home = mkTmp('ccrc-dlgspool-');
  fs.mkdirSync(reg(), { recursive: true });
  // EXACTLY 36 BYTES, NO TERMINAL LF: the contract ccd's writer keeps.
  fs.writeFileSync(genFile(), GENERATION);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${OWNER}"\n`, { mode: 0o755 });
};
const teardown = (): void => { fs.rmSync(home, { recursive: true, force: true }); };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Step 1: ccd creates the owner's directory when it spawns, and says so.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('ccd makes the owner\'s spool directory at spawn and advertises delegation-events-v1', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-dlgspool-ccd-'); });
  afterEach(() => { h.cleanup(); });
  const ID = 'demo-quiet-mesa';
  const base = (): string => path.join(h.home, '.cc-sessions', 'delegation');
  const leaf = (id = ID): string => path.join(base(), 'spool', id);
  const mode = (p: string): number => fs.statSync(p).mode & 0o777;
  /** `ccd-child-tmpdir.test.ts`'s substrate: a tmux that RECORDS, and a pane that comes up. */
  const TMUX = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      ${WIDE_PANE_IF_UP}
      case "$1" in
        new-session)  : > "$HOME/pane-up" ;;
        kill-session) rm -f "$HOME/pane-up" ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
      esac
    };`;
  const seed = (id = ID): void => {
    h.sh(`_reg_set ${id} wrapper claude
          _reg_set ${id} workdir '${h.home}'
          _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  };
  const spawn1 = (id = ID): string => h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${id} new 2>&1; echo "[rc=$?]"`);

  it('a spawn makes $REG/delegation/spool/<id> at mode 0700, and its parents private too', () => {
    seed();
    expect(spawn1()).toContain('[rc=0]');
    expect(fs.statSync(leaf()).isDirectory()).toBe(true);
    expect(mode(leaf()), 'the owner directory').toBe(0o700);
    expect(mode(path.join(base(), 'spool'))).toBe(0o700);
    expect(mode(base())).toBe(0o700);
  });

  it('a respawn keeps what the directory holds, and re-privatises a mode that was loosened', () => {
    seed();
    spawn1();
    fs.writeFileSync(path.join(leaf(), '2026101400.spool'), '{"kept":1}\n');
    fs.chmodSync(leaf(), 0o755);
    expect(spawn1()).toContain('[rc=0]');
    expect(fs.readFileSync(path.join(leaf(), '2026101400.spool'), 'utf8')).toBe('{"kept":1}\n');
    expect(mode(leaf()), 'private again').toBe(0o700);
  });

  it('every spawned session gets its own directory, and no session\'s spawn touches another\'s', () => {
    seed(ID); seed('demo-quiet-bay');
    spawn1(ID);
    fs.writeFileSync(path.join(leaf(), '2026101400.spool'), 'a\n');
    spawn1('demo-quiet-bay');
    expect(fs.readdirSync(path.join(base(), 'spool')).sort()).toEqual(['demo-quiet-bay', ID].sort());
    expect(fs.readFileSync(path.join(leaf(), '2026101400.spool'), 'utf8')).toBe('a\n');
  });

  it('a path that cannot be made a private directory warns and the spawn STILL happens (never refused)', () => {
    seed();
    fs.mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
    fs.writeFileSync(base(), 'x');   // a regular file where the directory belongs
    const out = spawn1();
    expect(out).toContain('[rc=0]');
    expect(out).toMatch(/delegation spool/);
    expect(h.calls().filter((c) => c.startsWith('tmux new-session')), 'the session was spawned').toHaveLength(1);
  });

  it('a symlinked spool root is never followed: nothing is made through it, and the spawn proceeds', () => {
    seed();
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(base(), { recursive: true });
    fs.symlinkSync(outside, path.join(base(), 'spool'));
    const out = spawn1();
    expect(out).toContain('[rc=0]');
    expect(fs.readdirSync(outside), 'the link target was not written through').toEqual([]);
    expect(out).toMatch(/delegation spool/);
  });

  it('an id that is not a plain registry id (dot-leading, slash-bearing) makes nothing', () => {
    for (const bad of ['..', '.x', 'a/b', '']) {
      const out = h.sh(`_delegation_spool_dir '${bad}'; echo "[rc=$?]"`);
      expect(out, JSON.stringify(bad)).toContain('[rc=1]');
    }
    expect(fs.existsSync(base()), 'not even the parents').toBe(false);
  });

  it('ccd caps advertises delegation-events-v1, once', () => {
    const caps = h.sh('cmd_caps').split('\n');
    expect(caps.filter((c) => c === 'delegation-events-v1')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The bounds are spelled once in shared/api.ts and again where a hook that cannot import it needs them: equal, or red.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the hook\'s literal bounds equal DELEGATION_SPOOL_BOUNDS', () => {
  const src = fs.readFileSync(HOOK, 'utf8');
  const lit = (re: RegExp): number => {
    const m = src.match(re);
    if (!m) throw new Error(`the hook carries no ${re}`);
    expect(src.match(new RegExp(re.source, 'g'))!.length, `${re} is spelled exactly once`).toBe(1);
    return Number(m[1]);
  };
  it('the jq program\'s defs (idmax is the payload parse\'s own, shared by every id)', () => {
    expect(lit(/def maxline: (\d+);/)).toBe(B.lineBytesBelow);
    expect(lit(/def idmax: (\d+);/)).toBe(B.idBytes);
    expect(lit(/def maxlabel: (\d+);/)).toBe(B.labelBytes);
    expect(lit(/def maxpath: (\d+);/)).toBe(B.pathBytes);
  });
  it('the shell block\'s constants', () => {
    expect(lit(/CCRC_ID_MAX=(\d+)/), 'the owner bound is the hook\'s own id bound, not a second literal').toBe(B.ownerIdBytes);
    expect(src, 'and the spool gate reads it by name').toMatch(/\$\{#id\} -le CCRC_ID_MAX &&/);
    expect(src).not.toContain('DSP_OWNER_BYTES');
    expect(lit(/DSP_LINE_BELOW=(\d+)/)).toBe(B.lineBytesBelow);
    expect(lit(/DSP_LIST_NAMES=(\d+)/)).toBe(B.listingNames);
    expect(lit(/DSP_NAME_BYTES=(\d+)/)).toBe(B.listingNameBytes);
  });
  it('the prefilter that decides whether the spool\'s jq text is compiled names exactly the delegation tools and events (a necessary condition: no delegation payload can lack its own name)', async () => {
    const { DELEGATION_EVENT_KINDS } = await import('../../shared/api.js');
    const m = src.match(/case "\$payload" in ((?:\*'"[A-Za-z<>-]+"?'\*\|?)+)\)/);
    expect(m, 'the hook carries the prefilter').not.toBeNull();
    // Each alternative is `*'"Word"'*` (a quoted JSON string value), except the notification, whose value only STARTS with the tag.
    const words = m![1]!.split('|').map((w) => w.replace(/^\*'"/, '').replace(/"?'\*$/, '')).map((w) => (w === '<task-notification>' ? 'task-notification' : w)).sort();
    // A tool event is named by its tool (Pre/PostToolUse carry no other delegation word), a notification by its tag, the rest by
    // their own event name. The vocabulary decides the set, so a new kind in it reds this until the prefilter learns it.
    const viaTool = new Set(['PreToolUse', 'PostToolUse']);
    const want = [...DELEGATION_EVENT_KINDS.filter((k) => !viaTool.has(k) && k !== 'UserPromptSubmit'), 'Agent', 'Task', 'Workflow', 'Bash', 'task-notification'].sort();
    expect(words).toEqual(want);
  });
  it('every bound is a positive integer, and the cap is the plan\'s 4096', () => {
    for (const [k, v] of Object.entries(B)) expect(Number.isInteger(v) && v > 0, k).toBe(true);
    expect(B.lineBytesBelow).toBe(4096);
  });
  it('with every bound at its maximum, the REQUIRED fields of the largest variants still fit one line (so a line that cannot fit is a bug, not a case)', () => {
    const id = 'x'.repeat(B.idBytes);
    const worst = {
      v: 1, eventKind: 'PostToolUse', observedAt: '2026-10-14T00:00:00.000Z', sessionId: 'o'.repeat(B.ownerIdBytes),
      parentIncarnation: GENERATION, claudeSessionId: id, toolName: 'Workflow', toolUseId: id, outcome: 'async-launched',
      launch: { status: 'async-launched', taskId: id, taskType: 'l'.repeat(B.labelBytes), workflowName: 'w'.repeat(B.labelBytes), runId: id,
        transcriptDir: '/'.padEnd(B.pathBytes, 'd'), scriptPath: '/'.padEnd(B.pathBytes, 's') },
    };
    const total = bytes(JSON.stringify(worst)) + 1;
    expect(total).toBeLessThan(B.lineBytesBelow);
    expect(total, 'and by a wide margin: the claim in the bounds comment (3.2 KiB) holds').toBeLessThan(3277);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The hook, with a fixture HOME.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the delegation spool: the hook appends evidence to a directory ccd made', () => {
  beforeEach(() => { setup(); plantOwnerDir(); });
  afterEach(teardown);

  // ── Step 1 (hook half): the hook never makes the directory ──
  describe('a missing directory is skipped, and the hook never makes one (W3-M03)', () => {
    /** A `mkdir` on PATH that records its argv and runs the real one: the hook must not fork it for the spool. */
    const mkdirShim = (): (() => string[]) => {
      const real = execFileSync('sh', ['-c', 'command -v mkdir'], { encoding: 'utf8' }).trim();
      const log = path.join(home, 'mkdir-argv');
      fs.writeFileSync(path.join(home, 'bin', 'mkdir'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
      return () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    };
    const EVENTS: Array<[string, object]> = [
      ['PostToolUse Bash', post('Bash', { command: 'true' }, { stdout: '', stderr: '', interrupted: false })],
      ['PreToolUse Agent', pre('Agent', { prompt: 'x' })],
      ['SubagentStart', ev('SubagentStart', { agent_id: 'a1', agent_type: 'general-purpose' })],
      ['SessionEnd', ev('SessionEnd', { reason: 'clear' })],
      ['UserPromptSubmit', ev('UserPromptSubmit', { prompt: 'hello' })],
    ];

    it.each(EVENTS)('%s with NO spool directory: no directory appears, no mkdir is forked, nothing is printed', (_n, payload) => {
      fs.rmSync(path.join(spoolBase()), { recursive: true, force: true });
      const mkdirs = mkdirShim();
      expect(run(payload)).toEqual({ stdout: '', stderr: '' });
      expect(fs.existsSync(spoolBase()), 'no delegation/ was made').toBe(false);
      expect(mkdirs(), 'the hook forked no mkdir').toEqual([]);
    });

    it('the spool root exists but the OWNER\'s directory does not: still nothing is made', () => {
      fs.rmSync(ownerDir(), { recursive: true });
      expect(fs.existsSync(path.join(spoolBase(), 'spool'))).toBe(true);
      const mkdirs = mkdirShim();
      run(post('Bash', { command: 'true' }, { stdout: '' }));
      expect(fs.existsSync(ownerDir())).toBe(false);
      expect(mkdirs()).toEqual([]);
    });

    it('control: with the directory present the same event writes its line', () => {
      expect(one(post('Bash', { command: 'true' }, { stdout: '' })).eventKind).toBe('PostToolUse');
    });

    it('a directory that is a SYMLINK (the owner\'s, or any parent) is not written through', () => {
      one(post('Bash', { command: 'true' }, { stdout: '' }, 'toolu_ctl'));   // control: the plain directory takes a line
      const outside = path.join(home, 'outside');
      fs.mkdirSync(outside);
      fs.rmSync(ownerDir(), { recursive: true });
      fs.symlinkSync(outside, ownerDir());
      run(post('Bash', { command: 'true' }, { stdout: '' }));
      expect(fs.readdirSync(outside), 'nothing written through the owner link').toEqual([]);
      fs.rmSync(ownerDir());
      fs.rmSync(path.join(spoolBase(), 'spool'), { recursive: true });
      fs.mkdirSync(path.join(outside, OWNER), { recursive: true });
      fs.symlinkSync(outside, path.join(spoolBase(), 'spool'));
      run(post('Bash', { command: 'true' }, { stdout: '' }));
      expect(fs.readdirSync(path.join(outside, OWNER)), 'nor through the spool link').toEqual([]);
    });

    it('an id that would name the spool root itself (dot-leading) writes nothing and traverses nothing', () => {
      one(post('Bash', { command: 'true' }, { stdout: '' }, 'toolu_ctl'));   // control: an ordinary id takes a line
      for (const evil of ['..', '.hidden']) {
        fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${evil}"\n`, { mode: 0o755 });
        fs.mkdirSync(path.join(spoolBase(), 'spool', evil), { recursive: true });
        fs.writeFileSync(path.join(reg(), `${evil}.generation`), GENERATION);
        run(post('Bash', { command: 'true' }, { stdout: '' }));
        expect(fs.readdirSync(path.join(spoolBase(), 'spool')).filter((f) => f.endsWith('.spool')), `${evil}: no bucket in the spool root`).toEqual([]);
        expect(fs.readdirSync(spoolBase()).filter((f) => f.endsWith('.spool')), `${evil}: nor beside it`).toEqual([]);
        expect(rawLines(path.join(spoolBase(), 'spool', evil)), `${evil}`).toEqual([]);
      }
    });
  });

  // ── Step 2: the closed events ──
  describe('SessionStart.source, before the compact early exit', () => {
    it.each([['startup'], ['resume'], ['clear'], ['compact']])('source %s: one SessionStart line carrying it', (source) => {
      const l = one(ev('SessionStart', { source, model: 'claude-opus-5-5' }));
      expect(l).toMatchObject({ v: 1, eventKind: 'SessionStart', source, sessionId: OWNER, parentIncarnation: GENERATION, claudeSessionId: CLAUDE_SID });
      expect(Object.keys(l).sort()).toEqual(['claudeSessionId', 'cwd', 'eventKind', 'observedAt', 'parentIncarnation', 'sessionId', 'source', 'transcriptPath', 'v'].sort());
    });

    it('compact: the record is made AND the early exit still exits before the hookstate and the turn marker', () => {
      const l = one(ev('SessionStart', { source: 'compact' }));
      expect(l.source).toBe('compact');
      expect(fs.existsSync(path.join(reg(), `${OWNER}.hookstate.json`)), 'compact stamps no hookstate (D-306)').toBe(false);
      expect(fs.existsSync(path.join(reg(), `${OWNER}.turn.json`)), 'and no turn marker').toBe(false);
    });

    it('control: a startup writes the hookstate as it always did, beside its line', () => {
      one(ev('SessionStart', { source: 'startup' }));
      expect(JSON.parse(fs.readFileSync(path.join(reg(), `${OWNER}.hookstate.json`), 'utf8')).state).toBe('done');
    });

    it('a SessionStart with no source, an empty one, or one that is not a string records nothing', () => {
      none(ev('SessionStart', {}));
      none(ev('SessionStart', { source: '' }));
      none(ev('SessionStart', { source: 7 }));
      none(ev('SessionStart', { source: 'x'.repeat(B.labelBytes + 1) }));
    });

    it('a source at the label bound is kept; one byte more is not', () => {
      expect(one(ev('SessionStart', { source: 's'.repeat(B.labelBytes) })).source).toHaveLength(B.labelBytes);
    });
  });

  describe('PreToolUse: Agent, Task, Workflow and Bash are intent; nothing else is', () => {
    it.each([['Agent'], ['Task'], ['Workflow']])('%s: tool, tool_use_id and isolation (null when the caller sent none)', (tool) => {
      const l = one(pre(tool, { prompt: 'do it' }, 'toolu_01XYZ'));
      expect(l).toMatchObject({ eventKind: 'PreToolUse', toolName: tool, toolUseId: 'toolu_01XYZ', isolation: null });
      expect('listing' in l).toBe(false);
    });

    it('Agent with isolation:"worktree" records it; a non-string or over-bound isolation is null (the latter marks the line truncated)', () => {
      expect(one(pre('Agent', { isolation: 'worktree' })).isolation).toBe('worktree');
      expect(one(pre('Agent', { isolation: true })).isolation).toBeNull();
      const l = one(pre('Agent', { isolation: 'i'.repeat(B.labelBytes + 1) }));
      expect(l.isolation).toBeNull();
      expect(l.truncated).toBe(true);
    });

    it('Bash: tool and tool_use_id only, and the command text is never kept', () => {
      const l = one(pre('Bash', { command: 'echo SECRET-COMMAND-TEXT', description: 'SECRET-DESCRIPTION' }));
      expect(l).toMatchObject({ eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 'toolu_01AAAA' });
      expect('isolation' in l).toBe(false);
      expect(allText()).not.toMatch(/SECRET/);
    });

    it('toolsearch-may-precede-a-workflow-call: ToolSearch writes no line, before or after, and the Workflow lines that follow it do', () => {
      none(pre('ToolSearch', { query: 'select:Workflow' }, 'toolu_01TS'));
      none(post('ToolSearch', { query: 'select:Workflow' }, { matches: ['Workflow'] }, 'toolu_01TS'));
      const got = [
        ...emitted(pre('Workflow', { script: 'export const meta = {}' }, 'toolu_01WF')),
        ...emitted(post('Workflow', { script: 'x' }, { status: 'async_launched', taskId: 'wabc', taskType: 'local_workflow', workflowName: 'wf', runId: 'wf_1-aa',
          transcriptDir: '/t/d', scriptPath: '/t/s.js' }, 'toolu_01WF')),
      ];
      expect(got.map((l) => `${l.eventKind}:${l.toolName}`)).toEqual(['PreToolUse:Workflow', 'PostToolUse:Workflow']);
    });

    it.each([['Read'], ['Edit'], ['Write'], ['Grep'], ['Glob'], ['AskUserQuestion'], ['TodoWrite'], ['mcp__x__y']])('%s is not a delegation tool: no line', (tool) => {
      none(pre(tool, { file_path: '/x' }));
      none(post(tool, { file_path: '/x' }, 'ok'));
    });

    it('a PreToolUse with no tool_use_id, or an id outside [A-Za-z0-9_-]{1,64}, records nothing', () => {
      none(ev('PreToolUse', { tool_name: 'Agent', tool_input: {} }));
      none(pre('Agent', {}, 'toolu bad;id'));
      none(pre('Agent', {}, 't'.repeat(B.idBytes + 1)));
      expect(one(pre('Agent', {}, 't'.repeat(B.idBytes))).toolUseId).toHaveLength(B.idBytes);
    });
  });

  describe('PostToolUse: launch responses are normalised, never retained', () => {
    const AGENT_ASYNC = { isAsync: true, status: 'async_launched', agentId: 'a516cb53d83b231c7', description: 'SECRET-DESC', resolvedModel: 'claude-opus-5-5',
      prompt: 'SECRET-PROMPT', outputFile: '/tmp/SECRET-OUTPUTFILE/tasks/a516.output', canReadOutputFile: true, canContinueAgent: true };

    it.each([['Agent'], ['Task']])('%s async launch: outcome async-launched and the normalised launch, and none of the rest of the response', (tool) => {
      const l = one(post(tool, { prompt: 'x' }, AGENT_ASYNC));
      expect(l).toMatchObject({ eventKind: 'PostToolUse', toolName: tool, outcome: 'async-launched', launch: { status: 'async-launched', agentId: 'a516cb53d83b231c7', isAsync: true } });
      expect(Object.keys(l.launch).sort()).toEqual(['agentId', 'isAsync', 'status']);
      expect(allText()).not.toMatch(/SECRET|outputFile|resolvedModel|canReadOutputFile|canContinueAgent/);
    });

    it('the 2.1.29x shape: async_launched even when run_in_background is false (the caller\'s input is never read)', () => {
      const l = one(post('Agent', { prompt: 'x', run_in_background: false }, { ...AGENT_ASYNC, isAsync: true }));
      expect(l.outcome).toBe('async-launched');
      expect(l.launch.isAsync).toBe(true);
    });

    it('agent-input-keys-are-the-callers: the line is the same whether tool_input carries subagent_type, isolation or neither', () => {
      const a = one(post('Agent', { prompt: 'x', subagent_type: 'general-purpose', isolation: 'worktree' }, AGENT_ASYNC));
      const b = one(post('Agent', { prompt: 'x' }, AGENT_ASYNC));
      const c = one(post('Agent', {}, AGENT_ASYNC));
      const strip = (l: any) => { const { observedAt: _o, ...rest } = l; return rest; };
      expect(strip(b)).toEqual(strip(a));
      expect(strip(c)).toEqual(strip(a));
      const p = one(pre('Agent', { prompt: 'x', subagent_type: 'general-purpose' }));
      expect(Object.keys(p).includes('subagentType') || Object.keys(p).includes('subagent_type')).toBe(false);
    });

    it('a synchronous Agent completion: outcome completed, isAsync false, and the content never kept', () => {
      const l = one(post('Agent', {}, { status: 'completed', agentId: 'a1', content: [{ type: 'text', text: 'SECRET-RESULT' }], totalDurationMs: 5 }));
      expect(l).toMatchObject({ outcome: 'completed', launch: { status: 'completed', agentId: 'a1', isAsync: false } });
      expect(allText()).not.toMatch(/SECRET/);
    });

    it.each([
      ['no response at all', undefined, 'unknown'],
      ['a string response', 'plain text SECRET', 'unknown'],
      ['an object with no status', { agentId: 'a1' }, 'unknown'],
      ['status failed', { status: 'failed', error: 'SECRET' }, 'failed'],
      ['status error', { status: 'error', error: 'SECRET' }, 'failed'],
    ])('Agent with %s: outcome %s, launch null', (_n, resp, outcome) => {
      const l = one(post('Agent', {}, resp));
      expect(l.outcome).toBe(outcome);
      expect(l.launch).toBeNull();
      expect(allText()).not.toMatch(/SECRET/);
    });

    it('an async response whose agentId is not an id is outcome async-launched with launch null (never a cleaned id)', () => {
      const l = one(post('Agent', {}, { status: 'async_launched', isAsync: true, agentId: 'bad id;' }));
      expect(l).toMatchObject({ outcome: 'async-launched', launch: null });
    });

    const WF = { status: 'async_launched', taskId: 'wneeca9sq', taskType: 'local_workflow', workflowName: 'dlgwfi', runId: 'wf_5440bac3-dbb', summary: 'SECRET-SUMMARY',
      transcriptDir: '/rig/fixhome/cfg/projects/-rig-repo/6350faa0/subagents/workflows/wf_5440bac3-dbb',
      scriptPath: '/rig/fixhome/cfg/projects/-rig-repo/6350faa0/workflows/scripts/dlgwfi-wf_5440bac3-dbb.js' };

    it('Workflow launch: the approved fields persist, transcriptDir and scriptPath among them; the summary and the script text do not', () => {
      const l = one(post('Workflow', { script: 'SECRET-SCRIPT-TEXT' }, WF, 'toolu_01WF'));
      expect(l).toMatchObject({ toolName: 'Workflow', outcome: 'async-launched', launch: {
        status: 'async-launched', taskId: 'wneeca9sq', taskType: 'local_workflow', workflowName: 'dlgwfi', runId: 'wf_5440bac3-dbb',
        transcriptDir: WF.transcriptDir, scriptPath: WF.scriptPath } });
      expect(allText()).not.toMatch(/SECRET/);
    });

    it('workflow-phase-is-not-always-written: a launch response with no phase normalises the same as one that names a phase (which is not kept)', () => {
      const a = one(post('Workflow', {}, WF, 'toolu_01WF'));
      const b = one(post('Workflow', {}, { ...WF, workflowPhase: 'plan', phase: 'plan' }, 'toolu_01WF'));
      const strip = (l: any) => { const { observedAt: _o, ...rest } = l; return rest; };
      expect(strip(b)).toEqual(strip(a));
      expect(allText()).not.toMatch(/[Pp]hase/);
    });

    it('Workflow launch with a missing or non-id field has launch null and keeps the outcome; over-bound paths do too, marked truncated', () => {
      for (const drop of ['taskId', 'runId', 'transcriptDir', 'scriptPath', 'workflowName', 'taskType']) {
        const r: Record<string, unknown> = { ...WF }; delete r[drop];
        const l = one(post('Workflow', {}, r, 'toolu_01WF'));
        expect(l, drop).toMatchObject({ outcome: 'async-launched', launch: null });
      }
      expect(one(post('Workflow', {}, { ...WF, runId: 'wf run/1' }, 'toolu_01WF')).launch).toBeNull();
      const l = one(post('Workflow', {}, { ...WF, scriptPath: '/'.padEnd(B.pathBytes + 1, 's') }, 'toolu_01WF'));
      expect(l).toMatchObject({ launch: null, truncated: true });
    });

    it('Bash outcome: completed with a stdout, failed when interrupted, unknown otherwise; the output is never kept', () => {
      expect(one(post('Bash', { command: 'true' }, { stdout: 'SECRET-OUT', stderr: 'SECRET-ERR', interrupted: false })).outcome).toBe('completed');
      expect(one(post('Bash', { command: 'true' }, { stdout: 'SECRET-OUT', stderr: '', interrupted: true })).outcome).toBe('failed');
      expect(one(post('Bash', { command: 'true' }, 'text')).outcome).toBe('unknown');
      expect(one(post('Bash', { command: 'true' }, undefined)).outcome).toBe('unknown');
      expect(allText()).not.toMatch(/SECRET/);
    });

    it('a PostToolUse with no tool_use_id records nothing', () => {
      none(ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'true' }, tool_response: { stdout: '' } }));
    });
  });

  describe('SubagentStart and SubagentStop', () => {
    it('SubagentStart: agentId and agentType, and the reporter\'s own cwd', () => {
      const l = one(ev('SubagentStart', { agent_id: 'a516cb53d83b231c7', agent_type: 'general-purpose', cwd: '/rig/repo/.claude/worktrees/agent-a516cb53d83b231c7' }));
      expect(l).toMatchObject({ eventKind: 'SubagentStart', agentId: 'a516cb53d83b231c7', agentType: 'general-purpose', cwd: '/rig/repo/.claude/worktrees/agent-a516cb53d83b231c7' });
    });

    it('SubagentStop carries agentTranscriptPath; null when the payload has none; the last message is never kept', () => {
      const l = one(ev('SubagentStop', { agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: '/t/agent-a1.jsonl', last_assistant_message: 'SECRET-LAST', stop_hook_active: false }));
      expect(l).toMatchObject({ eventKind: 'SubagentStop', agentId: 'a1', agentType: 'general-purpose', agentTranscriptPath: '/t/agent-a1.jsonl' });
      expect(one(ev('SubagentStop', { agent_id: 'a2', agent_type: 'x' })).agentTranscriptPath).toBeNull();
      expect(allText()).not.toMatch(/SECRET/);
    });

    it('the unpaired SubagentStop around /compact (agent_type "") is a line with agentType "", not null and not dropped', () => {
      const stray = find('2.1.292', 'clear-compact-resume', (e) => e.event === 'SubagentStop');
      const l = one(stray.payload, { CLAUDE_CODE_SESSION_ID: stray.envSid });
      expect(l.agentType).toBe('');
      expect(l.agentId).toBe(stray.payload['agent_id']);
    });

    it('agentType absent is null; over the label bound it is null and the line is marked truncated', () => {
      expect(one(ev('SubagentStart', { agent_id: 'a3' })).agentType).toBeNull();
      const l = one(ev('SubagentStart', { agent_id: 'a4', agent_type: 't'.repeat(B.labelBytes + 1) }));
      expect(l.agentType).toBeNull();
      expect(l.truncated).toBe(true);
      expect(one(ev('SubagentStart', { agent_id: 'a5', agent_type: 't'.repeat(B.labelBytes) })).agentType).toHaveLength(B.labelBytes);
    });

    it('an agent_id outside [A-Za-z0-9_-]{1,64}: no line, from any event (a cleaned lookalike must not ride, and a line without the id would read as the main thread)', () => {
      for (const bad of ['a-1;', 'a b', 'é1', 'x'.repeat(B.idBytes + 1), 7, ['a'], { id: 'a' }]) {
        none(ev('SubagentStart', { agent_id: bad, agent_type: 'general-purpose' }));
        none(ev('SubagentStop', { agent_id: bad, agent_type: 'general-purpose' }));
        none(pre('Bash', { command: 'true' }, 'toolu_01B', { agent_id: bad, agent_type: 'general-purpose' }));
        none(post('Bash', { command: 'true' }, { stdout: '' }, 'toolu_01B', { agent_id: bad }));
      }
      expect(one(ev('SubagentStart', { agent_id: 'a'.repeat(B.idBytes), agent_type: 'x' })).agentId).toHaveLength(B.idBytes);
    });

    it('SubagentStart / SubagentStop with no agent_id record nothing', () => {
      none(ev('SubagentStart', { agent_type: 'x' }));
      none(ev('SubagentStop', { agent_type: 'x', agent_transcript_path: '/t' }));
    });

    it('a subagent\'s own tool event names its reporter (agentId, agentType); a main-thread one carries neither', () => {
      const sub = one(pre('Bash', { command: 'true' }, 'toolu_01S', { agent_id: 'a516cb53d83b231c7', agent_type: 'general-purpose' }));
      expect(sub).toMatchObject({ agentId: 'a516cb53d83b231c7', agentType: 'general-purpose' });
      const main = one(pre('Bash', { command: 'true' }, 'toolu_01M'));
      expect('agentId' in main || 'agentType' in main).toBe(false);
    });
  });

  describe('UserPromptSubmit: only a syntactically valid terminal task notification is evidence', () => {
    const NOTE = (o: { id?: string; tool?: string; status?: string; extra?: string; head?: string; tail?: string } = {}): string =>
      `${o.head ?? ''}<task-notification>\n<task-id>${o.id ?? 'wneeca9sq'}</task-id>\n<tool-use-id>${o.tool ?? 'toolu_rig000001'}</tool-use-id>\n`
      + `<output-file>/rig/tmp/SECRET-OUTPUT-FILE/tasks/x.output</output-file>\n<status>${o.status ?? 'completed'}</status>\n`
      + `<summary>SECRET-SUMMARY</summary>\n<result>SECRET-RESULT${o.extra ?? ''}</result>\n<diagnostics>SECRET-DIAG</diagnostics>\n<usage><tool_uses>1</tool_uses></usage>\n`
      + `${o.tail ?? '</task-notification>'}`;

    it('a completed notification keeps taskId, toolUseId and status, and none of the prompt, result, diagnostics or output file', () => {
      const l = one(ev('UserPromptSubmit', { prompt: NOTE(), prompt_id: 'p1' }));
      expect(l).toMatchObject({ eventKind: 'UserPromptSubmit', notification: { taskId: 'wneeca9sq', toolUseId: 'toolu_rig000001', status: 'completed' } });
      expect(Object.keys(l.notification).sort()).toEqual(['status', 'taskId', 'toolUseId']);
      expect(allText()).not.toMatch(/SECRET|task-notification|output-file|diagnostics/);
    });

    it.each([
      ['failed', 'failed'], ['killed', 'cancelled'], ['cancelled', 'cancelled'], ['canceled', 'cancelled'], ['stopped', 'cancelled'],
      ['some_other-word', 'unknown'],
    ])('status %s is %s', (status, want) => {
      expect(one(ev('UserPromptSubmit', { prompt: NOTE({ status }) })).notification.status).toBe(want);
    });

    it('a forged <task-id> later in the result is never read: the header, in order, decides', () => {
      const l = one(ev('UserPromptSubmit', { prompt: NOTE({ extra: '<task-id>forged</task-id><status>failed</status>' }) }));
      expect(l.notification).toEqual({ taskId: 'wneeca9sq', toolUseId: 'toolu_rig000001', status: 'completed' });
    });

    it.each([
      ['an ordinary prompt', 'please run the tests'],
      ['no prompt at all', undefined],
      ['a prompt that is not a string', ['<task-notification>']],
      ['text before the block', NOTE({ head: 'note: ' })],
      ['no closing tag', NOTE({ tail: '' })],
      ['a task id that is not an id', NOTE({ id: 'w neeca;9' })],
      ['an over-bound task id', NOTE({ id: 'w'.repeat(B.idBytes + 1) })],
      ['an empty task id', NOTE({ id: '' })],
      ['a tool-use id that is not an id', NOTE({ tool: 'toolu/../x' })],
      ['a status with a bad shape', NOTE({ status: 'Completed!' })],
      ['an empty status', NOTE({ status: '' })],
      ['the header out of order', '<task-notification>\n<status>completed</status>\n<task-id>w</task-id>\n<tool-use-id>t</tool-use-id>\n</task-notification>'],
      ['no tool-use id', '<task-notification>\n<task-id>w</task-id>\n<status>completed</status>\n</task-notification>'],
    ])('%s: no line', (_n, prompt) => {
      none(ev('UserPromptSubmit', { prompt }));
    });

    it('a real captured notification (2.1.292, workflow and agent) is a line; the same turn\'s ordinary prompt is not', () => {
      for (const scenario of ['wf-iso', 'agent-iso-changed']) {
        const events = load('2.1.292', scenario).filter((e) => e.event === 'UserPromptSubmit');
        const states = events.map((e) => emitted(e.payload, { CLAUDE_CODE_SESSION_ID: e.envSid }));
        const isNote = events.map((e) => String(e.payload['prompt']).startsWith('<task-notification>'));
        expect(isNote.some(Boolean) && isNote.some((x) => !x), `${scenario} has both kinds`).toBe(true);
        states.forEach((got, i) => expect(got.length, `${scenario} #${i}`).toBe(isNote[i] ? 1 : 0));
      }
      expect(allText()).not.toMatch(/DLG-WF|<result>|usage/);
    });
  });

  describe('SessionEnd.reason', () => {
    it.each([['clear'], ['prompt_input_exit'], ['logout'], ['other']])('reason %s is a line, and a SessionEnd still writes no hookstate', (reason) => {
      expect(one(ev('SessionEnd', { reason }))).toMatchObject({ eventKind: 'SessionEnd', reason });
      expect(fs.existsSync(path.join(reg(), `${OWNER}.hookstate.json`))).toBe(false);
    });
    it('a SessionEnd with no reason, an empty one, a non-string one or an over-bound one records nothing', () => {
      none(ev('SessionEnd', {}));
      none(ev('SessionEnd', { reason: '' }));
      none(ev('SessionEnd', { reason: 3 }));
      none(ev('SessionEnd', { reason: 'r'.repeat(B.labelBytes + 1) }));
    });
  });

  describe('events that are not delegation evidence write nothing', () => {
    it.each([
      ['Stop', ev('Stop', { stop_hook_active: false, background_tasks: [{ id: 'w1', type: 'workflow', status: 'running' }], last_assistant_message: 'SECRET' })],
      ['StopFailure', ev('StopFailure', { error: 'server_error' })],
      ['PreCompact', ev('PreCompact', { trigger: 'manual', custom_instructions: null })],
      ['PostCompact', ev('PostCompact', { trigger: 'manual', compact_summary: 'SECRET' })],
      ['PermissionRequest', ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } })],
      ['WorktreeCreate (never registered, and never recorded)', ev('WorktreeCreate', { name: 'x' })],
      ['WorktreeRemove (never registered, and never recorded)', ev('WorktreeRemove', { worktree_path: '/x' })],
      ['an unknown event', ev('SomethingElse', {})],
      ['an ordinary prompt', ev('UserPromptSubmit', { prompt: 'hello SECRET' })],
    ])('%s', (_n, payload) => {
      none(payload as object);
      expect(allText()).toBe('');
    });

    it('parent-stop-does-not-bound-workflow-start: a parent Stop between the Workflow launch and its SubagentStarts is not a line, and does not disturb the lines around it', () => {
      const wf = { status: 'async_launched', taskId: 'wabc', taskType: 'local_workflow', workflowName: 'wf', runId: 'wf_1-aa', transcriptDir: '/t/d', scriptPath: '/t/s.js' };
      const got = [
        ...emitted(post('Workflow', {}, wf, 'toolu_01WF')),
        ...emitted(ev('Stop', { background_tasks: [{ id: 'wabc', type: 'workflow', status: 'running' }] })),
        ...emitted(ev('SubagentStart', { agent_id: 'a1', agent_type: 'workflow-subagent' })),
        ...emitted(ev('Stop', { background_tasks: [{ id: 'wabc', type: 'workflow', status: 'running' }] })),
        ...emitted(ev('SubagentStop', { agent_id: 'a1', agent_type: 'workflow-subagent' })),
      ];
      expect(got.map((l) => l.eventKind)).toEqual(['PostToolUse', 'SubagentStart', 'SubagentStop']);
    });
  });

  describe('captured payloads, replayed whole (every version in the corpus)', () => {
    // EVERY version in `fixtures/delegation/` (14 at the time of writing, 2.1.280 to 2.1.299), read from the directory and not listed
    // here, so a recapture adds its rows. A cell the matrix marks `unmeasured` is skipped, never relied on. Six scenarios per version
    // cover each kind of line the hook writes: plain and isolated Agent, isolated and plain Workflow, a raw Bash worktree, and the
    // /compact-and-/clear run (SessionStart sources, SessionEnd reasons, the unpaired SubagentStop). This is also the soundness
    // check for the hook's payload prefilter: a delegation event the prefilter missed would be a line missing here.
    const SCENARIOS = ['agent-plain', 'agent-iso-bg', 'wf-iso', 'wf-plain', 'raw-worktree', 'clear-compact-resume'];
    const MATRIX = (JSON.parse(fs.readFileSync(path.join(FIXTURES, 'matrix.json'), 'utf8')) as { cells: Record<string, { status: string }> }).cells;
    const VERSIONS = fs.readdirSync(FIXTURES).filter((v) => /^2\.1\.\d+$/.test(v)).sort();
    const CELLS = VERSIONS.flatMap((v) => SCENARIOS.filter((s) => MATRIX[`${v}/${s}`]?.status === 'measured').map((s) => [v, s] as [string, string]));
    it('the corpus has the versions and cells this replay is meant to cover', () => {
      expect(VERSIONS.length).toBeGreaterThanOrEqual(14);
      expect(VERSIONS).toContain('2.1.280');
      expect(VERSIONS).toContain('2.1.299');
      expect(CELLS.length, 'every one of the six scenarios is measured in every version').toBe(VERSIONS.length * SCENARIOS.length);
    });
    it.each(CELLS)('%s %s: every delegation event is a valid line, in order, and the rest write none', (version, scenario) => {
      const events = load(version, scenario).filter((e) => e.event !== 'PreCompact' && e.event !== 'PostCompact');   // the compaction arms are not this file's subject
      const kinds = new Set<string>(Object.keys(KINDS));
      const wantTool = (e: Captured): boolean => !(e.event === 'PreToolUse' || e.event === 'PostToolUse') || ['Agent', 'Task', 'Workflow', 'Bash'].includes(String(e.payload['tool_name']));
      const wantNote = (e: Captured): boolean => e.event !== 'UserPromptSubmit' || String(e.payload['prompt'] ?? '').startsWith('<task-notification>');
      const expected: string[] = [];
      const got: string[] = [];
      for (const e of events) {
        const lns = emitted(e.payload, { CLAUDE_CODE_SESSION_ID: e.envSid });
        if (kinds.has(e.event) && wantTool(e) && wantNote(e)) {
          expected.push(e.event);
          expect(lns, `seq ${e.seq} ${e.event}`).toHaveLength(1);
          expect(lns[0].claudeSessionId).toBe(String(e.payload['session_id']));
          if (e.event === 'SubagentStart' || e.event === 'SubagentStop') expect(lns[0].agentId).toBe(e.payload['agent_id']);
        } else expect(lns, `seq ${e.seq} ${e.event}`).toEqual([]);
        got.push(...lns.map((l) => l.eventKind));
      }
      expect(got).toEqual(expected);
      expect(got.length).toBeGreaterThanOrEqual(3);
    });

    it('2.1.292 wf-iso: the Workflow launch line keeps the captured transcriptDir and scriptPath', () => {
      for (const e of load('2.1.292', 'wf-iso')) emitted(e.payload, { CLAUDE_CODE_SESSION_ID: e.envSid });
      const launch = lines().find((l) => l.eventKind === 'PostToolUse' && l.toolName === 'Workflow');
      const resp = find('2.1.292', 'wf-iso', (e) => e.event === 'PostToolUse' && e.payload['tool_name'] === 'Workflow').payload['tool_response'];
      expect(launch.launch).toEqual({ status: 'async-launched', taskId: resp.taskId, taskType: resp.taskType, workflowName: resp.workflowName,
        runId: resp.runId, transcriptDir: resp.transcriptDir, scriptPath: resp.scriptPath });
    });

    it('real-payloads-carry-scratchpad-dir: a captured payload with a scratchpad_dir (top level and in the response) persists none of it', () => {
      const SCRATCH = '/tmp/claude-1000/-rig-repo/6350faa0/scratchpad';
      const wf = find('2.1.292', 'wf-iso', (e) => e.event === 'PostToolUse' && e.payload['tool_name'] === 'Workflow');
      const agent = find('2.1.292', 'agent-iso-bg', (e) => e.event === 'PostToolUse' && e.payload['tool_name'] === 'Agent');
      for (const e of [wf, agent]) {
        const withScratch = { ...e.payload, scratchpad_dir: SCRATCH, tool_response: { ...e.payload['tool_response'], scratchpad_dir: SCRATCH } };
        const l = one(withScratch, { CLAUDE_CODE_SESSION_ID: e.envSid });
        expect(JSON.stringify(l)).not.toContain('scratchpad');
      }
      for (const kind of ['SessionStart', 'PreToolUse', 'SubagentStart', 'SessionEnd']) {
        const e = { ...ev(kind, { source: 'startup', reason: 'clear', agent_id: 'a1', agent_type: 'x', tool_name: 'Agent', tool_use_id: 'toolu_01', tool_input: {} }), scratchpad_dir: SCRATCH };
        emitted(e);
      }
      expect(allText()).not.toContain('scratchpad');
      expect(allText()).not.toContain(SCRATCH);
    });
  });

  describe('nothing outside the closed fields persists, whatever the event', () => {
    it('sentinels planted in every free-text spot of every event never reach the bucket', () => {
      const S = 'SENTINEL-DO-NOT-PERSIST';
      const unknown = { prompt: S, result: S, diagnostics: S, last_assistant_message: S, scratchpad_dir: `/tmp/${S}`, outputFile: `/tmp/${S}.output`, tool_response_text: S };
      const events: object[] = [
        ev('SessionStart', { source: 'startup', model: S, ...unknown }),
        pre('Bash', { command: `git worktree ${S}`, description: S }, 'toolu_01', unknown),
        pre('Agent', { prompt: S, description: S, subagent_type: S }, 'toolu_02', unknown),
        pre('Workflow', { script: S }, 'toolu_03', unknown),
        post('Bash', { command: S }, { stdout: S, stderr: S, interrupted: false, extra: S }, 'toolu_04', unknown),
        post('Agent', { prompt: S }, { status: 'async_launched', isAsync: true, agentId: 'a9', outputFile: `/tmp/${S}`, prompt: S, description: S }, 'toolu_05', unknown),
        post('Workflow', { script: S }, { status: 'async_launched', taskId: 'w9', taskType: 'local_workflow', workflowName: 'n', runId: 'wf_9', summary: S, transcriptDir: '/t', scriptPath: '/s', other: S }, 'toolu_06', unknown),
        ev('SubagentStart', { agent_id: 'a9', agent_type: 'general-purpose', ...unknown }),
        ev('SubagentStop', { agent_id: 'a9', agent_type: 'general-purpose', agent_transcript_path: '/t/a9.jsonl', ...unknown }),
        ev('UserPromptSubmit', { ...unknown, prompt: `<task-notification>\n<task-id>w9</task-id>\n<tool-use-id>toolu_06</tool-use-id>\n<status>completed</status>\n<result>${S}</result>\n</task-notification>` }),
        ev('SessionEnd', { reason: 'clear', ...unknown }),
      ];
      for (const e of events) emitted(e);
      expect(rawLines().length).toBe(events.length);
      expect(allText()).not.toContain(S);
    });
  });

  // ── Step 3: the envelope ──
  describe('the envelope', () => {
    it('v, canonical millisecond UTC timestamp, owner, incarnation, Claude session and the approved context', () => {
      const t0 = Date.now();
      const l = one(pre('Agent', {}), { CLAUDE_CODE_EXECPATH: '/opt/claude/versions/2.1.296' });
      const t1 = Date.now();
      expect(l.v).toBe(1);
      expect(l.observedAt).toMatch(TS_RE);
      const at = Date.parse(l.observedAt);
      expect(at, 'observedAt is the time the hook ran, in UTC').toBeGreaterThanOrEqual(t0 - 2000);
      expect(at).toBeLessThanOrEqual(t1 + 2000);
      expect(l).toMatchObject({ sessionId: OWNER, parentIncarnation: GENERATION, claudeSessionId: CLAUDE_SID, cwd: '/rig/repo', transcriptPath: TRANSCRIPT, claudeVersion: '2.1.296' });
      expect('truncated' in l, 'an untouched line is not marked truncated').toBe(false);
    });

    it('claudeVersion is the version directory of CLAUDE_CODE_EXECPATH when it is one, and absent otherwise; the path itself is never kept', () => {
      expect('claudeVersion' in one(pre('Agent', {}), { CLAUDE_CODE_EXECPATH: '' })).toBe(false);
      expect('claudeVersion' in one(pre('Agent', {}), { CLAUDE_CODE_EXECPATH: '/usr/local/bin/claude' })).toBe(false);
      expect('claudeVersion' in one(pre('Agent', {}), { CLAUDE_CODE_EXECPATH: '/x/versions/2.1.2;rm -rf' })).toBe(false);
      expect(one(pre('Agent', {}), { CLAUDE_CODE_EXECPATH: '/opt/user-a/.local/share/claude/versions/2.1.299' }).claudeVersion).toBe('2.1.299');
      expect(allText()).not.toContain('user-a');
    });

    it('the Claude session id is the payload\'s, not the environment\'s; a missing or malformed one records nothing', () => {
      expect(one(pre('Agent', {}), { CLAUDE_CODE_SESSION_ID: 'env-id-9' }).claudeSessionId).toBe(CLAUDE_SID);
      none(pre('Agent', {}, 'toolu_01', { session_id: undefined }));
      none(pre('Agent', {}, 'toolu_01', { session_id: 's e;ss' }));
      none(pre('Agent', {}, 'toolu_01', { session_id: 's'.repeat(B.idBytes + 1) }));
    });

    it('cwd and transcriptPath are optional: absent in the payload, absent in the line', () => {
      const l = one({ hook_event_name: 'SessionEnd', session_id: CLAUDE_SID, reason: 'clear' });
      expect('cwd' in l || 'transcriptPath' in l).toBe(false);
    });

    it('an optional path over the byte bound is dropped, never cut, and marks the line; multibyte is counted in BYTES', () => {
      const at = '/'.padEnd(B.pathBytes, 'p');
      expect(one(pre('Agent', {}, 'toolu_01', { cwd: at })).cwd).toBe(at);
      const over = one(pre('Agent', {}, 'toolu_01', { cwd: `${at}x` }));
      expect('cwd' in over).toBe(false);
      expect(over.truncated).toBe(true);
      const euro = '€'.repeat(Math.floor(B.pathBytes / 3));            // 170 chars, 510 bytes
      expect(one(pre('Agent', {}, 'toolu_01', { cwd: euro })).cwd).toBe(euro);
      const tooMany = one(pre('Agent', {}, 'toolu_01', { cwd: `${euro}€` }));   // 171 chars, 513 bytes: under the CHARACTER bound, over the byte bound
      expect('cwd' in tooMany).toBe(false);
      expect(tooMany.truncated).toBe(true);
    });

    it('the owner id may be the ccd shape [A-Za-z0-9._-]; the line\'s sessionId is the directory\'s name', () => {
      const id = 'acct-a.demo_x-1';
      fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${id}"\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(reg(), `${id}.generation`), GENERATION);
      plantOwnerDir(id);
      run(pre('Agent', {}));
      const l = lines(ownerDir(id));
      expect(l).toHaveLength(1);
      expect(validate(l[0], id)).toEqual([]);
      expect(l[0].sessionId).toBe(path.basename(ownerDir(id)));
    });

    it('an owner id at the bound writes a line; one byte over writes nothing', () => {
      for (const [id, want] of [['o'.repeat(B.ownerIdBytes), 1], ['o'.repeat(B.ownerIdBytes + 1), 0]] as const) {
        fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${id}"\n`, { mode: 0o755 });
        fs.writeFileSync(path.join(reg(), `${id}.generation`), GENERATION);
        plantOwnerDir(id);
        run(pre('Agent', {}));
        expect(lines(ownerDir(id)), `${id.length} bytes`).toHaveLength(want);
        if (want) expect(validate(lines(ownerDir(id))[0], id)).toEqual([]);
      }
    });

    it('a line is one JSON object on one line with a final LF, whatever control characters the payload held', () => {
      const l = one(pre('Agent', {}, 'toolu_01', { cwd: '/a\nb\tc\u0001d"e\\f' }));
      expect(l.cwd).toBe('/a\nb\tc\u0001d"e\\f');
      for (const raw of rawLines()) expect(raw.includes('\n')).toBe(false);
    });

    it('invalid UTF-8 in a payload string is replaced, so the line is strict UTF-8 and still a line', () => {
      const body = Buffer.from(`{"hook_event_name":"PreToolUse","session_id":"${CLAUDE_SID}","tool_name":"Agent","tool_input":{},"tool_use_id":"toolu_01","cwd":"/a`);
      const payload = Buffer.concat([body, Buffer.from([0xff, 0xfe]), Buffer.from('b"}')]);
      const r = spawnSync('bash', [HOOK], { input: payload, env: hookEnv(), timeout: 120_000 });
      expect(r.status).toBe(0);
      const raw = fs.readFileSync(path.join(ownerDir(), bucketFiles()[0]!));
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(raw)).not.toThrow();
      expect(JSON.parse(raw.toString('utf8')).cwd.startsWith('/a')).toBe(true);
    });

    it('a payload that is not JSON records nothing and the hook still exits 0', () => {
      none('this is {not json');
      none('');
    });
  });

  // ── Step 3: the cap ──
  describe('the strict line cap: less than 4096 bytes, LF included (W3-M04)', () => {
    /** A SubagentStop whose three optional strings are inflated by `\u0001` (6 bytes serialized each). */
    const big = (cwdRaw: string, tpRaw: string, atpRaw: string | null, type = 'general-purpose'): Record<string, unknown> =>
      ev('SubagentStop', { agent_id: 'a1', agent_type: type, cwd: cwdRaw, transcript_path: tpRaw, ...(atpRaw === null ? {} : { agent_transcript_path: atpRaw }) });
    const ctl = (n: number): string => '\u0001'.repeat(n);

    it('nothing over the cap is ever written: an inflated payload sheds optional fields in the declared order and marks the line truncated', () => {
      // 500 control bytes serialize to 3000 bytes each: three of them cannot fit one line.
      const l = one(big(`/${ctl(500)}`, `/${ctl(500)}`, `/${ctl(500)}`));
      expect(l.truncated).toBe(true);
      expect(l).toMatchObject({ agentId: 'a1', eventKind: 'SubagentStop' });
    });

    it('the shed order is listing, claudeVersion, cwd, agentType, transcriptPath: each goes only once the earlier ones did not suffice, and agentTranscriptPath is kept', () => {
      const V = { CLAUDE_CODE_EXECPATH: '/x/versions/2.1.296' };
      let l = one(big(`/${ctl(100)}`, `/${ctl(100)}`, `/${ctl(100)}`), V);     // 3 x 601 + base: fits whole
      expect(l.truncated).toBeUndefined();
      expect(l).toHaveProperty('claudeVersion');
      l = one(big(`/${ctl(300)}`, `/${ctl(300)}`, `/${ctl(300)}`), V);          // 3 x 1801: over the cap by one path
      expect(l.truncated).toBe(true);
      expect('claudeVersion' in l, 'claudeVersion went first').toBe(false);
      expect('cwd' in l, 'cwd went next, and was enough').toBe(false);
      expect(l.transcriptPath).toBe(`/${ctl(300)}`);
      expect(l.agentTranscriptPath).toBe(`/${ctl(300)}`);
      expect(l.agentType).toBe('general-purpose');
      l = one(big(`/${ctl(500)}`, `/${ctl(500)}`, `/${ctl(500)}`), V);          // 3 x 3001: agentType and transcriptPath must go too
      expect(l.truncated).toBe(true);
      expect('cwd' in l).toBe(false);
      expect(l.agentType, 'agentType (required, nullable) is shed to null before transcriptPath').toBeNull();
      expect('transcriptPath' in l, 'transcriptPath went before the agent transcript path').toBe(false);
      expect(l.agentTranscriptPath, 'the agent transcript path is a required field and stays').toBe(`/${ctl(500)}`);
    });

    it('a line whose REQUIRED fields alone pass the cap (a workflow launch whose paths are inflated by escapes) is not written at all, and the hook still exits 0', () => {
      const wf = { status: 'async_launched', taskId: 'wabc', taskType: 'local_workflow', workflowName: 'wf', runId: 'wf_1-aa', transcriptDir: `/${ctl(500)}`, scriptPath: `/${ctl(500)}` };
      expect(run(post('Workflow', {}, wf, 'toolu_01WF'))).toEqual({ stdout: '', stderr: '' });
      expect(rawLines()).toEqual([]);
    });

    it('the strict boundary: a line that is 4095 bytes with its LF is kept whole; 4096 is shed (the cap is "less than", not "at most")', () => {
      // The probe is a SubagentStop with three one-byte optional strings; every extra serialized byte beyond it is placed in
      // two control-character runs (6 bytes each) and a plain run, so the target is hit exactly.
      const mk = (cwd: string, tp: string, atp: string): Record<string, unknown> =>
        ev('SubagentStop', { agent_id: 'a1', agent_type: 'general-purpose', cwd, transcript_path: tp, agent_transcript_path: atp });
      one(mk('/', '/t', '/a'));
      const probeLen = bytes(rawLines()[0]!) + 1;
      fs.rmSync(path.join(ownerDir(), bucketFiles()[0]!));
      const make = (target: number, cwdTail = ''): Record<string, unknown> => {
        let extra = target - probeLen - bytes(cwdTail);
        const k1 = Math.min(Math.floor(extra / 6), 500); extra -= 6 * k1;
        const k2 = Math.min(Math.floor(extra / 6), 500); extra -= 6 * k2;
        return mk(`/${cwdTail}${'c'.repeat(extra)}`, `/t${ctl(k1)}`, `/a${ctl(k2)}`);
      };
      const lineBytes = (): number => bytes(rawLines()[0]!) + 1;
      const reset = (): void => fs.rmSync(path.join(ownerDir(), bucketFiles()[0]!));
      for (const tail of ['', '€']) {
        // With a euro sign in the payload the line holds FEWER characters than bytes: a cap on characters would keep the 4096.
        const kept = one(make(4095, tail));
        expect(lineBytes(), `${JSON.stringify(tail)}: kept at exactly 4095 bytes with its LF`).toBe(4095);
        expect(kept.truncated).toBeUndefined();
        expect(kept.cwd.startsWith(`/${tail}`)).toBe(true);
        reset();
        const shed = one(make(4096, tail));
        expect(shed.truncated, `${JSON.stringify(tail)}: at 4096 the optional fields were shed`).toBe(true);
        expect(lineBytes()).toBeLessThan(4096);
        if (tail) expect(rawLines()[0]!.length, 'the rejected line had fewer characters than bytes in it').toBeLessThan(4095);
        reset();
        const over = make(4097, tail);
        expect(one(over).truncated).toBe(true);
        reset();
      }
    });

    it('multibyte input is bounded in bytes: three euro-and-control paths whose serialized form passes the cap are shed to a line under it', () => {
      const e = `${'€'.repeat(100)}${ctl(200)}`;                    // 301 + 200 raw bytes (under the path bound), 1500 serialized
      const l = one(ev('SubagentStop', { agent_id: 'a1', agent_type: '€'.repeat(40), cwd: `/${e}`, transcript_path: `/${e}`, agent_transcript_path: `/${e}` }));
      const raw = rawLines()[0]!;
      expect(l.truncated).toBe(true);
      expect(bytes(raw) + 1).toBeLessThan(4096);
      expect(raw.length, 'fewer characters than bytes: the cap is on bytes').toBeLessThan(bytes(raw));
      expect(l.agentId).toBe('a1');
    });
  });

  // ── Step 3: the Bash listing ──
  describe('the Bash listing: names of <git-common-dir>/worktrees, bounded, never paths', () => {
    let repo: string;
    const names = (ls: string[]): string[] => [...ls].sort();
    const admin = (n: string): void => { fs.mkdirSync(path.join(repo, '.git', 'worktrees', n), { recursive: true }); };
    /** A main checkout the hook can read: `.git` a directory holding `worktrees/<name>/`. No git binary involved. */
    const mkRepo = (adminNames: string[]): void => {
      repo = path.join(home, 'repo');
      fs.rmSync(repo, { recursive: true, force: true });
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      for (const n of adminNames) admin(n);
    };
    /** A linked worktree: a `.git` FILE saying where its admin record is. */
    const linked = (n: string, rel?: string): string => {
      const wt = path.join(repo, '.claude', 'worktrees', n);
      fs.mkdirSync(wt, { recursive: true });
      fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${rel ?? path.join(repo, '.git', 'worktrees', n)}\n`);
      return wt;
    };
    const WT = 'git worktree list';
    beforeEach(() => mkRepo(['agent-a1', 'wf_5440bac3-dbb-1', 'raw-wt']));

    it('a Bash call whose text names a worktree gets the repo\'s admin-record names, before and after, sorted', () => {
      const a = one(pre('Bash', { command: WT }, 'toolu_01', { cwd: repo }));
      const b = one(post('Bash', { command: WT }, { stdout: '', interrupted: false }, 'toolu_01', { cwd: repo }));
      expect(a.listing).toEqual(names(['agent-a1', 'wf_5440bac3-dbb-1', 'raw-wt']));
      expect(b.listing).toEqual(a.listing);
      expect(JSON.stringify(a.listing), 'names, not the paths they live under').not.toContain(repo);
    });

    it('the listing is of NAMES: no entry carries a separator, and the command text is never kept', () => {
      const l = one(pre('Bash', { command: `${WT} add ../secret-sibling` }, 'toolu_01', { cwd: repo }));
      for (const n of l.listing) expect(n.includes('/')).toBe(false);
      expect(allText()).not.toContain('secret-sibling');
    });

    it('from a LINKED worktree (a .git file) and from a subdirectory, it is the same repo\'s listing', () => {
      const wt = linked('agent-a1');
      fs.mkdirSync(path.join(wt, 'src', 'deep'), { recursive: true });
      expect(one(pre('Bash', { command: WT }, 'toolu_01', { cwd: wt })).listing).toEqual(names(['agent-a1', 'wf_5440bac3-dbb-1', 'raw-wt']));
      expect(one(pre('Bash', { command: WT }, 'toolu_02', { cwd: path.join(wt, 'src', 'deep') })).listing).toEqual(names(['agent-a1', 'wf_5440bac3-dbb-1', 'raw-wt']));
      expect(one(pre('Bash', { command: WT }, 'toolu_03', { cwd: path.join(repo, 'nothing-here') })).listing, 'a cwd that does not exist still walks up to the repo').toEqual(names(['agent-a1', 'wf_5440bac3-dbb-1', 'raw-wt']));
    });

    it('a real git worktree layout reads the same: the listing equals the admin directory\'s own entries', () => {
      const real = path.join(home, 'realrepo');
      const g = (...a: string[]): string => execFileSync('git', ['-C', real, '-c', 'user.email=f@example.invalid', '-c', 'user.name=fixture', ...a], { encoding: 'utf8' });
      fs.mkdirSync(real);
      g('init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(real, 'f'), 'x');
      g('add', '-A'); g('commit', '-q', '-m', 'c');
      g('worktree', 'add', '-q', '-b', 'b1', path.join(home, 'wt-one'));
      g('worktree', 'add', '-q', '-b', 'b2', path.join(real, '.claude', 'worktrees', 'agent-0123456789abcdef0'));
      const want = fs.readdirSync(path.join(real, '.git', 'worktrees')).sort();
      expect(want).toHaveLength(2);
      for (const cwd of [real, path.join(home, 'wt-one'), path.join(real, '.claude', 'worktrees', 'agent-0123456789abcdef0')]) {
        expect(one(pre('Bash', { command: WT }, `toolu_${Math.random().toString(36).slice(2, 10)}`, { cwd })).listing, cwd).toEqual(want);
      }
    });

    it('a Bash call that does not name a worktree has no listing key at all (the trigger is the command text)', () => {
      const l = one(pre('Bash', { command: 'git status' }, 'toolu_01', { cwd: repo }));
      expect('listing' in l).toBe(false);
      const m = one(post('Bash', { command: 'ls -la' }, { stdout: '' }, 'toolu_02', { cwd: repo }));
      expect('listing' in m).toBe(false);
    });

    it('the listing is for Bash only: an Agent call in the same repo carries none', () => {
      expect('listing' in one(pre('Agent', { prompt: 'worktree worktree' }, 'toolu_01', { cwd: repo }))).toBe(false);
    });

    it('no repository around the cwd, or an unreadable worktrees directory: no listing key (unmeasured), and the line is not marked truncated', () => {
      const l = one(pre('Bash', { command: WT }, 'toolu_01', { cwd: home }));
      expect('listing' in l).toBe(false);
      expect('truncated' in l).toBe(false);
      if (process.getuid?.() !== 0) {
        fs.chmodSync(path.join(repo, '.git', 'worktrees'), 0o000);
        try {
          const m = one(pre('Bash', { command: WT }, 'toolu_02', { cwd: repo }));
          expect('listing' in m, 'unreadable is not empty').toBe(false);
          expect('truncated' in m).toBe(false);
        } finally { fs.chmodSync(path.join(repo, '.git', 'worktrees'), 0o755); }
      }
    });

    it('a repository with no worktrees directory has a MEASURED empty listing', () => {
      fs.rmSync(path.join(repo, '.git', 'worktrees'), { recursive: true });
      expect(one(pre('Bash', { command: WT }, 'toolu_01', { cwd: repo })).listing).toEqual([]);
    });

    it('a submodule-style gitdir (no /worktrees/ in it) is not a linked worktree: no listing', () => {
      const sm = path.join(home, 'sm');
      fs.mkdirSync(sm);
      fs.writeFileSync(path.join(sm, '.git'), 'gitdir: ../repo/.git/modules/sm\n');
      expect('listing' in one(pre('Bash', { command: WT }, 'toolu_01', { cwd: sm }))).toBe(false);
    });

    it('a dot-leading admin record is listed; . and .. are not', () => {
      admin('.hidden');
      expect(one(pre('Bash', { command: WT }, 'toolu_01', { cwd: repo })).listing).toContain('.hidden');
    });

    it('a name outside [A-Za-z0-9._@+-] (or over the name bound) drops the WHOLE listing and marks the line; a name at the bound stays', () => {
      admin('has space');
      let l = one(pre('Bash', { command: WT }, 'toolu_01', { cwd: repo }));
      expect('listing' in l, 'a partial listing reads as a complete one').toBe(false);
      expect(l.truncated).toBe(true);
      fs.rmSync(path.join(repo, '.git', 'worktrees', 'has space'), { recursive: true });
      admin('n'.repeat(B.listingNameBytes + 1));
      l = one(pre('Bash', { command: WT }, 'toolu_02', { cwd: repo }));
      expect('listing' in l).toBe(false);
      expect(l.truncated).toBe(true);
      fs.rmSync(path.join(repo, '.git', 'worktrees', 'n'.repeat(B.listingNameBytes + 1)), { recursive: true });
      admin('n'.repeat(B.listingNameBytes));
      l = one(pre('Bash', { command: WT }, 'toolu_03', { cwd: repo }));
      expect(l.listing).toContain('n'.repeat(B.listingNameBytes));
      expect('truncated' in l).toBe(false);
    });

    it('more names than the count bound drops the whole listing; exactly the bound keeps it', () => {
      mkRepo(Array.from({ length: B.listingNames }, (_, i) => `w${i}`));
      expect(one(pre('Bash', { command: WT }, 'toolu_01', { cwd: repo })).listing).toHaveLength(B.listingNames);
      admin('w-extra');
      const l = one(pre('Bash', { command: WT }, 'toolu_02', { cwd: repo }));
      expect('listing' in l).toBe(false);
      expect(l.truncated).toBe(true);
    });

    it('listing is dropped FIRST at the measured ~3.9 KiB case: the other optional fields stay, truncated is set, the line is under the cap', () => {
      mkRepo(Array.from({ length: 140 }, (_, i) => `agent-${String(i).padStart(4, '0')}-0123456789ab`));   // 140 x 3 + names ~ 3.9 KiB of listing
      const l = one(pre('Bash', { command: WT }, 'toolu_01', { cwd: repo }), { CLAUDE_CODE_EXECPATH: '/x/versions/2.1.296' });
      expect('listing' in l).toBe(false);
      expect(l.truncated).toBe(true);
      expect(l).toMatchObject({ cwd: repo, transcriptPath: TRANSCRIPT, claudeVersion: '2.1.296' });
      mkRepo(Array.from({ length: 100 }, (_, i) => `agent-${String(i).padStart(4, '0')}-0123456789ab`));
      const kept = one(pre('Bash', { command: WT }, 'toolu_02', { cwd: repo }));
      expect(kept.listing).toHaveLength(100);
      expect('truncated' in kept).toBe(false);
    });

    it('when the listing is dropped the line is exactly the line it would have been with no listing, plus truncated:true', () => {
      mkRepo(Array.from({ length: 140 }, (_, i) => `agent-${String(i).padStart(4, '0')}-0123456789ab`));
      const withDrop = one(pre('Bash', { command: WT }, 'toolu_01', { cwd: repo }));
      const plain = one(pre('Bash', { command: 'git status' }, 'toolu_01', { cwd: repo }));
      const strip = (l: any) => { const { observedAt: _o, truncated: _t, ...rest } = l; return rest; };
      expect(strip(withDrop)).toEqual(strip(plain));
    });
  });

  // ── Step 3: the incarnation ──
  describe('incarnation binding: the parent identity is (ccd id, registry incarnation) read at write time (W3-M60)', () => {
    it('every line carries the incarnation in the owner\'s generation file, and a reused generation is told apart by its lines', () => {
      expect(one(pre('Agent', {}, 'toolu_01')).parentIncarnation).toBe(GENERATION);
      // The row is purged and recreated under the same id: a new generation, and the new pane carries it.
      fs.writeFileSync(genFile(), OTHER_GENERATION);
      expectGen = OTHER_GENERATION;
      const l2 = one(pre('Agent', {}, 'toolu_02'), { CCRC_SESSION_GENERATION: OTHER_GENERATION });
      expect(l2.parentIncarnation).toBe(OTHER_GENERATION);
      const all = rawLines().map((r) => JSON.parse(r));
      expect(all.map((l) => l.parentIncarnation), 'the older line still says which incarnation wrote it').toEqual([GENERATION, OTHER_GENERATION]);
      expect(validate(all[0], OWNER, GENERATION)).toEqual([]);
      expect(validate(all[0], OWNER, OTHER_GENERATION), 'and is NOT a line of the new incarnation').not.toEqual([]);
    });

    it('a pane that outlived its row (its environment generation is not the file\'s) records nothing', () => {
      fs.writeFileSync(genFile(), OTHER_GENERATION);
      expectGen = OTHER_GENERATION;
      none(pre('Agent', {}), { CCRC_SESSION_GENERATION: GENERATION });
    });

    it('a pane with no environment generation (a row minted after it spawned) is bound to the file\'s', () => {
      expect(one(pre('Agent', {}), { CCRC_SESSION_GENERATION: '' }).parentIncarnation).toBe(GENERATION);
    });

    it.each([
      ['absent', (): void => { fs.rmSync(genFile()); }],
      ['empty', (): void => { fs.writeFileSync(genFile(), ''); }],
      ['35 characters', (): void => { fs.writeFileSync(genFile(), GENERATION.slice(1)); }],
      ['a trailing LF (37 bytes)', (): void => { fs.writeFileSync(genFile(), `${GENERATION}\n`); }],
      ['uppercase', (): void => { fs.writeFileSync(genFile(), GENERATION.toUpperCase()); }],
      ['not hex', (): void => { fs.writeFileSync(genFile(), 'zzzzzzzz-1234-5678-9abc-0123456789ab'); }],
      ['dashes in the wrong places', (): void => { fs.writeFileSync(genFile(), '0189abcd12345678-9abc-0123456789ab----'.slice(0, 36)); }],
      ['a longer file whose first 36 bytes are valid', (): void => { fs.writeFileSync(genFile(), `${GENERATION}extra`); }],
      ['a symlink to a valid file', (): void => { const t = path.join(home, 'gen-target'); fs.writeFileSync(t, GENERATION); fs.rmSync(genFile()); fs.symlinkSync(t, genFile()); }],
      ['a directory', (): void => { fs.rmSync(genFile()); fs.mkdirSync(genFile()); }],
      ['unreadable', (): void => { fs.chmodSync(genFile(), 0o000); }],
    ])('a %s generation: exit 0, no line, nothing else disturbed', (label, breakIt) => {
      if (label === 'unreadable' && process.getuid?.() === 0) return;
      one(pre('Agent', {}, 'toolu_ctl'));        // control: with a sound generation this event is recorded
      const before = rawLines().length;
      breakIt();
      expect(run(pre('Agent', {}))).toEqual({ stdout: '', stderr: '' });
      expect(rawLines().length, 'and with a broken one it is not').toBe(before);
      expect(fs.existsSync(path.join(reg(), `${OWNER}.hookstate.json`)), 'the hookstate is a different file with a different rule').toBe(true);
    });

    it('a generation that CHANGES while the hook runs records nothing (the second read, just before the append, disagrees)', () => {
      // A jq stand-in that runs the real jq and then swaps the row's generation: the change lands between the line being built and written.
      one(pre('Agent', {}, 'toolu_ctl'));        // control: with the real jq the same event is recorded
      const flag = path.join(home, 'swapped');
      fs.writeFileSync(path.join(home, 'bin', 'jq'),
        `#!/bin/sh\n'${REAL_JQ}' "$@"\nrc=$?\nif [ ! -e '${flag}' ]; then : > '${flag}'; printf '%s' '${OTHER_GENERATION}' > '${genFile()}'; fi\nexit $rc\n`, { mode: 0o755 });
      expect(run(pre('Agent', {}))).toEqual({ stdout: '', stderr: '' });
      expect(fs.existsSync(flag), 'the swap happened').toBe(true);
      expect(rawLines(), 'only the control line is there').toHaveLength(1);
      // Control: now that the file is stable at the new value, the next event (carrying it) is recorded.
      expectGen = OTHER_GENERATION;
      expect(one(pre('Agent', {}, 'toolu_02'), { CCRC_SESSION_GENERATION: OTHER_GENERATION }).parentIncarnation).toBe(OTHER_GENERATION);
    });
  });

  // ── Step 4: append and prune ──
  describe('append: one complete line per write, from any number of hooks at once', () => {
    const racer = (payload: object): Promise<number | null> => new Promise((resolve, reject) => {
      const child = spawn('bash', [HOOK], { env: hookEnv() });
      child.on('error', reject);
      child.on('close', (code) => resolve(code));
      child.stdin.end(JSON.stringify(payload));
    });

    it('sixteen hooks at once, then sixteen again: every line is whole, valid, and present exactly once', async () => {
      for (let round = 0; round < 2; round += 1) {
        const ids = Array.from({ length: 16 }, (_, i) => `toolu_r${round}_${i}`);
        const codes = await Promise.all(ids.map((id) => racer(pre('Bash', { command: 'true' }, id))));
        expect(codes.every((c) => c === 0)).toBe(true);
      }
      const ls = lines();
      expect(ls).toHaveLength(32);
      for (const l of ls) expect(validate(l)).toEqual([]);
      expect(new Set(ls.map((l) => l.toolUseId)).size).toBe(32);
    }, 180_000);

    it('lines near the cap do not interleave: twelve hooks at once, each writing ~3.9 KiB', async () => {
      const filler = (n: number): string => '\u0001'.repeat(300).padEnd(300 + n, 'x');
      const ids = Array.from({ length: 12 }, (_, i) => `toolu_big${i}`);
      const codes = await Promise.all(ids.map((id, i) => racer(pre('Agent', {}, id, { cwd: `/${filler(i)}`, transcript_path: `/${filler(i)}` }))));
      expect(codes.every((c) => c === 0)).toBe(true);
      const raws = rawLines();
      expect(raws).toHaveLength(12);
      for (const raw of raws) { expect(bytes(raw) + 1).toBeLessThan(4096); expect(validate(JSON.parse(raw))).toEqual([]); }
      expect(new Set(raws.map((r) => JSON.parse(r).toolUseId)).size).toBe(12);
    }, 180_000);

    it('the bucket is named by the UTC hour of observedAt: YYYYMMDDHH.spool', () => {
      const l = one(pre('Agent', {}));
      expect(bucketFiles()).toEqual([`${l.observedAt.slice(0, 13).replace(/[-T]/g, '')}.spool`]);
    });

    it('a symlink or directory standing at the bucket\'s name is neither written through nor replaced', () => {
      const name = `${new Date().toISOString().slice(0, 13).replace(/[-T]/g, '')}.spool`;
      const target = path.join(home, 'elsewhere');
      fs.writeFileSync(target, 'untouched\n');
      fs.symlinkSync(target, path.join(ownerDir(), name));
      run(pre('Agent', {}));
      expect(fs.readFileSync(target, 'utf8')).toBe('untouched\n');
      fs.rmSync(path.join(ownerDir(), name));
      fs.mkdirSync(path.join(ownerDir(), name));
      expect(run(pre('Agent', {}))).toEqual({ stdout: '', stderr: '' });
      expect(fs.statSync(path.join(ownerDir(), name)).isDirectory()).toBe(true);
    });
  });

  describe('prune: the owner\'s buckets older than 24 hours, once an hour, inside its own directory (W3-M06)', () => {
    const NOW = Date.now();
    const bucket = (ms: number): string => `${new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, '')}`;
    const HOUR = 3_600_000;
    const plant = (dir: string, name: string, body = '{"old":1}\n'): string => { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
    const current = (): string => bucket(Date.now());
    const exists = (p: string): boolean => fs.existsSync(p);
    /** One delegation event through the hook. The planted buckets are not lines, so these rows read only the CURRENT bucket. */
    const hit = (id: string): void => { run(pre('Agent', {}, id)); };
    const curLines = (): any[] => {
      const f = path.join(ownerDir(), `${current()}.spool`);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    };

    it('a first write of the hour removes the owner\'s buckets from before the cutoff hour, and keeps the cutoff hour, younger ones and the current one', () => {
      const h = Date.now();
      const old1 = plant(ownerDir(), `${bucket(h - 25 * HOUR)}.spool`);
      const old2 = plant(ownerDir(), `${bucket(h - 30 * HOUR)}.spool`);
      const old3 = plant(ownerDir(), `${bucket(h - 24 * 24 * HOUR)}.spool`);
      const edge = plant(ownerDir(), `${bucket(h - 24 * HOUR)}.spool`);
      const young = plant(ownerDir(), `${bucket(h - 23 * HOUR)}.spool`);
      const recent = plant(ownerDir(), `${bucket(h - HOUR)}.spool`);
      hit('toolu_01');
      if (current() !== bucket(h)) return;            // the hour turned mid-test: the rows below would be measuring another cutoff
      expect(curLines().map((l) => validate(l)), 'the write that pruned is itself a line').toEqual([[]]);
      for (const p of [old1, old2, old3]) expect(exists(p), path.basename(p)).toBe(false);
      for (const p of [edge, young, recent]) expect(exists(p), `${path.basename(p)} is within 24 hours`).toBe(true);
      expect(bucketFiles()).toContain(`${current()}.spool`);
    });

    it('prune runs at most once per UTC hour: an old bucket planted AFTER the hour\'s first write survives the hour\'s later writes', () => {
      hit('toolu_01');
      const late = plant(ownerDir(), `${bucket(Date.now() - 48 * HOUR)}.spool`);
      hit('toolu_02');
      run(post('Bash', { command: 'true' }, { stdout: '' }, 'toolu_03'));
      if (bucket(Date.now()) !== bucket(NOW) && !exists(late)) return;     // the hour turned and the next hour's first write pruned it: legitimate
      expect(exists(late), 'the second and third writes of the hour did not prune').toBe(true);
      // The next hour's first write is the next prune: simulate it by taking the current bucket away.
      fs.rmSync(path.join(ownerDir(), `${current()}.spool`));
      hit('toolu_04');
      expect(exists(late), 'a first write of an hour prunes').toBe(false);
    });

    it('it removes only buckets: files that merely look alike, directories and symlinks stay', () => {
      const h = Date.now();
      const oldName = `${bucket(h - 40 * HOUR)}.spool`;
      const keep = [
        plant(ownerDir(), 'notes.txt'),
        plant(ownerDir(), '.hidden'),
        plant(ownerDir(), `${bucket(h - 40 * HOUR)}.spool.tmp`),
        plant(ownerDir(), `${bucket(h - 40 * HOUR).slice(0, 8)}.spool`),     // 8 digits
        plant(ownerDir(), `${bucket(h - 40 * HOUR)}0.spool`),                 // 11 digits
        plant(ownerDir(), `x${bucket(h - 40 * HOUR)}.spool`),
      ];
      const dirLike = path.join(ownerDir(), `${bucket(h - 41 * HOUR)}.spool`);
      fs.mkdirSync(dirLike);
      fs.writeFileSync(path.join(dirLike, 'inner'), 'x');
      const outside = plant(home, 'outside-file');
      fs.symlinkSync(outside, path.join(ownerDir(), `${bucket(h - 42 * HOUR)}.spool`));
      const real = plant(ownerDir(), oldName);
      hit('toolu_01');
      if (current() !== bucket(h)) return;
      expect(exists(real), 'the genuine old bucket went').toBe(false);
      for (const k of keep) expect(exists(k), path.basename(k)).toBe(true);
      expect(exists(path.join(dirLike, 'inner'))).toBe(true);
      expect(exists(outside), 'the symlink target').toBe(true);
      expect(fs.lstatSync(path.join(ownerDir(), `${bucket(h - 42 * HOUR)}.spool`)).isSymbolicLink(), 'and the link itself').toBe(true);
    });

    it('prune is contained: another owner\'s old buckets, the spool root, the delegation root, the registry and a sibling directory are untouched', () => {
      const h = Date.now();
      const oldName = `${bucket(h - 60 * HOUR)}.spool`;
      const others = [
        plant(ownerDir('other-owner'), oldName),
        plant(ownerDir(`${OWNER}-2`), oldName),
        plant(path.join(spoolBase(), 'spool'), oldName),
        plant(spoolBase(), oldName),
        plant(reg(), oldName),
        plant(path.join(ownerDir(), '..', '..', '..', '..', 'sibling'), oldName),
        plant(path.join(ownerDir(), 'nested'), oldName),
      ];
      const mine = plant(ownerDir(), oldName);
      hit('toolu_01');
      if (current() !== bucket(h)) return;
      expect(exists(mine), 'its own old bucket is gone').toBe(false);
      for (const o of others) expect(exists(o), path.relative(home, o)).toBe(true);
    });

    it('a symlinked owner directory is never pruned through', () => {
      const outside = path.join(home, 'outside-dir');
      const old = plant(outside, `${bucket(Date.now() - 60 * HOUR)}.spool`);
      fs.rmSync(ownerDir(), { recursive: true });
      fs.symlinkSync(outside, ownerDir());
      run(pre('Agent', {}));
      expect(exists(old)).toBe(true);
    });

    it('a prune that cannot remove anything never fails the hook or the write: the line is in and the old bucket is left', () => {
      const old = plant(ownerDir(), `${bucket(Date.now() - 60 * HOUR)}.spool`);
      fs.writeFileSync(path.join(home, 'bin', 'rm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      hit('toolu_01');
      expect(curLines().map((l) => l.toolUseId)).toEqual(['toolu_01']);
      expect(exists(old), 'rm failed, so the old bucket stays').toBe(true);
    });
  });

  // ── the prefilter's selectivity (review of Task 5: the unquoted form compiled the spool's jq for any text that mentioned a tool) ──
  describe('the spool\'s jq text is compiled only for a payload that quotes a delegation name', () => {
    /** The length of the program the FIRST jq call of one hook run compiled (the payload parse): a jq on PATH that records its
     *  arguments' lengths, then runs the real one. */
    const parseLength = (payload: object): number => {
      const log = path.join(home, 'jq-args');
      fs.rmSync(log, { force: true });
      fs.writeFileSync(path.join(home, 'bin', 'jq'),
        `#!/bin/sh\n[ -e '${log}.done' ] || { for a in "$@"; do printf '%s\\n' "\${#a}" >> '${log}'; done; : > '${log}.done'; }\nexec '${REAL_JQ}' "$@"\n`, { mode: 0o755 });
      fs.rmSync(`${log}.done`, { force: true });
      run(payload);
      return Math.max(...fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(Number));
    };
    const WORDS = 'Bash Task Agent Workflow SessionStart SessionEnd SubagentStart SubagentStop task-notification';
    it('text that merely mentions the names (a Read result, an Edit string, a prompt, even with quotes round them) compiles the parse alone', () => {
      const small = parseLength(post('Read', { file_path: '/x' }, { file: { content: WORDS } }));
      const quoted = parseLength(post('Edit', { file_path: '/x', new_string: `say "Bash" and "Agent" and "Workflow" and "SessionStart" and "SubagentStop"` }, 'ok'));   // quotes in a JSON string's content are \" , never a bare quote after the name
      const prompt = parseLength(ev('UserPromptSubmit', { prompt: `${WORDS} <task-notification> mentioned` }));
      const big = parseLength(post('Bash', { command: 'true' }, { stdout: '' }));
      expect(big, 'a Bash event compiles the spool text').toBeGreaterThan(5000);
      for (const [n, len] of [['Read', small], ['Edit with quoted names in its text', quoted], ['a prompt', prompt]] as const) {
        expect(len, `${n} compiles only the parse (${len} characters)`).toBeLessThan(2000);
      }
    });
    it('each delegation name, and a notification, in its real position does compile it', () => {
      for (const [n, payload] of [
        ['Agent', post('Agent', {}, { status: 'async_launched', agentId: 'a1' })], ['Task', pre('Task', {})], ['Workflow', pre('Workflow', {})],
        ['SessionStart', ev('SessionStart', { source: 'startup' })], ['SessionEnd', ev('SessionEnd', { reason: 'clear' })],
        ['SubagentStart', ev('SubagentStart', { agent_id: 'a1' })], ['SubagentStop', ev('SubagentStop', { agent_id: 'a1' })],
        ['a notification', ev('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>w</task-id>\n<tool-use-id>t</tool-use-id>\n<status>completed</status>\n</task-notification>' })],
      ] as Array<[string, object]>) expect(parseLength(payload), n).toBeGreaterThan(5000);
    });
  });

  // ── no extra forks ──
  describe('the append forks nothing the event did not already fork', () => {
    const EXTERNALS = ['jq', 'date', 'mkdir', 'find', 'git', 'ls', 'stat', 'sed', 'tr', 'cut', 'head', 'tail', 'grep', 'wc', 'sort', 'cat', 'mv', 'rm', 'touch', 'flock', 'mktemp', 'link', 'basename', 'dirname', 'readlink', 'realpath', 'awk'];
    const shims = (): (() => Record<string, number>) => {
      const log = path.join(home, 'forks');
      for (const t of EXTERNALS) {
        const real = spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
        if (!real) continue;
        fs.writeFileSync(path.join(home, 'bin', t), `#!/bin/sh\necho ${t} >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
      }
      return () => {
        const out: Record<string, number> = {};
        if (fs.existsSync(log)) for (const l of fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)) out[l] = (out[l] ?? 0) + 1;
        return out;
      };
    };
    const cases: Array<[string, () => object]> = [
      ['PostToolUse Bash', () => post('Bash', { command: 'true' }, { stdout: '' })],
      ['PreToolUse Bash that names a worktree', () => pre('Bash', { command: 'git worktree list' }, 'toolu_01', { cwd: path.join(home, 'repo') })],
      ['PreToolUse Agent', () => pre('Agent', { prompt: 'x' })],
      ['SubagentStart', () => ev('SubagentStart', { agent_id: 'a1', agent_type: 'general-purpose' })],
      ['UserPromptSubmit (a notification)', () => ev('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>w1</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n</task-notification>' })],
      ['SessionEnd', () => ev('SessionEnd', { reason: 'clear' })],
    ];
    it.each(cases)('%s: the same externals run whether the spool directory exists or not, so a line costs no fork', (n, mk) => {
      fs.mkdirSync(path.join(home, 'repo', '.git', 'worktrees', 'agent-a1'), { recursive: true });
      const counts = shims();
      const before = counts();
      run(mk());
      const withSpool = counts();
      expect(rawLines().length, 'the spool run wrote its line (anti-vacuity)').toBe(1);
      fs.rmSync(path.join(spoolBase()), { recursive: true });
      fs.rmSync(path.join(reg(), `${OWNER}.hookstate.json`), { force: true });
      fs.rmSync(path.join(reg(), `${OWNER}.turn.json`), { force: true });
      fs.rmSync(path.join(home, 'forks'));
      run(mk());
      const without = counts();
      expect(withSpool, `${n}: with a line`).toEqual(without);
      expect(before).toEqual({});
      expect(withSpool['jq'] ?? 0, 'the parse jq is the only payload-reading jq on this path').toBeGreaterThanOrEqual(1);
      for (const t of ['date', 'mkdir', 'git', 'find', 'ls', 'stat', 'sed', 'tr', 'cut', 'head', 'tail', 'grep', 'wc', 'sort', 'link', 'touch', 'basename', 'dirname', 'readlink', 'realpath', 'awk']) {
        expect(withSpool[t] ?? 0, `${n}: no ${t}`).toBe(0);
      }
    });
  });
});
