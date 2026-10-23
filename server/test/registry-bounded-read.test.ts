// A registry read costs a bounded number of agent requests (desktop polish C1, D-6388): rows are read with bounded
// concurrency through `mapBounded`, and only the field files the registry listing shows present are read. The hold
// file and the identity triple (uuid, wrapper, workdir) are read whatever the listing says. Absent and unreadable
// stay apart (D-114): a field the listing shows but whose read fails is unreadable, never absent.
//
// Every case reads a fake `FleetIO` (registryCountingIO.ts) that logs each request, so what the reader asks the
// agent link for is the thing measured, not an inference from the records it builds.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  readRegistryMeasured, readSessionRecord, REGISTRY_ROW_CONCURRENCY,
  HOLD_UNREADABLE, SUBSTRATE_UNREADABLE, STRANDED_UNREADABLE,
  type SessionRecord,
} from '../src/registry.js';
import {
  countingIO, countRounds, fleetFixture, edgeFixture, fixtureConfig, identityAndHold,
  type FakeRegistry, type Gate,
} from './registryCountingIO.js';

const cfg = fixtureConfig();
const dir = cfg.registryDir;
const at = (id: string, f: string): string => path.join(dir, `${id}.${f}`);
const tick = (): Promise<void> => new Promise((go) => { setTimeout(go, 0); });
const fieldOf = (p: string): string => path.basename(p).slice(path.basename(p).indexOf('.', 1) + 1);

afterEach(() => { vi.restoreAllMocks(); });
const quiet = (): void => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
};

/** The ids a listing shows a row for (`<id>.uuid`), sorted as the reader sorts them. */
const rowIds = (reg: FakeRegistry): string[] =>
  [...reg.files.keys()].filter((k) => k.endsWith('.uuid') && !path.basename(k).startsWith('-'))
    .map((k) => path.basename(k).slice(0, -'.uuid'.length)).sort();

/** The reader's bound on requests: the listing, then for each row the fields its listing shows plus the four
 *  reads every row pays whatever the listing says (the identity triple and the hold file). */
const requestBound = (reg: FakeRegistry): number => {
  let n = 1;
  for (const id of rowIds(reg)) {
    const listed = new Set<string>(identityAndHold);
    for (const k of reg.files.keys()) if (path.basename(k).startsWith(`${id}.`)) listed.add(fieldOf(k));
    n += listed.size;
  }
  return n;
};

