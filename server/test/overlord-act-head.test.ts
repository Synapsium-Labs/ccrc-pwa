// Overlord W2, act journal plan Task A3, the pure parts: the head's domain-separated preimage and its signature, the sign verdict,
// and the console's head check. The mutant sets run the same case tables (`sim/actHeadSets.ts`).
import { describe, expect, it } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import { approvalRulingBytes, type ApprovalRulingRecord } from '../../shared/api.js';
import * as head from '../../shared/actJournalHead.js';
import { ACT_HEAD_DOMAIN, actHeadPreimage, isActHead, type ActHead } from '../../shared/actJournalHead.js';
import { rfc8785Json } from '../src/canonical.js';
import { loadOrCreateApprovalSigner } from '../src/coord/approvalsign.js';
import * as verdict from '../src/coord/overlordActHead.js';
import { actHeadLanePlanCases, actHeadSignVerdictCases, headExtendsCases } from './sim/actHeadSets.js';
import { mkTmp } from './tmpHelpers.js';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IsolationRead } from '../../shared/isolation.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { OVERLORD_ACTS_BASENAME, type OverlordActRecord } from '../src/coord/overlordActRecords.js';
import { overlordActsFileAt } from '../src/coord/overlordActJournal.js';
import { digestAtSequence } from '../src/coord/overlordActHead.js';
import { newestActHeadAtOrBefore, recordActHeadInTx } from '../src/coord/overlordActHeadStore.js';
import { readActHeadAnswer, runActHeadSignPass, type ActHeadLaneDeps } from '../src/coord/overlordActHeadLane.js';
import { SETTLE } from './sim/overlordActJournalSets.js';

const HEAD: ActHead = { day: '2026-11-28', sequence: 1234, journalId: 'a'.repeat(64), digest: 'b'.repeat(64) };

describe('the preimage (question 7)', () => {
  it('is the domain tag, one LF, then the RFC 8785 JSON of the four fields', () => {
    const fail = (d: string): Error => new Error(d);
    expect(actHeadPreimage(HEAD)).toBe(`${ACT_HEAD_DOMAIN}\n${rfc8785Json({ day: HEAD.day, sequence: HEAD.sequence, journalId: HEAD.journalId, digest: HEAD.digest }, fail)}`);
    expect(actHeadPreimage({ digest: HEAD.digest, sequence: HEAD.sequence, journalId: HEAD.journalId, day: HEAD.day })).toBe(actHeadPreimage(HEAD));
    expect(ACT_HEAD_DOMAIN).toBe('ccrc/overlord-act-journal-head/v1');
  });

  it('refuses a head out of shape: a bad day, a sequence of 0 or a float, digests that are not lowercase hex', () => {
    for (const bad of [{ ...HEAD, day: '2026-13-01' }, { ...HEAD, day: '28/11/2026' }, { ...HEAD, sequence: 0 }, { ...HEAD, sequence: 1.5 },
      { ...HEAD, digest: 'B'.repeat(64) }, { ...HEAD, journalId: 'a'.repeat(63) }, { ...HEAD, digest: '"'.repeat(64) }]) {
      expect(isActHead(bad), JSON.stringify(bad)).toBe(false);
      expect(actHeadPreimage(bad)).toBeNull();
    }
  });

  it('is never an approval ruling\'s signed bytes: those are a JSON object, and this starts with the tag and is no JSON', () => {
    const ruling: ApprovalRulingRecord = {
      v: 1, rowId: 7, sessionId: 'lane-a-project-a', agentId: 'agent-1', digest: 'c'.repeat(64), nonce: 'n-1', class: 'write',
      verdict: 'allow', reason: 'ok', expiresAt: 1_800_000_000_000,
    };
    const bytes = approvalRulingBytes(ruling);
    expect(bytes).not.toBeNull();
    expect(bytes!.startsWith('{')).toBe(true);
    expect(bytes).not.toBe(actHeadPreimage(HEAD));
    expect(actHeadPreimage(HEAD)!.startsWith(`${ACT_HEAD_DOMAIN}\n`)).toBe(true);
    expect(() => JSON.parse(actHeadPreimage(HEAD)!)).toThrow();
  });
});

describe('the signer\'s typed method', () => {
  it('signs the preimage with the server\'s one key: the signature verifies with the public key, and fails for another head', () => {
    const signer = loadOrCreateApprovalSigner(mkTmp('ccrc-acthead-'));
    const sig = signer.signActHead(HEAD);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const pub = createPublicKey(signer.publicKeyPem());
    expect(verify(null, Buffer.from(actHeadPreimage(HEAD)!, 'utf8'), pub, Buffer.from(sig!, 'base64'))).toBe(true);
    const other = actHeadPreimage({ ...HEAD, sequence: HEAD.sequence + 1 })!;
    expect(verify(null, Buffer.from(other, 'utf8'), pub, Buffer.from(sig!, 'base64'))).toBe(false);
    // the bare JSON without the tag does not verify either: the tag is in the signed bytes
    const bare = actHeadPreimage(HEAD)!.slice(ACT_HEAD_DOMAIN.length + 1);
    expect(verify(null, Buffer.from(bare, 'utf8'), pub, Buffer.from(sig!, 'base64'))).toBe(false);
  });

  it('signs nothing for a head out of shape', () => {
    expect(loadOrCreateApprovalSigner(mkTmp('ccrc-acthead-')).signActHead({ ...HEAD, digest: 'nope' })).toBeNull();
  });
});

