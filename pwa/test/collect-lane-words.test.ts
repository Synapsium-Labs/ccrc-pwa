// collectLaneWords — the Temp root collector section's words (path-identity spec 2026-10-12 §5.7). The spec's own
// sentences are pinned exactly. Every warn line is pinned to exactly the condition that states it. The source scans
// hold the spec's "no string names a device" and "the PWA never spells the marker's name", and the rule that the PWA
// counts nothing: no file here reads an attention word.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLLECT_LANE_REFUSALS, type CollectLaneConfirmRequired, type CollectLaneView } from '../../shared/api';
import {
  COLLECT_ARMED_BY_TEXT, COLLECT_CONFIRM_TEXT, COLLECT_COUNT_TEXT, COLLECT_OFF_NOTE_TEXT, COLLECT_PAUSE_TEXT,
  COLLECT_REFUSAL_TEXT, COLLECT_SECTION_TEXT, COLLECT_STATE_TEXT, COLLECT_STORED_FAULT_TEXT, COLLECT_WARN_TEXT,
  collectConfirmLines, collectCountLine, collectNowLines, collectOffNote, collectOffersReconfirm, collectStateHead,
  collectUnmeasurableLines,
} from '../src/fleet/collectLaneWords';
import { UNCONFIRMED_TEXT } from '../src/screens/settingsText';

const view = (over: Partial<CollectLaneView> = {}): CollectLaneView => ({
  stored: { read: 'row', choice: 'live', fleetNodeId: 'node-a', markerRetiredAt: null, generation: 1, updatedAt: 1_000 },
  journal: { read: 'ok', max: 1 },
  control: { state: 'coherent', bootstrap: false },
  effective: { state: 'live', armedBy: 'both' },
  marker: { listing: 'stands', latch: 'unset' },
  node: { state: 'known', nodeId: 'node-a', measuredAt: 5_000, stored: 'this' },
  caps: { collect: true, reclaimPause: true },
  attention: { wouldCollect: 2, held: 1, boxLines: 0 },
  remedy: null,
  notice: null,
  ...over,
});

const facts = (over: Partial<CollectLaneConfirmRequired['facts']> = {}): CollectLaneConfirmRequired['facts'] => ({
  node: { nodeId: 'node-a', measuredAt: 5_000 },
  caps: { collect: true, reclaimPause: true },
  paused: false,
  marker: 'stands',
  repair: null,
  attention: { wouldCollect: 2, held: 1, boxLines: 0 },
  ...over,
});

const warns = (v: CollectLaneView): string[] => collectNowLines(v).filter((l) => l.tone === 'warn').map((l) => l.text);
const OFF_ROW = { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: 7, generation: 2, updatedAt: 9 } as const;

