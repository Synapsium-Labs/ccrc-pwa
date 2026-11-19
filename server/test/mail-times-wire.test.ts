// Mid-turn mail PR 1 (Overlord wave 171, plan 2026-11-19-mid-turn-mail.md Task 1.1): the three delivery times
// `mail_deliveries` has always stored, served on `MailSummary` so a reader can measure how long a mail waited and how
// long it stayed unread. `deliveredAt` is when the lane last put the nudge into the recipient's pane (a replay re-dates
// it), `ingestedAt` is the first `UserPromptSubmit` edge the mail sweep saw in the recipient's hook state after that
// delivery, and `ackedAt` is when the recipient's ack committed. Each is optional and absent until written; a stored value that is not a positive whole number is answered
// absent, never zero, because a time of zero would read as a real instant (`persistedInt`).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { MailSummary } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TO = 'lane-a-project-a';
const FROM = 'lane-b-project-a';
const UUID = 'a'.repeat(36);
const TOKEN = 'f'.repeat(64);
const DELIVERED = 1_800_000_000_111;
const INGESTED = 1_800_000_000_222;
const ACKED = 1_800_000_000_333;
const TIMES = ['deliveredAt', 'ingestedAt', 'ackedAt'] as const;

// `1.5` is stored REAL, `'soon'` TEXT, `-5` and `0` are not positive, and 2^60 is an INTEGER past
// `Number.MAX_SAFE_INTEGER`, which node:sqlite would throw on if the column were read as a number.
const BAD = [['a fraction', '1.5'], ['text', "'soon'"], ['a negative', '-5'], ['zero', '0'],
             ['an unsafe integer', '1152921504606846976']] as const;

interface Fixture {
  s: CoordStore; home: string; runId: number;
  queued: number; delivered: number; ingested: number; acked: number; ackedQueued: number;
  bad: Record<string, number>;
}

// One store for the whole file: every case only reads it, and a coord.db opens slowly on a loaded box.
let built: Fixture | undefined;
const fixture = (): Fixture => (built ??= build());

const build = (): Fixture => {
  const home = mkTmp('ccrc-mail-times-');
  const s = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const r = s.openRun({ program: 'program-a', title: 'run-a', project: 'project-a', wave: 1, waveOf: 2,
                        claimedBy: 'lane-c-project-a' });
  if (!('id' in r)) throw new Error('openRun refused');
  const one = (): number => {
    const m = s.insertMail({ fromId: FROM, fromUuid: UUID, toId: TO, runId: r.id,
                             kind: 'status', subject: 'fixture', body: 'x', artifacts: [] });
    return s.queueDelivery(m.id, TO, `<mail>${m.id}</mail>`).id;
  };
  const queued = one();
  const delivered = one();
  expect(s.markDelivered(delivered, DELIVERED).changed).toBe(true);
  const ingested = one();
  expect(s.markDelivered(ingested, DELIVERED).changed).toBe(true);
  expect(s.markIngested(ingested, INGESTED).changed).toBe(true);
  const acked = one();
  expect(s.markDelivered(acked, DELIVERED).changed).toBe(true);
  expect(s.markIngested(acked, INGESTED).changed).toBe(true);
  expect(s.markAcked(acked, ACKED)).toEqual({ ok: true, state: 'acked' });
  // Acked straight from the queue, never delivered: it has an ack time and nothing else.
  const ackedQueued = one();
  expect(s.markAcked(ackedQueued, ACKED)).toEqual({ ok: true, state: 'acked' });
  const bad: Record<string, number> = {};
  for (const [label, sql] of BAD) {
    const id = one();
    expect(s.markAcked(id, ACKED)).toEqual({ ok: true, state: 'acked' });
    s.db.prepare(`UPDATE mail_deliveries SET deliveredAt = ${sql}, ingestedAt = ${sql}, ackedAt = ${sql} WHERE id = ?`).run(id);
    bad[label] = id;
  }
  return { s, home, runId: r.id, queued, delivered, ingested, acked, ackedQueued, bad };
};

