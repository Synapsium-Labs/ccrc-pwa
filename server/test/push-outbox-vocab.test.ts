// The push outbox's L0 vocabulary (Overlord W1, the push outbox, Task 2: plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md): the states, the moves with their actors, and the
// bounds.
import { describe, expect, it } from 'vitest';
import {
  OUTBOX_ACTORS, OUTBOX_KEEP_MS, OUTBOX_RETRY_BASE_MS, OUTBOX_SOURCES, OUTBOX_RETRY_HORIZON_MS, OUTBOX_SEND_DEADLINE_MS, OUTBOX_STATES,
  OUTBOX_SUB_TIMEOUT_MS, OUTBOX_TRANSITIONS, PUSH_ID_BYTES, PUSH_SILENT_WHYS, SUBSCRIPTION_VERDICTS,
  TERMINAL_OUTBOX_STATES, outboxMoveAllowed, type OutboxActor, type OutboxState,
} from '../../shared/push-outbox.js';

const ACTORS: readonly OutboxActor[] = OUTBOX_ACTORS;
// Written out, never read back from the table: each line is a move the plan names.
const ALLOWED: readonly string[] = [
  'null>pending:raise', 'null>silent:raise', 'null>sending:sender', 'null>silent:sender',
  'pending>sending:sender', 'retrying>sending:sender', 'pending>silent:sender', 'retrying>silent:sender',
  'sending>sent:sender', 'sending>retrying:sender', 'sending>unsent:sender', 'sending>failed:sender',
  'sending>unknown:sender', 'sending>unknown:boot', 'pending>failed:boot', 'retrying>failed:boot',
  'null>pending:arm', 'pending>pending:arm', 'sending>pending:arm', 'retrying>pending:arm', 'sent>pending:arm',
  'silent>pending:arm', 'unsent>pending:arm', 'failed>pending:arm', 'unknown>pending:arm',
];

describe('the push outbox vocabulary (Overlord spec §6.7, Table 11.1a)', () => {
  it('the states are the eight the plan names, in its order', () => {
    expect(OUTBOX_STATES).toEqual(['pending', 'sending', 'retrying', 'sent', 'silent', 'unsent', 'failed', 'unknown']);
  });

  it('outboxMoveAllowed answers exactly the moves the plan names, over every pair and actor', () => {
    const got: string[] = [];
    for (const from of [null, ...OUTBOX_STATES] as (OutboxState | null)[]) for (const to of OUTBOX_STATES)
      for (const actor of ACTORS) if (outboxMoveAllowed(from, to, actor)) got.push(`${from}>${to}:${actor}`);
    expect([...got].sort()).toEqual([...ALLOWED].sort());
  });

  it('every transition row names a known state and actor', () => {
    for (const t of OUTBOX_TRANSITIONS) {
      expect(t.from === null || OUTBOX_STATES.includes(t.from), JSON.stringify(t)).toBe(true);
      expect(OUTBOX_STATES).toContain(t.to);
      expect(ACTORS).toContain(t.actor);
    }
  });

  it('the terminal states are exactly those whose only move out is arm', () => {
    const onlyArm = OUTBOX_STATES.filter((s) => OUTBOX_TRANSITIONS.filter((t) => t.from === s).every((t) => t.actor === 'arm'));
    expect([...TERMINAL_OUTBOX_STATES].sort()).toEqual([...onlyArm].sort());
    expect([...TERMINAL_OUTBOX_STATES].sort()).toEqual(['failed', 'sent', 'silent', 'unknown', 'unsent']);
  });

  it('a bound row can be armed again from every state, and only to pending', () => {
    for (const s of OUTBOX_STATES) {
      expect(outboxMoveAllowed(s, 'pending', 'arm'), s).toBe(true);
      for (const to of OUTBOX_STATES.filter((x) => x !== 'pending')) expect(outboxMoveAllowed(s, to, 'arm'), `${s}>${to}`).toBe(false);
    }
  });

  it('the verdict, silence, actor and source words are those the plan names', () => {
    expect(OUTBOX_ACTORS).toEqual(['raise', 'sender', 'boot', 'arm']);
    expect(OUTBOX_SOURCES).toEqual(['ask', 'item']);
    expect(SUBSCRIPTION_VERDICTS).toEqual(['accepted', 'refused', 'refused-for-good', 'gone', 'no-answer']);
    expect(PUSH_SILENT_WHYS).toEqual(['level', 'viewing', 'settled', 'no-payload', 'no-service', 'older-build']);
  });

  it('the bounds: the per-request timeout is below the deadline, and the horizon is the push TTL', () => {
    expect(PUSH_ID_BYTES).toBe(16);
    expect(OUTBOX_SUB_TIMEOUT_MS).toBe(20_000);
    expect(OUTBOX_SEND_DEADLINE_MS).toBe(30_000);
    expect(OUTBOX_SUB_TIMEOUT_MS).toBeLessThan(OUTBOX_SEND_DEADLINE_MS);
    expect(OUTBOX_RETRY_BASE_MS).toBe(30_000);
    expect(OUTBOX_RETRY_HORIZON_MS).toBe(600_000);
    expect(OUTBOX_KEEP_MS).toBe(7 * 86_400_000);
  });
});
