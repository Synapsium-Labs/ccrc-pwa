// Overlord W2, private names B (plan w2-private-names.md, Task 5): the list's key slot (the `.server` slot API of the
// operator-secrets store), its decider `nameListState` (Table P1) and its one reader `readPrivateNameList`, with the
// generation cache. Fixture HOMEs only, fixture keys only (minted per test), synthetic names only (`zz-alpha`, `zq-bravo-x9`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { CANARY, MODES, entriesOf, entryOf, privateNameHits } from '../../shared/private-names.mjs';
import { NAME_LIST_KEY_SLOT, NAME_LIST_MODES, NAME_LIST_UNREADABLE, isNameListMode } from '../../shared/privateNames.js';
import {
  OPERATOR_SECRETS_DIR, OperatorSecretBadSlot, OperatorSecretStoreUnsafe, SERVER_SECRETS_DIR, operatorSecretRows, readServerSecretValue,
  readStoredSecrets, removeServerSecret, serverSecretLaneId, serverSecretPath, sweepOperatorSecretTemps, writeServerSecret,
} from '../src/coord/ledgersSecrets.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { mintNameListKey, readPrivateNameList, writeNameListKey } from '../src/operatorModel/nameListRead.js';
import * as nameListStateModule from '../src/operatorModel/nameListState.js';
import { nameListState, type NameEntry, type NameListKeyRead, type NameListStoreRead } from '../src/operatorModel/nameListState.js';
import * as privateNamesModule from '../../shared/private-names.mjs';
import { nameListStateCases } from './sim/privateNamesSets.js';
import { parsedFile } from './scan/symbols.js';
import { parseSource } from './scan/parse.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const issuer: PrivacyIssuer = { kind: 'ready', issue: () => ({ ok: true, id: 1 }) };
const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) if (db.isOpen) db.close(); removeTmpFixtures(); });

const K1 = 'a1'.repeat(32);
const K2 = 'b2'.repeat(32);
const listUnder = (key: string, names: readonly string[] = ['zz-alpha']): NameEntry[] =>
  [entryOf(CANARY, 'part', key), ...names.flatMap((n) => entriesOf(n, 'part', key))];

describe('nameListState: Table P1, whole (the cases are privateNamesSets.ts\'s, run here against the real module)', () => {
  for (const [name, run] of Object.entries(nameListStateCases(nameListStateModule, privateNamesModule))) it(name, run);

  it('every unreadable reason is a word of NAME_LIST_UNREADABLE, and the table reaches each', () => {
    const list: NameListStoreRead = { kind: 'list', uploadedAt: 1, rows: 0, generation: 1, entries: listUnder(K1) };
    const stores: NameListStoreRead[] = [{ kind: 'none' }, list, { kind: 'failed' }];
    const keys: NameListKeyRead[] = [{ kind: 'absent' }, { kind: 'unreadable' }, { kind: 'present', key: K1 }, { kind: 'present', key: K2 }];
    const reasons = new Set<string>();
    for (const st of stores) for (const k of keys) { const v = nameListState(st, k); if (v.state === 'unreadable') reasons.add(v.reason); }
    expect([...reasons].sort()).toEqual([...NAME_LIST_UNREADABLE].sort());
  });
});

