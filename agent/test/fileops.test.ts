import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync,
  type BigIntStats,
} from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { MAX_READ_B64_BYTES, readFromMeasured, readIdentOf } from '../src/fileops.js';

interface Res { ok: boolean; err?: string; [k: string]: unknown }

// The byte-read identity's one seam (run 3531), R99's pattern in the server's io suite: the real `open` is wrapped, never
// replaced. A test arms `afterOpen` to act on the handle just opened, after the open and before anything reads it: rename
// another file over its path, or answer controlled bigint stat facts on that one handle. Disarmed, it is the real `open`.
const hooks = vi.hoisted(() => ({ afterOpen: null as null | ((p: string, fh: FileHandle) => void) }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: (async (...a: Parameters<typeof actual.open>) => {
      const fh = await actual.open(...a);
      hooks.afterOpen?.(String(a[0]), fh);
      return fh;
    }) as typeof actual.open,
  };
});

/** Controlled facts for one handle's BIGINT stat (the identity's), the real answer otherwise; `fail` rejects it. */
interface Facts { birth?: bigint; change?: bigint; ino?: bigint; regular?: boolean; fail?: boolean }
const withFacts = (fh: FileHandle, f: Facts): void => {
  const real = fh.stat.bind(fh) as (o?: { bigint?: boolean }) => Promise<unknown>;
  fh.stat = (async (o?: { bigint?: boolean }) => {
    if (o?.bigint !== true) return real(o);
    if (f.fail === true) throw Object.assign(new Error('EIO: stat failed'), { code: 'EIO' });
    const st = (await real({ bigint: true })) as BigIntStats;
    if (f.birth !== undefined) st.birthtimeNs = f.birth;
    if (f.change !== undefined) st.ctimeNs = f.change;
    if (f.ino !== undefined) st.ino = f.ino;
    if (f.regular === false) st.isFile = () => false;
    return st;
  }) as FileHandle['stat'];
};
/** Arm `facts` for every handle opened on `file` until the returned disarm runs. */
const armFacts = (file: string, f: Facts): (() => void) => {
  const want = realpathSync(file);   // the agent opens the canonical path
  hooks.afterOpen = (p, fh) => { if (p === file || p === want) withFacts(fh, f); };
  return () => { hooks.afterOpen = null; };
};
/** The token as the contract states it, derived independently of the code under test. */
const tokenOf = (dev: bigint, ino: bigint, birth: bigint): string =>
  createHash('sha256').update(`read-ident-v1\0${dev}\0${ino}\0${birth}`).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
/** A bounded answer without its optional token, which a fixture's one-call file may or may not carry (its birth and change
 *  times can fall in one tick or two): present, it must be 64 hex. */
const sansIdent = <T extends object>(r: T): T => {
  if (!('ident' in r)) return r;
  expect((r as { ident: unknown }).ident).toMatch(HEX64);
  const { ident: _ident, ...rest } = r as T & { ident?: unknown };
  return rest as T;
};

