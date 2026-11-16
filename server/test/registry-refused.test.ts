// Path identity W1a (spec §2.3): `readRegistryMeasured` names every listed
// `.uuid` whose id is not a registry id in `refused`. It never reads or
// builds such a row and never puts it in `records`. It keeps the raw name in
// `names`, because `names` is the listing, not a list of sessions. It logs
// each refused id once while it stays listed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readRegistry, readRegistryMeasured, type RegistryRead } from '../src/registry.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const VALID = 'demo-quiet-basin';
/** Sorted, the order `readRegistryMeasured` builds `refused` in. */
const REFUSED: readonly string[] = ['--actor', '.hidden', 'a#b'];

/** A row `buildRecord` keeps: wrapper, workdir and uuid, the same fields registry.test.ts seeds. */
const seedRow = (reg: string, id: string): void => {
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: `u-${id}` };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const homeWithRegistry = (): { reg: string; cfg: CcrcConfig } => {
  const home = mkTmp('ccrc-refused-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  return { reg, cfg: loadConfig({ CCRC_HOME: home }) };
};

const listedOf = (read: RegistryRead): Extract<RegistryRead, { listed: true }> => {
  if (!read.listed) throw new Error('setup: the fixture registry must list');
  return read;
};

const refusedLine = (id: string): string =>
  `ccrc-server: registry lists ${JSON.stringify(`${id}.uuid`)}, which is not a registry id — it is never read and never composed`;

/** localIO, with the first argument of every call recorded when it is a path. */
const recordingIO = (touched: string[]): FleetIO => new Proxy(localIO, {
  get(target, key, receiver) {
    const value: unknown = Reflect.get(target, key, receiver);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]): unknown => {
      if (typeof args[0] === 'string') touched.push(args[0]);
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
});

describe('readRegistryMeasured names refused rows and never reads them (spec §2.3)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const refusedLines = (): string[] =>
    warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('which is not a registry id')).sort();

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `refusedLogged` is module state. One listing that refuses nothing prunes
    // it, so every case starts with no name logged.
    await readRegistryMeasured(localIO, homeWithRegistry().cfg);
    warnSpy.mockClear();
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('--actor.uuid, .hidden.uuid and a#b.uuid beside a valid row', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    for (const id of REFUSED) seedRow(reg, id);
    const read = listedOf(await readRegistryMeasured(localIO, cfg));
    expect([...read.refused].sort()).toEqual([...REFUSED]);
    expect(read.records.map((r) => r.id)).toEqual([VALID]);
    // `names` is the listing, not a list of sessions: every raw name stays.
    expect([...read.names].sort()).toEqual((await localIO.readdir(reg))!.sort());
    expect(read.names).toEqual(expect.arrayContaining(REFUSED.map((id) => `${id}.uuid`)));
  });

  it('a refused row costs zero field reads', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    for (const id of REFUSED) seedRow(reg, id);
    const touched: string[] = [];
    listedOf(await readRegistryMeasured(recordingIO(touched), cfg));
    // CONTROL: the recorder does see the valid row's field reads.
    expect(touched.some((p) => path.basename(p).startsWith(`${VALID}.`))).toBe(true);
    expect(touched.filter((p) => REFUSED.some((id) => path.basename(p).startsWith(`${id}.`)))).toEqual([]);
  });

  it('each refused name is logged once while it stays listed, quoted by JSON.stringify', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    seedRow(reg, '--actor');
    writeFileSync(path.join(reg, 'x\ny.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor'), refusedLine('x\ny')].sort());
    // A newline in a file name cannot forge a second log line.
    expect(refusedLines().every((l) => !l.includes('\n'))).toBe(true);
  });

  it('a name that leaves and returns is logged again', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    writeFileSync(path.join(reg, '--actor.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor')]);
    rmSync(path.join(reg, '--actor.uuid'));
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor')]);
    writeFileSync(path.join(reg, '--actor.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor'), refusedLine('--actor')]);
  });

  it('a refused name holding # does not re-log on every call', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    writeFileSync(path.join(reg, 'a#b.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    await readRegistryMeasured(localIO, cfg);
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('a#b')]);
  });

  it('the retired-row early return carries refused', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    writeFileSync(path.join(reg, '--actor.uuid'), 'u');
    let listings = 0;
    // The valid row's identity reads unreadable, so the read takes its ONE
    // second listing. That listing no longer names the valid row's `.uuid`,
    // so the row retires and the read leaves by its early return.
    const reapedMidRead: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null || p !== cfg.registryDir) return names;
        listings += 1;
        return listings === 1 ? names : names.filter((n) => n !== `${VALID}.uuid`);
      },
      readFileMeasured: async (p) => (p.endsWith(`${VALID}.wrapper`)
        ? { ok: false, reason: 'unreadable' }
        : localIO.readFileMeasured(p)),
    };
    const read = listedOf(await readRegistryMeasured(reapedMidRead, cfg));
    expect(listings).toBe(2);
    expect(read.records).toEqual([]);
    expect([...read.refused]).toEqual(['--actor']);
  });

  it('readRegistry still answers records only', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    seedRow(reg, '--actor');
    const recs = await readRegistry(localIO, cfg);
    expect(Array.isArray(recs)).toBe(true);
    expect(recs.map((r) => r.id)).toEqual([VALID]);
  });
});
