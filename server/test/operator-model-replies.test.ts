// Overlord W1 chat, PR B (plan `w1-chat.md` Task 5; operator item 327; the coordinator's ruling, call 1888): the Overlord's reply
// record in the private store. `recordReply` with the REAL privacy journal: one issued-id sequence over messages and replies, recorded
// with the journal's existing kind; a resend is a replay, the same entry with other text is refused; a restore that lowered the store
// never reissues an id; what a reply answers (`replyLinks`) and its off-the-record fact; the cap; a closed store. The open's
// coherence over both tables. THE OLDER-BUILD PROOF: a journal written with replies reads, through the grammar and coherence as they
// are on main, as coherent, and the next message id is above it. The response row (`insertReplyResponse`, `replyResponsesFor`) and
// the boot arm (`runReplyResponseBoot`). Fixture files only, every path under a `mkTmp` directory.
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { chainedJournalFileAt } from '../src/chainedJournalFile.js';
import { openCoordDb } from '../src/coord/db.js';
import { insertReplyResponse, replyResponsesFor, repliesWithoutResponse } from '../src/coord/responsesStore.js';
import { OPERATOR_MODEL_DB_BASENAME } from '../src/operatorModel/db.js';
import { nextMessageId } from '../src/operatorModel/messages.js';
import { PRIVACY_JOURNAL_BASENAME, PRIVACY_JOURNAL_FORMAT, privacyCoherence, privacyHighestId } from '../src/operatorModel/privacyJournal.js';
import { replyBootSummary, runReplyResponseBoot } from '../src/operatorModel/replyBoot.js';
import { openOperatorModelStore, type OperatorModelOpen } from '../src/operatorModel/store.js';
import * as replies from '../src/operatorModel/replies.js';
import * as operatorMessages from '../../shared/operatorMessages.js';
import { MESSAGE_TEXT_MAX_BYTES } from '../../shared/operatorMessages.js';
import { readChatThread } from '../../shared/overlordChat.js';
import { REPLY_WINDOW_MS, type ResponseStamp } from '../../shared/responses.js';
import { replyLinksCases, replyTargetCases } from './sim/replySets.js';
import { mkTmp } from './tmpHelpers.js';

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const NOW = 1_800_000_000_000;
const SID = 'lane-a-overlord';
const uuidOf = (n: number): string => `0f1e2d3c-4b5a-4968-8776-${String(n).padStart(12, '0')}`;
const STAMP: ResponseStamp = { boot: { kind: 'measured', epoch: 1 }, restore: { kind: 'measured', n: 0 } };
const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) if (db.isOpen) db.close(); });

const run = (cases: Record<string, () => void | Promise<void>>): void => { for (const [name, c] of Object.entries(cases)) it(name, c); };
const dirIn = (): string => {
  const d = path.join(mkTmp('ccrc-replies-'), '.ccrc');
  mkdirSync(d, { recursive: true });
  return d;
};
const open = (dir: string): OperatorModelOpen => {
  const o = openOperatorModelStore(path.join(dir, OPERATOR_MODEL_DB_BASENAME), dir, NOW);
  opened.push(o.db);
  return o;
};
const message = (o: OperatorModelOpen, over: { at?: number; offRecord?: boolean; sessionId?: string } = {}) => {
  const r = o.store.recordMessage({ at: over.at ?? NOW, sessionId: over.sessionId ?? SID, term: 1, actor: ACTOR, text: 'a fixture message', mark: false,
    composedKey: null, offRecord: over.offRecord ?? false });
  if (!r.ok) throw new Error(`message: ${r.error} ${r.detail}`);
  return r.value.id;
};
const pickUp = (o: OperatorModelOpen, id: number, at: number): void => {
  const r = o.store.moveMessage(id, 'pick-up', 'hook', at);
  if (!r.ok) throw new Error(`pick-up ${id}: ${r.error} ${r.detail}`);
};
const recordReply = (o: OperatorModelOpen, n: number,
  over: { at?: number; text?: string; sessionId?: string; answers?: readonly number[]; answersCut?: boolean } = {}) =>
  o.store.recordReply({ at: over.at ?? NOW, turnAt: (over.at ?? NOW) - 5, sessionId: over.sessionId ?? SID, term: 1, entryUuid: uuidOf(n),
    text: over.text ?? `fixture reply ${n}`, answers: over.answers ?? [], answersCut: over.answersCut ?? false });
