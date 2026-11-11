import { describe, expect, it } from 'vitest';
import { sessionRoleOf, type ChildMark } from '../../shared/api.js';
import { rollTargetVerdict } from '../src/coord/rollTarget.js';

const MARKS: readonly [ChildMark, 'coordinator' | 'child'][] = [
  [{ kind: 'none' }, 'coordinator'],
  [{ kind: 'child', runId: 7 }, 'child'],
  [{ kind: 'child', runId: 9_999_999_999 }, 'child'],
  [{ kind: 'unreadable' }, 'child'],
];

describe('SessionRole today (characterization, before the role vocabulary)', () => {
  it('no .child is a coordinator; a child and an unreadable marker are children', () => {
    for (const [mark, want] of MARKS) expect(sessionRoleOf(mark)).toBe(want);
  });
  it('the roll lane takes exactly the coordinator answer', () => {
    for (const [mark, want] of MARKS) {
      expect(rollTargetVerdict('coordinators', sessionRoleOf(mark)))
        .toEqual(want === 'coordinator' ? { take: true } : { take: false, skip: 'not-coordinator' });
    }
  });
});