describe('a registry read is bounded in requests and in rows in flight', () => {
  it('a registry read of 80 rows makes at most <present fields + the listing + the unheld rows\' hold reads> requests', async () => {
    const reg = fleetFixture(80);
    const fake = countingIO(reg);
    const read = await readRegistryMeasured(fake.io, cfg);
    expect(read.listed && read.records.length).toBe(80);
    const present = [...reg.files.keys()].filter((k) => !k.endsWith('swap.log')).length;
    const held = [...reg.files.keys()].filter((k) => k.endsWith('.hold')).length;
    // today's present-field count (identity triple included) + the listing + one hold read for every row without one
    expect(requestBound(reg)).toBe(present + 1 + (80 - held));
    expect(fake.requests.length).toBeLessThanOrEqual(requestBound(reg));
    // and no request names a field the listing did not show, unless it is one of the four unconditional reads
    const listed = new Set(reg.files.keys());
    const stray = fake.requests.filter((q) => q.op !== 'readdir' && !listed.has(q.path)
      && !(identityAndHold as readonly string[]).includes(fieldOf(q.path)));
    expect(stray).toEqual([]);
    expect(fake.requests.filter((q) => q.op === 'readdir')).toHaveLength(1);
  });

  it('the bounded read answers exactly what the serial read answers, every row and every field, absent and unreadable included', async () => {
    quiet();
    for (const reg of [edgeFixture(), fleetFixture(80)]) {
      // The reference: one single-id read at a time, in id order, through the same parser, no concurrency at all.
      const serial = countingIO(reg);
      const expected: SessionRecord[] = [];
      for (const id of rowIds(reg)) {
        const one = await readSessionRecord(serial.io, cfg, id);
        if (one.kind === 'found') expected.push(one.record);
      }
      // The bounded read, with delays that make requests finish in an order other than the one they were issued in.
      let n = 0;
      const jittered = countingIO(reg, { delayMs: () => (n++ * 7) % 5 });
      const read = await readRegistryMeasured(jittered.io, cfg);
      expect(read.listed).toBe(true);
      if (!read.listed) throw new Error('unreachable');
      expect(read.records).toEqual(expected);
      expect(read.records.map((r) => r.id)).toEqual([...read.records.map((r) => r.id)].sort());
      expect(read.names).toEqual(await jittered.io.readdir(dir));
    }
  });

  it('the listed-only read answers what the base read answered on the edge fixture', async () => {
    quiet();
    // The golden was generated ON THE BASE (aa4d287af's registry.ts, which read every field whether listed or not)
    // over `edgeFixture()`, whose listing is truthful for every file it serves: a temporary test over a scratch
    // copy of that file's source, writing `JSON.stringify({ refused, records }, null, 1)`. It is the one pin that is not circular: the serial
    // reference above shares the changed `buildRecord`, this does not. A change to a record the edge fixture
    // covers has to be a change of this file, on purpose.
    const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'registry', 'edge-base-records.json'), 'utf8')) as
      { refused: string[]; records: unknown[] };
    const read = await readRegistryMeasured(countingIO(edgeFixture()).io, cfg);
    if (!read.listed) throw new Error('unlisted');
    expect([...read.refused]).toEqual(golden.refused);
    expect(JSON.parse(JSON.stringify(read.records))).toEqual(golden.records);
  });

  it('never more than the bound in flight', async () => {
    const fake = countingIO(fleetFixture(80), { delayMs: 1 });
    await readRegistryMeasured(fake.io, cfg);
    expect(REGISTRY_ROW_CONCURRENCY).toBe(8);
    expect(fake.maxRowsInFlight()).toBeLessThanOrEqual(REGISTRY_ROW_CONCURRENCY);
  });

  it('rows are read concurrently: with a gated fake, a second row\'s first read is issued before the first row\'s reads resolve', async () => {
    const gate: Gate = { pending: [] };
    const reg = fleetFixture(80);
    const fake = countingIO(reg, { gate });
    const ids = rowIds(reg);
    const p = readRegistryMeasured(fake.io, cfg);
    await tick();
    gate.pending.splice(0).forEach((go) => go());   // the listing is the only request out; let it answer
    await tick();
    // Nothing has resolved since: every request of the rows is still held at the gate.
    const issued = (id: string): number => fake.requests.filter((q) => q.path.startsWith(at(id, ''))).length;
    expect(issued(ids[0]!)).toBeGreaterThan(0);
    expect(issued(ids[1]!)).toBeGreaterThan(0);
    expect(gate.pending.length).toBe(fake.requests.length - 1);
    const { rounds } = await countRounds(gate, () => p);
    expect(rounds).toBeGreaterThan(0);
  });

  it('a registry read takes about rows / bound rounds, not one round per row', async () => {
    const gate: Gate = { pending: [] };
    const fake = countingIO(fleetFixture(80), { gate });
    const { rounds } = await countRounds(gate, () => readRegistryMeasured(fake.io, cfg));
    // the listing, then 80 / 8 = 10 waves of rows (a row's own reads go out together, in one round)
    expect(rounds).toBeLessThanOrEqual(1 + Math.ceil(80 / REGISTRY_ROW_CONCURRENCY) + 1);
  });
});

