// Task G1 (D-7334, D-7338): `runLastMove` is the app's one reader of `RunSummary.lastMoveAt`. An absent field is an older
// server and reads null, so an older server shows no movement (spec §5). A server that sent null measured a run with no
// move yet, so the reader falls back to its dispatch time, then its open time. A number is the move itself.
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../shared/api';
import { runLastMove } from '../src/fleet/runWords';
import { createFleetStore } from '../src/stores/fleet';

const OPENED = 1_790_000_000_000;
const DISPATCHED = OPENED + 60_000;
const MOVED = OPENED + 3_600_000;

const run = (o: { lastMoveAt?: number | null; dispatchedAt?: number | null } = {}): RunSummary => ({
  id: 1, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
  sessionId: 'lane-a-project-a', workspace: null, branch: null, state: 'working', claimedBy: 'coord-a', resumed: false,
  clearedAt: null, openedAt: OPENED, dispatchStartedAt: null, dispatchedAt: DISPATCHED, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  ...o,
} as RunSummary);

describe('runLastMove: the one reader of RunSummary.lastMoveAt', () => {
  it('an absent field (an older server) reads null, whatever the run\'s other times say', () => {
    expect(runLastMove(run())).toBeNull();
  });

  it('a number is the move', () => {
    expect(runLastMove(run({ lastMoveAt: MOVED }))).toBe(MOVED);
  });

  it('null falls back to the dispatch time', () => {
    expect(runLastMove(run({ lastMoveAt: null }))).toBe(DISPATCHED);
  });

  it('null with no dispatch yet falls back to the open time', () => {
    expect(runLastMove(run({ lastMoveAt: null, dispatchedAt: null }))).toBe(OPENED);
  });
});

// The runs frame's `stallQuietMs` (D-7334) is read once, in the fleet store, and replaced by every runs frame.
describe('the fleet store reads the runs frame\'s stallQuietMs', () => {
  const open = () => {
    let sock: { onopen: ((e: Event) => void) | null; onmessage: ((e: MessageEvent) => void) | null } | null = null;
    const store = createFleetStore({
      makeSocket: () => {
        sock = { onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} } as never;
        return sock as unknown as WebSocket;
      },
    });
    store.getState().connect();
    sock!.onopen?.(new Event('open'));
    const frame = (m: unknown): void => sock!.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
    return { store, frame };
  };

  it('is null before any runs frame, the frame\'s value after one, and null again from a frame without it', () => {
    const { store, frame } = open();
    expect(store.getState().stallQuietMs).toBeNull();
    frame({ type: 'runs', runs: [run()], stallQuietMs: 7_200_000 });
    expect(store.getState().stallQuietMs).toBe(7_200_000);
    frame({ type: 'runs', runs: [run()] });   // an older server, or one before its first resolution
    expect(store.getState().stallQuietMs).toBeNull();
  });

  it('reads anything but a positive finite number as none', () => {
    const { store, frame } = open();
    for (const bad of [0, -1, 'soon', null, Number.POSITIVE_INFINITY]) {
      frame({ type: 'runs', runs: [], stallQuietMs: 7_200_000 });
      frame({ type: 'runs', runs: [], stallQuietMs: bad });
      expect(store.getState().stallQuietMs, String(bad)).toBeNull();
    }
  });
});
