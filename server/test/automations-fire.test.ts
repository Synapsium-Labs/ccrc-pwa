// Task 6 (docs: .superpowers/sdd/2026-08-31-automations/task-6-{brief,decisions}.md,
// spec §6-§8): the precondition ladder is pure, ordered, and fails shut. One
// case per rung, asserting the EXACT refusal code and that no later rung was
// consulted — every `FleetIO`/`AutomationCoordPort` double below throws on any
// path/call it did not explicitly expect, which is what "later collaborators
// throw if called" means here (task-6-brief.md Step 1).
//
// `checkPreClaim`/`checkPostClaim` split (rungs 1-2 vs 3-9) per
// task-6-decisions.md C2.2 — the plan's own single `checkPreconditions` is a
// defect the decisions doc fixes; see task-6-report.md for the four defects
// this file was written against instead of the plan's literal text.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkPreClaim, checkPostClaim, PRE_CLAIM_REFUSALS, POST_CLAIM_REFUSALS,
  fireAutomation, deliverPrompt, promptAttempts, promptBackoffMs, promptLadder,
  AUTOMATION_PROMPT_MAX_ATTEMPTS, AUTOMATION_PROMPT_BACKOFF_BASE_MS, AUTOMATION_PROMPT_BACKOFF_MAX_MS,
  type FireDeps, type AutomationCoordPort, type FireOutcome,
} from '../src/auto/fire.js';
import {
  decideFire, planSchedule, failureLadder, type AutomationRow,
} from '../src/auto/schedulepolicy.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { FleetIO } from '../src/io.js';
import type { CcrcConfig } from '../src/config.js';
import { Tmux, UNMEASURED, type Runner } from '../src/exec.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { CcdArgv } from '../src/ccdargv.js';
import type { CcdResult } from '../src/lifecycle.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import {
  AUTOMATION_FAILURE_CEILING, AUTOMATION_MAX_CONCURRENT, AUTOMATION_PRESSURE_CEILING,
  AUTOMATION_REFUSALS, type AutomationRefusal, type AutomationStep,
} from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

// --- Doubles ----------------------------------------------------------------

/** A `FleetIO` double that answers ONLY the exact paths this fixture names
 *  and throws on anything else — the mechanism `Step 1` asks for: if a rung
 *  the fixture did not expect to run tries to read anything, the test fails
 *  loudly instead of silently passing on an accidental real answer. */
function makeIo(spec: {
  readdir?: Record<string, string[] | null>;
  readFile?: Record<string, string>;
}): FleetIO {
  const dirs = spec.readdir ?? {};
  const files = spec.readFile ?? {};
  const boom = (op: string): never => {
    throw new Error(`unexpected FleetIO.${op} — a later rung ran that this fixture did not expect`);
  };
  return {
    readdir: async (p) => (p in dirs ? dirs[p] : boom(`readdir(${p})`)),
    readFile: async (p) => (p in files ? files[p]! : boom(`readFile(${p})`)),
    readFileMeasured: async () => boom('readFileMeasured'),
    readFileFrom: async () => boom('readFileFrom'),
    readFileB64: async () => boom('readFileB64'),
    // The measured trio `main` added beside the three folding readers: this
    // double enumerates every member deliberately, so a rung that reaches for
    // one this fixture did not arrange throws by name instead of reading
    // `undefined` as an answer.
    readFileFromMeasured: async () => boom('readFileFromMeasured'),
    readFileB64Measured: async () => boom('readFileB64Measured'),
    statMeasured: async () => boom('statMeasured'),
    stat: async () => boom('stat'),
    realpath: async () => boom('realpath'),
    writeFileB64: async () => boom('writeFileB64'),
    tailFile: async () => boom('tailFile'),
  };
}

/** Same idea for rung 2 and rung 4: unset means "must not be consulted". The
 *  five Task 7 methods (the act's own writes) throw unconditionally here —
 *  `checkPreClaim`/`checkPostClaim` never call them, by construction, and a
 *  rung test that somehow reached one would be exercising the wrong ladder
 *  half. `makeAutoCoord` below (Task 7) is the spy that implements them for
 *  real. */
function makeCoord(spec: { inFlight?: number; paused?: boolean }): AutomationCoordPort {
  const boom = (op: string): never => {
    throw new Error(`unexpected ${op} — this is a rung-1/2/3-9 fixture, not a fireAutomation one`);
  };
  return {
    inFlightAutomationRunCount: () => {
      if (spec.inFlight === undefined) {
        throw new Error('unexpected inFlightAutomationRunCount() — rung 1 should have refused first');
      }
      return spec.inFlight;
    },
    automationsPaused: () => {
      if (spec.paused === undefined) {
        throw new Error('unexpected automationsPaused() — an earlier rung should have refused first');
      }
      return { paused: spec.paused, updatedAt: 0 };
    },
    markRunHomeScore: () => boom('markRunHomeScore'),
    markAutomationSpawn: () => boom('markAutomationSpawn'),
    settleAutomationRun: () => boom('settleAutomationRun'),
    appendRunEvent: () => boom('appendRunEvent'),
    renewAutomationLease: () => boom('renewAutomationLease'),
  };
}

