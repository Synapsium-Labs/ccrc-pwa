// The caps decision's pure half. `CoordStore.setCaps` binds both fields straight
// into an UPDATE with no integer check, no bounds and no NaN guard (D-1164) —
// 0, -5, 1.5 and 1e9 all persist today — and nothing in server/src had ever
// called it, so the absence never showed. This is the check that has to exist
// before a route does, and it REFUSES rather than clamps: a clamp would store a
// number the operator did not ask for and answer 200.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAP_MAX, CAP_MIN, HOST_RESERVE_BYTES, RUNS_PER_CORE, RUN_MEMORY_BUDGET_BYTES, capAutomaticNotice, capNowOf, capNowWord, decideCaps,
  deriveCap,
} from '../src/coord/caps.js';
import type { CoordCaps } from '../../shared/api.js';
import { readCapNow } from '../../shared/runCap.js';
import type { HostMachineReading } from '../../shared/pressure.js';

const CURRENT: CoordCaps = { maxConcurrentWorkers: 3 };

describe('decideCaps', () => {
  it('takes the workers cap', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 5 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 5 }, mode: 'override' });
  });

  // The daily brake is retired (D-7068). Its field is accepted from an older PWA and IGNORED: never
  // merged, never validated, and a body carrying nothing else is its own verdict, not a write.
  it('ignores the retired daily field beside a live one, whatever its value', () => {
    for (const legacy of [16, 0, CAP_MAX + 1, 2.5, 'x']) {
      expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSessionsPerDay: legacy }), String(legacy))
        .toEqual({ ok: true, next: { maxConcurrentWorkers: 4 }, mode: 'override' });
    }
  });

  it('a body with only the retired daily field is the retired verdict, not a write and not a 400', () => {
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 20 }))
      .toEqual({ ok: 'retired', retired: ['maxSessionsPerDay'] });
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 0 }))
      .toEqual({ ok: 'retired', retired: ['maxSessionsPerDay'] });
  });

  it('refuses a body that asks for nothing — a no-op write is a caller bug, not a write', () => {
    // Not an overloaded success: answering ok to a request that changes nothing
    // makes "the caps are now what you sent" and "you sent nothing" the same 200.
    const r = decideCaps(CURRENT, {});
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ detail: expect.stringContaining('at least one of') });
  });

  it.each([
    ['zero workers — the wedge no door can undo', { maxConcurrentWorkers: 0 }],
    ['negative', { maxConcurrentWorkers: -1 }],
    ['fractional', { maxConcurrentWorkers: 1.5 }],
    ['above the ceiling', { maxConcurrentWorkers: CAP_MAX + 1 }],
    ['a numeric string', { maxConcurrentWorkers: '4' }],
    ['null', { maxConcurrentWorkers: null }],
    ['NaN', { maxConcurrentWorkers: Number.NaN }],
    ['Infinity', { maxConcurrentWorkers: Number.POSITIVE_INFINITY }],
  ])('refuses %s', (_label, body) => {
    expect(decideCaps(CURRENT, body).ok).toBe(false);
  });

  it('accepts exactly the boundary values', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MIN }).ok).toBe(true);
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MAX }).ok).toBe(true);
  });

  it('refuses a non-object body without throwing, and SAYS it was not an object', () => {
    // The detail is the assertion, not just `ok:false`. Every one of these
    // bodies also has no settable field, so they all reach the asks-for-nothing
    // refusal too — measured: asserting `ok === false` alone leaves the
    // shape guard unwitnessed, and an unwitnessed guard is the absence-assertion
    // -whose-fixture-cannot-produce-the-presence defect this program keeps
    // finding. Telling a caller who posted `4` that it is missing a field would
    // be true and useless.
    for (const body of [null, undefined, 4, 'caps', [], true]) {
      expect(decideCaps(CURRENT, body), `body ${JSON.stringify(body) ?? 'undefined'}`)
        .toEqual({ ok: false, detail: 'body must be an object' });
    }
  });

  it('an ARRAY is refused as a non-object, not as a body missing its fields', () => {
    // `typeof [] === 'object'` and an array is not null, so without the
    // `Array.isArray` arm this lands on the asks-for-nothing refusal and reads
    // as a caller who forgot a field rather than one who sent the wrong shape.
    expect(decideCaps(CURRENT, [])).toEqual({ ok: false, detail: 'body must be an object' });
    expect(decideCaps(CURRENT, [{ maxConcurrentWorkers: 4 }]))
      .toEqual({ ok: false, detail: 'body must be an object' });
  });

  it('ignores an unknown extra key rather than refusing over it', () => {
    // Additive tolerance, per the wire rule: a newer client's third field must
    // not be a 400 from an older server.
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSomethingElse: 9 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 4 }, mode: 'override' });
  });

  it('names the offending field in the detail', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 0 }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('maxConcurrentWorkers') });
  });

  it('CAP_MIN is one, because zero workers is a wedge with no release valve', () => {
    // The number itself is the guard: dispatch refuses on `running >= cap`, so a
    // stored 0 refuses every dispatch for ever, and unlike the pause marker there
    // is no ungated door to lower it again.
    expect(CAP_MIN).toBe(1);
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MIN - 1 }).ok).toBe(false);
  });
});

