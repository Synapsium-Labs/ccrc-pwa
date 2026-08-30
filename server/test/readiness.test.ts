// The program-ready measurement (program-leverage wave 3, F3).
//
// Two halves, tested apart because they have different clocks and different
// failure modes: the pure folds in `shared/api.ts` (this file's first half)
// and the ports-fed measurement in `server/src/readiness.ts` (its second).
//
// The thing every case below is really protecting is one distinction: a
// precondition we PROVED missing and a precondition we could not measure are
// different answers, and the badge an operator reads is only worth anything if
// the code never folds them together.
import { describe, it, expect } from 'vitest';
import {
  foldSkillStates, readyVerdict, FLOOR_STATES, TOKEN_STATES, COORD_DB_STATES, READY_VERDICTS,
  isFloorState, isTokenState, isCoordDbState, isReadyVerdict,
} from '../../shared/api.js';
import { measureFleetReadiness, projectReadiness, type ReadinessDeps } from '../src/readiness.js';
import type { FleetIO } from '../src/io.js';
import { COORDINATOR_SKILL_DIR, WORKER_SKILL_DIR } from '../src/skillstate.js';


const OK = {
  worker: 'present', coordinator: 'present', floor: 'seeded',
  boxToken: 'configured', coordDb: 'available',
} as const;

describe('foldSkillStates — every rostered HOME, folded honestly', () => {
  it('is present only when every home is present', () => {
    expect(foldSkillStates(['present', 'present'])).toBe('present');
  });

  it('a PROVEN absence anywhere dominates — one home without the skill is not installed', () => {
    expect(foldSkillStates(['present', 'absent'])).toBe('absent');
  });

  it('absent OUTRANKS unmeasurable — a proven failure is not downgraded to an unknown', () => {
    expect(foldSkillStates(['unmeasurable', 'absent'])).toBe('absent');
  });

  it('unmeasurable wins over present — one home we could not read is not a clean bill', () => {
    expect(foldSkillStates(['present', 'unmeasurable'])).toBe('unmeasurable');
  });

  it('NO homes at all is unmeasurable, never a vacuous present', () => {
    // A roster with zero homeAble accounts measured nothing. "Every home has
    // it" is vacuously true of an empty set and operationally a lie, so the
    // empty fold answers with the word for "we did not find out".
    expect(foldSkillStates([])).toBe('unmeasurable');
  });
});

describe('readyVerdict — three-valued, because a boolean would collapse blocked with unknown', () => {
  it('all five preconditions ok reads ready', () => {
    expect(readyVerdict(OK)).toBe('ready');
  });

  it('a proven-missing precondition reads blocked', () => {
    expect(readyVerdict({ ...OK, worker: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordinator: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, floor: 'not-seeded' })).toBe('blocked');
    expect(readyVerdict({ ...OK, boxToken: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordDb: 'not-configured' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordDb: 'degraded' })).toBe('blocked');
  });

  it('an unmeasurable precondition reads unknown — NOT blocked', () => {
    expect(readyVerdict({ ...OK, worker: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, coordinator: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, floor: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, boxToken: 'unmeasurable' })).toBe('unknown');
  });

  it('blocked OUTRANKS unknown — a proven failure is reportable even when something else is unknown', () => {
    expect(readyVerdict({ ...OK, worker: 'absent', floor: 'unmeasurable' })).toBe('blocked');
  });
});

