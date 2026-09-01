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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkPreClaim, checkPostClaim, PRE_CLAIM_REFUSALS, POST_CLAIM_REFUSALS,
  type FireDeps, type AutomationCoordPort,
} from '../src/auto/fire.js';
import {
  decideFire, planSchedule, failureLadder, type AutomationRow,
} from '../src/auto/schedulepolicy.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { FleetIO } from '../src/io.js';
import type { CcrcConfig } from '../src/config.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import {
  AUTOMATION_FAILURE_CEILING, AUTOMATION_MAX_CONCURRENT, AUTOMATION_PRESSURE_CEILING,
  AUTOMATION_REFUSALS, type AutomationRefusal,
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
    stat: async () => boom('stat'),
    realpath: async () => boom('realpath'),
    writeFileB64: async () => boom('writeFileB64'),
    tailFile: async () => boom('tailFile'),
  };
}

/** Same idea for rung 2 and rung 4: unset means "must not be consulted". */
function makeCoord(spec: { inFlight?: number; paused?: boolean }): AutomationCoordPort {
  return {
    inFlightAutomationRuns: () => {
      if (spec.inFlight === undefined) {
        throw new Error('unexpected inFlightAutomationRuns() — rung 1 should have refused first');
      }
      return spec.inFlight;
    },
    automationsPaused: () => {
      if (spec.paused === undefined) {
        throw new Error('unexpected automationsPaused() — an earlier rung should have refused first');
      }
      return spec.paused;
    },
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
  const files = readdirSync(autoDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(autoDir, f));

  it('found the two files this task ships', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.map((f) => path.basename(f)).sort()).toEqual(['fire.ts', 'schedulepolicy.ts']);
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