interface Home { home: string; ccrcDir: string; db: DatabaseSync; store: OperatorModelStore }
function home(): Home {
  const h = mkTmp('ccrc-names-list-');
  const ccrcDir = path.join(h, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  const db = openOperatorModelDb(defaultOperatorModelDbPath(h));
  opened.push(db);
  return { home: h, ccrcDir, db, store: new OperatorModelStore(db, issuer) };
}
const masked = vi.fn(() => 'masked' as const);
async function upload(h: Home, key: string, names: readonly string[], at: number): Promise<void> {
  const r = h.store.replacePrivateNames(listUnder(key, names), names.length, at);
  expect(r.ok).toBe(true);
}

describe('readPrivateNameList: the one reader, over a fixture HOME and a fresh store', () => {
  it('never uploaded: none', () => {
    const h = home();
    expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'none' });
  });

  it('an upload under the slot\'s key reads list, and privateNameHits finds a name with it', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    await upload(h, key, ['zz-alpha', 'zq-bravo-x9'], 1_000);
    const v = readPrivateNameList(h.store, h.ccrcDir);
    expect(v).toMatchObject({ state: 'list', rows: 2, uploadedAt: 1_000, generation: 1 });
    if (v.state !== 'list') throw new Error('not a list');
    expect(privateNameHits('a note for zq-bravo-x9 today', v.list)).toHaveLength(1);
    expect(privateNameHits('a clean note', v.list)).toEqual([]);
  });

  it('asked twice with no upload between, it answers the same entries array (one index build); after an upload, a new one', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    await upload(h, key, ['zz-alpha'], 1_000);
    const a = readPrivateNameList(h.store, h.ccrcDir);
    const read = vi.spyOn(h.store, 'privateNamesRead');
    const b = readPrivateNameList(h.store, h.ccrcDir);
    expect(a.state === 'list' && b.state === 'list' && a.list.entries === b.list.entries).toBe(true);
    expect(read).not.toHaveBeenCalled();
    await upload(h, key, ['zq-bravo-x9'], 2_000);
    const c = readPrivateNameList(h.store, h.ccrcDir);
    expect(c).toMatchObject({ state: 'list', generation: 2, uploadedAt: 2_000 });
    expect(c.state === 'list' && a.state === 'list' && c.list.entries !== a.list.entries).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('the cached list is not served past a changed key: a replaced key reads key-mismatch at once', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    await upload(h, key, ['zz-alpha'], 1_000);
    expect(readPrivateNameList(h.store, h.ccrcDir).state).toBe('list');
    await writeNameListKey(h.ccrcDir, mintNameListKey(), 2_000, masked);
    expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'key-mismatch' });
  });

  it('the slot removed under a stored list: key-missing, never none and never the cached list', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    await upload(h, key, ['zz-alpha'], 1_000);
    expect(readPrivateNameList(h.store, h.ccrcDir).state).toBe('list');
    rmSync(serverSecretPath(h.ccrcDir, NAME_LIST_KEY_SLOT));
    expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'key-missing' });
  });

  it('a key with no list (a minted key whose list write failed): list-missing', async () => {
    const h = home();
    await writeNameListKey(h.ccrcDir, mintNameListKey(), 1_000, masked);
    expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'list-missing' });
  });

  it('the list row removed with the slot kept: list-missing', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    await upload(h, key, ['zz-alpha'], 1_000);
    expect(readPrivateNameList(h.store, h.ccrcDir).state).toBe('list');
    h.db.exec('DELETE FROM private_name_list');
    expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'list-missing' });
  });

  it.skipIf(process.getuid?.() === 0)('a key slot that cannot be read: key-unreadable, with or without a list', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    const file = serverSecretPath(h.ccrcDir, NAME_LIST_KEY_SLOT);
    chmodSync(file, 0o000);
    try {
      expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'key-unreadable' });
      await upload(h, key, ['zz-alpha'], 1_000);
      expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'key-unreadable' });
    } finally { chmodSync(file, 0o600); }
  });

  it('a generation that reads and entries that cannot (a list row with its entries gone): store, never none', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    await upload(h, key, ['zz-alpha'], 1_000);
    h.db.exec('DELETE FROM private_name_entries');
    expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'store' });
  });

  it('a store that cannot be read, or no store: store', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1_000, masked);
    await upload(h, key, ['zz-alpha'], 1_000);
    expect(readPrivateNameList(undefined, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'store' });
    h.db.close();
    expect(readPrivateNameList(h.store, h.ccrcDir)).toEqual({ state: 'unreadable', reason: 'store' });
  });
});

