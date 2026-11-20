// server/test/ccrc-doctor-model-advance.test.ts — the four model-advance doctor checks (auto-advance spec §2.8; plan
// W3 Task 15, re-planned 2026-11-16 as D-8689), in the split doctor files' naming: `model-advance-held-back`,
// `model-held-behind`, `model-sessions-behind` and `model-advance-blocked`. Each runs as `cmd_doctor` runs it: `ccd/ccrc`
// sourced, `ccrc-doctor-checks` sourced beside it, then the one `_check_<name>`, against fixture files read through
// the real `deploy/models-op.mjs advance-health`.
//
// CONTAINED. HOME is a `mkTmp` directory with a deployed box's shape (`<home>/ccrc/ccd/ccrc`, with `deploy` and
// `shared` beside it); `ghContainedEnv` poisons gh and the service managers; and `_svc_is_active`, the one question
// these checks ask a service manager, is redefined to answer from `<home>/svc/<unit>` and to record every unit it is
// asked about. Nothing here reaches tmux, the live `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@` unit.
// Fixture lanes are `lane-a` (codex-kind) and `lane-b` (external-kind, or codex-kind where a case says so); every
// model id is neutral.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { ccdSource, ghContainedEnv } from './ccdWsHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { STEP_CATALOGUE, STEP_REGISTRY, stepAdvance, stepRoster } from './fixtures/advanceCases.js';
import { seedAnthropicAdvance, serializeAdvance } from '../../shared/model-advance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const CHECKS = ['model-advance-held-back', 'model-held-behind', 'model-sessions-behind', 'model-advance-blocked'] as const;
type Check = typeof CHECKS[number];

const NOW = '2026-10-23T09:00:00Z';
const MOVED = '2026-10-21T14:05:11Z';
const TURN = '2026-10-22T09:11:40Z';
const RENDER = '2026-10-22T09:12:03Z';
const SID = 'lane-a-demo';
const LANE_A = { proxyPort: 45050, litellmPort: 45051, authDir: codexAuthDir('lane-a') };
const LANE_B = { proxyPort: 45052, litellmPort: 45053, authDir: codexAuthDir('lane-b') };
type Json = Record<string, unknown>;

const homes: string[] = [];
afterEach(() => { for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }); });

/** A box: `ccd/ccrc`, its check table and the wrapper-shape contract linked one by one, and `deploy` and `shared`
 *  linked whole (node resolves models-op's imports from their real path, this checkout's), then the roster.
 *  `laneB` makes lane-b codex-kind too; `stuckOp` puts a real `deploy/` in place whose `models-op.mjs` never answers,
 *  and `opScript` one whose `models-op.mjs` is that script (an op that answers what a case needs). */
function box(o: { laneB?: boolean; stuckOp?: boolean; opScript?: string } = {}): string {
  const h = mkTmp('doctor-model-advance-');
  homes.push(h);
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-doctor-checks', 'ccrc-wrapper-shape']) fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  if (o.stuckOp || o.opScript !== undefined) {
    fs.mkdirSync(join(h, 'ccrc', 'deploy'));
    fs.writeFileSync(join(h, 'ccrc', 'deploy', 'models-op.mjs'), o.opScript ?? 'setTimeout(() => {}, 120_000);\n');
  } else {
    fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  }
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'),
    `${JSON.stringify(stepRoster(LANE_A, o.laneB ? LANE_B : undefined), null, 2)}\n`);
  return h;
}

/** One lane's model files, as their writers leave them. `null` leaves that file absent. */
function plantLane(h: string, o: { id?: string; registry?: Json | null; catalogue?: Json | null; advance?: Json | null } = {}): void {
  const id = o.id ?? 'lane-a';
  const dir = join(h, '.ccrc', 'models');
  if (o.registry === null) fs.rmSync(join(dir, `${id}.classes.json`), { force: true });
  else fs.writeFileSync(join(dir, `${id}.classes.json`), `${JSON.stringify(o.registry ?? STEP_REGISTRY, null, 2)}\n`, { mode: 0o600 });
  if (o.catalogue !== null) fs.writeFileSync(join(dir, `${id}.json`), JSON.stringify(o.catalogue ?? STEP_CATALOGUE));
  if (o.advance !== null) {
    fs.writeFileSync(join(dir, `${id}.advance.json`), `${JSON.stringify(o.advance ?? stepAdvance(), null, 2)}\n`, { mode: 0o600 });
  }
}

/** lane-a after one advance: opus moved from model-5.6-gamma to model-6.1-gamma at MOVED. */
const MOVED_REGISTRY = { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
  effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } };
const MOVE = { at: MOVED, how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: true, canary: 'passed',
  effort: { from: 'max', to: 'xhigh' } };
const MOVED_ADVANCE = stepAdvance({ opus: { previous: { model: 'model-5.6-gamma', effort: 'max' }, history: [MOVE] } });
/** A failed advance of opus to its standing candidate, its canary refused three times. */
const failed = (o: Json = {}): Json => ({ at: '2026-10-22T10:05:12Z', how: 'advance', from: 'model-5.6-gamma',
  to: 'model-6.1-gamma', ok: false, canary: 'failed', reason: 'http 500: upstream error', tries: 3,
  lastAt: '2026-10-22T12:05:09Z', ...o });
const HOLD = { at: '2026-10-22T08:00:00Z', by: 'hand' };

/** One session's registry row, turn marker and usage sidecar. `svc` is the word the service manager answers for its
 *  unit (default `active`); `null` leaves it unanswered. `sidecar: false` writes no usage sidecar (a home whose
 *  status line writes none). */
function plantSession(h: string,
  o: { sid?: string; lane?: string; model?: string; svc?: string | null; sidecar?: boolean } = {}): void {
  const sid = o.sid ?? SID;
  const reg = join(h, '.cc-sessions');
  fs.mkdirSync(join(reg, 'usage'), { recursive: true });
  fs.writeFileSync(join(reg, `${sid}.wrapper`), o.lane ?? 'lane-a');
  const turnAt = Date.parse(TURN);
  fs.writeFileSync(join(reg, `${sid}.turn.json`), `${JSON.stringify({ v: 1, sessionId: `uuid-${sid}`, state: 'done',
    event: 'Stop', at: turnAt + 30_000, turnAt, stopAt: turnAt + 30_000, bg: -1, bgKinds: '', bgIds: '', err: null,
    restartAt: null, lostBg: 0, lostKinds: '', lostIds: '' })}\n`);
  if (o.sidecar !== false) {
    fs.writeFileSync(join(reg, 'usage', `${sid}.json`), `${JSON.stringify({ ts: Date.parse(RENDER) / 1000,
      uuid: `uuid-${sid}`, account: o.lane ?? 'lane-a', model: o.model ?? 'model-5.6-gamma', effort: 'low', ctxPct: 12,
      cost: 0.1, agent: null })}\n`);
  }
  if (o.svc === null) return;
  fs.mkdirSync(join(h, 'svc'), { recursive: true });
  fs.writeFileSync(join(h, 'svc', `claude-session@${sid}.service`), `${o.svc ?? 'active'}\n`);
}

/** `_svc_is_active`, redefined after the library is sourced: it answers the word in `<home>/svc/<unit>` (nothing
 *  when there is none: the manager did not answer) and appends every unit it is asked about to `<home>/svc-asked`.
 *  Builtins only. */
const SVC_FAKE = [
  '_svc_is_active() {',
  '  local w=""',
  '  printf \'%s\\n\' "$1" >> "$HOME/svc-asked"',
  '  if [ -f "$HOME/svc/$1" ]; then IFS= read -r w < "$HOME/svc/$1" || :; fi',
  '  printf \'%s\' "$w"',
  '}',
].join('\n');

