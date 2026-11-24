// Older chat pages (desktop polish wave 171): what a backlog binds a page to, and one page read under that binding. Every
// fixture is synthetic. Identity tokens are set by a wrapper over the adapter, so the cases do not depend on a
// filesystem's birth time; the adapter matrix at the end runs the real local and remote adapters underneath it.
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localIO, type FleetIO, type MeasuredByteRangeRead } from '../src/io.js';
import { readBacklog, WITNESS_MAX_BYTES, type BacklogRead, type OlderBinding } from '../src/transcript/tail.js';
import { OLDER_PAGE_LIMITS, readOlderPage, type OlderPageLimits, type OlderPageRead } from '../src/transcript/olderPage.js';
import { OLDER_RANGE_LIMITS } from '../src/transcript/olderRange.js';
import { parseTranscriptLine } from '../src/transcript/parse.js';
import type { PageCursor } from '../src/transcript/continuation.js';
import type { ChatEvent } from '../../shared/api.js';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { createIo } from '../src/remote/io.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const enc = new TextEncoder();
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const userLine = (uuid: string, text: string): string =>
  `${JSON.stringify({ uuid, parentUuid: null, isSidechain: false, timestamp: '2026-11-24T10:00:00.000Z', type: 'user', message: { role: 'user', content: text } })}\n`;
/** One assistant record of `n` tool calls: `n` events. */
const multiLine = (uuid: string, n: number): string =>
  `${JSON.stringify({
    uuid, parentUuid: null, isSidechain: false, timestamp: '2026-11-24T10:00:00.000Z', type: 'assistant',
    message: { role: 'assistant', content: Array.from({ length: n }, (_, i) => ({ type: 'tool_use', id: `t${i}`, name: `${uuid} call ${i}`, input: {} })) },
  })}\n`;
const uuidsOf = (events: readonly ChatEvent[]): string[] => events.map((e) => ('uuid' in e ? `${e.uuid}` : '?'));

type Ident = string | undefined;
/** A FleetIO over one in-memory file, honouring the byte read's contract (exactly `min(maxBytes, size - offset)` bytes; an
 *  offset past the size is `unreadable`). `ident(n)` is the token read number `n` (1-based) carries; `state` may be swapped
 *  between reads to replace, truncate or remove the file. Every byte read is logged as [offset, maxBytes]. */
const memIO = (data: Uint8Array, ident: (n: number) => Ident = () => A) => {
  const state = { data: data as Uint8Array | null, unreadable: false };
  const reads: Array<[number, number]> = [];
  const io: FleetIO = {
    ...localIO,
    statMeasured: async () => (state.data === null
      ? { ok: false, reason: 'absent' } : { ok: true, size: state.data.length, mtimeMs: 1 }) as Awaited<ReturnType<FleetIO['statMeasured']>>,
    readFileFromBytesMeasured: async (_p, offset, maxBytes): Promise<MeasuredByteRangeRead> => {
      reads.push([offset, maxBytes]);
      if (state.data === null) return { ok: false, reason: 'absent' };
      if (state.unreadable || offset > state.data.length) return { ok: false, reason: 'unreadable' };
      const bytes = state.data.slice(offset, offset + maxBytes);
      const id = ident(reads.length);
      return bytes.length > 0 && id !== undefined ? { ok: true, bytes, size: state.data.length, ident: id } : { ok: true, bytes, size: state.data.length };
    },
  };
  return { io, state, reads };
};

const noMask = <T>(v: T): T => v;
const bindingOf = (b: BacklogRead): OlderBinding => {
  if (b.older === undefined) throw new Error('no binding');
  return b.older;
};
/** The first page's cursor and checks from a backlog's binding, checking identity against `ident`. */
const firstPage = (o: OlderBinding, ident = o.ident, mask = noMask) => ({
  cursor: { kind: 'line-start', before: o.anchor } as PageCursor,
  bind: {
    identOk: (x: string) => x === ident, witness: { at: o.anchor, len: o.witness.len },
    witnessOk: (h: string) => h === o.witness.sha256, mask,
  },
});
const okPage = (r: OlderPageRead): Extract<OlderPageRead, { ok: true }> => {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
};
const lim = (over: Partial<OlderPageLimits> & { records?: number; chunkBytes?: number; chunks?: number } = {}): OlderPageLimits => ({
  range: { chunkBytes: over.chunkBytes ?? OLDER_RANGE_LIMITS.chunkBytes, chunks: over.chunks ?? OLDER_RANGE_LIMITS.chunks, records: over.records ?? OLDER_RANGE_LIMITS.records },
  events: over.events ?? OLDER_PAGE_LIMITS.events,
  eventBytes: over.eventBytes ?? OLDER_PAGE_LIMITS.eventBytes,
});

