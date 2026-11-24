// #1170: the agent's `pressure` op. Two layers, the `disk` op's idiom:
//  - the wire (a REAL agent over loopback against a fixture HOME): the op is advertised in `ready.ops`, takes no field,
//    and answers both resources' PSI; a frame carrying any field is `bad-request` and reads nothing;
//  - the read (`measurePressure` with the file reads injected): both files parsed, and a missing or malformed one
//    throws (unmeasured on the server), never a zero. No case reads the real /proc.
import { describe, it, expect, afterEach } from 'vitest';
import type { RunningAgent } from '../src/server.js';
import {
  HEADROOM_FILES, SESSION_SLICE_DIR, measureHeadroom, measureMachine, measurePressure, measureSessions, PRESSURE_FILES, type PressureSeams,
} from '../src/pressure.js';
import { PRESSURE_OP, type AgentReady } from '../../shared/agent-protocol.js';
import { parsePressureText, readHeadroomBytes, readHostMachine, readHostPsi } from '../../shared/pressure.js';
import { makeFixture, boot, TestClient } from './helpers.js';

const MEM = 'some avg10=71.20 avg60=55.03 avg300=20.11 total=912345\nfull avg10=64.50 avg60=51.00 avg300=18.00 total=812345\n';
const IO = 'some avg10=12.00 avg60=9.50 avg300=3.00 total=1000\nfull avg10=8.25 avg60=6.00 avg300=2.00 total=900\n';

