// The hosted reader's faces wait is bounded by the frame's watchdog (the review of the appearance wave, a bound first item of
// reader mode's wave XR). A hosted mount loads the reader faces beside the base assets and awaits them just before the
// library's mount; the library's own fallback watchdog starts only inside that mount. A face load that rejects was already
// contained (the mount goes on without faces); one that never settles would leave the body mounting for ever, with no
// fallback. The wait is now raced against the same watchdog the Mermaid wait beside it is, so a hung face load ends as a
// failed one does: the mount goes on with the library's own faces.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocFrame, HostAdapters, mountDocFrame } from '@synapsium-labs/pinax-lib/host';
import type { RenderInput } from '@synapsium-labs/pinax-lib/frame';
import { mountReader, type ReaderMountInput } from '../src/docs/reader/bridge';
import { READER_APPEARANCE_MAP } from '../src/docs/reader/appearance';
import { readerWatchdogMs } from '../src/docs/reader/policy';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const STUB_ASSETS = { guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' };
const BYTES = 100;

/** The console's root with the appearance tokens set, so the mount is hosted (the appearance contract is the installed one). */
function root(): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  el.dataset.skin = 'refined'; el.dataset.theme = 'first';
  el.style.setProperty('color-scheme', 'light');
  for (const token of Object.values(READER_APPEARANCE_MAP.colour)) el.style.setProperty(token, '#123456');
  return el;
}

function run(fonts: () => Promise<{ sans: string; mono: string }>) {
  const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => ({
    update: vi.fn(), setPrefs: vi.fn(), setAppearance: vi.fn(), destroy: vi.fn(), command: vi.fn(),
    closeOverlay: vi.fn(), goto: vi.fn(), setReading: vi.fn(), printFigures: vi.fn(),
  }) as unknown as DocFrame);
  const input: ReaderMountInput = {
    document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } } as RenderInput,
    bytes: BYTES, docKey: 'demo:sec:a.md', title: 'a.md', prefs: { theme: 'auto' }, appearanceRoot: root(),
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
  };
  const pending = mountReader(document.createElement('div'), input, {
    mount: mount as unknown as typeof mountDocFrame,
    store: () => null,
    assets: () => Promise.resolve(STUB_ASSETS),
    mermaid: () => Promise.resolve('MERMAID'),
    fonts,
    e17: 'does-not-hold',
  });
  return { mount, input, pending };
}

describe('the hosted faces wait', () => {
  it('reader faces: a face load that never settles ends within the watchdog, and the mount goes on with the library\'s own faces', async () => {
    vi.useFakeTimers();
    const r = run(() => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(readerWatchdogMs(BYTES) - 1);
    expect(r.mount, 'the mount waited less than the watchdog').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.mount, 'a hung face load left the body mounting for ever').toHaveBeenCalledTimes(1);
    await r.pending;
    expect(r.mount.mock.calls[0]![1].adapters.assets.fonts, 'no faces are passed').toBeUndefined();
    expect(r.mount.mock.calls[0]![1].adapters.appearance, 'CONTROL: the mount is hosted').toBeDefined();
    expect(r.input.onFallback, 'the frame is not given up: it mounts with its own faces').not.toHaveBeenCalled();
  });

  it('reader faces: a settled face load changes nothing, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const faces = { sans: 'sans', mono: 'mono' };
    const r = run(() => Promise.resolve(faces));
    await vi.advanceTimersByTimeAsync(0);
    await r.pending;
    expect(r.mount).toHaveBeenCalledTimes(1);
    expect(r.mount.mock.calls[0]![1].adapters.assets.fonts).toEqual(faces);
    expect(vi.getTimerCount(), 'the deadline timer is cleared once the wait settles').toBe(0);
  });
});
