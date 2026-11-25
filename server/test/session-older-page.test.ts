// The session stream serves older chat pages (desktop polish wave 171): the backlog's continuation, the `older-page`
// request and its one reply shape, and the stream's lifecycle around a page. Fixture homes only; identity tokens are set
// by a wrapper over the local adapter, so the cases do not depend on a filesystem's birth time.
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_TICK, SessionStream } from '../src/sessionws.js';
import { asSessionClientMsg, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { parseTranscriptLine } from '../src/transcript/parse.js';
import { CONTINUATION_MAX_CHARS, PROCESS_CONTINUATION_KEY } from '../src/transcript/continuation.js';
import { OLDER_PAGE_LIMITS } from '../src/transcript/olderPage.js';
import { servingOf } from '../src/transcript/olderPageGate.js';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api.js';
import { OLDER_PAGE_ENDS, type OlderPageAnswer } from '../../shared/olderPage.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

const ID = 'claude-a-project-f';
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const WORKDIR = '/data/projects/project-f';
const MUNGED = '-data-projects-project-f';
const PID = 40613;
const TOKEN_A = '1'.repeat(64);
const TOKEN_B = '2'.repeat(64);

const userLine = (uuid: string, text: string): string =>
  `${JSON.stringify({ uuid, parentUuid: null, isSidechain: false, timestamp: '2026-11-24T10:00:00.000Z', type: 'user', message: { role: 'user', content: text } })}\n`;
const transcriptOf = (n: number, prefix = 'u'): string => Array.from({ length: n }, (_, i) => userLine(`${prefix}${i}`, `message ${i}`)).join('');

/** Registry entry, live state and transcript A, `sessionws.test.ts`'s fixture shape. */
const seed = (home: string, transcript: string): { fileA: string; fileB: string } => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: 'project-f', workdir: WORKDIR, uuid: UUID_A, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const sess = path.join(home, '.claude-a', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
  }));
  const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
  mkdirSync(tdir, { recursive: true });
  const fileA = path.join(tdir, `${UUID_A}.jsonl`);
  writeFileSync(fileA, transcript);
  return { fileA, fileB: path.join(tdir, `${UUID_B}.jsonl`) };
};

/** The local adapter whose bounded reads carry `tokens.of(path)` (undefined: none), plus a log of every byte read and
 *  holds: `holdAt(file, offset)` parks the next read of that file at that offset until its `release()`. */
const identIO = () => {
  const tokens = { of: (_p: string): string | undefined => TOKEN_A };
  const reads: Array<{ file: string; offset: number }> = [];
  const holds: Array<{ file: string | null; offset: number; reached: () => void; gate: Promise<void> }> = [];
  const io: FleetIO = Object.create(localIO, {
    readFileFromBytesMeasured: {
      value: async (...args: Parameters<FleetIO['readFileFromBytesMeasured']>) => {
        const [p, offset] = args;
        reads.push({ file: p, offset });
        const i = holds.findIndex((h) => h.offset === offset && (h.file === null || h.file === p));
        if (i >= 0) {
          const [h] = holds.splice(i, 1);
          h!.reached();
          await h!.gate;
        }
        const r = await localIO.readFileFromBytesMeasured(...args);
        if (!r.ok) return r;
        const { ident: _real, ...rest } = r;
        const t = tokens.of(p);
        return rest.bytes.length > 0 && t !== undefined ? { ...rest, ident: t } : rest;
      },
    },
  });
  /** Hold the next read of `file` (null: any file) at `offset`: `reached` resolves once it waits, `release` lets it go. */
  const holdAt = (offset: number, file: string | null = null): { reached: Promise<void>; release: () => void } => {
    let release = (): void => {};
    let reached = (): void => {};
    const gate = new Promise<void>((r) => { release = r; });
    const reachedP = new Promise<void>((r) => { reached = r; });
    holds.push({ file, offset, reached, gate });
    return { reached: reachedP, release };
  };
  return { io, tokens, reads, holdAt };
};

const depsFor = (home: string, io: FleetIO): Deps => {
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  return { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue(), time: fakeTime().ports };
};

const pollOnce = async (s: SessionStream): Promise<void> => {
  await (s as unknown as { tick: () => Promise<void> }).tick();
};

const streams: SessionStream[] = [];
afterEach(() => { for (const s of streams.splice(0)) s.stop(); });

