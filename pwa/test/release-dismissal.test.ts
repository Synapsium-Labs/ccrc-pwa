// releaseDismissal (D-6327, part b): the per-device memory of the release the operator hid from the fleet's update
// line. A high-water mark in `localStorage`, counted only when it is a well-formed release tag, with a page-level copy
// so a dismissal holds for this page even when storage refuses it. Always via `window.localStorage` (Node 22's bare
// global shadows jsdom's).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissRelease, readDismissed, resetDismissalForTests } from '../src/fleet/releaseDismissal';

const KEY = 'ccrc-release-dismissed';

beforeEach(() => {
  window.localStorage.clear();
  resetDismissalForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetDismissalForTests();
});

describe('releaseDismissal', () => {
  it('absent, malformed or unreadable storage dismisses nothing', () => {
    expect(readDismissed(), 'absent').toBeNull();
    for (const bad of ['', 'v0.0', 'latest', '0.0.9', 'v0.0.9-rc1', ' v0.0.9', '["v0.0.9"]', 'null']) {
      window.localStorage.setItem(KEY, bad);
      expect(readDismissed(), `malformed ${JSON.stringify(bad)}`).toBeNull();
    }
    window.localStorage.setItem(KEY, 'v0.0.9');
    expect(readDismissed(), 'CONTROL: a well-formed tag is a mark').toBe('v0.0.9');
    // Unreadable: the read throws.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readDismissed()).toBeNull();
    // A refusal to dismiss a non-tag is silent and records nothing.
    vi.restoreAllMocks();
    window.localStorage.clear();
    dismissRelease('latest');
    dismissRelease('');
    expect(readDismissed()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('a dismissal storage refuses still hides for this page', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => dismissRelease('v0.0.9')).not.toThrow();
    expect(readDismissed(), 'the page-level mark holds').toBe('v0.0.9');
    // Storage that cannot even be read does not lose it either.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readDismissed()).toBe('v0.0.9');
  });

  it('a dismissal never lowers the mark, read fresh from storage', () => {
    dismissRelease('v0.0.9');
    expect(window.localStorage.getItem(KEY)).toBe('v0.0.9');
    // Another tab wrote a newer tag after this page last read.
    window.localStorage.setItem(KEY, 'v0.0.10');
    dismissRelease('v0.0.9');
    expect(window.localStorage.getItem(KEY), 'storage keeps the newer mark').toBe('v0.0.10');
    expect(readDismissed(), 'and the read answers it, not the older tag this page holds').toBe('v0.0.10');
    // A newer tag raises it; the same tag leaves it as is.
    dismissRelease('v0.0.11');
    expect(window.localStorage.getItem(KEY)).toBe('v0.0.11');
    dismissRelease('v0.0.11');
    expect(readDismissed()).toBe('v0.0.11');
  });

  it('the mark survives a reload', () => {
    dismissRelease('v0.0.9');
    resetDismissalForTests();
    expect(readDismissed(), 'a fresh page reads it from storage').toBe('v0.0.9');
  });
});
