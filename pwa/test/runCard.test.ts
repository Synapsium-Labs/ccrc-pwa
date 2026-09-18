import { describe, it, expect } from 'vitest';
import { runCard } from '../src/fleet/runWords';

describe('runCard — which card a run renders on (board-placement wave 2, Task 4)', () => {
  const cardOf = new Map([['w1', 'coord-project'], ['w2', 'beta']]);

  it('is the WORKER session\'s card when the run is bound to a session on the list', () => {
    expect(runCard({ sessionId: 'w1', project: 'beta' }, cardOf)).toBe('coord-project');
  });
  it('falls back to the run\'s own project for a pending spawn — no session exists yet (rule 5)', () => {
    expect(runCard({ sessionId: null, project: 'beta' }, cardOf)).toBe('beta');
  });
  it('falls back to the run\'s own project when the bound session is not on the list this pass', () => {
    // Reaped, unmeasured, or an older snapshot: the run must not vanish.
    expect(runCard({ sessionId: 'gone', project: 'beta' }, cardOf)).toBe('beta');
  });
});
