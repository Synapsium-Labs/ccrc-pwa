// Task Q3g's skew rows (D-7031; spec §5.1 rule 1c; plan 2026-10-26-consolidation-w3-questions.md, Task Q3g). The
// `pairing` field is optional, sits at the frame's top level and has no reader before W7, so:
//  - an OLD client and the new server: the frames the new server sends, `pairing` and all, folded through the PWA's
//    reducer (`pwa/src/stores/session.ts#applySessionMsg`, imported dynamically by path and never edited) give the same
//    snapshot after every frame as the same frames without it, and that snapshot holds no `pairing` anywhere. The old
//    reducer's `dialog` arm keeps `msg.dialog`, so a `pairing` placed inside `dialog` would reach the snapshot and red
//    this row;
//    C7f (D-7184) gives the reducer its reader: it keeps the frames' `pairing` at the snapshot's top level, and nothing
//    else. So the fold compares the snapshots with that one key set aside, and the rest of the snapshot, `dialog`
//    included, must still hold no `pairing` anywhere (the inside-`dialog` guard this row exists for);
//  - a NEW client and an old server: a frame without `pairing` is the pre-W3 frame byte for byte (no key, not even an
//    undefined one), and the frames that carry it are those bytes plus the one top-level key.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionStreamMsg } from '../../shared/api.js';
import { SCENARIOS, TRANSCRIPT_SEQUENCES, runScenario, withoutPairing, type Scenario } from './askPairingStream.js';

// Task C7q (D-7206, D-7211): the transcript-copy states and the frame sequences join the scenarios, so an old client
// folds the copy's pairing, `ask_cleared`'s included, to the snapshot it folds without it.
const TRANSCRIPT_STATES: readonly Scenario[] = [
  { name: 'a copy on the second question\'s screen, no envelope', steps: [{ pane: 'cc300-ask-q2-of-2-single', envelope: null, copy: 'FRUIT_DRINK' }] },
  { name: 'a copy under the free-text row, no envelope', steps: [{ pane: 'cc300-ask-freetext-held', envelope: null, copy: 'FRUIT_DRINK' }] },
  { name: 'an approval under a menu with a copy', steps: [
    { pane: 'cc300-ask-1q-open', envelope: 'APPROVAL', copy: 'COLOUR_ONE' },
    { pane: 'cc300-ask-1q-open', envelope: null, copy: 'COLOUR_ONE' },
  ] },
];
const ALL: readonly Scenario[] = [...SCENARIOS, ...TRANSCRIPT_STATES, ...TRANSCRIPT_SEQUENCES];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Snapshot = Record<string, unknown>;
interface Store { applySessionMsg(s: Snapshot, m: SessionStreamMsg): Snapshot }
const store = async (): Promise<Store> => await import(path.join(ROOT, 'pwa/src/stores/session.ts')) as Store;

/** A fresh client's snapshot: no menu, no envelope, nothing read yet. */
const EMPTY: Snapshot = {
  events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null, dialog: null, ask: null, tasks: [],
  tasksTouchedAt: undefined, mail: [], askFrameSeen: false, workflows: [], workflowsUnreadable: false, missingFile: null,
  strandedAccount: null, searchComplete: true, fileMeasured: true, file: null,
};

describe('the pairing field across a version skew (Task Q3g, rule 1c)', () => {
  it.each(ALL.map((sc) => [sc.name, sc] as const))('old client, new server: %s folds to the same snapshot', async (_n, sc) => {
    const { applySessionMsg } = await store();
    const frames = (await runScenario(sc)).map((f) => f.frame);
    let withField = EMPTY;
    let without = EMPTY;
    /** The snapshot with the reducer's own top-level `pairing` (C7f's reader) set aside. */
    const rest = (snap: Snapshot): Snapshot => {
      const { pairing: _p, ...others } = snap;
      return others;
    };
    for (const f of frames) {
      withField = applySessionMsg(withField, f);
      without = applySessionMsg(without, withoutPairing(f));
      expect(rest(withField), `${sc.name}: after ${f.type}`).toEqual(rest(without));
      expect(JSON.stringify(rest(withField)), `${sc.name}: after ${f.type}, no pairing outside the top-level field`).not.toContain('"pairing":');
    }
  }, 30_000);

  it('old client, new server: some frame of the corpus carries the field, so the fold above compares something', async () => {
    const carried = (await Promise.all(SCENARIOS.map(runScenario))).flat().filter(({ frame }) => 'pairing' in frame);
    expect(carried.length).toBeGreaterThan(0);
  }, 60_000);

  it.each(ALL.map((sc) => [sc.name, sc] as const))('new client, old server: %s, a frame without pairing is the pre-W3 frame', async (_n, sc) => {
    for (const { frame } of await runScenario(sc)) {
      const bytes = JSON.stringify(frame);
      const old = JSON.stringify(withoutPairing(frame));
      if ('pairing' in frame) {
        const { pairing } = frame as { pairing: unknown };
        expect(pairing, `${sc.name}: ${frame.type} carries a defined pairing or none`).toBeDefined();
        expect(JSON.parse(bytes)).toEqual({ ...JSON.parse(old), pairing: JSON.parse(JSON.stringify(pairing)) });
        expect(old, `${sc.name}: ${frame.type}: the field sits at the top level only, never inside dialog`).not.toContain('"pairing":');
      } else {
        expect(bytes, `${sc.name}: ${frame.type}`).toBe(old);
      }
    }
  }, 30_000);

  it('old client, new server (C7q): the transcript states carry the copy\'s pairing on dialog and on ask_cleared, so the fold above compares it', async () => {
    const carried = (await Promise.all([...TRANSCRIPT_STATES, ...TRANSCRIPT_SEQUENCES].map(runScenario))).flat()
      .filter(({ frame }) => (frame as { pairing?: { from?: string } }).pairing?.from === 'transcript');
    expect(new Set(carried.map(({ frame }) => frame.type))).toEqual(new Set(['dialog', 'ask', 'ask_cleared']));
  }, 60_000);
});
