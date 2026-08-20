import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AccountsResponse, ChatEvent, Dialog, FleetSession, HookAsk, MailSummary, SessionStreamMsg } from '../../shared/api';
import { FLEET_PROTO } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import { applySessionMsg, createSessionStore, type SessionSnapshot } from '../src/stores/session';
import { createFleetStore } from '../src/stores/fleet';
import { setUpdater } from '../src/lib/swupdate';
import { TEST_ROSTER } from './rosterFixture';

// — fixtures —

const TS = '2026-07-20T10:00:00.000Z';

const user = (uuid: string, text: string): ChatEvent => ({ kind: 'user', uuid, ts: TS, text });
const assistant = (uuid: string, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: TS, text });
const toolUse = (uuid: string, toolId: string): ChatEvent =>
  ({ kind: 'tool_use', uuid, ts: TS, toolId, name: 'Bash', input: 'ls' });
const toolResult = (toolId: string, text: string): ChatEvent =>
  ({ kind: 'tool_result', ts: TS, toolId, text, isError: false });

const dialogFixture: Dialog = {
  id: 'd1',
  title: 'Allow Bash?',
  options: [
    { index: 0, label: 'Yes' },
    { index: 1, label: 'No' },
  ],
  selectedIndex: 0,
  parsed: true,
  raw: '❯ 1. Yes\n  2. No',
};

