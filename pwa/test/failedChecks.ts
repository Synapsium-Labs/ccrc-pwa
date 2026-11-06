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
    "The check did not pass: it couldn't reach the provider, or got a server error back. Nothing was learned about the credential; it may be fine."],
  ['timeout', lane('inconclusive', { verdict: 'timeout', at }),
    "The check did not pass: it didn't get an answer in time. Nothing was learned about the credential; it may be fine."],
  // Never "it may be fine": `classify` writes this for every provider answer it has no row for.
  ['unknown', lane('inconclusive', { verdict: 'unknown', at }),
    "The check did not pass: it got no answer ccrc can read as a pass or a refusal. Don't rely on the credential until a check passes."],
  ['no verdict at all', lane('not-checked'),
    'The check did not pass: the fleet host recorded no result. Nothing was learned about the credential; it may be fine.'],
];

/** A probe that passed and a seed that refused (D-8051 (18)): the verb exits 0, and the lane is not ready. */
export const SEED_UNVERIFIED: LaneWire = {
  state: { word: 'signed-in', source: 'checked just now', at }, ready: false, notReadyReason: 'seed-unverified', check: { verdict: 'ok', at },
};
export const SEED_UNVERIFIED_LINE = "✓ Checked: one test reply. Not ready: its first-run setup isn't verified since its last run. Check it again.";