// D-8920: the body's additive `mode`. A number is the operator's override; `automatic` clears it.
describe('decideCaps: automatic and override (D-8920)', () => {
  it('a number alone is an override, as an older console sends it', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 12 })).toEqual({ ok: true, next: { maxConcurrentWorkers: 12 }, mode: 'override' });
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 12, mode: 'override' }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 12 }, mode: 'override' });
  });

  it('automatic clears the override and keeps the stored number, which is used while the host is unmeasured', () => {
    expect(decideCaps(CURRENT, { mode: 'automatic' })).toEqual({ ok: true, next: CURRENT, mode: 'automatic' });
    // An older console's retired dial beside it changes nothing.
    expect(decideCaps(CURRENT, { mode: 'automatic', maxSessionsPerDay: 9 })).toEqual({ ok: true, next: CURRENT, mode: 'automatic' });
  });

  it('refuses automatic WITH a number: the two ask for opposite things', () => {
    const r = decideCaps(CURRENT, { mode: 'automatic', maxConcurrentWorkers: 12 });
    expect(r).toMatchObject({ ok: false, detail: expect.stringContaining('automatic') });
  });

  it('refuses override with no number: there is nothing to override with', () => {
    const r = decideCaps(CURRENT, { mode: 'override' });
    expect(r).toMatchObject({ ok: false, detail: expect.stringContaining('maxConcurrentWorkers') });
  });

  it('refuses a mode it does not know, alone or beside a number, and never reads it as an override', () => {
    for (const mode of ['auto', 'AUTOMATIC', '', 1, true, null, {}]) {
      for (const body of [{ mode }, { mode, maxConcurrentWorkers: 12 }]) {
        expect(decideCaps(CURRENT, body), JSON.stringify(body))
          .toEqual({ ok: false, detail: 'mode must be automatic or override' });
      }
    }
  });

  it('an override is still held to the bounds', () => {
    expect(decideCaps(CURRENT, { mode: 'override', maxConcurrentWorkers: 0 }).ok).toBe(false);
    expect(decideCaps(CURRENT, { mode: 'override', maxConcurrentWorkers: CAP_MAX + 1 }).ok).toBe(false);
  });
});