/** A started stream over a fresh fixture home, and every frame it sent. */
const open = async (transcript: string, opts: { since?: { uuid: string; offset: number; file: string }; seedFiles?: { fileA: string } } = {}) => {
  const home = mkTmp('ccrc-older-stream-');
  seedRoster(home);
  const files = seed(home, transcript);
  const ident = identIO();
  const frames: SessionStreamMsg[] = [];
  const stream = new SessionStream(depsFor(home, ident.io), new Bus(), ID, (m) => frames.push(m), opts.since, NO_TICK);
  streams.push(stream);
  await stream.start();
  return { home, ...files, ...ident, frames, stream };
};

type Backlog = Extract<SessionStreamMsg, { type: 'backlog' }>;
const backlogs = (frames: SessionStreamMsg[]): Backlog[] => frames.filter((f): f is Backlog => f.type === 'backlog');
const answers = (frames: SessionStreamMsg[]): OlderPageAnswer[] => frames.filter((f): f is OlderPageAnswer => f.type === 'older-page');
const uuidsOf = (events: readonly ChatEvent[]): string[] => events.map((e) => ('uuid' in e ? `${e.uuid}` : '?'));

/** Ask for a page and wait for the stream's answer (or for `ms` to pass with none). */
const ask = async (s: { stream: SessionStream; frames: SessionStreamMsg[] }, continuation: string, ms = 2000): Promise<OlderPageAnswer | null> => {
  const before = answers(s.frames).length;
  s.stream.olderPage(continuation);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const all = answers(s.frames);
    if (all.length > before) return all[before]!;
    await new Promise((r) => setTimeout(r, 5));
  }
  return null;
};

describe('the backlog offers older pages only when paging can be offered', () => {
  it('a measured file with an identity on every read: the backlog carries an opaque continuation', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    expect(b!.older).toMatch(/^c1\.[0-9a-f]{16}\.[0-9a-f]+\.[0-9a-f]{64}$/);
    expect(b!.older!).not.toContain(TOKEN_A);
    expect(b!.older!.length).toBeLessThanOrEqual(CONTINUATION_MAX_CHARS);
  });

  it('an agent that sends no identity token: no continuation, and the backlog is otherwise the same frame', async () => {
    const home = mkTmp('ccrc-older-stream-');
    seedRoster(home);
    seed(home, transcriptOf(120));
    const plain = identIO();
    plain.tokens.of = () => undefined;
    const frames: SessionStreamMsg[] = [];
    const stream = new SessionStream(depsFor(home, plain.io), new Bus(), ID, (m) => frames.push(m), undefined, NO_TICK);
    streams.push(stream);
    await stream.start();
    const s = await open(transcriptOf(120));
    const [without] = backlogs(frames);
    const [withIt] = backlogs(s.frames);
    expect(without).not.toHaveProperty('older');
    const { older: _o, file: _f1, ...rest } = withIt!;
    const { file: _f2, ...restWithout } = without!;
    expect(restWithout).toEqual(rest);
  });

  it('reads of one window under two tokens, twice (review 3643 F2): the client is sent an unmeasured backlog, never a splice', async () => {
    const home = mkTmp('ccrc-older-stream-');
    seedRoster(home);
    const transcript = transcriptOf(2200);
    expect(Buffer.byteLength(transcript)).toBeGreaterThan(256 * 1024);
    const { fileA } = seed(home, transcript);
    const split = identIO();
    let n = 0;
    split.tokens.of = () => ((n += 1) % 2 === 1 ? TOKEN_A : TOKEN_B);
    const frames: SessionStreamMsg[] = [];
    const stream = new SessionStream(depsFor(home, split.io), new Bus(), ID, (m) => frames.push(m), undefined, NO_TICK);
    streams.push(stream);
    await stream.start();
    const [b] = backlogs(frames);
    const size = Buffer.byteLength(transcript);
    expect(b).toEqual({
      type: 'backlog', uuid: UUID_A, events: [], offset: size, file: fileA, missing: false, fileMeasured: false,
      foreignAccount: null, searchComplete: true,
    });
  });

  it('a client that never asks gets nothing else: no `older-page` frame is ever sent unasked', async () => {
    const s = await open(transcriptOf(120));
    appendFileSync(s.fileA, userLine('later', 'appended'));
    await new Promise((r) => setTimeout(r, 300));
    expect(answers(s.frames)).toEqual([]);
  });
});

