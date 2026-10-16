// Path identity W1a, Task 11 (spec §2.3): `POST /api/runs/:id/advance`
// re-checks a STORED sessionId before it re-measures. Moving forward to
// `awaiting-review` or `merging` runs `verifyDone`, which composes
// `pr-state --session <id>`. On a refusal it also records a rejection and
// queues mail to that id. A run row written before `POST /api/runs` checked
// its ids can hold an id that ccd would read as a flag, so the advance gate
// refuses it first, with 409 `reject.code: 'bad-session'`. Retreating to
// `working` composes no argv and is left alone, so such a row can still be
// sent back.
//
// Every case plants `--actor`'s registry row, so that only the gate can
// refuse. Every claim passes `verifyDone`'s two I/O-free checks. With the gate
// deleted, the route therefore reaches the registry step and records its
// refusal, which is the red this file exists to show.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RunState } from '../../shared/api.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';
import { okRun } from './coordReadHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const COORDINATOR = 'ccrc-pwa-coordinator';
const BAD = '--actor';
const SHA = 'a'.repeat(40);
/** handoffCommit === branchTip, both 40-hex, with a recognised prPhase: past
 *  `no-handoff-commit` and `pr-unmeasurable`, so these two checks can never
 *  stand in for the gate. */
const CLAIM = { branchTip: SHA, prNumber: 7, prPhase: 'open', handoffCommit: SHA };

const postAdvance = (app: FastifyInstance, id: number, to: RunState) =>
  app.inject({
    method: 'POST', url: `/api/runs/${id}/advance`,
    headers: { 'x-ccrc-mail-token': TOKEN },
    payload: { to, fingerprint: CLAIM },
  });

describe('advance re-checks the stored session id before it re-measures (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** One work run, stored on `--actor` in `state` through the store (never
   *  through POST, whose gate would refuse it), with its registry row planted. */
  const rig = async (state: RunState) => {
    const home = mkTmp('ccrc-advance-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run, { mailToken: TOKEN });
    app = w.app;
    seedRow(home, BAD);
    const id = storedRun(w.coord, { state, sessionId: BAD, claimedBy: COORDINATOR });
    expect(okRun(w.coord.run(id))!.state).toBe(state);
    expect(okRun(w.coord.run(id))!.sessionId).toBe(BAD);
    return { app: w.app, coord: w.coord, calls, id, before: calls.length };
  };

  /** The forward refusal: 409 bad-session, then the four absences (no
   *  rejection, no mail, no move, no argv). The soft assertions report every
   *  absence a mutant breaks, not only the first. */
  const refusedForward = async (from: RunState, to: RunState): Promise<void> => {
    const r = await rig(from);
    const res = await postAdvance(r.app, r.id, to);
    expect(res.statusCode).toBe(409);
    expect.soft(res.json()).toEqual({ ok: false, reject: { code: 'bad-session' } });
    expect.soft(r.coord.rejections()).toEqual([]);
    expect.soft(r.coord.mailForRecipient(BAD)).toEqual([]);
    expect.soft(okRun(r.coord.run(r.id))!.state).toBe(from);
    // No ccd verb at all: no `pr-state --session --actor`, nothing else.
    expect(r.calls.slice(r.before)).toEqual([]);
  };

  it('advancing a --actor run to awaiting-review answers 409 reject bad-session', async () => {
    await refusedForward('working', 'awaiting-review');
  });

  it('the same to merging', async () => {
    await refusedForward('awaiting-review', 'merging');
  });

  it('control: retreating a --actor run to working is unaffected', async () => {
    const r = await rig('awaiting-review');
    // Room for one active run, so that only the gate could refuse this retreat
    // (the re-entry into `working` from an idle state takes the cap check).
    r.coord.setCaps({ maxConcurrentWorkers: 4, maxSessionsPerDay: 12 });
    const res = await postAdvance(r.app, r.id, 'working');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { run: { state: string } }).run.state).toBe('working');
    expect(okRun(r.coord.run(r.id))!.state).toBe('working');
    expect(r.coord.rejections()).toEqual([]);
    expect(r.calls.slice(r.before)).toEqual([]);
  });
});
