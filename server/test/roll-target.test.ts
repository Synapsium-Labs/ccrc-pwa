// Which sessions an AUTOMATIC roll may take (D-7443, the operator's rule of
// 2026-10-29): idle coordinators, always; any other session, never. A
// non-coordinator picks up a new release or binary only when it next starts
// for another reason. Pure: no fixture HOME, no process, no network.
import { describe, expect, it } from 'vitest';
import { sessionRoleOf, type ChildMark } from '../../shared/api.js';
import { CLAUDE_ROLL_TARGETS, CLAUDE_ROLL_TARGETS_DEFAULT } from '../../shared/claudeVersion.js';
import { ROLL_TARGET_SKIPS, rollTargetVerdict } from '../src/coord/rollTarget.js';

const NONE: ChildMark = { kind: 'none' };
const CHILD: ChildMark = { kind: 'child', runId: 7 };
const UNREADABLE: ChildMark = { kind: 'unreadable' };

describe('the roll-target vocabulary (D-7443)', () => {
  it('the rule is the default: automatic rolls take coordinators', () => {
    expect(CLAUDE_ROLL_TARGETS_DEFAULT).toBe('coordinators');
    expect([...CLAUDE_ROLL_TARGETS]).toEqual(['coordinators', 'all']);
  });

  it('every skip has a name the shadow log can print', () => {
    expect([...ROLL_TARGET_SKIPS]).toEqual(['role-unknown', 'not-coordinator', 'busy']);
  });
});

describe('rollTargetVerdict under the default (D-7443)', () => {
  const t = CLAUDE_ROLL_TARGETS_DEFAULT;

  it('an idle coordinator is rolled', () => {
    expect(rollTargetVerdict(t, { role: sessionRoleOf(NONE), idle: true })).toEqual({ take: true });
  });

  it('an idle worker is not rolled, and the skip says why', () => {
    expect(rollTargetVerdict(t, { role: sessionRoleOf(CHILD), idle: true })).toEqual({ take: false, skip: 'not-coordinator' });
  });

  it('a worker whose marker is unreadable is still a worker, and is not rolled', () => {
    expect(rollTargetVerdict(t, { role: sessionRoleOf(UNREADABLE), idle: true })).toEqual({ take: false, skip: 'not-coordinator' });
  });

  it('an operator-made session with no `.child` is a coordinator (D-5301) and is rolled when idle', () => {
    // The fleet has no third role: every session the operator creates is its
    // project's coordinator. So "never a non-coordinator" means never a child.
    expect(sessionRoleOf(NONE)).toBe('coordinator');
    expect(rollTargetVerdict(t, { role: 'coordinator', idle: true }).take).toBe(true);
  });

  it('a busy coordinator is not rolled', () => {
    expect(rollTargetVerdict(t, { role: 'coordinator', idle: false })).toEqual({ take: false, skip: 'busy' });
  });

  it('a busy worker is named for its role, not for being busy', () => {
    expect(rollTargetVerdict(t, { role: 'child', idle: false })).toEqual({ take: false, skip: 'not-coordinator' });
  });

  it('a row whose role is unknown is never rolled (fails closed)', () => {
    expect(rollTargetVerdict(t, { role: null, idle: true })).toEqual({ take: false, skip: 'role-unknown' });
  });
});

describe("rollTargetVerdict under 'all' (D-7443's setting)", () => {
  it('an idle worker is rolled', () => {
    expect(rollTargetVerdict('all', { role: 'child', idle: true })).toEqual({ take: true });
  });

  it('a busy worker is still not rolled', () => {
    expect(rollTargetVerdict('all', { role: 'child', idle: false })).toEqual({ take: false, skip: 'busy' });
  });

  it('an unknown role is still never rolled', () => {
    expect(rollTargetVerdict('all', { role: null, idle: true })).toEqual({ take: false, skip: 'role-unknown' });
  });
});
