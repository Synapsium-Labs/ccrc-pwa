// The Linear slot store (#1444, spec 2026-10-31 §3.1 to §3.3; its row 1): one key per Linear workspace under
// `~/.ccrc/linear/`, `<id>.key` beside its version 2 record `<id>.json`. Temp homes only; nothing here calls Linear.
// The legacy pair's half (row 2) is `linear-store-legacy.test.ts`; the pair's own rules, which every slot write
// reuses, are characterized by `linear-connection-rules.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  LINEAR_TEAMS_MAX, parseLinearStoreRecord, parseLinearTeams, type LinearStoreRecord, type LinearTeam,
} from '../../shared/linear.js';
import { PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { valueDigestHex } from '../src/token/files.js';
import { keyTailOf, withConnectionLock } from '../src/linear/connection.js';
import {
  LEGACY_TEAMS_FILE, LINEAR_STORE_DIR, clearLinearSlotVerdict, markLinearSlotRejected, putLinearSlot,
  readLinearSlotKey, readLinearStore, recordLinearSlotCheck, removeLinearSlot, writeLegacyTeams,
  type LinearFileSlot, type LinearStoreRead,
} from '../src/linear/store.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();
afterEach(() => { vi.restoreAllMocks(); });

const KEY_A = 'lin_api_fixture_slot_a_0001';
const KEY_A2 = 'lin_api_fixture_slot_a_0002';
const KEY_B = 'lin_api_fixture_slot_b_0003';
const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const TEAM_A: LinearTeam = { id: 'aaaaaaaa-1111-4000-8000-000000000001', key: 'AAA', name: 'Team A' };
const TEAM_B: LinearTeam = { id: 'bbbbbbbb-1111-4000-8000-000000000002', key: 'BBB', name: 'Team B' };
const NOW = 1_800_000_000_000;

const ccrc = (): string => {
  const dir = path.join(mkTmp('ccrc-linear-store-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  return dir;
};
const storeDir = (dir: string): string => path.join(dir, LINEAR_STORE_DIR);
const keyFile = (dir: string, id: string): string => path.join(storeDir(dir), `${id}.key`);
const recFile = (dir: string, id: string): string => path.join(storeDir(dir), `${id}.json`);

const rec = (id: string, key: string, over: Partial<LinearStoreRecord> = {}): LinearStoreRecord => ({
  workspaceId: id, name: 'Workspace A', urlKey: 'ws-a', user: 'user-a', teams: [TEAM_A], teamsAt: NOW,
  keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: NOW, outcome: 'ok', ...over,
});
const recText = (r: LinearStoreRecord): string => `${JSON.stringify({ v: 2, ...r })}\n`;
const add = async (dir: string, id = WS_A, key = KEY_A, over: Partial<LinearStoreRecord> = {}): Promise<void> => {
  expect(await putLinearSlot(dir, key, rec(id, key, over), { replace: false })).toBe('added');
};
const listed = (r: LinearStoreRead): Extract<LinearStoreRead, { kind: 'listed' }> => {
  if (r.kind !== 'listed') throw new Error(`not listed: ${JSON.stringify(r)}`);
  return r;
};
const slot = async (dir: string, id: string): Promise<LinearFileSlot | undefined> =>
  listed(await readLinearStore(dir)).slots.find((s) => s.id === id);
const readRec = (dir: string, id: string): LinearStoreRecord | null => parseLinearStoreRecord(readFileSync(recFile(dir, id), 'utf8'));

function watchFiles(): { renamed: string[]; removed: string[] } {
  const seen = { renamed: [] as string[], removed: [] as string[] };
  const rename = fsp.rename.bind(fsp);
  const rm = fsp.rm.bind(fsp);
  vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => { seen.renamed.push(path.basename(String(to))); return rename(from, to); });
  vi.spyOn(fsp, 'rm').mockImplementation(async (p, o) => { seen.removed.push(path.basename(String(p))); return rm(p, o); });
  return seen;
}

describe('layout and modes', () => {
  it('the first write creates linear/ at 0700, the key at 0600 as one line, the record at 0600', async () => {
    const dir = ccrc();
    expect(existsSync(storeDir(dir))).toBe(false);
    await add(dir);
    expect(statSync(storeDir(dir)).mode & 0o777).toBe(0o700);
    expect(readFileSync(keyFile(dir, WS_A), 'utf8')).toBe(`${KEY_A}\n`);
    expect(statSync(keyFile(dir, WS_A)).mode & 0o777).toBe(0o600);
    expect(statSync(recFile(dir, WS_A)).mode & 0o777).toBe(0o600);
    expect(readdirSync(storeDir(dir)).sort()).toEqual([`${WS_A}.json`, `${WS_A}.key`]);
  });

  it('the record is the version 2 shape, byte for byte, in its field order, and never holds the key', async () => {
    const dir = ccrc();
    await add(dir);
    const d = valueDigestHex(KEY_A);
    expect(readFileSync(recFile(dir, WS_A), 'utf8')).toBe(
      `{"v":2,"workspaceId":"${WS_A}","name":"Workspace A","urlKey":"ws-a","user":"user-a",`
      + `"teams":[{"id":"${TEAM_A.id}","key":"AAA","name":"Team A"}],"teamsAt":${NOW},"keyTail":"0001",`
      + `"keyDigest":"${d}","checkedAt":${NOW},"outcome":"ok"}\n`,
    );
    expect(readFileSync(recFile(dir, WS_A), 'utf8')).not.toContain(KEY_A);
  });

  it('writes the key FIRST and the record second', async () => {
    const dir = ccrc();
    const seen = watchFiles();
    await add(dir);
    expect(seen.renamed).toEqual([`${WS_A}.key`, `${WS_A}.json`]);
  });

  it('a crash between the two writes leaves a key with no record: listed, record absent', async () => {
    const dir = ccrc();
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === `${WS_A}.json`) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return rename(from, to);
    });
    await expect(putLinearSlot(dir, KEY_A, rec(WS_A, KEY_A), { replace: false })).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await slot(dir, WS_A)).toEqual({
      source: 'file', id: WS_A, key: { kind: 'key', digest: valueDigestHex(KEY_A) }, record: { kind: 'absent' },
    });
    expect(readdirSync(storeDir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('every store write runs under the one connection lock', async () => {
    const dir = ccrc();
    let release!: () => void;
    const held = withConnectionLock(dir, () => new Promise<void>((r) => { release = r; }));
    const put = putLinearSlot(dir, KEY_A, rec(WS_A, KEY_A), { replace: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(keyFile(dir, WS_A))).toBe(false);
    release();
    await held;
    expect(await put).toBe('added');
    expect(existsSync(keyFile(dir, WS_A))).toBe(true);
  });
});

describe('readLinearStore', () => {
  it('a missing directory is an empty list', async () => {
    expect(await readLinearStore(ccrc())).toEqual({ kind: 'listed', slots: [], legacy: null });
  });

  it('a directory that cannot be listed is unreadable, with its code', async () => {
    const dir = ccrc();
    writeFileSync(storeDir(dir), 'not a directory\n');
    expect(await readLinearStore(dir)).toEqual({ kind: 'unreadable', code: 'ENOTDIR' });
  });

  it('lists each slot by id, in order, with its key measured and never the key itself', async () => {
    const dir = ccrc();
    await add(dir, WS_B, KEY_B, { name: 'Workspace B', urlKey: 'ws-b', teams: [TEAM_B] });
    await add(dir);
    const r = listed(await readLinearStore(dir));
    expect(r.slots.map((s) => s.id)).toEqual([WS_A, WS_B]);
    expect(r.slots[0]).toEqual({
      source: 'file', id: WS_A, key: { kind: 'key', digest: valueDigestHex(KEY_A) },
      record: { kind: 'details', details: rec(WS_A, KEY_A) },
    });
    expect(r.slots[1]!.record).toEqual({
      kind: 'details', details: rec(WS_B, KEY_B, { name: 'Workspace B', urlKey: 'ws-b', teams: [TEAM_B] }),
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain(KEY_B);
  });

  it('only a .key whose stem is a workspace id makes a slot', async () => {
    const dir = ccrc();
    await add(dir);
    const s = storeDir(dir);
    writeFileSync(path.join(s, `${WS_B}.json`), recText(rec(WS_B, KEY_B)), { mode: 0o600 });   // a record with no key
    writeFileSync(path.join(s, 'notes.key'), `${KEY_B}\n`, { mode: 0o600 });
    writeFileSync(path.join(s, `${WS_B.toUpperCase()}.key`), `${KEY_B}\n`, { mode: 0o600 });
    writeFileSync(path.join(s, `.${WS_B}.key.tmp-0011223344556677`), `${KEY_B}\n`, { mode: 0o600 });
    writeFileSync(path.join(s, LEGACY_TEAMS_FILE), '{}\n', { mode: 0o600 });
    expect(listed(await readLinearStore(dir)).slots.map((x) => x.id)).toEqual([WS_A]);
  });

  it('each record condition is its own answer: absent, malformed, unreadable', async () => {
    const dir = ccrc();
    await add(dir);
    await fsp.rm(recFile(dir, WS_A));
    expect((await slot(dir, WS_A))?.record).toEqual({ kind: 'absent' });
    writeFileSync(recFile(dir, WS_A), '{"v":2}\n');
    expect((await slot(dir, WS_A))?.record).toEqual({ kind: 'malformed' });
    // A record whose workspace is not its file's is no record of this slot.
    writeFileSync(recFile(dir, WS_A), recText(rec(WS_B, KEY_A)));
    expect((await slot(dir, WS_A))?.record).toEqual({ kind: 'malformed' });
    if (process.getuid?.() !== 0) {
      writeFileSync(recFile(dir, WS_A), recText(rec(WS_A, KEY_A)));
      chmodSync(recFile(dir, WS_A), 0o000);
      expect((await slot(dir, WS_A))?.record).toEqual({ kind: 'unreadable', code: 'EACCES' });
      chmodSync(recFile(dir, WS_A), 0o600);
    }
  });

  it('each key condition is its own answer: unusable, placeholder, unreadable', async () => {
    const dir = ccrc();
    await add(dir);
    writeFileSync(keyFile(dir, WS_A), '# nothing\n');
    expect((await slot(dir, WS_A))?.key).toEqual({ kind: 'unusable' });
    writeFileSync(keyFile(dir, WS_A), `${PLACEHOLDER_TOKEN}\n`);
    expect((await slot(dir, WS_A))?.key).toEqual({ kind: 'placeholder' });
    if (process.getuid?.() !== 0) {
      chmodSync(keyFile(dir, WS_A), 0o000);
      expect((await slot(dir, WS_A))?.key).toEqual({ kind: 'unreadable', code: 'EACCES' });
      chmodSync(keyFile(dir, WS_A), 0o600);
    }
  });
});

describe('readLinearSlotKey reads the key file on every use', () => {
  it('answers the slot\'s key, and a replace is seen by the very next read', async () => {
    const dir = ccrc();
    await add(dir);
    expect(await readLinearSlotKey(dir, { source: 'file', id: WS_A })).toEqual({ kind: 'key', key: KEY_A });
    expect(await putLinearSlot(dir, KEY_A2, rec(WS_A, KEY_A2), { replace: true })).toBe('replaced');
    expect(await readLinearSlotKey(dir, { source: 'file', id: WS_A })).toEqual({ kind: 'key', key: KEY_A2 });
    // Written behind the store's back, too: nothing holds the key between reads.
    writeFileSync(keyFile(dir, WS_A), `${KEY_B}\n`);
    expect(await readLinearSlotKey(dir, { source: 'file', id: WS_A })).toEqual({ kind: 'key', key: KEY_B });
    expect((await slot(dir, WS_A))?.key).toEqual({ kind: 'key', digest: valueDigestHex(KEY_B) });
  });

  it('a removed slot reads absent at once', async () => {
    const dir = ccrc();
    await add(dir);
    await removeLinearSlot(dir, WS_A);
    expect(await readLinearSlotKey(dir, { source: 'file', id: WS_A })).toEqual({ kind: 'absent' });
  });

  it('an id that is not a workspace id names no file', async () => {
    const dir = ccrc();
    await add(dir);
    for (const id of ['../linear', 'notes', WS_A.toUpperCase(), `${WS_A}/x`, '']) {
      expect(await readLinearSlotKey(dir, { source: 'file', id })).toEqual({ kind: 'absent' });
    }
  });
});

describe('putLinearSlot: add and replace', () => {
  it('an add for a workspace that has a slot answers exists and touches nothing', async () => {
    const dir = ccrc();
    await add(dir);
    const before = readFileSync(keyFile(dir, WS_A), 'utf8') + readFileSync(recFile(dir, WS_A), 'utf8');
    expect(await putLinearSlot(dir, KEY_A2, rec(WS_A, KEY_A2), { replace: false })).toBe('exists');
    expect(readFileSync(keyFile(dir, WS_A), 'utf8') + readFileSync(recFile(dir, WS_A), 'utf8')).toBe(before);
  });

  it('a replace writes the new key first and its record second', async () => {
    const dir = ccrc();
    await add(dir);
    const seen = watchFiles();
    expect(await putLinearSlot(dir, KEY_A2, rec(WS_A, KEY_A2), { replace: true })).toBe('replaced');
    expect(seen.renamed).toEqual([`${WS_A}.key`, `${WS_A}.json`]);
    expect(readRec(dir, WS_A)).toEqual(rec(WS_A, KEY_A2));
  });

  it('a replace of a workspace with no slot adds it', async () => {
    const dir = ccrc();
    expect(await putLinearSlot(dir, KEY_A, rec(WS_A, KEY_A), { replace: true })).toBe('added');
  });

  it('refuses, writing nothing, a record that does not describe the key, a bad key, a bad id or a record its own parser refuses', async () => {
    const dir = ccrc();
    const bad: Array<[string, LinearStoreRecord]> = [
      [KEY_A, rec(WS_A, KEY_B)],                                   // another key's digest
      [KEY_A, rec(WS_A, KEY_A, { keyTail: 'zzzz' })],              // another key's tail
      ['short', rec(WS_A, 'short')],                               // fails the key shape
      [KEY_A, rec('not-a-uuid', KEY_A)],                           // not a workspace id
      [KEY_A, rec(WS_A, KEY_A, { name: 'bad\u0007name' })],        // not what the parser reads back
    ];
    for (const [key, r] of bad) await expect(putLinearSlot(dir, key, r, { replace: true })).rejects.toThrow();
    expect(existsSync(storeDir(dir)) ? readdirSync(storeDir(dir)) : []).toEqual([]);
  });
});

describe('a check is recorded only for the slot key that was checked', () => {
  const learned = { name: 'Workspace A2', urlKey: 'ws-a2', user: 'user-b', teams: [TEAM_A, TEAM_B], teamsAt: NOW + 5 };

  it('an ok check writes what it learned, the time and the outcome, and leaves the key alone', async () => {
    const dir = ccrc();
    await add(dir);
    const keyBefore = statSync(keyFile(dir, WS_A)).mtimeMs;
    expect(await recordLinearSlotCheck(dir, WS_A, valueDigestHex(KEY_A), 'ok', learned, NOW + 5)).toBe(true);
    expect(readRec(dir, WS_A)).toEqual(rec(WS_A, KEY_A, { ...learned, checkedAt: NOW + 5 }));
    expect(statSync(keyFile(dir, WS_A)).mtimeMs).toBe(keyBefore);
  });

  it('a failed check keeps what a record of the same key learned', async () => {
    const dir = ccrc();
    await add(dir);
    await recordLinearSlotCheck(dir, WS_A, valueDigestHex(KEY_A), 'unreachable', null, NOW + 5);
    expect(readRec(dir, WS_A)).toEqual(rec(WS_A, KEY_A, { outcome: 'unreachable', checkedAt: NOW + 5 }));
  });

  it('writes nothing, and answers false, when the slot\'s key has another digest or is gone', async () => {
    const dir = ccrc();
    await add(dir);
    const before = readFileSync(recFile(dir, WS_A), 'utf8');
    expect(await recordLinearSlotCheck(dir, WS_A, valueDigestHex(KEY_B), 'rejected', null, NOW + 5)).toBe(false);
    expect(readFileSync(recFile(dir, WS_A), 'utf8')).toBe(before);
    expect(await recordLinearSlotCheck(dir, WS_B, valueDigestHex(KEY_B), 'ok', learned, NOW + 5)).toBe(false);
    expect(existsSync(recFile(dir, WS_B))).toBe(false);
  });

  it('a check of a key with no record, or a record of another key, writes a full record with nothing learned', async () => {
    const dir = ccrc();
    await add(dir);
    writeFileSync(recFile(dir, WS_A), recText(rec(WS_A, KEY_B)));   // describes another key
    await recordLinearSlotCheck(dir, WS_A, valueDigestHex(KEY_A), 'rejected', null, NOW + 5);
    expect(readRec(dir, WS_A)).toEqual(rec(WS_A, KEY_A, {
      name: null, urlKey: null, user: null, teams: [], teamsAt: null, outcome: 'rejected', checkedAt: NOW + 5,
    }));
  });

  it('a 401 marks only the slot named, and a success clears only that slot\'s verdict', async () => {
    const dir = ccrc();
    await add(dir);
    await add(dir, WS_B, KEY_B, { name: 'Workspace B', urlKey: 'ws-b', teams: [TEAM_B] });
    const bBefore = readFileSync(recFile(dir, WS_B), 'utf8');
    expect(await markLinearSlotRejected(dir, WS_A, valueDigestHex(KEY_B), NOW + 1)).toBe(false);
    expect(await markLinearSlotRejected(dir, WS_A, valueDigestHex(KEY_A), NOW + 1)).toBe(true);
    expect(readRec(dir, WS_A)).toEqual(rec(WS_A, KEY_A, { outcome: 'rejected', checkedAt: NOW + 1 }));
    expect(readFileSync(recFile(dir, WS_B), 'utf8')).toBe(bBefore);
    expect(await clearLinearSlotVerdict(dir, WS_B, valueDigestHex(KEY_B), NOW + 2)).toBe(false);
    expect(readFileSync(recFile(dir, WS_B), 'utf8')).toBe(bBefore);
    expect(await clearLinearSlotVerdict(dir, WS_A, valueDigestHex(KEY_A2), NOW + 2)).toBe(false);
    expect(await clearLinearSlotVerdict(dir, WS_A, valueDigestHex(KEY_A), NOW + 2)).toBe(true);
    expect(readRec(dir, WS_A)).toEqual(rec(WS_A, KEY_A, { outcome: 'ok', checkedAt: NOW + 2 }));
  });
});

describe('remove and the orphan sweep', () => {
  it('removes the key FIRST, then the record', async () => {
    const dir = ccrc();
    await add(dir);
    const seen = watchFiles();
    await removeLinearSlot(dir, WS_A);
    expect(seen.removed.filter((n) => n.startsWith(WS_A))).toEqual([`${WS_A}.key`, `${WS_A}.json`]);
    expect(readdirSync(storeDir(dir))).toEqual([]);
  });

  it('a crash between the two removals leaves a record with no key, shown nowhere, and the next locked write sweeps it', async () => {
    const dir = ccrc();
    await add(dir);
    await add(dir, WS_B, KEY_B);
    writeFileSync(path.join(storeDir(dir), LEGACY_TEAMS_FILE), '{}\n', { mode: 0o600 });
    writeFileSync(path.join(storeDir(dir), 'notes.json'), '{}\n', { mode: 0o600 });
    const rm = fsp.rm.bind(fsp);
    vi.spyOn(fsp, 'rm').mockImplementation(async (p, o) => {
      if (path.basename(String(p)) === `${WS_A}.json`) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return rm(p, o);
    });
    await expect(removeLinearSlot(dir, WS_A)).rejects.toThrow();
    vi.restoreAllMocks();
    expect(existsSync(recFile(dir, WS_A))).toBe(true);
    expect(listed(await readLinearStore(dir)).slots.map((s) => s.id)).toEqual([WS_B]);
    // Any locked write in the directory finishes it; a record with its key, legacy-teams.json and a non-slot file stay.
    expect(await markLinearSlotRejected(dir, WS_B, valueDigestHex(KEY_A), NOW)).toBe(false);
    expect(readdirSync(storeDir(dir)).sort()).toEqual([`${WS_B}.json`, `${WS_B}.key`, LEGACY_TEAMS_FILE, 'notes.json'].sort());
  });

  it('every kind of locked store write sweeps an orphan', async () => {
    const acts: Array<(dir: string) => Promise<unknown>> = [
      (dir) => putLinearSlot(dir, KEY_B, rec(WS_B, KEY_B), { replace: false }),
      (dir) => recordLinearSlotCheck(dir, WS_B, valueDigestHex(KEY_B), 'ok', null, NOW),
      (dir) => markLinearSlotRejected(dir, WS_B, valueDigestHex(KEY_B), NOW),
      (dir) => clearLinearSlotVerdict(dir, WS_B, valueDigestHex(KEY_B), NOW),
      (dir) => removeLinearSlot(dir, WS_B),
      (dir) => writeLegacyTeams(dir, valueDigestHex(KEY_B), { workspaceId: WS_B, name: 'n', urlKey: 'ws-b', teams: [], teamsAt: NOW }),
    ];
    for (const act of acts) {
      const dir = ccrc();
      await add(dir);
      await fsp.rm(keyFile(dir, WS_A));
      await act(dir);
      expect(existsSync(recFile(dir, WS_A)), String(act)).toBe(false);
    }
  });

  it('removing a slot that is not there is a success', async () => {
    const dir = ccrc();
    await removeLinearSlot(dir, WS_A);
    expect(await readLinearStore(dir)).toEqual({ kind: 'listed', slots: [], legacy: null });
  });
});

describe('parseLinearStoreRecord: exactly the version 2 shape', () => {
  const good = rec(WS_A, KEY_A, { teams: [TEAM_A, TEAM_B] });
  const raw = (o: unknown): string => JSON.stringify(o);
  const v2 = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ v: 2, ...good, ...over });

  it('reads what the store writes, nulls included', () => {
    expect(parseLinearStoreRecord(recText(good))).toEqual(good);
    const none = rec(WS_A, KEY_A, { name: null, urlKey: null, user: null, teams: [], teamsAt: null, outcome: 'rejected' });
    expect(parseLinearStoreRecord(recText(none))).toEqual(none);
  });

  it('a team key is read in any case and must fit the grammar once uppercased', () => {
    expect(parseLinearStoreRecord(raw(v2({ teams: [{ ...TEAM_A, key: 'aaa' }] })))?.teams[0]?.key).toBe('aaa');
    for (const key of ['', '1AA', 'A-B', 'A'.repeat(17), 'AÄ']) {
      expect(parseLinearStoreRecord(raw(v2({ teams: [{ ...TEAM_A, key }] }))), key).toBeNull();
    }
  });

  it('refuses an unknown field, at the top or in a team, and a missing one', () => {
    expect(parseLinearStoreRecord(raw(v2({ extra: 1 })))).toBeNull();
    expect(parseLinearStoreRecord(raw(v2({ key: KEY_A })))).toBeNull();
    expect(parseLinearStoreRecord(raw(v2({ teams: [{ ...TEAM_A, extra: 1 }] })))).toBeNull();
    for (const field of Object.keys(v2())) {
      const o = v2();
      delete o[field];
      expect(parseLinearStoreRecord(raw(o)), field).toBeNull();
    }
    const t: Record<string, unknown> = { ...TEAM_A };
    delete t['name'];
    expect(parseLinearStoreRecord(raw(v2({ teams: [t] })))).toBeNull();
  });

  it('refuses every field out of its grammar', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['v1', { v: 1 }], ['v3', { v: 3 }],
      ['workspace id', { workspaceId: 'ws-a' }], ['workspace id case', { workspaceId: WS_A.toUpperCase() }],
      ['name empty', { name: '' }], ['name control', { name: 'a\u0000b' }], ['name long', { name: 'x'.repeat(401) }],
      ['name number', { name: 7 }], ['user control', { user: 'a\nb' }],
      ['url key', { urlKey: 'WS-A' }], ['url key dash', { urlKey: '-ws' }], ['url key long', { urlKey: `a${'b'.repeat(64)}` }],
      ['teams not a list', { teams: {} }], ['team id', { teams: [{ ...TEAM_A, id: 'x' }] }],
      ['team name empty', { teams: [{ ...TEAM_A, name: '' }] }], ['team name control', { teams: [{ ...TEAM_A, name: 'a\u0085' }] }],
      ['team key repeated', { teams: [TEAM_A, { ...TEAM_B, key: 'aaa' }] }], ['team id repeated', { teams: [TEAM_A, { ...TEAM_B, id: TEAM_A.id }] }],
      ['teams with no time', { teamsAt: null }], ['teamsAt negative', { teamsAt: -1 }],
      ['key tail', { keyTail: '00001' }], ['digest', { keyDigest: 'abc' }], ['digest case', { keyDigest: valueDigestHex(KEY_A).toUpperCase() }],
      ['checkedAt', { checkedAt: Number.NaN }], ['checkedAt string', { checkedAt: '1' }], ['outcome', { outcome: 'rate-limited' }],
    ];
    for (const [why, over] of cases) expect(parseLinearStoreRecord(raw(v2(over))), why).toBeNull();
  });

  it('keeps at most 500 teams', () => {
    const many = (n: number): LinearTeam[] => Array.from({ length: n }, (_, i) => ({
      id: `aaaaaaaa-2222-4000-8000-${String(i).padStart(12, '0')}`, key: `T${i}`, name: `Team ${i}`,
    }));
    expect(parseLinearStoreRecord(raw(v2({ teams: many(LINEAR_TEAMS_MAX) })))?.teams).toHaveLength(500);
    expect(parseLinearStoreRecord(raw(v2({ teams: many(LINEAR_TEAMS_MAX + 1) })))).toBeNull();
    expect(parseLinearTeams(many(LINEAR_TEAMS_MAX + 1))).toBeNull();
  });

  it('refuses text that is not one JSON object', () => {
    for (const text of ['', 'nope', '[]', 'null', '2', `[${recText(good)}]`]) expect(parseLinearStoreRecord(text), text).toBeNull();
  });
});
