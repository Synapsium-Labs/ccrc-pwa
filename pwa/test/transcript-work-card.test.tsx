// D-7898: Settings › Automation › Work in transcript folders. It reads the server's `disk.transcriptWork` block through
// `readDiskHealth` alone: absent is "not measured yet" (never zero), an unmeasured walk says so in the amber ink, and a
// count names its size and the largest entries. jsdom lays nothing out, so this file holds the words and the markup;
// `browser/transcript-work-card.browser.test.ts` holds the geometry.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FleetHealth } from '../../shared/api';
import type { DiskHealth, DiskTranscriptWork } from '../../shared/disk';
import { TranscriptWorkSection } from '../src/fleet/TranscriptWorkSection';
import { sizeWords, transcriptWorkAlarm, transcriptWorkLine, transcriptWorkOf, transcriptWorkTop } from '../src/fleet/transcriptWorkWords';

afterEach(cleanup);

const disk = (tw?: unknown): DiskHealth => ({
  at: 1, level: 'ok', filesystems: [], expectedMounts: [], pressure: false, holders: [],
  ...(tw === undefined ? {} : { transcriptWork: tw as DiskTranscriptWork }),
});
const health = (tw?: unknown): FleetHealth => ({ mode: 'remote', connected: true, downSince: null, disk: disk(tw) });
const TW = {
  ok: { at: 1, level: 'ok', entries: 2, bytes: 3 * 1024 ** 2 + 5, top: [{ name: 'lane-a/-w-project-a/scratch', bytes: 3 * 1024 ** 2 }, { name: 'lane-a/-w-project-a/probe.txt', bytes: 5 }] },
  one: { at: 1, level: 'ok', entries: 1, bytes: 700, top: [{ name: 'lane-a/-w-project-a/report.md', bytes: 700 }] },
  none: { at: 1, level: 'ok', entries: 0, bytes: 0, top: [] },
  warn: { at: 1, level: 'warn', entries: 1, bytes: 1.5 * 1024 ** 3, top: [{ name: 'lane-a/-w-project-a/scratch-repo', bytes: 1.5 * 1024 ** 3 }] },
  unmeasured: { at: 1, level: 'unmeasured', entries: 0, bytes: 0, top: [] },
} as const;

describe('the words', () => {
  it('sizes in whole units below a GiB and one floored decimal from there', () => {
    expect([0, 1023, 1024, 1024 ** 2 - 1, 1024 ** 2, 1024 ** 3 - 1, 1024 ** 3, 1.47 * 1024 ** 3].map(sizeWords))
      .toEqual(['0 B', '1023 B', '1 KiB', '1023 KiB', '1 MiB', '1023 MiB', '1 GiB', '1.4 GiB']);
  });

  it('says each state, and absent is not measured yet, never zero', () => {
    const line = (h: FleetHealth | null): string => transcriptWorkLine(transcriptWorkOf(h));
    expect(line(health(TW.ok))).toBe('2 entries kept in transcript folders · 3 MiB');
    expect(line(health(TW.one))).toBe('1 entry kept in transcript folders · 700 B');
    expect(line(health(TW.none))).toBe('No work kept in transcript folders');
    expect(line(health(TW.warn))).toBe('1 entry kept in transcript folders · 1.5 GiB, over the warn bound');
    expect(line(health(TW.unmeasured))).toBe('Transcript folders unmeasured: the last count did not finish');
    expect(line(health())).toBe('Transcript folders not measured yet');
    expect(line(null)).toBe('Transcript folders not measured yet');
    // A malformed block drops alone and reads as not measured yet.
    expect(line(health({ ...TW.ok, level: 'fine' }))).toBe('Transcript folders not measured yet');
  });

  it('the amber ink is for warn and unmeasured only', () => {
    expect([TW.ok, TW.none, TW.warn, TW.unmeasured].map((t) => transcriptWorkAlarm(transcriptWorkOf(health(t)))))
      .toEqual([false, false, true, true]);
    expect(transcriptWorkAlarm(null)).toBe(false);
  });

  it('names the largest entries with their sizes, and none when unmeasured', () => {
    expect(transcriptWorkTop(transcriptWorkOf(health(TW.ok)))).toEqual(['lane-a/-w-project-a/scratch · 3 MiB', 'lane-a/-w-project-a/probe.txt · 5 B']);
    expect(transcriptWorkTop(transcriptWorkOf(health(TW.unmeasured)))).toEqual([]);
    expect(transcriptWorkTop(null)).toEqual([]);
  });
});

describe('Settings › Automation › Work in transcript folders', () => {
  it('outside the shell\'s provider the card says not measured yet, and lists nothing', () => {
    render(<TranscriptWorkSection />);
    expect(screen.getByRole('heading', { level: 3, name: 'Work in transcript folders' })).toBeInTheDocument();
    expect(screen.getByText('Transcript folders not measured yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Largest entries' })).toBeNull();
  });
});
