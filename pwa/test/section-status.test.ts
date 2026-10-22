// Each Settings section's status line and tone (settings Task R2b1; spec §3.2's table; D-5503). Pure: a view in,
// a line out. A read that has not landed is a skeleton, a failed one "could not be read", and neither is folded
// into a status.
import { describe, expect, it } from 'vitest';
import type { CollectLaneView, StallWatchView, UpdatesView } from '../../shared/api';
import type { SettingsView } from '../src/screens/settings/SettingsDataProvider';
import { sectionStatus, UNREAD_STATUS, type SectionStatus } from '../src/screens/settings/sectionStatus';
import { boxToken, node, updatesView } from './settingsViewFixture';

const noop = (): void => {};
const stallView = (level: string): StallWatchView => ({ chosen: { level } } as unknown as StallWatchView);
const collectView = (state: string): CollectLaneView => ({ effective: { state } } as unknown as CollectLaneView);

const settings = (over: Partial<SettingsView> = {}): SettingsView => ({
  updates: { view: updatesView(), failure: null, seq: 1, reload: () => 0 },
  stall: { view: stallView('log'), failure: null, reload: noop, settle: noop },
  collect: { view: collectView('live'), failure: null, reload: noop, settle: noop },
  linear: { view: null, failure: null, reload: noop, settle: noop },
  pause: { kind: 'read', marker: 'clear' },
  auth: { kind: 'read', status: { authed: true, passkeysEnrolled: 2, mode: 'passphrase' } },
  push: 'on',
  rereadPush: noop,
  ...over,
});
const FACTS: { skin: string; theme: string | null; hostname: string; now: number } = {
  skin: 'Refined', theme: 'Phosphor & Ink', hostname: 'localhost', now: Date.now(),
};
const of = (id: Parameters<typeof sectionStatus>[0], v: SettingsView, facts = FACTS): SectionStatus => sectionStatus(id, v, facts);
const text = (s: SectionStatus): string => (s.kind === 'line' ? s.text : '<skeleton>');
const tone = (s: SectionStatus): string => (s.kind === 'line' ? s.tone : 'skeleton');

/** A view where the fleet node is behind a newer catalogue release on its channel, so `bannerRelease` names it. */
const waiting = (): UpdatesView => updatesView({
  releases: [],
  nodes: [node({ desiredTag: 'v0.0.10', highestVersion: 'v0.0.9' })],
});

describe('Updates', () => {
  it('reads the version, the channel and auto-install when nothing waits, calm', () => {
    const s = of('updates', settings());
    expect(text(s)).toBe('v0.0.9 · Stable · Auto-install off');
    expect(tone(s)).toBe('calm');
  });

  it('leads with available exactly when a tag is pending (bannerRelease), in the attention tone', async () => {
    const { bannerRelease } = await import('../src/fleet/releaseWaiting');
    const w = waiting();
    expect(bannerRelease(w)?.tag).toBe('v0.0.10');
    const s = of('updates', settings({ updates: { view: w, failure: null, seq: 1, reload: () => 0 } }));
    expect(text(s)).toBe('↑ v0.0.10 available · fleet runs v0.0.9');
    expect(tone(s)).toBe('attention');
    // And never when nothing is pending.
    expect(bannerRelease(updatesView())).toBeNull();
    expect(text(of('updates', settings()))).not.toMatch(/available/);
    // Releases listed but nothing pending (the fleet already on the newest one): still no "available", and no
    // fall-back to the newest listed release.
    const rel = (tag: string, at: number) => ({
      tag, version: tag, channel: 'stable' as const, publishedAt: at, commitSha: null,
      bundleListed: true, yanked: false, refused: [], notes: null,
    });
    const current = updatesView({ releases: [rel('v0.0.9', 2), rel('v0.0.8', 1)] });
    expect(bannerRelease(current)).toBeNull();
    const sNone = of('updates', settings({ updates: { view: current, failure: null, seq: 1, reload: () => 0 } }));
    expect(text(sNone)).toBe('v0.0.9 · Stable · Auto-install off');
    expect(tone(sNone)).toBe('calm');
  });

  it('says the range when nodes run different versions', () => {
    const v = updatesView({ nodes: [node(), node({ nodeId: 'b', current: { ...node().current!, version: 'v0.0.10' } })] });
    expect(text(of('updates', settings({ updates: { view: v, failure: null, seq: 1, reload: () => 0 } }))))
      .toBe('Nodes run v0.0.9 to v0.0.10');
  });

  it('is amber when a node is unreachable or the catalogue read failed', () => {
    const v = updatesView({ nodes: [node({ reachable: false })] });
    expect(tone(of('updates', settings({ updates: { view: v, failure: null, seq: 1, reload: () => 0 } })))).toBe('amber');
    const c = updatesView({ catalogue: { lastOkAt: null, lastError: { at: 1, reason: 'x' } } });
    expect(tone(of('updates', settings({ updates: { view: c, failure: null, seq: 1, reload: () => 0 } })))).toBe('amber');
  });

  it('is a skeleton before the read lands, and "could not be read" when it failed', () => {
    expect(of('updates', settings({ updates: { view: null, failure: null, seq: 0, reload: () => 0 } }))).toEqual({ kind: 'skeleton' });
    expect(text(of('updates', settings({ updates: { view: null, failure: 'failed', seq: 0, reload: () => 0 } })))).toBe(UNREAD_STATUS);
  });
});

