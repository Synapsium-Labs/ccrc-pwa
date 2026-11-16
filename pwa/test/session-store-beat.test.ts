// Console speed S2: the socket's heartbeat frame belongs to the socket (the watchdog in `lib/ws.ts` reads it); the
// session store keeps its state and returns the very snapshot it was given.
import { describe, expect, it } from 'vitest';
import { applySessionMsg, type SessionSnapshot } from '../src/stores/session';

const snap = (): SessionSnapshot => ({
  events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null, dialog: null, ask: null, tasks: [], mail: [],
  missingFile: null, strandedAccount: null, searchComplete: true, fileMeasured: true, file: null,
});

describe('the session store and a beat', () => {
  it('a beat leaves the state unchanged', () => {
    const s = snap();
    expect(applySessionMsg(s, { type: 'beat', at: 1 })).toBe(s);
  });
});