describe('the backlog binds older pages only to what it measured', () => {
  it('a window whose every read carried one token: the anchor is the first record, the witness hashes the bytes there', async () => {
    const text = userLine('u1', 'one') + userLine('u2', 'two');
    const { io } = memIO(enc.encode(text));
    const b = await readBacklog(io, 'f', 50);
    expect(b.older).toEqual({
      ident: A, anchor: 0,
      witness: { len: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') },
    });
  });

  it('the anchor is the seam record\'s start, and the witness is bounded', async () => {
    const pad = userLine('pad', 'x'.repeat(WITNESS_MAX_BYTES));
    const head = userLine('u1', 'one');
    const text = head + multiLine('m1', 3) + pad + userLine('u2', 'two');
    const { io } = memIO(enc.encode(text));
    const b = await readBacklog(io, 'f', 4);
    expect(uuidsOf(b.events)).toEqual(['m1', 'm1', 'm1', 'pad', 'u2']);
    expect(b.older?.anchor).toBe(Buffer.byteLength(head));
    expect(b.older?.witness.len).toBe(WITNESS_MAX_BYTES);
  });

  it('the witness never reaches into an unterminated last line', async () => {
    const whole = userLine('u1', 'one');
    const { io } = memIO(enc.encode(whole + userLine('u2', 'two').trimEnd()));
    const b = await readBacklog(io, 'f', 50);
    expect(b.older?.witness.len).toBe(Buffer.byteLength(whole));
  });

  it('no binding when one read of the window carried no token (an older agent), though the backlog still answers', async () => {
    const text = Array.from({ length: 400 }, (_, i) => userLine(`u${i}`, 'y'.repeat(1500))).join('');
    expect(Buffer.byteLength(text)).toBeGreaterThan(512 * 1024);
    const { io, reads } = memIO(enc.encode(text), (n) => (n === 2 ? undefined : A));
    const b = await readBacklog(io, 'f', 50);
    expect(reads.length).toBeGreaterThan(1);
    expect(b.events).toHaveLength(50);
    expect(b.older).toBeUndefined();
  });

  it('reads of one window with different tokens are not one file: the window is read once more, and an agreeing re-read answers', async () => {
    const text = Array.from({ length: 400 }, (_, i) => userLine(`u${i}`, 'y'.repeat(1500))).join('');
    const { io, reads } = memIO(enc.encode(text), (n) => (n === 1 ? B : A));
    const b = await readBacklog(io, 'f', 50);
    expect(reads.length).toBe(6);
    expect(reads.slice(3)).toEqual(reads.slice(0, 3));
    expect(b.measured).toBe(true);
    expect(b.events).toHaveLength(50);
    expect(b.older?.ident).toBe(A);
  });

  it('different tokens on the window twice: the backlog is unmeasured, nothing of either read is shown, no binding', async () => {
    const text = Array.from({ length: 400 }, (_, i) => userLine(`u${i}`, 'y'.repeat(1500))).join('');
    const { io, reads } = memIO(enc.encode(text), (n) => (n % 2 === 1 ? A : B));
    const b = await readBacklog(io, 'f', 50);
    expect(reads.length).toBe(6);
    expect(b).toEqual({ events: [], offset: Buffer.byteLength(text), missing: false, measured: false, scanEnd: Buffer.byteLength(text) });
  });

  it('the tailer offset of a twice-split window comes from a stat after the split, never from the first file\'s stat', async () => {
    const text = Array.from({ length: 400 }, (_, i) => userLine(`u${i}`, 'y'.repeat(1500))).join('');
    const now = enc.encode(text + userLine('later', 'the file as it stands after the split'));
    let swap = (): void => {};
    const m = memIO(enc.encode(text), (n) => { if (n === 6) swap(); return n % 2 === 1 ? A : B; });
    swap = () => { m.state.data = now; };
    const b = await readBacklog(m.io, 'f', 50);
    expect(b).toEqual({ events: [], offset: now.length, missing: false, measured: false, scanEnd: now.length });
  });

  it('a window of four reads costs two sequential round trips, as main\'s one read did: the stat, then the reads together', async () => {
    const text = Array.from({ length: 700 }, (_, i) => userLine(`u${i}`, 'y'.repeat(1500))).join('');
    expect(Buffer.byteLength(text)).toBeGreaterThan(3 * 256 * 1024);
    const { io: base, reads } = memIO(enc.encode(text));
    /** Each call's depth is one more than the deepest call settled before it was issued; the backlog's cost is the deepest. */
    let settled = 0;
    let deepest = 0;
    const deep = <T>(p: () => Promise<T>): Promise<T> => {
      const depth = settled + 1;
      return p().then((v) => { settled = Math.max(settled, depth); deepest = Math.max(deepest, depth); return v; });
    };
    const io: FleetIO = {
      ...base,
      statMeasured: (...a) => deep(() => base.statMeasured(...a)),
      readFileFromBytesMeasured: (...a) => deep(() => base.readFileFromBytesMeasured(...a)),
    };
    const b = await readBacklog(io, 'f', 50);
    expect(reads.length).toBe(4);
    expect(b.older).toBeDefined();
    expect(deepest).toBe(2);
  });

  it('no binding when the window lies wholly inside one record: no record start was read', async () => {
    const text = userLine('u1', 'one') + userLine('big', 'z'.repeat(1100 * 1024)).trimEnd();
    const { io } = memIO(enc.encode(text));
    const b = await readBacklog(io, 'f', 50);
    expect(b.events).toEqual([]);
    expect(b.older).toBeUndefined();
  });

  it('no binding for an empty file, an absent one or an unreadable one', async () => {
    expect((await readBacklog(memIO(new Uint8Array(0)).io, 'f', 50)).older).toBeUndefined();
    const gone = memIO(enc.encode(userLine('u1', 'one')));
    gone.state.data = null;
    expect((await readBacklog(gone.io, 'f', 50)).older).toBeUndefined();
    const locked = memIO(enc.encode(userLine('u1', 'one')));
    locked.state.unreadable = true;
    expect((await readBacklog(locked.io, 'f', 50)).older).toBeUndefined();
  });
});

// Review 3643 F1: an agent from before the bounded byte read ignores `maxBytes` and answers decoded text only, which the
// remote adapter's byte reader reads as `unreadable`. The backlog then reads as main does, and offers no paging.
describe('an agent that answers decoded text only, through the real remote adapter', () => {
  /** The remote adapter over a fake agent link: `stat` answers the file's size; `readFrom` answers `{data, size}` from the
   *  byte offset, whatever `maxBytes` says, as an agent that predates the field does. `fail` makes every `readFrom` fail. */
  const oldAgent = (text: string, fail?: 'unreadable' | 'absent' | 'gone-before-decoded') => {
    const buf = Buffer.from(text);
    const asks: Array<{ op: string; maxBytes?: unknown }> = [];
    const request = async (req: { op: string; offset?: number; maxBytes?: unknown }): Promise<unknown> => {
      asks.push({ op: req.op, ...(req.maxBytes !== undefined ? { maxBytes: req.maxBytes } : {}) });
      if (req.op === 'stat') return { mtimeMs: 1, size: buf.length };
      if (req.op !== 'readFrom') throw new Error(`unexpected op ${req.op}`);
      if (fail === 'absent') return { data: null, absent: true };
      if (fail === 'gone-before-decoded' && req.maxBytes === undefined) return { data: null, absent: true };
      if (fail === 'unreadable') return { data: null };
      return { data: buf.subarray(req.offset ?? 0).toString('utf8'), size: buf.length };
    };
    return { io: createIo({ state: { agentOps: [] }, request } as never), asks };
  };
  /** Main's backlog over decoded text, for comparison: the last `n` events of the whole lines after the partial head. */
  const mainBacklog = (text: string, n: number): ChatEvent[] => {
    const buf = Buffer.from(text);
    const start = Math.max(0, buf.length - 4 * 256 * 1024);
    let t = buf.subarray(start).toString('utf8');
    if (start > 0) t = t.slice(t.indexOf('\n') + 1);
    return t.split('\n').filter((l) => l.trim() !== '').flatMap(parseTranscriptLine).slice(-n);
  };

  it('shows the chat main shows, measured, at the file\'s size, with no binding', async () => {
    const text = Array.from({ length: 900 }, (_, i) => userLine(`u${i}`, 'y'.repeat(1500))).join('');
    expect(Buffer.byteLength(text)).toBeGreaterThan(1024 * 1024);
    const { io, asks } = oldAgent(text);
    const b = await readBacklog(io, 'f', 50);
    expect(b.events).toEqual(mainBacklog(text, 50));
    expect(b).toMatchObject({ offset: Buffer.byteLength(text), missing: false, measured: true, scanEnd: Buffer.byteLength(text) - 4 * 256 * 1024 });
    expect(b.older).toBeUndefined();
    expect(asks.filter((a) => a.op === 'readFrom' && a.maxBytes === undefined)).toHaveLength(1);
  });

  it('a small file too: the same events main shows', async () => {
    const text = userLine('u1', 'one') + userLine('u2', 'two');
    const b = await readBacklog(oldAgent(text).io, 'f', 50);
    expect(uuidsOf(b.events)).toEqual(['u1', 'u2']);
    expect(b).toMatchObject({ offset: Buffer.byteLength(text), measured: true, missing: false });
    expect(b.older).toBeUndefined();
  });

  it('a file that is really unreadable stays unreadable, not folded into the fallback; a proven absence stays absent', async () => {
    const text = userLine('u1', 'one');
    expect(await readBacklog(oldAgent(text, 'unreadable').io, 'f', 50)).toEqual({
      events: [], offset: Buffer.byteLength(text), missing: false, measured: false, scanEnd: Buffer.byteLength(text),
    });
    const gone = oldAgent(text, 'absent');
    expect(await readBacklog(gone.io, 'f', 50)).toEqual({ events: [], offset: Buffer.byteLength(text), missing: true, measured: true });
    expect(gone.asks.filter((a) => a.op === 'readFrom' && a.maxBytes === undefined)).toEqual([]);
  });

  it('a file unlinked between the byte reads and main\'s read is a proven absence', async () => {
    const text = userLine('u1', 'one');
    expect(await readBacklog(oldAgent(text, 'gone-before-decoded').io, 'f', 50)).toEqual({
      events: [], offset: Buffer.byteLength(text), missing: true, measured: true,
    });
  });
});

describe('one older page', () => {
  /** 120 one-event records, then the backlog's 50. */
  const transcript = Array.from({ length: 170 }, (_, i) => userLine(`u${i}`, `message ${i}`)).join('');
  const backlogOf = async (text = transcript) => readBacklog(memIO(enc.encode(text)).io, 'f', 50);

  it('answers the records before the anchor, oldest first, as the parser the backlog uses gives them', async () => {
    const b = await backlogOf();
    const { cursor, bind } = firstPage(bindingOf(b));
    const page = okPage(await readOlderPage(memIO(enc.encode(transcript)).io, 'f', cursor, bind));
    expect(uuidsOf(page.events)).toEqual(Array.from({ length: 50 }, (_, i) => `u${70 + i}`));
    expect(page.events).toEqual(transcript.split('\n').slice(70, 120).flatMap(parseTranscriptLine));
    expect(page).toMatchObject({ gap: false, next: { kind: 'more', cursor: { kind: 'line-start' } } });
  });

  it('reads the witness first, once, at the anchor', async () => {
    const b = bindingOf(await backlogOf());
    const m = memIO(enc.encode(transcript));
    const { cursor, bind } = firstPage(b);
    await readOlderPage(m.io, 'f', cursor, bind);
    expect(m.reads[0]).toEqual([b.anchor, b.witness.len]);
    expect(m.reads.filter(([o]) => o === b.anchor)).toHaveLength(1);
  });

  it('decides nothing about the witness itself: it asks the binding\'s check once, with the hash of the bytes it re-read', async () => {
    const b = bindingOf(await backlogOf());
    const { cursor, bind } = firstPage(b);
    const asked: string[] = [];
    const no = { ...bind, witnessOk: (h: string) => { asked.push(h); return false; } };
    const m = memIO(enc.encode(transcript));
    expect(await readOlderPage(m.io, 'f', cursor, no)).toEqual({ ok: false, reason: 'changed' });
    expect(asked).toEqual([b.witness.sha256]);
    expect(m.reads).toHaveLength(1);
  });

  it('reaches the start of the file: `start`, never an empty page standing for the end', async () => {
    const short = userLine('u1', 'one') + userLine('u2', 'two') + Array.from({ length: 50 }, (_, i) => userLine(`b${i}`, 'b')).join('');
    const b = bindingOf(await backlogOf(short));
    const { cursor, bind } = firstPage(b);
    const page = okPage(await readOlderPage(memIO(enc.encode(short)).io, 'f', cursor, bind));
    expect(uuidsOf(page.events)).toEqual(['u1', 'u2']);
    expect(page.next).toEqual({ kind: 'start' });
  });

  it('a backlog anchored at offset 0 has nothing before it: the first page is `start` with no event', async () => {
    const b = bindingOf(await backlogOf(userLine('u1', 'one')));
    expect(b.anchor).toBe(0);
    const { cursor, bind } = firstPage(b);
    expect(okPage(await readOlderPage(memIO(enc.encode(userLine('u1', 'one'))).io, 'f', cursor, bind)))
      .toEqual({ ok: true, events: [], gap: false, next: { kind: 'start' } });
  });
});

describe('a page served only while the file is the one it was issued for', () => {
  const transcript = Array.from({ length: 120 }, (_, i) => userLine(`u${i}`, `message ${i}`)).join('');
  const setup = async () => {
    const b = bindingOf(await readBacklog(memIO(enc.encode(transcript)).io, 'f', 50));
    return { b, ...firstPage(b) };
  };

  it('the witness bytes changed (same identity): `changed`, and no framing read is made', async () => {
    const { b, cursor, bind } = await setup();
    const altered = enc.encode(transcript);
    altered[b.anchor + 3] = altered[b.anchor + 3]! ^ 1;
    const m = memIO(altered);
    expect(await readOlderPage(m.io, 'f', cursor, bind)).toEqual({ ok: false, reason: 'changed' });
    expect(m.reads).toHaveLength(1);
  });

  it('truncated then regrown with other bytes (the same inode, so the same identity): `changed`', async () => {
    const { cursor, bind } = await setup();
    const regrown = transcript.slice(0, 200) + 'Z'.repeat(transcript.length - 200);
    expect(await readOlderPage(memIO(enc.encode(regrown)).io, 'f', cursor, bind)).toEqual({ ok: false, reason: 'changed' });
  });

  it('truncated below the witness: the adapter\'s `unreadable` passes through, never a page', async () => {
    const { b, cursor, bind } = await setup();
    expect(await readOlderPage(memIO(enc.encode(transcript.slice(0, b.anchor - 10))).io, 'f', cursor, bind))
      .toEqual({ ok: false, reason: 'unreadable' });
  });

  it('truncated inside the witness: a short witness read is `changed`', async () => {
    const { b, cursor, bind } = await setup();
    expect(await readOlderPage(memIO(enc.encode(transcript.slice(0, b.anchor + 5))).io, 'f', cursor, bind))
      .toEqual({ ok: false, reason: 'changed' });
  });

  it('replaced by a file of the same size and the same bytes but another identity: `changed`', async () => {
    const { cursor, bind } = await setup();
    expect(await readOlderPage(memIO(enc.encode(transcript), () => B).io, 'f', cursor, bind)).toEqual({ ok: false, reason: 'changed' });
  });

  it('the byte before the cursor rewritten under the same identity (the framing\'s boundary refusal): `changed`', async () => {
    const { b, cursor, bind } = await setup();
    const altered = enc.encode(transcript);
    altered[b.anchor - 1] = 0x58;
    expect(await readOlderPage(memIO(altered).io, 'f', cursor, bind)).toEqual({ ok: false, reason: 'changed' });
  });

  it('a framing read that succeeds short (a file cut before its path stat): `changed`, never a short page', async () => {
    const { cursor, bind } = await setup();
    const m = memIO(enc.encode(transcript));
    const short: FleetIO = { ...m.io, readFileFromBytesMeasured: async (p, o, n, ...rest) => {
      const r = await m.io.readFileFromBytesMeasured(p, o, n, ...rest);
      return r.ok && m.reads.length === 2 ? { ...r, bytes: r.bytes.slice(1) } : r;
    } };
    expect(await readOlderPage(short, 'f', cursor, bind)).toEqual({ ok: false, reason: 'changed' });
  });

  it('a witness read with no identity token: `unmeasured`', async () => {
    const { cursor, bind } = await setup();
    expect(await readOlderPage(memIO(enc.encode(transcript), () => undefined).io, 'f', cursor, bind))
      .toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a later framing read with no token: `unmeasured`; with another token: `changed`; nothing of the page survives', async () => {
    const { cursor, bind } = await setup();
    expect(await readOlderPage(memIO(enc.encode(transcript), (n) => (n === 2 ? undefined : A)).io, 'f', cursor, bind))
      .toEqual({ ok: false, reason: 'unmeasured' });
    expect(await readOlderPage(memIO(enc.encode(transcript), (n) => (n === 2 ? B : A)).io, 'f', cursor, bind))
      .toEqual({ ok: false, reason: 'changed' });
    // A later read (the walker's second) refused too, after a first that framed records.
    const small = lim({ chunkBytes: 1024 });
    expect(await readOlderPage(memIO(enc.encode(transcript), (n) => (n === 3 ? B : A)).io, 'f', cursor, bind, small))
      .toEqual({ ok: false, reason: 'changed' });
  });

  it('absent and unreadable are the reads\' own words', async () => {
    const { cursor, bind } = await setup();
    const gone = memIO(enc.encode(transcript));
    gone.state.data = null;
    expect(await readOlderPage(gone.io, 'f', cursor, bind)).toEqual({ ok: false, reason: 'absent' });
    const locked = memIO(enc.encode(transcript));
    locked.state.unreadable = true;
    expect(await readOlderPage(locked.io, 'f', cursor, bind)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('replay of the same continuation over an unchanged (or only appended) file answers the same page', async () => {
    const { cursor, bind } = await setup();
    const once = await readOlderPage(memIO(enc.encode(transcript)).io, 'f', cursor, bind);
    const again = await readOlderPage(memIO(enc.encode(transcript + userLine('later', 'appended'))).io, 'f', cursor, bind);
    expect(again).toEqual(once);
  });
});

describe('each cap alone cuts a page at a record start', () => {
  /** 60 records of 3 events each before a 50-event backlog. */
  const transcript = Array.from({ length: 60 }, (_, i) => multiLine(`m${i}`, 3)).join('')
    + Array.from({ length: 50 }, (_, i) => userLine(`b${i}`, 'b')).join('');
  const recordStart = (i: number): number => Buffer.byteLength(Array.from({ length: i }, (_, k) => multiLine(`m${k}`, 3)).join(''));
  const page = async (limits: OlderPageLimits) => {
    const b = bindingOf(await readBacklog(memIO(enc.encode(transcript)).io, 'f', 50));
    const { cursor, bind } = firstPage(b);
    return okPage(await readOlderPage(memIO(enc.encode(transcript)).io, 'f', cursor, bind, limits));
  };
  const recordsOf = (events: readonly ChatEvent[]): string[] => [...new Set(uuidsOf(events))];

  it('the framing\'s record cap (50) alone', async () => {
    const p = await page(lim());
    expect(recordsOf(p.events)).toEqual(Array.from({ length: 50 }, (_, i) => `m${10 + i}`));
    expect(p.next).toEqual({ kind: 'more', cursor: { kind: 'line-start', before: recordStart(10) } });
  });

  it('the framing\'s scanned bytes alone (fewer bytes a read)', async () => {
    const p = await page(lim({ chunkBytes: 1024, chunks: 2 }));
    const kept = recordsOf(p.events);
    expect(kept.length).toBeLessThan(50);
    expect(kept.at(-1)).toBe('m59');
    expect(p.next).toEqual({ kind: 'more', cursor: { kind: 'line-start', before: recordStart(60 - kept.length) } });
  });

  it('the event cap alone: whole records only, the cursor at the oldest kept', async () => {
    const p = await page(lim({ events: 10 }));
    expect(recordsOf(p.events)).toEqual(['m57', 'm58', 'm59']);
    expect(p.events).toHaveLength(9);
    expect(p.next).toEqual({ kind: 'more', cursor: { kind: 'line-start', before: recordStart(57) } });
  });

  it('the serialized-bytes cap alone: whole records only, and the cap holds on the events\' JSON', async () => {
    const one = Buffer.byteLength(JSON.stringify(parseTranscriptLine(multiLine('m59', 3).trimEnd())));
    const p = await page(lim({ eventBytes: 3 * one + 50 }));
    expect(recordsOf(p.events)).toEqual(['m57', 'm58', 'm59']);
    expect(Buffer.byteLength(JSON.stringify(p.events))).toBeLessThanOrEqual(3 * one + 50);
    expect(p.next).toEqual({ kind: 'more', cursor: { kind: 'line-start', before: recordStart(57) } });
  });

  it('the byte cap is measured after the stream\'s masker, so it holds on what is sent', async () => {
    const one = Buffer.byteLength(JSON.stringify(parseTranscriptLine(multiLine('m59', 3).trimEnd())));
    const b = bindingOf(await readBacklog(memIO(enc.encode(transcript)).io, 'f', 50));
    const grow = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/call/g, 'call-made-longer')) as T;
    const { cursor, bind } = firstPage(b, b.ident, grow);
    const p = okPage(await readOlderPage(memIO(enc.encode(transcript)).io, 'f', cursor, bind, lim({ eventBytes: 3 * one + 50 })));
    expect(recordsOf(p.events).length).toBeLessThan(3);
    expect(Buffer.byteLength(JSON.stringify(p.events))).toBeLessThanOrEqual(3 * one + 50);
  });

  it('a record whose events alone exceed a cap is a gap, skipped whole, and the next page goes on before it', async () => {
    const text = userLine('old', 'old') + multiLine('huge', 12) + Array.from({ length: 50 }, (_, i) => userLine(`b${i}`, 'b')).join('');
    const b = bindingOf(await readBacklog(memIO(enc.encode(text)).io, 'f', 50));
    const { cursor, bind } = firstPage(b);
    const first = okPage(await readOlderPage(memIO(enc.encode(text)).io, 'f', cursor, bind, lim({ events: 10 })));
    const hugeAt = Buffer.byteLength(userLine('old', 'old'));
    expect(first).toEqual({ ok: true, events: [], gap: true, next: { kind: 'more', cursor: { kind: 'line-start', before: hugeAt } } });
    const second = okPage(await readOlderPage(memIO(enc.encode(text)).io, 'f', { kind: 'line-start', before: hugeAt }, bind, lim({ events: 10 })));
    expect(uuidsOf(second.events)).toEqual(['old']);
    expect(second.next).toEqual({ kind: 'start' });
  });

  it('an overlong record behind kept records ends the page before it; the next page marks it a gap', async () => {
    const text = multiLine('huge', 12) + userLine('n1', 'n') + Array.from({ length: 50 }, (_, i) => userLine(`b${i}`, 'b')).join('');
    const b = bindingOf(await readBacklog(memIO(enc.encode(text)).io, 'f', 50));
    const { cursor, bind } = firstPage(b);
    const first = okPage(await readOlderPage(memIO(enc.encode(text)).io, 'f', cursor, bind, lim({ events: 10 })));
    const n1At = Buffer.byteLength(multiLine('huge', 12));
    expect(first).toEqual({ ok: true, events: parseTranscriptLine(userLine('n1', 'n').trimEnd()), gap: false, next: { kind: 'more', cursor: { kind: 'line-start', before: n1At } } });
    const second = okPage(await readOlderPage(memIO(enc.encode(text)).io, 'f', { kind: 'line-start', before: n1At }, bind, lim({ events: 10 })));
    expect(second).toEqual({ ok: true, events: [], gap: true, next: { kind: 'start' } });
  });

  it('a record too long to frame is the framing\'s gap: no part of it is parsed', async () => {
    const big = userLine('big', '{"type":"user","uuid":"fake","message":{"content":"inner"}}'.repeat(80));
    const text = userLine('old', 'old') + big + Array.from({ length: 50 }, (_, i) => userLine(`b${i}`, 'b')).join('');
    const b = bindingOf(await readBacklog(memIO(enc.encode(text)).io, 'f', 50));
    const { cursor, bind } = firstPage(b);
    const tiny = lim({ chunkBytes: 1024, chunks: 1 });
    const first = okPage(await readOlderPage(memIO(enc.encode(text)).io, 'f', cursor, bind, tiny));
    expect(first.events).toEqual([]);
    expect(first.gap).toBe(true);
    // Walk on until the start: the only events are 'old', never a fragment of the big record.
    let c = first.next;
    const seen: ChatEvent[] = [];
    for (let i = 0; i < 20 && c.kind === 'more'; i += 1) {
      const p = okPage(await readOlderPage(memIO(enc.encode(text)).io, 'f', c.cursor, bind, tiny));
      seen.push(...p.events);
      c = p.next;
    }
    expect(c).toEqual({ kind: 'start' });
    expect(uuidsOf(seen)).toEqual(['old']);
  });

  it('a cap above production is refused before any read', async () => {
    const b = bindingOf(await readBacklog(memIO(enc.encode(transcript)).io, 'f', 50));
    const { cursor, bind } = firstPage(b);
    const m = memIO(enc.encode(transcript));
    expect(await readOlderPage(m.io, 'f', cursor, bind, lim({ events: OLDER_PAGE_LIMITS.events + 1 })))
      .toEqual({ ok: false, reason: 'unmeasured' });
    expect(m.reads).toEqual([]);
  });
});

describe('a long synthetic transcript, paged to its start', () => {
  it('yields every record once, in order, with no overlap against the backlog (and is measured)', async () => {
    // About 6 MiB: varied record sizes, multi-event records, blank lines, multibyte text, a few records longer than a read.
    const lines: string[] = [];
    for (let i = 0; i < 6000; i += 1) {
      if (i % 997 === 0) lines.push(userLine(`L${i}`, 'w'.repeat(300 * 1024)));
      else if (i % 7 === 0) lines.push(multiLine(`M${i}`, 1 + (i % 5)));
      else if (i % 101 === 0) lines.push('\n');
      else lines.push(userLine(`U${i}`, `${'é漢\u{1F600}'.repeat(i % 50)} ${'t'.repeat((i * 37) % 2000)}`));
    }
    const text = lines.join('');
    const data = enc.encode(text);
    const backlog = await readBacklog(memIO(data).io, 'f', 50);
    const b = bindingOf(backlog);
    let { cursor } = firstPage(b);
    const { bind } = firstPage(b);
    const pages: ChatEvent[][] = [];
    let gaps = 0;
    let largest = 0;
    const t0 = performance.now();
    for (;;) {
      const p = okPage(await readOlderPage(memIO(data).io, 'f', cursor, bind));
      pages.push(p.events);
      if (p.gap) gaps += 1;
      largest = Math.max(largest, Buffer.byteLength(JSON.stringify(p.events)));
      if (p.next.kind === 'start') break;
      expect(p.next.cursor.before).toBeLessThan(cursor.before);
      cursor = p.next.cursor;
      expect(pages.length).toBeLessThan(2000);
    }
    const ms = performance.now() - t0;
    const older = pages.reverse().flat();
    const expected = lines.flatMap((l) => (l.trim() === '' ? [] : parseTranscriptLine(l.trimEnd())));
    expect([...older, ...backlog.events]).toEqual(expected);
    expect(older.length + backlog.events.length).toBe(expected.length);
    expect(gaps).toBe(0);
    console.warn(`older-page measure: ${(data.length / 1048576).toFixed(1)} MiB, ${expected.length} events, ${pages.length} pages to the start in ${ms.toFixed(0)} ms (in-memory reads), largest page ${largest} bytes of events`);
  });
});

// The end words through the real adapters: the local one over this box's files, the remote one over a real agent on a
// loopback socket. Identity is set by a wrapper over each, so the cases hold on a filesystem with no usable birth time.
describe.each(['local', 'remote'] as const)('every page end word through the %s adapter', (kind) => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;
  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  /** The adapter, a file under its home, and a switch for the identity its reads carry. */
  const adapter = async (): Promise<{ io: FleetIO; file: string; token: { now: Ident } }> => {
    let base: FleetIO;
    let dir: string;
    if (kind === 'local') {
      base = localIO;
      dir = mkTmp('ccrc-older-local-');
    } else {
      fixture = makeFixture();
      agent = await bootAgent(fixture);
      fleet = connectToAgent(agent.port);
      await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
      base = fleet.io;
      dir = path.join(fixture.home, '.claude', 'projects', '-p');
      mkdirSync(dir, { recursive: true });
    }
    const token = { now: A as Ident };
    const io: FleetIO = Object.create(base, {
      readFileFromBytesMeasured: {
        value: async (...args: Parameters<FleetIO['readFileFromBytesMeasured']>) => {
          const r = await base.readFileFromBytesMeasured(...args);
          if (!r.ok) return r;
          const { ident: _real, ...rest } = r;
          return rest.bytes.length > 0 && token.now !== undefined ? { ...rest, ident: token.now } : rest;
        },
      },
    });
    return { io, file: path.join(dir, 'transcript.jsonl'), token };
  };

  const text = Array.from({ length: 80 }, (_, i) => userLine(`u${i}`, `message ${i}`)).join('');

  it('more, start, changed, absent, unreadable and unmeasured are each reachable, and distinct', async () => {
    const { io, file, token } = await adapter();
    writeFileSync(file, text);
    const b = bindingOf(await readBacklog(io, file, 50));
    const { cursor, bind } = firstPage(b);
    const words: string[] = [];
    const word = (r: OlderPageRead): string => (r.ok ? r.next.kind : r.reason);

    words.push(word(await readOlderPage(io, file, cursor, bind, lim({ records: 10 }))));   // more
    words.push(word(await readOlderPage(io, file, cursor, bind)));                         // start
    token.now = B;
    words.push(word(await readOlderPage(io, file, cursor, bind)));                         // changed
    token.now = undefined;
    words.push(word(await readOlderPage(io, file, cursor, bind)));                         // unmeasured
    token.now = A;
    rmSync(file);
    mkdirSync(file);
    words.push(word(await readOlderPage(io, file, cursor, bind)));                         // unreadable (a directory now)
    rmSync(file, { recursive: true });
    words.push(word(await readOlderPage(io, file, cursor, bind)));                         // absent
    expect(words).toEqual(['more', 'start', 'changed', 'unmeasured', 'unreadable', 'absent']);
    expect(new Set(words).size).toBe(words.length);
  });

  it('the witness re-read catches bytes rewritten at the anchor through the real adapter', async () => {
    const { io, file } = await adapter();
    writeFileSync(file, text);
    const b = bindingOf(await readBacklog(io, file, 50));
    const { cursor, bind } = firstPage(b);
    writeFileSync(file, text.replace('message 30', 'massage 30'));
    expect(await readOlderPage(io, file, cursor, bind)).toEqual({ ok: false, reason: 'changed' });
    unlinkSync(file);
  });
});