// D-8920: THE DERIVED CAP. One formula, each term and each clamp with a row that fails without it.
describe('deriveCap (D-8920)', () => {
  const GiB = 2 ** 30;
  const measured = (memGiB: number, cores: number, limitGiB?: number): HostMachineReading => ({ kind: 'measured',
    machine: { memTotalBytes: Math.round(memGiB * GiB), cores, sessionMemLimit: limitGiB === undefined ? 'none' : Math.round(limitGiB * GiB) } });

  it('the constants are the ones the formula comment states', () => {
    expect(RUN_MEMORY_BUDGET_BYTES).toBe(3 * GiB);
    expect(HOST_RESERVE_BYTES).toBe(8 * GiB);
    expect(RUNS_PER_CORE).toBe(1);
  });

  // [memory GiB, cores, cap, bound]. The memory term is floor((mem - 8) / 3); the core term is the cores.
  it.each([
    // A neutral example host: 64 GiB and 16 cores. Memory allows 18, the cores 16.
    [64, 16, 16, 'cores'],
    // The same memory with more cores: memory decides. Fails if the reserve or the budget is dropped.
    [64, 32, 18, 'memory'],
    // The reserve is taken off BEFORE the division: 32 GiB is 8 runs, not 10.
    [32, 64, 8, 'memory'],
    // The division rounds DOWN: 19 GiB leaves 11 GiB, which is 3 runs and not 4.
    [19, 64, 3, 'memory'],
    // Exactly one budget above the reserve is one run, by memory.
    [11, 64, 1, 'memory'],
    // A tie goes to the memory, the term the formula is conservative about.
    [56, 16, 16, 'memory'],
    // Few cores on a large box: the cores decide.
    [256, 4, 4, 'cores'],
    // A box at or below the reserve: the terms come to nothing, and the floor keeps one run (a cap of 0 refuses all).
    [8, 16, CAP_MIN, 'floor'],
    [4, 16, CAP_MIN, 'floor'],
    [10, 16, CAP_MIN, 'floor'],
    // A very large box: the ceiling an operator's own number is held to.
    [1024, 256, CAP_MAX, 'ceiling'],
    [8 + 3 * (CAP_MAX + 1), CAP_MAX + 1, CAP_MAX, 'ceiling'],
    // Exactly the ceiling by the terms is the terms' own answer, not the clamp's.
    [8 + 3 * CAP_MAX, 512, CAP_MAX, 'memory'],
  ] as const)('%s GiB and %s cores derive %s (%s)', (memGiB, cores, cap, bound) => {
    expect(deriveCap(measured(memGiB, cores)))
      .toEqual({ kind: 'measured', cap, bound, memTotalBytes: Math.round(memGiB * GiB), cores });
  });

  // THE SESSIONS' MEMORY LIMIT is a term of its own, decided here: the box's memory is never folded with it before it
  // arrives, so the answer can say which one set the cap and carry both figures.
  // [memory GiB, cores, limit GiB, cap, bound]. The limit term is floor(limit / 3): no reserve comes off it.
  it.each([
    // THE DEFAULT-CONFIGURED BOX: sessions limited to 24 GiB on a 64 GiB, 16-core host. The limit decides, at 8.
    // Fails if the limit is ignored (16, cores) and if the reserve is taken off it (5).
    [64, 16, 24, 8, 'session-limit'],
    // The limit term rounds DOWN: 25 GiB is still 8 runs.
    [64, 16, 25, 8, 'session-limit'],
    // A limit above what the box's memory allows changes nothing: the box's own term or the cores decide.
    [64, 16, 200, 16, 'cores'],
    [64, 32, 200, 18, 'memory'],
    // A tie between the box's memory and the limit names the memory.
    [64, 32, 54, 18, 'memory'],
    // A tie between the limit and the cores names the limit.
    [64, 8, 24, 8, 'session-limit'],
    // The cores below the limit: the cores decide.
    [64, 4, 24, 4, 'cores'],
    // A limit below one budget: the terms come to nothing, and the floor keeps one run.
    [64, 16, 2, CAP_MIN, 'floor'],
    // A very large limit on a very large box is still under the ceiling.
    [1024, 256, 512, CAP_MAX, 'ceiling'],
  ] as const)('%s GiB, %s cores and sessions limited to %s GiB derive %s (%s)', (memGiB, cores, limitGiB, cap, bound) => {
    expect(deriveCap(measured(memGiB, cores, limitGiB)))
      .toEqual({ kind: 'measured', cap, bound, memTotalBytes: memGiB * GiB, cores, sessionMemLimitBytes: limitGiB * GiB });
  });

  it('no limit on the sessions is no term and no figure: the answer carries no sessionMemLimitBytes', () => {
    expect(deriveCap(measured(64, 16))).not.toHaveProperty('sessionMemLimitBytes');
  });

  it('an unmeasured host derives NOTHING, and keeps its reason: never a cap of zero and never a guess', () => {
    for (const why of ['no-reading', 'agent-older', 'read-failed'] as const) {
      expect(deriveCap({ kind: 'unmeasured', why })).toEqual({ kind: 'unmeasured', why });
    }
  });

  it('a limit that could not be read derives nothing: the box\'s memory could overstate what the sessions have', () => {
    expect(deriveCap({ kind: 'measured', machine: { memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 'unreadable' } }))
      .toEqual({ kind: 'unmeasured', why: 'read-failed' });
  });

  // THE DECISION TRUSTS NO CALLER. Both adapters validate through `readHostMachine`, but a NaN let through here would
  // come out as a cap of NaN, and `running >= NaN` is false: the cap would refuse nothing. Each row derives nothing.
  it.each([
    ['NaN memory', Number.NaN, 16, 'none'],
    ['NaN cores', 64 * 2 ** 30, Number.NaN, 'none'],
    ['NaN limit', 64 * 2 ** 30, 16, Number.NaN],
    ['zero memory', 0, 16, 'none'],
    ['zero cores', 64 * 2 ** 30, 0, 'none'],
    ['a zero limit', 64 * 2 ** 30, 16, 0],
    ['negative memory', -1, 16, 'none'],
    ['negative cores', 64 * 2 ** 30, -1, 'none'],
    ['infinite memory', Number.POSITIVE_INFINITY, 16, 'none'],
    ['infinite cores', 64 * 2 ** 30, Number.POSITIVE_INFINITY, 'none'],
  ] as const)('%s is no size: it derives nothing, and the stored number is used', (_name, memTotalBytes, cores, sessionMemLimit) => {
    const host: HostMachineReading = { kind: 'measured', machine: { memTotalBytes, cores, sessionMemLimit } };
    expect(deriveCap(host)).toEqual({ kind: 'unmeasured', why: 'read-failed' });
    const now = capNowOf({ maxConcurrentWorkers: 7 }, 'automatic', host);
    expect(now.cap, 'the cap in force is the stored number, never NaN').toBe(7);
  });

  it('every derived cap is a whole number inside the bounds', () => {
    for (const mem of [1, 7.9, 8, 8.1, 16, 31.5, 64, 128, 500, 4096]) {
      for (const cores of [1, 2, 8, 16, 96, 1024]) {
        for (const limit of [undefined, 1, 24, 4096]) {
          const d = deriveCap(measured(mem, cores, limit));
          if (d.kind !== 'measured') throw new Error('a measured host derived nothing');
          expect(Number.isInteger(d.cap) && d.cap >= CAP_MIN && d.cap <= CAP_MAX, `${mem} GiB / ${cores} / ${limit}`).toBe(true);
        }
      }
    }
  });
});

