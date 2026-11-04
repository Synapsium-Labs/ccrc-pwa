// D-5863 (ARCH-09, #538): the mail ingress reads the registry once. Three
// ladders decide who a mail is from: `attributionVerdict` (reached here through
// `POST /api/claims/:id/release`, whose only registry read it is; in
// `coord/attribution.ts` since #1444 moved it out of `registerCoordRoutes`),
// and `POST /api/mail` and `POST /api/mail/:id/ack` in `coord/routes.ts`. Each listed the
// registry with `io.readdir` and then called `readRegistry`, which listed it
// again.
//
// The characterization table pins each route's answer, status and body bytes,
// over one fixture per arm of the ladder: the sender present, absent, refused
// (a listed `.uuid` that is not a registry id), listed with its row dropped
// (its `.uuid` read proven absent), listed with its identity degraded, and an
// unlistable registry; plus a stale uuid, and the mail route's recipient arms.
// It was green on the code before the move and stays byte-identical after it.
//
// The one-read rows spy on the registry module's two readers, never on a raw
// `readdir` count: `readRegistryMeasured` may list a second time to settle a
// reap race, and that second listing is its own business. On a listable
// registry each route calls `readRegistryMeasured` once and `readRegistry`
// never.
//
// Console speed S2: `attributionVerdict` no longer reads the registry. It reads the sender's ONE row through
// `readSessionRecord`, so for the attribution gate "one read" means one row: a listing of the registry directory and
// that sender's own field files, never another row's, and no `readRegistryMeasured` call at all. The mail routes
// above keep the whole-registry read.
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { localIO, localIOFor, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow, ID_GATE_TOKEN } from './idGateFixture.js';
import { absentField, unreadableField } from './ioDoubles.js';
import * as registry from '../src/registry.js';
import { parsedFile, symbolOf } from './scan/symbols.js';
import { parseSource } from './scan/parse.js';

vi.mock('../src/registry.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/registry.js')>();
  return {
    ...real,
    readRegistry: vi.fn(real.readRegistry),
    readRegistryMeasured: vi.fn(real.readRegistryMeasured),
  };
});
const readRegistrySpy = vi.mocked(registry.readRegistry);
const readMeasuredSpy = vi.mocked(registry.readRegistryMeasured);

const SENDER = 'demo-quiet-mesa';
const RCPT = 'demo-coordinator';
const BAD = '--actor';

type Route = 'mail' | 'ack' | 'attribution';
interface Fixture { seed: readonly string[]; io?: FleetIO; from: string; to?: string; staleUuid?: true }

const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };

const FIXTURES: Readonly<Record<string, Fixture>> = {
  'sender present': { seed: [SENDER, RCPT], from: SENDER },
  'sender absent': { seed: [RCPT], from: SENDER },
  'sender refused': { seed: [BAD, RCPT], from: BAD },
  'sender listed, row unreadable': { seed: [SENDER, RCPT], io: absentField(SENDER, 'uuid'), from: SENDER },
  'sender listed, identity degraded': { seed: [SENDER, RCPT], io: unreadableField(SENDER, 'workdir'), from: SENDER },
  'registry unlistable': { seed: [SENDER, RCPT], io: unlistableIO, from: SENDER },
  'sender uuid stale': { seed: [SENDER, RCPT], from: SENDER, staleUuid: true },
  'recipient absent': { seed: [SENDER], from: SENDER },
  'recipient refused': { seed: [SENDER, BAD], from: SENDER, to: BAD },
  'recipient listed, row unreadable': { seed: [SENDER, RCPT], io: absentField(RCPT, 'uuid'), from: SENDER },
};

const err = (error: string, detail: string): string => JSON.stringify({ ok: false, error, detail });
const SENDER_UNREADABLE = (id: string) => err('registry-unmeasurable',
  `registry row for ${id} is listed but unreadable — transient, not a fact about the sender`);
const UNLISTABLE = err('registry-unmeasurable',
  'the registry directory could not be listed — transient, not a fact about the sender');
const DEGRADED = err('registry-unmeasurable',
  `registry row for ${SENDER} is listed but its identity could not be measured — transient, not a fact about the sender`);
const UNKNOWN_SENDER = err('unknown-sender', `no registry row for ${SENDER}`);
const NOT_YOURS = err('unknown-recipient', 'this delivery is not addressed to you');
const UNKNOWN_CLAIM = JSON.stringify({ ok: false, error: 'unknown-claim' });

