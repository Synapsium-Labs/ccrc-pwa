// ARCH-62 (#797), slice 1 only: this is NOT the counted exit (the server equality-site census and the store's binding
// readers cut to <= 4 are later slices). It pins what slice 1 did: the store's session-keyed run readers are
// projections of ONE series read, decided through `bindingOf`/`claimantsOf`/`boundRunsOf` (coord/runBinding.ts) by
// coord/bindingRows.ts. A new reader of the run↔session link goes through `seriesRows`, or states why it is a
// different query here.
// Keyed on symbols (scan/symbols.ts), not on text, so a method that moves keeps its pin.
import { describe, expect, it } from 'vitest';
import { callsIn, parsedFile, sqlStatementsIn, symbolOf } from './scan/symbols.js';

const STORE = 'server/src/coord/store.ts';
const ROWS = 'server/src/coord/bindingRows.ts';

// The readers of the link, and the one SQL reader they share. `runsTouching` is the routing door's OR walk and
// `lastRunBySession` the last-closed query: different queries, kept (consolidation spec §3 K10).
const PROJECTIONS = ['bindingRunsOf', 'parentOfSession', 'openClaimantsOf', 'openRunsForSession', 'openRunsClaimedBy',
  'runsNamingSession'].map((n) => `CoordStore.${n}`);
const calls = (file: string, name: string): string[] => callsIn(symbolOf(file, name)).map((c) => c.callee);
const callsSeries = (text: string): boolean => /\bseriesRows\b/.test(text);

describe('the run↔session readers are projections of one series (ARCH-62)', () => {
  it('each projection reads through seriesRows and holds no SQL of its own', () => {
    for (const name of PROJECTIONS) {
      expect(calls(STORE, name).some(callsSeries), `${name} does not call seriesRows`).toBe(true);
      expect(sqlStatementsIn(symbolOf(STORE, name)), `${name} holds SQL`).toEqual([]);
    }
  });

  it('seriesRows is called by those projections and by nothing else', () => {
    const file = parsedFile(STORE);
    const all = file.calls.filter((c) => callsSeries(c.callee)).length;
    const inProjections = PROJECTIONS.reduce((n, name) => n + calls(STORE, name).filter(callsSeries).length, 0);
    expect(all).toBe(inProjections);
  });

  it('the projections decide through the binding, not an equality of their own', () => {
    const decide = [['parentFromRows', 'bindingOf'], ['claimantsFromRows', 'claimantsOf'], ['boundRows', 'boundRunsOf']] as const;
    for (const [fn, via] of decide) {
      expect(calls(ROWS, fn).some((t) => new RegExp(`\\b${via}\\b`).test(t)), `${fn} does not call ${via}`).toBe(true);
    }
  });
});
