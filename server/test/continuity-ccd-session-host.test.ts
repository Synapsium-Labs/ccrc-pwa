// The ccd adapter of SessionHost (Overlord W1a renewal act, Task 2): every exit code, the capability gate, the argv, and
// the three reads keep their own words. Fakes only: nothing here shells out.
import { describe, it, expect } from 'vitest';
import { ccdSessionHost, type CcdSessionHostDeps } from '../src/continuity/ccdSessionHost.js';
import { ACTOR_FLAGS_CAP, CCD_ARGV, HIBERNATE_FRESH_CAP, sweepDec } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
import type { UsageRead } from '../src/usage.js';
import type { SendResult } from '../src/inject/send.js';
import type { StartRow } from '../../shared/continuity.js';

const ID = 'acct-a-demo';
const ran = (exitCode: number | undefined, stderr = ''): CcdResult =>
  ({ ran: true, ok: exitCode === 0, stdout: '', stderr, killed: false, signal: null, ...(exitCode === undefined ? {} : { exitCode }) });

function harness(over: Partial<CcdSessionHostDeps> & { verbs?: string[] | null; result?: CcdResult } = {}) {
  const calls: unknown[] = [];
  const logs: string[] = [];
  const deps: CcdSessionHostDeps = {
    runCcd: async (argv) => { calls.push(argv); return over.result ?? ran(0); },
    fleetState: { ccdVerbs: over.verbs === undefined ? ['hibernate', HIBERNATE_FRESH_CAP, ACTOR_FLAGS_CAP] : over.verbs },
    send: async () => ({ ok: true }),
    usage: async () => ({ kind: 'absent' }),
    startsOf: () => ({ ok: true, rows: [] }),
    log: (l) => logs.push(l),
    ...over,
  };
  delete (over as { verbs?: unknown }).verbs;
  return { host: ccdSessionHost(deps), calls, logs };
}

describe('renew', () => {
  const cases: [number, unknown][] = [
    [0, { kind: 'started' }], [4, { kind: 'wake-failed' }], [5, { kind: 'wake-unrestored' }],
    [6, { kind: 'kill-failed' }], [7, { kind: 'unproven' }],
  ];
  for (const [code, want] of cases) {
    it(`exit ${code}`, async () => {
      const { host } = harness({ result: ran(code) });
      expect(await host.renew(ID, 2)).toEqual(want);
    });
  }
  it('exit 3 carries ccd\'s reason', async () => {
    const { host } = harness({ result: ran(3, 'ccd: session-busy: held\n') });
    expect(await host.renew(ID, 2)).toEqual({ kind: 'refused', reason: 'held' });
  });
  it('exit 3 without the line is still refused', async () => {
    expect(await harness({ result: ran(3, 'something odd\nmore') }).host.renew(ID, 2)).toEqual({ kind: 'refused', reason: 'something odd' });
    expect(await harness({ result: ran(3, '') }).host.renew(ID, 2)).toEqual({ kind: 'refused', reason: 'ccd refused the roll (exit 3) and gave no reason' });
  });
  it('an unknown code is unreachable and logged', async () => {
    const { host, logs } = harness({ result: ran(9) });
    const r = await host.renew(ID, 2);
    expect(r.kind).toBe('unreachable');
    expect(logs).toEqual([`ccrc-server: renewal: ccd hibernate --roll --fresh exited 9 for ${ID}`]);
  });
  it('an absent exit code is never read as 0', async () => {
    const r = await harness({ result: ran(undefined) }).host.renew(ID, 2);
    expect(r).toEqual({ kind: 'unreachable', detail: expect.stringContaining('not measured') });
  });
  it('ran:false is unreachable with the runner\'s stderr', async () => {
    const result: CcdResult = { ran: false, reason: 'transport', detail: 'x', ok: false, stdout: '', stderr: 'link dropped', killed: 'unmeasured', signal: 'unmeasured' };
    expect(await harness({ result }).host.renew(ID, 2)).toEqual({ kind: 'unreachable', detail: 'link dropped' });
  });
  it('a throw is unreachable', async () => {
    const { host } = harness({ runCcd: async () => { throw new Error('boom'); } });
    expect(await host.renew(ID, 2)).toEqual({ kind: 'unreachable', detail: 'boom' });
  });
  it('no hibernate-fresh capability never runs ccd', async () => {
    for (const verbs of [['hibernate', 'hibernate-roll'], ['hibernate-fresh'], [], null]) {
      const { host, calls } = harness({ verbs });
      expect(await host.renew(ID, 2)).toEqual({ kind: 'capability-missing' });
      expect(calls).toEqual([]);
    }
  });
  it('sends exactly the built argv, with the dec when the box takes actor flags and none otherwise', async () => {
    const withDec = harness();
    await withDec.host.renew(ID, 7);
    const dec = sweepDec({ ccdVerbs: ['hibernate', HIBERNATE_FRESH_CAP, ACTOR_FLAGS_CAP] }, 'sweep:renew')!;
    expect(withDec.calls).toEqual([CCD_ARGV.hibernate(ID, { ...dec, reason: 'renewal n=7' }, null, 'fresh')]);
    const without = harness({ verbs: ['hibernate', HIBERNATE_FRESH_CAP] });
    await without.host.renew(ID, 7);
    expect(without.calls).toEqual([CCD_ARGV.hibernate(ID, null, null, 'fresh')]);
  });
  it('runs the ccd call inside `around`, keyed by the session, when given', async () => {
    const seen: string[] = [];
    const { host, calls } = harness({ around: async (id, fn) => { seen.push(`in ${id}`); const r = await fn(); seen.push(`out ${id}`); return r; } });
    expect(await host.renew(ID, 3)).toEqual({ kind: 'started' });
    expect(seen).toEqual([`in ${ID}`, `out ${ID}`]);
    expect(calls).toHaveLength(1);
  });
});