/** [fixture, route, status, body bytes], as the code answered before the move. */
const ROWS: readonly (readonly [string, Route, number, string])[] = [
  ['sender present', 'mail', 202, JSON.stringify({ ok: true, id: 1 })],
  ['sender present', 'ack', 404, NOT_YOURS],
  ['sender present', 'attribution', 404, UNKNOWN_CLAIM],
  ['sender absent', 'mail', 403, UNKNOWN_SENDER],
  ['sender absent', 'ack', 403, UNKNOWN_SENDER],
  ['sender absent', 'attribution', 403, UNKNOWN_SENDER],
  ['sender refused', 'mail', 502, SENDER_UNREADABLE(BAD)],
  ['sender refused', 'ack', 502, SENDER_UNREADABLE(BAD)],
  ['sender refused', 'attribution', 502, SENDER_UNREADABLE(BAD)],
  ['sender listed, row unreadable', 'mail', 502, SENDER_UNREADABLE(SENDER)],
  ['sender listed, row unreadable', 'ack', 502, SENDER_UNREADABLE(SENDER)],
  ['sender listed, row unreadable', 'attribution', 502, SENDER_UNREADABLE(SENDER)],
  ['sender listed, identity degraded', 'mail', 502, DEGRADED],
  ['sender listed, identity degraded', 'ack', 502, DEGRADED],
  ['sender listed, identity degraded', 'attribution', 502, err('registry-unmeasurable',
    `registry row for ${SENDER} is listed but its identity could not be measured — transient`)],
  ['registry unlistable', 'mail', 502, UNLISTABLE],
  ['registry unlistable', 'ack', 502, UNLISTABLE],
  ['registry unlistable', 'attribution', 502, UNLISTABLE],
  ['sender uuid stale', 'mail', 403, err('stale-uuid', 'fromUuid does not match the registry — stale sender')],
  ['sender uuid stale', 'ack', 403, err('stale-uuid', 'fromUuid does not match the registry — stale sender')],
  ['sender uuid stale', 'attribution', 403,
    err('stale-uuid', 'byUuid does not match the registry — stale sender; re-read your own .uuid')],
  ['recipient absent', 'mail', 404, err('unknown-recipient', `no registry row for ${RCPT}`)],
  ['recipient refused', 'mail', 502, err('registry-unmeasurable',
    `registry row for ${BAD} is listed but unreadable — transient, not a fact about the recipient`)],
  ['recipient listed, row unreadable', 'mail', 502, err('registry-unmeasurable',
    `registry row for ${RCPT} is listed but unreadable — transient, not a fact about the recipient`)],
];

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  vi.restoreAllMocks();
  readRegistrySpy.mockClear();
  readMeasuredSpy.mockClear();
});

const post = (a: FastifyInstance, url: string, payload: Record<string, unknown>) =>
  a.inject({ method: 'POST', url, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN }, payload });

interface Req { op: 'readdir' | 'readFileMeasured' | 'readFile'; path: string }

/** `io` with every registry-directory listing and every file read logged in issue order. */
function logged(io: FleetIO, log: Req[]): FleetIO {
  return {
    ...io,
    readdir: async (dir, ...rest) => { log.push({ op: 'readdir', path: dir }); return io.readdir(dir, ...rest); },
    readFileMeasured: async (p, ...rest) => { log.push({ op: 'readFileMeasured', path: p }); return io.readFileMeasured(p, ...rest); },
    readFile: async (p, ...rest) => { log.push({ op: 'readFile', path: p }); return io.readFile(p, ...rest); },
  };
}

/** One request on a fresh fixture HOME: the route's answer to `f`. */
async function answer(f: Fixture, route: Route) {
  const home = mkTmp('ccrc-mail-one-read-');
  for (const id of f.seed) seedRow(home, id);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const requests: Req[] = [];
  const w = await appFor(home, recorder().run, { io: logged(f.io ?? localIOFor(home), requests) });
  app = w.app;
  const uuid = f.staleUuid ? 'u-someone-else' : `u-${f.from}`;
  readRegistrySpy.mockClear();
  readMeasuredSpy.mockClear();
  requests.length = 0;
  const res = route === 'mail'
    ? await post(w.app, '/api/mail', {
      fromId: f.from, fromUuid: uuid, toId: f.to ?? RCPT,
      kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
    })
    : route === 'ack'
      ? await post(w.app, '/api/mail/1/ack', { fromId: f.from, fromUuid: uuid })
      : await post(w.app, '/api/claims/1/release', { byId: f.from, byUuid: uuid });
  return { res, coord: w.coord, requests, registryDir: path.join(home, '.cc-sessions') };
}