const fleetSession = (id: string, wrapper: string): FleetSession => ({
  id,
  wrapper,
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/projects/OpenClawHetzner',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: null,
  limits: { five: 10, seven: 40 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  version: '2.1.0', hookState: null, askSummary: null, subagents: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null,
});

const emptySnap = (): SessionSnapshot => ({
  events: [],
  offset: 0,
  uuid: null,
  status: null,
  statusUpdatedAt: null,
  dialog: null,
  ask: null,
  tasks: [],
  mail: [],
  missingFile: null,
  strandedAccount: null,
  searchComplete: true,
  file: null,
});

const askFixture: HookAsk = {
  questions: [{ question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
};

const mailFixture: MailSummary = {
  id: 1, deliveryId: 1, at: 1_754_000_000_000, fromId: 'coordinator', toId: 's1', runId: 3,
  kind: 'question', subject: 'rebase before you start?', artifacts: [], state: 'delivered',
  attempts: 0, lastError: null,
};

/** Minimal scripted WebSocket stand-in for store connect() tests. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;
const lastSocket = (): FakeSocket => {
  const sock = FakeSocket.instances[FakeSocket.instances.length - 1];
  if (!sock) throw new Error('no FakeSocket created yet');
  return sock;
};

beforeEach(() => {
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// — pure reducer —

describe('applySessionMsg', () => {
  it('backlog replaces events, uuid, and offset', () => {
    const s = applySessionMsg(
      { ...emptySnap(), events: [user('old', 'stale')], uuid: 'u-old', offset: 7 },
      { type: 'backlog', uuid: 'u1', events: [user('a', 'hi'), assistant('b', 'hello')], offset: 120, file: '/t/u1.jsonl', missing: false },
    );

    expect(s.events).toEqual([user('a', 'hi'), assistant('b', 'hello')]);
    expect(s.uuid).toBe('u1');
    expect(s.offset).toBe(120);
    expect(s.missingFile).toBeNull();
  });

  it('backlog with missing:true records the attempted file path', () => {
    const s = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t/u1.jsonl', missing: true,
    });

    expect(s.missingFile).toBe('/t/u1.jsonl');
  });

  it('events appends and dedupes repeats by uuid (tool_result by toolId)', () => {
    let s = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi'), assistant('b', 'hello')], offset: 100, file: '/t/u1.jsonl', missing: false,
    });

    s = applySessionMsg(s, {
      type: 'events',
      uuid: 'u1',
      events: [assistant('b', 'hello'), toolUse('c', 't1'), toolResult('t1', 'ok')],
      offset: 180,
    });
    expect(s.events).toEqual([
      user('a', 'hi'), assistant('b', 'hello'), toolUse('c', 't1'), toolResult('t1', 'ok'),
    ]);
    expect(s.offset).toBe(180);

    // A re-delivered batch (overlapping resume) changes nothing but the offset.
    s = applySessionMsg(s, {
      type: 'events', uuid: 'u1', events: [toolUse('c', 't1'), toolResult('t1', 'ok')], offset: 200,
    });
    expect(s.events).toHaveLength(4);
    expect(s.offset).toBe(200);
  });

  it('rotated clears events, sets uuid, resets offset, and inserts a divider', () => {
    let s = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi')], offset: 90, file: '/t/u1.jsonl', missing: false,
    });

    s = applySessionMsg(s, { type: 'rotated', uuid: 'u2' });

    expect(s.uuid).toBe('u2');
    expect(s.offset).toBe(0);
    expect(s.events).toHaveLength(1);
    const divider = s.events[0];
    expect(divider?.kind).toBe('system');
    expect(divider && 'text' in divider ? divider.text : '').toBe('Session context reset');
  });

  // Final review, Minor 6 — measured through this very reducer: a `rotated`
  // used to leave `strandedAccount` and `searchComplete` exactly as the
  // PREVIOUS transcript left them. The server normally follows `rotated` with
  // a backlog immediately, so it is usually a one-frame window — but the send
  // can fail and the socket can die between the two frames, and then the
  // banner keeps naming a foreign account for a file this client no longer
  // reads. `missingFile` and `file` are cleared by the same rule and for the
  // same reason: all four are statements ABOUT the transcript that just went
  // away, and `file` in particular is the one the next reconnect echoes back
  // as `sinceFile` (see connect() below) — carrying the old file forward
  // would name a file that belongs to a different uuid.
  it('rotated drops every statement about the transcript it just left', () => {
    let s = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi')], offset: 90,
      file: '/t/claude2/u1.jsonl', missing: true,
      foreignAccount: 'claude2', searchComplete: false,
    });
    expect(s.strandedAccount).toBe('claude2');
    expect(s.searchComplete).toBe(false);
    expect(s.missingFile).toBe('/t/claude2/u1.jsonl');
    expect(s.file).toBe('/t/claude2/u1.jsonl');

    s = applySessionMsg(s, { type: 'rotated', uuid: 'u2' });

    expect(s.strandedAccount).toBeNull();
    expect(s.searchComplete).toBe(true);
    expect(s.missingFile).toBeNull();
    expect(s.file).toBeNull();
  });

  // The other half of the same field: a backlog keeps `file` whether or not
  // the transcript was missing. `missingFile` is gated on `missing` and must
  // STAY gated (it drives the can't-find banner); `file` is the address the
  // offset was taken in and is unconditional. Kills a fix that reuses
  // `missingFile` as the resume echo.
  it('backlog keeps the transcript path on every frame, missing or not', () => {
    const found = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi')], offset: 120,
      file: '/t/u1.jsonl', missing: false,
    });
    expect(found.file).toBe('/t/u1.jsonl');
    expect(found.missingFile).toBeNull();

    const absent = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t/gone.jsonl', missing: true,
    });
    expect(absent.file).toBe('/t/gone.jsonl');
    expect(absent.missingFile).toBe('/t/gone.jsonl');
  });

  it('the backlog that follows a rotation keeps the divider on top', () => {
    let s = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi')], offset: 90, file: '/t/u1.jsonl', missing: false,
    });
    s = applySessionMsg(s, { type: 'rotated', uuid: 'u2' });
    s = applySessionMsg(s, {
      type: 'backlog', uuid: 'u2', events: [user('z', 'fresh start')], offset: 40, file: '/t/u2.jsonl', missing: false,
    });

    expect(s.events).toHaveLength(2);
    expect(s.events[0]?.kind).toBe('system');
    expect(s.events[1]).toEqual(user('z', 'fresh start'));
  });

  it('dialog sets and dialog_cleared clears', () => {
    let s = applySessionMsg(emptySnap(), { type: 'dialog', dialog: dialogFixture });
    expect(s.dialog).toEqual(dialogFixture);

    s = applySessionMsg(s, { type: 'dialog_cleared' });
    expect(s.dialog).toBeNull();
  });

  it('ask sets and ask_cleared clears', () => {
    let s = applySessionMsg(emptySnap(), { type: 'ask', ask: askFixture, key: 'k1' });
    expect(s.ask).toEqual(askFixture);

    s = applySessionMsg(s, { type: 'ask_cleared' });
    expect(s.ask).toBeNull();
  });

  it('rotated does not clear a pending ask or dialog — a transcript switch is not a menu clearing', () => {
    let s = applySessionMsg(emptySnap(), { type: 'ask', ask: askFixture, key: 'k1' });
    s = applySessionMsg(s, { type: 'dialog', dialog: dialogFixture });

    s = applySessionMsg(s, { type: 'rotated', uuid: 'u2' });

    expect(s.ask).toEqual(askFixture);
    expect(s.dialog).toEqual(dialogFixture);
  });

  it('status updates status fields only', () => {
    const s = applySessionMsg(emptySnap(), { type: 'status', status: 'busy', statusUpdatedAt: 1_752_900_000_000 });
    expect(s.status).toBe('busy');
    expect(s.statusUpdatedAt).toBe(1_752_900_000_000);
    expect(s.events).toEqual([]);
  });

  it('notice appends a system divider carrying the message', () => {
    const s = applySessionMsg(emptySnap(), { type: 'notice', message: 'cc swap: s1 moved claude -> claude2' });
    expect(s.events).toHaveLength(1);
    const e = s.events[0];
    expect(e?.kind).toBe('system');
    expect(e && 'text' in e ? e.text : '').toBe('cc swap: s1 moved claude -> claude2');
  });

  // The new `default` arm (Rider E): an old client must shrug at a frame type
  // it has never heard of, not corrupt the store with `undefined` the way an
  // unhandled switch case would.
  it('an unknown frame type leaves the snapshot unchanged', () => {
    const s = { ...emptySnap(), events: [user('a', 'hi')], uuid: 'u1', offset: 12 };
    const future = { type: 'from_the_future' } as unknown as SessionStreamMsg;
    expect(applySessionMsg(s, future)).toBe(s);
  });
});

// — session store: optimistic sends —

describe('session store optimistic send', () => {
  it('a fresh store starts with no dialog and no hook ask', () => {
    const store = createSessionStore('s1', { api: { prompt: vi.fn() } });
    expect(store.getState().dialog).toBeNull();
    expect(store.getState().ask).toBeNull();
  });

  // Fix round 1 (I1): a stale hook ask must not survive an explicit
  // disconnect/reconnect cycle (session screen closed and reopened, a
  // swap/compact cycle) — ReconnectingSocket's own AUTOMATIC reconnects never
  // call this function, which is exactly why the server-side sentinel fix in
  // sessionws.ts's checkHookAsk (server/test/sessionws.test.ts) covers the
  // other half of this same bug; this pins the client's own half.
  it('disconnect() clears a pending hook ask (reconnect-with-stale-client-ask)', () => {
    const store = createSessionStore('s1', { api: { prompt: vi.fn() } });
    store.getState().apply({ type: 'ask', ask: askFixture, key: 'k1' });
    expect(store.getState().ask).toEqual(askFixture);

    store.getState().disconnect();
    expect(store.getState().ask).toBeNull();
  });

  // Fix round 1, finding 3's named residual: `sessionws.ts`'s own
  // per-connection sentinel now states the mail truth explicitly on every
  // fresh connect (including an empty one), which is the primary fix — this
  // pins the client's own belt-and-braces for the one corner that sentinel
  // cannot reach, a box whose coordination database is absent entirely
  // (`checkMail`'s `!this.deps.coord` early return sends no frame at all,
  // ever, on that server process).
  it('disconnect() clears outstanding mail, the same belt-and-braces `ask` already gets', () => {
    const store = createSessionStore('s1', { api: { prompt: vi.fn() } });
    store.getState().apply({ type: 'mail', mail: [mailFixture] });
    expect(store.getState().mail).toEqual([mailFixture]);

    store.getState().disconnect();
    expect(store.getState().mail).toEqual([]);
  });

  it('disconnect() leaves the scraped dialog untouched — that channel is re-scraped fresh every poll', () => {
    const store = createSessionStore('s1', { api: { prompt: vi.fn() } });
    store.getState().apply({ type: 'dialog', dialog: dialogFixture });

    store.getState().disconnect();
    expect(store.getState().dialog).toEqual(dialogFixture);
  });

  it('send() pushes a sending pending and clears it when the matching user event arrives', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt } });

    await store.getState().send('ship it');

    expect(prompt).toHaveBeenCalledWith('s1', 'ship it', { replaceDraft: undefined });
    expect(store.getState().pending).toEqual([
      expect.objectContaining({ text: 'ship it', state: 'sending' }),
    ]);

    store.getState().apply({ type: 'events', uuid: 'u1', events: [user('a', 'ship it')], offset: 50 });

    expect(store.getState().pending).toEqual([]);
    expect(store.getState().events).toEqual([user('a', 'ship it')]);
  });

  it('clears a confirmed-by-api pending after the 5 s fallback when no event matches', async () => {
    vi.useFakeTimers();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt } });

    await store.getState().send('ship it');
    expect(store.getState().pending).toHaveLength(1);

    vi.advanceTimersByTime(4_999);
    expect(store.getState().pending).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getState().pending).toEqual([]);
  });

  it('a 409 draft-present rejection marks the pending failed and captures the draft', async () => {
    const prompt = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'draft-present', draft: 'half-typed thought' }),
    );
    const store = createSessionStore('s1', { api: { prompt } });

    await store.getState().send('new text');

    expect(store.getState().pending).toEqual([
      expect.objectContaining({
        text: 'new text',
        state: 'failed',
        error: 'draft-present',
        draft: 'half-typed thought',
      }),
    ]);
  });

  // TASK 410 — the rescue's gate rides on the server's PROOF, so the store has
  // to carry it. `draft` alone cannot serve: it means three different things
  // across the failure arms, and one of them (a failed clear's residue, a
  // FRAGMENT of the message) is the exact shape the rescue must never submit.
  it('a 409 with submittable carries the flag onto the pending, and retry clears it', async () => {
    const prompt = vi.fn().mockRejectedValue(new ApiError(409, {
      ok: false, error: 'enter-ignored', draft: 'run the tests', submittable: true,
    }));
    const store = createSessionStore('s1', { api: { prompt } });

    await store.getState().send('run the tests');
    const p = store.getState().pending[0]!;
    expect(p.code).toBe('enter-ignored');
    expect(p.submittable).toBe(true);
    expect(p.draft).toBe('run the tests');

    // Cleared alongside code/draft: a stale flag would offer a button for a
    // box the server has not re-measured.
    store.getState().retry(p.key);
    expect(store.getState().pending[0]!.submittable).toBeUndefined();
  });

  it('resolve() clears the flag too — the same box, re-measured or not', async () => {
    const prompt = vi.fn().mockRejectedValueOnce(new ApiError(409, {
      ok: false, error: 'enter-ignored', draft: 'x', submittable: true,
    })).mockResolvedValueOnce(undefined);
    const store = createSessionStore('s1', { api: { prompt } });
    await store.getState().send('x');
    const key = store.getState().pending[0]!.key;

    store.getState().resolve(key, 'x again', { replaceDraft: true });
    expect(store.getState().pending[0]!.submittable).toBeUndefined();
  });

  // ABSENCE-PERMITS, in both of the shapes it actually arrives in: an older
  // server that never sends the field, and today's server on the arm that
  // deliberately withholds it.
  it('a 409 without the flag leaves it undefined — never a default of true', async () => {
    const prompt = vi.fn().mockRejectedValue(new ApiError(409, {
      ok: false, error: 'verify-failed', draft: 'a truncated frag',
    }));
    const store = createSessionStore('s1', { api: { prompt } });
    await store.getState().send('a truncated fragment and more');
    const p = store.getState().pending[0]!;
    expect(p.code).toBe('verify-failed');
    expect(p.draft).toBe('a truncated frag');
    expect(p.submittable).toBeUndefined();
  });

  it('a non-boolean submittable is ignored, not coerced', async () => {
    const prompt = vi.fn().mockRejectedValue(new ApiError(409, {
      ok: false, error: 'enter-ignored', draft: 'x', submittable: 'yes',
    }));
    const store = createSessionStore('s1', { api: { prompt } });
    await store.getState().send('x');
    expect(store.getState().pending[0]!.submittable).toBeUndefined();
  });

  it('retry() re-sends a failed pending; discard() drops it', async () => {
    const prompt = vi.fn().mockRejectedValueOnce(new ApiError(500, { ok: false, error: 'tmux-error' }));
    prompt.mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt } });

    await store.getState().send('flaky');
    const failed = store.getState().pending[0];
    expect(failed?.state).toBe('failed');
    expect(failed?.error).toBe('tmux-error');
    if (!failed) throw new Error('expected a pending entry');

    store.getState().retry(failed.key);
    expect(prompt).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(store.getState().pending[0]?.state).toBe('sending');
    });

    store.getState().discard(failed.key);
    expect(store.getState().pending).toEqual([]);
  });

  // Task 12: attachments survive the whole send lifecycle — retry and
  // draft-conflict resolution both re-dispatch the *same* pending record
  // (same key, same attachments) instead of dropping them.
  const ID = 's1';
  const CLIP = { path: '/p/clip-1-a1b2.png', previewUrl: 'blob:mock/1' };

  it('clears the pending when the echo arrives as paths-plus-text', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore(ID, { api: { prompt } });
    await store.getState().send('hi', { attachments: [CLIP] });

    store.getState().apply({
      type: 'events', uuid: 'u1', offset: 1,
      events: [{ kind: 'user', uuid: 'e1', ts: TS, text: `${CLIP.path}\nhi` }],
    });
    expect(store.getState().pending).toHaveLength(0);
  });

  it('keeps the attachments when a failed send is retried', async () => {
    const prompt = vi.fn().mockRejectedValueOnce(new ApiError(409, { error: 'dialog-open' }))
      .mockResolvedValueOnce(undefined);
    const store = createSessionStore(ID, { api: { prompt } });
    await store.getState().send('hi', { attachments: [CLIP] });
    const key = store.getState().pending[0]!.key;

    store.getState().retry(key);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(prompt.mock.calls[1]).toEqual([ID, 'hi', { attachments: [CLIP.path] }]); // narrowed
  });

  it('keeps the attachments when a draft conflict is resolved', async () => {
    const prompt = vi.fn().mockRejectedValueOnce(new ApiError(409, { error: 'draft-present', draft: 'x' }))
      .mockResolvedValueOnce(undefined);
    const store = createSessionStore(ID, { api: { prompt } });
    await store.getState().send('hi', { attachments: [CLIP] });
    const key = store.getState().pending[0]!.key;

    store.getState().resolve(key, 'x\nhi', { replaceDraft: true });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(prompt.mock.calls[1]).toEqual([ID, 'x\nhi', { replaceDraft: true, attachments: [CLIP.path] }]);
  });

  // The rule is that a pending's object URLs live until it is confirmed OR
  // explicitly abandoned. clearConfirmed and discard both honoured it; the 5s
  // grace expiry — the echo-mismatch fallback — quietly dropped the pending and
  // leaked up to four full-size images with it.
  it('revokes the object URLs when a confirmed send expires without its echo', async () => {
    vi.mocked(URL.revokeObjectURL).mockClear();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore(ID, { api: { prompt }, confirmTimeoutMs: 5 });
    await store.getState().send('hi', { attachments: [CLIP] });

    await vi.waitFor(() => expect(store.getState().pending).toHaveLength(0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(CLIP.previewUrl);
  });
});

// — session store: connection —

describe('session store connect()', () => {
  it('connects without ?since= before any backlog, then resumes with uuid:offset', () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt }, makeSocket });

    store.getState().connect();
    expect(lastSocket().url).toBe('ws://localhost:3000/ws/session/s1');

    store.getState().apply({
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi')], offset: 64, file: '/t/u1.jsonl', missing: false,
    });
    store.getState().disconnect();
    store.getState().connect();
    expect(lastSocket().url).toBe('ws://localhost:3000/ws/session/s1?since=u1:64&sinceFile=%2Ft%2Fu1.jsonl');
    store.getState().disconnect();
  });

  // Final review, Important 1 — the branch's own reproduction. One uuid can
  // now resolve to SEVERAL files (§5.1's ladder), so an offset is only
  // meaningful together with the file it was taken in. Reproduced end to end:
  // backlog of 40 events at offset 6620 from a uuid-glob-only transcript, the
  // socket drops, a swap carries the transcript to its exact address and the
  // residue is reaped — and a uuid-only resume then replays byte 6620 of a
  // DIFFERENT file, stitching messages 41-80 of the carried copy onto 40
  // messages of the stranded one with the real first 40 silently absent. It
  // self-heals only when the new file is SMALLER than the stale offset (the
  // tailer's truncation check); a growing conversation goes through silently.
  //
  // The server half shipped and is tested (`server/test/sessionws.test.ts`'s
  // two `sinceFile` cases); this is the client that never sent it. The two
  // parameter names are the ones `server/src/server.ts` reads off the query
  // (`{ since, sinceFile }` -> `parseSince`), so this asserts the decoded
  // pair rather than only the concatenated string.
  it('resumes naming the FILE its offset was taken in, not just the uuid', () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt }, makeSocket });

    store.getState().apply({
      type: 'backlog', uuid: 'b7001948', events: [user('a', 'hi')], offset: 6620,
      file: '/home/rc/.claude2/projects/-data-projects-x/b7001948.jsonl', missing: false,
      foreignAccount: 'claude2', searchComplete: true,
    });
    store.getState().connect();

    const q = new URL(lastSocket().url).searchParams;
    expect(q.get('since')).toBe('b7001948:6620');
    expect(q.get('sinceFile'))
      .toBe('/home/rc/.claude2/projects/-data-projects-x/b7001948.jsonl');
    store.getState().disconnect();
  });

  // A path with a space or a `&` in it must survive the query, and a uuid
  // still gets its own encoding. Kills a fix that concatenates the raw path.
  it('URL-encodes the file it echoes back', () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt }, makeSocket });

    store.getState().apply({
      type: 'backlog', uuid: 'u1', events: [], offset: 10,
      file: '/t/a b&c/u1.jsonl', missing: false,
    });
    store.getState().connect();

    expect(lastSocket().url).toContain('sinceFile=%2Ft%2Fa%20b%26c%2Fu1.jsonl');
    expect(new URL(lastSocket().url).searchParams.get('sinceFile')).toBe('/t/a b&c/u1.jsonl');
    store.getState().disconnect();
  });

  // A uuid with no file is the one case that may still resume on the uuid
  // alone — and since the final review's follow-up the server trusts that only
  // AT OFFSET 0 (`sessionws.ts`'s `start()`; a non-zero offset with no file is
  // read as a stale build and answered with a backlog). This is one of the two
  // moments that state is legitimately reached: a `rotated` with no backlog
  // behind it yet. So the `0` below is load-bearing, not incidental — it is
  // what keeps this resume on the honoured side of that guard — and the URL
  // must NOT carry the previous transcript's path.
  it('sends no sinceFile when a rotation left no file behind', () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt }, makeSocket });

    store.getState().apply({
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi')], offset: 64, file: '/t/u1.jsonl', missing: false,
    });
    store.getState().apply({ type: 'rotated', uuid: 'u2' });
    store.getState().connect();

    expect(lastSocket().url).toBe('ws://localhost:3000/ws/session/s1?since=u2:0');
    store.getState().disconnect();
  });

  it('applies stream messages from the socket and tracks conn state', () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = createSessionStore('s1', { api: { prompt }, makeSocket });

    store.getState().connect();
    expect(store.getState().conn).toBe('connecting');
    lastSocket().open();
    expect(store.getState().conn).toBe('open');

    lastSocket().message(JSON.stringify({ type: 'status', status: 'busy', statusUpdatedAt: 123 }));
    expect(store.getState().status).toBe('busy');
    store.getState().disconnect();
  });
});

// — fleet store —

describe('fleet store', () => {
  beforeEach(() => {
    // Live fleet messages persist an offline snapshot (lib/offline.ts) and a
    // fresh store hydrates from it — each test starts from a clean slate.
    window.localStorage.clear();
  });

  it('applies fleet snapshots and appends dismissible notices', () => {
    const store = createFleetStore({ makeSocket });

    store.getState().connect();
    lastSocket().open();
    expect(store.getState().conn).toBe('open');

    lastSocket().message(JSON.stringify({ type: 'fleet', sessions: [fleetSession('s1', 'claude'), fleetSession('s2', 'claude2')] }));
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['s1', 's2']);

    lastSocket().message(JSON.stringify({ type: 'notice', message: 'cc swap: s1 moved claude -> claude2' }));
    lastSocket().message(JSON.stringify({ type: 'notice', message: 'second notice' }));
    const notices = store.getState().notices;
    expect(notices.map((n) => n.message)).toEqual(['cc swap: s1 moved claude -> claude2', 'second notice']);

    const first = notices[0];
    if (!first) throw new Error('expected a notice');
    store.getState().dismissNotice(first.id);
    expect(store.getState().notices.map((n) => n.message)).toEqual(['second notice']);
    store.getState().disconnect();
  });

  it('connects to /ws/fleet and ignores unrecognised frames', () => {
    const store = createFleetStore({ makeSocket });

    store.getState().connect();
    expect(lastSocket().url).toBe('ws://localhost:3000/ws/fleet');
    lastSocket().open();

    expect(() => lastSocket().message(JSON.stringify({ type: 'mystery' }))).not.toThrow();
    expect(store.getState().sessions).toEqual([]);
    store.getState().disconnect();
  });

  // Fix round 1, finding 2: `connect()` adds a `GET /api/accounts` poll (the
  // roster field), a 20s interval, an `Array.isArray` guard, and a
  // `clearInterval` in `disconnect()` — none of it had a test. `deps.fetchAccounts`
  // is the same injection shape `deps.catchUp`/`deps.fetchFeed` already use.
  describe('the roster poll', () => {
    const accountsResponse = (roster: AccountsResponse['roster']): AccountsResponse => ({
      accounts: [], projected: null, roster,
    });

    it('populates the roster from the poll', async () => {
      const fetchAccounts = vi.fn().mockResolvedValue(accountsResponse(TEST_ROSTER));
      const store = createFleetStore({ makeSocket, fetchAccounts });
      store.getState().connect();

      await vi.waitFor(() => expect(store.getState().roster).toEqual(TEST_ROSTER));
      store.getState().disconnect();
    });

    it('a later malformed response does NOT clobber an already-good roster', async () => {
      vi.useFakeTimers();
      try {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let calls = 0;
        const fetchAccounts = vi.fn().mockImplementation(async () => {
          calls += 1;
          // First poll: a real roster. Every poll after: a malformed one —
          // the exact shape a stub answering an unmatched route with bare
          // `{}` hands back (`r.roster === undefined`).
          return calls === 1
            ? accountsResponse(TEST_ROSTER)
            : ({ accounts: [], projected: null } as unknown as AccountsResponse);
        });
        const store = createFleetStore({ makeSocket, fetchAccounts });
        store.getState().connect();

        // Flushes the first poll's microtask without advancing real OR fake
        // time — `vi.waitFor`'s own internal polling assumes real timers,
        // which this test cannot use once `vi.useFakeTimers()` is active.
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchAccounts).toHaveBeenCalledTimes(1);
        expect(store.getState().roster).toEqual(TEST_ROSTER);

        // The 20s interval fires the second, malformed poll.
        await vi.advanceTimersByTimeAsync(20_000);
        expect(fetchAccounts).toHaveBeenCalledTimes(2);
        // Preserved, not clobbered with `[]` — the last GOOD roster survives
        // a single bad read.
        expect(store.getState().roster).toEqual(TEST_ROSTER);
        // And it said so (finding 6) — a genuine protocol break otherwise has
        // no signal anywhere; every consumer just quietly reverts to raw ids.
        expect(warn).toHaveBeenCalled();

        store.getState().disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('disconnect() stops the interval — no further polling after it', async () => {
      vi.useFakeTimers();
      try {
        const fetchAccounts = vi.fn().mockResolvedValue(accountsResponse(TEST_ROSTER));
        const store = createFleetStore({ makeSocket, fetchAccounts });
        store.getState().connect();

        await vi.advanceTimersByTimeAsync(0);
        expect(fetchAccounts).toHaveBeenCalledTimes(1);
        store.getState().disconnect();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchAccounts).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Build 7 / Task 10: additive, so no FLEET_PROTO bump — an already-deployed
  // PWA must drop this frame exactly like `{type:'mystery'}` above, and this
  // build must accept it once it knows the shape.
  describe('the `runs` frame', () => {
    const runSummary = (id: number, state: string) => ({
      id, program: 'build7', programTitle: 'Fleet coordination', wave: 1, waveOf: 3,
      project: 'ccrc-pwa', sessionId: 'cc-a', workspace: 'cc-a-ws', branch: 'build7/wave1',
      state, resumed: false, clearedAt: null, openedAt: 1, dispatchedAt: 2, closedAt: null,
      handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
    });

    it('accepts a well-formed runs frame and stores it', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      expect(store.getState().runsFrameSeen).toBe(false);
      const runs = [runSummary(1, 'working')];
      lastSocket().message(JSON.stringify({ type: 'runs', runs }));
      expect(store.getState().runs).toEqual(runs);
      // `RunsScreen` (fix round 1, task 5, findings 1/3) reads this to tell
      // "the frame genuinely said nothing" apart from "no frame has arrived
      // yet" — a well-formed frame must flip it, even one carrying `[]`.
      expect(store.getState().runsFrameSeen).toBe(true);
      store.getState().disconnect();
    });

    it('rejects a runs frame whose `runs` is not an array — the property old clients depend on', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      // Same shape as `{type:'mystery'}` above: an unknown/malformed frame is
      // dropped SILENTLY, never thrown — that silence is exactly what lets an
      // already-deployed PWA sit in front of a newer server unharmed. Assert
      // it explicitly here so nobody "helpfully" makes the parser throw.
      expect(() => lastSocket().message(JSON.stringify({ type: 'runs' }))).not.toThrow();
      expect(store.getState().runs).toEqual([]);
      // Dropped, not accepted — a malformed frame must not flip the "the
      // socket has genuinely spoken" flag either.
      expect(store.getState().runsFrameSeen).toBe(false);
      store.getState().disconnect();
    });

    it('a well-formed frame carrying `[]` still flips `runsFrameSeen` — an honest empty roster is not silence', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      lastSocket().message(JSON.stringify({ type: 'runs', runs: [] }));
      expect(store.getState().runs).toEqual([]);
      expect(store.getState().runsFrameSeen).toBe(true);
      store.getState().disconnect();
    });
  });

  // Build 4, Task 11, spec §4.2: additive on the same terms as `runs` above —
  // an already-deployed PWA drops this frame silently, and this build accepts
  // it once it knows the shape. `coordFrameSeen` is `runsFrameSeen`'s own
  // sticky idiom, restated for the marker readout `CoordBanner` renders.
  describe('the `coord` frame', () => {
    it('accepts a well-formed coord frame and stores it', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      expect(store.getState().coord).toBeNull();
      expect(store.getState().coordFrameSeen).toBe(false);
      lastSocket().message(JSON.stringify({ type: 'coord', coord: { pause: 'set', mail: 'clear' } }));
      expect(store.getState().coord).toEqual({ pause: 'set', mail: 'clear' });
      expect(store.getState().coordFrameSeen).toBe(true);
      store.getState().disconnect();
    });

    it('rejects a coord frame whose `coord` is missing or not an object — dropped silently, never thrown', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      expect(() => lastSocket().message(JSON.stringify({ type: 'coord' }))).not.toThrow();
      expect(store.getState().coord).toBeNull();
      expect(store.getState().coordFrameSeen).toBe(false);

      expect(() => lastSocket().message(JSON.stringify({ type: 'coord', coord: null }))).not.toThrow();
      expect(store.getState().coord).toBeNull();
      expect(store.getState().coordFrameSeen).toBe(false);

      expect(() => lastSocket().message(JSON.stringify({ type: 'coord', coord: 'set' }))).not.toThrow();
      expect(store.getState().coord).toBeNull();
      expect(store.getState().coordFrameSeen).toBe(false);
      store.getState().disconnect();
    });

    it('stays sticky across a GENUINE reconnect — a fresh socket, not just a re-fired open event — never reset the way `sessions`/`runs` never are either', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();
      lastSocket().message(JSON.stringify({ type: 'coord', coord: { pause: 'set', mail: 'clear' } }));
      expect(store.getState().coordFrameSeen).toBe(true);

      // `disconnect()` then `connect()` — the same idiom the "connects
      // without ?since=" test above uses to prove a real resume — tears down
      // the old socket and asks `makeSocket` for a NEW one (`FakeSocket`'s own
      // instance-tracking array proves it: `lastSocket()` after this returns
      // a DIFFERENT object). A `coord.pause`/`coord.mail` reset hiding in
      // EITHER `connect()`'s own init state OR `disconnect()`'s teardown would
      // both be caught here, not only a reset inside the `onOpen` handler a
      // same-socket re-fire would exercise on its own. The server only
      // re-sends `coord` when the value actually CHANGES (`emitCoord`'s own
      // byte-equality guard), so a reconnect that lands before the next
      // change must not un-flip a flag `CoordBanner` relies on to decide
      // whether to render at all.
      const firstSocket = lastSocket();
      store.getState().disconnect();
      store.getState().connect();
      expect(lastSocket()).not.toBe(firstSocket);
      lastSocket().open();

      expect(store.getState().coord).toEqual({ pause: 'set', mail: 'clear' });
      expect(store.getState().coordFrameSeen).toBe(true);
      store.getState().disconnect();
    });
  });

  // Review finding 18: `feed` used to have exactly two producers — the
  // catch-up tail (volatile: the mark it reads advances one-way at receipt,
  // so a reload landing after the tail already ran sees nothing left to ask
  // for) and `GET /api/feed` on `/mail`'s own mount (which most sessions
  // never open). The unread-mail BADGE (FleetScreen) is computed off `feed`
  // and is mounted for the app's whole lifetime — nothing durable ever
  // hydrated it at boot, so a reload or a PWA eviction between the tail's
  // last advance and now made real unread mail read as zero.
  describe('the durable feed read on connect (fix, review finding 18)', () => {
    it('asks GET /api/feed once on the first successful connect, and merges it into `feed`', async () => {
      const fetchFeed = vi.fn(async () => ({
        events: [
          { at: 1, seq: 1, kind: 'mail' as const, title: 'from the durable read', body: '', sessionId: 's1' },
        ],
      }));
      const store = createFleetStore({ makeSocket, fetchFeed, catchUp: async () => ({ events: [], epoch: 'e', seq: 0, resync: false }) });
      store.getState().connect();
      lastSocket().open();

      await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(store.getState().feed.map((e) => e.title)).toEqual(['from the durable read']));
      store.getState().disconnect();
    });

    it('does not ask again on a later reconnect once the first read has already succeeded', async () => {
      const fetchFeed = vi.fn(async () => ({ events: [] }));
      const store = createFleetStore({ makeSocket, fetchFeed, catchUp: async () => ({ events: [], epoch: 'e', seq: 0, resync: false }) });
      store.getState().connect();
      lastSocket().open();
      await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));

      // A reconnect (server bounce, backoff) re-fires `onOpen` — the durable
      // read must not repeat once it has already landed successfully.
      lastSocket().open();
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchFeed).toHaveBeenCalledTimes(1);
      store.getState().disconnect();
    });

    it('retries on the NEXT reconnect if the first attempt failed (offline at boot)', async () => {
      let calls = 0;
      const fetchFeed = vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('offline');
        return { events: [{ at: 1, seq: 1, kind: 'mail' as const, title: 'landed on retry', body: '', sessionId: 's1' }] };
      });
      const store = createFleetStore({ makeSocket, fetchFeed, catchUp: async () => ({ events: [], epoch: 'e', seq: 0, resync: false }) });
      store.getState().connect();
      lastSocket().open();
      await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(1));

      lastSocket().open(); // reconnect
      await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(store.getState().feed.map((e) => e.title)).toEqual(['landed on retry']));
      store.getState().disconnect();
    });
  });

  describe('feedDropped', () => {
    // feedDropped's own docstring: "how many records the LAST read could not
    // place at all" — not a running total. `/mail`'s mount effect calls
    // `mergeFeed(events, d)` against `GET /api/feed`, an IDEMPOTENT re-read;
    // mounting the screen twice against the same three permanently-unreadable
    // rows must report "3" both times, not "3" then "6".
    it('reports the LAST mergeFeed call\'s drop count, not the sum across calls', () => {
      const store = createFleetStore();
      store.getState().mergeFeed([], 3);
      expect(store.getState().feedDropped).toBe(3);
      store.getState().mergeFeed([], 3); // same re-read, same three unreadable rows
      expect(store.getState().feedDropped).toBe(3); // NOT 6
    });

    it('clearFeed resets it to 0', () => {
      const store = createFleetStore();
      store.getState().mergeFeed([], 2);
      store.getState().clearFeed();
      expect(store.getState().feedDropped).toBe(0);
    });

    // The catch-up tail (`connect()`'s `askCatchUp`) calls `mergeFeed` with NO
    // dropped argument — `applyCatchUp` never counts what it silently drops,
    // so it has no honest number to give. A `dropped = 0` DEFAULT would read
    // that silence as "confirmed nothing lost" and stomp a real count
    // `/mail`'s mount had just set from `GET /api/feed`. Omitting the argument
    // must leave `feedDropped` untouched, never reset it to 0.
    it('a call with no dropped argument (the catch-up tail) never clobbers a real count with a fabricated 0', () => {
      const store = createFleetStore();
      store.getState().mergeFeed([], 3); // GET /api/feed: 3 rows this build could not read
      expect(store.getState().feedDropped).toBe(3);
      store.getState().mergeFeed([]); // a later catch-up tail — no idea how many, if any
      expect(store.getState().feedDropped).toBe(3); // NOT 0
    });
  });

  // — the dormant handshake (Rider E) —
  describe('the hello handshake', () => {
    afterEach(() => setUpdater(() => {})); // never leak a test's spy into the next file's module state

    it('a connection that never sends hello leaves blocked false', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      lastSocket().message(JSON.stringify({ type: 'fleet', sessions: [] }));
      expect(store.getState().blocked).toBe(false);
      store.getState().disconnect();
    });

    it('hello with min > FLEET_PROTO sets blocked and calls requestUpdate once', () => {
      const update = vi.fn();
      setUpdater(update);
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      lastSocket().message(JSON.stringify({ type: 'hello', proto: FLEET_PROTO + 1, min: FLEET_PROTO + 1 }));
      expect(store.getState().blocked).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);

      // A second hello saying the SAME thing (e.g. the socket's automatic
      // reconnect against a server that hasn't been fixed yet) must not fire
      // the update check again — only the RISING edge does.
      lastSocket().message(JSON.stringify({ type: 'hello', proto: FLEET_PROTO + 1, min: FLEET_PROTO + 1 }));
      expect(update).toHaveBeenCalledTimes(1);
      store.getState().disconnect();
    });

    it('a later compatible hello CLEARS blocked — not a one-way latch', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      lastSocket().message(JSON.stringify({ type: 'hello', proto: FLEET_PROTO + 1, min: FLEET_PROTO + 1 }));
      expect(store.getState().blocked).toBe(true);

      lastSocket().message(JSON.stringify({ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO }));
      expect(store.getState().blocked).toBe(false);
      store.getState().disconnect();
    });

    it('rejects a hello whose proto/min are not numbers rather than trusting it', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      // min: '2' (not '1') makes this fixture discriminating: were the
      // typeof guard removed, the frame would reach the numeric compare as
      // '2' > FLEET_PROTO, which JS coerces to true — blocked would flip to
      // true and this assertion would fail. '1' was the one value coercion
      // makes indistinguishable from "guard applied" (either way blocked
      // stays false), so it could never catch the guard's absence.
      lastSocket().message(JSON.stringify({ type: 'hello', proto: '1', min: '2' }));
      expect(store.getState().blocked).toBe(false);
      store.getState().disconnect();
    });
  });
});

// — Build 4 wave 4 gates: what this build did NOT add to the wire —
//
// The Global Constraint, verbatim: "No new session frame. No new `ChatEvent`
// kind." Both were the obvious designs for mail-in-the-transcript and both are
// refused (spec §2.2) — a second `{type:'mail_log'}` frame would put the same
// message on the wire twice ordered by two different clocks, and a
// `{kind:'mail'}` `ChatEvent` would render as a blank or broken bubble in
// every older PWA, whose `buildChatItems` funnels unknown kinds into
// `MessageBubble`. The house one-way rule is *old readers drop what they do
// not know*; a variant on a union they already destructure is not that.
//
// These are TEXT scans of the two declarations, in the single-definition.test
// idiom: they catch the ordinary way someone adds a member, which is the way
// people actually add members.
describe('Build 4 wave 4 — the wire additions that were refused', () => {
  const sourceOf = (...seg: string[]): string =>
    readFileSync(path.join(import.meta.dirname, '..', '..', ...seg), 'utf8');

  it("applySessionMsg still carries its `satisfies never` default arm — no session frame was added", () => {
    // Compile-time exhaustiveness AND the runtime shrug, both. If a later
    // build adds a frame, `tsc` fails at that line rather than silently
    // dropping it — which is only true while the line is there.
    const src = sourceOf('pwa', 'src', 'stores', 'session.ts');
    expect(src).toContain('msg satisfies never;');
  });

  it('and answers an unknown frame by shrugging, not corrupting', () => {
    const s: SessionSnapshot = {
      events: [user('a', 'hi')], offset: 12, uuid: 'u1', status: null,
      statusUpdatedAt: null, dialog: null, ask: null, tasks: [], mail: [],
      missingFile: null, strandedAccount: null, searchComplete: true, file: null,
    };
    // A frame from a newer server this build was never compiled to know.
    expect(applySessionMsg(s, { type: 'mail_log' } as unknown as SessionStreamMsg)).toBe(s);
  });

  it('ChatEvent gained no kind — the five members are exactly what they were', () => {
    // Build 4 added an optional FIELD (`truncatedBytes`) to two existing
    // members. A sixth member is the refused design, and this is what says so.
    const src = sourceOf('shared', 'api.ts');
    const decl = /export type ChatEvent =([\s\S]*?);\n/.exec(src)?.[1] ?? '';
    expect(decl, 'ChatEvent declaration not found').not.toBe('');
    const kinds = [...decl.matchAll(/\{\s*kind:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(kinds).toEqual(['user', 'assistant', 'tool_use', 'tool_result', 'system']);
  });

  it("the mail ChatItem is a RENDER-MODEL member, not a ChatEvent one", () => {
    // The distinction the whole design rests on: `{kind:'mail'}` exists in
    // `ChatList.tsx`'s `ChatItem`, which is PWA-local and derived per render,
    // and nowhere in `shared/api.ts`, which is the wire.
    expect(sourceOf('pwa', 'src', 'session', 'ChatList.tsx')).toContain("kind: 'mail'");
    expect(sourceOf('shared', 'api.ts')).not.toContain("kind: 'mail'");
  });
});