const replyId = (r: ReturnType<typeof recordReply>): number => { if (!r.ok) throw new Error(`${r.error}: ${r.detail}`); return r.value.id; };
const journalEntries = (dir: string): Record<string, unknown>[] => {
  const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l) as { entry: Record<string, unknown> }).entry);
};
const replyRows = (o: OperatorModelOpen) => o.db.prepare('SELECT id, sessionId, entryUuid, cut, inReplyTo, offRecord FROM overlord_replies ORDER BY id').all();

describe('replyLinks (sim/replySets.ts)', () => run(replyLinksCases(operatorMessages)));
describe('replyTargetVerdict (sim/replySets.ts)', () => run(replyTargetCases(replies)));

describe('recordReply: one issued-id sequence, through the privacy journal\'s existing record (call 1888)', () => {
  it('a message, a reply and a message take ids 1, 2 and 3, each issue one `privacy-message-issued` record of ids and times only', () => {
    const dir = dirIn();
    const o = open(dir);
    expect([message(o), replyId(recordReply(o, 1, { text: 'fixture words that must not reach the journal' })), message(o)]).toEqual([1, 2, 3]);
    expect(journalEntries(dir)).toEqual([1, 2, 3].map((id) => ({ kind: 'privacy-message-issued', id, at: NOW })));
    expect(readFileSync(path.join(dir, PRIVACY_JOURNAL_BASENAME), 'utf8')).not.toContain('fixture words');
  });

  it('the same entry twice is a replay that writes nothing; the same entry with other text refuses entry-reused', () => {
    const dir = dirIn();
    const o = open(dir);
    const first = recordReply(o, 1);
    const again = recordReply(o, 1, { at: NOW + 50 });
    expect([first.ok && first.value.replay, again.ok && again.value]).toEqual([false, { id: 1, cut: false, inReplyTo: null, offRecord: false, replay: true, at: NOW }]);
    expect([replyRows(o).length, journalEntries(dir).length]).toEqual([1, 1]);
    expect(recordReply(o, 1, { text: 'other words' })).toEqual({ ok: false, error: 'refused', detail: 'entry-reused' });
    // The key is the session and the entry: another session's entry of the same uuid is its own row.
    expect(replyId(recordReply(o, 1, { sessionId: 'lane-b-overlord' }))).toBe(2);
  });

  it('a store restored lower never reissues an id: the next reply is above the journal\'s highest', () => {
    const dir = dirIn();
    const o = open(dir);
    replyId(recordReply(o, 1)); replyId(recordReply(o, 2)); message(o);
    o.db.exec('DELETE FROM overlord_replies; DELETE FROM operator_messages');
    o.db.close();
    const again = open(dir);
    expect(again.privacy).toEqual({ verdict: 'coherent' });
    expect(replyId(recordReply(again, 3))).toBe(4);
  });

  it('inReplyTo and offRecord follow the messages this session picked up since its previous reply; an off-the-record one makes the reply off the record', () => {
    const o = open(dirIn());
    const m1 = message(o); pickUp(o, m1, NOW + 10);
    const r1 = recordReply(o, 1, { at: NOW + 20 });
    expect(r1.ok && [r1.value.inReplyTo, r1.value.offRecord]).toEqual([m1, false]);
    const m2 = message(o, { offRecord: true }); pickUp(o, m2, NOW + 30);
    const m3 = message(o); pickUp(o, m3, NOW + 40);
    const other = message(o, { sessionId: 'lane-b-overlord' }); pickUp(o, other, NOW + 45);
    const unpicked = message(o);
    const r2 = recordReply(o, 2, { at: NOW + 50 });
    expect(r2.ok && [r2.value.inReplyTo, r2.value.offRecord]).toEqual([m3, true]);
    // The next turn answered nothing new: no inReplyTo, on the record (the earlier off-the-record message is not carried).
    const r3 = recordReply(o, 3, { at: NOW + 60 });
    expect(r3.ok && [r3.value.inReplyTo, r3.value.offRecord]).toEqual([null, false]);
    expect(unpicked).toBeGreaterThan(other);
    expect(replyRows(o).map((r) => [(r as { inReplyTo: number | null }).inReplyTo, (r as { offRecord: number }).offRecord])).toEqual([[m1, 0], [m3, 1], [null, 0]]);
    // Off the record on EVERY reader: the thread's page and the checkpoint's read answer the stored fact, and so does the wire's reader.
    const page = o.store.repliesPage(null, 10);
    const since = o.store.repliesSince(0);
    expect(page.kind === 'measured' && page.value.rows.map((r) => r.offRecord)).toEqual([false, true, false]);
    expect(since.kind === 'measured' && since.value.map((r) => r.offRecord)).toEqual([false, true, false]);
    if (page.kind !== 'measured') return;
    const wire = readChatThread(JSON.parse(JSON.stringify({ v: 1, designation: 'designated', sessionId: SID, term: 1,
      entries: page.value.rows.map((row) => ({ kind: 'reply', row, response: { kind: 'no-row' } })),
      messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 0 } }, readiness: { kind: 'read', value: { oldest: null } },
      replies: { kind: 'read', value: { more: false } }, older: null })));
    expect(wire.ok && wire.thread.entries.map((e) => e.kind === 'reply' && e.row.offRecord)).toEqual([false, true, false]);
  });

  // THE ANSWERED IDS (review 4173 F2, call 1953): the ids the turn's own prompts name say what was answered, each verified here; the
  // window only widens off the record. A MISTAKE FALLS TOWARD OFF THE RECORD.
  describe('the ids the turn names, verified (F2)', () => {
    it('THE REVIEW\'S CASE: a body recorded late after an off-the-record message comes out off the record; the true answer names it and is off the record too', () => {
      const o = open(dirIn());
      const m1 = message(o); pickUp(o, m1, NOW + 10);
      // Stop 1's body (it answered M1) is spooled; meanwhile the operator sends M2 off the record and the Overlord picks it up.
      const m2 = message(o, { offRecord: true }); pickUp(o, m2, NOW + 30);
      // Stop 2 resends the spooled body first: it is recorded now, late. Its window takes in M2, so it is the more private side.
      const late = recordReply(o, 1, { at: NOW + 40, answers: [m1] });
      expect(late.ok && [late.value.inReplyTo, late.value.offRecord], 'linked to what it named, off the record by the window').toEqual([m1, true]);
      // Stop 2's own body names M2: its window is empty now, but the named id carries the fact.
      const own = recordReply(o, 2, { at: NOW + 41, answers: [m2] });
      expect(own.ok && [own.value.inReplyTo, own.value.offRecord]).toEqual([m2, true]);
    });

    it('a named id that is another session\'s, or unknown, makes the reply off the record and is never its link (condition 1)', () => {
      const o = open(dirIn());
      const mine = message(o); pickUp(o, mine, NOW + 10);
      const theirs = message(o, { sessionId: 'lane-b-overlord' });
      const other = recordReply(o, 1, { at: NOW + 20, answers: [theirs] });
      expect(other.ok && [other.value.inReplyTo, other.value.offRecord], 'the window links, the bad id does not').toEqual([mine, true]);
      const unknown = recordReply(o, 2, { at: NOW + 30, answers: [9_999] });
      expect(unknown.ok && [unknown.value.inReplyTo, unknown.value.offRecord]).toEqual([null, true]);
    });

    it('a turn that answers no message, an empty list and an empty window, is on the record with no link (condition 2)', () => {
      const o = open(dirIn());
      const r = recordReply(o, 1, { at: NOW + 20, answers: [] });
      expect(r.ok && [r.value.inReplyTo, r.value.offRecord]).toEqual([null, false]);
    });

    it('A LINE INSIDE A MESSAGE (condition 4): the worst a nudge-shaped line can do is link another of the session\'s own messages or make the reply more private', () => {
      const o = open(dirIn());
      const own = message(o); pickUp(o, own, NOW + 10);
      const older = message(o, { at: NOW - 1000 });   // another of this session's messages, on the record, never picked up
      const offOld = message(o, { at: NOW - 900, offRecord: true });
      // A prompt that pastes a nudge line naming `older` (the reader names it beside the real one).
      const a = recordReply(o, 1, { at: NOW + 20, answers: [older] });
      expect(a.ok && [a.value.inReplyTo, a.value.offRecord], 'linked to the session\'s own message, still on the record').toEqual([older, false]);
      const b = recordReply(o, 2, { at: NOW + 30, answers: [offOld] });
      expect(b.ok && [b.value.inReplyTo, b.value.offRecord], 'naming an off-the-record one only makes it more private').toEqual([offOld, true]);
      const theirs = message(o, { sessionId: 'lane-b-overlord' });
      const c = recordReply(o, 3, { at: NOW + 40, answers: [theirs] });
      expect(c.ok && [c.value.inReplyTo, c.value.offRecord], 'another session\'s id is never linked, and the reply goes off the record').toEqual([null, true]);
    });

    it('a cut list makes the reply off the record (condition 5)', () => {
      const o = open(dirIn());
      const m = message(o);
      const r = recordReply(o, 1, { at: NOW + 20, answers: [m], answersCut: true });
      expect(r.ok && [r.value.inReplyTo, r.value.offRecord]).toEqual([m, true]);
    });

    it('a bad list is refused, naming the field, writing nothing', () => {
      const o = open(dirIn());
      for (const answers of [Array.from({ length: operatorMessages.REPLY_ANSWERS_MAX + 1 }, (_v, i) => i + 1), [0], [1.5], [-2]]) {
        expect(recordReply(o, 1, { answers }), JSON.stringify(answers).slice(0, 20)).toMatchObject({ ok: false, error: 'refused', detail: expect.stringMatching(/^answers:/) });
      }
      expect(o.store.recordReply({ at: NOW, turnAt: NOW, sessionId: SID, term: 1, entryUuid: uuidOf(1), text: 't', answers: [], answersCut: 'yes' as never }))
        .toMatchObject({ ok: false, error: 'refused', detail: 'answersCut: not a boolean' });
      expect(replyRows(o)).toEqual([]);
    });
  });

  it('THE STORE\'S CAP IS BELOW THE REPORT\'S BOUND, where both are declared (the cut-before-the-mask point, call 1952)', () => {
    expect(operatorMessages.REPLY_STORE_CAP_BELOW_REPORT_BOUND).toBe(true);
    expect(MESSAGE_TEXT_MAX_BYTES).toBeLessThan(operatorMessages.REPLY_REPORT_MAX_BYTES);
  });

  it('F7: a journal moved back while the store is open still issues above every id either table holds (the writers\' own reads)', () => {
    const dir = dirIn();
    const o = open(dir);
    const journal = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    message(o);                                            // id 1
    const early = readFileSync(journal);                   // the journal as it stood at id 1
    expect(replyId(recordReply(o, 1))).toBe(2);            // a reply: id 2
    message(o); message(o); message(o);                    // ids 3 to 5: the MESSAGE table holds the highest
    writeFileSync(journal, early);                         // the journal moves back to id 1 while the store stays open
    expect(replyId(recordReply(o, 2)), 'the reply writer reads the highest over BOTH tables, not only its own (2)').toBe(6);
    expect(replyId(recordReply(o, 3))).toBe(7);
    expect(replyId(recordReply(o, 4))).toBe(8);            // now the REPLY table holds the highest
    writeFileSync(journal, early);
    const m = message(o);
    expect(m, 'the message writer the same, over the replies too (not its own 5)').toBe(9);
  });

  it('a text over the cap is cut with the one mark; a closed store answers not-open and writes nothing', () => {
    const o = open(dirIn());
    const long = recordReply(o, 1, { text: 'x'.repeat(MESSAGE_TEXT_MAX_BYTES + 100) });
    expect(long.ok && long.value.cut).toBe(true);
    const stored = o.store.repliesPage(null, 10);
    expect(stored.kind === 'measured' && stored.value.rows[0]!.text).toMatch(/ \[cut: \d+ more bytes\]$/);
    o.db.close();
    expect(recordReply(o, 2)).toMatchObject({ ok: false, error: 'not-open' });
  });
});