interface Run { code: number; out: string; err: string; ms: number }
/** One check, as `cmd_doctor` runs it. A runner's own knobs never steer a case; `CCRC_MODELS_NOW` fixes the op's
 *  clock. Ended at 30 s, in a process group of its own (`spawnSyncGroup`), so a check that hangs reds its case, never
 *  the suite, and takes its children with it; a timeout comes back as `error` (ETIMEDOUT). */
function check(h: string, name: Check, extra: NodeJS.ProcessEnv = {}, o: { pre?: string; noJq?: boolean } = {}): Run {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['CCRC_MODELS_NOW', 'CCRC_DOCTOR_GH_TIMEOUT', 'CCRC_MODELS_LOCK_S', 'CCRC_ROLE', 'CCD_TIMEOUT_KILL_AFTER']) {
    delete inherited[k];
  }
  const env: NodeJS.ProcessEnv = { ...ghContainedEnv(h, { ...inherited, HOME: h }, { systemd: true }), CCRC_MODELS_NOW: NOW,
    ...extra };
  if (o.noJq) env['PATH'] = pathWithoutJq(h, env['PATH'] ?? '');
  const script = ['umask 022', `. "${join(h, 'ccrc', 'ccd', 'ccrc')}"`, '. "$CCRC_HERE/ccrc-doctor-checks"', SVC_FAKE,
    ...(o.pre === undefined ? [] : [o.pre]), `_check_${name}`].join('\n');
  const t0 = Date.now();
  const r = spawnSyncGroup(BASH, ['-c', script], { env, encoding: 'utf8', input: '', timeout: 30_000 });
  expect(r.error, `_check_${name} was ended at the suite's 30 s bound`).toBeUndefined();
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '', ms: Date.now() - t0 };
}
/** PATH as one directory of links to every program `path` finds, first one winning as PATH's own order does, but no
 *  `jq`: the same box with jq absent, and nothing else moved. */
