import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, Dialog, FleetSession, HookAsk } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import { applySessionMsg, createSessionStore, type SessionSnapshot } from '../src/stores/session';
import { createFleetStore } from '../src/stores/fleet';

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
  version: '2.1.0', hookState: null, askSummary: null, subagents: null,
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
  missingFile: null,
});

const askFixture: HookAsk = {
  questions: [{ question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
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
    let s = applySessionMsg(emptySnap(), { type: 'ask', ask: askFixture });
    expect(s.ask).toEqual(askFixture);

    s = applySessionMsg(s, { type: 'ask_cleared' });
    expect(s.ask).toBeNull();
  });

  it('rotated does not clear a pending ask or dialog — a transcript switch is not a menu clearing', () => {
    let s = applySessionMsg(emptySnap(), { type: 'ask', ask: askFixture });
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
});

// — session store: optimistic sends —

describe('session store optimistic send', () => {
  it('a fresh store starts with no dialog and no hook ask', () => {
    const store = createSessionStore('s1', { api: { prompt: vi.fn() } });
    expect(store.getState().dialog).toBeNull();
    expect(store.getState().ask).toBeNull();
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
    expect(lastSocket().url).toBe('ws://localhost:3000/ws/session/s1?since=u1:64');
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
});