describe('the words (path-identity spec §5.7)', () => {
  it("each state's label and line are the spec's exact text", () => {
    expect(COLLECT_STATE_TEXT).toEqual({
      live: { label: 'Live', line: 'removes an orphaned temp root only after two licensed observations.' },
      shadowed: { label: 'Shadowed', line: 'reports what it would remove and removes nothing.' },
      paused: { label: 'Stopped - cleanup paused', line: 'the broad cleanup pause stands.' },
      'safety-stopped': { label: 'Safety-stopped', line: 'collector control state cannot be proved coherent; removes nothing.' },
      'not-running': { label: 'Not running', line: 'the fleet box lacks collect-v1 or reclaim-pause-v1.' },
      'unknown-fleet': { label: 'Unknown fleet', line: 'the registry, connection epoch or current node cannot be measured.' },
    });
    for (const state of Object.keys(COLLECT_STATE_TEXT) as Array<keyof typeof COLLECT_STATE_TEXT>) {
      const head = `${COLLECT_STATE_TEXT[state].label}: ${COLLECT_STATE_TEXT[state].line}`;
      expect(collectStateHead(state)).toBe(head);
      const armedBy = state === 'live' ? 'settings' : 'neither';
      expect(collectNowLines(view({ effective: { state, armedBy } }))[0], state).toEqual({ text: head, tone: 'head' });
    }
    expect(COLLECT_SECTION_TEXT.title).toBe('Temp root collector');
  });

  it('each armedBy line', () => {
    expect(COLLECT_ARMED_BY_TEXT).toEqual({
      settings: 'Armed by: Settings.',
      'legacy-marker': "Armed by: the fleet box's legacy file.",
      both: "Armed by: both Settings and the fleet box's legacy file, during the handoff.",
      neither: 'Armed by: neither.',
    });
    for (const armedBy of ['settings', 'legacy-marker', 'both'] as const) {
      expect(collectNowLines(view({ effective: { state: 'live', armedBy } }))[1]).toEqual({ text: COLLECT_ARMED_BY_TEXT[armedBy], tone: 'note' });
    }
    expect(collectNowLines(view({ effective: { state: 'shadowed', armedBy: 'neither' } }))[1])
      .toEqual({ text: 'Armed by: neither.', tone: 'note' });
  });

  it('each warn line appears exactly when its condition holds', () => {
    expect(COLLECT_WARN_TEXT.recreated).toBe("The fleet box's legacy file was re-created; this server no longer honours it.");
    expect(COLLECT_WARN_TEXT.mismatch).toBe('The collector is safety-stopped because its database and monotonic journal disagree.');
    const cases: Array<[string, CollectLaneView, string[]]> = [
      ['a coherent live view for this node', view(), []],
      ['the file stands with the latch set', view({ marker: { listing: 'stands', latch: 'set' } }), [COLLECT_WARN_TEXT.recreated]],
      ['the file stands with the latch unset', view({ marker: { listing: 'stands', latch: 'unset' } }), []],
      ['the file stands with the latch unmeasured', view({ marker: { listing: 'stands', latch: 'unmeasured' } }), []],
      ['the file absent with the latch set', view({ marker: { listing: 'absent', latch: 'set' } }), []],
      ['stored live for another node', view({ node: { state: 'known', nodeId: 'node-b', measuredAt: 9_000, stored: 'other' } }),
        [COLLECT_WARN_TEXT.otherNode]],
      ['stored off beside another node', view({ stored: OFF_ROW, node: { state: 'known', nodeId: 'node-b', measuredAt: 9_000, stored: 'other' } }), []],
      ['stored live with the node unmeasured', view({ node: { state: 'unmeasured', stored: 'set' } }), []],
      ['a mismatch', view({ control: { state: 'mismatch', journal: 'behind' } }), [COLLECT_WARN_TEXT.mismatch]],
      ['a token this build does not know', view({ stored: { ...OFF_ROW, choice: 'LIVE' } }), [COLLECT_WARN_TEXT.unknownChoice]],
      ['a malformed stored row', view({ stored: { read: 'malformed' } }), [COLLECT_STORED_FAULT_TEXT.malformed]],
      ['an unreadable stored row', view({ stored: { read: 'unreadable' } }), [COLLECT_STORED_FAULT_TEXT.unreadable]],
      ["the server's remedy", view({ remedy: 'Raise the cleanup pause first.' }), ['Raise the cleanup pause first.']],
    ];
    for (const [name, v, want] of cases) expect(warns(v), name).toEqual(want);
  });

  it('a GET 503 state-unmeasurable reads as the Safety-stopped head and the detail', () => {
    expect(collectUnmeasurableLines('the switch row is absent')).toEqual([
      { text: collectStateHead('safety-stopped'), tone: 'head' },
      { text: "The server could not measure the collector's state: the switch row is absent", tone: 'warn' },
    ]);
  });

  it('collectOffNote by latch and listing', () => {
    expect(COLLECT_OFF_NOTE_TEXT.stands).toBe(
      "The fleet box's legacy file still controls this lane. Remove it by hand before Settings can turn the collector off.");
    expect(collectOffNote(view({ marker: { listing: 'stands', latch: 'set' } }))).toBeNull();
    expect(collectOffNote(view({ marker: { listing: 'absent', latch: 'set' } }))).toBeNull();
    expect(collectOffNote(view({ marker: { listing: 'stands', latch: 'unset' } }))).toBe(COLLECT_OFF_NOTE_TEXT.stands);
    expect(collectOffNote(view({ marker: { listing: 'absent', latch: 'unset' } }))).toBe(COLLECT_OFF_NOTE_TEXT.absent);
    expect(collectOffNote(view({ marker: { listing: 'unmeasured', latch: 'unset' } }))).toBe(COLLECT_OFF_NOTE_TEXT.unmeasured);
    expect(collectOffNote(view({ marker: { listing: 'stands', latch: 'unmeasured' } })), 'a latch that did not read claims no control')
      .toBe(COLLECT_OFF_NOTE_TEXT.unmeasured);
    expect(new Set(Object.values(COLLECT_OFF_NOTE_TEXT)).size).toBe(3);
  });

  it('collectOffersReconfirm for other-node and mismatch only', () => {
    const other = { state: 'known', nodeId: 'node-b', measuredAt: 9_000, stored: 'other' } as const;
    expect(collectOffersReconfirm(view({ node: other }))).toBe(true);
    expect(collectOffersReconfirm(view({ control: { state: 'mismatch', journal: 'ahead' } }))).toBe(true);
    expect(collectOffersReconfirm(view({ stored: OFF_ROW, control: { state: 'mismatch', journal: 'behind' } }))).toBe(true);
    expect(collectOffersReconfirm(view())).toBe(false);
    expect(collectOffersReconfirm(view({ stored: OFF_ROW, node: other }))).toBe(false);
    expect(collectOffersReconfirm(view({ node: { state: 'unmeasured', stored: 'set' } }))).toBe(false);
    expect(collectOffersReconfirm(view({ node: { state: 'collision', stored: 'set' } }))).toBe(false);
    expect(collectOffersReconfirm(view({ control: { state: 'unmeasurable' } }))).toBe(false);
  });

  it('the confirm lines name the node, freshness, both capabilities, the counts, the checklist, the marker and the repair; the stale lead only when stale', () => {
    const now = 5_000 + 5 * 60_000;
    const plain = collectConfirmLines(facts(), false, now);
    expect(plain).toEqual([
      "Fleet node node-a, measured on this server's current connection 5m ago.",
      COLLECT_CONFIRM_TEXT.capsBoth,
      '2 would be collected, 1 held, 0 box-wide lines on Runs.',
      ...COLLECT_CONFIRM_TEXT.checklist,
      COLLECT_CONFIRM_TEXT.markerStands,
    ]);
    expect(COLLECT_CONFIRM_TEXT.checklist).toHaveLength(3);
    expect(plain).not.toContain(COLLECT_CONFIRM_TEXT.staleLead);
    expect(plain).not.toContain(COLLECT_CONFIRM_TEXT.repair);
    expect(plain).not.toContain(COLLECT_CONFIRM_TEXT.paused);
    const stale = collectConfirmLines(facts(), true, now);
    expect(stale[0]).toBe(COLLECT_CONFIRM_TEXT.staleLead);
    expect(stale.slice(1)).toEqual(plain);
    expect(collectConfirmLines(facts({ repair: 'journal-behind' }), false, now).at(-1)).toBe(COLLECT_CONFIRM_TEXT.repair);
    expect(collectConfirmLines(facts({ repair: 'journal-ahead' }), false, now).at(-1)).toBe(COLLECT_CONFIRM_TEXT.repair);
    expect(collectConfirmLines(facts({ caps: { collect: false, reclaimPause: true } }), false, now)[1]).toBe(COLLECT_CONFIRM_TEXT.capsNoCollect);
    expect(collectConfirmLines(facts({ caps: { collect: true, reclaimPause: false } }), false, now)[1]).toBe(COLLECT_CONFIRM_TEXT.capsNoReclaimPause);
    expect(collectConfirmLines(facts({ caps: { collect: false, reclaimPause: false } }), false, now)[1]).toBe(COLLECT_CONFIRM_TEXT.capsNeither);
    expect(collectConfirmLines(facts({ paused: true }), false, now)[2]).toBe(COLLECT_CONFIRM_TEXT.paused);
    expect(collectConfirmLines(facts({ marker: 'absent' }), false, now).at(-1)).toBe(COLLECT_CONFIRM_TEXT.markerAbsent);
    expect(collectConfirmLines(facts({ attention: null }), false, now)[2]).toBe(COLLECT_COUNT_TEXT.unmeasured);
    expect(collectConfirmLines(facts(), false, 5_000 + 2 * 3_600_000)[0])
      .toBe("Fleet node node-a, measured on this server's current connection 2h ago.");
  });

  it('the count line, and the not-measured line', () => {
    expect(collectCountLine({ wouldCollect: 3, held: 2, boxLines: 0 })).toBe('3 would be collected, 2 held, 0 box-wide lines on Runs.');
    expect(collectCountLine({ wouldCollect: 1, held: 0, boxLines: 1 })).toBe('1 would be collected, 0 held, 1 box-wide line on Runs.');
    expect(collectCountLine(null)).toBe('Counts are not measured yet.');
    expect(COLLECT_COUNT_TEXT.unmeasured).toBe('Counts are not measured yet.');
  });

  it('"Pause all cleanup" names all four lanes', () => {
    expect(COLLECT_PAUSE_TEXT.label).toBe('Pause all cleanup');
    for (const lane of ['child reclamation', 'archived-workspace expiry', 'the dead-coordinator lane', 'this collector']) {
      expect(COLLECT_PAUSE_TEXT.stops, lane).toContain(lane);
    }
    expect(Object.values(COLLECT_PAUSE_TEXT).join(' ')).not.toMatch(/Resume cleanup/);
  });

  it('the not-available line is exactly "Not available on this server."', () => {
    expect(COLLECT_SECTION_TEXT.notAvailable).toBe('Not available on this server.');
    expect(COLLECT_REFUSAL_TEXT['not-configured']).toBe('Not available on this server.');
  });

  it('the write line for an answer that did not arrive, or was not one this section knows', () => {
    expect(COLLECT_SECTION_TEXT.unanswered)
      .toBe("The server's answer did not arrive, or was not one this section knows, so the choice may or may not have been saved; the section re-read it.");
    expect(COLLECT_SECTION_TEXT.unanswered, 'its own line, never the 2xx one').not.toBe(UNCONFIRMED_TEXT);
    expect(COLLECT_SECTION_TEXT.unanswered).not.toMatch(/Nothing was changed/);
    expect(Object.keys(COLLECT_SECTION_TEXT), 'no line for a refusal whose code this build does not know')
      .not.toContain('refused');
  });

  it('every refusal word has its own sentence, and the pre-latch refusal is the spec text', () => {
    expect(Object.keys(COLLECT_REFUSAL_TEXT).sort()).toEqual([...COLLECT_LANE_REFUSALS].sort());
    for (const code of COLLECT_LANE_REFUSALS) expect(COLLECT_REFUSAL_TEXT[code].trim().length, code).toBeGreaterThan(0);
    expect(COLLECT_REFUSAL_TEXT['marker-still-controls']).toBe(COLLECT_OFF_NOTE_TEXT.stands);
  });
});

