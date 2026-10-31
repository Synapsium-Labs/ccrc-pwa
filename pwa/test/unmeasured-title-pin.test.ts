// The unmeasured registry's sentence, pinned by its inputs and outputs (D-7570, ARCH-05): the chip's title and the
// row's `unreadable` marker read ONE spelling, wherever the word lives.
import { describe, expect, it } from 'vitest';
import { unmeasuredTitle } from '../src/fleet/unmeasuredWords';
import { markers, sessionFacts } from '../src/fleet/sessionFacts';
import { fleetSession } from './fleetFixture';

const now = Date.parse('2026-10-31T12:00:00Z');

describe('the unmeasured registry sentence', () => {
  it('names every unreadable field, slash-joined, and says it is retrying', () => {
    expect(unmeasuredTitle(['wrapper', 'workdir'])).toBe('registry wrapper/workdir temporarily unreadable — retrying');
    expect(unmeasuredTitle(['workdir'])).toBe('registry workdir temporarily unreadable — retrying');
  });

  it("the row's unreadable marker carries the same sentence as its title", () => {
    const facts = markers(sessionFacts({ session: fleetSession({ unmeasured: ['workdir'] }), now }));
    const unreadable = facts.find((f) => f.key === 'unreadable');
    expect(unreadable?.title).toBe(unmeasuredTitle(['workdir']));
  });
});