describe('whether the head is signed (question 8)', () => {
  for (const [name, run] of Object.entries(actHeadSignVerdictCases(verdict))) it(name, run);
  it('names each unsigned word with its reason, and nothing else', () => {
    expect(verdict.ACT_HEAD_UNSIGNED_WORDS).toEqual(['approvals-disabled', 'shared-user', 'isolation-unmeasured', 'key-unavailable']);
    expect(verdict.ACT_HEAD_UNSIGNED_WORDS.every(verdict.isActHeadKebab)).toBe(true);
    expect(verdict.isActHeadKebab('separate-user')).toBe(false);
  });
});

describe('the head-signing lane\'s one beat (Task A3)', () => {
  for (const [name, run] of Object.entries(actHeadLanePlanCases(verdict))) it(name, run);
});

describe('the console\'s check, headExtends (question 11)', () => {
  for (const [name, run] of Object.entries(headExtendsCases(head))) it(name, run);
  it('answers one of its four words', () => {
    expect(head.HEAD_EXTENDS_ANSWERS).toEqual(['extends', 'does-not-extend', 'first', 'unmeasured']);
  });
});

// ── The store, the lane's pass and the head read, over a real coordination database file and a real act journal ──────────────

const HEADS_MIGRATION = MIGRATIONS.find((sql) => sql.includes('CREATE TABLE overlord_act_heads'))!;
const NOW = Date.parse('2026-11-28T10:00:00.000Z');
const SEP: IsolationRead = { kind: 'measured', word: 'separate-user', cause: 'other-user' };

function laneRig(o: { isolation?: IsolationRead; approvalsDisabled?: boolean; signer?: boolean; acts?: number } = {}) {
  const dir = mkTmp('ccrc-acthead-lane-');
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  db.exec(HEADS_MIGRATION);
  const file = overlordActsFileAt(dir);
  for (let i = 1; i <= (o.acts ?? 0); i += 1) {
    const r = file.appendNext(() => ({ go: { entry: { ...SETTLE, actId: i } as OverlordActRecord, acceptedAt: '2026-11-28T09:00:00.000Z' } }));
    if (!r.ok) throw new Error('fixture append failed');
  }
  const signer = o.signer === false ? null : loadOrCreateApprovalSigner(dir);
  const warns: string[] = [];
  const journal = { readVerified: () => { const r = file.read(); return r.kind === 'unmeasured' ? { kind: 'unmeasured' as const, why: 'unreadable' as const } : r; } };
  const deps: ActHeadLaneDeps = {
    db: () => db, journal, signer: () => signer, isolation: () => o.isolation ?? SEP, approvalsDisabled: () => o.approvalsDisabled ?? false,
    dayOf: () => '2026-11-28', warn: (l) => warns.push(l),
  };
  return { dir, db, file, signer, warns, deps, journal, rows: () => db.prepare('SELECT * FROM overlord_act_heads ORDER BY day').all() as Record<string, unknown>[] };
}