// D-8920: THE CAP NOW. The override if one stands, else the derived cap, else the stored number.
describe('capNowOf (D-8920)', () => {
  const GiB = 2 ** 30;
  const HOST: HostMachineReading = { kind: 'measured', machine: { memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 'none' } };
  const LIMITED: HostMachineReading = { kind: 'measured', machine: { memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 24 * GiB } };
  const UNMEASURED: HostMachineReading = { kind: 'unmeasured', why: 'agent-older' };
  const DERIVED = { kind: 'measured', cap: 16, bound: 'cores', memTotalBytes: 64 * GiB, cores: 16 } as const;
  const STORED: CoordCaps = { maxConcurrentWorkers: 24 };

  it('automatic and measured: the derived cap, whatever number is stored', () => {
    expect(capNowOf(STORED, 'automatic', HOST)).toEqual({ mode: 'automatic', cap: 16, derived: DERIVED });
    expect(capNowOf({ maxConcurrentWorkers: 2 }, 'automatic', HOST).cap).toBe(16);
  });

  it('automatic and unmeasured: the stored number, and the answer says the host is unmeasured, and why', () => {
    expect(capNowOf(STORED, 'automatic', UNMEASURED))
      .toEqual({ mode: 'automatic', cap: 24, derived: { kind: 'unmeasured', why: 'agent-older' } });
  });

  it('override: the operator\'s number, above or below the derived cap, which is still reported', () => {
    expect(capNowOf({ maxConcurrentWorkers: 12 }, 'override', HOST)).toEqual({ mode: 'override', cap: 12, derived: DERIVED });
    expect(capNowOf({ maxConcurrentWorkers: 40 }, 'override', HOST)).toEqual({ mode: 'override', cap: 40, derived: DERIVED });
    expect(capNowOf({ maxConcurrentWorkers: 12 }, 'override', UNMEASURED))
      .toEqual({ mode: 'override', cap: 12, derived: { kind: 'unmeasured', why: 'agent-older' } });
  });

  it('every answer round-trips through the console\'s one reader', () => {
    for (const mode of ['automatic', 'override'] as const) {
      for (const host of [HOST, LIMITED, UNMEASURED, { kind: 'unmeasured', why: 'no-reading' } as const, { kind: 'unmeasured', why: 'read-failed' } as const]) {
        const now = capNowOf(STORED, mode, host);
        expect(readCapNow({ capNow: now })).toEqual(now);
      }
    }
  });

  it('the feed word says which kind of cap it is', () => {
    expect(capNowWord(capNowOf({ maxConcurrentWorkers: 12 }, 'override', HOST))).toBe('12');
    expect(capNowWord(capNowOf(STORED, 'automatic', HOST))).toBe('automatic (16)');
    expect(capNowWord(capNowOf(STORED, 'automatic', UNMEASURED))).toBe('automatic (24, host unmeasured)');
  });
});

