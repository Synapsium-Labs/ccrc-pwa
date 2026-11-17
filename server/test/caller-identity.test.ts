// Overlord W1 gates, Task 2: the `CallerIdentity` port's attribution adapter (spec §3.6 H2, §7.4 C27). Driven over a fixture
// registry held in memory, with the REAL `attributionVerdict` and `incarnationOf`; each refusal must equal the reader's own.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { localIO, type FleetIO } from '../src/io.js';
import { attributionVerdict } from '../src/coord/attribution.js';
import { incarnationOf } from '../src/coord/delegationLeaseDoor.js';
import { actorOf } from '../src/accounts/audit.js';
import { attributionIdentity, isRecordedActor } from '../src/auth/attributionIdentity.js';
import { parseSource } from './scan/parse.js';
import { countingIO, fixtureConfig, type FakeRegistry } from './registryCountingIO.js';

const SENDER = 'lane-a-overlord-sess-a';
const UUID = '00000000-0000-0000-0000-00000000000a';
const GEN1 = '11111111-1111-4111-8111-111111111111';
const GEN2 = '22222222-2222-4222-8222-222222222222';
const cfg = fixtureConfig();
const at = (id: string, field: string): string => path.join(cfg.registryDir, `${id}.${field}`);

const registry = (): FakeRegistry => ({
  files: new Map([
    [at(SENDER, 'uuid'), UUID], [at(SENDER, 'wrapper'), 'lane-a'], [at(SENDER, 'workdir'), '/work/a'],
  ]),
});

const identityOver = (io: FleetIO) => attributionIdentity({
  attribute: (id, uuid, field) => attributionVerdict(io, cfg, id, uuid, field),
  incarnation: (id) => incarnationOf({ io, registryDir: cfg.registryDir }, id),
});

describe('session', () => {
  it('a current uuid answers the caller with an attributed session actor', async () => {
    const r = await identityOver(countingIO(registry()).io).session(SENDER, UUID, 'byUuid');
    expect(r).toMatchObject({ ok: true, sessionId: SENDER, uuid: UUID,
      actor: { kind: 'session', subject: SENDER, issuer: 'attribution', strength: 'attributed' } });
  });

  it.each([
    ['stale uuid', registry, 'other-uuid', 'stale-uuid'],
    ['no row', () => ({ files: new Map<string, string>([[at('lane-a-x-y', 'uuid'), 'u']]) }), UUID, 'unknown-sender'],
  ] as const)('%s answers the verdict\'s own refusal', async (_n, mk, uuid, error) => {
    const io = countingIO(mk()).io;
    const r = await identityOver(io).session(SENDER, uuid, 'byUuid');
    const v = await attributionVerdict(io, cfg, SENDER, uuid, 'byUuid');
    expect(r).toEqual(v);
    expect(r).toMatchObject({ ok: false, error });
  });

  it('an unlistable registry answers registry-unmeasurable, equal to the verdict', async () => {
    const io: FleetIO = { ...localIO, readdir: async () => null };
    const r = await identityOver(io).session(SENDER, UUID, 'fromUuid');
    expect(r).toEqual(await attributionVerdict(io, cfg, SENDER, UUID, 'fromUuid'));
    expect(r).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
  });
});

describe('incarnation', () => {
  const gen = (file: () => string | null | 'absent'): FleetIO => ({
    ...localIO,
    readFileMeasured: async () => {
      const c = file();
      return c === 'absent' ? { ok: false, reason: 'absent' } : c === null ? { ok: false, reason: 'unreadable' } : { ok: true, content: c };
    },
  });
  it('a stable file answers it', async () => {
    expect(await identityOver(gen(() => GEN1)).incarnation(SENDER)).toEqual({ kind: 'measured', incarnation: GEN1 });
  });
  it('a file that changes between the two reads answers unmeasured, changing', async () => {
    let n = 0;
    expect(await identityOver(gen(() => (n++ === 0 ? GEN1 : GEN2))).incarnation(SENDER))
      .toEqual({ kind: 'unmeasured', reason: 'changing' });
  });
  it('an unreadable file answers unmeasured, unreadable', async () => {
    expect(await identityOver(gen(() => null)).incarnation(SENDER)).toEqual({ kind: 'unmeasured', reason: 'unreadable' });
  });
  it('an absent file answers unmeasured, absent (kept apart)', async () => {
    expect(await identityOver(gen(() => 'absent')).incarnation(SENDER)).toEqual({ kind: 'unmeasured', reason: 'absent' });
  });
});