describe('the open\'s coherence over both tables (call 1888)', () => {
  it('a store whose highest id is a reply\'s, with a journal at that id, is coherent', () => {
    const dir = dirIn();
    const o = open(dir);
    message(o); replyId(recordReply(o, 1));
    o.db.close();
    expect(open(dir).privacy).toEqual({ verdict: 'coherent' });
  });

  it('a journal below a reply\'s id re-anchors behind, at the reply\'s id, and the next id is above it', () => {
    const dir = dirIn();
    const o = open(dir);
    message(o);
    o.db.close();
    const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    const one = readFileSync(p);
    const later = open(dir);
    replyId(recordReply(later, 1)); replyId(recordReply(later, 2));
    later.db.close();
    writeFileSync(p, one);   // the journal moved back to the message's record; the store holds replies 2 and 3
    const again = open(dir);
    expect(again.privacy).toMatchObject({ verdict: 're-anchor', reason: 'behind', highestId: 3, appended: true });
    expect(message(again)).toBe(4);
  });

  it('a missing journal beside replies only re-anchors missing at the highest reply id', () => {
    const dir = dirIn();
    const o = open(dir);
    replyId(recordReply(o, 1));
    o.db.close();
    renameSync(path.join(dir, PRIVACY_JOURNAL_BASENAME), path.join(dir, 'moved-aside.log'));
    expect(open(dir).privacy).toMatchObject({ verdict: 're-anchor', reason: 'missing', highestId: 1 });
  });
});