describe('an older page over the stream', () => {
  it('answers the records before the backlog, oldest first, equal to the rows the live parser gives', async () => {
    const text = transcriptOf(120);
    const s = await open(text);
    const [b] = backlogs(s.frames);
    expect(uuidsOf(b!.events)).toEqual(Array.from({ length: 50 }, (_, i) => `u${70 + i}`));
    const first = await ask(s, b!.older!);
    expect(first).toMatchObject({ type: 'older-page', end: 'more', gap: false });
    expect(first!.events).toEqual(text.split('\n').slice(20, 70).flatMap(parseTranscriptLine));
    const second = await ask(s, first!.continuation!);
    expect(second).toMatchObject({ end: 'start', gap: false });
    expect(second).not.toHaveProperty('continuation');
    expect(uuidsOf(second!.events)).toEqual(Array.from({ length: 20 }, (_, i) => `u${i}`));
  });

  it('replay of an old valid continuation answers the same page', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const once = await ask(s, b!.older!);
    appendFileSync(s.fileA, userLine('later', 'appended'));
    const again = await ask(s, b!.older!);
    expect(again!.events).toEqual(once!.events);
    expect(again!.end).toBe(once!.end);
  });

  it('a second request while one is in flight is answered `busy` and makes no read', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const anchor = parseAnchor(s.reads, s.fileA);
    const held = s.holdAt(anchor);
    s.stream.olderPage(b!.older!);
    await held.reached;
    const readsBefore = s.reads.length;
    s.stream.olderPage(b!.older!);
    expect(answers(s.frames)).toEqual([{ type: 'older-page', events: [], gap: false, end: 'busy', for: b!.older! }]);
    expect(s.reads.length).toBe(readsBefore);
    held.release();
    await expectAnswerCount(s.frames, 2);
    expect(answers(s.frames)[1]!.end).toBe('more');
  });

  it('a late page after a rotation is never sent, and the old continuation then reads `changed`', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const anchor = parseAnchor(s.reads, s.fileA);
    const held = s.holdAt(anchor);
    s.stream.olderPage(b!.older!);
    await held.reached;
    writeFileSync(s.fileB, transcriptOf(5, 'r'));
    writeFileSync(path.join(s.home, '.cc-sessions', `${ID}.uuid`), UUID_B);
    await pollOnce(s.stream);
    expect(s.frames.some((f) => f.type === 'rotated')).toBe(true);
    expect(backlogs(s.frames)).toHaveLength(2);
    held.release();
    await new Promise((r) => setTimeout(r, 200));
    expect(answers(s.frames)).toEqual([]);
    // The previous file's continuation, on the stream that now serves the new file.
    const stale = await ask(s, b!.older!);
    expect(stale).toEqual({ type: 'older-page', events: [], gap: false, end: 'changed', for: b!.older! });
  });

  it('a page that ends while a new backlog is being read is dropped too: what the stream serves is already moving', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const page = s.holdAt(parseAnchor(s.reads, s.fileA));
    s.stream.olderPage(b!.older!);
    await page.reached;
    writeFileSync(s.fileB, transcriptOf(5, 'r'));
    writeFileSync(path.join(s.home, '.cc-sessions', `${ID}.uuid`), UUID_B);
    const backlogRead = s.holdAt(0, s.fileB);
    const ticking = pollOnce(s.stream);
    await backlogRead.reached;          // the new backlog's first read waits: no tailer has been opened yet
    page.release();
    await new Promise((r) => setTimeout(r, 200));
    expect(answers(s.frames)).toEqual([]);
    backlogRead.release();
    await ticking;
    expect(backlogs(s.frames)).toHaveLength(2);
    expect(answers(s.frames)).toEqual([]);
  });

  it('a file replaced under the stream (another identity, same path, same bytes) reads `changed` at the page\'s first read', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    // The stream's own backlog measured TOKEN_A; a replacement measures TOKEN_B on the next backlog. Without a new backlog
    // the stream still serves TOKEN_A, so the page's first read, the witness read (now TOKEN_B), refuses on its identity:
    // the bytes are the same, so the witness hash alone would not.
    const tmp = `${s.fileA}.new`;
    writeFileSync(tmp, transcriptOf(120));
    renameSync(tmp, s.fileA);
    s.tokens.of = () => TOKEN_B;
    const before = s.reads.length;
    expect(await ask(s, b!.older!)).toEqual({ type: 'older-page', events: [], gap: false, end: 'changed', for: b!.older! });
    expect(s.reads.length - before).toBe(1);
  });

  it('the bytes at the anchor rewritten in place (same identity, same length) read `changed` at the witness, a read later', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const text = transcriptOf(120);
    const rewritten = text.replace('"message 70"', '"massage 70"');
    expect(rewritten).not.toBe(text);
    writeFileSync(s.fileA, rewritten);
    const before = s.reads.length;
    expect(await ask(s, b!.older!)).toEqual({ type: 'older-page', events: [], gap: false, end: 'changed', for: b!.older! });
    expect(s.reads.length - before).toBe(1);
  });

  it('a resumed stream (no backlog, no measured identity) checks the identity on every read of the page', async () => {
    const text = transcriptOf(120);
    const first = await open(text);
    const [b] = backlogs(first.frames);
    // A reconnect that resumes from the backlog's offset: no backlog, but the client still holds its continuation.
    const home = first.home;
    const again = identIO();
    const frames: SessionStreamMsg[] = [];
    const stream = new SessionStream(depsFor(home, again.io), new Bus(), ID, (m) => frames.push(m),
      { uuid: UUID_A, offset: b!.offset, file: first.fileA }, NO_TICK);
    streams.push(stream);
    await stream.start();
    expect(backlogs(frames)).toEqual([]);
    const resumed = { stream, frames };
    expect((await ask(resumed, b!.older!))!.end).toBe('more');
    again.tokens.of = () => TOKEN_B;
    expect((await ask(resumed, b!.older!))!.end).toBe('changed');
    again.tokens.of = () => undefined;
    expect((await ask(resumed, b!.older!))!.end).toBe('unmeasured');
  });

  it('the reply stays within the event cap plus a bounded frame', async () => {
    const big = Array.from({ length: 120 }, (_, i) => userLine(`u${i}`, 'q'.repeat(30_000))).join('');
    const s = await open(big);
    const [b] = backlogs(s.frames);
    const page = await ask(s, b!.older!);
    expect(page!.end).toBe('more');
    // Wave 175: the next continuation and the echo of the one asked, each at most CONTINUATION_MAX_CHARS.
    expect(page!.for).toBe(b!.older!);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(OLDER_PAGE_LIMITS.eventBytes + 2 * CONTINUATION_MAX_CHARS + 128);
  });
});