// D-8920: THE AUTOMATIC CAP'S OWN FEED RECORD. An automatic cap moves with no operator act, so the move
// is recorded once: the stored number the box would otherwise run on, and the derived cap it runs on instead.
describe('capAutomaticNotice (D-8920)', () => {
  const GiB = 2 ** 30;
  const HOST: HostMachineReading = { kind: 'measured', machine: { memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 'none' } };
  const now = (stored: number, mode: 'automatic' | 'override', host: HostMachineReading = HOST) => capNowOf({ maxConcurrentWorkers: stored }, mode, host);

  it('automatic, measured, and not the stored number: one record naming both, keyed on the write and the cap', () => {
    expect(capAutomaticNotice({ maxConcurrentWorkers: 3 }, null, now(3, 'automatic')))
      .toEqual({ body: 'workers 3 → automatic (16)', dedupeKey: 'run-cap:automatic:0:16' });
    expect(capAutomaticNotice({ maxConcurrentWorkers: 24 }, 77, now(24, 'automatic')))
      .toEqual({ body: 'workers 24 → automatic (16)', dedupeKey: 'run-cap:automatic:77:16' });
  });

  it('nothing to record: an override, an unmeasured host, or a derived cap equal to the stored number', () => {
    expect(capAutomaticNotice({ maxConcurrentWorkers: 3 }, 5, now(3, 'override'))).toBeNull();
    expect(capAutomaticNotice({ maxConcurrentWorkers: 3 }, 5, now(3, 'automatic', { kind: 'unmeasured', why: 'no-reading' }))).toBeNull();
    expect(capAutomaticNotice({ maxConcurrentWorkers: 16 }, 5, now(16, 'automatic'))).toBeNull();
    // It trusts no caller: an override whose cap is NOT the stored number cannot come from `capNowOf`, and is still no
    // automatic cap to record.
    expect(capAutomaticNotice({ maxConcurrentWorkers: 3 }, 5, { ...now(3, 'automatic'), mode: 'override' })).toBeNull();
  });

  it('the key moves with the stored number\'s write and with the derived cap, and with nothing else', () => {
    const key = (updatedAt: number | null, host: HostMachineReading): string =>
      capAutomaticNotice({ maxConcurrentWorkers: 3 }, updatedAt, now(3, 'automatic', host))!.dedupeKey;
    const bigger: HostMachineReading = { kind: 'measured', machine: { memTotalBytes: 128 * GiB, cores: 32, sessionMemLimit: 'none' } };
    const sameCap: HostMachineReading = { kind: 'measured', machine: { memTotalBytes: 96 * GiB, cores: 16, sessionMemLimit: 'none' } };
    expect(key(5, HOST)).toBe(key(5, HOST));
    expect(key(5, HOST), 'a host that derives the same cap from other figures is not a new record').toBe(key(5, sameCap));
    expect(key(5, HOST), 'a new write of the stored number is').not.toBe(key(6, HOST));
    expect(key(5, HOST), 'a host that derives a new cap is').not.toBe(key(5, bigger));
  });
});