describe('operator', () => {
  const id = identityOver(countingIO(registry()).io);
  it('a gate-minted actor answers an operator actor with the stored text', () => {
    const a = id.operator(actorOf('device-a', 'abcdef0123456789'));
    expect({ ...a }).toEqual({ kind: 'operator', subject: 'device-a abcdef01', issuer: 'account-gate', strength: 'operator' });
  });
  it('a look-alike with the same text throws', () => {
    const fake = { label: 'device-a', idHash8: 'abcdef01', toString: () => 'device-a abcdef01' };
    expect(() => id.operator(fake)).toThrow();
  });
});

describe('console', () => {
  const id = identityOver(countingIO(registry()).io);
  it('armed with a device answers signed-in, issuer session-cookie, operator strength', () => {
    const c = id.console(true, 'device-a');
    expect(c.kind).toBe('signed-in');
    expect(c.kind === 'signed-in' && { ...c.actor })
      .toEqual({ kind: 'operator', subject: 'device:device-a', issuer: 'session-cookie', strength: 'operator' });
  });
  it('armed with no device answers device-unmeasured', () => { expect(id.console(true, null)).toEqual({ kind: 'device-unmeasured' }); });
  it('not armed answers dark, whatever the device', () => {
    expect(id.console(false, null)).toEqual({ kind: 'dark' });
    expect(id.console(false, 'device-a')).toEqual({ kind: 'dark' });
  });
});

describe('isRecordedActor and the freeze', () => {
  it('is true for each minted actor, false for a structurally equal literal, and each minted actor is frozen', async () => {
    const id = identityOver(countingIO(registry()).io);
    const s = await id.session(SENDER, UUID, 'byUuid');
    const o = id.operator(actorOf('device-a', 'abcdef0123456789'));
    const c = id.console(true, 'device-a');
    const minted = [s.ok ? s.actor : null, o, c.kind === 'signed-in' ? c.actor : null];
    for (const a of minted) {
      expect(a).not.toBeNull();
      expect(isRecordedActor(a)).toBe(true);
      expect(Object.isFrozen(a)).toBe(true);
      expect(isRecordedActor({ ...a! })).toBe(false);
    }
    expect(isRecordedActor(null)).toBe(false);
    expect(isRecordedActor('operator')).toBe(false);
  });
});

describe('imports', () => {
  it('the adapter imports neither Fastify nor the cookie or session-store modules, so no second cookie reader appears', () => {
    const file = path.join(__dirname, '../src/auth/attributionIdentity.ts');
    const specs = parseSource(readFileSync(file, 'utf8'), file).imports.map((e) => e.specifier);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s).not.toMatch(/fastify/);
      expect(s).not.toMatch(/\/auth\/(cookie|sessions|gate)(\.js)?$|^\.\/(cookie|sessions|gate)(\.js)?$/);
    }
  });
  it('CONTROL: the scan sees a planted cookie import', () => {
    const specs = parseSource("import { parseCookies } from './cookie.js';\nimport 'fastify';", 'x.ts').imports.map((e) => e.specifier);
    expect(specs.some((s) => /^\.\/cookie/.test(s))).toBe(true);
    expect(specs.some((s) => /fastify/.test(s))).toBe(true);
  });
});