describe('the derived lists and guards', () => {
  it('each list has exactly its members, derived from its map', () => {
    expect([...FLOOR_STATES]).toEqual(['seeded', 'not-seeded', 'unmeasurable']);
    expect([...TOKEN_STATES]).toEqual(['configured', 'absent', 'unmeasurable']);
    expect([...COORD_DB_STATES]).toEqual(['available', 'degraded', 'not-configured']);
    expect([...READY_VERDICTS]).toEqual(['ready', 'blocked', 'unknown']);
  });

  it('each guard accepts its own members and refuses a neighbour vocabulary word', () => {
    // The neighbours matter: these four unions sit beside `SkillState` and
    // share a shape, so a guard wired to the wrong list would still look
    // right on its own members.
    expect(isFloorState('seeded')).toBe(true);
    expect(isFloorState('present')).toBe(false);
    expect(isTokenState('configured')).toBe(true);
    expect(isTokenState('seeded')).toBe(false);
    expect(isCoordDbState('available')).toBe(true);
    expect(isCoordDbState('configured')).toBe(false);
    expect(isReadyVerdict('ready')).toBe(true);
    expect(isReadyVerdict('available')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The measurement itself (server/src/readiness.ts).
//
// Ports in, values out: no fastify, no node:sqlite, no watcher. Every port is
// supplied explicitly per case so a test says exactly which of the four
// preconditions it is exercising and leaves the other three clean.
/** Typed, not `as const`: the annotation is what contextually types the
 *  returned literal as a `MeasuredRead`, and `as const` on the OUTER object
 *  does not reach the inner return (measured — it typechecked clean under
 *  vitest's esbuild and failed the tests-inclusive tsc). */
type ReadDouble = Pick<FleetIO, 'readFileMeasured'>;
type MeasuredReadDouble = Awaited<ReturnType<FleetIO['readFileMeasured']>>;

const okRead: ReadDouble = { readFileMeasured: async () => ({ ok: true, content: 'x' }) };

const deps = (over: Partial<ReadinessDeps> = {}): ReadinessDeps => ({
  io: okRead,
  localIo: okRead,
  homes: [{ wrapper: 'claude', configDir: '/cfg-a' }],
  mailTokenPath: '/tok',
  coordProbe: () => 'available',
  now: () => 1_700_000_000_000,
  ...over,
});

describe('measureFleetReadiness — the fleet-wide half', () => {
  it('reads BOTH skills in EVERY home over the WIRE, and nothing else', async () => {
    // The token is deliberately NOT here: it is a server-local read now
    // (MAJOR 1). What this pins is the wire cost — 2 per rostered home.
    const seen: string[] = [];
    const io: ReadDouble = { readFileMeasured: async (p: string) => {
      seen.push(p); return { ok: true, content: 'x' };
    } };
    await measureFleetReadiness(deps({
      io, homes: [{ wrapper: 'a', configDir: '/a' }, { wrapper: 'b', configDir: '/b' }],
    }));
    expect(seen).toEqual([
      `/a/skills/${WORKER_SKILL_DIR}/SKILL.md`, `/a/skills/${COORDINATOR_SKILL_DIR}/SKILL.md`,
      `/b/skills/${WORKER_SKILL_DIR}/SKILL.md`, `/b/skills/${COORDINATOR_SKILL_DIR}/SKILL.md`,
    ]);
  });

  it('folds a home that is missing the worker skill into a proven absence', async () => {
    const io: ReadDouble = { readFileMeasured: async (p: string) => (p.includes(WORKER_SKILL_DIR)
      ? { ok: false, reason: 'absent' } : { ok: true, content: 'x' }) };
    const r = await measureFleetReadiness(deps({ io }));
    expect(r.worker).toBe('absent');
    expect(r.coordinator).toBe('present');
  });

  it('a home whose read FAILED is unmeasurable, never absent', async () => {
    const io: ReadDouble = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    const r = await measureFleetReadiness(deps({ io }));
    expect(r.worker).toBe('unmeasurable');
    expect(r.coordinator).toBe('unmeasurable');
  });

  it('a wrapper with no config dir is unmeasurable for that home, not absent', async () => {
    // `configDirFor` answers undefined for a wrapper this box's roster does
    // not carry — a missing PATH, which is not a missing skill.
    const r = await measureFleetReadiness(
      deps({ homes: [{ wrapper: 'ghost', configDir: undefined }] }));
    expect(r.worker).toBe('unmeasurable');
    expect(r.coordinator).toBe('unmeasurable');
  });

  it('the box token is RE-MEASURED at the path, so all three arms are reachable', async () => {
    // D-1025: the boot read has only two outcomes — a string, or a process
    // that never started. Re-measuring is what makes the third arm real.
    const gone: ReadDouble = { readFileMeasured: async () => ({ ok: false, reason: 'absent' }) };
    const broken: ReadDouble = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    expect((await measureFleetReadiness(deps())).boxToken).toBe('configured');
    expect((await measureFleetReadiness(deps({ localIo: gone }))).boxToken).toBe('absent');
    expect((await measureFleetReadiness(deps({ localIo: broken }))).boxToken).toBe('unmeasurable');
  });

  it('the token VALUE never leaves the measurement — only its measurability', async () => {
    const io: ReadDouble = { readFileMeasured: async () => ({ ok: true, content: 'not-a-real-secret-value' }) };
    const r = await measureFleetReadiness(deps({ io, localIo: io }));
    expect(JSON.stringify(r)).not.toContain('not-a-real-secret-value');
  });

  it('carries the coord probe verbatim — it does not re-decide it', async () => {
    for (const s of ['available', 'degraded', 'not-configured'] as const) {
      expect((await measureFleetReadiness(deps({ coordProbe: () => s }))).coordDb).toBe(s);
    }
  });

  it('stamps the sweep time from the injected clock', async () => {
    expect((await measureFleetReadiness(deps())).at).toBe(1_700_000_000_000);
  });
});

describe('projectReadiness — the per-project compose', () => {
  const fleet = {
    worker: 'present', coordinator: 'present', boxToken: 'configured',
    coordDb: 'available', at: 7,
  } as const;

  it('joins the project floor to the fleet half and derives the verdict once', () => {
    expect(projectReadiness(fleet, 'seeded')).toEqual({
      worker: 'present', coordinator: 'present', floor: 'seeded',
      boxToken: 'configured', coordDb: 'available', verdict: 'ready', at: 7,
    });
  });

  it('an unseeded floor blocks; an unmeasurable one is only unknown', () => {
    expect(projectReadiness(fleet, 'not-seeded').verdict).toBe('blocked');
    expect(projectReadiness(fleet, 'unmeasurable').verdict).toBe('unknown');
  });

  it('carries the fleet half through unchanged — it measures nothing of its own', () => {
    const degraded = { ...fleet, worker: 'absent', coordDb: 'degraded' } as const;
    expect(projectReadiness(degraded, 'seeded')).toMatchObject(
      { worker: 'absent', coordDb: 'degraded', at: 7 });
  });
});

// --- fix round 1, MAJOR 1 -------------------------------------------------
// The box token is a SERVER-LOCAL fact and must not ride the fleet io.
//
// On the live topology `CCRC_FLEET=remote` is standing config, so `deps.io` is
// the agent-backed FleetIO: handing it `cfg.mailTokenPath` asks the FLEET
// box's agent to read a path that describes the SERVER box. The agent's read
// whitelist has no `.ccrc` arm, so the refusal arrives as `unreadable` ->
// `unmeasurable` -> the verdict could never answer `ready` on the real fleet.
// And whitelisting it would be worse, not better: the fleet host's own token
// lives elsewhere, so the read would answer `absent` -> `blocked`, which is a
// lie rather than an unknown.
describe('the box token is measured on the SERVER box, not across the fleet', () => {
  /** The production shape: a fleet io that refuses `.ccrc` exactly as the
   *  agent whitelist does, beside a local io that can read the file. */
  const fleetRefusingCcrc: ReadDouble = {
    readFileMeasured: async (p: string) => (p.includes('.ccrc')
      ? { ok: false, reason: 'unreadable' } : { ok: true, content: 'x' }),
  };

  /** The real shape of `cfg.mailTokenPath` (`config.ts`: `<home>/.ccrc/
   *  mail.token`). Spelled out because a token path WITHOUT `.ccrc` in it does
   *  not reproduce the defect at all — the first draft of this fixture used
   *  `/tok` and PASSED against the broken code. */
  const TOKEN_PATH = '/srv-home/.ccrc/mail.token';

  it('answers configured when the FLEET io refuses .ccrc but the local read succeeds', () => {
    // THIS FIXTURE IS THE LIVE TOPOLOGY. Before the split it answered
    // `unmeasurable`, which is why `ready` was unreachable in production.
    return expect(measureFleetReadiness(deps({
      io: fleetRefusingCcrc, mailTokenPath: TOKEN_PATH,
      localIo: { readFileMeasured: async () => ({ ok: true, content: 'tok' }) },
    })).then((r) => r.boxToken)).resolves.toBe('configured');
  });

  it('asks the LOCAL io for the token path and never the fleet io', () => {
    const fleetSaw: string[] = [];
    const localSaw: string[] = [];
    return measureFleetReadiness(deps({
      mailTokenPath: TOKEN_PATH,
      io: { readFileMeasured: async (p: string) => {
        fleetSaw.push(p); return { ok: true, content: 'x' };
      } },
      localIo: { readFileMeasured: async (p: string) => {
        localSaw.push(p); return { ok: true, content: 'tok' };
      } },
    })).then(() => {
      expect(localSaw).toEqual([TOKEN_PATH]);
      expect(fleetSaw.some((p) => p === TOKEN_PATH)).toBe(false);
    });
  });

  it('still asks the FLEET io for the skills — those DO live on the fleet box', () => {
    // The split is not "everything local": a wrapper HOME's skills are on the
    // fleet host and the agent whitelist permits them. Collapsing both onto
    // one io in either direction is wrong.
    const fleetSaw: string[] = [];
    return measureFleetReadiness(deps({
      mailTokenPath: TOKEN_PATH,
      io: { readFileMeasured: async (p: string) => {
        fleetSaw.push(p); return { ok: true, content: 'x' };
      } },
      localIo: { readFileMeasured: async () => ({ ok: true, content: 'tok' }) },
    })).then(() => {
      expect(fleetSaw).toEqual([
        `/cfg-a/skills/${WORKER_SKILL_DIR}/SKILL.md`,
        `/cfg-a/skills/${COORDINATOR_SKILL_DIR}/SKILL.md`,
      ]);
    });
  });

  it('keeps all three token arms reachable through the local port', () => {
    const arm = (read: MeasuredReadDouble) => measureFleetReadiness(
      deps({ io: fleetRefusingCcrc, mailTokenPath: TOKEN_PATH,
        localIo: { readFileMeasured: async () => read } }),
    ).then((r) => r.boxToken);
    return Promise.all([
      arm({ ok: true, content: 'tok' }),
      arm({ ok: false, reason: 'absent' }),
      arm({ ok: false, reason: 'unreadable' }),
    ]).then((got) => expect(got).toEqual(['configured', 'absent', 'unmeasurable']));
  });
});
