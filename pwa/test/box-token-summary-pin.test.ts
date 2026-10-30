// D-7571 (ARCH-05): the characterization pin for the box-token words and the update tables the Settings section
// status reads. Written green against the words where they were defined before the move, so the move commits change
// only this file's import lines. `boxTokenSummary` is the Security section's verdict line (D-5503: never optimistic,
// so a tamper or leak signal is never folded under "Healthy"): one row per branch, each its exact text and tone.
import { describe, expect, it } from 'vitest';
import { BOX_TOKEN_PHASES, TOKEN_HOLDS } from '../../shared/box-token';
import type { BoxTokenPhase, TokenHold } from '../../shared/box-token';
import { boxTokenHoldText, boxTokenStateText, boxTokenSummary } from '../src/screens/settings/boxTokenWords';
import { AUTO_LABELS, CHANNEL_SENTENCES } from '../src/screens/settings/UpdatesSection';
import { readBoxTokenView as apiReader } from '../src/lib/api';
import { readBoxTokenView as leafReader } from '../src/lib/wireReaders';
import { boxToken } from './settingsViewFixture';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;
/** An idle, confirmed, healthy view at `NOW`: last rotated two days ago, nothing owed. */
const healthy = { lastRotationAt: NOW - 2 * DAY, currentSince: NOW - 2 * DAY } as const;

describe('boxTokenSummary: one row per branch, its exact text and tone (D-5503: never optimistic)', () => {
  const ROWS: ReadonlyArray<[string, Parameters<typeof boxToken>[0], { text: string; tone: string }]> = [
    ['failed is red, with its failure word', { phase: 'failed', lastFailure: 'timeout' },
      { text: 'Failed (timeout)', tone: 'red' }],
    ['held with a hold is amber, with the hold sentence', { phase: 'held', hold: 'link-down', holdNode: null },
      { text: 'Held: the agent link is down', tone: 'amber' }],
    ['handed-out is calm, the card\'s own sentence', { phase: 'handed-out' },
      { text: 'Rotating: waiting for the fleet box to confirm. The old key still works.', tone: 'calm' }],
    ['staged is calm, its state sentence', { phase: 'staged' },
      { text: 'Rotating (a new value is staged)', tone: 'calm' }],
    ['idle and behind is amber', { ...healthy, fleetConfirmed: 'behind' },
      { text: 'Behind: fleet not on the current generation', tone: 'amber' }],
    ['idle with a file problem is amber, never Healthy', { ...healthy, fileProblem: { at: NOW, file: 'current', word: 'changed' } },
      { text: 'Check: server token file current changed on re-read', tone: 'amber' }],
    ['idle with a retired value presented is amber, never Healthy', { ...healthy, retiredPresented: 2 },
      { text: 'Check: retired value presented 2 times', tone: 'amber' }],
    ['idle with a rotation owed is calm, naming the reason', { ...healthy, rotationOwed: true, owedWhy: 'code-used' },
      { text: 'Idle · rotation owed: code-used · fleet: confirmed the current generation', tone: 'calm' }],
    ['idle and unconfirmed is calm, naming the fleet word', { ...healthy, fleetConfirmed: 'unknown' },
      { text: 'Idle · fleet: not yet measured', tone: 'calm' }],
    ['healthy, with a future next rotation', { ...healthy, nextRotationAt: NOW + 5 * HOUR },
      { text: 'Healthy · rotated 2 days ago · next in 5 hours', tone: 'calm' }],
    ['healthy, with a next rotation in the past', { ...healthy, nextRotationAt: NOW - MIN },
      { text: 'Healthy · rotated 2 days ago · next due now', tone: 'calm' }],
    ['healthy, with a next rotation this build cannot place (no next clause)', { ...healthy, nextRotationAt: 1e20 },
      { text: 'Healthy · rotated 2 days ago', tone: 'calm' }],
    ['healthy over plain http says so beside the verdict', { ...healthy, fleetTransport: 'http' },
      { text: 'Healthy · rotated 2 days ago · transport http (unencrypted)', tone: 'calm' }],
  ];
  it.each(ROWS)('%s', (_title, over, want) => {
    expect(boxTokenSummary(boxToken(over), NOW)).toEqual(want);
  });
});

describe('the box-token state and hold sentences, every word', () => {
  const STATE: Record<BoxTokenPhase, string> = {
    unconfigured: 'no current value',
    idle: 'idle',
    staged: 'rotating (a new value is staged)',
    'handed-out': 'rotating (handed out, awaiting the fleet box)',
    promoting: 'rotating (promoting)',
    grace: 'grace (the previous value is still accepted)',
    held: 'held',
    failed: 'failed (unknown)',
  };
  it('boxTokenStateText says each phase in BOX_TOKEN_PHASES', () => {
    expect(Object.keys(STATE)).toEqual([...BOX_TOKEN_PHASES]);
    for (const phase of BOX_TOKEN_PHASES) expect(boxTokenStateText(boxToken({ phase })), phase).toBe(STATE[phase]);
  });

  const HOLD: Record<TokenHold, [string, string]> = {
    'update-in-flight': ['held: an update is in flight on a node', 'held: an update is in flight on node-a'],
    'agent-predates-op': ['held: fleet agent predates token-sync', 'held: fleet agent predates token-sync'],
    'verb-missing': ['held: release not yet on the fleet box (its ccrc has no token verb)',
      'held: release not yet on node-a (its ccrc has no token verb)'],
    'stale-client': ['held: a stale ccrc-api on the fleet box', 'held: a stale ccrc-api on node-a'],
    'fleet-rows': ['held: not exactly one reachable fleet node', 'held: not exactly one reachable fleet node'],
    'node-id-unmeasured': ['held: the node id of the fleet box is not measured', 'held: the node id of node-a is not measured'],
    'link-down': ['held: the agent link is down', 'held: the agent link is down'],
    'pending-cap': ['held: the handed-out values at the cap still await confirmation',
      'held: the handed-out values at the cap still await confirmation'],
    'no-coord': ['held: no coordination database', 'held: no coordination database'],
    'role-unrecorded': ["held: this box's role is not recorded as both (CCRC_ROLE in ~/.ccrc/ccrc.env)",
      "held: this box's role is not recorded as both (CCRC_ROLE in ~/.ccrc/ccrc.env)"],
    'mint-failed': ['held: the server could not mint a value', 'held: the server could not mint a value'],
  };
  it('boxTokenHoldText says each hold in TOKEN_HOLDS, with and without a node', () => {
    expect(Object.keys(HOLD)).toEqual([...TOKEN_HOLDS]);
    for (const hold of TOKEN_HOLDS) {
      expect(boxTokenHoldText(hold, null), hold).toBe(HOLD[hold][0]);
      expect(boxTokenHoldText(hold, 'node-a'), hold).toBe(HOLD[hold][1]);
    }
  });
});

describe('the update tables the Updates line reads', () => {
  it('AUTO_LABELS and CHANNEL_SENTENCES are exactly their words', () => {
    expect(AUTO_LABELS).toEqual({ off: 'Off', stable: 'On the Stable channel only', channel: 'On any channel' });
    expect(CHANNEL_SENTENCES).toEqual({ stable: 'Stable', dev: 'Dev' });
  });
});

describe('the box-token view has one reader', () => {
  it('lib/api.ts re-exports the readBoxTokenView that lib/wireReaders.ts defines (one binding)', () => {
    expect(apiReader).toBe(leafReader);
  });
});
