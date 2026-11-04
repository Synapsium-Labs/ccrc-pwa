// Console speed S2, per-request reads: `attributionVerdict` (the box-token lanes' sender check) answers from a
// fixture registry held in memory (`registryCountingIO.ts`), one case per answer it can give. This file pins the
// answers, error word and `ok`, of the eight cases the plan names; detail text is not pinned here (the lanes'
// byte-for-byte bodies are pinned in `coord-attribution.test.ts`).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { attributionVerdict } from '../src/coord/attribution.js';
import { countingIO, fixtureConfig, type FakeRegistry } from './registryCountingIO.js';

const SENDER = 'lane-a-project-a-sess-a';
const SENDER_UUID = '00000000-0000-0000-0000-00000000000a';
const OTHER = 'lane-a-project-b-sess-b';

const cfg = fixtureConfig();
const at = (id: string, field: string): string => path.join(cfg.registryDir, `${id}.${field}`);

/** A registry of `rows` complete rows (the identity triple), the sender's first. */
function registryOf(ids: readonly string[]): FakeRegistry {
  const files = new Map<string, string>();
  ids.forEach((id, i) => {
    files.set(at(id, 'uuid'), id === SENDER ? SENDER_UUID : `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    files.set(at(id, 'wrapper'), 'lane-a');
    files.set(at(id, 'workdir'), `/work/${id}`);
  });
  return { files };
}

/** `readdir` answers `names` in addition to what the base listing holds: a listed name no file backs. */
const withListed = (io: FleetIO, ...extra: string[]): FleetIO => ({
  ...io, readdir: async (dir) => { const n = await io.readdir(dir); return n === null ? null : [...n, ...extra]; },
});

describe('characterization: attributionVerdict answers (console speed S2, step 0)', () => {
  it('the registry cannot be listed -> registry-unmeasurable', async () => {
    const io: FleetIO = { ...localIO, readdir: async () => null };
    const v = await attributionVerdict(io, cfg, SENDER, SENDER_UUID, 'byUuid');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('registry-unmeasurable');
  });

  it('the row is listed but its uuid will not read (a proven absence of bytes) -> registry-unmeasurable', async () => {
    const reg = registryOf([SENDER, OTHER]);
    reg.racedAbsent = new Set([at(SENDER, 'uuid')]);
    const v = await attributionVerdict(countingIO(reg).io, cfg, SENDER, SENDER_UUID, 'byUuid');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('registry-unmeasurable');
  });

  it('the row is listed, its identity unreadable and still listed on a second look -> registry-unmeasurable', async () => {
    const reg = registryOf([SENDER, OTHER]);
    reg.unreadable = new Set([at(SENDER, 'workdir')]);
    const v = await attributionVerdict(countingIO(reg).io, cfg, SENDER, SENDER_UUID, 'byUuid');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('registry-unmeasurable');
  });

  // The case below is the one console speed S2's single-row change moves (named in the plan's step 2).
  it('a row retired mid-read (listed, unreadable, then gone from a second listing) -> registry-unmeasurable', async () => {
    const reg = registryOf([SENDER, OTHER]);
    reg.unreadable = new Set([at(SENDER, 'uuid')]);
    const counting = countingIO(reg);
    let listings = 0;
    const io: FleetIO = {
      ...counting.io,
      readdir: async (dir) => {
        const names = await counting.io.readdir(dir);
        listings += 1;
        return listings === 1 || names === null ? names : names.filter((n) => n !== `${SENDER}.uuid`);
      },
    };
    const v = await attributionVerdict(io, cfg, SENDER, SENDER_UUID, 'byUuid');
    expect(listings).toBeGreaterThanOrEqual(2);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('registry-unmeasurable');
  });

  it('no <id>.uuid is listed -> unknown-sender', async () => {
    const reg = registryOf([OTHER]);
    const v = await attributionVerdict(countingIO(reg).io, cfg, SENDER, SENDER_UUID, 'byUuid');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('unknown-sender');
  });

  it('a bad id whose <badid>.uuid IS listed -> registry-unmeasurable (main\'s answer, measured)', async () => {
    const reg = registryOf([SENDER, OTHER]);
    const io = withListed(countingIO(reg).io, '../escape.uuid');
    const v = await attributionVerdict(io, cfg, '../escape', SENDER_UUID, 'byUuid');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('registry-unmeasurable');
  });

  it('a bad id that is not listed -> unknown-sender (main\'s answer, measured)', async () => {
    const reg = registryOf([SENDER, OTHER]);
    const io = withListed(countingIO(reg).io);
    const v = await attributionVerdict(io, cfg, '../escape', SENDER_UUID, 'byUuid');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('unknown-sender');
  });

  it('a stale uuid -> stale-uuid', async () => {
    const reg = registryOf([SENDER, OTHER]);
    const v = await attributionVerdict(countingIO(reg).io, cfg, SENDER, 'u-someone-else', 'byUuid');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.error).toBe('stale-uuid');
  });

  it('the row and its uuid agree -> ok', async () => {
    const reg = registryOf([SENDER, OTHER]);
    expect(await attributionVerdict(countingIO(reg).io, cfg, SENDER, SENDER_UUID, 'byUuid')).toEqual({ ok: true });
  });
});
