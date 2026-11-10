import { describe, it, expect } from 'vitest';
import { MAIL_PACE, mailPaceRoleOf } from '../src/coord/mailPace.js';

describe('MAIL_PACE (Overlord spec §6.4, C24 and H19)', () => {
  it("holds today's two rows, and only them", () => {
    expect(MAIL_PACE).toEqual({
      worker: { quietMs: 60_000, cooldownMs: 120_000 },
      coordinator: { quietMs: 15_000, cooldownMs: 30_000 },
    });
  });
  it('a claimant of an open run reads the coordinator row; every other session the worker row', () => {
    const open = new Set(['lane-a-project-a']);
    expect(mailPaceRoleOf('lane-a-project-a', open)).toBe('coordinator');
    expect(mailPaceRoleOf('lane-b-project-a', open)).toBe('worker');
    expect(mailPaceRoleOf('lane-a-project-a', new Set())).toBe('worker');
  });
  it('each row keeps the cooldown longer than the quiet time', () => {
    for (const p of Object.values(MAIL_PACE)) expect(p.cooldownMs).toBeGreaterThan(p.quietMs);
  });
});
