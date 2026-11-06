// The lab-only Mermaid drop signal; the ordinary reader's bridge tests live in reader-bridge.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocFrame, mountDocFrame } from '@synapsium-labs/docserver/host';
import type { RenderInput } from '@synapsium-labs/docserver/frame';
import { mountReader, type ReaderMountInput } from '../src/docs/reader/bridge';
import { READER_LAB_DRAW_WATCHDOG_MS } from '../src/lib/readerLimits';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const scan = { mermaid: { fences: 1, largestBytes: 10, totalBytes: 10, largestChars: 10, totalChars: 10 } };
const assets = { guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' };
function rig(profile: ReaderMountInput['profile'], mermaid: () => Promise<string>) {
  const dropped = vi.fn();
  const input: ReaderMountInput & { onMermaidDrop: () => void } = {
    document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } }, scan },
    bytes: 100, docKey: null, title: 'lab.md', prefs: { theme: 'auto' }, profile,
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(), onMermaidDrop: dropped,
  };
  const mount = vi.fn((_el: HTMLElement, _options: { document: RenderInput }) => ({ destroy: vi.fn(), setPrefs: vi.fn(), update: vi.fn() }) as unknown as DocFrame);
  const run = () => mountReader(document.createElement('div'), input, {
    assets: async () => assets, mermaid, mount: mount as unknown as typeof mountDocFrame,
  });
  return { dropped, mount, run };
}

describe('lab Mermaid scan drop', () => {
  it('signals a rejected load only for the lab profile while still mounting without scan', async () => {
    const lab = rig('lab-draw', async () => { throw new Error('lost'); });
    await lab.run();
    expect(lab.dropped).toHaveBeenCalledTimes(1);
    expect(lab.mount).toHaveBeenCalledTimes(1);
    expect(lab.mount.mock.calls[0]![1].document.scan).toBeUndefined();
    const ordinary = rig(undefined, async () => { throw new Error('lost'); });
    await ordinary.run();
    expect(ordinary.dropped).not.toHaveBeenCalled();
  });
  it('signals a load that exceeds the lab deadline, and ignores a late resolution', async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const lab = rig('lab-draw', () => new Promise((r) => { resolve = r; }));
    const mounted = lab.run();
    await vi.advanceTimersByTimeAsync(READER_LAB_DRAW_WATCHDOG_MS - 1);
    expect(lab.dropped).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await mounted;
    expect(lab.dropped).toHaveBeenCalledTimes(1);
    expect(lab.mount.mock.calls[0]![1].document.scan).toBeUndefined();
    resolve('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(lab.dropped).toHaveBeenCalledTimes(1);
  });
});