function files(over: Partial<Record<string, string | Error>> = {}): { readFile(p: string): string; reads: string[] } {
  const reads: string[] = [];
  const text: Record<string, string | Error> = { [PRESSURE_FILES.memory]: MEM, [PRESSURE_FILES.io]: IO, ...over };
  return {
    reads,
    readFile(p) {
      reads.push(p);
      const v = text[p];
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

describe('parsePressureText and measurePressure', () => {
  it('reads some and full, avg10 and avg60, of both resources', () => {
    expect(measurePressure(files())).toEqual({
      memory: { some: { avg10: 71.2, avg60: 55.03 }, full: { avg10: 64.5, avg60: 51 } },
      io: { some: { avg10: 12, avg60: 9.5 }, full: { avg10: 8.25, avg60: 6 } },
    });
  });

  it('a file with no full line, a garbled line or an unreadable file is unknown (a throw), never a zero', () => {
    expect(parsePressureText('some avg10=1.00 avg60=1.00 avg300=1.00 total=1\n')).toBeNull();
    expect(parsePressureText('some avg10=x avg60=1.00 avg300=1.00 total=1\nfull avg10=1.00 avg60=1.00 avg300=1.00 total=1\n')).toBeNull();
    expect(() => measurePressure(files({ [PRESSURE_FILES.io]: 'some avg10=1.00 avg60=1.00 avg300=1.00 total=1\n' }))).toThrow(/has no some\/full/);
    expect(() => measurePressure(files({ [PRESSURE_FILES.memory]: new Error('EACCES') }))).toThrow('EACCES');
  });

  it('the reply round-trips through the server\'s one reader', () => {
    expect(readHostPsi(measurePressure(files()))).toEqual(measurePressure(files()));
    expect(readHostPsi({ memory: { some: { avg10: 1, avg60: 1 }, full: { avg10: 101, avg60: 1 } }, io: null })).toBeNull();
  });
});

describe('the pressure op on the wire', () => {
  let agent: RunningAgent | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await agent?.close();
    agent = undefined;
  });
  async function connect(f: Partial<PressureSeams>): Promise<TestClient> {
    agent = await boot(makeFixture(), { pressureSeams: f });
    const c = new TestClient(agent.port);
    clients.push(c);
    return c;
  }
  const res = (c: TestClient, id: number) =>
    c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === id) as Promise<Record<string, unknown>>;

  it('the op is in ready.ops', async () => {
    const c = await connect(files());
    expect((await c.hello() as AgentReady).ops).toContain(PRESSURE_OP);
  });

  it('answers both resources, with no request field', async () => {
    const f = files();
    const c = await connect(f);
    await c.hello();
    c.send({ t: 'req', id: 7, op: 'pressure' });
    const r = await res(c, 7);
    expect(r.ok).toBe(true);
    expect(readHostPsi(r)).toEqual(measurePressure(files()));
    // D-8122: the headroom's two fixed reads beside the PSI; none answers here, so the field is null, never a zero.
    // The machine's size shares the headroom's ONE walk of the cgroup tree (`measureSessions`), so this process's cgroup
    // is read once; its memory and cores come from the `os` seams, which read no file.
    expect(f.reads.sort()).toEqual([HEADROOM_FILES.meminfo, HEADROOM_FILES.selfCgroup, PRESSURE_FILES.io, PRESSURE_FILES.memory].sort());
    expect(r['headroomBytes']).toBeNull();
  });

  it('carries the machine\'s size beside the PSI, as the one reader takes it (D-8920)', async () => {
    const c = await connect({ ...files(), totalmem: () => 64 * 2 ** 30, cores: () => 16 });
    await c.hello();
    c.send({ t: 'req', id: 13, op: 'pressure' });
    const r = await res(c, 13);
    const machine = { memTotalBytes: 64 * 2 ** 30, cores: 16, sessionMemLimit: 'none' };
    expect(r['machine']).toEqual(machine);
    expect(readHostMachine(r)).toEqual({ kind: 'measured', machine });
  });

  it('a machine that cannot be measured is null on the wire, and the PSI still answers', async () => {
    const c = await connect({ ...files(), totalmem: () => { throw new Error('no os'); }, cores: () => 16 });
    await c.hello();
    c.send({ t: 'req', id: 14, op: 'pressure' });
    const r = await res(c, 14);
    expect(r.ok).toBe(true);
    expect(r['machine']).toBeNull();
    expect(readHostPsi(r)).toEqual(measurePressure(files()));
  });

  it('a request with any field is a bad request, and nothing is read', async () => {
    const f = files();
    const c = await connect(f);
    await c.hello();
    for (const [id, extra] of [[8, { path: '/etc/shadow' }], [9, { resource: 'cpu' }]] as const) {
      c.send({ t: 'req', id, op: 'pressure', ...extra });
      expect(await res(c, id)).toMatchObject({ ok: false, err: 'bad-request' });
    }
    expect(f.reads).toEqual([]);
  });

  // D-8920: a box with no PSI still has memory and cores, so it answers the size ALONE. The server's one
  // PSI reader takes a reply with no PSI as no reading (unanswered), exactly as it took the error this arm answered
  // before, so the box is never read as calm; and its automatic run cap no longer waits for a PSI it will never have.
  it('a kernel with no PSI answers the size alone: no PSI reading, never calm', async () => {
    const c = await connect({ ...files({ [PRESSURE_FILES.memory]: new Error('ENOENT') }), totalmem: () => 64 * 2 ** 30, cores: () => 16 });
    await c.hello();
    c.send({ t: 'req', id: 12, op: 'pressure' });
    const r = await res(c, 12);
    expect(r.ok).toBe(true);
    expect(readHostPsi(r), 'no PSI on the wire').toBeNull();
    expect(r).not.toHaveProperty('memory');
    expect(r).not.toHaveProperty('headroomBytes');
    expect(readHostMachine(r)).toEqual({ kind: 'measured', machine: { memTotalBytes: 64 * 2 ** 30, cores: 16, sessionMemLimit: 'none' } });
  });

  it('a kernel with no PSI and a size that cannot be measured answers neither: null, and still no reading', async () => {
    const c = await connect({ ...files({ [PRESSURE_FILES.io]: 'garbage' }), totalmem: () => { throw new Error('no os'); }, cores: () => 16 });
    await c.hello();
    c.send({ t: 'req', id: 15, op: 'pressure' });
    const r = await res(c, 15);
    expect(readHostPsi(r)).toBeNull();
    expect(r['machine']).toBeNull();
    expect(readHostMachine(r)).toEqual({ kind: 'unmeasured', why: 'read-failed' });
  });
});

