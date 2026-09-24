// The L0 summary clause (design 2026-09-20 §13; plan W3 Task 3, D-3301): the push body and
// the update banner both say what the nodes run through `versionsSummary`, so both forms are pinned here once.
import { describe, it, expect } from 'vitest';
import {
  MISSING_SIDE, UNVERSIONED_WORD, sideVersion, versionSides, versionsSummary, type SummaryRow,
} from '../../shared/update-summary.js';

const row = (role: string | null, version: string | null): SummaryRow => ({ role, version });

describe('versionsSummary — the clause the push body and the banner share', () => {
  it('one clause when both sides run the same tag', () => {
    expect(versionsSummary([row('server', 'v0.0.7'), row('fleet', 'v0.0.7')])).toBe('fleet and server are on v0.0.7');
    // order-independent: the fleet row listed first reads the same
    expect(versionsSummary([row('fleet', 'v0.0.7'), row('server', 'v0.0.7')])).toBe('fleet and server are on v0.0.7');
  });

  it('each side named when they differ — fleet first, then server', () => {
    expect(versionsSummary([row('server', 'v0.0.9'), row('fleet', 'v0.0.7')])).toBe('fleet v0.0.7 · server v0.0.9');
  });

  it('a missing side reads as the dash, never as agreement', () => {
    expect(versionsSummary([row('server', 'v0.0.7')])).toBe('fleet — · server v0.0.7');
    expect(versionsSummary([row('fleet', 'v0.0.7')])).toBe('fleet v0.0.7 · server —');
    expect(versionsSummary([])).toBe('fleet — · server —');
  });

  it('an unversioned side is named, and two unversioned sides never "agree"', () => {
    expect(versionsSummary([row('server', 'v0.0.7'), row('fleet', null)])).toBe('fleet unversioned · server v0.0.7');
    expect(versionsSummary([row('server', null), row('fleet', null)])).toBe('fleet unversioned · server unversioned');
  });

  it("local mode's one `both` row is both sides", () => {
    expect(versionsSummary([row('both', 'v0.0.7')])).toBe('fleet and server are on v0.0.7');
  });

  it('a row with no role, or a role outside the vocabulary, is on neither side', () => {
    expect(versionsSummary([row(null, 'v0.0.9'), row('mystery', 'v0.0.9'), row('server', 'v0.0.7')]))
      .toBe('fleet — · server v0.0.7');
  });
});

describe('versionSides and sideVersion', () => {
  it('server = the first server-or-both row; fleet = the first fleet row, else a both server row', () => {
    const s = row('server', 'v0.0.9'); const f = row('fleet', 'v0.0.7'); const b = row('both', 'v0.0.8');
    expect(versionSides([f, s])).toEqual({ fleet: f, server: s });
    expect(versionSides([b])).toEqual({ fleet: b, server: b });
    expect(versionSides([b, f])).toEqual({ fleet: f, server: b });   // a real fleet row beats the fallback
    expect(versionSides([s])).toEqual({ fleet: null, server: s });   // a server-role box is not the fleet
    expect(versionSides([])).toEqual({ fleet: null, server: null });
  });

  it('hands the caller its own row objects back (generic over the row type)', () => {
    const rows = [{ role: 'fleet', version: 'v0.0.7', label: 'fleet' }, { role: 'server', version: null, label: 'server' }];
    const sides = versionSides(rows);
    expect(sides.fleet).toBe(rows[0]);
    expect(sides.server?.label).toBe('server');
  });

  it('one side as text', () => {
    expect(sideVersion(null)).toBe(MISSING_SIDE);
    expect(sideVersion(row('fleet', null))).toBe(UNVERSIONED_WORD);
    expect(sideVersion(row('fleet', 'v0.0.10'))).toBe('v0.0.10');
    expect([MISSING_SIDE, UNVERSIONED_WORD]).toEqual(['—', 'unversioned']);
  });
});
