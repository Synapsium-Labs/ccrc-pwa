// Overlord W1, the private store (plan w1-private-store.md, Task 3; spec §7.6, H27): the privacy journal on the chained kernel,
// bound through the shared file adapter by `openOperatorModelStore`, with its boot coherence. Fixture directories only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { chainedJournalFileAt } from '../src/chainedJournalFile.js';
import { DELEGATION_JOURNAL_FORMAT } from '../src/coord/delegation-journal.js';
import * as privacy from '../src/operatorModel/privacyJournal.js';
import {
  PRIVACY_JOURNAL_BASENAME, PRIVACY_JOURNAL_FORMAT, PRIVACY_JOURNAL_TORN_DIR, PrivacyJournalError, privacyJournalEntry,
} from '../src/operatorModel/privacyJournal.js';
import { OPERATOR_MODEL_DB_BASENAME } from '../src/operatorModel/db.js';
import { openOperatorModelStore, operatorModelBootLines, type OperatorModelOpen } from '../src/operatorModel/store.js';
import { privacyCoherenceCases } from './sim/operatorModelSets.js';
import { mkTmp } from './tmpHelpers.js';

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const NOW = 1_800_000_000_000;
const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) if (db.isOpen) db.close(); });

const dirIn = (): string => {
  const d = path.join(mkTmp('ccrc-privacy-'), '.ccrc');
  mkdirSync(d, { recursive: true });
  return d;
};
const open = (dir: string): OperatorModelOpen => {
  const o = openOperatorModelStore(path.join(dir, OPERATOR_MODEL_DB_BASENAME), dir, NOW);
  opened.push(o.db);
  return o;
};
const record = (o: OperatorModelOpen, text = 'hello') =>
  o.store.recordMessage({ at: NOW, sessionId: 'lane-a-project-a', term: 1, actor: ACTOR, text, mark: false, composedKey: null });
const idOf = (r: ReturnType<typeof record>): number => { if (!r.ok) throw new Error(`${r.error}: ${r.detail}`); return r.value.id; };
const journalLines = (dir: string): Record<string, unknown>[] => {
  const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l) as { entry: Record<string, unknown> }).entry);
};

describe('privacyCoherence (open question 10)', () => {
  for (const [name, fn] of Object.entries(privacyCoherenceCases(privacy))) it(name, fn as () => void);
});

describe('the privacy journal\'s format', () => {
  it('accepts each kind with its exact keys', () => {
    expect(privacyJournalEntry({ kind: 'privacy-message-issued', id: 3, at: 5 })).toEqual({ kind: 'privacy-message-issued', id: 3, at: 5 });
    expect(privacyJournalEntry({ kind: 'privacy-anchor', highestId: 7, reason: 'behind', at: 5 }))
      .toEqual({ kind: 'privacy-anchor', highestId: 7, reason: 'behind', at: 5 });
  });

  it('refuses an extra key, a missing key, a wrong type, a non-positive id, a bad reason and a delegation kind, as its own class', () => {
    const bad: unknown[] = [
      { kind: 'privacy-message-issued', id: 3, at: 5, text: 'words' },
      { kind: 'privacy-message-issued', id: 3 },
      { kind: 'privacy-message-issued', id: '3', at: 5 },
      { kind: 'privacy-message-issued', id: 0, at: 5 },
      { kind: 'privacy-message-issued', id: -1, at: 5 },
      { kind: 'privacy-message-issued', id: 1.5, at: 5 },
      { kind: 'privacy-anchor', highestId: 7, reason: 'lost', at: 5 },
      { kind: 'privacy-anchor', highestId: 0, reason: 'missing', at: 5 },
      { kind: DELEGATION_JOURNAL_FORMAT.kinds[0], id: 1, at: 5 },
      'privacy-message-issued', null,
    ];
    for (const b of bad) expect(() => privacyJournalEntry(b), JSON.stringify(b)).toThrow(PrivacyJournalError);
  });

  it('its kinds all start privacy-, and its file names are its own', () => {
    expect(PRIVACY_JOURNAL_FORMAT.kinds).toEqual(['privacy-message-issued', 'privacy-anchor']);
    expect(PRIVACY_JOURNAL_BASENAME).toBe('privacy-journal.log');
    expect(PRIVACY_JOURNAL_TORN_DIR).toBe('privacy-journal.torn');
    expect(PRIVACY_JOURNAL_TORN_DIR).not.toContain('/');
  });
});