// D-8122: the session slice's headroom. The slice is FOUND beside an ancestor of this process's cgroup, never built.
describe('measureHeadroom (D-8122)', () => {
  const GiB = 2 ** 30;
  const OWN = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ccrc-agent.service\n';
  const SLICE = `${HEADROOM_FILES.cgroupRoot}/user.slice/user-1000.slice/user@1000.service/app.slice/${SESSION_SLICE_DIR}`;
  const meminfo = (kb: number): string => `MemTotal:       64000000 kB\nMemAvailable:   ${kb} kB\n`;
  const tree = (o: { max?: string; anon?: string; stat?: string; current?: string; availKb?: number | null; own?: string } = {}) => files({
    [HEADROOM_FILES.selfCgroup]: o.own ?? OWN,
    ...(o.availKb === null ? {} : { [HEADROOM_FILES.meminfo]: meminfo(o.availKb ?? 20 * 1024 * 1024) }),
    ...(o.max === undefined ? {} : { [`${SLICE}/memory.max`]: `${o.max}\n` }),
    ...(o.current === undefined ? {} : { [`${SLICE}/memory.current`]: `${o.current}\n` }),
    ...(o.anon === undefined ? {} : { [`${SLICE}/memory.stat`]: `anon ${o.anon}\nfile 7\nkernel 3\n` }),
    ...(o.stat === undefined ? {} : { [`${SLICE}/memory.stat`]: o.stat }),
  });

  it('a capped slice: memory.max minus memory.stat anon, no more than MemAvailable', () => {
    expect(measureHeadroom(tree({ max: String(24 * GiB), anon: String(20 * GiB) }))).toBe(4 * GiB);
    expect(measureHeadroom(tree({ max: String(24 * GiB), anon: String(2 * GiB), availKb: 5 * 1024 * 1024 }))).toBe(5 * GiB);
    expect(measureHeadroom(tree({ max: String(24 * GiB), anon: String(25 * GiB) })), 'over the cap is no room, not negative').toBe(0);
  });

  it('page cache is not used memory: memory.current near the cap, anon low, is room', () => {
    // A busy fleet's slice at its cap with mostly page cache the kernel can drop: room above the 3 GiB floor.
    const r = measureHeadroom(tree({ max: String(24 * GiB), current: String(23.5 * GiB), anon: String(6 * GiB) }));
    expect(r).toBe(18 * GiB);
    expect(r! >= 3 * GiB, 'above the default headroom floor').toBe(true);
  });

  it('an uncapped slice (max) is MemAvailable alone', () => {
    expect(measureHeadroom(tree({ max: 'max', current: String(GiB), availKb: 7 * 1024 * 1024 }))).toBe(7 * GiB);
  });

  it('no slice on this box (no systemd user manager, no cgroup v2) is MemAvailable alone', () => {
    expect(measureHeadroom(tree({ availKb: 6 * 1024 * 1024 }))).toBe(6 * GiB);
    expect(measureHeadroom(tree({ own: '12:memory:/legacy\n', availKb: 6 * 1024 * 1024 }))).toBe(6 * GiB);
  });

  it('anything unreadable is null, never room', () => {
    expect(measureHeadroom(tree({ availKb: null }))).toBeNull();
    expect(measureHeadroom(tree({ max: 'garbage', anon: '1' }))).toBeNull();
    expect(measureHeadroom(tree({ max: String(GiB) }))).toBeNull();
    expect(measureHeadroom(tree({ max: String(24 * GiB), current: String(GiB) })), 'no memory.stat').toBeNull();
    expect(measureHeadroom(tree({ max: String(24 * GiB), stat: 'file 1\nanon_thp 0\n' })), 'no anon line').toBeNull();
    expect(measureHeadroom(files())).toBeNull();
  });

  it('the server\'s one reader takes a whole byte count and nothing else', () => {
    expect(readHeadroomBytes({ headroomBytes: 5 })).toBe(5);
    for (const v of [undefined, null, -1, 1.5, '5']) expect(readHeadroomBytes({ headroomBytes: v })).toBeNull();
    expect(readHeadroomBytes(null)).toBeNull();
  });
});

