/**
 * The policy decision point on Linear writes (#1444, spec §8, D-7672; plan task LK7). Spec §14 row 10's clauses that
 * need no route: the allow-all default; a deny answers `policy-denied`; a throw, a timeout past two seconds or an
 * answer of any other shape answers `policy-unavailable`, so the point fails closed; both refusals are journaled with
 * the decision id when one came back. The route clauses (the 403 and 503, reads skip it, the moved issue, the
 * cross-team parent) land with the proxy (LK9).
 *
 * The port lives at L2 (`policy.ts`, types only); the deadline and the default live in `policyPoint.ts` (L3, it holds
 * a deadline timer), D-7687.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinearWriteAsk, LinearWriteDecision, LinearWritePolicy } from '../src/linear/policy.js';
import { LINEAR_POLICY_DEADLINE_MS, LINEAR_POLICY_REFUSALS, allowAll, askWithDeadline } from '../src/linear/policyPoint.js';
import { serverRing } from './rings/ring.js';
import { parsedFile } from './scan/symbols.js';
import { linearServicesFake } from './linearServicesFake.js';

const WS = '11111111-2222-4333-8444-555555555555';
const ASK: LinearWriteAsk = {
  actor: { kind: 'session', id: 'session-a', uuid: 'uuid-a' },
  verb: 'operate',
  route: '/api/linear/proxy/issues/:id',
  resource: { workspaceId: WS, teamKey: 'BBB', issue: 'BBB-7', parentTeamKey: null, op: 'update' },
};

afterEach(() => { vi.useRealTimers(); });

describe('the policy point: the default and the answers (#1444, spec §8)', () => {
  it('allowAll answers allow with no decision id, and the point lets it through', async () => {
    expect(await allowAll(ASK)).toEqual({ allow: true, decisionId: null });
    expect(await askWithDeadline(allowAll, ASK)).toEqual({ allow: true, decisionId: null });
  });

  it('the policy is asked once, with the ask exactly as given', async () => {
    const seen: LinearWriteAsk[] = [];
    const recording: LinearWritePolicy = async (ask) => { seen.push(ask); return { allow: true, decisionId: 'd-1' }; };
    expect(await askWithDeadline(recording, ASK)).toEqual({ allow: true, decisionId: 'd-1' });
    expect(seen).toEqual([ASK]);
  });

  it('a deny answers policy-denied, with the decision id; a deny for unavailability answers policy-unavailable', async () => {
    expect(await askWithDeadline(async () => ({ allow: false, why: 'denied', decisionId: 'd-2' }), ASK))
      .toEqual({ allow: false, code: 'policy-denied', decisionId: 'd-2' });
    expect(await askWithDeadline(async () => ({ allow: false, why: 'unavailable', decisionId: null }), ASK))
      .toEqual({ allow: false, code: 'policy-unavailable', decisionId: null });
    expect(LINEAR_POLICY_REFUSALS).toEqual(['policy-denied', 'policy-unavailable']);
  });

  it('fails closed on a throw: a rejected promise and a synchronous throw both answer policy-unavailable', async () => {
    const rejects: LinearWritePolicy = async () => { throw new Error('authorizer down'); };
    const throwsNow: LinearWritePolicy = () => { throw new Error('authorizer down'); };
    expect(await askWithDeadline(rejects, ASK)).toEqual({ allow: false, code: 'policy-unavailable', decisionId: null });
    expect(await askWithDeadline(throwsNow, ASK)).toEqual({ allow: false, code: 'policy-unavailable', decisionId: null });
  });

  it('fails closed on any other shape', async () => {
    const shapes: unknown[] = [
      null, undefined, true, 'allow', [], {}, { allow: 'yes', decisionId: null }, { allow: true },
      { allow: true, decisionId: 5 }, { allow: true, decisionId: null, extra: 1 }, { allow: false, decisionId: null },
      { allow: false, why: 'nope', decisionId: null }, { allow: true, decisionId: 'free text with spaces' },
      { allow: true, decisionId: 'x'.repeat(129) }, Object.create({ allow: true, decisionId: null }),
    ];
    for (const s of shapes) {
      const odd = (async () => s) as unknown as LinearWritePolicy;
      expect(await askWithDeadline(odd, ASK), JSON.stringify(s) ?? String(s))
        .toEqual({ allow: false, code: 'policy-unavailable', decisionId: null });
    }
  });
});

describe('the policy point: two seconds, then closed (#1444, spec §8)', () => {
  const after = (ms: number, d: LinearWriteDecision): LinearWritePolicy =>
    () => new Promise((resolve) => { setTimeout(() => resolve(d), ms); });

  it('the deadline is two seconds', () => {
    expect(LINEAR_POLICY_DEADLINE_MS).toBe(2_000);
  });

  it('a policy that never answers is policy-unavailable at two seconds, not before', async () => {
    vi.useFakeTimers();
    let done: unknown = 'not yet';
    void askWithDeadline(() => new Promise<LinearWriteDecision>(() => {}), ASK).then((v) => { done = v; });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe('not yet');
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toEqual({ allow: false, code: 'policy-unavailable', decisionId: null });
  });

  it('an allow inside the deadline passes; one after it is too late, and stays closed', async () => {
    vi.useFakeTimers();
    const inTime = askWithDeadline(after(1_900, { allow: true, decisionId: 'd-3' }), ASK);
    await vi.advanceTimersByTimeAsync(1_900);
    expect(await inTime).toEqual({ allow: true, decisionId: 'd-3' });
    const late = askWithDeadline(after(2_500, { allow: true, decisionId: 'd-4' }), ASK);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await late).toEqual({ allow: false, code: 'policy-unavailable', decisionId: null });
  });

  it('an answer clears its deadline: no timer of the point outlives the ask', async () => {
    vi.useFakeTimers();
    await askWithDeadline(allowAll, ASK);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the policy point’s refusals are journaled, with the decision id (#1444, spec §8)', () => {
  it('a denied write and an unavailable one each settle their pending row with the word', async () => {
    const { db, journal } = linearServicesFake({ clock: () => 1 });
    for (const policy of [
      (async () => ({ allow: false, why: 'denied', decisionId: 'd-5' })) as LinearWritePolicy,
      (async () => { throw new Error('down'); }) as LinearWritePolicy,
    ]) {
      const verdict = await askWithDeadline(policy, ASK);
      if (verdict.allow) throw new Error('allowed');
      const w = journal.pending({
        op: 'update', sessionId: 'session-a', sessionUuid: 'uuid-a', actor: null, workspaceId: WS, teamKey: 'BBB',
        target: 'BBB-7', fields: ['title'],
      });
      if (!w.ok) throw new Error('pending refused');
      expect(journal.settle(w.id, verdict.code === 'policy-denied' ? 'denied' : 'refused', verdict.code, null, null,
        verdict.decisionId)).toEqual({ ok: true });
    }
    expect(db.prepare('SELECT outcome, code, decisionId FROM linear_events ORDER BY id').all()).toEqual([
      { outcome: 'denied', code: 'policy-denied', decisionId: 'd-5' },
      { outcome: 'refused', code: 'policy-unavailable', decisionId: null },
    ]);
  });

  it('the fake wires the default, as index.ts does', async () => {
    expect(linearServicesFake().policy).toBe(allowAll);
  });
});

describe('the port: L2 types only, and the actor is attribution, never a grant (#1444, spec §8, R8)', () => {
  it('policy.ts is L2 and policyPoint.ts is L3, by the rings’ own facts', () => {
    expect(serverRing('server/src/linear/policy.ts').ring).toBe('L2');
    expect(serverRing('server/src/linear/policyPoint.ts').ring).toBe('L3');
  });

  it('the port’s doc comment says no allow rule may depend on the actor', () => {
    const text = parsedFile('server/src/linear/policy.ts').text;
    expect(text.replace(/\s*\n\s*\*\s*/g, ' ')).toMatch(/no allow rule may depend on `actor`/);
    expect(text).toMatch(/attribution, never a grant/i);
  });
});