describe('the store records through the privacy journal', () => {
  it('two records in a row write their journal record and their row, with ids n and n + 1, and a third after a reopen gets n + 2', () => {
    const dir = dirIn();
    const a = open(dir);
    expect(a.privacy).toEqual({ verdict: 'fresh' });
    const n = idOf(record(a));
    expect(idOf(record(a))).toBe(n + 1);
    expect(journalLines(dir)).toEqual([
      { kind: 'privacy-message-issued', id: n, at: NOW }, { kind: 'privacy-message-issued', id: n + 1, at: NOW },
    ]);
    a.db.close();
    const b = open(dir);
    expect(b.privacy).toEqual({ verdict: 'coherent' });
    expect(idOf(record(b))).toBe(n + 2);
    expect(journalLines(dir).map((e) => e.id)).toEqual([n, n + 1, n + 2]);
  });

  it('the journal file holds ids and times only, never the words', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o, 'a sentence nobody else may read');
    expect(readFileSync(path.join(dir, PRIVACY_JOURNAL_BASENAME), 'utf8')).not.toContain('sentence');
  });

  it('a fault after the append and before the commit leaves the journal one ahead, and the next id skips it', () => {
    const dir = dirIn();
    const o = open(dir);
    expect(idOf(record(o))).toBe(1);
    const real = o.db.prepare.bind(o.db);
    const spy = vi.spyOn(o.db, 'prepare').mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT INTO operator_messages')) throw new Error('simulated fault before the commit');
      return real(sql);
    });
    const failed = record(o);
    spy.mockRestore();
    expect(failed).toMatchObject({ ok: false, error: 'write-failed' });
    expect(journalLines(dir).map((e) => e.id)).toEqual([1, 2]);
    expect(o.store.highestMessageId()).toEqual({ kind: 'measured', value: 1 });
    expect(idOf(record(o))).toBe(3);
    o.db.close();
    expect(open(dir).privacy).toEqual({ verdict: 'coherent' });
  });

  it('a torn tail is healed at the open, its bytes kept under privacy-journal.torn/', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o);
    o.db.close();
    const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    const before = readFileSync(p);
    writeFileSync(p, Buffer.concat([before, Buffer.from('{"v":1,"seq')]));
    const again = open(dir);
    expect(again.healed).toMatch(/^\d+-[0-9a-f]{64}\.tail$/);
    expect(again.privacy).toEqual({ verdict: 'coherent' });
    expect(readFileSync(p)).toEqual(before);
    const torn = path.join(dir, PRIVACY_JOURNAL_TORN_DIR);
    expect(statSync(torn).mode & 0o777).toBe(0o700);
    expect(readdirSync(torn)).toEqual([again.healed]);
    expect(readFileSync(path.join(torn, again.healed!), 'utf8')).toBe('{"v":1,"seq');
    expect(idOf(record(again))).toBe(2);
  });

  it('a torn tail written while the server runs is cut aside in-process, kept, and the append retried once (F1)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = dirIn();
    const o = open(dir);
    expect(idOf(record(o))).toBe(1);
    const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    const before = readFileSync(p);
    writeFileSync(p, Buffer.concat([before, Buffer.from('{"v":1,"seq')]));   // a partial append that failed
    expect(idOf(record(o))).toBe(2);
    expect(journalLines(dir).map((e) => e.id)).toEqual([1, 2]);
    const torn = path.join(dir, PRIVACY_JOURNAL_TORN_DIR);
    expect(readdirSync(torn)).toHaveLength(1);
    expect(readFileSync(path.join(torn, readdirSync(torn)[0]!), 'utf8')).toBe('{"v":1,"seq');
    expect(warn.mock.calls.flat().join('\n')).toContain('torn tail was cut aside while the server ran');
    warn.mockRestore();
    o.db.close();
    expect(open(dir).privacy).toEqual({ verdict: 'coherent' });
  });

  it('a torn tail that cannot be cut aside answers as torn, never malformed, and writes no row (F1)', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o);
    writeFileSync(path.join(dir, PRIVACY_JOURNAL_TORN_DIR), 'not a directory');
    const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from('{"v":1,"seq')]));
    const r = record(o);
    expect(r).toMatchObject({ ok: false, error: 'journal-unreadable' });
    const detail = r.ok ? '' : r.detail;
    expect(detail).toContain('ends in a torn tail of 11 bytes');
    expect(detail).toContain('cutting it aside answered');
    expect(detail).not.toContain('malformed');
    expect(o.store.highestMessageId()).toEqual({ kind: 'measured', value: 1 });
  });

  it('a failed cut at the open carries its error into the refusal (F2)', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o);
    o.db.close();
    writeFileSync(path.join(dir, PRIVACY_JOURNAL_TORN_DIR), 'not a directory');
    const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from('{"v":1,"seq')]));
    const again = open(dir);
    expect(again.healed).toBeNull();
    expect(again.privacy).toMatchObject({ verdict: 'refuse', code: 'torn-tail' });
    expect(again.privacy.verdict === 'refuse' ? again.privacy.detail : '').toMatch(/^a torn tail of 11 bytes at \d+; cutting it aside answered \w+$/);
  });

  it('a record changed in the middle reads malformed: recordMessage answers journal-unreadable while recordRead and every reader still work', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o); record(o); record(o);
    o.db.close();
    const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    const lines = readFileSync(p, 'utf8').split('\n');
    lines[1] = lines[1]!.replace('"id":2', '"id":9');
    writeFileSync(p, lines.join('\n'));
    const bad = open(dir);
    expect(bad.privacy).toMatchObject({ verdict: 'refuse' });
    const r = record(bad);
    expect(r).toMatchObject({ ok: false, error: 'journal-unreadable' });
    expect(bad.store.recordRead({ at: 1, door: 'board', caller: 'operator', scope: 'board', count: 0, outcome: 'ok', generation: null,
      generationRead: 'not-a-session', turnState: null })).toEqual({ ok: true, value: { id: 1 } });
    expect(bad.store.highestMessageId()).toEqual({ kind: 'measured', value: 3 });
    expect(bad.store.privacyJournalHead().kind).toBe('unmeasured');
  });

  it('a missing journal beside rows re-anchors at the store\'s highest, and the next id is above it', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o); record(o);
    o.db.close();
    renameSync(path.join(dir, PRIVACY_JOURNAL_BASENAME), path.join(dir, 'moved-aside.log'));
    const again = open(dir);
    expect(again.privacy).toEqual({ verdict: 're-anchor', reason: 'missing', highestId: 2, appended: true, detail: 'appended' });
    expect(journalLines(dir)).toEqual([{ kind: 'privacy-anchor', highestId: 2, reason: 'missing', at: NOW }]);
    expect(idOf(record(again))).toBe(3);
  });

  it('a journal behind the store (a store from a later point) re-anchors behind', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o);
    o.db.close();
    const p = path.join(dir, PRIVACY_JOURNAL_BASENAME);
    const one = readFileSync(p);
    const reopened = open(dir);
    record(reopened); record(reopened);
    reopened.db.close();
    writeFileSync(p, one);   // the journal moved back to one record, the store holds three
    const again = open(dir);
    expect(again.privacy).toMatchObject({ verdict: 're-anchor', reason: 'behind', highestId: 3, appended: true });
    expect(idOf(record(again))).toBe(4);
  });

  it('a journal ahead of the store (a store restored alone) is coherent, and the next id is above the journal', () => {
    const dir = dirIn();
    const o = open(dir);
    record(o);
    o.db.exec('DELETE FROM operator_messages');
    o.db.close();
    const again = open(dir);
    expect(again.privacy).toEqual({ verdict: 'coherent' });
    expect(idOf(record(again))).toBe(2);
  });

  it('privacyJournalHead answers the digest, the sequence and the highest id', () => {
    const dir = dirIn();
    const o = open(dir);
    expect(o.store.privacyJournalHead()).toEqual({ kind: 'measured', value: 'empty' });
    record(o); record(o);
    const read = chainedJournalFileAt(PRIVACY_JOURNAL_FORMAT, dir, PRIVACY_JOURNAL_BASENAME).read();
    const last = read.kind === 'records' ? read.records.at(-1)! : null;
    expect(o.store.privacyJournalHead()).toEqual({ kind: 'measured', value: { digest: last!.digest, sequence: 2, highestId: 2 } });
  });

  it('privacyJournalDigestAt answers the digest at a sequence, null past the head, and unmeasured for a refused or unreadable journal', () => {
    const dir = dirIn();
    const o = open(dir);
    expect(o.store.privacyJournalDigestAt(1)).toEqual({ kind: 'measured', value: null });
    record(o); record(o);
    const read = chainedJournalFileAt(PRIVACY_JOURNAL_FORMAT, dir, PRIVACY_JOURNAL_BASENAME).read();
    const recs = read.kind === 'records' ? read.records : [];
    expect(o.store.privacyJournalDigestAt(2)).toEqual({ kind: 'measured', value: recs[1]!.digest });
    expect(o.store.privacyJournalDigestAt(3)).toEqual({ kind: 'measured', value: null });
    expect(o.store.privacyJournalDigestAt(0)).toEqual({ kind: 'measured', value: null });
    writeFileSync(path.join(dir, PRIVACY_JOURNAL_BASENAME), 'not a record\n');
    expect(o.store.privacyJournalDigestAt(1).kind).toBe('unmeasured');
  });
});