describe('characterization: each mail-ingress ladder answers as it did before the move (D-5863)', () => {
  for (const [fixture, route, status, body] of ROWS) {
    it(`${route}: ${fixture} answers ${status}`, async () => {
      const { res, coord } = await answer(FIXTURES[fixture]!, route);
      expect(res.statusCode).toBe(status);
      expect(res.body).toBe(body);
      // The two mail routes record every refusal; the attribution gate records none.
      const recorded = coord.rejections().map((r) => r.code);
      if (route === 'attribution' || status < 400) expect(recorded).toEqual([]);
      else expect(recorded).toEqual([JSON.parse(body).error]);
    });
  }
});

describe('one read: on a listable registry each mail ladder calls readRegistryMeasured once and readRegistry never (D-5863)', () => {
  for (const route of ['mail', 'ack'] as const) {
    for (const fixture of ['sender present', 'sender absent', 'sender listed, row unreadable']) {
      it(`${route}: ${fixture}`, async () => {
        await answer(FIXTURES[fixture]!, route);
        expect(readRegistrySpy, 'the wrapper is not called').not.toHaveBeenCalled();
        expect(readMeasuredSpy, 'one measured read').toHaveBeenCalledTimes(1);
      });
    }
  }
});

describe('one read, one row: the attribution gate lists the registry once and reads only the sender\'s files (console speed S2)', () => {
  for (const fixture of ['sender present', 'sender absent', 'sender listed, row unreadable']) {
    it(`attribution: ${fixture}`, async () => {
      const { requests, registryDir } = await answer(FIXTURES[fixture]!, 'attribution');
      expect(readRegistrySpy, 'the wrapper is not called').not.toHaveBeenCalled();
      expect(readMeasuredSpy, 'no whole-registry read').not.toHaveBeenCalled();
      expect(requests.filter((q) => q.op === 'readdir').map((q) => q.path), 'one listing of the registry').toEqual([registryDir]);
      const stray = requests.filter((q) => q.op !== 'readdir' && !path.basename(q.path).startsWith(`${SENDER}.`));
      expect(stray.map((q) => q.path), 'a file of another row was read').toEqual([]);
    });
  }

  it('attribution: sender present reads that row\'s files', async () => {
    const { requests } = await answer(FIXTURES['sender present']!, 'attribution');
    expect(requests.filter((q) => q.op !== 'readdir').length, 'the sender\'s own reads').toBeGreaterThan(0);
  });

  // Measured: `readSessionRecord` lists a SECOND time when the row's identity could not be measured, to tell a row
  // reaped mid-read from one that is merely unreadable. That is the one re-listing the sender's read makes, and it
  // is still no other row's file.
  it('attribution: sender listed, identity degraded lists the registry a second time, for the sender\'s row only', async () => {
    const { requests, registryDir } = await answer(FIXTURES['sender listed, identity degraded']!, 'attribution');
    expect(readMeasuredSpy, 'no whole-registry read').not.toHaveBeenCalled();
    expect(requests.filter((q) => q.op === 'readdir').map((q) => q.path)).toEqual([registryDir, registryDir]);
    const stray = requests.filter((q) => q.op !== 'readdir' && !path.basename(q.path).startsWith(`${SENDER}.`));
    expect(stray.map((q) => q.path), 'a file of another row was read').toEqual([]);
  });
});

// The spy rows above cannot see a raw `io.readdir` put back beside the measured
// read: that listing never goes through the registry module. So each ladder's
// calls are pinned too, keyed on the parser (D-6114's scan/symbols.ts), never on
// source text: one `readRegistryMeasured(`, no `readdir(`, no `readRegistry(` in each mail route; and in
// `attributionVerdict` one `readSessionRecord(`, no `readRegistryMeasured(`, no `readRegistry(`, and exactly one
// `readdir(`, the `bad-id` arm's listing (the only id `readSessionRecord` answers before any listing of its own).
const ROUTES = 'server/src/coord/routes.ts';
const ATTRIBUTION = 'server/src/coord/attribution.ts';
type Span = { start: number; end: number };
type CallsOf = { calls: { callee: string; name: string | null; args: { kind: string; text: string }[];
  start: number; end: number }[] };