describe('what the listing decides', () => {
  it('a field the listing shows but whose read fails is unreadable, not absent', async () => {
    quiet();
    const files = new Map<string, string>();
    const unreadable = new Set<string>();
    const put = (id: string, fields: Record<string, string>): void => {
      for (const [f, v] of Object.entries(fields)) files.set(at(id, f), v);
    };
    put('lane-a-listed', {
      uuid: 'u1', wrapper: 'lane-a', workdir: '/w', branch: 'x', class: 'x', started: '1', child: '12', substrate: 'x',
      stranded: 'x', hold: 'x',
    });
    for (const f of ['branch', 'class', 'started', 'child', 'substrate', 'stranded', 'hold']) unreadable.add(at('lane-a-listed', f));
    put('lane-a-wrapper', { uuid: 'u2', wrapper: 'lane-a', workdir: '/w' });
    unreadable.add(at('lane-a-wrapper', 'wrapper'));
    // The same reads failing, files the listing does NOT show: ordinary absence, as before.
    put('lane-a-unlisted', { uuid: 'u3', wrapper: 'lane-a', workdir: '/w' });
    for (const f of ['branch', 'class', 'started', 'child', 'substrate', 'stranded']) unreadable.add(at('lane-a-unlisted', f));
    const fake = countingIO({ files, unreadable });
    const read = await readRegistryMeasured(fake.io, cfg);
    if (!read.listed) throw new Error('unlisted');
    const by = (id: string): SessionRecord => read.records.find((r) => r.id === id)!;

    const listed = by('lane-a-listed');
    expect(listed.branchEvidence).toBe('unreadable');
    expect(listed.branch).toBeNull();
    expect(listed.route?.unreadable).toEqual(['class']);
    expect(listed.lifecycleUnmeasured).toEqual(['started']);
    expect(listed.child).toEqual({ kind: 'unreadable' });
    expect(listed.substrate).toEqual({ at: 0, text: SUBSTRATE_UNREADABLE });
    expect(listed.stranded).toEqual({ at: 0, reason: STRANDED_UNREADABLE });
    expect(listed.held).toBe(HOLD_UNREADABLE);

    expect(by('lane-a-wrapper').unmeasured).toEqual(['wrapper']);

    const unlisted = by('lane-a-unlisted');
    expect(unlisted.branchEvidence).toBe('absent');
    expect(unlisted.route).toBeNull();
    expect(unlisted.lifecycleUnmeasured).toEqual([]);
    expect(unlisted.child).toEqual({ kind: 'none' });
    expect(unlisted.substrate).toBeNull();
    expect(unlisted.stranded).toBeNull();

    // A listed field a race removed before its own read is absent, which is a different answer from unreadable.
    const raced = countingIO({ files, racedAbsent: new Set([at('lane-a-listed', 'branch')]) });
    const again = await readRegistryMeasured(raced.io, cfg);
    if (!again.listed) throw new Error('unlisted');
    expect(again.records.find((r) => r.id === 'lane-a-listed')!.branchEvidence).toBe('absent');
  });

  it('the hold file and the identity triple are read whether or not the listing shows them', async () => {
    const files = new Map<string, string>();
    // Only `<id>.uuid` is listed (it is what makes a row); the triple's other two members and the hold are served.
    files.set(at('lane-a-hidden', 'uuid'), 'u1');
    files.set(at('lane-a-hidden', 'wrapper'), 'lane-a');
    files.set(at('lane-a-hidden', 'workdir'), '/work/hidden');
    files.set(at('lane-a-hidden', 'hold'), 'held for review');
    // A row that has none of them: the reads still go out, and answer absent.
    files.set(at('lane-a-bare', 'uuid'), 'u2');
    const hidden = new Set([at('lane-a-hidden', 'wrapper'), at('lane-a-hidden', 'workdir'), at('lane-a-hidden', 'hold')]);
    const fake = countingIO({ files, hidden });
    quiet();
    const read = await readRegistryMeasured(fake.io, cfg);
    if (!read.listed) throw new Error('unlisted');
    const row = read.records.find((r) => r.id === 'lane-a-hidden')!;
    expect(row.wrapper).toBe('lane-a');
    expect(row.workdir).toBe('/work/hidden');
    expect(row.unmeasured).toEqual([]);
    expect(row.held).toBe('held for review');
    // the bare row is dropped, as today, because its wrapper is neither listed nor readable
    expect(read.records.map((r) => r.id)).toEqual(['lane-a-hidden']);
    const asked = (id: string): string[] => fake.requests.filter((q) => q.op !== 'readdir' && q.path.startsWith(at(id, ''))).map((q) => fieldOf(q.path)).sort();
    for (const id of ['lane-a-hidden', 'lane-a-bare']) {
      expect(asked(id)).toEqual(expect.arrayContaining(['uuid', 'wrapper', 'workdir', 'hold']));
    }
  });
});