function pathWithoutJq(h: string, pathVar: string): string {
  const farm = join(h, 'no-jq-bin');
  fs.mkdirSync(farm);
  const seen = new Set<string>(['jq']);
  for (const d of pathVar.split(':').filter(Boolean)) {
    let names: string[];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      fs.symlinkSync(join(d, n), join(farm, n));
    }
  }
  return farm;
}
const asked = (h: string): string[] => {
  const p = join(h, 'svc-asked');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** The table line D-8689 places the four names on, exactly: after `history`, before `secrets-backup-excluded`. */
const TABLE_LINE = '  models codex docs history model-advance-held-back model-held-behind model-sessions-behind '
  + 'model-advance-blocked secrets-backup-excluded filevault snapshot-posture delegation-hooks update-sweep docs-sw   '
  + '# fourteen entries on one line: every line below is cited by number elsewhere; docs-sw stays LAST (M7.6), '
  + 'update-sweep and delegation-hooks before it, each pinned, and the three backups checks before delegation-hooks, '
  + 'pinned; the four model-advance checks (D-8689) follow history, and their functions are at the very END of this '
  + 'file; _check_delegation-hooks and then _check_update-sweep are near the END of this file, and the three backups '
  + 'checks (A11b) after them';

describe('the table and the one call (plan W3 Task 15; D-8689)', () => {
  it('the table carries the four names after history, in place, and their functions are the last four in the file', () => {
    const lines = fs.readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8').split('\n');
    const table = lines.filter((l) => l.startsWith('  models codex docs history '));
    expect(table).toEqual([TABLE_LINE]);
    const fns = lines.map((l) => /^_check_([A-Za-z0-9_-]+)\(\) \{$/.exec(l)?.[1]).filter((n): n is string => n !== undefined);
    expect(fns.slice(-4)).toEqual([...CHECKS]);
  });

  it('the doctor reaches models-op through ccrc\'s own _models_node in a bounded child, with advance-health alone, a read-only op', () => {
    const code = fs.readFileSync(join(REPO, 'ccd', 'ccrc-doctor-checks'), 'utf8').split('\n')
      .filter((l) => !l.trim().startsWith('#'));
    const at = code.map((l, i) => (l.includes('declare -f _models_node') ? i : -1)).filter((i) => i >= 0);
    expect(at).toHaveLength(1);
    expect(code[at[0]! + 1]).toMatch(/^_models_node "\$@"' _dr_ma_read advance-health --file "\$\(_models_roster_path\)" --reg "\$_SVC_REG" --lock-template "\$lt"/);
    const text = code.join('\n');
    expect(text).toContain('lt="$(_models_lock_path \'{id}\')"');
    // No other child `_models_node` is handed an op word: advance-health is the one op this file starts.
    expect([...text.matchAll(/_models_node "\$@"'\s+\S+\s+([a-z][a-z-]*)/g)].map((m) => m[1])).toEqual(['advance-health']);
    const op = fs.readFileSync(join(REPO, 'deploy', 'models-op.mjs'), 'utf8');
    expect(op).toMatch(/^ {2}'advance-health': \{[^\n]*\bwrites: false\b[^\n]*\},$/m);
  });
});

describe('model-advance-held-back', () => {
  it('WARNs a class whose failed advance stands, with its exact line and one remedy, and PASSes once an advance succeeds', () => {
    const h = box();
    plantLane(h, { advance: stepAdvance({ opus: { history: [failed()] } }) });
    const r = check(h, 'model-advance-held-back');
    expect(r.out).toBe('WARN model-advance-held-back: lane-a opus stays on model-5.6-gamma: model-6.1-gamma failed its '
      + 'canary 3 times since 2026-10-22T10:05Z (http 500: upstream error)\n'
      + '  remedy: the next hourly refresh retries it; \'ccrc models lane-a show\' shows the class, and '
      + '\'ccrc models lane-a hold opus\' stops the retries\n');
    expect(r.code).toBe(2);
    plantLane(h, { registry: MOVED_REGISTRY, advance: stepAdvance({ opus: {
      previous: { model: 'model-5.6-gamma', effort: 'max' }, history: [failed(), { ...MOVE, at: '2026-10-22T13:05:10Z' }] } }) });
    const p = check(h, 'model-advance-held-back');
    expect(p.out).toBe('PASS model-advance-held-back: 1 lane(s) with a model registry or an aliases file: no class is held back by a '
      + 'failed canary or move\n');
    expect(p.code).toBe(0);
  });

  it('says "once" for one try, and names a move that failed after its canary passed', () => {
    const h = box();
    plantLane(h, { advance: stepAdvance({ opus: { history: [failed({ canary: 'passed', tries: 1, reason: 'materialise: EISDIR' })] } }) });
    expect(check(h, 'model-advance-held-back').out.split('\n')[0]).toBe('WARN model-advance-held-back: lane-a opus stays on '
      + 'model-5.6-gamma: moving to model-6.1-gamma failed once, at 2026-10-22T10:05Z (materialise: EISDIR)');
  });

  it('two classes of one lane share one line, and one remedy naming both', () => {
    const h = box();
    plantLane(h, {
      registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, haiku: 'model-5.6-alpha' } },
      advance: stepAdvance({ haiku: { history: [failed({ from: 'model-5.6-alpha', to: 'model-6-alpha', tries: 1 })] },
        opus: { history: [failed()] } }),
    });
    const r = check(h, 'model-advance-held-back');
    expect(r.out).toBe('WARN model-advance-held-back: lane-a haiku stays on model-5.6-alpha: model-6-alpha failed its '
      + 'canary once, at 2026-10-22T10:05Z (http 500: upstream error); lane-a opus stays on model-5.6-gamma: '
      + 'model-6.1-gamma failed its canary 3 times since 2026-10-22T10:05Z (http 500: upstream error)\n'
      + '  remedy: the next hourly refresh retries each; \'ccrc models lane-a show\' shows the classes, and '
      + '\'ccrc models lane-a hold <class>\' stops a class\'s retries (haiku, opus)\n');
  });

  it('two lanes give two WARN lines, each with its own remedy', () => {
    const h = box({ laneB: true });
    plantLane(h, { advance: stepAdvance({ opus: { history: [failed()] } }) });
    plantLane(h, { id: 'lane-b', advance: stepAdvance({ opus: { history: [failed()] } }) });
    const lines = check(h, 'model-advance-held-back').out.split('\n').filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^WARN model-advance-held-back: lane-a opus stays on model-5\.6-gamma: /);
    expect(lines[1]).toMatch(/^ {2}remedy: the next hourly refresh retries it; .*'ccrc models lane-a hold opus'/);
    expect(lines[2]).toMatch(/^WARN model-advance-held-back: lane-b opus stays on model-5\.6-gamma: /);
    expect(lines[3]).toMatch(/^ {2}remedy: the next hourly refresh retries it; .*'ccrc models lane-b hold opus'/);
  });

  it('a held class is not held back: it is model-held-behind\'s (D-5221)', () => {
    const h = box();
    plantLane(h, { advance: stepAdvance({ opus: { hold: HOLD, history: [failed()] } }) });
    expect(check(h, 'model-advance-held-back').out).toMatch(/^PASS model-advance-held-back: /);
    expect(check(h, 'model-held-behind').out).toMatch(/^WARN model-held-behind: lane-a opus is held /);
  });
});

describe('model-held-behind', () => {
  it('WARNs a held class with a newer model in its family, with its exact line and one remedy, and PASSes once released', () => {
    const h = box();
    plantLane(h, { advance: stepAdvance({ opus: { hold: HOLD } }) });
    const r = check(h, 'model-held-behind');
    expect(r.out).toBe('WARN model-held-behind: lane-a opus is held (2026-10-22T08:00Z, by hand) while model-6.1-gamma '
      + 'is newer in its family\n'
      + '  remedy: \'ccrc models lane-a release opus\' lets the next hourly refresh advance it, canary first\n');
    expect(r.code).toBe(2);
    plantLane(h, { advance: stepAdvance() });
    expect(check(h, 'model-held-behind').out).toBe('PASS model-held-behind: 1 lane(s) with a model registry or an aliases file: no held '
      + 'class has a newer model in its family\n');
  });

  it('an empty class held by a revert is behind the newest model of its stored family', () => {
    const h = box();
    plantLane(h, { advance: stepAdvance({ fable: { family: 'delta', hold: { at: '2026-10-22T08:00:00Z', by: 'revert' } } }) });
    expect(check(h, 'model-held-behind').out.split('\n')[0]).toBe('WARN model-held-behind: lane-a fable is held '
      + '(2026-10-22T08:00Z, by revert) while model-6-delta is newer in its family');
  });

  it('a held class whose pin has left the catalogue says so, and never calls an older fallback newer', () => {
    const h = box();
    plantLane(h, { registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-7-gamma' } },
      advance: stepAdvance({ opus: { hold: HOLD } }) });
    expect(check(h, 'model-held-behind').out.split('\n')[0]).toBe('WARN model-held-behind: lane-a opus is held '
      + '(2026-10-22T08:00Z, by hand) on model-7-gamma, which has left the catalogue; model-6.1-gamma is the newest '
      + 'left in its family');
  });
});

describe('model-sessions-behind', () => {
  const RELAUNCH = '  remedy: a running session does not always pick up a re-pin by itself: once it is idle, relaunch it '
    + 'with \'ccd stop lane-a-demo\' then \'ccd start lane-a-demo\'; it resumes its conversation, and one with no class '
    + 'in its routing record may come back on its old model';
  const BEHIND_DEMO = 'WARN model-sessions-behind: lane-a session lane-a-demo last replied on model-5.6-gamma at '
    + '2026-10-22T09:12Z, in a turn begun 2026-10-22T09:11Z, after opus moved to model-6.1-gamma 42 h ago';

  it('WARNs a running session still on the replaced model, naming the evidence, and PASSes once it renders the new one', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h);
    const r = check(h, 'model-sessions-behind');
    expect(r.out).toBe(`${BEHIND_DEMO}\n${RELAUNCH}\n`);
    expect(r.code).toBe(2);
    plantSession(h, { model: 'model-6.1-gamma' });
    expect(check(h, 'model-sessions-behind').out).toBe('PASS model-sessions-behind: 1 lane(s) with a model registry or an aliases file: no '
      + 'running session is still on a model a move replaced 24 h or more ago\n');
  });

  it('asks the service manager only about the sessions the op listed, and nothing when it listed none', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h, { sid: 'lane-a-new', model: 'model-6.1-gamma' });
    check(h, 'model-sessions-behind');
    expect(asked(h)).toEqual([]);
    plantSession(h);
    check(h, 'model-sessions-behind');
    expect(asked(h)).toEqual(['claude-session@lane-a-demo.service']);
  });

  it('two running sessions behind on one lane share one line, and one remedy naming both', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h);
    plantSession(h, { sid: 'lane-a-two' });
    const lines = check(h, 'model-sessions-behind').out.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('lane-a session lane-a-demo last replied on model-5.6-gamma');
    expect(lines[0]).toContain('; lane-a session lane-a-two last replied on model-5.6-gamma');
    expect(lines[1]).toBe('  remedy: a running session does not always pick up a re-pin by itself: once each is idle, '
      + 'relaunch it with \'ccd stop <id>\' then \'ccd start <id>\' (lane-a-demo, lane-a-two); each resumes its '
      + 'conversation, and one with no class in its routing record may come back on its old model');
  });

  it.each([
    ['not running', 'inactive', '; 1 listed session(s) not running'],
    ['not reported by the service manager', null, '; 1 listed session(s) whose state the service manager did not report'],
  ] as [string, string | null, string][])('a listed session %s does not WARN, and the PASS counts it', (_w, svc, tail) => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h, { svc });
    expect(check(h, 'model-sessions-behind').out).toBe('PASS model-sessions-behind: 1 lane(s) with a model registry or an aliases file: no '
      + `running session is still on a model a move replaced 24 h or more ago${tail}\n`);
  });

  it('the PASS names the sessions it could not measure, by why: a PASS never stands over sessions nobody read', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h, { sidecar: false });
    expect(spawnSync('mkfifo', [join(h, '.cc-sessions', 'lane-a-x.wrapper')]).status).toBe(0);
    expect(check(h, 'model-sessions-behind').out).toBe('PASS model-sessions-behind: 1 lane(s) with a model registry or an aliases file: no '
      + 'running session is still on a model a move replaced 24 h or more ago; 2 session(s) could not be measured '
      + '(sidecar-absent 1, wrapper-unreadable 1)\n');
    expect(asked(h)).toEqual([]);
  });

  it('a WARN line carries the same box-wide counts: sessions not running and sessions not measured are never dropped', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h);
    plantSession(h, { sid: 'lane-a-two', svc: 'inactive' });
    plantSession(h, { sid: 'lane-a-new', sidecar: false });
    expect(check(h, 'model-sessions-behind').out).toBe(`${BEHIND_DEMO}; 1 listed session(s) not running; 1 session(s) `
      + `could not be measured (sidecar-absent 1)\n${RELAUNCH}\n`);
  });

  // R2 review spec-3: the in-loop WARN (every lane but the last) carries the box-wide tail too (D-5220).
  it('two lanes WARN on two lines, and each line carries the same box-wide tail', () => {
    const h = box({ laneB: true });
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantLane(h, { id: 'lane-b', registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h);
    plantSession(h, { sid: 'lane-b-demo', lane: 'lane-b' });
    plantSession(h, { sid: 'lane-a-two', svc: 'inactive' });
    const TAIL = '; 1 listed session(s) not running';
    const lines = check(h, 'model-sessions-behind').out.split('\n').filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(`${BEHIND_DEMO}${TAIL}`);
    expect(lines[1]).toBe(RELAUNCH);
    expect(lines[2]).toBe('WARN model-sessions-behind: lane-b session lane-b-demo last replied on model-5.6-gamma at '
      + `2026-10-22T09:12Z, in a turn begun 2026-10-22T09:11Z, after opus moved to model-6.1-gamma 42 h ago${TAIL}`);
    expect(lines[3]).toMatch(/'ccd stop lane-b-demo' then 'ccd start lane-b-demo'/);
  });

  it('the remedy says a running session does not always pick up a re-pin by itself, and names the relaunch ccd has (D-5223)', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h);
    expect(check(h, 'model-sessions-behind').out.split('\n')[1]).toBe(RELAUNCH);
    // ccd is read through ccdSource() (ccdWsHelpers.ts), which splices in its libraries (`ccd-lib-load.test.ts`).
    const ccd = ccdSource();
    expect(ccd).toMatch(/^ {2}stop\)\s+shift; cmd_stop "\$@" ;;$/m);
    expect(ccd).toMatch(/^ {2}start\)\s+shift; cmd_start "\$@" ;;$/m);
    expect(ccd).not.toMatch(/^ {2}restart\)/m);
  });

  it('SKIPs when the session registry is absent, and when it cannot be listed', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    const reg = join(h, '.cc-sessions');
    const a = check(h, 'model-sessions-behind');
    expect(a.out).toBe(`SKIP model-sessions-behind: no session registry at ${reg}, so there is no running session to measure\n`);
    expect(a.code).toBe(3);
    fs.writeFileSync(reg, 'not a directory\n');
    expect(check(h, 'model-sessions-behind').out).toBe(`SKIP model-sessions-behind: the session registry at ${reg} could not `
      + 'be listed, so no session was measured\n');
  });
});