describe('Appearance', () => {
  it('names the skin and the palette, or Follows the system, never toned', () => {
    expect(of('appearance', settings())).toEqual({ kind: 'line', text: 'Refined · Phosphor & Ink', tone: 'calm' });
    expect(text(of('appearance', settings(), { ...FACTS, theme: null }))).toBe('Refined · Follows the system');
  });
});

describe('Notifications', () => {
  it('reads the push state and the fleet announcement', () => {
    expect(text(of('notifications', settings()))).toBe("Pushes on in this browser · Releases: the fleet's channel");
    expect(text(of('notifications', settings({ push: 'blocked' })))).toMatch(/^Pushes blocked in this browser/);
  });

  it('reads Not available, never off, where push is unsupported', () => {
    const s = text(of('notifications', settings({ push: 'unsupported' })));
    expect(s).toMatch(/^Pushes not available in this browser/);
    expect(s).not.toMatch(/\boff\b/);
  });

  it('is a skeleton while the push read is pending', () => {
    expect(of('notifications', settings({ push: 'pending' }))).toEqual({ kind: 'skeleton' });
  });
});

describe('Automation', () => {
  it('reads the stall level and the collector', () => {
    const s = of('automation', settings());
    expect(text(s)).toBe('Stall watch: Log only · Collector: Live');
    expect(tone(s)).toBe('calm');
  });

  it('is a skeleton until the first coord frame, never "runs normally", even with both reads landed', () => {
    expect(of('automation', settings({ pause: { kind: 'pending' } }))).toEqual({ kind: 'skeleton' });
  });

  it('is amber when cleanup is paused, or the collector is safety-stopped', () => {
    expect(of('automation', settings({ pause: { kind: 'read', marker: 'set' } })))
      .toEqual({ kind: 'line', text: 'Cleanup paused', tone: 'amber' });
    expect(tone(of('automation', settings({
      collect: { view: collectView('safety-stopped'), failure: null, reload: noop, settle: noop },
    })))).toBe('amber');
  });

  it('says could not be read for a failed read rather than a status', () => {
    const s = text(of('automation', settings({ stall: { view: null, failure: 'failed', reload: noop, settle: noop } })));
    expect(s).toMatch(new RegExp(`^Stall watch: ${UNREAD_STATUS}`));
  });
});

describe('Security', () => {
  it('reads the gate, the passkeys and the box token, calm when healthy', () => {
    const s = of('security', settings());
    expect(text(s)).toMatch(/^Sign-in on · 2 passkeys · Box token: Healthy/);
    expect(tone(s)).toBe('calm');
  });

  it('is red only when the gate is off and the page is not on loopback (unarmedExposure)', () => {
    const off = settings({ auth: { kind: 'read', status: { authed: true, passkeysEnrolled: 0, mode: 'off' } } });
    expect(tone(of('security', off))).toBe('calm');
    expect(text(of('security', off))).toMatch(/^Sign-in off: reachable from this machine only/);
    const exposed = of('security', off, { ...FACTS, hostname: 'console.example' });
    expect(tone(exposed)).toBe('red');
    expect(tone(of('security', settings({ auth: { kind: 'read', status: { authed: false, passkeysEnrolled: 1, mode: 'locked-out' } } }))))
      .toBe('amber');
  });

  it('is amber when the box token is held', () => {
    const v = updatesView({ boxToken: boxToken({ phase: 'held', hold: 'link-down' }) });
    expect(tone(of('security', settings({ updates: { view: v, failure: null, seq: 1, reload: () => 0 } })))).toBe('amber');
  });

  it('is a skeleton before the auth read lands, and could not be read after it failed', () => {
    expect(of('security', settings({ auth: { kind: 'pending' } }))).toEqual({ kind: 'skeleton' });
    expect(text(of('security', settings({ auth: { kind: 'failed' } })))).toBe(`Sign-in ${UNREAD_STATUS}`);
  });
});
