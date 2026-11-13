// #2726: an invited reply is never refused by the peer bound. This file holds the store's half (schema 64's
// `mail.answersMail`, the invitation read, and the two peer counts that skip an invited reply) and, from Task 3 of
// the plan, the L1 decider `peerMailVerdict`. The route's half is `mail-peer-quota.test.ts`.
// Plan: docs/superpowers/plans/2026-11-10-overlord/w1a-invited-replies.md
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const HOUR = 3_600_000;

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-peerbound-'), 'coord.db')));

/** One peer mail from `fromId` to `toId` with one queued delivery; answers both ids. */
const mail = (s: CoordStore, fromId: string, toId: string, over: { runId?: number | null; answersMail?: number | null; subject?: string } = {}) => {
  const { id } = s.insertMail({ fromId, fromUuid: 'u', toId, runId: over.runId ?? null, kind: 'question',
    subject: over.subject ?? 's', body: 'b', artifacts: [], answersMail: over.answersMail ?? null });
  const d = s.queueDelivery(id, toId, '');
  return { mailId: id, deliveryId: d.id };
};

describe('the store: invitations and the peer counts (#2726, schema 64)', () => {
  it('reads a delivery as an invitation: the mail it carries, who sent it, and who it went to', () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    expect(s.invitation(q.deliveryId)).toEqual({ mailId: q.mailId, inviter: 'demo-a', invitee: 'demo-b', answered: false });
    expect(s.invitation(999_999)).toBeNull();
  });

  it('an invitation reads answered once a mail is recorded as its invited reply', () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    mail(s, 'demo-b', 'demo-a', { answersMail: q.mailId });
    expect(s.invitation(q.deliveryId)).toMatchObject({ answered: true });
  });

  it('one invited reply per mail is a fact of the database: a second row answering the same mail is refused', () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    mail(s, 'demo-b', 'demo-a', { answersMail: q.mailId });
    expect(() => mail(s, 'demo-b', 'demo-a', { answersMail: q.mailId })).toThrow(/UNIQUE/);
  });

  it('outstandingPeerCount skips an invited reply and counts an unasked mail', () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    mail(s, 'demo-b', 'demo-a', { answersMail: q.mailId });
    expect(s.outstandingPeerCount('demo-b', 'demo-a')).toBe(0);
    mail(s, 'demo-b', 'demo-a', { subject: 'unasked' });
    expect(s.outstandingPeerCount('demo-b', 'demo-a')).toBe(1);
  });

  it('peerMailAtsInLastHour: accepted peer mail of the last hour, invited replies, run mail and older rows skipped, ascending', () => {
    const s = store();
    const run = s.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-c' }) as { id: number };
    const q = mail(s, 'demo-a', 'demo-b');
    const now = Date.now();
    const at = (mailId: number, t: number): void => { s.db.prepare('UPDATE mail SET at = ? WHERE id = ?').run(t, mailId); };
    const late = mail(s, 'demo-b', 'demo-a', { subject: 'late' });       at(late.mailId, now - 1_000);
    const early = mail(s, 'demo-b', 'demo-c', { subject: 'early' });     at(early.mailId, now - 2_000);
    const invited = mail(s, 'demo-b', 'demo-a', { answersMail: q.mailId }); at(invited.mailId, now - 1_500);
    const ran = mail(s, 'demo-b', 'demo-a', { runId: run.id });          at(ran.mailId, now - 1_500);
    const old = mail(s, 'demo-b', 'demo-a', { subject: 'old' });         at(old.mailId, now - HOUR - 1);
    expect(s.peerMailAtsInLastHour('demo-b', now)).toEqual([now - 2_000, now - 1_000]);
  });

  it("the invitation read searches by key, and scans neither mail nor mail_deliveries", () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    const spy = vi.spyOn(s.db, 'prepare');
    let sql: string[];
    try { s.invitation(q.deliveryId); sql = spy.mock.calls.map((c) => String(c[0])); } finally { spy.mockRestore(); }
    expect(sql.length).toBeGreaterThan(0);
    for (const q2 of sql) {
      const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${q2}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
      expect(plan, q2).not.toMatch(/\bSCAN (mail|mail_deliveries)\b/);
    }
  });
});
