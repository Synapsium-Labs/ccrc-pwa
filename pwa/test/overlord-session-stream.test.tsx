// The place-visible report rides the session store's own socket (Overlord W1 home B, Task 4; plan question 4, ruled F3): a mounted
// place connects the bound session's stream, and the store's existing beat then sends `{ type: 'visible', visible }` every
// `VIEWER_REFRESH_MS` (15 s). It opens no second stream and adds no frame. Unmounting disconnects; a rebind moves the stream to
// the new session. The socket is a fake `WebSocket` on the global, so the real session store, `ReconnectingSocket` and beat run.
// Neutral names only: the repository is public.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VIEWER_REFRESH_MS } from '../../shared/api';
import { useOverlordSessionStream } from '../src/overlord/useOverlordSessionStream';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 1;
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(): void { this.closed = true; this.readyState = 3; }
}

const visibleFrames = (s: FakeSocket): { type: string; visible: boolean }[] =>
  s.sent.filter((f): f is { type: string; visible: boolean } => (f as { type?: string }).type === 'visible');
const forSession = (id: string): FakeSocket[] => FakeSocket.all.filter((s) => s.url.includes(`/ws/session/${id}`));

function Place({ sessionId }: { sessionId: string | null }) {
  useOverlordSessionStream(sessionId);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useOverlordSessionStream', () => {
  it('connects the bound session\'s stream and sends a visibility frame on open and every 15 s', async () => {
    render(<Place sessionId="lane-a-overlord" />);
    await vi.advanceTimersByTimeAsync(0);
    const sockets = forSession('lane-a-overlord');
    expect(sockets).toHaveLength(1);
    expect(visibleFrames(sockets[0]!)).toEqual([{ type: 'visible', visible: true }]);
    await vi.advanceTimersByTimeAsync(VIEWER_REFRESH_MS);
    expect(visibleFrames(sockets[0]!)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(VIEWER_REFRESH_MS * 2);
    expect(visibleFrames(sockets[0]!)).toHaveLength(4);
    expect(visibleFrames(sockets[0]!).every((f) => f.visible)).toBe(true);
  });

  it('opens one stream and no second one, and adds no frame type of its own', async () => {
    render(<Place sessionId="lane-a-overlord" />);
    await vi.advanceTimersByTimeAsync(VIEWER_REFRESH_MS * 3);
    expect(FakeSocket.all).toHaveLength(1);
    const types = new Set(FakeSocket.all[0]!.sent.map((f) => (f as { type: string }).type));
    expect([...types]).toEqual(['visible']);
  });

  it('unmounting says the place is hidden, closes the stream and stops the beat', async () => {
    const { unmount } = render(<Place sessionId="lane-a-overlord" />);
    await vi.advanceTimersByTimeAsync(0);
    const socket = forSession('lane-a-overlord')[0]!;
    unmount();
    expect(socket.closed).toBe(true);
    expect(visibleFrames(socket).at(-1)).toEqual({ type: 'visible', visible: false });
    const sent = socket.sent.length;
    await vi.advanceTimersByTimeAsync(VIEWER_REFRESH_MS * 3);
    expect(socket.sent).toHaveLength(sent);
  });

  it('a rebind moves the stream to the new session and closes the old one', async () => {
    const { rerender } = render(<Place sessionId="lane-a-overlord" />);
    await vi.advanceTimersByTimeAsync(0);
    const first = forSession('lane-a-overlord')[0]!;
    rerender(<Place sessionId="lane-b-overlord" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.closed).toBe(true);
    const second = forSession('lane-b-overlord');
    expect(second).toHaveLength(1);
    expect(visibleFrames(second[0]!)).toEqual([{ type: 'visible', visible: true }]);
    const before = first.sent.length;
    await vi.advanceTimersByTimeAsync(VIEWER_REFRESH_MS);
    expect(first.sent).toHaveLength(before);
    expect(visibleFrames(second[0]!)).toHaveLength(2);
  });

  it('a null session id opens nothing; a binding that appears opens its stream', async () => {
    const { rerender } = render(<Place sessionId={null} />);
    await vi.advanceTimersByTimeAsync(VIEWER_REFRESH_MS);
    expect(FakeSocket.all).toHaveLength(0);
    rerender(<Place sessionId="lane-a-overlord" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(forSession('lane-a-overlord')).toHaveLength(1);
    rerender(<Place sessionId={null} />);
    expect(forSession('lane-a-overlord')[0]!.closed).toBe(true);
  });
});