describe('index.ts builds one journal, sweeps it on the audit’s beat, and wires allowAll (#1444, spec §7, §8)', () => {
  // A parse-based census of the composition root (`scan/symbols.ts`), never a literal source pin (ARCH-06). The two
  // assignments into `Deps` are single-definition rows (`single-definition/linear-journal.test.ts`).
  const index = parsedFile('server/src/index.ts');

  it('one journal over the one coord.db, and the default policy imported from the point', () => {
    expect(index.bindings.filter((b) => /\bnew LinearJournal\(/.test(b.init)).map((b) => [b.name, b.init]))
      .toEqual([['linearJournal', 'new LinearJournal(coord.db)']]);
    const from = (spec: string): string[] => index.imports.filter((e) => e.specifier === spec && !e.typeOnly).flatMap((e) => e.names);
    expect(from('./linear/journal.js')).toEqual(['LinearJournal']);
    expect(from('./linear/policyPoint.js')).toEqual(['allowAll']);
  });

  it('swept at boot and on the daily interval, beside the account audit', () => {
    const sweeps = (who: string) => index.calls.filter((c) => c.callee === `${who}.sweep`);
    expect(sweeps('linearJournal')).toHaveLength(2);
    expect(sweeps('accountAudit')).toHaveLength(2);
    const daily = index.calls.filter((c) => c.callee === 'setInterval'
      && sweeps('accountAudit').some((s) => s.start > c.start && s.end < c.end));
    expect(daily, 'the account audit’s daily beat').toHaveLength(1);
    expect(sweeps('linearJournal').filter((s) => s.start > daily[0]!.start && s.end < daily[0]!.end)).toHaveLength(1);
    expect(index.text.slice(daily[0]!.start, daily[0]!.end)).toMatch(/86_400_000\)$/);
    const boot = sweeps('linearJournal').find((s) => s.start < daily[0]!.start)!;
    expect(boot.args.map((a) => a.text)).toEqual(['Date.now()']);
  });
});