describe('a request the stream refuses before any file I/O', () => {
  /** `echoed`: the value has a continuation's length and grammar, so the answer names it (wave 175); a malformed or
   *  over-long one is never reflected. Stated per case, never derived from the predicate under test. */
  const refusedWithNoRead = async (token: (b: Backlog) => string, end: string, echoed: boolean) => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const readsBefore = s.reads.length;
    const sent = token(b!);
    expect(await ask(s, sent)).toEqual({ type: 'older-page', events: [], gap: false, end, ...(echoed ? { for: sent } : {}) });
    expect(s.reads.length).toBe(readsBefore);
  };

  it('a forged continuation: `invalid`', async () => {
    await refusedWithNoRead((b) => `${b.older!.slice(0, -1)}${b.older!.endsWith('0') ? '1' : '0'}`, 'invalid', true);
  });

  it('garbage, and the empty string a non-string request is forwarded as: `invalid`', async () => {
    await refusedWithNoRead(() => 'not a continuation', 'invalid', false);
    await refusedWithNoRead(() => '', 'invalid', false);
  });

  it('one from another session\'s stream: `invalid`', async () => {
    await refusedWithNoRead((b) => {
      const opened = PROCESS_CONTINUATION_KEY.open(b.older!);
      if (!opened.ok) throw new Error('fixture');
      return PROCESS_CONTINUATION_KEY.reissue({ ...opened.value, session: 'claude-b-project-g' }, opened.value.cursor);
    }, 'invalid', true);
  });

  it('one from before a restart (another key id): `expired`', async () => {
    await refusedWithNoRead((b) => b.older!.replace(/^c1\.[0-9a-f]{16}\./, 'c1.0000000000000000.'), 'expired', true);
  });

  it('one for another file of this session: `changed`', async () => {
    await refusedWithNoRead((b) => {
      const opened = PROCESS_CONTINUATION_KEY.open(b.older!);
      if (!opened.ok) throw new Error('fixture');
      return PROCESS_CONTINUATION_KEY.reissue({ ...opened.value, pathTag: PROCESS_CONTINUATION_KEY.tag('path', '/elsewhere.jsonl') }, opened.value.cursor);
    }, 'changed', true);
  });

  it('one for this file under another identity: `changed`', async () => {
    await refusedWithNoRead((b) => {
      const opened = PROCESS_CONTINUATION_KEY.open(b.older!);
      if (!opened.ok) throw new Error('fixture');
      return PROCESS_CONTINUATION_KEY.reissue({ ...opened.value, identTag: PROCESS_CONTINUATION_KEY.tag('ident', TOKEN_B) }, opened.value.cursor);
    }, 'changed', true);
  });

  it('a value of the grammar one character past the length cap: `invalid`, never reflected (wave 175)', async () => {
    await refusedWithNoRead(() => {
      // 85 characters of frame (`c1.`, the key id, two dots, the MAC) around 1964 of payload hex: 2049, one past the cap.
      const long = `c1.${'0'.repeat(16)}.${'00'.repeat(982)}.${'0'.repeat(64)}`;
      expect(long.length).toBe(CONTINUATION_MAX_CHARS + 1);
      expect(long).toMatch(/^c1\.[0-9a-f]{16}\.(?:[0-9a-f]{2})+\.[0-9a-f]{64}$/);
      return long;
    }, 'invalid', false);
  });
});

