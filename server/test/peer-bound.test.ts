// #2726: an invited reply is never refused by the peer bound. This file holds the store's half (schema 65's
// `mail.answersMail`, the invitation read, and the two peer counts that skip an invited reply) and, from Task 3 of
// the plan, the L1 decider `peerMailVerdict`. The route's half is `mail-peer-quota.test.ts`.
// Plan: docs/superpowers/plans/2026-11-10-overlord/w1a-invited-replies.md
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { peerMailVerdict, type PeerFacts } from '../src/coord/peerBound.js';
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

describe('the store: invitations and the peer counts (#2726, schema 65)', () => {
  it('reads a delivery as an invitation: the mail it carries, who sent it, and who it went to', () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    expect(s.invitation(q.deliveryId)).toEqual({ mailId: q.mailId, inviter: 'demo-a', invitee: 'demo-b', isReply: false, answered: false });
    expect(s.invitation(999_999)).toBeNull();
  });

  it('an invitation reads answered once a mail is recorded as its invited reply', () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    mail(s, 'demo-b', 'demo-a', { answersMail: q.mailId });
    expect(s.invitation(q.deliveryId)).toMatchObject({ answered: true });
  });

  it('an invited reply read as an invitation says it is one, so it invites nothing (review 1907 F1)', () => {
    const s = store();
    const q = mail(s, 'demo-a', 'demo-b');
    const a = mail(s, 'demo-b', 'demo-a', { answersMail: q.mailId });
    expect(s.invitation(a.deliveryId)).toMatchObject({ mailId: a.mailId, isReply: true });
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

describe('peerMailVerdict: the bound, unchanged by the move to L1 (plan Task 3)', () => {
  const NOW = 1_800_000_000_000;
  const ats = (n: number): number[] => Array.from({ length: n }, (_, i) => NOW - HOUR + 1 + i);
  const facts = (over: Partial<PeerFacts> = {}): PeerFacts => ({
    fromId: 'demo-quiet-mesa', toId: 'demo-calm-ridge', kind: 'question', inReplyTo: null, invitation: null,
    duplicate: false, outstanding: 0, hourAts: [], now: NOW, ...over,
  });

  it('inside every bound: bounded', () => {
    expect(peerMailVerdict(facts())).toEqual({ verdict: 'bounded' });
  });
  it("an outstanding repeat: duplicate, with today's sentence", () => {
    expect(peerMailVerdict(facts({ duplicate: true }))).toEqual({ verdict: 'duplicate',
      detail: 'an outstanding peer mail from demo-quiet-mesa to demo-calm-ridge with this subject is already queued' });
  });
  it('the pair arm: 2 outstanding is bounded, 3 refuses', () => {
    expect(peerMailVerdict(facts({ outstanding: 2 }))).toEqual({ verdict: 'bounded' });
    expect(peerMailVerdict(facts({ outstanding: 3 }))).toMatchObject({ verdict: 'peer-quota',
      detail: expect.stringMatching(/^3 peer mails from demo-quiet-mesa to demo-calm-ridge are already outstanding/) });
  });
  it('the hourly arm: 11 in the hour is bounded, 12 refuses', () => {
    expect(peerMailVerdict(facts({ hourAts: ats(11) }))).toEqual({ verdict: 'bounded' });
    expect(peerMailVerdict(facts({ hourAts: ats(12) }))).toMatchObject({ verdict: 'peer-quota',
      detail: expect.stringMatching(/^demo-quiet-mesa has sent 12 peer mails in the last hour/) });
  });
  it("today's order: duplicate before the pair, the pair before the hour", () => {
    expect(peerMailVerdict(facts({ duplicate: true, outstanding: 3, hourAts: ats(12) }))).toMatchObject({ verdict: 'duplicate' });
    expect(peerMailVerdict(facts({ outstanding: 3, hourAts: ats(12) }))).toMatchObject({
      verdict: 'peer-quota', detail: expect.stringMatching(/are already outstanding/) });
  });
});

describe('peerMailVerdict: an invited reply (#2726 (a))', () => {
  const NOW = 1_800_000_000_000;
  const full = { duplicate: true, outstanding: 3, hourAts: Array.from({ length: 12 }, (_, i) => NOW - 1_000 + i) };
  // demo-quiet-mesa answers demo-calm-ridge's mail 41, delivered to it as delivery 7.
  const INVITE = { mailId: 41, inviter: 'demo-calm-ridge', invitee: 'demo-quiet-mesa', isReply: false, answered: false };
  const reply = (over: Partial<PeerFacts> = {}): PeerFacts => ({
    fromId: 'demo-quiet-mesa', toId: 'demo-calm-ridge', kind: 'answer', inReplyTo: 7, invitation: INVITE,
    ...full, now: NOW, ...over,
  });

  it('a reply of kind answer to a mail from its recipient is invited, with every bound spent', () => {
    expect(peerMailVerdict(reply())).toEqual({ verdict: 'invited', answersMail: 41 });
  });
  it.each([
    ['names no delivery', { invitation: null }, 'inReplyTo 7 names no delivery'],
    ['is not kind answer', { kind: 'status' as const }, 'an invited reply is kind answer, not status'],
    ['answers a delivery to someone else', { invitation: { ...INVITE, invitee: 'demo-b' } }, 'delivery 7 was not delivered to demo-quiet-mesa'],
    ['answers a mail from someone else', { invitation: { ...INVITE, inviter: 'demo-b' } }, 'delivery 7 is not a mail from demo-calm-ridge'],
    ['answers a mail already answered', { invitation: { ...INVITE, answered: true } }, 'the mail delivery 7 carries is already answered'],
    ['answers an invited reply', { invitation: { ...INVITE, isReply: true } }, 'the mail delivery 7 carries is itself an invited reply'],
    ['answers its own mail', { fromId: 'demo-calm-ridge', invitation: { ...INVITE, invitee: 'demo-calm-ridge' } },
      'a mail to oneself is not an invitation'],
  ] as const)('not invited when it %s: bounded as any peer mail, and the refusal says why', (_w, over, why) => {
    const v = peerMailVerdict(reply({ duplicate: false, ...over }));
    expect(v.verdict).toBe('peer-quota');
    expect(v).toMatchObject({ detail: expect.stringContaining(`; not an invited reply: ${why}`) });
  });
  it('a failed invitation that the bound admits is simply bounded', () => {
    expect(peerMailVerdict(reply({ kind: 'status', duplicate: false, outstanding: 0, hourAts: [] }))).toEqual({ verdict: 'bounded' });
  });
  it('a mail with no inReplyTo carries no not-invited clause', () => {
    const v = peerMailVerdict(reply({ inReplyTo: null, invitation: null, duplicate: false }));
    expect(v).toMatchObject({ verdict: 'peer-quota' });
    expect((v as { detail: string }).detail).not.toContain('not an invited reply');
  });
});

describe('peerMailVerdict: a peer-quota refusal says when the mail can go (#2726 (c))', () => {
  const NOW = 1_800_000_000_000;
  const HINT = ". A reply to a mail of demo-calm-ridge's is outside this bound: send it as kind answer with inReplyTo set to that mail's delivery id";
  const facts = (over: Partial<PeerFacts> = {}): PeerFacts => ({
    fromId: 'demo-quiet-mesa', toId: 'demo-calm-ridge', kind: 'question', inReplyTo: null, invitation: null,
    duplicate: false, outstanding: 0, hourAts: [], now: NOW, ...over,
  });

  it('the pair arm: retry on an ack by the recipient, in words too, with the inReplyTo hint', () => {
    expect(peerMailVerdict(facts({ outstanding: 3 }))).toEqual({ verdict: 'peer-quota',
      retry: { on: 'ack', toId: 'demo-calm-ridge' },
      detail: '3 peer mails from demo-quiet-mesa to demo-calm-ridge are already outstanding; it can go when ' +
        'demo-calm-ridge acks one, which it does when it next reads its mail' + HINT });
  });
  it('the hourly arm: retry at the time the oldest counted mail leaves the hour', () => {
    const oldest = NOW - HOUR + 90_000; // leaves the hour 90 s from now
    const hourAts = [oldest, ...Array.from({ length: 11 }, (_, i) => NOW - 1_000 + i)];
    expect(peerMailVerdict(facts({ hourAts }))).toEqual({ verdict: 'peer-quota',
      retry: { on: 'time', at: oldest + HOUR },
      detail: `demo-quiet-mesa has sent 12 peer mails in the last hour; it can go at ${new Date(oldest + HOUR).toISOString()} ` +
        '(in 90 s), when the oldest leaves the hour' + HINT });
  });
  it('with thirteen in the hour, the slot frees when the second oldest leaves, not the oldest', () => {
    const hourAts = Array.from({ length: 13 }, (_, i) => NOW - HOUR + 1_000 * (i + 1));
    expect(peerMailVerdict(facts({ hourAts }))).toMatchObject({ retry: { on: 'time', at: hourAts[1]! + HOUR } });
  });
  it('a mail that tried inReplyTo gets the reason instead of the hint', () => {
    const v = peerMailVerdict(facts({ outstanding: 3, kind: 'answer', inReplyTo: 7 }));
    expect(v).toMatchObject({ detail: expect.stringMatching(/; not an invited reply: inReplyTo 7 names no delivery$/) });
    expect((v as { detail: string }).detail).not.toContain('is outside this bound');
  });
  it('duplicate carries no retry: the mail is already queued, there is nothing to wait out', () => {
    expect(peerMailVerdict(facts({ duplicate: true }))).not.toHaveProperty('retry');
  });
});
