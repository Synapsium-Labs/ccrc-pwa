// The device's copy of the Waiting on you list (console speed, Task C4; spec §2.6, D16): a second key of `lib/offline.ts`,
// beside the fleet snapshot, read and written only through the storage port. Every "no copy" case loads one `null`.
import { describe, expect, it } from 'vitest';
import { WAITING_SNAPSHOT_KEY, forgetWaitingSnapshot, loadWaitingSnapshot, saveWaitingSnapshot } from '../src/lib/offline';
import { memoryStorage, type StoragePort, type StorageSource } from '../src/lib/storage';
import { NOW, itemView, waitingView } from './ledgersFixture';

const FLEET_KEY = 'ccrc.fleet-snapshot.v1';

const store = (): { port: Storage; from: StorageSource } => {
  const port = memoryStorage();
  return { port, from: () => port };
};

const throwing: StorageSource = () => ({
  getItem(): string | null { throw new Error('storage refused'); },
  setItem(): void { throw new Error('quota'); },
  removeItem(): void { throw new Error('storage refused'); },
} satisfies StoragePort);

describe('the saved Waiting list (lib/offline.ts)', () => {
  it('names its own key, beside the fleet snapshot', () => {
    expect(WAITING_SNAPSHOT_KEY).toBe('ccrc.waiting-snapshot.v1');
  });

  it('save then load answers the view and its time', () => {
    const { from } = store();
    const view = waitingView({ items: [itemView({ id: 7, title: 'Pick a colour' })] });
    expect(saveWaitingSnapshot(view, NOW, from)).toBe(true);
    expect(loadWaitingSnapshot(from)).toEqual({ savedAt: NOW, view });
  });

  it('nothing stored loads null', () => {
    expect(loadWaitingSnapshot(store().from)).toBeNull();
  });

  it('a stored value that is not a list loads null', () => {
    const { port, from } = store();
    port.setItem(WAITING_SNAPSHOT_KEY, JSON.stringify({ savedAt: NOW, view: { cleared: [], goals: [] } }));
    expect(loadWaitingSnapshot(from)).toBeNull();
  });

  it('a savedAt that is not a number loads null', () => {
    const { port, from } = store();
    port.setItem(WAITING_SNAPSHOT_KEY, JSON.stringify({ savedAt: 'yesterday', view: waitingView() }));
    expect(loadWaitingSnapshot(from)).toBeNull();
  });

  it('bad JSON loads null', () => {
    const { port, from } = store();
    port.setItem(WAITING_SNAPSHOT_KEY, '{"savedAt":');
    expect(loadWaitingSnapshot(from)).toBeNull();
  });

  it('a store that throws on read loads null, and on write answers false', () => {
    expect(loadWaitingSnapshot(throwing)).toBeNull();
    expect(saveWaitingSnapshot(waitingView(), NOW, throwing)).toBe(false);
  });

  it('no store at all loads null, and a write answers false', () => {
    expect(loadWaitingSnapshot(() => null)).toBeNull();
    expect(saveWaitingSnapshot(waitingView(), NOW, () => null)).toBe(false);
  });

  // Review 1556 R2: G15's no-hint rule extends to this copy, so a key fragment never rests on the device. Item text stays.
  it('a saved copy holds no secret tail, in the slot\'s state or in the answer', () => {
    const { port, from } = store();
    const setAt = NOW - 10 * 60_000;
    const iso = new Date(setAt).toISOString();
    const secret = itemView({
      id: 3, kind: 'secret', state: 'checking', secretSlot: 'publish-token', answer: `set ${iso} ending zq9W`,
      secretSet: { at: setAt, tail: 'zq9W', masked: true }, why: 'The release needs it.',
    });
    const cleared = itemView({ id: 4, kind: 'secret', state: 'done', answer: `set ${iso} ending zq9W`, secretSet: { at: setAt, tail: 'zq9W', masked: false, why: 'unregistered' } });
    const plain = itemView({ id: 5, kind: 'value', answer: 'a value ending in words' });
    expect(saveWaitingSnapshot(waitingView({ items: [secret, plain], cleared: [cleared] }), NOW, from)).toBe(true);
    expect(port.getItem(WAITING_SNAPSHOT_KEY)).not.toContain('zq9W');
    const back = loadWaitingSnapshot(from);
    expect(back?.view.items[0]).toEqual({ ...secret, answer: `set ${iso}`, secretSet: { at: setAt, tail: '', masked: true } });
    expect(back?.view.cleared[0]?.answer).toBe(`set ${iso}`);
    expect(back?.view.cleared[0]?.secretSet).toEqual({ at: setAt, tail: '', masked: false, why: 'unregistered' });
    // Item text, and an answer that is not a secret's, stay as they were.
    expect(back?.view.items[0]?.why).toBe('The release needs it.');
    expect(back?.view.items[1]?.answer).toBe('a value ending in words');
  });

  it('forgetting the copy removes its key and leaves the fleet snapshot\'s', () => {
    const { port, from } = store();
    port.setItem(FLEET_KEY, 'fleet-bytes');
    saveWaitingSnapshot(waitingView(), NOW, from);
    expect(forgetWaitingSnapshot(from)).toBe(true);
    expect(port.getItem(WAITING_SNAPSHOT_KEY)).toBeNull();
    expect(port.getItem(FLEET_KEY)).toBe('fleet-bytes');
    expect(forgetWaitingSnapshot(throwing)).toBe(false);
  });

  it('a waiting save leaves the fleet snapshot\'s key untouched', () => {
    const { port, from } = store();
    port.setItem(FLEET_KEY, 'fleet-bytes');
    saveWaitingSnapshot(waitingView(), NOW, from);
    expect(port.getItem(FLEET_KEY)).toBe('fleet-bytes');
    expect(port.length).toBe(2);
  });
});
