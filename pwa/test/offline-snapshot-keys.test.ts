// The offline snapshot persists `RosterWire` only (G15; accounts plan Task A12). `GET /api/accounts` now carries
// `lanes` (identity, key hints, credit) and `connect` for a session reader; the fleet store holds both in memory and
// never in the snapshot, so a phone's localStorage holds no identity a later reader of the device could find.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountsResponse, LaneWire } from '../../shared/api';
import { FLEET_PROTO } from '../../shared/api';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

const KEY = 'ccrc.fleet-snapshot.v1';
const IDENTITY = 'someone@example.invalid';
const HINT = 'sk-or-v1-…a3f9';

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeSocket.last = this; }
  close(): void {}
  send(): void {}
  message(data: unknown): void { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

const lane: LaneWire = {
  state: { word: 'signed-in', source: 'checked 4m ago', at: 1 },
  check: { verdict: 'ok', at: 1 }, identity: IDENTITY, identitySource: 'measured', keyHint: HINT, ready: true,
};
const answer: AccountsResponse = {
  accounts: [], projected: null, roster: TEST_ROSTER,
  lanes: { [TEST_ROSTER[0]!.id]: lane },
  connect: { accountOps: 'unsupported', gate: 'armed', origin: 'https' },
};

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the offline snapshot keeps RosterWire only (G15)', () => {
  it('the persisted snapshot\'s keys are exactly today\'s, and holding `lanes` in the store does not add one', async () => {
    const fetchAccounts = vi.fn().mockResolvedValue(answer);
    const store = createFleetStore({ makeSocket, fetchAccounts });
    store.getState().connect();
    await vi.waitFor(() => expect(store.getState().lanes).toEqual(answer.lanes));
    expect(store.getState().accountsConnect).toEqual(answer.connect);

    const sock = FakeSocket.last!;
    sock.message({ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO });
    sock.message({ type: 'fleet', sessions: [fleetSession()] });

    const raw = window.localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const snap = JSON.parse(raw!) as Record<string, unknown>;
    expect(Object.keys(snap).sort()).toEqual(['roster', 'savedAt', 'sessions']);
    for (const r of snap['roster'] as Record<string, unknown>[]) {
      expect(Object.keys(r).every((k) => k !== 'lanes' && k !== 'connect' && k !== 'identity' && k !== 'keyHint')).toBe(true);
    }
    expect(raw).not.toContain(IDENTITY);
    expect(raw).not.toContain('a3f9');
    expect(raw).not.toContain('lanes');
    store.getState().disconnect();
  });

  it('refreshAccounts() re-reads at once, and an answer without lanes clears them', async () => {
    const fetchAccounts = vi.fn().mockResolvedValueOnce(answer)
      .mockResolvedValue({ accounts: [], projected: null, roster: TEST_ROSTER } satisfies AccountsResponse);
    const store = createFleetStore({ makeSocket, fetchAccounts });
    store.getState().connect();
    await vi.waitFor(() => expect(store.getState().lanes).toEqual(answer.lanes));
    await store.getState().refreshAccounts();
    expect(fetchAccounts).toHaveBeenCalledTimes(2);
    expect(store.getState().lanes).toBeNull();
    expect(store.getState().accountsConnect).toBeNull();
    store.getState().disconnect();
  });
});