describe('the older-build proof: a server below PR B reads a journal with reply issues as coherent (call 1888)', () => {
  // The grammar as it is on main, pinned: its kinds are exactly these two. This case is green on main; a change that writes any
  // new kind must add it to the grammar, and then this pin reds.
  const MAIN_KINDS = ['privacy-message-issued', 'privacy-anchor'];
  it('CHARACTERIZATION: the privacy journal\'s grammar holds exactly the two kinds main holds', () => {
    expect([...PRIVACY_JOURNAL_FORMAT.kinds].sort()).toEqual([...MAIN_KINDS].sort());
  });

  it('a journal written with replies holds only main\'s kinds, reads verified, and main\'s coherence over the messages alone is coherent with the next message id above it', () => {
    const dir = dirIn();
    const o = open(dir);
    message(o); replyId(recordReply(o, 1)); replyId(recordReply(o, 2)); message(o); replyId(recordReply(o, 3));
    const mainStoreHighest = (o.db.prepare('SELECT max(id) AS m FROM operator_messages').get() as { m: number }).m;
    o.db.close();
    const read = chainedJournalFileAt(PRIVACY_JOURNAL_FORMAT, dir, PRIVACY_JOURNAL_BASENAME).read();
    expect(read.kind).toBe('records');
    if (read.kind !== 'records') return;
    expect(read.tail).toBeNull();
    expect(read.records.every((r) => MAIN_KINDS.includes(r.entry.kind))).toBe(true);
    const journalHighest = privacyHighestId(read.records);
    expect([mainStoreHighest, journalHighest]).toEqual([4, 5]);
    // Main's store reads `max(id)` of its messages only: a journal ahead of it is coherent, never refused or re-anchored.
    expect(privacyCoherence({ kind: 'read', highestId: journalHighest }, mainStoreHighest)).toEqual({ verdict: 'coherent', highestId: 5 });
    expect(nextMessageId(mainStoreHighest, journalHighest)).toBe(6);
  });
});

