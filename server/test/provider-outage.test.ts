// The provider outage's one notice, pure (plan docs/superpowers/plans/2026-11-25-provider-retry.md), and its durable mark.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  PROVIDER_OUTAGE_CLEAR_MS, PROVIDER_OUTAGE_SESSIONS, PROVIDER_OUTAGE_STUCK_MS, PROVIDER_OUTAGE_WINDOW_MS, outageProviderOf, providerOutageStep, type OwingSession, type ProviderOutages,
} from '../src/coord/providerOutage.js';
import { readOutageMarks, writeOutageMarks } from '../src/providerOutageMark.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const NONE: ProviderOutages = new Map();
const ANTHROPIC = outageProviderOf('lane-a', 'anthropic');
const owe = (n: number, at = NOW - MIN, provider = ANTHROPIC): OwingSession[] => Array.from({ length: n }, () => ({ provider, at, since: at }));
const step = (standing: ProviderOutages, owing: readonly OwingSession[], now = NOW) => providerOutageStep(standing, owing, now);

describe('the provider a lane runs on', () => {
  it('the Anthropic array and the Codex array are one provider each, any other lane its own', () => {
    expect(outageProviderOf('lane-a', 'anthropic')).toEqual({ key: 'anthropic', name: 'Anthropic' });
    expect(outageProviderOf('lane-b', 'anthropic')).toEqual(outageProviderOf('lane-a', 'anthropic'));
    expect(outageProviderOf('lane-c', 'codex')).toEqual({ key: 'codex', name: 'Codex' });
    for (const t of ['none', 'openrouter', undefined]) expect(outageProviderOf('lane-d', t)).toEqual({ key: 'lane:lane-d', name: 'lane-d' });
  });
});

describe('raised', () => {
  it('the numbers: three sessions, ten minutes, ten minutes, and one session stuck for an hour', () => {
    expect([PROVIDER_OUTAGE_SESSIONS, PROVIDER_OUTAGE_WINDOW_MS, PROVIDER_OUTAGE_CLEAR_MS, PROVIDER_OUTAGE_STUCK_MS]).toEqual([3, 10 * MIN, 10 * MIN, 60 * MIN]);
  });
  it('at three, not at two', () => {
    expect(step(NONE, owe(2)).notices).toEqual([]);
    const r = step(NONE, owe(3));
    expect(r.notices).toEqual([{ mode: 'push', key: 'anthropic', dedupeKey: `provider-outage:anthropic:${NOW}`, title: 'Anthropic is returning errors',
      body: '3 or more sessions stopped on a provider error within 10 minutes, or one has got past none for 60 minutes. ccrc keeps telling each one to continue. To stop waiting, move a session to another account.' }]);
    expect(r.next).toEqual(new Map([['anthropic', { since: NOW, lastOwedAt: NOW, name: 'Anthropic', offered: true }]]));
  });
  it('only failures inside the window count', () => {
    expect(step(NONE, [...owe(2), ...owe(1, NOW - PROVIDER_OUTAGE_WINDOW_MS)]).notices).toHaveLength(1);
    expect(step(NONE, [...owe(2), ...owe(1, NOW - PROVIDER_OUTAGE_WINDOW_MS - 1)]).notices).toEqual([]);
  });
  it('one session that has got past none of its failures for an hour raises it alone, and not a moment before', () => {
    const one = (since: number): OwingSession[] => [{ provider: ANTHROPIC, at: NOW - 20 * MIN, since }];
    expect(step(NONE, one(NOW - PROVIDER_OUTAGE_STUCK_MS + 1)).notices).toEqual([]);
    const r = step(NONE, one(NOW - PROVIDER_OUTAGE_STUCK_MS));
    expect(r.notices.map((n) => [n.mode, n.title])).toEqual([['push', 'Anthropic is returning errors']]);
    expect(step(r.next, one(NOW - PROVIDER_OUTAGE_STUCK_MS), NOW + 60 * MIN).notices).toEqual([]);
  });
  it('each provider on its own', () => {
    const codex = outageProviderOf('lane-c', 'codex');
    expect(step(NONE, [...owe(2), ...owe(2, NOW, codex)]).notices).toEqual([]);
    expect(step(NONE, [...owe(3), ...owe(3, NOW, codex)]).notices.map((n) => n.key)).toEqual(['anthropic', 'codex']);
  });
});

describe('standing and cleared', () => {
  const standing: ProviderOutages = new Map([['anthropic', { since: NOW, lastOwedAt: NOW, name: 'Anthropic', offered: true }]]);
  it('never raised twice while it stands, and one owing session keeps it', () => {
    const r = step(standing, owe(5), NOW + 5 * MIN);
    expect(r.notices).toEqual([]);
    expect(step(standing, owe(1, NOW), NOW + 60 * MIN).next.get('anthropic')!.lastOwedAt).toBe(NOW + 60 * MIN);
  });
  it('cleared, record-only, ten minutes after the last one owed and not a moment before', () => {
    expect(step(standing, [], NOW + PROVIDER_OUTAGE_CLEAR_MS - 1)).toEqual({ next: standing, notices: [] });
    const r = step(standing, [], NOW + PROVIDER_OUTAGE_CLEAR_MS);
    expect(r.next.size).toBe(0);
    expect(r.notices).toEqual([{ mode: 'record-only', key: 'anthropic', dedupeKey: `provider-outage:anthropic:${NOW}:clear`, title: 'Anthropic errors have stopped',
      body: 'No session has been waiting on a provider error for 10 minutes.' }]);
  });
});

describe('resumed after a restart', () => {
  it('its notice is offered once more under its first key, for the once-only read to drop, and then never again', () => {
    const resumed: ProviderOutages = new Map([['anthropic', { since: NOW, lastOwedAt: NOW + MIN, name: 'Anthropic', offered: false }]]);
    const r = step(resumed, owe(1), NOW + MIN);
    expect(r.notices.map((n) => [n.mode, n.dedupeKey])).toEqual([['push', `provider-outage:anthropic:${NOW}`]]);
    expect(step(r.next, owe(1), NOW + 2 * MIN).notices).toEqual([]);
    expect(step(resumed, [], NOW + MIN).next.get('anthropic')!.offered).toBe(true);
  });
});

describe('the durable mark', () => {
  it('round-trips, and none standing removes it', () => {
    const dir = path.join(mkTmp('ccrc-outage-'), '.ccrc');
    expect(readOutageMarks(dir)).toEqual([]);
    writeOutageMarks(dir, [{ key: 'anthropic', name: 'Anthropic', since: NOW }]);
    expect(readOutageMarks(dir)).toEqual([{ key: 'anthropic', name: 'Anthropic', since: NOW }]);
    writeOutageMarks(dir, []);
    expect(existsSync(path.join(dir, 'provider-outages.json'))).toBe(false);
  });
  it('a mark that is not one reads as none', () => {
    const dir = path.join(mkTmp('ccrc-outage-'), '.ccrc');
    mkdirSync(dir, { recursive: true });
    for (const bad of ['', 'torn', '{}', '[1]', '[{"key":"a"}]', '[{"key":1,"name":"a","since":1}]', '[{"key":"a","name":"b","since":"1"}]']) {
      writeFileSync(path.join(dir, 'provider-outages.json'), bad);
      expect(readOutageMarks(dir), bad).toEqual([]);
    }
  });
});
