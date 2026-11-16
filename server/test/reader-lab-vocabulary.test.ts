// The reader lab's vocabulary (native Docs reader, the reader lab plan of 2026-11-03, Task 1; the rich-docs spec's row
// M10.1): `shared/readerLab.ts` read as data. The probe names are a closed list whose every name is safe in a URL path
// and in a CSP source; the battery is W8a's 27 channels in their order; a nonce is 16 bytes of base64url; the paths are
// built from one root; the run's own time caps sum to the figure the door's run life is derived from.
import { describe, expect, it } from 'vitest';
import {
  LAB_BATTERY_CHANNELS, LAB_BUSY_SPIN_MS, LAB_DRAW_SETTLE_MS, LAB_FIXED_PROBES, LAB_MOUNTS, LAB_MOUNT_WAIT_MS,
  LAB_ORIGIN_CLASSES, LAB_PROBE_NAMES, LAB_RUN_CAPS_MS, LAB_SETTLE_MS, LAB_SITE_CLASSES, LAB_STEPS, LAB_TAP_WAIT_MS,
  READER_LAB_PROBE_ROUTE, READER_LAB_RUNS_PATH, isLabNonce, isLabProbeName, readerLabClosePath, readerLabProbeBase,
  readerLabProbePath, readerLabRunPath,
} from '../../shared/readerLab.js';

describe('the reader lab vocabulary (reader lab plan, Task 1)', () => {
  it('the battery is the desktop battery\'s 27 channels, in its order', () => {
    expect(LAB_BATTERY_CHANNELS).toEqual([
      'fetch-cors', 'fetch-nocors', 'fetch-credentials', 'fetch-post', 'fetch-keepalive', 'xhr-get', 'xhr-post', 'beacon',
      'websocket', 'eventsource', 'image', 'image-srcset', 'script', 'script-module', 'link-stylesheet', 'link-prefetch',
      'link-preload', 'link-modulepreload', 'style-import', 'css-background', 'css-font-face', 'css-content-url', 'audio',
      'video', 'svg-image', 'import-dynamic', 'iframe',
    ]);
  });

  it('the probe names are the 40 fixed probes, then a wall and a control name per channel, each once', () => {
    expect(LAB_FIXED_PROBES).toHaveLength(40);
    expect(LAB_PROBE_NAMES).toEqual([
      ...LAB_FIXED_PROBES,
      ...LAB_BATTERY_CHANNELS.map((c) => `csp-${c}`),
      ...LAB_BATTERY_CHANNELS.map((c) => `ctl-${c}`),
    ]);
    expect(new Set(LAB_PROBE_NAMES).size).toBe(94);
  });

  it('every name is lower-case words joined by hyphens, at most 40 long: safe in a path and in a CSP source', () => {
    for (const n of LAB_PROBE_NAMES) {
      expect(n, n).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(n.length, n).toBeLessThanOrEqual(40);
    }
  });

  it('isLabProbeName is membership in the list and nothing more', () => {
    for (const n of LAB_PROBE_NAMES) expect(isLabProbeName(n), n).toBe(true);
    for (const n of ['', 'csp-', 'csp-nope', 'ambient-parent', 'COOKIE-FETCH', 'cookie-fetch ', '__proto__', 'constructor', 'toString']) {
      expect(isLabProbeName(n), JSON.stringify(n)).toBe(false);
    }
  });

  it('a nonce is exactly 22 base64url characters, the length 16 random bytes make', () => {
    expect(Buffer.from(new Uint8Array(16)).toString('base64url')).toHaveLength(22);
    for (const n of ['AAAAAAAAAAAAAAAAAAAAAA', 'aZ09-_aZ09-_aZ09-_aZ09']) expect(isLabNonce(n), n).toBe(true);
    for (const n of ['', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}=`, `${'A'.repeat(21)}+`, `${'A'.repeat(21)}/`, `${'A'.repeat(21)}.`]) {
      expect(isLabNonce(n), n).toBe(false);
    }
  });

  it('the classes are closed lists', () => {
    expect(LAB_SITE_CLASSES).toEqual(['same-origin', 'same-site', 'cross-site', 'none', 'absent', 'other']);
    expect(LAB_ORIGIN_CLASSES).toEqual(['null', 'absent', 'present']);
  });

  it('the paths are built from one root, and the probe route is the probe base with its two parameters', () => {
    const n = 'AAAAAAAAAAAAAAAAAAAAAA';
    expect(READER_LAB_RUNS_PATH).toBe('/api/reader-lab/runs');
    expect(readerLabRunPath(n)).toBe(`/api/reader-lab/runs/${n}`);
    expect(readerLabClosePath(n)).toBe(`/api/reader-lab/runs/${n}/close`);
    expect(readerLabProbeBase(n)).toBe(`/api/reader-lab/probe/${n}/`);
    expect(readerLabProbePath(n, 'csp-canary')).toBe(`/api/reader-lab/probe/${n}/csp-canary`);
    expect(READER_LAB_PROBE_ROUTE).toBe(`${readerLabProbeBase(':nonce')}:name`);
  });

  it('the run\'s own caps, and their sum, from which the door derives a run\'s life: about fifteen minutes', () => {
    expect([LAB_TAP_WAIT_MS, LAB_SETTLE_MS, LAB_BUSY_SPIN_MS, LAB_MOUNT_WAIT_MS, LAB_DRAW_SETTLE_MS, LAB_STEPS, LAB_MOUNTS])
      .toEqual([30_000, 2000, 3000, 65_000, 10_000, 9, 11]);
    expect(LAB_RUN_CAPS_MS)
      .toBe(LAB_TAP_WAIT_MS + LAB_STEPS * LAB_SETTLE_MS + LAB_BUSY_SPIN_MS + LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS));
    expect(LAB_RUN_CAPS_MS).toBe(876_000);
  });
});