describe('model-advance-blocked', () => {
  it('WARNs each lane with its causes and one remedy clause per cause, and PASSes once they are gone', () => {
    const h = box();
    plantLane(h, { registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, haiku: 'model-y-alpha', opus: 'model-x-gamma' } } });
    plantLane(h, { id: 'lane-b' });
    const r = check(h, 'model-advance-blocked');
    expect(r.out).toBe('WARN model-advance-blocked: lane-a haiku: pin-grammar (model-y-alpha is not '
      + '<vendor>-<version>-<family>); lane-a opus: pin-grammar (model-x-gamma is not <vendor>-<version>-<family>)\n'
      + '  remedy: per cause: pin — \'ccrc models lane-a set-class <class> <modelId>\'\n'
      + 'WARN model-advance-blocked: lane-b: lane-not-codex-kind (its roster row is exec.kind "external", and only an '
      + 'exec.kind "codex" lane advances)\n'
      + '  remedy: per cause: lane kind — make its roster row exec.kind "codex" (README, "A ChatGPT/Codex lane"), or '
      + 'leave it, and it never advances\n');
    expect(r.code).toBe(2);
    plantLane(h);
    plantLane(h, { id: 'lane-b', registry: null, catalogue: null, advance: null });
    expect(check(h, 'model-advance-blocked').out).toBe('PASS model-advance-blocked: 1 lane(s) with a model registry or an aliases file: '
      + 'nothing blocks an advance\n');
  });

  it('names a lock path that is a FIFO without opening it, beside a class\'s cause, with a clause for each (D-5193)', () => {
    const h = box();
    plantLane(h, { registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-x-gamma' } } });
    const locks = join(h, '.ccrc', 'locks');
    fs.mkdirSync(locks, { mode: 0o700 });
    const fifo = join(locks, 'models-lane-a.lock');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const r = check(h, 'model-advance-blocked');
    expect(r.out).toBe(`WARN model-advance-blocked: lane-a: lock-unwritable (${fifo} is not a regular file (a FIFO, a `
      + 'directory or a socket), which the lane-files lock never opens); lane-a opus: pin-grammar (model-x-gamma is not '
      + '<vendor>-<version>-<family>)\n'
      + '  remedy: per cause: lock — at the path the finding names: remove a symlink, a FIFO, or whatever stands where '
      + 'the lock file or its directory belongs; make a lock file this account cannot write writable, or remove it; '
      + 'give a lock directory another account owns back to this account; a lock directory this account owns is made '
      + '0700 by the next writer (\'chmod 700\' clears this now); pin — \'ccrc models lane-a set-class <class> '
      + '<modelId>\'\n');
    expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
  });

  // R2 review tests-2: a detail carries file text (a registry's unknown field is echoed as written), so `clean`
  // turns each control character into a space: a newline or a field separator in it never forges a row or a line.
  it('a control character in a finding is a space: one WARN line, never a forged row', () => {
    const h = box();
    plantLane(h, { registry: { ...STEP_REGISTRY, 'bad\nfie\u001fld': 1 } });
    const lines = check(h, 'model-advance-blocked').out.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^WARN model-advance-blocked: lane-a: registry-invalid \(unknown field "bad fie ld" in the class registry\. /);
    expect(lines[1]).toMatch(/^ {2}remedy: per cause: registry — /);
  });

  it('the advance-file clause never says rm, and warns that a removed file refills an emptied class', () => {
    const h = box();
    plantLane(h, { advance: null });
    fs.mkdirSync(join(h, '.ccrc', 'models', 'lane-a.advance.json'));
    expect(check(h, 'model-advance-blocked').out.split('\n')[1]).toBe('  remedy: per cause: advance file — repair the '
      + 'file the finding names; if you remove it instead, its holds and move history are lost and the next hourly '
      + 'refresh seeds every empty class again and fills it, so run \'ccrc models lane-a hold <class>\' at once for '
      + 'each class that must stay where it is');
  });
});

