import { describe, it, expect } from 'vitest';
import { runCard } from '../src/fleet/runWords';

describe('runCard — which card a run renders on (board-placement wave 2, Task 4)', () => {
  const cardOf = new Map([['w1', 'coord-project'], ['w2', 'beta'], ['c1', 'alpha']]);

  it('is the WORKER session\'s card when the run is bound to a session on the list', () => {
    expect(runCard({ sessionId: 'w1', claimedBy: 'c1', project: 'beta' }, cardOf)).toBe('coord-project');
  });
  it('a pending spawn takes its COORDINATOR\'s card — the phantom follows the row the worker will render on', () => {
    // The cross-repo shape the old `run.project` arm got wrong: the coordinator
    // renders on `alpha`, the wave works in `beta`, and the phantom belongs
    // under the coordinator — the same card the bound worker reaches a moment
    // later, so the row never jumps between cards as the dispatch completes.
    expect(runCard({ sessionId: null, claimedBy: 'c1', project: 'beta' }, cardOf)).toBe('alpha');
  });
  it('falls back to the run\'s own project for a pending spawn that names NOBODY — nothing routable exists', () => {
    // A reconstructed, ownerless row (`claimedBy` NULL, store.ts's D-12 class):
    // no session and no claimant, so `run.project` is the only answer there is.
    expect(runCard({ sessionId: null, claimedBy: null, project: 'beta' }, cardOf)).toBe('beta');
  });
  it('falls back to the run\'s own project when the COORDINATOR is not on the list this pass', () => {
    // Same absence the worker arm tolerates, one role over: a coordinator the
    // fleet list does not carry (reaped, unmeasured, an older snapshot) must
    // not make the phantom vanish.
    expect(runCard({ sessionId: null, claimedBy: 'gone-coord', project: 'beta' }, cardOf)).toBe('beta');
  });
  it('falls back to the run\'s own project when the bound session is not on the list this pass', () => {
    // Reaped, unmeasured, or an older snapshot: the run must not vanish. And
    // NOT the coordinator's card, although `c1` is routable here: a BOUND run
    // is about its worker, and rendering it under a coordinator whose worker
    // the board cannot see would draw an edge to a row that is not there.
    expect(runCard({ sessionId: 'gone', claimedBy: 'c1', project: 'beta' }, cardOf)).toBe('beta');
  });
});
