// The Linear central-key design (#1444, spec §6.2 and §14 row 16): `attributionVerdict` is the box-token lanes'
// sender check, and the Linear proxy routes will be its third caller. Before it moves out of `registerCoordRoutes`
// into a module of its own, this table pins its four answers, `ok`, `unknown-sender`, `stale-uuid` and
// `registry-unmeasurable` (all three of the last one's arms), through both of its call sites on `main`:
//   - `requireAttribution`, reached here by the mail lane (`GET /api/mail/inbox`, field `fromUuid`) and by a claim
//     lane (`POST /api/claims/:id/release`, field `byUuid`);
//   - `openRunPreconditions`' `attribute` callback, reached by `POST /api/runs` (field `claimedByUuid`).
// Each row holds the status and the body byte for byte, and that no lane records a mail rejection: a refused read
// or claim refuses no mail. It was green on the code before the move and stays byte-identical after it.
//
// Fixtures: fixture HOMEs only, the id-gate rig's registry rows (`idGateFixture.ts`), neutral ids.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow, ID_GATE_TOKEN } from './idGateFixture.js';
import { absentField, unreadableField } from './ioDoubles.js';
import { okRuns } from './coordReadHelpers.js';

const SENDER = 'project-a-calm-mesa';
const ABSENT = 'project-a-no-such';

type Lane = 'inbox' | 'claim' | 'runs';
interface Fixture { from: string; io?: FleetIO; staleUuid?: true }

const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };

/** One fixture per answer, and one per arm of `registry-unmeasurable`. */
const FIXTURES: Readonly<Record<string, Fixture>> = {
  'sender present': { from: SENDER },
  'sender absent': { from: ABSENT },
  'sender uuid stale': { from: SENDER, staleUuid: true },
  'registry unlistable': { from: SENDER, io: unlistableIO },
  'sender listed, row unreadable': { from: SENDER, io: absentField(SENDER, 'uuid') },
  'sender listed, identity degraded': { from: SENDER, io: unreadableField(SENDER, 'workdir') },
};

const err = (error: string, detail: string): string => JSON.stringify({ ok: false, error, detail });
const UNKNOWN_SENDER = err('unknown-sender', `no registry row for ${ABSENT}`);
const STALE = (field: string): string =>
  err('stale-uuid', `${field} does not match the registry — stale sender; re-read your own .uuid`);
const UNLISTABLE = err('registry-unmeasurable',
  'the registry directory could not be listed — transient, not a fact about the sender');
const ROW_UNREADABLE = err('registry-unmeasurable',
  `registry row for ${SENDER} is listed but unreadable — transient, not a fact about the sender`);
const DEGRADED = err('registry-unmeasurable',
  `registry row for ${SENDER} is listed but its identity could not be measured — transient`);

/** The `ok` answer is the lane's own next step: an empty inbox, a claim the store does not hold, an opened run.
 *  The opened run's body names its ledger under the fixture HOME, so a body is a function of that HOME. */
const OK_BODY: Readonly<Record<Lane, readonly [number, string | ((home: string) => string)]>> = {
  inbox: [200, JSON.stringify({ ok: true, deliveries: [], remaining: 0, abandoned: 0 })],
  claim: [404, JSON.stringify({ ok: false, error: 'unknown-claim' })],
  runs: [200, (home) => JSON.stringify({
    ok: true, id: 1, program: 'program-a', state: 'planned',
    ledgerPath: 'docs/superpowers/programs/program-a.md', ledgerRepo: 'demo',
    ledgerAbsPath: path.join(home, 'projects', 'demo', 'docs', 'superpowers', 'programs', 'program-a.md'),
  })],
};
const UUID_FIELD: Readonly<Record<Lane, string>> = { inbox: 'fromUuid', claim: 'byUuid', runs: 'claimedByUuid' };

/** [fixture, lane, status, body bytes], as the code answered before the move. */
type Body = string | ((home: string) => string);
const ROWS: readonly (readonly [string, Lane, number, Body])[] = (['inbox', 'claim', 'runs'] as const).flatMap(
  (lane) => [
    ['sender present', lane, ...OK_BODY[lane]],
    ['sender absent', lane, 403, UNKNOWN_SENDER],
    ['sender uuid stale', lane, 403, STALE(UUID_FIELD[lane])],
    ['registry unlistable', lane, 502, UNLISTABLE],
    ['sender listed, row unreadable', lane, 502, ROW_UNREADABLE],
    ['sender listed, identity degraded', lane, 502, DEGRADED],
  ] as const,
);

const OPEN = {
  program: 'program-a', title: 'Wave one', project: 'demo', wave: 1, waveOf: 2, homeProject: 'demo',
} as const;

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  vi.restoreAllMocks();
});

/** One request on a fresh fixture HOME: the lane's answer to `f`. */
async function answer(f: Fixture, lane: Lane) {
  const home = mkTmp('ccrc-coord-attribution-');
  seedRow(home, SENDER);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const w = await appFor(home, recorder().run, f.io ? { io: f.io } : {});
  app = w.app;
  const uuid = f.staleUuid ? 'u-someone-else' : `u-${f.from}`;
  const headers = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
  const res = lane === 'inbox'
    ? await w.app.inject({
      method: 'GET', url: `/api/mail/inbox?fromId=${encodeURIComponent(f.from)}&fromUuid=${encodeURIComponent(uuid)}`,
      headers,
    })
    : lane === 'claim'
      ? await w.app.inject({
        method: 'POST', url: '/api/claims/1/release', headers, payload: { byId: f.from, byUuid: uuid },
      })
      : await w.app.inject({
        method: 'POST', url: '/api/runs', headers, payload: { ...OPEN, claimedBy: f.from, claimedByUuid: uuid },
      });
  return { res, coord: w.coord, home };
}

describe('characterization: attributionVerdict answers each lane as it did before the move (#1444, spec §14 row 16)', () => {
  it('the table covers every answer on every lane', () => {
    expect(ROWS).toHaveLength(18);
    const answers = new Set(ROWS.map(([fixture, , , body]) => (fixture === 'sender present'
      ? 'ok' : (JSON.parse(typeof body === 'string' ? body : body('/h')) as { error: string }).error)));
    expect([...answers].sort()).toEqual(['ok', 'registry-unmeasurable', 'stale-uuid', 'unknown-sender']);
  });

  for (const [fixture, lane, status, body] of ROWS) {
    it(`${lane}: ${fixture} answers ${status}`, async () => {
      const { res, coord, home } = await answer(FIXTURES[fixture]!, lane);
      expect(res.statusCode).toBe(status);
      expect(res.body).toBe(typeof body === 'string' ? body : body(home));
      // The attribution gate records nothing: a refused read, claim or open refuses no mail.
      expect(coord.rejections()).toEqual([]);
      // A refused open leaves no run behind; the attributed one is the only row.
      if (lane === 'runs') expect(okRuns(coord.runs())).toHaveLength(status === 200 ? 1 : 0);
    });
  }
});