describe('the four checks SKIP when there is nothing to measure', () => {
  it.each([...CHECKS])('%s SKIPs on a server-role box', (name) => {
    const h = box();
    plantLane(h, { advance: stepAdvance({ opus: { hold: HOLD, history: [failed()] } }) });
    fs.writeFileSync(join(h, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const r = check(h, name);
    expect(r.out).toBe(`SKIP ${name}: this box records CCRC_ROLE=server, so it runs no lane and keeps no model class\n`);
    expect(r.code).toBe(3);
  });

  it.each([...CHECKS])('%s SKIPs on a box where no lane has a model registry', (name) => {
    const r = check(box(), name);
    expect(r.out).toBe(`SKIP ${name}: no lane on this box has a model registry or an aliases file, so no class can advance\n`);
    expect(r.code).toBe(3);
  });

  it('a refusal is a SKIP naming its word', () => {
    const h = box();
    fs.rmSync(join(h, '.ccrc', 'accounts.json'));
    expect(check(h, 'model-advance-blocked').out).toBe('SKIP model-advance-blocked: deploy/models-op.mjs advance-health '
      + 'refused (roster-absent), so no lane\'s advance state was read — the \'models\' check above owns the roster\n');
  });

  // R2 review tests-3: each of _dr_ma_read's own SKIPs and its one FAIL, and each check's own shape SKIP.
  it('an op that crashes or prints no JSON is a SKIP naming its exit status', () => {
    const r = check(box({ opScript: 'process.stdout.write("not an answer\\n"); process.exit(1);\n' }), 'model-advance-blocked');
    expect(r.out).toBe('SKIP model-advance-blocked: deploy/models-op.mjs advance-health printed no answer (exit 1), so '
      + 'no lane\'s advance state was read\n');
    expect(r.code).toBe(3);
  });

  it('an answer in a shape the read does not know is a SKIP, never a box with no lane', () => {
    const r = check(box({ opScript: 'process.stdout.write(\'{"ok":true}\\n\');\n' }), 'model-advance-blocked');
    expect(r.out).toBe('SKIP model-advance-blocked: deploy/models-op.mjs advance-health answered in a shape this check '
      + 'does not read, so no lane\'s advance state was read\n');
    expect(r.code).toBe(3);
  });

  // Each lane entry lacks exactly the one list that read iterates, so each guard is the only one that can SKIP it.
  const ALL_LISTS = { heldBack: [], heldBehind: [], blocked: [], sessionsBehind: [], sessionsUnmeasured: [] };
  const without = (k: keyof typeof ALL_LISTS): Json => {
    const lane: Json = { id: 'lane-a', ...ALL_LISTS };
    delete lane[k];
    return lane;
  };
  it.each([
    ['model-advance-held-back', 'heldBack'], ['model-held-behind', 'heldBehind'], ['model-advance-blocked', 'blocked'],
    ['model-sessions-behind', 'sessionsBehind'], ['model-sessions-behind', 'sessionsUnmeasured'],
  ] as [Check, keyof typeof ALL_LISTS][])('%s SKIPs a lane entry with no %s list, never a PASS', (name, list) => {
    const answer = { ok: true, op: 'advance-health', now: NOW, sessions: 'read', sessionsUnmeasured: [], lanes: [without(list)] };
    const r = check(box({ opScript: `process.stdout.write(${JSON.stringify(`${JSON.stringify(answer)}\n`)});\n` }), name);
    const what = name === 'model-sessions-behind' ? 'no session was measured' : 'no lane\'s advance state was read';
    expect(r.out).toBe(`SKIP ${name}: deploy/models-op.mjs advance-health answered in a shape this check does not read, `
      + `so ${what}\n`);
    expect(r.code).toBe(3);
  });

  it('with no jq on PATH it SKIPs, and names the check that owns jq', () => {
    const h = box();
    plantLane(h);
    const r = check(h, 'model-advance-blocked', {}, { noJq: true });
    expect(r.out).toBe('SKIP model-advance-blocked: jq is not on PATH, so deploy/models-op.mjs\'s advance-health answer '
      + 'could not be read — the \'jq\' check above owns that\n');
    expect(r.code).toBe(3);
  });

  it('sourced without ccrc\'s own library it FAILs, the block\'s one FAIL', () => {
    const h = box();
    plantLane(h);
    const r = check(h, 'model-advance-blocked', {}, { pre: 'unset -f _models_node' });
    expect(r.out.split('\n')[0]).toBe('FAIL model-advance-blocked: ccrc\'s own library is not loaded (_models_node, '
      + 'CCRC_HERE or _SVC_REG is missing), so no lane\'s advance state was read');
    expect(r.code).toBe(1);
  });

  it('an answer that never comes is a SKIP within the bound (D-5224)', () => {
    const r = check(box({ stuckOp: true }), 'model-advance-blocked', { CCRC_DOCTOR_GH_TIMEOUT: '1' });
    expect(r.out).toBe('SKIP model-advance-blocked: deploy/models-op.mjs advance-health gave no answer within 1s, so '
      + 'no lane\'s advance state was read\n');
    expect(r.code).toBe(3);
    expect(r.ms).toBeLessThan(15_000);
  });
});

// ── an Anthropic lane (model-class Anthropic arm A2.5; D-8744, D-8747) ───────────────────────────────────────────────
// The fixture roster's `lane-c` is a generated, `telemetry: anthropic` lane. Its aliases file and advance file are
// written by the REAL `aliases-refresh`, `hold`, `release` and `revert` ops from a copy of the synthetic catalogue-cache
// fixture, never by hand (the few cases that edit the file say so), and a session's files by `plantAnthropicSession`.
// Times are whole seconds and every one is before NOW, so a cache is never stale unless a case makes it so.
describe('an Anthropic lane (model-class Anthropic arm A2.5)', () => {
  const AL = 'lane-c';
  const ASUFFIX = '.claude-lane-c';
  const ASID = 'lane-c-demo';
  const X0 = 'claude-opus-9-0';
  const X1 = 'claude-opus-9-1';
  const X2 = 'claude-opus-9-2';
  const S1 = 'claude-sonnet-9-1';
  const S2 = 'claude-sonnet-9-2';
  const C1 = '2026-10-18T00:00:00Z';
  const T0 = '2026-10-18T06:00:00Z';
  const H1 = '2026-10-18T12:00:00Z';
  const C2 = '2026-10-19T00:00:00Z';
  const T1 = '2026-10-19T06:00:00Z';
  const R1 = '2026-10-20T00:00:00Z';
  const FIXTURE = JSON.parse(fs.readFileSync(join(here, 'fixtures', 'model-catalog', 'tok-fixture-cc.json'), 'utf8')) as
    { fetchedAt: number; staleAt: number; catalog: { config: { provider_alias_targets: Record<string, { default: string }> } } };
  const OP = join(REPO, 'deploy', 'models-op.mjs');
  const reg = (h: string): string => join(h, '.cc-sessions');
  const aliasesPath = (h: string): string => join(h, '.ccrc', 'models', `${AL}.aliases.json`);
  const advancePath = (h: string): string => join(h, '.ccrc', 'models', `${AL}.advance.json`);

  /** The model op itself, with `now` as its clock; every call is asked to end 0. */
  function aop(h: string, now: string, verb: string, cls = 'opus'): Json {
    const argv = [OP, verb, '--file', join(h, '.ccrc', 'accounts.json'), '--id', AL,
      ...(verb === 'aliases-refresh' ? ['--reg', reg(h)] : ['--class', cls])];
    const r = spawnSyncGroup(process.execPath, argv, { env: { ...process.env, HOME: h, CCRC_MODELS_NOW: now }, encoding: 'utf8', timeout: 20_000 });
    expect(r.status, `${verb}: ${r.stdout}${r.stderr}`).toBe(0);
    return JSON.parse((r.stdout ?? '').split('\n')[0]!) as Json;
  }
  /** `advance-health`'s answer, as the doctor asks for it. */
  function health(h: string, now = NOW): { lanes: Json[]; body: Json } {
    const r = spawnSyncGroup(process.execPath, [OP, 'advance-health', '--file', join(h, '.ccrc', 'accounts.json'), '--reg', reg(h),
      '--lock-template', join(h, '.ccrc', 'locks', 'models-{id}.lock')],
    { env: { ...process.env, HOME: h, CCRC_MODELS_NOW: now }, encoding: 'utf8', timeout: 20_000 });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const body = JSON.parse((r.stdout ?? '').split('\n')[0]!) as Json;
    return { lanes: body['lanes'] as Json[], body };
  }
  const laneOf = (h: string, id = AL, now = NOW): Json => health(h, now).lanes.find((l) => l['id'] === id)!;
  const causes = (lane: Json): string[] => (lane['blocked'] as { cause: string }[]).map((b) => b.cause);

  const plantBuild = (h: string, version: string): void => {
    fs.mkdirSync(join(h, ASUFFIX), { recursive: true });
    fs.writeFileSync(join(h, ASUFFIX, '.last-update-result.json'), `${JSON.stringify({ version_to: version })}\n`);
  };
  /** The synthetic cache fixture, fetched at `fetchedAt`, with these classes' alias targets replaced. */
  const plantCache = (h: string, fetchedAt: string, targets: Record<string, string>): void => {
    const j = structuredClone(FIXTURE);
    j.fetchedAt = Date.parse(fetchedAt);
    j.staleAt = j.fetchedAt + 3_600_000;
    for (const [c, id] of Object.entries(targets)) j.catalog.config.provider_alias_targets[c]!.default = id;
    fs.mkdirSync(join(h, ASUFFIX, 'cache', 'model-catalog'), { recursive: true });
    fs.writeFileSync(join(h, ASUFFIX, 'cache', 'model-catalog', 'cache-fixture.json'), `${JSON.stringify(j)}\n`);
  };
  /** opus X1 then X2 (sonnet S1 then S2): one move at T1, so each class's id is days old and its `idSince` is T1. */
  function moved(h: string): void {
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1, sonnet: S1 });
    aop(h, T0, 'aliases-refresh');
    plantCache(h, C2, { opus: X2, sonnet: S2 });
    aop(h, T1, 'aliases-refresh');
  }
  /** opus held on X1 at H1, then its alias moves on to X2 on evidence newer than the hold: held behind. */
  function heldStale(h: string): void {
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1 });
    aop(h, T0, 'aliases-refresh');
    aop(h, H1, 'hold');
    plantCache(h, C2, { opus: X2 });
    aop(h, T1, 'aliases-refresh');
  }
  /** moved, then reverted at R1: held on X1 by a revert, and its evidence (C2) is older than the hold, so unobserved
   *  once the next hourly refresh has read the hold (the revert itself rewrites no aliases file). */
  function reverted(h: string): void {
    moved(h);
    aop(h, R1, 'revert');
    aop(h, '2026-10-20T01:00:00Z', 'aliases-refresh');
  }
  const editAliases = (h: string, f: (a: { classes: Record<string, Json> }) => void): void => {
    const a = JSON.parse(fs.readFileSync(aliasesPath(h), 'utf8')) as { classes: Record<string, Json> };
    f(a);
    fs.writeFileSync(aliasesPath(h), `${JSON.stringify(a, null, 2)}\n`);
  };
  /** A stub ccd whose `caps` lists these words, one per line. */
  const stubCcd = (h: string, words: string[]): void => {
    fs.mkdirSync(join(h, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(join(h, '.local', 'bin', 'ccd'), `#!/bin/sh\nif [ "$1" = caps ]; then printf '%s\\n' ${words.map((w) => `'${w}'`).join(' ')}; fi\n`,
      { mode: 0o755 });
  };
  const capable = (h: string): void => stubCcd(h, ['caps', 'alias-launch-v1']);

  /** One Anthropic session's registry files. `routeapplied`: the words of `<sid>.routeapplied` (default class opus), `'absent'`
   *  (never routed) or `'dir'` (unreadable). `marker`: a turn time in ms, `'absent'` or `'bad'`. `sidecar`: `'absent'`, `'bad'`, or the
   *  default render of `model` at RENDER (`ts` in seconds overrides). */
  function plantAnthropicSession(h: string, o: { sid?: string; model?: string; routeapplied?: string; marker?: number | 'absent' | 'bad';
    sidecar?: 'absent' | 'bad'; ts?: number } = {}): void {
    const sid = o.sid ?? ASID;
    const r = reg(h);
    fs.mkdirSync(join(r, 'usage'), { recursive: true });
    fs.writeFileSync(join(r, `${sid}.wrapper`), AL);
    for (const f of [`${sid}.routeapplied`, `${sid}.turn.json`, join('usage', `${sid}.json`)]) fs.rmSync(join(r, f), { recursive: true, force: true });
    const ra = o.routeapplied ?? 'class=opus effort=high';
    if (ra === 'dir') fs.mkdirSync(join(r, `${sid}.routeapplied`), { recursive: true });
    else if (ra !== 'absent') fs.writeFileSync(join(r, `${sid}.routeapplied`), `${ra}\n`);
    const turnAt = o.marker === undefined ? Date.parse(TURN) : o.marker;
    if (turnAt === 'bad') fs.writeFileSync(join(r, `${sid}.turn.json`), 'not json\n');
    else if (turnAt !== 'absent') {
      fs.writeFileSync(join(r, `${sid}.turn.json`), `${JSON.stringify({ v: 1, sessionId: `uuid-${sid}`, state: 'done', event: 'Stop',
        at: turnAt + 30_000, turnAt, stopAt: turnAt + 30_000, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0,
        lostKinds: '', lostIds: '' })}\n`);
    }
    if (o.sidecar === 'bad') fs.writeFileSync(join(r, 'usage', `${sid}.json`), 'not json\n');
    else if (o.sidecar !== 'absent') {
      fs.writeFileSync(join(r, 'usage', `${sid}.json`), `${JSON.stringify({ ts: o.ts ?? Date.parse(RENDER) / 1000, uuid: `uuid-${sid}`,
        account: AL, model: o.model ?? X1, effort: 'low', ctxPct: 12, cost: 0.1, agent: null })}\n`);
    }
    fs.mkdirSync(join(h, 'svc'), { recursive: true });
    fs.writeFileSync(join(h, 'svc', `claude-session@${sid}.service`), 'active\n');
  }
  const behindOf = (h: string, now = NOW): Json[] => laneOf(h, AL, now)['sessionsBehind'] as Json[];
  const unmeasuredOf = (h: string): Json[] => laneOf(h)['sessionsUnmeasured'] as Json[];
  const ROW_X1 = { session: ASID, class: 'opus', from: X1, to: X2, movedAt: T1, turnAt: TURN, renderAt: RENDER };

  // ── the answer's own shape ──
  it('every lane row carries anthropic, a Codex row false and an Anthropic row true, in roster order beside it', () => {
    const h = box();
    plantLane(h);
    moved(h);
    const { lanes } = health(h);
    expect(lanes.map((l) => [l['id'], l['anthropic']])).toEqual([['lane-a', false], [AL, true]]);
    expect(laneOf(h)).toMatchObject({ id: AL, anthropic: true, heldBack: [], heldBehind: [], blocked: [], sessionsBehind: [], sessionsUnmeasured: [] });
  });

  it('an Anthropic lane with no aliases file and no advance file is not in the population, and an advance file alone is, with no finding', () => {
    const h = box();
    plantLane(h);
    expect(health(h).lanes.map((l) => l['id'])).toEqual(['lane-a']);
    fs.mkdirSync(join(h, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(advancePath(h), serializeAdvance(seedAnthropicAdvance()));
    plantAnthropicSession(h);
    expect(laneOf(h)).toMatchObject({ anthropic: true, blocked: [], heldBehind: [], sessionsBehind: [], sessionsUnmeasured: [] });
    fs.rmSync(advancePath(h));
    expect(health(h).lanes.map((l) => l['id'])).toEqual(['lane-a']);
  });

  it('an absent aliases file is no finding even with a standing advance file and a session', () => {
    const h = box();
    fs.mkdirSync(join(h, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(advancePath(h), serializeAdvance(seedAnthropicAdvance()));
    plantAnthropicSession(h);
    capable(h);
    expect(check(h, 'model-advance-blocked').out).toBe('PASS model-advance-blocked: 1 lane(s) with a model registry or an aliases file: '
      + 'nothing blocks an advance\n');
  });

  // ── the four causes, firing and clearing ──
  it('alias-source-absent fires on a lane no source reaches, prints its remedy once ccd marks launches, and clears with a cache', () => {
    const h = box();
    aop(h, T0, 'aliases-refresh');
    capable(h);
    const r = check(h, 'model-advance-blocked');
    expect(r.out).toContain('WARN model-advance-blocked: lane-c: alias-source-absent (');
    expect(r.out).toContain('\n  remedy: per cause: alias source — start one session on this lane through ccd, or sign it in so Claude Code writes a catalogue\n');
    expect(r.code).toBe(2);
    expect(causes(laneOf(h))).toEqual(['alias-source-absent']);
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1 });
    aop(h, T1, 'aliases-refresh');
    expect(causes(laneOf(h))).toEqual([]);
    expect(check(h, 'model-advance-blocked').out).toContain('PASS model-advance-blocked: 1 lane(s)');
  });

  it('alias-cache-stale fires when a refresh read a cache a week old, and clears when the cache is fetched again', () => {
    const h = box();
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1 });
    aop(h, '2026-10-26T06:00:00Z', 'aliases-refresh');
    const r = check(h, 'model-advance-blocked', { CCRC_MODELS_NOW: '2026-10-26T07:00:00Z' });
    expect(r.out).toContain('WARN model-advance-blocked: lane-c: alias-cache-stale (');
    expect(r.out).toContain('\n  remedy: per cause: alias cache — the next session Claude Code starts on this lane refreshes it\n');
    expect(causes(laneOf(h, AL, '2026-10-26T07:00:00Z'))).toEqual(['alias-cache-stale']);
    plantCache(h, '2026-10-26T06:30:00Z', { opus: X1 });
    aop(h, '2026-10-26T06:45:00Z', 'aliases-refresh');
    expect(causes(laneOf(h, AL, '2026-10-26T07:00:00Z'))).toEqual([]);
  });

  it('aliases-file-unreadable fires on a file nobody can read, and clears once it is moved aside and the refresh starts it again', () => {
    const h = box();
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1 });
    fs.mkdirSync(join(h, '.ccrc', 'models'), { recursive: true });
    fs.mkdirSync(aliasesPath(h));
    const r = check(h, 'model-advance-blocked');
    expect(r.out).toContain('WARN model-advance-blocked: lane-c: aliases-file-unreadable (');
    expect(r.out).toContain('\n  remedy: per cause: aliases file — the refresh will not write over it: read it, then move it aside, and the next hourly refresh starts it again\n');
    expect(causes(laneOf(h))).toEqual(['aliases-file-unreadable']);
    fs.rmdirSync(aliasesPath(h));
    aop(h, T0, 'aliases-refresh');
    expect(causes(laneOf(h))).toEqual([]);
  });

  it('aliases-file-invalid fires on a file this build does not read, and clears the same way', () => {
    const h = box();
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1 });
    fs.mkdirSync(join(h, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(aliasesPath(h), `${JSON.stringify({ v: 2 })}\n`);
    expect(check(h, 'model-advance-blocked').out).toContain('WARN model-advance-blocked: lane-c: aliases-file-invalid (');
    expect(causes(laneOf(h))).toEqual(['aliases-file-invalid']);
    fs.rmSync(aliasesPath(h));
    aop(h, T0, 'aliases-refresh');
    expect(causes(laneOf(h))).toEqual([]);
  });

  it('an Anthropic lane never says lane-not-codex-kind, and its lock and advance file are read as a registry lane\'s are', () => {
    const h = box();
    moved(h);
    expect(causes(laneOf(h))).not.toContain('lane-not-codex-kind');
    fs.writeFileSync(advancePath(h), '{"v": 9}\n');
    fs.mkdirSync(join(h, '.ccrc', 'locks'), { recursive: true });
    fs.symlinkSync(join(h, 'nowhere'), join(h, '.ccrc', 'locks', `models-${AL}.lock`));
    expect(causes(laneOf(h))).toEqual(['lock-unwritable', 'advance-file-invalid']);
  });

  it('no source is a note before alias-launch-v1, and a WARN once ccd lists it', () => {
    const h = box();
    aop(h, T0, 'aliases-refresh');
    stubCcd(h, ['caps']);
    const note = check(h, 'model-advance-blocked');
    expect(note.out).toBe('PASS model-advance-blocked: 1 lane(s) with a model registry or an aliases file: nothing blocks an advance; '
      + 'no source until ccd marks alias launches (lane-c)\n');
    expect(note.code).toBe(0);
    fs.rmSync(join(h, '.local'), { recursive: true });
    expect(check(h, 'model-advance-blocked').out).toContain('PASS model-advance-blocked');
    capable(h);
    const warn = check(h, 'model-advance-blocked');
    expect(warn.out).toContain('WARN model-advance-blocked: lane-c: alias-source-absent (');
    expect(warn.code).toBe(2);
  });

  it('the note names only the source cause: a stale cache or a file cause still WARNs before alias-launch-v1', () => {
    const h = box();
    fs.mkdirSync(join(h, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(aliasesPath(h), `${JSON.stringify({ v: 2 })}\n`);
    stubCcd(h, ['caps']);
    expect(check(h, 'model-advance-blocked').out).toContain('WARN model-advance-blocked: lane-c: aliases-file-invalid (');
  });

  // ── held behind ──
  it('held behind on an Anthropic lane carries the five fields, and the row is the exact one the check reads', () => {
    const h = box();
    heldStale(h);
    expect(laneOf(h)['heldBehind']).toEqual([{ class: 'opus', hold: { at: H1, by: 'hand' }, reason: 'newer', pin: X1, newer: X2 }]);
    expect(laneOf(h)['heldBack']).toEqual([]);
  });

  it('an Anthropic held-behind row prints the release wording, no canary, and a Codex row beside it keeps its own', () => {
    const h = box();
    plantLane(h, { advance: stepAdvance({ opus: { hold: HOLD } }) });
    heldStale(h);
    const r = check(h, 'model-held-behind');
    const lines = r.out.split('\n');
    expect(lines[0]).toBe(`WARN model-held-behind: lane-a opus is held (2026-10-22T08:00Z, by hand) while model-6.1-gamma is newer in its family`);
    expect(lines[1]).toBe('  remedy: \'ccrc models lane-a release opus\' lets the next hourly refresh advance it, canary first');
    expect(lines[2]).toBe(`WARN model-held-behind: lane-c opus is held (2026-10-18T12:00Z, by hand) while ${X2} is newer in its family`);
    expect(lines[3]).toBe('  remedy: release the hold from the lane\'s Models sheet (or with \'ccrc models lane-c release <class>\': opus), and the '
      + 'class follows its alias: its sessions launch on the alias\'s current id from their next launch. Leaving the hold in place keeps the '
      + 'held id, and this warning');
    expect(lines[3]).not.toContain('canary');
    expect(r.code).toBe(2);
  });

  it('a null id is never held behind', () => {
    const h = box();
    heldStale(h);
    editAliases(h, (a) => { Object.assign(a.classes['opus']!, { id: null }); });
    expect(laneOf(h)['heldBehind']).toEqual([]);
  });

  it('an unobserved class is never held behind', () => {
    const h = box();
    reverted(h);
    const a = JSON.parse(fs.readFileSync(aliasesPath(h), 'utf8')) as { classes: Record<string, Json> };
    expect(a.classes['opus']).toMatchObject({ id: X2, unobserved: true });
    expect(laneOf(h)['heldBehind']).toEqual([]);
  });

  // ── sessions behind ──
  it('a session on the id an alias moved off is named behind, from the move and with the evidence, and not behind on the new one', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h);
    expect(behindOf(h)).toEqual([ROW_X1]);
    plantAnthropicSession(h, { model: X2 });
    expect(behindOf(h)).toEqual([]);
    expect(unmeasuredOf(h)).toEqual([]);
  });

  it('a held session is not behind: it runs hold.model, and the class is unobserved', () => {
    const h = box();
    reverted(h);
    plantAnthropicSession(h, { model: X1 });
    expect(behindOf(h)).toEqual([]);
  });

  it('a session still on the newer id after a revert is named behind, to the held id, from the hold', () => {
    const h = box();
    reverted(h);
    plantAnthropicSession(h, { model: X2 });
    expect(behindOf(h)).toEqual([{ ...ROW_X1, from: X2, to: X1, movedAt: R1 }]);
  });

  it('a null id names no session behind', () => {
    const h = box();
    moved(h);
    editAliases(h, (a) => { Object.assign(a.classes['opus']!, { id: null }); });
    plantAnthropicSession(h);
    expect(behindOf(h)).toEqual([]);
    expect(unmeasuredOf(h)).toEqual([]);
  });

  it('an unlaunchable id names no session behind', () => {
    const h = box();
    moved(h);
    plantBuild(h, '9.1.0');
    aop(h, '2026-10-19T12:00:00Z', 'aliases-refresh');
    const a = JSON.parse(fs.readFileSync(aliasesPath(h), 'utf8')) as { classes: Record<string, Json> };
    expect(a.classes['opus']).toMatchObject({ id: X2, unlaunchable: { needs: '9.2.0' } });
    plantAnthropicSession(h);
    expect(behindOf(h)).toEqual([]);
  });

  it.each([
    ['default', 'class=default effort=high'],
    ['no class word', 'effort=high'],
  ])('a session whose routing record has %s is read and never behind', (_n, routeapplied) => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { routeapplied });
    expect(behindOf(h)).toEqual([]);
    expect(unmeasuredOf(h)).toEqual([]);
  });

  it('a degraded session is judged by its served class', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { routeapplied: 'class=sonnet effort=low', model: S1 });
    expect(behindOf(h)).toEqual([{ ...ROW_X1, class: 'sonnet', from: S1, to: S2 }]);
  });

  it('a session on another class\'s model is not behind', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { routeapplied: 'class=sonnet effort=low', model: X1 });
    expect(behindOf(h)).toEqual([]);
    plantAnthropicSession(h, { routeapplied: 'class=opus effort=low', model: S2 });
    expect(behindOf(h)).toEqual([]);
  });

  it('a session on the id another class now names is not behind', () => {
    const h = box();
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1 });
    aop(h, T0, 'aliases-refresh');
    plantCache(h, C2, { opus: X2, haiku: X1 });
    aop(h, T1, 'aliases-refresh');
    plantAnthropicSession(h);
    expect(behindOf(h)).toEqual([]);
  });

  it('a render before its turn is not behind', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { marker: Date.parse(RENDER) + 60_000 });
    expect(behindOf(h)).toEqual([]);
    plantAnthropicSession(h, { marker: Date.parse(RENDER) });
    expect(behindOf(h)).toEqual([]);
    expect(unmeasuredOf(h)).toEqual([]);
  });

  it('with no turn marker the turn is the reading', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { marker: 'absent' });
    expect(behindOf(h)).toEqual([{ ...ROW_X1, turnAt: RENDER }]);
    expect(unmeasuredOf(h)).toEqual([]);
  });

  it('a 1M-context session on the current id is not behind, and one on the old id is named by its bare id', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { model: `${X2}[1m]` });
    expect(behindOf(h)).toEqual([]);
    plantAnthropicSession(h, { model: `${X1}[1m]` });
    expect(behindOf(h)).toEqual([ROW_X1]);
  });

  it('the day counts from the release: a session is behind a released class only a day after the release', () => {
    const h = box();
    moved(h);
    aop(h, '2026-10-21T00:00:00Z', 'hold');
    aop(h, '2026-10-22T08:00:00Z', 'release');
    plantAnthropicSession(h);
    expect(behindOf(h)).toEqual([{ ...ROW_X1, movedAt: '2026-10-22T08:00:00Z' }]);
    expect(behindOf(h, '2026-10-22T20:00:00Z')).toEqual([]);
  });

  it('the day counts from a first id', () => {
    const h = box();
    plantBuild(h, '9.9.0');
    plantCache(h, C1, { opus: X1 });
    aop(h, T0, 'aliases-refresh');
    plantAnthropicSession(h, { model: X0 });
    expect(behindOf(h)).toEqual([{ ...ROW_X1, from: X0, to: X1, movedAt: T0 }]);
    expect(behindOf(h, '2026-10-18T20:00:00Z')).toEqual([]);
  });

  it('an Anthropic row beside a Codex row does not SKIP: the check WARNs naming both lanes', () => {
    const h = box();
    plantLane(h, { registry: MOVED_REGISTRY, advance: MOVED_ADVANCE });
    plantSession(h);
    moved(h);
    plantAnthropicSession(h);
    const lanes = health(h).lanes;
    expect(lanes.map((l) => [l['id'], (l['sessionsBehind'] as Json[]).length])).toEqual([['lane-a', 1], [AL, 1]]);
    const r = check(h, 'model-sessions-behind');
    expect(r.out.startsWith('SKIP')).toBe(false);
    const warns = r.out.split('\n').filter((l) => l.startsWith('WARN'));
    expect(warns).toEqual([
      'WARN model-sessions-behind: lane-a session lane-a-demo last replied on model-5.6-gamma at 2026-10-22T09:12Z, in a turn begun '
      + '2026-10-22T09:11Z, after opus moved to model-6.1-gamma 42 h ago',
      `WARN model-sessions-behind: lane-c session lane-c-demo last replied on ${X1} at 2026-10-22T09:12Z, in a turn begun `
      + `2026-10-22T09:11Z, after opus moved to ${X2} 99 h ago`,
    ]);
    expect(r.code).toBe(2);
  });

  // ── sessions unmeasured ──
  it('a never-routed session is neither behind nor unmeasured', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { routeapplied: 'absent' });
    expect(behindOf(h)).toEqual([]);
    expect(unmeasuredOf(h)).toEqual([]);
  });

  it('a routing record nobody can read is route-record-unreadable', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { routeapplied: 'dir' });
    expect(unmeasuredOf(h)).toEqual([{ session: ASID, why: 'route-record-unreadable' }]);
    expect(behindOf(h)).toEqual([]);
  });

  it('a sidecar that is absent or unreadable is sidecar-absent or sidecar-unreadable', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { sidecar: 'absent' });
    expect(unmeasuredOf(h)).toEqual([{ session: ASID, why: 'sidecar-absent' }]);
    plantAnthropicSession(h, { sidecar: 'bad' });
    expect(unmeasuredOf(h)).toEqual([{ session: ASID, why: 'sidecar-unreadable' }]);
  });

  it('a turn marker that cannot be read is marker-unreadable, and an absent one is no failure', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { marker: 'bad' });
    expect(unmeasuredOf(h)).toEqual([{ session: ASID, why: 'marker-unreadable' }]);
    plantAnthropicSession(h, { marker: 'absent' });
    expect(unmeasuredOf(h)).toEqual([]);
  });

  it('a routing record is read first: its word wins over a missing sidecar', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { routeapplied: 'dir', sidecar: 'absent', marker: 'bad' });
    expect(unmeasuredOf(h)).toEqual([{ session: ASID, why: 'route-record-unreadable' }]);
  });

  it.each([
    ['aliases-file-unreadable', (h: string): void => { fs.mkdirSync(aliasesPath(h)); }],
    ['aliases-file-invalid', (h: string): void => { fs.writeFileSync(aliasesPath(h), '{"v": 2}\n'); }],
  ])('when the aliases file cannot be read every session of the lane is named, as %s', (word, spoil) => {
    const h = box();
    moved(h);
    plantAnthropicSession(h);
    plantAnthropicSession(h, { sid: 'lane-c-two', routeapplied: 'absent' });
    fs.rmSync(aliasesPath(h));
    spoil(h);
    expect(unmeasuredOf(h)).toEqual([{ session: ASID, why: word }, { session: 'lane-c-two', why: word }]);
    expect(behindOf(h)).toEqual([]);
  });

  it('the PASS and the WARN carry the unmeasured count of an Anthropic lane\'s sessions', () => {
    const h = box();
    moved(h);
    plantAnthropicSession(h, { sidecar: 'bad' });
    expect(check(h, 'model-sessions-behind').out).toBe('PASS model-sessions-behind: 1 lane(s) with a model registry or an aliases file: no '
      + 'running session is still on a model a move replaced 24 h or more ago; 1 session(s) could not be measured (sidecar-unreadable 1)\n');
  });
});