const byDelivery = (rows: readonly MailSummary[], id: number): MailSummary => {
  const row = rows.find((m) => m.deliveryId === id);
  if (row === undefined) throw new Error(`delivery ${id} not listed`);
  return row;
};

const timesOf = (m: MailSummary): Record<string, unknown> =>
  Object.fromEntries(TIMES.filter((k) => k in m).map((k) => [k, m[k]]));

describe('MailSummary carries the three delivery times (mid-turn mail PR 1)', () => {
  it('a queued row answers none of the three', () => {
    const f = fixture();
    expect(timesOf(byDelivery(f.s.mailForRecipient(TO), f.queued))).toEqual({});
  });

  it('a delivered row answers deliveredAt only', () => {
    const f = fixture();
    expect(timesOf(byDelivery(f.s.mailForRecipient(TO), f.delivered))).toEqual({ deliveredAt: DELIVERED });
  });

  it('an ingested row answers deliveredAt and ingestedAt', () => {
    const f = fixture();
    expect(timesOf(byDelivery(f.s.mailForRecipient(TO), f.ingested)))
      .toEqual({ deliveredAt: DELIVERED, ingestedAt: INGESTED });
  });

  it('an acked row answers all three it has', () => {
    const f = fixture();
    const rows = f.s.mailForRecipient(TO);
    expect(timesOf(byDelivery(rows, f.acked))).toEqual({ deliveredAt: DELIVERED, ingestedAt: INGESTED, ackedAt: ACKED });
    expect(timesOf(byDelivery(rows, f.ackedQueued))).toEqual({ ackedAt: ACKED });
  });

  it('the outstanding read and the programme read carry them too', () => {
    const f = fixture();
    const out = f.s.outstandingMailFor(TO);
    expect(timesOf(byDelivery(out, f.queued))).toEqual({});
    expect(timesOf(byDelivery(out, f.ingested))).toEqual({ deliveredAt: DELIVERED, ingestedAt: INGESTED });
    const prog = f.s.mailForProgram('program-a', { all: true });
    expect(timesOf(byDelivery(prog, f.acked))).toEqual({ deliveredAt: DELIVERED, ingestedAt: INGESTED, ackedAt: ACKED });
    expect(timesOf(byDelivery(prog, f.delivered))).toEqual({ deliveredAt: DELIVERED });
  });

  for (const [label] of BAD) {
    it(`a stored time that is ${label} is answered absent, never zero`, () => {
      const f = fixture();
      const row = byDelivery(f.s.mailForRecipient(TO), f.bad[label]!);
      expect(timesOf(row)).toEqual({});
      expect(row.state).toBe('acked');
    });
  }
});

describe('GET /api/mail serves the three times (the wire `ccrc-api mail list` reads)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  const list = async (a: FastifyInstance, query: string): Promise<MailSummary[]> => {
    const res = await a.inject({ method: 'GET', url: `/api/mail?${query}`, headers: { 'x-ccrc-mail-token': TOKEN } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { mail: MailSummary[] }).mail;
  };

  it('the default outstanding list, the full history and the programme list each carry them', async () => {
    const f = fixture();
    const reg = path.join(f.home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const id of [TO, FROM]) {
      const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: UUID, started: '1' };
      for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    app = await buildServer({ ...testDeps(f.home), mailToken: TOKEN, coord: f.s });
    const out = await list(app, `to=${TO}`);
    expect(timesOf(byDelivery(out, f.queued))).toEqual({});
    expect(timesOf(byDelivery(out, f.ingested))).toEqual({ deliveredAt: DELIVERED, ingestedAt: INGESTED });
    const all = await list(app, `to=${TO}&all=1`);
    expect(timesOf(byDelivery(all, f.acked))).toEqual({ deliveredAt: DELIVERED, ingestedAt: INGESTED, ackedAt: ACKED });
    const prog = await list(app, 'program=program-a&all=1');
    expect(timesOf(byDelivery(prog, f.ackedQueued))).toEqual({ ackedAt: ACKED });
  });
});
