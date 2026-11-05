// Console speed, Task C3, fix round 1 (F4): the reader the reload gate's hold asks. A release's full page load would
// drop a send that is in flight, or failed and showing Retry, so the move holds while any session store has one. A
// queued send was accepted by the API, so it does not hold.
import { afterEach, describe, expect, it } from 'vitest';
import { anySendUnresolved, getSessionStore, type PendingSend } from '../src/stores/session';

const ids = ['unresolved-a', 'unresolved-b'];
const put = (id: string, pending: PendingSend[]): void => { getSessionStore(id).setState({ pending }); };

afterEach(() => { for (const id of ids) put(id, []); });

describe('anySendUnresolved (Task C3, F4)', () => {
  it('no pending send anywhere: false', () => {
    for (const id of ids) put(id, []);
    expect(anySendUnresolved()).toBe(false);
  });

  it('a send in flight in any store: true', () => {
    put('unresolved-a', []);
    put('unresolved-b', [{ key: 'p1', text: 'hello', state: 'sending' }]);
    expect(anySendUnresolved()).toBe(true);
  });

  it('a failed send showing Retry: true', () => {
    put('unresolved-a', [{ key: 'p1', text: 'hello', state: 'failed', error: 'not sent' }]);
    expect(anySendUnresolved()).toBe(true);
  });

  it('a failed send holds even if marked queued', () => {
    // No writer makes this today; it pins the reader's failed clause on its own.
    put('unresolved-a', [{ key: 'p1', text: 'hello', state: 'failed', queued: true, error: 'not sent' }]);
    expect(anySendUnresolved()).toBe(true);
  });

  it('a queued send does not hold', () => {
    put('unresolved-a', [{ key: 'p1', text: 'hello', state: 'sending', queued: true }]);
    expect(anySendUnresolved()).toBe(false);
  });
});
