// ARCH-62 (#797), the counted exit: the store's session-keyed run readers are projections of ONE series read, decided
// through `bindingOf`/`claimantsOf`/`boundRunsOf` (coord/runBinding.ts) by coord/bindingRows.ts. This is the pin: a new
// reader of the run↔session link goes through `seriesRows`, or states why it is a different query here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (rel: string): string => readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');
const store = src('coord/store.ts');

/** A method's text: its signature line to the first line that is a lone `  }`. */
function method(name: string): string {
  const at = store.search(new RegExp(`^  (?:private )?${name}\\(`, 'm'));
  expect(at, `${name} is a CoordStore method`).toBeGreaterThanOrEqual(0);
  return store.slice(at, store.indexOf('\n  }\n', at));
}

// The readers of the link, and the one SQL reader they share. `runsTouching` is the routing door's OR walk and
// `lastRunBySession` the last-closed query: different queries, kept (consolidation spec §3 K10).
const PROJECTIONS = ['bindingRunsOf', 'parentOfSession', 'openClaimantsOf', 'openRunsForSession', 'openRunsClaimedBy',
  'runsNamingSession'];

describe('the run↔session readers are projections of one series (ARCH-62)', () => {
  it('each projection reads through seriesRows and holds no SQL of its own', () => {
    for (const name of PROJECTIONS) {
      const body = method(name);
      expect(body, name).toMatch(/this\.seriesRows\(/);
      expect(body, name).not.toMatch(/FROM runs|\.prepare\(/);
    }
  });

  it('seriesRows is called by those projections and by nothing else', () => {
    const calls = [...store.matchAll(/this\.seriesRows\(/g)].length;
    const inProjections = PROJECTIONS.reduce((n, name) => n + [...method(name).matchAll(/this\.seriesRows\(/g)].length, 0);
    expect(calls).toBe(inProjections);
  });

  it('the projections decide through the binding, not an equality of their own', () => {
    const rows = src('coord/bindingRows.ts');
    for (const fn of ['bindingOf', 'claimantsOf', 'boundRunsOf']) expect(rows).toContain(fn);
    expect(rows).not.toMatch(/\.sessionId\s*===|\.claimedBy\s*===/);
  });
});