describe('readCapNow, the one reader of CoordCapsView.capNow (D-8920)', () => {
  const GOOD = { mode: 'automatic', cap: 16, derived: { kind: 'measured', cap: 16, bound: 'cores', memTotalBytes: 64 * 2 ** 30, cores: 16 } };
  const LIMITED = { mode: 'automatic', cap: 8,
    derived: { kind: 'measured', cap: 8, bound: 'session-limit', memTotalBytes: 64 * 2 ** 30, cores: 16, sessionMemLimitBytes: 24 * 2 ** 30 } };

  it('an older server (no field) and anything malformed are null, never a cap', () => {
    expect(readCapNow({ caps: { maxConcurrentWorkers: 3 } })).toBeNull();
    expect(readCapNow(null)).toBeNull();
    expect(readCapNow({ capNow: GOOD })).toEqual(GOOD);
    expect(readCapNow({ capNow: LIMITED })).toEqual(LIMITED);
    const bad: unknown[] = [
      null, 7, [], { ...GOOD, mode: 'auto' }, { ...GOOD, cap: 0 }, { ...GOOD, cap: 1.5 }, { ...GOOD, cap: '16' },
      { ...GOOD, derived: null }, { ...GOOD, derived: { kind: 'other' } },
      { ...GOOD, derived: { ...GOOD.derived, cap: 0 } }, { ...GOOD, derived: { ...GOOD.derived, bound: 'disk' } },
      { ...GOOD, derived: { ...GOOD.derived, memTotalBytes: -1 } }, { ...GOOD, derived: { ...GOOD.derived, cores: 0 } },
      { ...GOOD, derived: { ...GOOD.derived, sessionMemLimitBytes: 0 } }, { ...GOOD, derived: { ...GOOD.derived, sessionMemLimitBytes: 'none' } },
    ];
    for (const capNow of bad) expect(readCapNow({ capNow }), JSON.stringify(capNow)).toBeNull();
  });

  it('an unmeasured answer keeps its reason; one with no reason, or one this build does not know, reads no-reading', () => {
    const un = (derived: unknown): unknown => readCapNow({ capNow: { mode: 'automatic', cap: 3, derived } })?.derived;
    for (const why of ['no-reading', 'agent-older', 'read-failed']) expect(un({ kind: 'unmeasured', why })).toEqual({ kind: 'unmeasured', why });
    expect(un({ kind: 'unmeasured' })).toEqual({ kind: 'unmeasured', why: 'no-reading' });
    expect(un({ kind: 'unmeasured', why: 'on-fire' })).toEqual({ kind: 'unmeasured', why: 'no-reading' });
  });
});

/**
 * D-1219 — THE L1 PURITY CLAIM, WITH A MECHANISM UNDER IT.
 *
 * `caps.ts`'s opening docstring said "L1: pure — the DECISION about a caps
 * write, with no clock, no fs and no `reply` (`single-definition.test.ts`'s
 * coord-ring scan)". The parenthesis was a miscitation: that scan asserts three
 * things and none of them is any of these — no `./db.js` import, no
 * `node:sqlite` import, no `coord.db`/`store.db` receiver. Measured by the
 * coordinator's review: adding an `fs` import and a module-scope `Date.now()` to
 * this file left `single-definition` 99/99 green.
 *
 * A citation is load-bearing in a way a bare claim is not — a maintainer reads
 * "checked by X" and stops looking. So either the claim stands down to a stated
 * convention or it gets a check. It gets a check, because D-1169's own next step
 * is to move the moment of the write INTO the decision, and that is exactly the
 * change that would quietly make this file impure.
 *
 * ONE FILE, not a ring-wide sweep: this is the property `caps.ts` asserts about
 * itself. Widening it to every L1 module in `coord/` would be a different
 * change, with a different blast radius, and is not what the miscited sentence
 * promised.
 */
describe('caps.ts is the pure module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'caps.ts'),
    'utf8');

  /** Comments blanked, positions preserved — `dispatch-mutex-gate.test.ts`'s
   *  helper in miniature. Without it this file's own docstring, which NAMES
   *  `fs` and `reply` while promising not to use them, reds every assertion
   *  below. Measured: it did, on the first run. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    // The floor every negative assertion below needs: `''` contains none of them.
    expect(code()).toContain('export function decideCaps');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock', () => {
    // D-1169 wants the write's moment inside the decision. When that lands, the
    // moment arrives as an ARGUMENT — this red is the reminder, not an obstacle.
    expect(code(), 'caps.ts reads the clock — the decision is no longer pure')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
  });

  it('has no fs and no other node builtin', () => {
    expect(code(), 'caps.ts imports a node builtin').not.toMatch(/from\s+'node:/);
    expect(code(), 'caps.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });

  it('has no fastify, no reply, no store', () => {
    expect(code(), 'caps.ts names a reply — an L1 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
    expect(code(), 'caps.ts reaches the store — an L1 decision does not read rows')
      .not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\./);
  });

  it('imports TYPES only, which is what L1 may take from L2', () => {
    // `architecture:78-81` allows L1 to import L2 as types. Every import line in
    // this file must therefore be a type import — a value import from anywhere is
    // the thing this ring rule forbids.
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!);
    expect(imports.length, 'no imports found — the scan is over nothing')
      .toBeGreaterThan(0);
    for (const line of imports) {
      expect(line, `caps.ts takes a VALUE import: ${line.trim()}`).toMatch(/^\s*import\s+type\b/);
    }
  });
});