describe('the reply\'s response row and the boot arm', () => {
  const coordDb = (): DatabaseSync => { const db = openCoordDb(path.join(mkTmp('ccrc-replies-coord-'), 'coord.db')); opened.push(db); return db; };
  const rows = (db: DatabaseSync) => db.prepare("SELECT kind, label, refId, state, delivery, insertedAt, windowCapAt FROM operator_responses WHERE kind = 'reply' ORDER BY refId").all()
    .map((r) => ({ ...r }));

  it('insertReplyResponse writes one delivered row at the reply\'s own time, its window a week on; a second insert changes nothing', () => {
    const db = coordDb();
    expect(insertReplyResponse(db, 7, STAMP, NOW)).toEqual({ inserted: true });
    expect(insertReplyResponse(db, 7, STAMP, NOW + 99)).toEqual({ inserted: false });
    expect(rows(db)).toEqual([{ kind: 'reply', label: 'reply', refId: 7, state: 'delivered', delivery: 'at-once', insertedAt: NOW, windowCapAt: NOW + REPLY_WINDOW_MS }]);
    const read = replyResponsesFor(db, [7, 8]);
    expect(read.ok && [...read.rows.entries()]).toEqual([[7, { id: 1, handledAt: null }]]);
    expect(repliesWithoutResponse(db, [7, 8, 9])).toEqual([8, 9]);
  });

  it('the boot arm inserts a row for a recorded reply that has none, leaves a standing one alone, and skips one older than the window', () => {
    const o = open(dirIn());
    const db = coordDb();
    const old = replyId(recordReply(o, 1, { at: NOW - REPLY_WINDOW_MS - 10 }));
    const standing = replyId(recordReply(o, 2, { at: NOW - 100 }));
    const missing = replyId(recordReply(o, 3, { at: NOW - 50 }));
    insertReplyResponse(db, standing, STAMP, NOW - 100);
    const first = runReplyResponseBoot({ store: o.store, coordDb: db, stamp: () => STAMP, now: () => NOW });
    expect([first.counts, first.lines]).toEqual([{ inserted: 1, standing: 1, errors: 0 }, []]);
    expect(rows(db).map((r) => [r.refId, r.insertedAt])).toEqual([[standing, NOW - 100], [missing, NOW - 50]]);
    expect(rows(db).some((r) => r.refId === old)).toBe(false);
    const second = runReplyResponseBoot({ store: o.store, coordDb: db, stamp: () => STAMP, now: () => NOW });
    expect(second.counts).toEqual({ inserted: 0, standing: 2, errors: 0 });
    expect(replyBootSummary(second.counts)).toBe('operator model reply boot: inserted 0, standing 2, errors 0');
  });

  it('a closed private store: the boot arm counts one error and inserts nothing, its line naming no text', () => {
    const o = open(dirIn());
    replyId(recordReply(o, 1, { text: 'fixture words for the boot arm' }));
    o.db.close();
    const db = coordDb();
    const r = runReplyResponseBoot({ store: o.store, coordDb: db, stamp: () => STAMP, now: () => NOW });
    expect(r.counts).toEqual({ inserted: 0, standing: 0, errors: 1 });
    expect(r.lines.join('\n')).not.toContain('fixture words');
    expect(rows(db)).toEqual([]);
  });
});

describe('the reply readers', () => {
  it('repliesPage pages newest first, answers oldest first with more, and refuses a bad argument or a closed store as unmeasured', () => {
    const o = open(dirIn());
    for (let n = 1; n <= 5; n += 1) replyId(recordReply(o, n, { at: NOW + n }));
    const p1 = o.store.repliesPage(null, 2);
    expect(p1.kind === 'measured' && [p1.value.rows.map((r) => r.id), p1.value.more]).toEqual([[4, 5], true]);
    const p2 = o.store.repliesPage(4, 10);
    expect(p2.kind === 'measured' && [p2.value.rows.map((r) => r.id), p2.value.more]).toEqual([[1, 2, 3], false]);
    for (const [b, l] of [[0, 5], [1.5, 5], [null, 0], [null, 501]] as const) expect(o.store.repliesPage(b, l).kind).toBe('unmeasured');
    const since = o.store.repliesSince(NOW + 4);
    expect(since.kind === 'measured' && since.value.map((r) => r.id)).toEqual([4, 5]);
    o.db.close();
    expect(o.store.repliesPage(null, 5).kind).toBe('unmeasured');
    expect(o.store.replyIdsSince(0).kind).toBe('unmeasured');
  });
});