/** Real, isolated `cfg` (fixture HOME, per constraints.md) so `registryDir`/
 *  `limitsDir`/`projectsRoot`/`roster` are the genuine shape `checkPostClaim`
 *  reads — only the `io` double controls what those paths answer. */
function fixtureCfg(): CcrcConfig {
  const home = mkTmp('ccrc-auto-fire-');
  return testDeps(home).cfg;
}

function makeDeps(io: FleetIO, coord: AutomationCoordPort, cfg: CcrcConfig): FireDeps {
  const base = testDeps(cfg.home);
  return { coord, io, cfg, runCcd: base.runCcd, tmux: base.tmux, queue: base.queue };
}

function baseRow(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 1, name: 'nightly', state: 'armed', project: 'demo', prompt: 'go',
    cadence: { kind: 'interval', everyMinutes: 120 }, graceMs: 1_800_000,
    provedAt: 1_000, nextRunAt: 2_000, scheduleError: null,
    lastFireAt: null, lastOutcome: null, lastRefusal: null,
    leaseUntil: null, leaseHardUntil: null,
    consecutiveFailures: 0, runsEvicted: 0, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

// --- Rungs 1-2 (checkPreClaim) ----------------------------------------------

describe('checkPreClaim — rungs 1-2, before the lease claim', () => {
  it('rung 1: overlap refuses a still-leased row without consulting the coord port', () => {
    const coord = makeCoord({}); // inFlightAutomationRuns must NOT be called
    const verdict = checkPreClaim({ coord }, { id: 7, leaseUntil: 5_000 }, 4_000);
    expect(verdict).toEqual({ refused: 'overlap', detail: 'automation 7 is already leased until 5000' });
  });

  it('rung 1: a lapsed leaseUntil is not an overlap (soft bound, in the past)', () => {
    const coord = makeCoord({ inFlight: 0 });
    const verdict = checkPreClaim({ coord }, { id: 7, leaseUntil: 3_000 }, 4_000);
    expect(verdict).toEqual({ ok: true });
  });

  it('rung 2: cap-concurrency refuses at the ceiling, carrying the count AND the limit', () => {
    const coord = makeCoord({ inFlight: AUTOMATION_MAX_CONCURRENT });
    const verdict = checkPreClaim({ coord }, { id: 3, leaseUntil: null }, 1_000);
    expect(verdict).toEqual({
      refused: 'cap-concurrency',
      detail: `${AUTOMATION_MAX_CONCURRENT} automation runs already in flight, ceiling ${AUTOMATION_MAX_CONCURRENT}`,
    });
  });

  it('rung 2: under the ceiling proceeds', () => {
    const coord = makeCoord({ inFlight: AUTOMATION_MAX_CONCURRENT - 1 });
    const verdict = checkPreClaim({ coord }, { id: 3, leaseUntil: null }, 1_000);
    expect(verdict).toEqual({ ok: true });
  });
});

// --- Rungs 3-9 (checkPostClaim) ---------------------------------------------

describe('checkPostClaim — rungs 3-9, after the lease claim', () => {
  it('rung 3: an unlistable registry fails shut with registry-unmeasurable', async () => {
    const cfg = fixtureCfg();
    const io = makeIo({ readdir: { [cfg.registryDir]: null } });
    const deps = makeDeps(io, makeCoord({}), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect(verdict).toEqual({
      refused: 'registry-unmeasurable', detail: `${cfg.registryDir} is not listable`,
    });
  });

  it('rung 4: automations-paused refuses, with the registry listable and no marker', async () => {
    const cfg = fixtureCfg();
    const io = makeIo({ readdir: { [cfg.registryDir]: [] } });
    const deps = makeDeps(io, makeCoord({ paused: true }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect(verdict).toEqual({ refused: 'automations-paused', detail: 'the automations lane is paused' });
  });

  it('rung 5: coordinator-paused reads the SAME registry listing as rung 3, a different code', async () => {
    const cfg = fixtureCfg();
    const io = makeIo({ readdir: { [cfg.registryDir]: [COORDINATOR_PAUSE_MARKER] } });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect(verdict).toEqual({
      refused: 'coordinator-paused',
      detail: `${COORDINATOR_PAUSE_MARKER} is present in ${cfg.registryDir}`,
    });
  });

  it('rung 6: unknown-project refuses on POSITIVE evidence — a listable root and registry, neither names it', async () => {
    const cfg = fixtureCfg();
    const io = makeIo({ readdir: { [cfg.registryDir]: [], [cfg.projectsRoot]: [] } });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect(verdict).toEqual({
      refused: 'unknown-project', detail: 'project demo is not known to this fleet',
    });
  });

  it('rung 6 fails OPEN: an unmeasurable projects root proceeds (and rung 8 reports an unmeasured lane as null, never 0)', async () => {
    const cfg = fixtureCfg();
    const io = makeIo({
      readdir: { [cfg.registryDir]: [], [cfg.projectsRoot]: null, [cfg.limitsDir]: [] },
    });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    // `'ok' in verdict`, not `verdict.ok` — `PostClaimVerdict`'s two arms do
    // not share a key both sides carry (unlike `FireDecision.act`), so a
    // bare `.ok` access does not typecheck until narrowed by presence.
    expect('ok' in verdict).toBe(true);
    if ('ok' in verdict) {
      expect(verdict.homeScore).toBeNull();
      expect(typeof verdict.projectedWrapper).toBe('string');
    }
  });

  it('rung 7: no-placeable-account when every home-able lane is disabled', async () => {
    const cfg = fixtureCfg();
    const homeAble = cfg.roster.accounts.filter((a) => a.homeAble).map((a) => `${a.id}-disabled`);
    const io = makeIo({
      readdir: { [cfg.registryDir]: homeAble, [cfg.projectsRoot]: null, [cfg.limitsDir]: [] },
    });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect(verdict).toEqual({ refused: 'no-placeable-account', detail: 'no home-able account is available' });
  });

  it('rung 8: account-pressed refuses at the ceiling, carrying the score AND the ceiling', async () => {
    const cfg = fixtureCfg();
    const homeAble = cfg.roster.accounts.find((a) => a.homeAble)!;
    const io = makeIo({
      readdir: { [cfg.registryDir]: [], [cfg.projectsRoot]: null, [cfg.limitsDir]: [`${homeAble.id}.json`] },
      readFile: {
        [path.join(cfg.limitsDir, `${homeAble.id}.json`)]: JSON.stringify({ five: 40, seven: 99 }),
      },
    });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect(verdict).toEqual({
      refused: 'account-pressed',
      detail: `${homeAble.id} measured 99, ceiling ${AUTOMATION_PRESSURE_CEILING}`,
    });
  });

  it('rung 8: a MEASURED score of 0 is not the unmeasured case — both are covered and they differ', async () => {
    const cfg = fixtureCfg();
    const homeAble = cfg.roster.accounts.find((a) => a.homeAble)!;
    const io = makeIo({
      readdir: { [cfg.registryDir]: [], [cfg.projectsRoot]: null, [cfg.limitsDir]: [`${homeAble.id}.json`] },
      readFile: {
        [path.join(cfg.limitsDir, `${homeAble.id}.json`)]: JSON.stringify({ five: 0, seven: 0 }),
      },
    });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect('ok' in verdict).toBe(true);
    if ('ok' in verdict) {
      expect(verdict.homeScore).toBe(0);
      expect(verdict.homeScore).not.toBeNull();
    }
  });

  it('rung 9: failure-ceiling refuses, carrying the count AND the ceiling', async () => {
    const cfg = fixtureCfg();
    const io = makeIo({ readdir: { [cfg.registryDir]: [], [cfg.projectsRoot]: null, [cfg.limitsDir]: [] } });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(
      deps, { id: 1, project: 'demo', consecutiveFailures: AUTOMATION_FAILURE_CEILING }, 1_000,
    );
    expect(verdict).toEqual({
      refused: 'failure-ceiling',
      detail: `${AUTOMATION_FAILURE_CEILING} consecutive failures, ceiling ${AUTOMATION_FAILURE_CEILING}`,
    });
  });

  it('every rung passes: ok, with a real projected wrapper and a below-ceiling score', async () => {
    const cfg = fixtureCfg();
    const homeAble = cfg.roster.accounts.find((a) => a.homeAble)!;
    const io = makeIo({
      readdir: {
        [cfg.registryDir]: [], [cfg.projectsRoot]: ['demo'], [path.join(cfg.projectsRoot, 'demo')]: [],
        [cfg.limitsDir]: [`${homeAble.id}.json`],
      },
      readFile: { [path.join(cfg.limitsDir, `${homeAble.id}.json`)]: JSON.stringify({ five: 1, seven: 2 }) },
    });
    const deps = makeDeps(io, makeCoord({ paused: false }), cfg);
    const verdict = await checkPostClaim(deps, { id: 1, project: 'demo', consecutiveFailures: 0 }, 1_000);
    expect(verdict).toEqual({ ok: true, homeScore: 2, projectedWrapper: homeAble.id });
  });
});

// --- Totality ----------------------------------------------------------------

describe('the ladder is total over AUTOMATION_REFUSALS, minus what Task 7 owns', () => {
  it('PRE_CLAIM_REFUSALS union POST_CLAIM_REFUSALS is exactly AUTOMATION_REFUSALS minus the five spawn/prompt codes and unknown', () => {
    const notLadder: readonly AutomationRefusal[] = [
      'spawn-refused', 'spawn-cut-short', 'spawn-unmeasured', 'spawn-ambiguous', 'prompt-refused', 'unknown',
    ];
    const expected = AUTOMATION_REFUSALS.filter((r) => !notLadder.includes(r));
    const actual = [...PRE_CLAIM_REFUSALS, ...POST_CLAIM_REFUSALS];
    expect([...actual].sort()).toEqual([...expected].sort());
    // Every fixture above that asserted a `refused:` code covers each member
    // of `actual` at least once — a coverage floor so this comparison cannot
    // pass by both sides being accidentally empty.
    expect(actual.length).toBeGreaterThanOrEqual(9);
  });
});

// --- Source ring scan ---------------------------------------------------------

describe('the ring: neither auto/ L1 file imports fastify, node:fs or node:sqlite', () => {
  const autoDir = path.join(serverRoot, 'src', 'auto');
  // Named explicitly, not "every .ts under auto/": a sibling task (owned by
  // a parallel agent, per this task's dispatch) lands `auto/routes.ts` —
  // L4, fastify by design — in this same directory. This scan polices the
  // two L1 files Tasks 6-7 ship; `routes.ts`'s own ring properties are that
  // task's suite to pin, not this one's to assume out of existence.
  const files = ['fire.ts', 'schedulepolicy.ts'].map((f) => path.join(autoDir, f));

  it('found the two L1 files this task ships, still present on disk', () => {
    expect(files.length).toBe(2);
    for (const f of files) expect(statSync(f).isFile(), `${f} should exist`).toBe(true);
  });

  it('imports none of fastify / node:fs / node:sqlite, and holds no `reply`', () => {
    for (const f of files) {
      if (statSync(f).isDirectory()) continue;
      const src = readFileSync(f, 'utf8');
      expect(/from\s+'fastify'/.test(src), `${f} imports fastify`).toBe(false);
      expect(/from\s+'node:fs/.test(src), `${f} imports node:fs`).toBe(false);
      expect(/from\s+'node:sqlite'/.test(src), `${f} imports node:sqlite`).toBe(false);
      // A narrow usage scan, not a bare `\breply\b` — this file's own
      // docstrings say "no reply" in prose, which a bare word scan would
      // trip on itself. What actually matters is the fastify object never
      // appearing as a type or being called.
      expect(/FastifyReply/.test(src), `${f} types FastifyReply`).toBe(false);
      expect(/reply\s*\.\s*(send|code|status)\s*\(/.test(src), `${f} calls reply.*(...)`).toBe(false);
    }
  });
});

// --- schedulepolicy.ts: decideFire / planSchedule / failureLadder -----------

describe('planSchedule', () => {
  it('an interval cadence below AUTOMATION_MIN_INTERVAL_MINUTES answers bad-cadence', () => {
    expect(planSchedule({ kind: 'interval', everyMinutes: 1 }, 1_000, null))
      .toEqual({ nextRunAt: null, scheduleError: 'bad-cadence' });
  });

  it('a null cadence answers bad-cadence', () => {
    expect(planSchedule(null, 1_000, null)).toEqual({ nextRunAt: null, scheduleError: 'bad-cadence' });
  });

  it('a well-formed interval cadence advances strictly into the future', () => {
    const plan = planSchedule({ kind: 'interval', everyMinutes: 120 }, 1_000, null);
    expect(plan).toEqual({ nextRunAt: 1_000 + 120 * 60_000, scheduleError: null });
  });

  it('an empty day mask answers no-future-occurrence', () => {
    const plan = planSchedule({ kind: 'wall-clock', days: 0, minuteOfDay: 540, tz: 'UTC' }, 1_000, null);
    expect(plan).toEqual({ nextRunAt: null, scheduleError: 'no-future-occurrence' });
  });

  it('an unknown timezone answers unknown-timezone', () => {
    const plan = planSchedule(
      { kind: 'wall-clock', days: 0b1111111, minuteOfDay: 540, tz: 'Not/AZone' }, 1_000, null,
    );
    expect(plan).toEqual({ nextRunAt: null, scheduleError: 'unknown-timezone' });
  });
});

describe('decideFire — the catch-up rule (spec §8), driven through schedulepolicy alone', () => {
  it('unschedulable: a degraded (null) cadence', () => {
    const decision = decideFire(baseRow({ cadence: null }), 10_000, false);
    expect(decision).toEqual({ act: 'unschedulable', error: 'bad-cadence' });
  });

  it('unschedulable: no-future-occurrence when nextRunAt is null', () => {
    const decision = decideFire(baseRow({ nextRunAt: null }), 10_000, false);
    expect(decision).toEqual({ act: 'unschedulable', error: 'no-future-occurrence' });
  });

  it('unschedulable: failure-ceiling auto-pauses ahead of the due predicate', () => {
    const decision = decideFire(baseRow({ consecutiveFailures: AUTOMATION_FAILURE_CEILING }), 10_000, false);
    expect(decision).toEqual({ act: 'unschedulable', error: 'failure-ceiling' });
  });

  it('fire schedule: within the punctual window', () => {
    const row = baseRow({ nextRunAt: 10_000 });
    const decision = decideFire(row, 10_010, false);
    expect(decision.act).toBe('fire');
    if (decision.act === 'fire') {
      expect(decision.trigger).toBe('schedule');
      expect(decision.scheduledFor).toBe(10_000);
      expect(decision.lateMs).toBe(10);
      expect(decision.advance.scheduleError).toBeNull();
    }
  });

  it('fire catchup: late but inside grace, and not caught up yet this boot', () => {
    const row = baseRow({ nextRunAt: 10_000, graceMs: 1_800_000 });
    const decision = decideFire(row, 10_000 + 600_000, false);
    expect(decision.act).toBe('fire');
    if (decision.act === 'fire') {
      expect(decision.trigger).toBe('catchup');
      expect(decision.lateMs).toBe(600_000);
    }
  });

  it('record-missed: already caught up this boot, even though still inside grace', () => {
    const row = baseRow({ nextRunAt: 10_000, graceMs: 1_800_000 });
    const decision = decideFire(row, 10_000 + 600_000, true);
    expect(decision).toMatchObject({ act: 'record-missed', scheduledFor: 10_000, lateMs: 600_000 });
  });

  it('record-missed: beyond grace', () => {
    const row = baseRow({ nextRunAt: 10_000, graceMs: 1_000 });
    const decision = decideFire(row, 10_000 + 600_000, false);
    expect(decision).toMatchObject({ act: 'record-missed', scheduledFor: 10_000, lateMs: 600_000 });
  });

  it('every arm but unschedulable carries an advance strictly in the future', () => {
    const row = baseRow({ nextRunAt: 10_000, cadence: { kind: 'interval', everyMinutes: 120 } });
    const decision = decideFire(row, 10_000 + 600_000, false);
    if (decision.act !== 'unschedulable') {
      expect(decision.advance.nextRunAt).not.toBeNull();
      if (decision.advance.nextRunAt !== null) expect(decision.advance.nextRunAt).toBeGreaterThan(10_000 + 600_000);
    }
  });
});

describe('failureLadder — spec §8: missed counts, skipped does not', () => {
  it('ok resets the counter to 0', () => {
    expect(failureLadder(2, 'ok')).toEqual({ consecutiveFailures: 0, autoPause: false });
  });

  it('skipped leaves the counter unchanged — the lease working is not a failure', () => {
    expect(failureLadder(2, 'skipped')).toEqual({ consecutiveFailures: 2, autoPause: false });
  });

  it('missed increments and auto-pauses at the ceiling', () => {
    expect(failureLadder(AUTOMATION_FAILURE_CEILING - 1, 'missed'))
      .toEqual({ consecutiveFailures: AUTOMATION_FAILURE_CEILING, autoPause: true });
  });

  it('refused increments without auto-pausing below the ceiling', () => {
    expect(failureLadder(0, 'refused')).toEqual({ consecutiveFailures: 1, autoPause: false });
  });
});

// =============================================================================
// Task 7 — the act: spawn, identify by diff, adopt honestly, prompt.
// (docs: .superpowers/sdd/2026-08-31-automations/task-7-{brief,decisions}.md,
// spec §6 steps 6-10, task-6-decisions.md C2.6/C2.7). `fireAutomation` calls
// `checkPostClaim` itself, so these fixtures build a REAL registry/limits
// fixture on disk (the `dispatch-adopt.test.ts` pattern) so rungs 3-9 pass
// and the test is only exercising steps 6-10.
// =============================================================================

const AUTO_PROJECT = 'demo';

/** One registry row on disk — `dispatch-adopt.test.ts`'s `seedRow`, renamed. */
function seedSession(
  home: string, id: string,
  opts: { held?: string | null; spawnRc?: number | null; project?: string } = {},
): void {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: opts.project ?? AUTO_PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  if (opts.held != null) writeFileSync(path.join(reg, `${id}.hold`), opts.held);
  if (opts.spawnRc != null) {
    writeFileSync(path.join(reg, `${id}.spawn`), `${Math.floor(Date.now() / 1000)} ${opts.spawnRc}`);
  }
}

/** Records every write `fireAutomation` makes through the port, and answers
 *  `settleAutomationRun` with a plausible `SettledRun` — this is Task 7's own
 *  spy, distinct from `makeCoord` above (which throws on all five of these,
 *  the correct behaviour for a rung-only fixture). */
function makeAutoCoord(opts: { paused?: boolean; inFlight?: number } = {}) {
  const calls = {
    markRunHomeScore: [] as Parameters<AutomationCoordPort['markRunHomeScore']>[],
    markAutomationSpawn: [] as Parameters<AutomationCoordPort['markAutomationSpawn']>[],
    appendRunEvent: [] as Parameters<AutomationCoordPort['appendRunEvent']>[],
    settleAutomationRun: [] as Parameters<AutomationCoordPort['settleAutomationRun']>[],
    renewAutomationLease: [] as Parameters<AutomationCoordPort['renewAutomationLease']>[],
  };
  const coord: AutomationCoordPort = {
    inFlightAutomationRunCount: () => opts.inFlight ?? 0,
    automationsPaused: () => ({ paused: opts.paused ?? false, updatedAt: 0 }),
    markRunHomeScore: (...args) => { calls.markRunHomeScore.push(args); },
    markAutomationSpawn: (...args) => { calls.markAutomationSpawn.push(args); },
    appendRunEvent: (...args) => { calls.appendRunEvent.push(args); },
    settleAutomationRun: (...args) => {
      calls.settleAutomationRun.push(args);
      const [input] = args;
      return {
        runId: input.runId, automationId: 1, outcome: input.settlement.outcome,
        consecutiveFailures: 0, autoPaused: false, proved: false,
      };
    },
    renewAutomationLease: (...args) => { calls.renewAutomationLease.push(args); return true; },
  };
  return { coord, calls };
}

/** A real fixture HOME with a listable registry, a known project directory
 *  and a home-able account under the pressure ceiling — so rungs 3-9 pass —
 *  plus a scripted `ws-add` (seeding AFTER rows exactly like a real spawn
 *  would) and a scripted tmux pane sequence for `sendPrompt`. */
function fireHarness(opts: {
  ccd: Pick<CcdResult, 'ok' | 'stderr'> & Partial<Pick<CcdResult, 'killed' | 'signal'>>;
  before?: readonly { id: string; held?: string | null }[];
  after?: readonly { id: string; held?: string | null; spawnRc?: number | null; project?: string }[];
  afterListed?: boolean;
  panes?: (string | null)[];
}) {
  const home = mkTmp('ccrc-auto-fire-act-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  mkdirSync(path.join(home, 'projects', AUTO_PROJECT), { recursive: true });
  for (const r of opts.before ?? []) seedSession(home, r.id, { held: r.held ?? null });

  let capIdx = 0;
  const panes = opts.panes ?? ['scrollback\n❯ \n', 'scrollback\n❯ go\n', 'scrollback\n❯ \n'];
  const tmuxRunner: Runner = async (cmd, args) => {
    if (cmd === 'tmux' && args[0] === 'capture-pane') {
      const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, tmuxRunner);
  const cfg = base.cfg;
  const homeAble = cfg.roster.accounts.find((acc) => acc.homeAble)!;
  mkdirSync(cfg.limitsDir, { recursive: true });
  writeFileSync(path.join(cfg.limitsDir, `${homeAble.id}.json`), JSON.stringify({ five: 1, seven: 2 }));

  let sawWsAdd = false;
  const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
    if (argv[0] === 'ws-add') {
      sawWsAdd = true;
      for (const r of opts.after ?? []) {
        seedSession(home, r.id, { held: r.held ?? null, spawnRc: r.spawnRc ?? null, project: r.project });
      }
      return {
        ok: opts.ccd.ok, stdout: '', stderr: opts.ccd.stderr,
        killed: opts.ccd.killed ?? UNMEASURED,
        signal: opts.ccd.signal === undefined ? UNMEASURED : opts.ccd.signal,
      };
    }
    return { ok: true, stdout: '', stderr: '', killed: false, signal: null };
  };

  const io: FleetIO = opts.afterListed === false
    ? { ...base.io, readdir: async (p: string) => (sawWsAdd ? null : base.io.readdir(p)) }
    : base.io;

  const buildDeps = (coord: AutomationCoordPort): FireDeps =>
    ({ coord, io, cfg, runCcd, tmux: base.tmux, queue: base.queue });

  return { home, cfg, io, runCcd, tmux: base.tmux, queue: base.queue, buildDeps };
}

describe('fireAutomation — spawn, identify by registry diff, adopt honestly, prompt (spec §6 steps 6-10)', () => {
  it('a successful ws-add adding exactly one row binds it and records sessionId/workspace/branch/wrapper', async () => {
    const h = fireHarness({ ccd: { ok: true, stderr: '' }, after: [{ id: 'demo-quiet-basin' }] });
    const { coord, calls } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 42, 5_000);
    expect(outcome).toMatchObject({ settle: 'ok' });
    if ('settle' in outcome && outcome.settle === 'ok') {
      expect(outcome.facts).toMatchObject({
        sessionId: 'demo-quiet-basin', workspace: 'demo-quiet-basin', branch: 'ws/demo-quiet-basin',
        wrapper: 'claude', adopted: false, spawnRc: null, homeScore: 2,
      });
    }
    expect(calls.markAutomationSpawn[0]?.[0]).toMatchObject({
      runId: 42, spawnRc: null, identity: { bound: true, sessionId: 'demo-quiet-basin', adopted: false },
    });
    expect(calls.settleAutomationRun[0]?.[0]).toMatchObject({ runId: 42, settlement: { outcome: 'ok' } });
    expect(calls.appendRunEvent.map((c) => c[1])).toEqual(['precheck', 'spawn', 'identify', 'prompt', 'close']);
  });

  it('two new same-project rows refuse spawn-ambiguous', async () => {
    const h = fireHarness({ ccd: { ok: true, stderr: '' }, after: [{ id: 'a1' }, { id: 'a2' }] });
    const { coord, calls } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 1, 1_000);
    expect(outcome).toMatchObject({ settle: 'refused', refusal: 'spawn-ambiguous' });
    expect(calls.settleAutomationRun[0]?.[0]).toMatchObject({ settlement: { refusal: 'spawn-ambiguous' } });
  });

  it('killed:true with an unheld candidate ADOPTS and sets adopted = true', async () => {
    const h = fireHarness({
      ccd: { ok: false, killed: true, stderr: '' },
      after: [{ id: 'adopted-one', held: null, spawnRc: 4 }],
    });
    const { coord, calls } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 2, 1_000);
    expect(outcome).toMatchObject({ settle: 'ok' });
    if ('settle' in outcome && outcome.settle === 'ok') {
      expect(outcome.facts).toMatchObject({ sessionId: 'adopted-one', adopted: true, spawnRc: 4 });
    }
    expect(calls.markAutomationSpawn[0]?.[0]).toMatchObject({ identity: { bound: true, adopted: true } });
  });

  it('killed: UNMEASURED does not adopt and refuses spawn-unmeasured', async () => {
    const h = fireHarness({ ccd: { ok: false, stderr: '' }, after: [{ id: 'unmeasured-one' }] });
    const { coord, calls } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 3, 1_000);
    expect(outcome).toMatchObject({ settle: 'refused', refusal: 'spawn-unmeasured' });
    expect(calls.markAutomationSpawn[0]?.[0]).toMatchObject({ identity: { bound: false } });
  });

  it('a clean non-zero rc refuses spawn-refused — nothing to clean up', async () => {
    const h = fireHarness({ ccd: { ok: false, killed: false, signal: null, stderr: 'disk floor' } });
    const { coord } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 4, 1_000);
    expect(outcome).toMatchObject({ settle: 'refused', refusal: 'spawn-refused' });
  });

  it('a kill with a HELD candidate refuses spawn-cut-short, with the candidate id in the detail', async () => {
    const h = fireHarness({
      ccd: { ok: false, killed: true, stderr: '' },
      after: [{ id: 'held-candidate', held: 'program:x wave:1/3' }],
    });
    const { coord } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 5, 1_000);
    expect(outcome).toMatchObject({ settle: 'refused', refusal: 'spawn-cut-short' });
    if ('settle' in outcome && outcome.settle === 'refused') expect(outcome.detail).toContain('held-candidate');
  });

  it('an unlistable readRegistryMeasured refuses registry-unmeasurable, even though ccd exited 0', async () => {
    const h = fireHarness({
      ccd: { ok: true, stderr: '' }, after: [{ id: 'x' }], afterListed: false,
    });
    const { coord } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 6, 1_000);
    expect(outcome).toMatchObject({ settle: 'refused', refusal: 'registry-unmeasurable' });
  });

  it('sendPrompt returning draft-present is a RETRY, not a terminal failure — the ladder is live (C2.7)', async () => {
    const h = fireHarness({
      ccd: { ok: true, stderr: '' }, after: [{ id: 'pending-one' }], panes: ['❯ half-typed thought\n'],
    });
    const { coord, calls } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 7, 1_000);
    expect(outcome).toMatchObject({ pending: 'prompt', attempts: 1 });
    if ('pending' in outcome) {
      expect(outcome.facts.sessionId).toBe('pending-one');
      expect(outcome.nextAttemptAt).toBe(1_000 + promptBackoffMs(1));
    }
    // Nothing terminal: no settle, but the SOFT lease is renewed for the next sweep.
    expect(calls.settleAutomationRun.length).toBe(0);
    expect(calls.renewAutomationLease).toEqual([[1, 1_000]]);
    expect(calls.appendRunEvent.map((c) => c[1])).toEqual(['precheck', 'spawn', 'identify', 'prompt']);
    expect(calls.appendRunEvent.find((c) => c[1] === 'prompt')?.[2]).toBe(false);
  });

  it('the ladder never sends replaceDraft — even a stuck draft only ever retries', async () => {
    const h = fireHarness({
      ccd: { ok: true, stderr: '' }, after: [{ id: 'stuck-one' }], panes: ['❯ half-typed thought\n'],
    });
    const { coord } = makeAutoCoord();
    const outcome = await fireAutomation(h.buildDeps(coord), baseRow({ project: AUTO_PROJECT }), 8, 1_000);
    expect(outcome).toMatchObject({ pending: 'prompt' });
    if ('pending' in outcome) expect(outcome.detail).toContain('draft-present');
  });
});

