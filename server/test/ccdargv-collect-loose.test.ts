// The loose collect's grants (fleet disk retention spec 2026-10-23 section 5, D-6626). Three argv builders for the
// loose arm ccd gained in D-6625, one capability row set, and the agent's two `ws-audit` grant prefixes. The verb rides
// the collector's existing `['ws-collect','--expect']` grant, so no third prefix exists.
import { describe, it, expect } from 'vitest';
import type { CollectToken } from '../../shared/api.js';
import {
  CCD_ARGV, CCD_CAN, COLLECT_CAP, COLLECT_LOOSE_CAP, ccdCan,
} from '../src/ccdargv.js';
import { EXEC_WHITELIST, isExecAllowed } from '../../agent/src/whitelist.js';
import type { FleetState } from '../src/fleetstate.js';

const stateOf = (v: readonly string[] | null): FleetState =>
  ({ connected: true, downSince: null, ccdVerbs: v === null ? null : [...v], rosterFp: null, build: null });
const TOKEN = 'a'.repeat(64) as CollectToken;
const HEX = Buffer.from('-rf', 'utf8').toString('hex');
const DEC = { surface: 'agent', actor: 'collect sweep', reason: null } as const;

describe('the loose collect argv builders', () => {
  it('the census is ws-audit --collect-census and nothing more', () => {
    expect([...CCD_ARGV.wsCollectCensus()]).toEqual(['ws-audit', '--collect-census']);
  });
  it('the audit names the entry as hex, then the mode flag ccd reads', () => {
    expect([...CCD_ARGV.wsCollectLooseAudit(HEX)]).toEqual(['ws-audit', '--loose-hex', HEX, '--collect']);
  });
  it('the verb leads with the token, binds the hex, and the dec trails', () => {
    expect([...CCD_ARGV.wsCollectLoose(TOKEN, HEX, null)]).toEqual(['ws-collect', '--expect', TOKEN, '--loose-hex', HEX]);
    const a = [...CCD_ARGV.wsCollectLoose(TOKEN, HEX, DEC)];
    expect(a.slice(0, 5)).toEqual(['ws-collect', '--expect', TOKEN, '--loose-hex', HEX]);
    expect(a.length).toBeGreaterThan(5);
  });
  it.each(['', 'ZZ', '-rf', 'abc', 'AB', '00 11', '..'])('a name that is not even-length lowercase hex (%j) is refused, never sent', (bad) => {
    expect(() => CCD_ARGV.wsCollectLooseAudit(bad)).toThrow();
    expect(() => CCD_ARGV.wsCollectLoose(TOKEN, bad, null)).toThrow();
  });
});

describe('the loose collect capability', () => {
  it('is spelled collect-loose-v1, the token ccd echoes', () => { expect(COLLECT_LOOSE_CAP).toBe('collect-loose-v1'); });
  it.each(['wsCollectCensus', 'wsCollectLooseAudit', 'wsCollectLoose'] as const)('%s refuses on no evidence and answers by the token', (row) => {
    expect(ccdCan(stateOf(null), row)).toBe(false);
    expect(ccdCan(undefined, row)).toBe(false);
    expect(ccdCan(stateOf([COLLECT_CAP, 'ws-audit']), row), 'collect-v1 is not collect-loose-v1').toBe(false);
    expect(ccdCan(stateOf([COLLECT_LOOSE_CAP]), row)).toBe(true);
    expect(CCD_CAN[row]).not.toBe('none');
  });
});

describe('the agent grants for the loose collect', () => {
  const ccd = (...a: string[]): boolean => isExecAllowed('ccd', a);
  it('grants the census and the loose audit by their own prefixes', () => {
    expect(EXEC_WHITELIST.ccd).toContainEqual(['ws-audit', '--collect-census']);
    expect(EXEC_WHITELIST.ccd).toContainEqual(['ws-audit', '--loose-hex']);
    expect(ccd(...CCD_ARGV.wsCollectCensus())).toBe(true);
    expect(ccd(...CCD_ARGV.wsCollectLooseAudit(HEX))).toBe(true);
  });
  it('the verb crosses the existing collect grant and no new prefix was added for it', () => {
    expect(ccd(...CCD_ARGV.wsCollectLoose(TOKEN, HEX, DEC))).toBe(true);
    expect(EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-collect')).toEqual([['ws-collect', '--expect']]);
  });
  it('a bare ws-audit, an unknown ws-audit flag and ws-collect without its token stay refused', () => {
    expect(ccd('ws-audit')).toBe(false);
    expect(ccd('ws-audit', '--loose')).toBe(false);
    expect(ccd('ws-collect', '--loose-hex', HEX)).toBe(false);
  });
});