describe('deliver', () => {
  it('maps each answer', async () => {
    expect(await harness({ send: async () => ({ ok: true }) }).host.deliver(ID, 'hi')).toEqual({ kind: 'sent' });
    const no: SendResult = { ok: false, error: 'draft-present' };
    expect(await harness({ send: async () => no }).host.deliver(ID, 'hi')).toEqual({ kind: 'refused', reason: 'draft-present' });
    expect(await harness({ send: async () => { throw new Error('gone'); } }).host.deliver(ID, 'hi')).toEqual({ kind: 'unreachable', detail: 'gone' });
  });
});

describe('contextUsage', () => {
  const usage = (o: object): UsageRead => ({ kind: 'reading', usage: { ts: 1, model: null, class: null, effort: null, ctxPct: null, cost: null, cacheExpiresAt: null, stale: false, ...o } as never });
  const read = (u: UsageRead) => harness({ usage: async () => u }).host.contextUsage(ID);
  it('measured from a fresh reading', async () => {
    expect(await read(usage({ ctxTokens: 10, ctxWindow: 100 }))).toEqual({ kind: 'measured', value: { tokens: 10, window: 100 } });
  });
  it('stale is unmeasured', async () => {
    expect(await read(usage({ ctxTokens: 10, ctxWindow: 100, stale: true }))).toEqual({ kind: 'unmeasured', why: 'usage stale' });
  });
  it('each kind keeps its own why', async () => {
    for (const kind of ['absent', 'unreadable', 'malformed'] as const) {
      expect(await read({ kind })).toEqual({ kind: 'unmeasured', why: `usage ${kind}` });
    }
  });
  it('a missing field names the field', async () => {
    expect(await read(usage({ ctxWindow: 100 }))).toEqual({ kind: 'unmeasured', why: 'usage has no ctxTokens' });
    expect(await read(usage({ ctxTokens: 5, ctxWindow: null }))).toEqual({ kind: 'unmeasured', why: 'usage has no ctxWindow' });
  });
});

describe('receipt', () => {
  const row = (id: number, source: StartRow['source'], uuid = `u${id}`): StartRow =>
    ({ id, sessionId: ID, reportId: `r${id}`, uuid, source, model: null, rowIncarnation: null, reportedAt: id, receivedAt: id });
  const of = (rows: StartRow[], since: number) => harness({ startsOf: () => ({ ok: true, rows }) }).host.receipt(ID, since);
  it('skips a compaction and anything at or before the id, newest first', async () => {
    expect(await of([row(9, 'compact'), row(8, 'startup'), row(7, 'clear'), row(5, 'startup')], 5)).toEqual({ kind: 'started', startId: 8, uuid: 'u8' });
  });
  it('none when nothing qualifies', async () => {
    expect(await of([row(9, 'compact'), row(5, 'startup')], 5)).toEqual({ kind: 'none' });
  });
  it('a failed read is unreadable with its detail', async () => {
    const h = harness({ startsOf: () => ({ ok: false, detail: 'db locked' }) });
    expect(await h.host.receipt(ID, 0)).toEqual({ kind: 'unreadable', detail: 'db locked' });
  });
});
