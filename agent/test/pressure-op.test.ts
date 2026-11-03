// #1170: the agent's `pressure` op. Two layers, the `disk` op's idiom:
//  - the wire (a REAL agent over loopback against a fixture HOME): the op is advertised in `ready.ops`, takes no field,
//    and answers both resources' PSI; a frame carrying any field is `bad-request` and reads nothing;
//  - the read (`measurePressure` with the file reads injected): both files parsed, and a missing or malformed one
//    throws (unmeasured on the server), never a zero. No case reads the real /proc.
import { describe, it, expect, afterEach } from 'vitest';
import type { RunningAgent } from '../src/server.js';
import { measurePressure, PRESSURE_FILES } from '../src/pressure.js';
import { PRESSURE_OP, type AgentReady } from '../../shared/agent-protocol.js';
import { parsePressureText, readHostPsi } from '../../shared/pressure.js';
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
  async function connect(f: ReturnType<typeof files>): Promise<TestClient> {
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
    expect(f.reads.sort()).toEqual([PRESSURE_FILES.io, PRESSURE_FILES.memory]);
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

  it('a kernel with no PSI answers an error, never a reading', async () => {
    const c = await connect(files({ [PRESSURE_FILES.memory]: new Error('ENOENT') }));
    await c.hello();
    c.send({ t: 'req', id: 12, op: 'pressure' });
    expect(await res(c, 12)).toMatchObject({ ok: false });
  });
});