describe('deliverPrompt — ONE attempt, the exhausted arm at the ceiling', () => {
  function fakeTmuxRunner(panes: (string | null)[]): Runner {
    let idx = 0;
    return async (cmd, args) => {
      if (cmd === 'tmux' && args[0] === 'capture-pane') {
        const pane = panes[Math.min(idx, panes.length - 1)] ?? null;
        idx++;
        return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
  }

  it('attempt 1 landing: ok, attempts=1', async () => {
    const tmux = new Tmux(fakeTmuxRunner(['scrollback\n❯ \n', 'scrollback\n❯ go\n', 'scrollback\n❯ \n']));
    const res = await deliverPrompt({ tmux, queue: new KeyedQueue() }, 'sid', 'go', 0, 1_000);
    expect(res).toEqual({ landed: true, attempts: 1 });
  });

  it('a retry below the ceiling carries the backoff and the six-member error', async () => {
    const tmux = new Tmux(fakeTmuxRunner(['❯ half-typed thought\n']));
    const res = await deliverPrompt({ tmux, queue: new KeyedQueue() }, 'sid', 'go', 1, 2_000);
    expect(res).toMatchObject({ retry: true, attempts: 2, error: 'draft-present', nextAttemptAt: 2_000 + promptBackoffMs(2) });
  });

  it('the ceiling makes attempt 6 terminal — exhausted, not another retry', async () => {
    const tmux = new Tmux(fakeTmuxRunner(['❯ half-typed thought\n']));
    const res = await deliverPrompt(
      { tmux, queue: new KeyedQueue() }, 'sid', 'go', AUTOMATION_PROMPT_MAX_ATTEMPTS - 1, 3_000,
    );
    expect(res).toMatchObject({ exhausted: true, attempts: AUTOMATION_PROMPT_MAX_ATTEMPTS, error: 'draft-present' });
  });
});

describe('promptBackoffMs / promptAttempts / promptLadder — pure (task-6-decisions.md C2.7)', () => {
  it('doubles from the base per attempt, capped at the max', () => {
    expect(promptBackoffMs(1)).toBe(AUTOMATION_PROMPT_BACKOFF_BASE_MS);
    expect(promptBackoffMs(2)).toBe(AUTOMATION_PROMPT_BACKOFF_BASE_MS * 2);
    expect(promptBackoffMs(3)).toBe(AUTOMATION_PROMPT_BACKOFF_BASE_MS * 4);
    expect(promptBackoffMs(5)).toBe(AUTOMATION_PROMPT_BACKOFF_MAX_MS);
    expect(AUTOMATION_PROMPT_BACKOFF_BASE_MS * 2 ** 4).toBeGreaterThan(AUTOMATION_PROMPT_BACKOFF_MAX_MS);
  });

  it('promptAttempts counts only failed prompt steps — an ok prompt or a failed non-prompt step do not count', () => {
    const events = [
      { step: 'prompt' as AutomationStep, ok: false }, { step: 'prompt' as AutomationStep, ok: true },
      { step: 'precheck' as AutomationStep, ok: false },
    ];
    expect(promptAttempts(events)).toBe(1);
  });

  it('promptLadder: due on a fresh run with no prompt steps yet', () => {
    expect(promptLadder([], 1_000)).toEqual({ due: true, attempts: 0 });
  });

  it('promptLadder: waiting before the backoff window elapses, due once it does', () => {
    const events = [{ step: 'prompt' as AutomationStep, ok: false, at: 1_000 }];
    const backoff = promptBackoffMs(1);
    expect(promptLadder(events, 1_000 + backoff - 1)).toEqual({ waiting: true, attempts: 1, nextAttemptAt: 1_000 + backoff });
    expect(promptLadder(events, 1_000 + backoff)).toEqual({ due: true, attempts: 1 });
  });

  it('promptLadder: exhausted at the ceiling', () => {
    const events = Array.from(
      { length: AUTOMATION_PROMPT_MAX_ATTEMPTS },
      (_, i) => ({ step: 'prompt' as AutomationStep, ok: false, at: i * 1_000 }),
    );
    expect(promptLadder(events, 999_999_999)).toEqual({ exhausted: true, attempts: AUTOMATION_PROMPT_MAX_ATTEMPTS });
  });
});

// --- Source scans: the argv vocabulary and replaceDraft ----------------------

describe('the act stays inside its own vocabulary — mechanism, not a comment', () => {
  const autoDir = path.join(serverRoot, 'src', 'auto');
  const files = readdirSync(autoDir).filter((f) => f.endsWith('.ts')).map((f) => path.join(autoDir, f));

  it('found files to scan — a coverage floor so this cannot pass on an empty scan', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it('replaceDraft appears nowhere under server/src/auto/ (GC 10)', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src.includes('replaceDraft'), `${f} mentions replaceDraft`).toBe(false);
    }
  });

  it('the only CCD_ARGV. reference under server/src/auto/ is wsAddAuto (GC 3 — no ensure/start/enable/…)', () => {
    const refs: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/CCD_ARGV\.(\w+)/g)) refs.push(m[1]!);
    }
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(['wsAddAuto']));
  });
});