describe('source scans (path-identity spec §5.7)', () => {
  const read = (...p: string[]): string => readFileSync(path.join(import.meta.dirname, '..', 'src', ...p), 'utf8');
  const FILES: Array<[string, string]> = [
    ['lib/notAvailable.ts', read('lib', 'notAvailable.ts')],
    ['fleet/useCollectLaneView.ts', read('fleet', 'useCollectLaneView.ts')],
    ['fleet/collectLaneWords.ts', read('fleet', 'collectLaneWords.ts')],
  ];
  const DEVICE_WORD = /\b(phones?|mobiles?|desktops?|tablets?|laptops?|iphones?|ipads?|android|touchscreens?|handsets?)\b/i;
  const DEVICE_BRANCH = /matchMedia|useMediaQuery|userAgent|maxTouchPoints|ontouchstart|pointer:\s*coarse|innerWidth/;

  it('no device word or device branch in the three new files', () => {
    for (const [name, src] of FILES) {
      expect(src, name).not.toMatch(DEVICE_BRANCH);
      expect(src, name).not.toMatch(DEVICE_WORD);
    }
  });

  it('no marker name', () => {
    const marker = ['collect', 'lane', 'live'].join('-');   // assembled, so this file does not spell it either
    for (const [name, src] of FILES) expect(src, name).not.toContain(marker);
  });

  it('no switch on attention words', () => {
    for (const [name, src] of FILES) {
      expect(src, name).not.toMatch(/['"`](?:would-collect|held|unvouched|kept-many)['"`]/);
      expect(src, name).not.toMatch(/childReclaimAttention|\.word\b/);
    }
  });
});
