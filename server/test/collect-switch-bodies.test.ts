// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.4, §5.5): the collector's transition row names what
// armed it, or that neither does and why, or its bounded safety-stop reason from a total table; the latch row is the
// ruled sentence and its actor; and a change of the switch's stored state carries a title of its own. No body carries a
// detail, a path, a raw reason token or the journal's file name.
import { describe, it, expect } from 'vitest';
import {
  COLLECT_FEED_TITLE, COLLECT_SETTING_FEED_TITLE, collectLatchFeedBody, collectSwitchFeedBody,
  type CollectLaneNotes, type CollectLaneSafetyWhy, type CollectLaneSettled,
} from '../src/collectLane.js';

const N: CollectLaneNotes = { latchDue: false, markerRecreated: false };
const live = (armedBy: 'legacy-marker' | 'settings' | 'both'): CollectLaneSettled => ({ kind: 'live', armedBy, notes: N });
const shadowed = (why: 'off' | 'future-choice' | 'other-node'): CollectLaneSettled => ({ kind: 'shadowed', why, notes: N });
const stopped = (why: CollectLaneSafetyWhy): CollectLaneSettled => ({ kind: 'safety-stopped', why });
/** Total by type: a new safety-stop reason is a compile error here until it is listed (typecheck-tests). */
const SAFETY: Readonly<Record<CollectLaneSafetyWhy, true>> = {
  'row-absent': true, 'row-unreadable': true, 'row-malformed': true, 'journal-missing': true, 'journal-malformed': true,
  'journal-unreadable': true, 'journal-not-regular': true, 'journal-not-configured': true, 'generation-mismatch': true,
};
const SAFETY_WHYS = Object.keys(SAFETY) as CollectLaneSafetyWhy[];
const LIVE_TAIL = ': the temp-root collector removes an orphaned temp root it has proved idle twice, with no person in '
  + 'the loop, while cleanup is not paused.';
const shadowSaid = (reason: string): string => "the collector lane is now shadowed: neither Settings nor the fleet box's "
  + `legacy file arms it (${reason}), so the temp-root collector audits and reports what it would collect, and removes `
  + 'nothing.';
const ALL_SETTLED: readonly CollectLaneSettled[] = [
  live('legacy-marker'), live('settings'), live('both'),
  shadowed('off'), shadowed('future-choice'), shadowed('other-node'),
  ...SAFETY_WHYS.map(stopped),
];
/** The resolver's raw tokens: a body words each, and never prints one. */
const RAW_TOKENS: readonly string[] = [...SAFETY_WHYS, 'legacy-marker', 'future-choice', 'other-node', 'unknown-fleet',
  'epoch-changed'];

describe('the transition and latch rows name their source, never a path (§5.5)', () => {
  it('live names its source', () => {
    expect(collectSwitchFeedBody(live('legacy-marker')))
      .toBe(`the collector lane is now live, armed by the fleet box's legacy file${LIVE_TAIL}`);
    expect(collectSwitchFeedBody(live('settings'))).toBe(`the collector lane is now live, armed by Settings${LIVE_TAIL}`);
    expect(collectSwitchFeedBody(live('both')))
      .toBe(`the collector lane is now live, armed by both Settings and the fleet box's legacy file${LIVE_TAIL}`);
  });

  it('shadowed names neither and its reason', () => {
    expect(collectSwitchFeedBody(shadowed('off'))).toBe(shadowSaid('Settings is off'));
    expect(collectSwitchFeedBody(shadowed('future-choice'))).toBe(shadowSaid('Settings holds a choice this build does not know'));
    expect(collectSwitchFeedBody(shadowed('other-node'))).toBe(shadowSaid('Settings is live for another fleet node'));
  });

  it('safety-stopped names its reason from a total table', () => {
    const bodies = SAFETY_WHYS.map((why) => collectSwitchFeedBody(stopped(why)));
    for (const b of bodies) {
      expect(b.startsWith('the collector lane is now safety-stopped: '), b).toBe(true);
      expect(b.endsWith(', so the temp-root collector removes nothing until its control state is proved coherent.'), b)
        .toBe(true);
      expect(b, 'a reason missing from the table').not.toContain('undefined');
    }
    expect(new Set(bodies).size, 'each reason has its own words').toBe(SAFETY_WHYS.length);
    expect(collectSwitchFeedBody(stopped('generation-mismatch'))).toBe('the collector lane is now safety-stopped: its '
      + 'database and its monotonic journal disagree, so the temp-root collector removes nothing until its control state '
      + 'is proved coherent.');
  });

  it('the live/shadowed prefixes are kept', () => {
    for (const a of ['legacy-marker', 'settings', 'both'] as const) {
      expect(collectSwitchFeedBody(live(a)).startsWith('the collector lane is now live'), a).toBe(true);
    }
    for (const w of ['off', 'future-choice', 'other-node'] as const) {
      expect(collectSwitchFeedBody(shadowed(w)).startsWith('the collector lane is now shadowed'), w).toBe(true);
    }
    for (const w of SAFETY_WHYS) {
      const b = collectSwitchFeedBody(stopped(w));
      expect(b.startsWith('the collector lane is now live') || b.startsWith('the collector lane is now shadowed'), w).toBe(false);
    }
  });

  it('no body carries a detail, a path or the journal\'s basename', () => {
    const bodies = [...ALL_SETTLED.map(collectSwitchFeedBody), collectLatchFeedBody('collect sweep')];
    for (const b of bodies) {
      expect(b, 'a path character').not.toMatch(/[/\\~]/);
      expect(b, 'a file name').not.toMatch(/collect-lane-(?:generation|live)|\.log\b/);
      for (const tok of RAW_TOKENS) expect(b.includes(tok), `${tok} in ${b}`).toBe(false);
    }
    const planted = { kind: 'safety-stopped', why: 'journal-unreadable',
      detail: '/fixture-home/.ccrc/collect-lane-generation.log: EACCES' } as CollectLaneSettled;
    expect(collectSwitchFeedBody(planted), 'a field beside the reason is never read')
      .toBe(collectSwitchFeedBody(stopped('journal-unreadable')));
  });

  it('the latch body is the ruled sentence and the actor', () => {
    expect(collectLatchFeedBody('collect sweep')).toBe("the fleet box's legacy file was retired: Settings alone controls "
      + 'the collector now; by collect sweep');
  });

  it('COLLECT_SETTING_FEED_TITLE differs from the transition row\'s title', () => {
    expect(COLLECT_SETTING_FEED_TITLE).toBe('temp root collector setting changed');
    expect(COLLECT_SETTING_FEED_TITLE).not.toBe(COLLECT_FEED_TITLE.switch);
    expect(Object.values(COLLECT_FEED_TITLE)).not.toContain(COLLECT_SETTING_FEED_TITLE);
  });
});
