// D-5863 (ARCH-09, #538): the mail ingress reads the registry once. Three
// ladders in `coord/routes.ts` decide who a mail is from: `attributionVerdict`
// (reached here through `POST /api/claims/:id/release`, whose only registry
// read it is), `POST /api/mail` and `POST /api/mail/:id/ack`. Each listed the
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
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow, ID_GATE_TOKEN } from './idGateFixture.js';
import { absentField, unreadableField } from './ioDoubles.js';
import * as registry from '../src/registry.js';

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

/** One request on a fresh fixture HOME: the route's answer to `f`. */
async function answer(f: Fixture, route: Route) {
  const home = mkTmp('ccrc-mail-one-read-');
  for (const id of f.seed) seedRow(home, id);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const w = await appFor(home, recorder().run, f.io ? { io: f.io } : {});
  app = w.app;
  const uuid = f.staleUuid ? 'u-someone-else' : `u-${f.from}`;
  readRegistrySpy.mockClear();
  readMeasuredSpy.mockClear();
  const res = route === 'mail'
    ? await post(w.app, '/api/mail', {
      fromId: f.from, fromUuid: uuid, toId: f.to ?? RCPT,
      kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
    })
    : route === 'ack'
      ? await post(w.app, '/api/mail/1/ack', { fromId: f.from, fromUuid: uuid })
      : await post(w.app, '/api/claims/1/release', { byId: f.from, byUuid: uuid });
  return { res, coord: w.coord };
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

describe('one read: on a listable registry each ladder calls readRegistryMeasured once and readRegistry never (D-5863)', () => {
  for (const route of ['mail', 'ack', 'attribution'] as const) {
    for (const fixture of ['sender present', 'sender absent', 'sender listed, row unreadable']) {
      it(`${route}: ${fixture}`, async () => {
        await answer(FIXTURES[fixture]!, route);
        expect(readRegistrySpy, 'the wrapper is not called').not.toHaveBeenCalled();
        expect(readMeasuredSpy, 'one measured read').toHaveBeenCalledTimes(1);
      });
    }
  }
});