describe('every answer names the request it answers (wave 175)', () => {
  it('a page answer and the start of the file echo the continuation each was asked with', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const first = await ask(s, b!.older!);
    expect(first).toMatchObject({ end: 'more', for: b!.older! });
    expect(first!.continuation).not.toBe(b!.older!);
    const second = await ask(s, first!.continuation!);
    expect(second).toMatchObject({ end: 'start', for: first!.continuation! });
  });

  it('a page whose reads carry no identity (`unmeasured`) echoes it too', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    s.tokens.of = () => undefined;
    expect(await ask(s, b!.older!)).toEqual({ type: 'older-page', events: [], gap: false, end: 'unmeasured', for: b!.older! });
  });
});

describe('the socket\'s client-frame parser', () => {
  it('forwards an older-page request\'s continuation, and nothing else of it', () => {
    expect(asSessionClientMsg({ type: 'older-page', continuation: 'c1.x', path: '/etc/passwd', offset: 0 }))
      .toEqual({ type: 'older-page', continuation: 'c1.x' });
  });

  it('forwards a request whose continuation is not a string as the empty string, so the stream answers `invalid`', () => {
    for (const continuation of [undefined, 42, null, { a: 1 }]) {
      expect(asSessionClientMsg({ type: 'older-page', continuation })).toEqual({ type: 'older-page', continuation: '' });
    }
  });

  it('leaves the other frames as they were', () => {
    expect(asSessionClientMsg({ type: 'visible', visible: true })).toEqual({ type: 'visible', visible: true });
    expect(asSessionClientMsg({ type: 'older-pages', continuation: 'x' })).toBeNull();
  });
});

describe('the reply words', () => {
  it('are nine, each its own word', () => {
    expect(OLDER_PAGE_ENDS).toEqual(['more', 'start', 'changed', 'absent', 'unreadable', 'unmeasured', 'invalid', 'expired', 'busy']);
  });

  it('what a stream serves after each backlog outcome: ok (with its token or none), absent, unreadable, unmeasured', () => {
    const older = { ident: TOKEN_A, anchor: 0, witness: { len: 1, sha256: '0'.repeat(64) } };
    expect(servingOf('f', { events: [], offset: 0, missing: false, measured: true, older })).toEqual({ state: 'ok', file: 'f', ident: TOKEN_A });
    expect(servingOf('f', { events: [], offset: 0, missing: false, measured: true })).toEqual({ state: 'ok', file: 'f', ident: null });
    expect(servingOf('f', { events: [], offset: 0, missing: true, measured: true })).toEqual({ state: 'absent' });
    expect(servingOf('f', { events: [], offset: 9, missing: false, measured: false })).toEqual({ state: 'unreadable' });
    expect(servingOf('f', { events: [], offset: 0, missing: true, measured: false })).toEqual({ state: 'unmeasured' });
  });

  it('a stream whose backlog could not measure the file answers that word, before any read', async () => {
    const s = await open(transcriptOf(120));
    const [b] = backlogs(s.frames);
    const set = (v: unknown): void => { (s.stream as unknown as { serving: unknown }).serving = v; };
    for (const state of ['absent', 'unreadable', 'unmeasured'] as const) {
      set({ state });
      const readsBefore = s.reads.length;
      expect((await ask(s, b!.older!))!.end).toBe(state);
      expect(s.reads.length).toBe(readsBefore);
    }
    set(null);
    expect((await ask(s, b!.older!))!.end).toBe('unmeasured');
  });
});

/** The backlog's anchor, read back from the first byte read the stream makes for a page: the witness read is the page's
 *  first read, at the anchor. Here, from the fixture's own layout: the backlog's oldest record. */
function parseAnchor(_reads: Array<{ file: string; offset: number }>, _file: string): number {
  return Buffer.byteLength(transcriptOf(70));
}

async function expectAnswerCount(frames: SessionStreamMsg[], n: number): Promise<void> {
  const until = Date.now() + 2000;
  while (answers(frames).length < n && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
  expect(answers(frames)).toHaveLength(n);
}
