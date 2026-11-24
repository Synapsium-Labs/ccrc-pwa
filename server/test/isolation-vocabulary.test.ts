// The isolation word's vocabulary and the host report's one reader (Overlord W1, plan `w1-isolation.md` Task 1).
import { describe, expect, it } from 'vitest';
import {
  AGENT_HOST_RELATIONS, HOST_DIGEST_RE, ISOLATION_CAUSES, ISOLATION_UNMEASURED, ISOLATION_WORDS, readHostReport,
} from '../../shared/isolation.js';

const D_A = 'a'.repeat(64);
const D_B = 'b'.repeat(64);
const good = { uid: 2000, machine: D_A, boot: D_B };

describe('the isolation vocabulary', () => {
  it("ISOLATION_WORDS is exactly H28's three", () => {
    expect(ISOLATION_WORDS).toEqual(['shared-user', 'separate-user', 'separate-host']);
  });

  it('every word, cause, reason and relation is listed once', () => {
    for (const list of [ISOLATION_WORDS, ISOLATION_CAUSES, ISOLATION_UNMEASURED, AGENT_HOST_RELATIONS] as readonly (readonly string[])[]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(ISOLATION_CAUSES).toEqual(['local-mode', 'store-mode', 'root-agent', 'same-user', 'store-owner', 'other-user', 'other-host']);
    expect(ISOLATION_UNMEASURED).toEqual([
      'no-agent', 'link-down', 'agent-older', 'report-malformed', 'kernel-unproven', 'forwarded', 'host-unmeasured',
      'other-namespace', 'peer-uid-unmeasured', 'peer-uid-overflow', 'report-disagrees', 'server-namespace', 'server-facts', 'not-wired',
    ]);
    expect(AGENT_HOST_RELATIONS).toEqual(['same-host', 'other-host', 'unmeasured']);
  });

  it('HOST_DIGEST_RE takes 64 lowercase hex only', () => {
    expect(HOST_DIGEST_RE.test(D_A)).toBe(true);
    expect(HOST_DIGEST_RE.test('a'.repeat(63))).toBe(false);
    expect(HOST_DIGEST_RE.test('a'.repeat(65))).toBe(false);
    expect(HOST_DIGEST_RE.test('A'.repeat(64))).toBe(false);
  });
});

describe('readHostReport, the one reader of AgentReady.host', () => {
  it('reads an absent field as an older agent', () => {
    expect(readHostReport(undefined)).toBe('absent');
  });

  it('reads a well-formed report as itself', () => {
    expect(readHostReport(good)).toEqual(good);
    expect(readHostReport({ uid: 0, machine: D_A, boot: D_B })).toEqual({ uid: 0, machine: D_A, boot: D_B });
  });

  it("accepts 'unmeasured' in each field", () => {
    expect(readHostReport({ ...good, uid: 'unmeasured' })).toEqual({ ...good, uid: 'unmeasured' });
    expect(readHostReport({ ...good, machine: 'unmeasured' })).toEqual({ ...good, machine: 'unmeasured' });
    expect(readHostReport({ ...good, boot: 'unmeasured' })).toEqual({ ...good, boot: 'unmeasured' });
  });

  it('ignores an extra key (additive wire)', () => {
    expect(readHostReport({ ...good, future: 'x' })).toEqual(good);
  });

  const malformed: readonly [string, unknown][] = [
    ['null', null], ['a string', 'host'], ['a number', 7], ['an array', [2000, D_A, D_B]],
    ['no uid', { machine: D_A, boot: D_B }], ['no machine', { uid: 2000, boot: D_B }], ['no boot', { uid: 2000, machine: D_A }],
    ['a negative uid', { ...good, uid: -1 }], ['a fractional uid', { ...good, uid: 1.5 }], ['a string uid', { ...good, uid: '2000' }],
    ['an unsafe uid', { ...good, uid: 2 ** 53 }],
    ['a 63-character digest', { ...good, machine: 'a'.repeat(63) }], ['a 65-character digest', { ...good, boot: 'a'.repeat(65) }],
    ['an upper-case digest', { ...good, machine: 'A'.repeat(64) }], ['a numeric digest', { ...good, boot: 7 }],
    ['another word than unmeasured', { ...good, uid: 'unknown' }],
  ];
  for (const [name, raw] of malformed) {
    it(`reads ${name} as malformed`, () => { expect(readHostReport(raw)).toBe('malformed'); });
  }
});