describe('the .server slot (the name list\'s key; the API decision model B shares)', () => {
  it('round-trips at 0600, records no tail with tail none, and tells the masker on the server lane', async () => {
    const h = home();
    const register = vi.fn(() => 'masked' as const);
    const key = mintNameListKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const meta = await writeNameListKey(h.ccrcDir, key, 5_000, register);
    expect(meta).toEqual({ setAt: 5_000, tail: '', masked: true });
    expect(register).toHaveBeenCalledWith(serverSecretLaneId(NAME_LIST_KEY_SLOT), key, { beside: false });
    expect(serverSecretLaneId(NAME_LIST_KEY_SLOT)).toBe('operator-secret:.server:private-names-key');
    const file = serverSecretPath(h.ccrcDir, NAME_LIST_KEY_SLOT);
    expect(file).toBe(path.join(h.ccrcDir, OPERATOR_SECRETS_DIR, SERVER_SECRETS_DIR, 'private-names-key.secret'));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(readServerSecretValue(h.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'value', value: key });
    const record = readFileSync(file.replace(/\.secret$/, '.json'), 'utf8');
    expect(JSON.parse(record)).toEqual({ v: 1, setAt: 5_000, tail: '', masked: true });
    expect(record).not.toContain(key.slice(-4));
  });

  it('without tail none, a masked server value records its tail as a programme slot does', async () => {
    const h = home();
    const meta = await writeServerSecret(h.ccrcDir, 'other-key', 'Z'.repeat(40), 1, () => 'masked');
    expect(meta.tail).toBe('ZZZZ');
  });

  it('absent is told from unreadable: no store, no server directory and no file are absent; a link or a 0755 directory is unreadable', async () => {
    const h = home();
    expect(readServerSecretValue(h.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    mkdirSync(path.join(h.ccrcDir, OPERATOR_SECRETS_DIR), { mode: 0o700 });
    expect(readServerSecretValue(h.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    const dir = path.join(h.ccrcDir, OPERATOR_SECRETS_DIR, SERVER_SECRETS_DIR);
    mkdirSync(dir, { mode: 0o700 });
    expect(readServerSecretValue(h.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    const elsewhere = path.join(h.home, 'planted');
    writeFileSync(elsewhere, 'planted-value');
    symlinkSync(elsewhere, path.join(dir, 'private-names-key.secret'));
    expect(readServerSecretValue(h.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'unreadable' });
    rmSync(path.join(dir, 'private-names-key.secret'));
    writeFileSync(path.join(dir, 'private-names-key.secret'), 'v', { mode: 0o600 });
    chmodSync(dir, 0o755);
    expect(readServerSecretValue(h.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'unreadable' });
    await expect(writeNameListKey(h.ccrcDir, 'x'.repeat(64), 1, masked)).rejects.toThrow(OperatorSecretStoreUnsafe);
  });

  it('a server directory that is a symlink refuses the write and reads unreadable', async () => {
    const h = home();
    const top = path.join(h.ccrcDir, OPERATOR_SECRETS_DIR);
    mkdirSync(top, { mode: 0o700 });
    const real = path.join(h.home, 'real-dir');
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, path.join(top, SERVER_SECRETS_DIR));
    await expect(writeNameListKey(h.ccrcDir, 'x'.repeat(64), 1, masked)).rejects.toThrow(OperatorSecretStoreUnsafe);
    expect(readServerSecretValue(h.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'unreadable' });
    expect(existsSync(path.join(real, 'private-names-key.secret'))).toBe(false);
  });

  it('a bad slot name throws before any path is built', () => {
    expect(() => serverSecretPath('/nowhere', '../x')).toThrow(OperatorSecretBadSlot);
    expect(() => readServerSecretValue('/nowhere', 'A/B')).toThrow(OperatorSecretBadSlot);
  });

  it('no programme\'s secrets read lists it: .server is not a programme name, and a programme\'s read shows nothing of it', async () => {
    const h = home();
    await writeNameListKey(h.ccrcDir, mintNameListKey(), 1, masked);
    expect(readStoredSecrets(h.ccrcDir, SERVER_SECRETS_DIR)).toEqual({ state: 'invalid' });
    expect(readStoredSecrets(h.ccrcDir, 'prog-a')).toEqual({ state: 'ok', slots: [] });
  });

  it('the masker\'s re-key reads it: operatorSecretRows carries the server lane', async () => {
    const h = home();
    const key = mintNameListKey();
    await writeNameListKey(h.ccrcDir, key, 1, masked);
    const rows = await operatorSecretRows(h.ccrcDir, (laneId, value) => ({ laneId, fingerprint: value === key ? 'k' : 'other' }) as never);
    expect(rows.unreadable).toBe(false);
    expect(rows.rows).toEqual([{ laneId: 'operator-secret:.server:private-names-key', fingerprint: 'k' }]);
  });

  it('the start-up sweep removes a crash\'s temp in the server directory too', async () => {
    const h = home();
    await writeNameListKey(h.ccrcDir, mintNameListKey(), 1, masked);
    const temp = path.join(h.ccrcDir, OPERATOR_SECRETS_DIR, SERVER_SECRETS_DIR, `.${NAME_LIST_KEY_SLOT}.secret.tmp-0123456789abcdef`);
    writeFileSync(temp, 'leftover', { mode: 0o600 });
    sweepOperatorSecretTemps(h.ccrcDir);
    expect(existsSync(temp)).toBe(false);
  });

  it('removeServerSecret removes a server slot (for decision model B\'s key; never the name list\'s)', async () => {
    const h = home();
    await writeServerSecret(h.ccrcDir, 'other-key', 'Q'.repeat(40), 1, masked);
    expect(await removeServerSecret(h.ccrcDir, 'other-key')).toBe('removed');
    expect(await removeServerSecret(h.ccrcDir, 'other-key')).toBe('none');
    expect(readServerSecretValue(h.ccrcDir, 'other-key')).toEqual({ state: 'absent' });
  });
});

describe('shared/privateNames.ts: the console\'s copy of the wire', () => {
  it('NAME_LIST_MODES is the matcher\'s MODES, in both directions', () => {
    expect([...NAME_LIST_MODES]).toEqual([...MODES]);
    for (const m of MODES) expect(isNameListMode(m)).toBe(true);
    expect(isNameListMode('loose')).toBe(false);
  });

  it('CONTROL: an import, a type import and a re-export are each seen by the parse', () => {
    for (const src of ["import type { X } from './private-names.mjs';", "import { X } from './a.js';", "export { X } from './a.js';"]) {
      expect(parseSource(src).imports.length, src).toBeGreaterThan(0);
    }
  });
  it('it imports nothing, not even by type, so the console bundles it with no node:crypto', () => {
    expect(parsedFile('shared/privateNames.ts').imports).toEqual([]);
  });
});