/** The callee names called inside each ladder: `attributionVerdict` by its
 *  symbol in its own file, each route by its own `app.post(<path>, …)` call. */
const ladderCalls = (file: CallsOf, attribution: { file: CallsOf; span: Span } | null): Record<string, string[]> => {
  const route = (p: string): Span => {
    const hits = file.calls.filter((c) => c.callee === 'app.post' && c.args[0]?.kind === 'string' && c.args[0].text === p);
    if (hits.length !== 1) throw new Error(`app.post('${p}') is registered ${hits.length} times`);
    return hits[0]!;
  };
  const inside = (sp: Span, f: CallsOf = file): string[] =>
    f.calls.filter((c) => c.start > sp.start && c.end <= sp.end && c.name !== null).map((c) => c.name!);
  return {
    mail: inside(route('/api/mail')),
    ack: inside(route('/api/mail/:id/ack')),
    ...(attribution ? { attribution: inside(attribution.span, attribution.file) } : {}),
  };
};
const holdsOneRead = (names: string[]): void => {
  expect(names.filter((n) => n === 'readRegistryMeasured'), 'one measured read').toHaveLength(1);
  expect(names, 'a raw listing of the registry is back in this ladder').not.toContain('readdir');
  expect(names, 'the wrapper is back in this ladder').not.toContain('readRegistry');
};

const holdsOneRow = (names: string[]): void => {
  expect(names.filter((n) => n === 'readSessionRecord'), 'one single-row read').toHaveLength(1);
  expect(names, 'the whole-registry read is back in this ladder').not.toContain('readRegistryMeasured');
  expect(names, 'the wrapper is back in this ladder').not.toContain('readRegistry');
  expect(names.filter((n) => n === 'readdir'), 'a listing beside the row read, other than the bad-id arm\'s').toHaveLength(1);
};

describe('one read, pinned on the parse: no ladder lists the registry beside its measured read (D-5863)', () => {
  it('CONTROL (fixture): a raw readdir beside the measured read is caught', () => {
    const src = [
      "app.post('/api/mail', async () => {",
      '  const reg = await readRegistryMeasured(io, cfg);',
      '  const names = await deps.io.readdir(deps.cfg.registryDir);',
      '});',
      "app.post('/api/mail/:id/ack', async () => { await readRegistryMeasured(io, cfg); });",
    ].join('\n');
    const calls = ladderCalls(parseSource(src, 'fixture.ts'), null);
    expect(() => holdsOneRead(calls.mail!)).toThrow(/raw listing/);
    holdsOneRead(calls.ack!);
  });

  it('CONTROL (fixture): the whole-registry read, or a second listing, in the sender ladder is caught', () => {
    const wholeRegistry = [
      'async function attributionVerdict() {',
      '  const reg = await readRegistryMeasured(io, cfg);',
      '  const names = await io.readdir(cfg.registryDir);',
      '}',
    ].join('\n');
    const f = parseSource(wholeRegistry, 'fixture.ts');
    const span = f.calls.find((c) => c.name === 'readRegistryMeasured')!;
    const names = f.calls.filter((c) => c.start >= span.start && c.name !== null).map((c) => c.name!);
    expect(() => holdsOneRow(names)).toThrow(/single-row/);
    expect(() => holdsOneRow(['readSessionRecord', 'readdir', 'readdir'])).toThrow(/bad-id arm/);
    holdsOneRow(['readSessionRecord', 'readdir']);
  });

  const calls = (): Record<string, string[]> =>
    ladderCalls(parsedFile(ROUTES), { file: parsedFile(ATTRIBUTION), span: symbolOf(ATTRIBUTION, 'attributionVerdict') });
  it('attribution: one readSessionRecord(, no readRegistryMeasured( and no readRegistry(', () => {
    holdsOneRow(calls().attribution!);
  });
  for (const route of ['mail', 'ack'] as const) {
    it(`${route}: one readRegistryMeasured(, no readdir( and no readRegistry(`, () => {
      holdsOneRead(calls()[route]!);
    });
  }
});