describe('the lane\'s one pass and the store\'s one writer', () => {
  it('a journal with no record writes nothing and logs nothing (every box at merge)', () => {
    const r = laneRig();
    expect(runActHeadSignPass(r.deps, NOW).plan).toEqual({ kind: 'nothing', why: 'no-record' });
    expect([r.rows(), r.warns]).toEqual([[], []]);
  });

  it('a verified head on separate-user is recorded once a day, signed, and the signature verifies over the preimage', () => {
    const r = laneRig({ acts: 3 });
    expect(runActHeadSignPass(r.deps, NOW)).toMatchObject({ plan: { kind: 'record' }, written: true });
    expect(runActHeadSignPass(r.deps, NOW + 3_600_000).plan).toEqual({ kind: 'nothing', why: 'recorded-today' });
    const [row] = r.rows() as { day: string; sequence: number; journalId: string; digest: string; signature: string; unsigned: null }[];
    expect(r.rows()).toHaveLength(1);
    expect([row!.day, row!.sequence, row!.unsigned]).toEqual(['2026-11-28', 3, null]);
    const pre = actHeadPreimage({ day: row!.day, sequence: row!.sequence, journalId: row!.journalId, digest: row!.digest })!;
    expect(verify(null, Buffer.from(pre, 'utf8'), createPublicKey(r.signer!.publicKeyPem()), Buffer.from(row!.signature, 'base64'))).toBe(true);
  });

  it('shared-user, an unmeasured word, the switch and a missing key each record the head unsigned, with the word', () => {
    const cases: [Parameters<typeof laneRig>[0], string][] = [
      [{ isolation: { kind: 'measured', word: 'shared-user', cause: 'same-user' } }, 'shared-user'],
      [{ isolation: { kind: 'unmeasured', why: 'link-down' } }, 'isolation-unmeasured'],
      [{ approvalsDisabled: true }, 'approvals-disabled'],
      [{ signer: false }, 'key-unavailable'],
    ];
    for (const [o, word] of cases) {
      const r = laneRig({ ...o, acts: 1 });
      runActHeadSignPass(r.deps, NOW);
      expect(r.rows().map((x) => [x.signature, x.unsigned]), word).toEqual([[null, word]]);
    }
  });

  it('a journal that does not verify writes nothing and warns once, naming a word and no record\'s field', () => {
    const r = laneRig({ acts: 1 });
    appendFileSync(path.join(r.dir, OVERLORD_ACTS_BASENAME), '{"torn');
    expect(runActHeadSignPass(r.deps, NOW).plan).toEqual({ kind: 'warn', why: 'the act journal did not verify: a torn tail' });
    expect(r.rows()).toEqual([]);
    expect(r.warns).toEqual(['ccrc-server: the act journal\'s head for 2026-11-28 was not recorded (the act journal did not verify: a torn tail); the next beat tries again']);
  });

  it('a heads table that cannot be read warns and reads no file', () => {
    const r = laneRig({ acts: 1 });
    r.db.exec('DROP TABLE overlord_act_heads');
    let reads = 0;
    const plan = runActHeadSignPass({ ...r.deps, journal: { readVerified: () => { reads += 1; return r.journal.readVerified(); } } }, NOW).plan;
    expect(plan).toMatchObject({ kind: 'warn' });
    expect(reads).toBe(0);
  });

  it('the store keeps a row already standing for the day, and its CHECK holds exactly one of the signature and the word', () => {
    const r = laneRig();
    const row = { ...HEAD, signature: null, unsigned: 'shared-user', at: NOW };
    expect(recordActHeadInTx(r.db, row)).toEqual({ written: true });
    expect(recordActHeadInTx(r.db, { ...row, unsigned: 'approvals-disabled' })).toEqual({ written: false });
    expect(() => recordActHeadInTx(r.db, { ...row, day: '2026-11-29', signature: 'c2ln' })).toThrow();
    expect(() => recordActHeadInTx(r.db, { ...row, day: '2026-11-29', unsigned: null })).toThrow();
    expect(newestActHeadAtOrBefore(r.db, '2026-11-27')).toEqual({ kind: 'measured', value: 'absent' });
    expect(newestActHeadAtOrBefore(r.db, '2026-12-01')).toMatchObject({ kind: 'measured', value: { day: '2026-11-28', unsigned: 'shared-user' } });
  });
});

describe('the head read', () => {
  it('answers the newest head, the public key, and the digest at a sequence: the record\'s, absent past the head', () => {
    const r = laneRig({ acts: 2 });
    runActHeadSignPass(r.deps, NOW);
    const deps = { db: () => r.db, journal: r.journal, publicKeyPem: () => r.signer!.publicKeyPem() };
    const a = readActHeadAnswer(deps, 1);
    const recs = (r.file.read() as { records: { digest: string }[] }).records;
    expect(a).toMatchObject({ ok: true, wire: { v: 1, head: { sequence: 2, unsigned: null }, at: { sequence: 1, digest: recs[0]!.digest } } });
    expect(readActHeadAnswer(deps, 3)).toMatchObject({ ok: true, wire: { at: { sequence: 3, digest: 'absent' } } });
    expect(readActHeadAnswer(deps, null)).toMatchObject({ ok: true, wire: { at: null } });
  });

  it('an unreadable file is unmeasured at the sequence, never absent; no head yet is absent; an unreadable table is no answer', () => {
    const r = laneRig({ acts: 1 });
    const deps = { db: () => r.db, journal: { readVerified: () => ({ kind: 'unmeasured' as const, why: 'unreadable' as const }) }, publicKeyPem: () => null };
    expect(readActHeadAnswer(deps, 1)).toMatchObject({ ok: true, wire: { head: 'absent', publicKeyPem: null, at: { sequence: 1, digest: 'unmeasured' } } });
    r.db.exec('DROP TABLE overlord_act_heads');
    expect(readActHeadAnswer(deps, 1)).toMatchObject({ ok: false });
  });

  it('digestAtSequence: three answers, a malformed read never absent', () => {
    const recs = [{ sequence: 1, digest: 'd1' }, { sequence: 2, digest: 'd2' }];
    expect([digestAtSequence({ kind: 'records', records: recs }, 2), digestAtSequence({ kind: 'records', records: recs }, 3),
      digestAtSequence({ kind: 'absent' }, 1), digestAtSequence({ kind: 'malformed' }, 1), digestAtSequence({ kind: 'unmeasured' }, 1)])
      .toEqual(['d2', 'absent', 'absent', 'unmeasured', 'unmeasured']);
  });
});
