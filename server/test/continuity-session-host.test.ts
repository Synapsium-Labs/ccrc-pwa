// The `SessionHost` port's shape (Overlord spec §3.6 H2; W1a renewal act Task 1): a fake implements it, and every `renew`
// answer is named by an exhaustive switch whose default is `never`, so a new answer is a compile error here (the test
// tsconfig type-checks this file) until each reader places it on its side of the receipt's first half.
import { describe, expect, it } from 'vitest';
import type { DeliverResult, ReceiptRead, RenewalPrompt, RenewKind, RenewResult, SessionHost } from '../src/continuity/sessionHost.js';

/** Which side of the receipt's first half an answer sits on (the port's failure contract). */
function halfOf(r: RenewResult): 'pending-receipt' | 'before' | 'after' | 'unknown' | 'retry-later' {
  switch (r.kind) {
    case 'started': return 'pending-receipt';
    case 'refused': return 'before';
    case 'kill-failed': return 'before';
    case 'capability-missing': return 'before';
    case 'wake-failed': return 'after';
    case 'wake-unrestored': return 'after';
    case 'unproven': return 'retry-later';
    case 'unreachable': return 'unknown';
    default: { const never: never = r; return never; }
  }
}

const EVERY: Record<RenewKind, RenewResult> = {
  started: { kind: 'started' },
  refused: { kind: 'refused', reason: 'session-busy: turn' },
  'kill-failed': { kind: 'kill-failed' },
  'capability-missing': { kind: 'capability-missing' },
  'wake-failed': { kind: 'wake-failed' },
  'wake-unrestored': { kind: 'wake-unrestored' },
  unproven: { kind: 'unproven' },
  unreachable: { kind: 'unreachable', detail: 'agent link down' },
};

class FakeHost implements SessionHost {
  readonly calls: string[] = [];
  constructor(private readonly answer: RenewResult) {}
  async renew(sessionId: string, n: number): Promise<RenewResult> { this.calls.push(`renew ${sessionId} ${n}`); return this.answer; }
  async deliver(sessionId: string, prompt: RenewalPrompt): Promise<DeliverResult> { this.calls.push(`deliver ${sessionId} ${prompt}`); return { kind: 'sent' }; }
  async contextUsage(): Promise<{ kind: 'measured'; value: { tokens: number; window: number } }> {
    return { kind: 'measured', value: { tokens: 10, window: 200_000 } };
  }
  async receipt(): Promise<ReceiptRead> { return { kind: 'none' }; }
}

describe('SessionHost: the renewal lane\'s port and its failure contract', () => {
  it('a fake implements it, and each renew answer reaches the caller unchanged', async () => {
    for (const r of Object.values(EVERY)) {
      const host = new FakeHost(r);
      expect(await host.renew('s-1', 3)).toEqual(r);
      expect(host.calls).toEqual(['renew s-1 3']);
    }
  });

  it('every renew answer has its side of the receipt\'s first half', () => {
    expect(Object.fromEntries(Object.entries(EVERY).map(([k, r]) => [k, halfOf(r)]))).toEqual({
      started: 'pending-receipt', refused: 'before', 'kill-failed': 'before', 'capability-missing': 'before',
      'wake-failed': 'after', 'wake-unrestored': 'after', unproven: 'retry-later', unreachable: 'unknown',
    });
  });
});