// D-8920: the machine's size, which the server derives the automatic run cap from. Three measured facts
// and nothing decided: the box's memory, the cores, and the sessions' memory limit beside them, never folded together.
describe('measureMachine (D-8920)', () => {
  const GiB = 2 ** 30;
  const ROOT = HEADROOM_FILES.cgroupRoot;
  const USER = `${ROOT}/user.slice/user-1000.slice`;
  const MANAGER = `${USER}/user@1000.service`;
  const APP = `${MANAGER}/app.slice`;
  const OWN = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ccrc-agent.service\n';
  const SLICE = `${APP}/${SESSION_SLICE_DIR}`;
  /** A box of 64 GiB and 16 cores whose agent runs under the user manager; `tree` plants cgroup files by path. */
  const box = (tree: Record<string, string> = {}, o: { own?: string; total?: number; cores?: number } = {}) => ({
    ...files({ [HEADROOM_FILES.selfCgroup]: o.own ?? OWN, ...Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, `${v}\n`])) }),
    totalmem: () => o.total ?? 64 * GiB,
    cores: () => o.cores ?? 16,
  });
  const sized = (sessionMemLimit: number | 'none') => ({ memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit });

  it('no slice and no limit anywhere (no systemd, a Mac): the box\'s memory, the cores, and no limit', () => {
    expect(measureMachine({ ...files(), totalmem: () => 64 * GiB, cores: () => 16 })).toEqual(sized('none'));
    expect(measureMachine(box())).toEqual(sized('none'));
  });

  it('an uncapped slice (max) is no limit', () => {
    expect(measureMachine(box({ [`${SLICE}/memory.max`]: 'max' }))).toEqual(sized('none'));
    expect(measureMachine(box({ [`${SLICE}/memory.max`]: 'max', [`${SLICE}/memory.high`]: 'max' }))).toEqual(sized('none'));
  });

  it('THE BOX\'S MEMORY IS NEVER FOLDED WITH THE LIMIT: a slice capped below the box reports both figures', () => {
    // The shipped default: the session slice at 24 GiB, here on a 64 GiB box. `memTotalBytes` is the BOX's.
    expect(measureMachine(box({ [`${SLICE}/memory.max`]: String(24 * GiB) }))).toEqual(sized(24 * GiB));
  });

  it('a limit above the box is reported as read: which figure bounds the cap is the server\'s decision', () => {
    expect(measureMachine(box({ [`${SLICE}/memory.max`]: String(200 * GiB) }))).toEqual(sized(200 * GiB));
  });

  // A limit anywhere above the sessions holds them as surely as the slice's own. Each row reds when its term is not read.
  it.each([
    ['the slice\'s memory.high', { [`${SLICE}/memory.max`]: 'max', [`${SLICE}/memory.high`]: String(16 * GiB) }],
    ['the app slice above it', { [`${SLICE}/memory.max`]: 'max', [`${APP}/memory.max`]: String(16 * GiB) }],
    ['the user manager\'s memory.max', { [`${SLICE}/memory.max`]: 'max', [`${MANAGER}/memory.max`]: String(16 * GiB) }],
    ['the user slice\'s memory.max', { [`${SLICE}/memory.max`]: 'max', [`${USER}/memory.max`]: String(16 * GiB) }],
    ['the user slice\'s memory.high', { [`${SLICE}/memory.max`]: 'max', [`${USER}/memory.high`]: String(16 * GiB) }],
    ['the top-level slice', { [`${SLICE}/memory.max`]: 'max', [`${ROOT}/user.slice/memory.max`]: String(16 * GiB) }],
    ['the cgroup root (a container)', { [`${SLICE}/memory.max`]: 'max', [`${ROOT}/memory.max`]: String(16 * GiB) }],
    ['the smallest of several', { [`${SLICE}/memory.max`]: String(24 * GiB), [`${USER}/memory.max`]: String(16 * GiB), [`${ROOT}/memory.max`]: String(40 * GiB) }],
  ] as const)('a limit on %s is the sessions\' limit', (_name, tree) => {
    expect(measureMachine(box(tree))).toEqual(sized(16 * GiB));
  });

  it('with no slice, the cgroups ABOVE this process are read, and its own leaf never is', () => {
    // A box where no session ever started: the user manager's limit still holds the sessions that will.
    expect(measureMachine(box({ [`${MANAGER}/memory.max`]: String(16 * GiB) }))).toEqual(sized(16 * GiB));
    // The agent's own service limit is not the sessions': it is not read.
    const f = box({ [`${APP}/ccrc-agent.service/memory.max`]: String(GiB) });
    expect(measureMachine(f)).toEqual(sized('none'));
    expect(f.reads.filter((p) => p.startsWith(`${APP}/ccrc-agent.service/memory.`)), 'the leaf\'s own limit files').toEqual([]);
  });

  it('a container (this process at the cgroup root): the root\'s limit is the sessions\' limit', () => {
    // The box's memory is the host's; the container's limit says how much of it may be used.
    expect(measureMachine(box({ [`${ROOT}/memory.max`]: String(8 * GiB) }, { own: '0::/\n', total: 256 * GiB, cores: 64 })))
      .toEqual({ memTotalBytes: 256 * GiB, cores: 64, sessionMemLimit: 8 * GiB });
  });

  it('a limit file that was read and cannot be parsed is unreadable, at any level: never "no limit"', () => {
    for (const tree of [
      { [`${SLICE}/memory.max`]: 'garbage' }, { [`${SLICE}/memory.max`]: 'max', [`${SLICE}/memory.high`]: 'garbage' },
      { [`${SLICE}/memory.max`]: String(24 * GiB), [`${USER}/memory.max`]: '-5' }, { [`${ROOT}/memory.max`]: '1e9' },
    ]) {
      expect(measureMachine(box(tree)), JSON.stringify(tree)).toEqual({ memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 'unreadable' });
    }
    // A limit of zero bytes is no limit a session could run under: the one reader takes it as unreadable.
    expect(measureMachine(box({ [`${SLICE}/memory.max`]: '0' }))).toEqual({ memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 'unreadable' });
  });

  it('the slice\'s memory.max gone between the walk and the read is unreadable, never "no limit"', () => {
    const f = box({ [`${SLICE}/memory.max`]: String(24 * GiB) });
    let seen = 0;
    const flaky = { ...f, readFile: (p: string): string => {
      if (p === `${SLICE}/memory.max` && ++seen > 1) throw new Error('ENOENT');
      return f.readFile(p);
    } };
    expect(measureMachine(flaky)).toEqual({ memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 'unreadable' });
  });

  it('a size that is not a positive whole number, or an os call that throws, is unmeasured and never a throw', () => {
    for (const [total, cores] of [[0, 16], [64 * GiB, 0], [-1, 16], [1.5, 16], [Number.NaN, 16], [64 * GiB, 2.5]] as const) {
      expect(measureMachine({ ...files(), totalmem: () => total, cores: () => cores }), `${total}/${cores}`).toBeNull();
    }
    expect(measureMachine({ ...files(), totalmem: () => 64 * GiB, cores: () => { throw new Error('no os'); } })).toBeNull();
  });

  it('with no seam it measures this box, as two positive whole numbers', () => {
    // The real `os`, and a `readFile` that finds no slice, so no real /proc or /sys file decides the case.
    const m = measureMachine({ readFile: () => { throw new Error('ENOENT'); } });
    expect(m).not.toBeNull();
    expect(Number.isSafeInteger(m!.memTotalBytes) && m!.memTotalBytes > 0).toBe(true);
    expect(Number.isSafeInteger(m!.cores) && m!.cores > 0).toBe(true);
    expect(m!.sessionMemLimit).toBe('none');
  });

  // One walk of the cgroup tree serves the headroom and the size, and one parser reads the slice's `memory.max` for both.
  it('measureSessions answers the headroom and the size together, as each answers alone, over one walk', () => {
    const tree = {
      [`${SLICE}/memory.max`]: String(24 * GiB), [`${SLICE}/memory.stat`]: `anon ${20 * GiB}\nfile 7`,
      [HEADROOM_FILES.meminfo]: 'MemTotal:       64000000 kB\nMemAvailable:   20971520 kB',
    };
    const f = box(tree);
    expect(measureSessions(f)).toEqual({ headroomBytes: measureHeadroom(box(tree)), machine: measureMachine(box(tree)) });
    expect(measureSessions(box(tree))).toEqual({ headroomBytes: 4 * GiB, machine: sized(24 * GiB) });
    expect(f.reads.filter((p) => p === HEADROOM_FILES.selfCgroup).length, 'this process\'s cgroup is read once').toBe(1);
  });
});
