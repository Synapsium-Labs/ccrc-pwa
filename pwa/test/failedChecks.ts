// Every shape of an answered check that is not a pass (D-8051 (12)). The check route answers 200 with the lane whatever
// the probe found, so each sheet is held to these. The sentences are spelled here, not read from `checkedLine`, so a test
// that uses them can't agree with a wrong reader.
import type { LaneWire } from '../../shared/api';

const at = Date.now();
const lane = (word: 'signed-out' | 'inconclusive' | 'not-checked', check?: NonNullable<LaneWire['check']>): LaneWire => ({
  state: { word, source: 'as the box measured it' }, ready: false, notReadyReason: check === undefined ? 'not-checked' : 'check-failed',
  ...(check === undefined ? {} : { check }),
});

export const FAILED_CHECKS: ReadonlyArray<readonly [name: string, lane: LaneWire, line: string]> = [
  ['auth-dead', lane('signed-out', { verdict: 'auth-dead', at }),
    "The check did not pass: signed out. The provider refused this lane's credential, or it has none."],
  ['unreachable', lane('inconclusive', { verdict: 'unreachable', at }),
    "The check did not pass: it couldn't reach the provider. Nothing was learned about the credential; it may be fine."],
  ['no verdict at all', lane('not-checked'),
    'The check did not pass: the fleet host recorded no result. Nothing was learned about the credential; it may be fine.'],
];