describe('ccrc-agent file ops', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;
  let id = 0;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  async function open(): Promise<void> {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
  }

  const nextId = () => ++id;

  it('read returns content for whitelisted files, null for missing ones', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-sessions', 'a.wrapper');
    writeFileSync(file, 'claude9');
    const res1 = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res1).toMatchObject({ ok: true, data: 'claude9' });
    const res2 = await client!.req<Res>(nextId(), { op: 'read', path: path.join(fixture!.home, '.cc-sessions', 'nope') });
    expect(res2).toMatchObject({ ok: true, data: null });
  });

  it('read marks a genuinely missing whitelisted file with absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'read', path: path.join(fixture!.home, '.cc-sessions', 'nope-absent') });
    expect(res).toMatchObject({ ok: true, data: null, absent: true });
  });

  it('read of a directory (EISDIR) answers null with no absent key — unreadable is not absent', async () => {
    await open();
    // .cc-sessions is pre-created by the fixture as a directory under a whitelist root.
    const dir = path.join(fixture!.home, '.cc-sessions');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: dir });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
  });

  it('read rejects a path outside every whitelist prefix', async () => {
    await open();
    const file = path.join(fixture!.outside, 'secret.txt');
    writeFileSync(file, 'nope');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res).not.toHaveProperty('absent');
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('read rejects .. traversal that would escape the whitelist', async () => {
    await open();
    const escape = path.join(fixture!.home, '.cc-sessions', '..', '..', 'etc', 'passwd');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: escape });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('read allows the .claude* glob roots (e.g. .claude-home)', async () => {
    await open();
    const file = path.join(fixture!.home, '.claude-home', 'settings.json');
    writeFileSync(file, '{}');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res).toMatchObject({ ok: true, data: '{}' });
  });

  it('read allows files under the fleet projects root', async () => {
    await open();
    const file = path.join(fixture!.projectsRoot, 'my-project', 'README.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '# hi');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res).toMatchObject({ ok: true, data: '# hi' });
  });

  it('readFrom reads from an offset and reports the real size', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-limits', 'claude.json');
    writeFileSync(file, 'abcdefghij');
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 4 });
    expect(res).toMatchObject({ ok: true, data: 'efghij', size: 10 });
  });

  it('readFrom rejects paths outside the whitelist', async () => {
    await open();
    const file = path.join(fixture!.outside, 'x.txt');
    writeFileSync(file, 'x');
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 0 });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('readB64 serves a whitelisted clip as base64, and refuses outside the whitelist', async () => {
    await open();
    const bytes = Buffer.from([0x00, 0x01, 0xfe]);
    const file = path.join(fixture!.home, '.cc-clips', 'clip-x.png');
    writeFileSync(file, bytes);
    const res1 = await client!.req<Res>(nextId(), { op: 'readB64', path: file });
    expect(res1).toMatchObject({ ok: true, dataB64: bytes.toString('base64') });
    const res2 = await client!.req<Res>(nextId(), { op: 'readB64', path: path.join(fixture!.outside, 'secret.png') });
    expect(res2).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('readB64 returns null for a missing whitelisted file', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readB64',
      path: path.join(fixture!.home, '.cc-clips', 'nope.png'),
    });
    expect(res).toMatchObject({ ok: true, dataB64: null });
  });

  it('readB64 marks a genuinely missing whitelisted file absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readB64', path: path.join(fixture!.home, '.cc-clips', 'nope-absent.png'),
    });
    expect(res).toMatchObject({ ok: true, dataB64: null, absent: true });
  });

  it('readB64 of a DIRECTORY (EISDIR) answers null with no absent and no tooLarge key', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readB64', path: path.join(fixture!.home, '.cc-clips') });
    expect(res).toMatchObject({ ok: true, dataB64: null });
    expect(res).not.toHaveProperty('absent');
    expect(res).not.toHaveProperty('tooLarge');
  });

  it('readB64 REPORTS an over-cap clip as tooLarge with its measured size, never as missing', async () => {
    await open();
    // Sparse via truncate: the cap is checked against st.size BEFORE any byte
    // is read, so no 12 MB buffer is ever allocated by this test. Reachable in
    // production because `ccd clip` (ccd/ccd:13766) mv -f's an image of any
    // size into this directory with no size check, while the upload route
    // refuses one (server/src/server.ts:2152-2153).
    const file = path.join(fixture!.home, '.cc-clips', 'huge.png');
    writeFileSync(file, '');
    truncateSync(file, MAX_READ_B64_BYTES + 1);
    const res = await client!.req<Res>(nextId(), { op: 'readB64', path: file });
    expect(res).toMatchObject({ ok: true, dataB64: null, tooLarge: true, size: MAX_READ_B64_BYTES + 1 });
    expect(res).not.toHaveProperty('absent');
  });

  it('readFrom marks a genuinely missing whitelisted file absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readFrom', path: path.join(fixture!.home, '.cc-limits', 'nope-absent.json'), offset: 0,
    });
    expect(res).toMatchObject({ ok: true, data: null, absent: true });
  });

  it('readFrom at EOF is a POSITIVE answer — empty data with the real size, and no absent key', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-limits', 'eof.json');
    writeFileSync(file, 'abcd');
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 4 });
    expect(res).toMatchObject({ ok: true, data: '', size: 4 });
    expect(res).not.toHaveProperty('absent');
  });

  it('readFrom of a DIRECTORY (stat ok, range read EISDIR) answers null with no absent key', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: path.join(fixture!.home, '.cc-clips'), offset: 0 });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
  });

  it('readdir lists entries for a whitelisted directory', async () => {
    await open();
    const dir = path.join(fixture!.home, '.cc-clips', 'sess1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'x.png'), 'x');
    const res = await client!.req<Res>(nextId(), { op: 'readdir', path: dir });
    expect(res.ok).toBe(true);
    expect(res.names).toEqual(['x.png']);
  });

  it('readdir rejects a directory outside the whitelist', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readdir', path: fixture!.outside });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  // ── delegation wave 3, Task 4 — the measured directory read ─────────────────
  // `readdir` widens ADDITIVELY from `{names: string[] | null}` to `{names:
  // string[]}` or `{names: null, absent?: true}`. Same fail-shut rule as every
  // other `absent` on this wire: the marker rides ONLY a proven ENOENT, so an
  // older server (which reads `names` and nothing else) is unaffected and a
  // newer one reads a bare `names: null` as UNMEASURED.
  describe('readdir: the measured answer', () => {
    it('an EMPTY whitelisted directory is a POSITIVE answer — names [] and no absent key', async () => {
      await open();
      const dir = path.join(fixture!.home, '.cc-sessions', 'delegation-empty');
      mkdirSync(dir, { recursive: true });
      const res = await client!.req<Res>(nextId(), { op: 'readdir', path: dir });
      expect(res).toMatchObject({ ok: true, names: [] });
      expect(res).not.toHaveProperty('absent');
    });

    it('a genuinely missing directory answers names:null WITH absent:true', async () => {
      await open();
      const res = await client!.req<Res>(nextId(), {
        op: 'readdir', path: path.join(fixture!.home, '.cc-sessions', 'delegation-nope'),
      });
      expect(res).toMatchObject({ ok: true, names: null, absent: true });
    });

    it('a FILE where a directory was expected (ENOTDIR) answers names:null with NO absent key', async () => {
      await open();
      const file = path.join(fixture!.home, '.cc-sessions', 'delegation-a-file');
      writeFileSync(file, 'x');
      const res = await client!.req<Res>(nextId(), { op: 'readdir', path: file });
      expect(res).toMatchObject({ ok: true, names: null });
      expect(res).not.toHaveProperty('absent');
    });

    it('a path THROUGH a file (ENOTDIR on the parent) answers names:null with NO absent key', async () => {
      await open();
      // ENOTDIR rather than `chmod 000`, for the reason the stat case below
      // records: chmod does not deny root, so a root runner would assert the
      // wrong thing.
      const file = path.join(fixture!.home, '.cc-sessions', 'delegation-a-file-too');
      writeFileSync(file, 'x');
      const res = await client!.req<Res>(nextId(), { op: 'readdir', path: path.join(file, 'child') });
      expect(res).toMatchObject({ ok: true, names: null });
      expect(res).not.toHaveProperty('absent');
    });

    it('the whitelist decides BEFORE the filesystem: a missing path outside every root is forbidden, never absent', async () => {
      await open();
      // If the agent touched the disk first, this would answer
      // `{names: null, absent: true}` — a refusal wearing the proof of absence.
      const res = await client!.req<Res>(nextId(), {
        op: 'readdir', path: path.join(fixture!.outside, 'delegation-no-such-dir'),
      });
      expect(res).toMatchObject({ ok: false, err: 'forbidden' });
      expect(res).not.toHaveProperty('absent');
      expect(res).not.toHaveProperty('names');
    });
  });

  // ── delegation wave 3, Task 4 — the bounded byte-range read ─────────────────
  // `readFrom` gains an OPTIONAL `maxBytes`. Present: the agent reads no more
  // than that many bytes and answers `{data, dataB64, size}` — `data` for an
  // older server, `dataB64` for a byte-exact one. Absent: the answer is the one
  // it always was, key for key.
  describe('readFrom: maxBytes bounds the read and adds dataB64; omitting it changes nothing', () => {
    const SPOOL_MAX = 262144;
    const limitsFile = (name: string): string => path.join(fixture!.home, '.cc-limits', name);
    /** Deterministic non-text content: every byte value, so a lossy UTF-8 round trip cannot hide. */
    const pattern = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => i % 251));

    it('an old caller (no maxBytes) gets the whole remainder as decoded text, the exact old keys, and NO dataB64', async () => {
      await open();
      const file = limitsFile('old-caller.json');
      writeFileSync(file, 'abcdefghij');
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 4 });
      expect(res).toEqual({ t: 'res', id, ok: true, data: 'efghij', size: 10 });
      expect(Object.keys(res).sort()).toEqual(['data', 'id', 'ok', 'size', 't']);
    });

    it('an old caller reading multibyte text keeps the decoded-string answer, and still gets no dataB64', async () => {
      await open();
      const file = limitsFile('old-caller-utf8.json');
      writeFileSync(file, 'a€b');   // 5 bytes: 61 e2 82 ac 62
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 1 });
      expect(res).toEqual({ t: 'res', id, ok: true, data: '€b', size: 5 });
      expect(res).not.toHaveProperty('dataB64');
    });

    it('an old caller still reads the WHOLE remainder of a file larger than the largest maxBytes — omitting the field applies no default bound', async () => {
      await open();
      const file = limitsFile('old-caller-big.log');
      writeFileSync(file, 'x'.repeat(SPOOL_MAX + 100));
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 0 });
      expect(res.ok).toBe(true);
      expect((res.data as string).length).toBe(SPOOL_MAX + 100);
      expect(res.size).toBe(SPOOL_MAX + 100);
      expect(res).not.toHaveProperty('dataB64');
    });

    it.each([
      // [label, offset, maxBytes, expected bytes (as text)]
      ['start, 1 byte', 0, 1, 'a'],
      ['start, 4 bytes', 0, 4, 'abcd'],
      ['middle, 3 bytes', 4, 3, 'efg'],
      ['middle, the rest exactly', 6, 4, 'ghij'],
      ['last byte, 1 byte', 9, 1, 'j'],
      ['the remainder is shorter than maxBytes', 8, SPOOL_MAX, 'ij'],
      ['the whole file under the largest bound', 0, SPOOL_MAX, 'abcdefghij'],
    ] as const)('%s: reads exactly that range, with dataB64 = the same bytes and the real size', async (_label, offset, maxBytes, expected) => {
      await open();
      const file = limitsFile('range.txt');
      writeFileSync(file, 'abcdefghij');
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset, maxBytes });
      expect(sansIdent(res)).toEqual({
        t: 'res', id, ok: true,
        data: expected, dataB64: Buffer.from(expected).toString('base64'), size: 10,
      });
    });

    it.each([
      ['exactly at EOF', 10],
      ['past EOF (the cursor outran a shrunk file)', 12],
    ] as const)('%s: a POSITIVE empty answer — data "", dataB64 "", the real size, no absent key', async (_label, offset) => {
      await open();
      const file = limitsFile('eof.txt');
      writeFileSync(file, 'abcdefghij');
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset, maxBytes: 1 });
      expect(res).toEqual({ t: 'res', id, ok: true, data: '', dataB64: '', size: 10 });
    });

    // ── run 3531: the bounded reply's optional identity, over the wire ──
    it('a bounded reply with bytes carries the token of its own handle when the facts are usable', async () => {
      await open();
      const file = limitsFile('ident.txt');
      writeFileSync(file, 'abcdefghij');
      const st = statSync(file, { bigint: true });
      const disarm = armFacts(file, { birth: 5n, change: 9n });
      try {
        const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 2, maxBytes: 3 });
        expect(res).toEqual({
          t: 'res', id, ok: true, data: 'cde', dataB64: Buffer.from('cde').toString('base64'), ident: tokenOf(st.dev, st.ino, 5n), size: 10,
        });
      } finally { disarm(); }
    });

    it('the EOF reply and an unbounded reply carry no token even when the facts are usable: their exact old keys', async () => {
      await open();
      const file = limitsFile('ident-eof.txt');
      writeFileSync(file, 'abcdefghij');
      const disarm = armFacts(file, { birth: 5n, change: 9n });
      try {
        expect(await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 10, maxBytes: 4 }))
          .toEqual({ t: 'res', id, ok: true, data: '', dataB64: '', size: 10 });
        const old = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 4 });
        expect(old).toEqual({ t: 'res', id, ok: true, data: 'efghij', size: 10 });
        expect(Object.keys(old).sort()).toEqual(['data', 'id', 'ok', 'size', 't']);
      } finally { disarm(); }
    });

    it('the largest bound (262144) returns exactly that many bytes of a larger file, byte-exact, at an offset', async () => {
      await open();
      const bytes = pattern(SPOOL_MAX + 10);
      const file = limitsFile('big.bin');
      writeFileSync(file, bytes);
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 10, maxBytes: SPOOL_MAX });
      expect(res.ok).toBe(true);
      expect(res.size).toBe(SPOOL_MAX + 10);
      expect(Buffer.from(res.dataB64 as string, 'base64').equals(bytes.subarray(10, 10 + SPOOL_MAX))).toBe(true);
    });

    it('a bound of 1 returns one byte of a larger file and never more', async () => {
      await open();
      const bytes = pattern(SPOOL_MAX + 10);
      const file = limitsFile('one.bin');
      writeFileSync(file, bytes);
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 7, maxBytes: 1 });
      expect(res).toMatchObject({ ok: true, dataB64: bytes.subarray(7, 8).toString('base64'), size: SPOOL_MAX + 10 });
    });

    it('a MULTIBYTE character split by the bound survives byte-exact in dataB64 while `data` is the lossy decode', async () => {
      await open();
      const file = limitsFile('euro.txt');
      writeFileSync(file, '€');   // e2 82 ac
      const first = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 0, maxBytes: 1 });
      expect(first).toMatchObject({ ok: true, dataB64: Buffer.from([0xe2]).toString('base64'), size: 3 });
      expect(first.data).toBe('�');
      const second = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 1, maxBytes: 2 });
      expect(second).toMatchObject({ ok: true, dataB64: Buffer.from([0x82, 0xac]).toString('base64'), size: 3 });
      // The two halves rejoin into the character ONLY through the bytes.
      const joined = Buffer.concat([
        Buffer.from(first.dataB64 as string, 'base64'), Buffer.from(second.dataB64 as string, 'base64'),
      ]);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(joined)).toBe('€');
    });

    it('bytes that are not UTF-8 at all come back exact in dataB64', async () => {
      await open();
      const file = limitsFile('not-utf8.bin');
      writeFileSync(file, Buffer.from([0xff, 0xfe, 0x00, 0x80]));
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 0, maxBytes: 4 });
      expect(res.dataB64).toBe('//4AgA==');
    });

    it.each([
      ['zero', 0], ['negative', -1], ['fractional', 1.5], ['one past the largest bound', 262145],
      ['a string', '5'], ['null', null], ['a boolean', true],
    ] as const)('a maxBytes that is %s is a bad-request, not a read', async (_label, maxBytes) => {
      await open();
      const file = limitsFile('bad-bound.txt');
      writeFileSync(file, 'abcdefghij');
      const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 0, maxBytes });
      expect(res).toMatchObject({ ok: false, err: 'bad-request' });
      expect(res).not.toHaveProperty('data');
    });

    it.each([['negative', -1], ['fractional', 1.5]] as const)(
      'a %s offset WITH maxBytes is a bad-request (an old caller\'s clamp does not carry over to the byte arm)',
      async (_label, offset) => {
        await open();
        const file = limitsFile('bad-offset.txt');
        writeFileSync(file, 'abcdefghij');
        const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset, maxBytes: 4 });
        expect(res).toMatchObject({ ok: false, err: 'bad-request' });
      },
    );

    it('a missing file with maxBytes is data:null WITH absent:true and no dataB64', async () => {
      await open();
      const res = await client!.req<Res>(nextId(), {
        op: 'readFrom', path: limitsFile('nope-absent.bin'), offset: 0, maxBytes: 4,
      });
      expect(res).toMatchObject({ ok: true, data: null, absent: true });
      expect(res).not.toHaveProperty('dataB64');
    });

    it('a DIRECTORY with maxBytes is data:null with NO absent key and no dataB64', async () => {
      await open();
      const res = await client!.req<Res>(nextId(), {
        op: 'readFrom', path: path.join(fixture!.home, '.cc-clips'), offset: 0, maxBytes: 4,
      });
      expect(res).toMatchObject({ ok: true, data: null });
      expect(res).not.toHaveProperty('absent');
      expect(res).not.toHaveProperty('dataB64');
    });

    it('the whitelist decides BEFORE the filesystem: outside every root is forbidden (existing or not), never absent, never bytes', async () => {
      await open();
      const existing = path.join(fixture!.outside, 'secret.txt');
      writeFileSync(existing, 'secret');
      for (const p of [existing, path.join(fixture!.outside, 'delegation-no-such-file')]) {
        const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: p, offset: 0, maxBytes: 4 });
        expect(res).toMatchObject({ ok: false, err: 'forbidden' });
        expect(res).not.toHaveProperty('absent');
        expect(res).not.toHaveProperty('dataB64');
        expect(res).not.toHaveProperty('data');
      }
    });
  });

  it('stat reports size/mtimeMs for whitelisted files, missing:true otherwise', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-limits', 'claude.json');
    writeFileSync(file, 'abcd');
    const res1 = await client!.req<Res>(nextId(), { op: 'stat', path: file });
    expect(res1.ok).toBe(true);
    expect(res1.size).toBe(4);
    expect(typeof res1.mtimeMs).toBe('number');
    const res2 = await client!.req<Res>(nextId(), { op: 'stat', path: path.join(fixture!.home, '.cc-limits', 'nope') });
    expect(res2).toMatchObject({ ok: true, missing: true });
  });

  it('stat answers the ~/.ccrc switch files (D-8382), and read, readdir and lstat of them stay forbidden', async () => {
    await open();
    const ccrc = path.join(fixture!.home, '.ccrc');
    mkdirSync(ccrc, { recursive: true });
    const off = path.join(ccrc, 'graph-gate-off');
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: off })).toMatchObject({ ok: true, missing: true, absent: true });
    writeFileSync(off, '');
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: off })).toMatchObject({ ok: true, size: 0 });
    for (const op of ['read', 'lstat', 'readB64'] as const) {
      expect(await client!.req<Res>(nextId(), { op, path: off }), op).toMatchObject({ ok: false, err: 'forbidden' });
    }
    expect(await client!.req<Res>(nextId(), { op: 'readdir', path: ccrc })).toMatchObject({ ok: false, err: 'forbidden' });
    writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: path.join(ccrc, 'agent.env') }))
      .toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('stat answers one history W3 steer marker (review 2024 F1), and read, readdir and lstat of it stay forbidden', async () => {
    await open();
    const dir = path.join(fixture!.home, '.ccrc', 'history', 'steer-on');
    mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, 'lane-a-project-a');
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: marker })).toMatchObject({ ok: true, missing: true, absent: true });
    writeFileSync(marker, '');
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: marker })).toMatchObject({ ok: true, size: 0 });
    for (const op of ['read', 'lstat', 'readB64'] as const) {
      expect(await client!.req<Res>(nextId(), { op, path: marker }), op).toMatchObject({ ok: false, err: 'forbidden' });
    }
    expect(await client!.req<Res>(nextId(), { op: 'readdir', path: dir })).toMatchObject({ ok: false, err: 'forbidden' });
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: path.join(dir, '..', 'lane-a-project-a') }))
      .toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('lstat answers about the PATH, not its target — the distinction `stat` structurally cannot carry', async () => {
    await open();
    const target = path.join(fixture!.home, '.cc-limits', 'target.json');
    const link = path.join(fixture!.home, '.cc-limits', 'link.json');
    writeFileSync(target, 'abcd');
    symlinkSync(target, link);

    expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
      .toMatchObject({ ok: true, kind: 'symlink' });
    expect(await client!.req<Res>(nextId(), { op: 'lstat', path: target }))
      .toMatchObject({ ok: true, kind: 'regular' });
    // THE POINT OF THE OP, as one contrast on one fixture: `stat` follows and
    // reports the target's four bytes for the very path `lstat` calls a link.
    // Before this op existed, the server had no way to ask the question at all,
    // which is why its `_authdead` gate condemned accounts both bash bodies
    // call healthy.
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: link }))
      .toMatchObject({ ok: true, size: 4 });
  });

  it('lstat is not defeated by `checkPath`\'s canonicalisation — the regression that shipped inert would say `regular` here', async () => {
    // A guard on the implementation, not on the behaviour above: every other op
    // operates on `checkPath`'s CANONICAL result, and lstat'ing that can only
    // ever answer `regular` for a symlink, because canonicalisation already
    // followed it. This case is what caught that, end to end, after the local
    // adapter's own unit tests were green.
    await open();
    const target = path.join(fixture!.home, '.cc-sessions', 'canon-target');
    const link = path.join(fixture!.home, '.cc-sessions', 'claude-a-authdead');
    writeFileSync(target, '1757203200 auth-401');
    symlinkSync(target, link);
    expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
      .toMatchObject({ ok: true, kind: 'symlink' });
  });

  it('lstat reports a DANGLING link as `symlink` — the link exists though its target does not', async () => {
    await open();
    const link = path.join(fixture!.home, '.cc-limits', 'dangling');
    symlinkSync(path.join(fixture!.home, '.cc-limits', 'no-such-target'), link);
    expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
      .toMatchObject({ ok: true, kind: 'symlink' });
    // The residual `StatResult`'s docstring names, on the same fixture: `stat`
    // follows, the TARGET's ENOENT throws, and a name still in its directory
    // listing reads as proven-absent.
    expect(await client!.req<Res>(nextId(), { op: 'stat', path: link }))
      .toMatchObject({ ok: true, missing: true, absent: true });
  });

  it('lstat reports a directory as `other`, and a genuinely missing path as missing/absent', async () => {
    await open();
    expect(await client!.req<Res>(nextId(), { op: 'lstat', path: path.join(fixture!.home, '.cc-limits') }))
      .toMatchObject({ ok: true, kind: 'other' });
    expect(await client!.req<Res>(nextId(), { op: 'lstat', path: path.join(fixture!.home, '.cc-limits', 'nope') }))
      .toMatchObject({ ok: true, missing: true, absent: true });
  });

  it('lstat rejects a path outside the whitelist, and a link OUT of the whitelist too', async () => {
    await open();
    expect(await client!.req<Res>(nextId(), { op: 'lstat', path: fixture!.outside }))
      .toMatchObject({ ok: false, err: 'forbidden' });
    // The escape the whitelist exists to stop. The decision is still made on
    // the FULLY RESOLVED path, so answering about the literal last component
    // widened nothing — and the refusal must not leak the kind it refused.
    const escape = path.join(fixture!.home, '.cc-limits', 'escape-link');
    symlinkSync(fixture!.outside, escape);
    const res = await client!.req<Res>(nextId(), { op: 'lstat', path: escape });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
    expect(res.kind).toBeUndefined();
  });

  // ── F12 (review run 134) / D-3195 — lstat of one of the eight ~/.ccrc node
  // files must answer about that path's OWN directory entry, never about a
  // target `checkPath` resolved into ANOTHER admitted prefix. Before the fix,
  // `checkPath(dirname('~/.ccrc/…'))` refuses (`~/.ccrc` itself is not
  // whitelisted), so the op fell back to the CANONICAL — already
  // symlink-resolved — subject and reported the regular file at the other
  // end of the link, not the link itself.
  describe('lstat of a ~/.ccrc node file answers the literal entry, not a target resolved into another prefix', () => {
    it('a node-file symlink into .cc-sessions still reports `symlink`', async () => {
      await open();
      mkdirSync(path.join(fixture!.home, '.ccrc'), { recursive: true });
      const target = path.join(fixture!.home, '.cc-sessions', 'x');
      const link = path.join(fixture!.home, '.ccrc', 'installed');
      writeFileSync(target, 'regular\n');
      symlinkSync(target, link);
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
        .toMatchObject({ ok: true, kind: 'symlink' });
    });

    it('same for a target under .cc-clips', async () => {
      await open();
      mkdirSync(path.join(fixture!.home, '.ccrc'), { recursive: true });
      const target = path.join(fixture!.home, '.cc-clips', 'x');
      const link = path.join(fixture!.home, '.ccrc', 'floor');
      writeFileSync(target, 'regular\n');
      symlinkSync(target, link);
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
        .toMatchObject({ ok: true, kind: 'symlink' });
    });

    it('same for a target under a .claude* dir', async () => {
      await open();
      mkdirSync(path.join(fixture!.home, '.ccrc'), { recursive: true });
      const target = path.join(fixture!.home, '.claude-home', 'x');
      const link = path.join(fixture!.home, '.ccrc', 'node-id');
      writeFileSync(target, 'regular\n');
      symlinkSync(target, link);
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
        .toMatchObject({ ok: true, kind: 'symlink' });
    });

    it('same for a target under the fleet projects root', async () => {
      await open();
      mkdirSync(path.join(fixture!.home, '.ccrc'), { recursive: true });
      const target = path.join(fixture!.projectsRoot, 'proj', 'x');
      mkdirSync(path.dirname(target), { recursive: true });
      const link = path.join(fixture!.home, '.ccrc', 'build.json');
      writeFileSync(target, 'regular\n');
      symlinkSync(target, link);
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
        .toMatchObject({ ok: true, kind: 'symlink' });
    });

    it('control: a REGULAR node file still answers `regular`', async () => {
      await open();
      const ccrc = path.join(fixture!.home, '.ccrc');
      mkdirSync(ccrc, { recursive: true });
      const p = path.join(ccrc, 'installed');
      writeFileSync(p, 'abc\n');
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: p }))
        .toMatchObject({ ok: true, kind: 'regular' });
    });

    it('control: a DANGLING node-file symlink still answers `symlink`', async () => {
      await open();
      const ccrc = path.join(fixture!.home, '.ccrc');
      mkdirSync(ccrc, { recursive: true });
      const link = path.join(ccrc, 'previous');
      symlinkSync(path.join(ccrc, 'no-such-target'), link);
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
        .toMatchObject({ ok: true, kind: 'symlink' });
    });

    // Fix round 1 (I-1): each scoping condition on its own guard, so
    // deleting either one reds a case here rather than leaving the suite
    // green. Not "into another prefix" cases (those are above) — these are
    // the two ways a request can look LIKE one of those cases without being
    // one, which only a request satisfying BOTH conditions may become.
    it('control: a REGULAR file with a node basename under ANOTHER prefix still answers `regular` — guards the literal-parent condition (I-1)', async () => {
      await open();
      // `~/.ccrc` exists but has no `build.json` of its own: if the
      // literal-parent condition were dropped, the basename check alone
      // would redirect this request's subject to `~/.ccrc/build.json`
      // (absent) instead of the real file under `.cc-sessions`.
      mkdirSync(path.join(fixture!.home, '.ccrc'), { recursive: true });
      const p = path.join(fixture!.home, '.cc-sessions', 'build.json');
      writeFileSync(p, 'regular\n');
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: p }))
        .toMatchObject({ ok: true, kind: 'regular' });
    });

    it('control: a NON-node name in ~/.ccrc that is a live link elsewhere keeps its pre-existing answer, never discloses `symlink` — guards the basename condition (I-1)', async () => {
      await open();
      // `agent.env` is not one of the eight, so its kind must never be
      // revealed through the node-file branch: if the basename condition
      // were dropped, the literal-parent check alone would take this
      // request's subject to the literal (symlink) entry and report
      // `symlink` for a name the sweep's read grant does not cover at all.
      const ccrc = path.join(fixture!.home, '.ccrc');
      mkdirSync(ccrc, { recursive: true });
      const target = path.join(fixture!.home, '.cc-sessions', 'x');
      const link = path.join(ccrc, 'agent.env');
      writeFileSync(target, 'regular\n');
      symlinkSync(target, link);
      expect(await client!.req<Res>(nextId(), { op: 'lstat', path: link }))
        .toMatchObject({ ok: true, kind: 'regular' });
    });
  });

  it('stat rejects a path outside the whitelist', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'stat', path: fixture!.outside });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('stat marks a genuinely missing whitelisted path with absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'stat', path: path.join(fixture!.home, '.cc-limits', 'nope-absent'),
    });
    expect(res).toMatchObject({ ok: true, missing: true, absent: true });
  });

  it('stat THROUGH a file (ENOTDIR) answers missing:true with NO absent key — unmeasured is not absent', async () => {
    await open();
    // The whole of D-114 in one case. `claude.json` is a FILE, so the kernel
    // refuses to walk THROUGH it: ENOTDIR, not ENOENT. This op USED to answer
    // a bare `{missing:true}` — byte-identical to a genuine ENOENT — and the
    // server read that as proof the path was gone. D-1396 closed it, and the
    // two assertions below are the guarantee that close is worth, not a
    // record of the defect: `missing: true` still rides the wire, keeping its
    // exact pre-existing "no {mtimeMs,size} for you" meaning so an older
    // server's reader is unaffected — and `absent`, the PROVEN-absence
    // marker, is WITHHELD. Both halves are load-bearing. Delete the
    // `not.toHaveProperty('absent')` line and you delete the only agent-side
    // pin that a non-ENOENT stat failure never wears that marker; the
    // genuine-ENOENT case two `it()`s up is its other half, asserting the
    // marker IS worn when it is earned.
    //
    // ENOTDIR rather than `chmod 000` deliberately: chmod does not deny root,
    // so a root runner would silently assert the wrong thing (D-116, still
    // open at every `chmodSync(…, 0o000)` site in
    // server/test/coord-fingerprint.test.ts — cited by the CALL rather than by
    // line because the line set this comment first named, :100/:632/:650/:701,
    // had moved by the time anyone read it back). Which is why nothing new
    // here uses chmod.
    const file = path.join(fixture!.home, '.cc-limits', 'claude.json');
    writeFileSync(file, 'abcd');
    const res = await client!.req<Res>(nextId(), { op: 'stat', path: path.join(file, 'child') });
    expect(res).toMatchObject({ ok: true, missing: true });
    expect(res).not.toHaveProperty('absent');
  });

  it('writeB64 mkdir-ps the parent and writes decoded bytes under .cc-clips', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-clips', 'deep', 'nested', 'clip.png');
    const data = Buffer.from('89504e470d0a1a0a', 'hex');
    const res = await client!.req<Res>(nextId(), { op: 'writeB64', path: file, dataB64: data.toString('base64') });
    expect(res).toEqual({ t: 'res', id, ok: true });
    expect(readFileSync(file)).toEqual(data);
  });

  it('writeB64 rejects a write under a read-only whitelist root (.cc-sessions)', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-sessions', 'evil.wrapper');
    const res = await client!.req<Res>(nextId(), { op: 'writeB64', path: file, dataB64: Buffer.from('x').toString('base64') });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('writeB64 rejects a write outside the whitelist entirely', async () => {
    await open();
    const file = path.join(fixture!.outside, 'evil.txt');
    const res = await client!.req<Res>(nextId(), { op: 'writeB64', path: file, dataB64: Buffer.from('x').toString('base64') });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('writeB64 replies with a failure response (not a crash) when mkdir hits a real fs error', async () => {
    await open();
    // Force ENOTDIR: `blocker` is a regular file, so mkdir-ing a directory
    // "under" it (a path-collision) fails at the fs layer, not the whitelist.
    const blocker = path.join(fixture!.home, '.cc-clips', 'blocker-file');
    writeFileSync(blocker, 'not a directory');
    const file = path.join(blocker, 'nested', 'clip.png');
    const res = await client!.req<Res>(nextId(), {
      op: 'writeB64',
      path: file,
      dataB64: Buffer.from('x').toString('base64'),
    });
    expect(res.ok).toBe(false);
    expect(typeof res.err).toBe('string');
    // The connection must still be alive afterwards — a crashed/dead agent
    // process would never answer this follow-up request.
    const other = path.join(fixture!.home, '.cc-clips', 'still-alive.txt');
    const res2 = await client!.req<Res>(nextId(), {
      op: 'writeB64',
      path: other,
      dataB64: Buffer.from('ok').toString('base64'),
    });
    expect(res2).toMatchObject({ ok: true });
  });
});

// ── run 3531: the byte-read identity, at the function the reply is built from ──
describe('readFromMeasured: the bounded read\'s identity comes from its own handle', () => {
  afterEach(() => { hooks.afterOpen = null; });
  /** A regular file with `content` in a fresh temp directory, and its real device and inode. */
  const fileWith = (content: string, name = 'f.txt'): { file: string; dev: bigint; ino: bigint } => {
    const dir = mkTmp('ccrc-ident-');
    const file = path.join(dir, name);
    writeFileSync(file, content);
    const st = statSync(file, { bigint: true });
    return { file, dev: st.dev, ino: st.ino };
  };

  it('usable facts (regular, inode not 0, 0 < birth < change): the digest of device, inode and birth time', async () => {
    const { file, dev, ino } = fileWith('0123456789');
    armFacts(file, { birth: 5n, change: 9n });
    expect(await readFromMeasured(file, 3, 4)).toEqual({
      ok: true, data: '3456', dataB64: Buffer.from('3456').toString('base64'), size: 10, ident: tokenOf(dev, ino, 5n),
    });
  });

  it.each([
    ['birth time 0 (none recorded)', { birth: 0n, change: 9n }],
    ['birth equal to change (a ctime fallback, or untouched since creation)', { birth: 7n, change: 7n }],
    ['birth after change', { birth: 9n, change: 5n }],
    ['inode 0', { birth: 5n, change: 9n, ino: 0n }],
    ['not a regular file on the handle', { birth: 5n, change: 9n, regular: false }],
    ['the bigint stat fails', { fail: true }],
  ] as const)('%s: the same bytes and size, and NO token (unmeasured, never a device and inode fallback)', async (_label, f) => {
    const { file } = fileWith('0123456789');
    armFacts(file, f);
    const r = await readFromMeasured(file, 3, 4);
    expect(r).toEqual({ ok: true, data: '3456', dataB64: Buffer.from('3456').toString('base64'), size: 10 });
    expect(r).not.toHaveProperty('ident');
  });

  it('EOF and an unbounded read carry no token, with usable facts', async () => {
    const { file } = fileWith('0123456789');
    armFacts(file, { birth: 5n, change: 9n });
    expect(await readFromMeasured(file, 10, 4)).toEqual({ ok: true, data: '', dataB64: '', size: 10 });
    expect(await readFromMeasured(file, 4)).toEqual({ ok: true, data: '456789', size: 10 });
  });

  it('a rename-over AFTER the open: the old bytes with the old file\'s token, then the new bytes with a new token', async () => {
    const { file, dev, ino } = fileWith('OLD-BYTES\n');
    const next = path.join(path.dirname(file), 'next.txt');
    writeFileSync(next, 'NEW-BYTES-LONGER\n');
    const nextIno = statSync(next, { bigint: true }).ino;
    let swaps = 0;
    hooks.afterOpen = (p, fh) => {
      withFacts(fh, { birth: 1n, change: 2n });
      if (p === file && swaps === 0) { swaps += 1; renameSync(next, file); }
    };
    const first = await readFromMeasured(file, 0, 9);
    expect(swaps, 'the swap ran after the open').toBe(1);
    expect(readFileSync(file, 'utf8'), 'the path now names the new file').toBe('NEW-BYTES-LONGER\n');
    expect(first).toEqual({ ok: true, data: 'OLD-BYTES', dataB64: Buffer.from('OLD-BYTES').toString('base64'), size: 10, ident: tokenOf(dev, ino, 1n) });
    const second = await readFromMeasured(file, 0, 9);
    expect(second).toEqual({ ok: true, data: 'NEW-BYTES', dataB64: Buffer.from('NEW-BYTES').toString('base64'), size: 17, ident: tokenOf(dev, nextIno, 1n) });
    expect(second.ok && first.ok && second.ident !== first.ident).toBe(true);
  });

  it('old failures are unchanged: missing is absent, a directory and a path through a file are unreadable', async () => {
    const { file } = fileWith('x');
    expect(await readFromMeasured(path.join(path.dirname(file), 'nope'), 0, 4)).toEqual({ ok: false, reason: 'absent' });
    expect(await readFromMeasured(path.dirname(file), 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
    expect(await readFromMeasured(path.join(file, 'child'), 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('readIdentOf: answers only on usable facts', () => {
  const stats = (f: { dev?: bigint; ino?: bigint; birth?: bigint; change?: bigint; regular?: boolean }): BigIntStats =>
    ({
      dev: f.dev ?? 7n, ino: f.ino ?? 11n, birthtimeNs: f.birth ?? 5n, ctimeNs: f.change ?? 9n,
      isFile: () => f.regular ?? true,
    }) as unknown as BigIntStats;

  it('usable: 64 lowercase hex, the documented digest, the same for the same facts', () => {
    expect(readIdentOf(stats({}))).toMatch(HEX64);
    expect(readIdentOf(stats({}))).toBe(tokenOf(7n, 11n, 5n));
    expect(readIdentOf(stats({}))).toBe(readIdentOf(stats({ change: 100n })));   // ctime gates, it is not in the token
  });

  it('differs when the device, the inode or the birth time differs', () => {
    const base = readIdentOf(stats({}));
    for (const f of [{ dev: 8n }, { ino: 12n }, { birth: 6n }]) expect(readIdentOf(stats(f))).not.toBe(base);
  });

  it.each([
    ['not a regular file', { regular: false }],
    ['inode 0', { ino: 0n }],
    ['birth 0', { birth: 0n }],
    ['birth equal to change', { birth: 9n, change: 9n }],
    ['birth after change', { birth: 10n, change: 9n }],
  ] as const)('%s: undefined', (_label, f) => {
    expect(readIdentOf(stats(f))).toBeUndefined();
  });
});
