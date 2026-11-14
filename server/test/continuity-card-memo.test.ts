// Overlord W1a, the card follow-up (review 2027, N1 and N4): the card door's raw answer, as the generic `ccrc-api sessions
// card` row prints it, and the door's memo of served pages across a new start of one conversation.
//   N1: the raw row prints the door's JSON as it came, so a page's JSON, not only its text, must stay under the measured
//       tool-result cut, and no raw control character but the newline and the tab may reach the pane through it.
//   N4: a conversation that read pages 1..N-1 of a card, then started again (a resume keeps its uuid), and then read page
//       N, has not read the card in its new generation: the start door forgets that conversation's partly served card.
// Fixture HOMEs only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CoordStore } from '../src/coord/store.js';
import { TOOL_RESULT_CUT_BYTES } from '../../shared/continuity-card.js';
import { FAKE_T0, fakeTime, type FakeTime } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
let time: FakeTime;

beforeEach(() => {
  home = mkTmp('ccrc-card-memo-');
  seedRow(home, ID, { uuid: UUID, project: 'project-a' });
  time = fakeTime();
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});

const open = async (): Promise<FastifyInstance> => {
  const r = await appFor(home, recorder().run, { time: time.ports });
  coord = r.coord;
  await r.app.ready();
  return r.app;
};

const card = (a: FastifyInstance, q: Record<string, string | number> = {}) => {
  const query = new URLSearchParams(Object.entries({ byId: ID, byUuid: UUID, ...q }).map(([k, v]) => [k, String(v)]));
  return a.inject({ method: 'GET', url: `/api/sessions/${ID}/card?${query}`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN } });
};

const start = (a: FastifyInstance, reportId: string) => a.inject({
  method: 'POST', url: `/api/sessions/${ID}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
  payload: { fromId: ID, fromUuid: UUID, reportId, source: 'resume', model: 'claude-opus-5-5', reportedAt: FAKE_T0 - 50 } as never,
});

const reads = (): unknown[] => coord!.db.prepare('SELECT pages FROM continuity_card_reads ORDER BY id').all();

/** Outstanding mail to the session, each subject `subject(i)`. */
const mail = (n: number, subject: (i: number) => string): void => {
  for (let i = 0; i < n; i += 1) {
    const m = coord!.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status',
      subject: subject(i), body: 'b', artifacts: [] });
    coord!.queueDelivery(m.id, ID, '<mail/>');
  }
};

/** What `ccrc-api sessions card` prints for one answer: the body, the newline `print_body` adds, and `http <code>` on stderr,
 *  which a session's shell tool shows with it. */
const rawRowBytes = (body: string, code: number): number => Buffer.byteLength(body, 'utf8') + 1 + `http ${code}\n`.length;
/** A raw control character the pane would act on: every C0 and C1 control but the newline and the tab. */
const RAW_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;

describe('the raw row prints each page of the card under the cut, its controls escaped (review 2027 N1)', () => {
  it('a card whose mail subjects are control characters: every page as JSON fits, and its text carries none of them raw', async () => {
    app = await open();
    mail(60, (i) => `${i} ${'\u0001\u001b\u009b\r'.repeat(250)}`);
    const first = await card(app);
    expect(first.statusCode).toBe(200);
    const { hash, pages } = first.json() as { hash: string; pages: number };
    expect(pages).toBeGreaterThan(1);
    for (let p = 1; p <= pages; p += 1) {
      const res = p === 1 ? first : await card(app, { page: p, hash });
      expect(res.statusCode).toBe(200);
      expect(rawRowBytes(res.body, res.statusCode), `page ${p}`).toBeLessThanOrEqual(TOOL_RESULT_CUT_BYTES);
      const text = (res.json() as { text: string }).text;
      expect(RAW_CONTROL.test(text), `page ${p}`).toBe(false);
      // The JSON carries the escaped spelling, never a six-byte \u00XX escape of a raw control.
      expect(res.body).not.toMatch(/\\u00(?:0[0-8bcef]|1[0-9a-f])/);
    }
    expect((first.json() as { text: string }).text).toContain('\\u{1}\\u{1b}\\u{9b}\\u{d}');
  });
});

describe('a new start of one conversation forgets its partly served card (review 2027 N4)', () => {
  it('pages read before the start and the last page after it record no read; the pages served after it, once all, record one', async () => {
    app = await open();
    mail(15, (i) => `s${i} ${'x'.repeat(1000)}`);
    const first = await card(app);
    const { hash, pages } = first.json() as { hash: string; pages: number };
    expect(pages).toBe(3);
    expect((await card(app, { page: 2, hash })).json().recorded).toBe(false);
    expect((await start(app, 'r-0001-abcd')).statusCode).toBe(202);
    const last = await card(app, { page: 3, hash });
    expect([last.statusCode, last.json().recorded]).toEqual([200, false]);
    expect(reads()).toEqual([]);
    // Page 3 was served after the start; pages 1 and 2, served again now, complete the read in the new generation.
    expect((await card(app)).json().recorded).toBe(false);
    expect((await card(app, { page: 2, hash })).json().recorded).toBe(true);
    expect(reads()).toEqual([{ pages: 3 }]);
  });

  it('a resend of a recorded start (fresh: false) forgets nothing: it is not a new start', async () => {
    app = await open();
    mail(15, (i) => `s${i} ${'x'.repeat(1000)}`);
    expect((await start(app, 'r-0001-abcd')).json().fresh).toBe(true);
    const { hash } = (await card(app)).json() as { hash: string };
    expect((await card(app, { page: 2, hash })).json().recorded).toBe(false);
    expect((await start(app, 'r-0001-abcd')).json().fresh).toBe(false);
    expect((await card(app, { page: 3, hash })).json().recorded).toBe(true);
    expect(reads()).toEqual([{ pages: 3 }]);
  });

  it('CONTROL: with no start between, pages 1 to 3 record one read', async () => {
    app = await open();
    mail(15, (i) => `s${i} ${'x'.repeat(1000)}`);
    const { hash } = (await card(app)).json() as { hash: string };
    await card(app, { page: 2, hash });
    expect((await card(app, { page: 3, hash })).json().recorded).toBe(true);
    expect(reads()).toEqual([{ pages: 3 }]);
  });
});