describe('the open\'s boot lines (F2, F6)', () => {
  const HOME = '/fixture-home';
  const at = (privacy: OperatorModelOpen['privacy'], healed: string | null = null) =>
    operatorModelBootLines({ healed, privacy, journalPath: '/fixture-home/.ccrc/privacy-journal.log' }, HOME, HOME);

  it('says nothing for a coherent or fresh journal in the process home', () => {
    expect(at({ verdict: 'coherent' })).toEqual([]);
    expect(at({ verdict: 'fresh' })).toEqual([]);
  });

  it('an unmeasured read is told to fix access and restart, never to move the journal aside', () => {
    const [line, ...rest] = at({ verdict: 'refuse', code: 'unmeasured', detail: 'the journal could not be read (unreadable)' });
    expect(rest).toEqual([]);
    expect(line).toContain('could not be read (the journal could not be read (unreadable))');
    expect(line).toContain('Fix its access and restart the server; do not move it aside');
    expect(line).not.toContain('moved aside and the server restarted');
  });

  it('a journal the open cannot trust is told to be moved aside, with its code and detail', () => {
    const [line] = at({ verdict: 'refuse', code: 'torn-tail', detail: 'a torn tail of 11 bytes at 0; cutting it aside answered unwritable' });
    expect(line).toContain('cannot be trusted (torn-tail: a torn tail of 11 bytes at 0; cutting it aside answered unwritable)');
    expect(line).toContain('moved aside and the server restarted, which re-anchors it');
  });

  it('names a heal and a re-anchor', () => {
    expect(at({ verdict: 're-anchor', reason: 'missing', highestId: 4, appended: true, detail: 'appended' }, '0-ab.tail')).toEqual([
      'the privacy journal\'s torn tail was cut aside, kept as 0-ab.tail',
      'the privacy journal was missing; re-anchored at message 4 (appended), so no id at or below it is issued again',
    ]);
  });

  it('warns when the configured home is not the process home, since the deny rules name ~/.ccrc', () => {
    const lines = operatorModelBootLines({ healed: null, privacy: { verdict: 'coherent' }, journalPath: '/elsewhere/.ccrc/privacy-journal.log' },
      '/elsewhere', HOME);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('live under /elsewhere, not the process\'s home');
    expect(operatorModelBootLines({ healed: null, privacy: { verdict: 'coherent' }, journalPath: 'x' }, `${HOME}/`, HOME)).toEqual([]);
  });
});
