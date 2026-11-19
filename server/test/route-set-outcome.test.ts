// server/test/route-set-outcome.test.ts
//
// One `routeSet` answer helper (mid-turn mail plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 4.1, P11).
// The characterization block pins what the two writers of a route field answer today for a `ccd` result that did not
// run, ran and succeeded, and ran and failed: the generations lane's PreCompact field (`renewalActsOf`'s
// `routePrecompact`, seen through its retraction, which warns on every answer but `written`) and the launch-profile
// lane's pass counts and failure lines. It was green on `main` before the helper existed, and the commit that moves the
// two lanes onto the helper changes no line of it. Each lane's own pre-checks (`capability-missing`, `not a registry
// id`, the launch-profile lane's `unsupported`) stay in the lane, and are pinned here too.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTOR_FLAGS_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import type { CcdArgv } from '../src/ccdargv.js';
import type { CcdResult, WatcherCoordPort } from '../src/coord/ports.js';
import { renewalActsOf } from '../src/continuity/renewalWiring.js';
import { profilePass, type ProfileLaneDeps, type ProfileLaneResult } from '../src/continuity/profileLane.js';
import type { LaneArmRead } from '../src/coord/laneArm.js';

/** The three shapes a `runCcd` answer takes, as the runner builds them. */
const NOT_RAN = { ok: false, stdout: '', stderr: 'agent link dropped', killed: 'unmeasured', signal: 'unmeasured', ran: false } as unknown as CcdResult;
const WRITTEN = { ok: true, stdout: '', stderr: '', killed: false, signal: null, ran: true } as CcdResult;
const refusedWith = (stderr: string): CcdResult => ({ ok: false, stdout: '', stderr, killed: false, signal: null, ran: true }) as CcdResult;

afterEach(() => { vi.restoreAllMocks(); });

describe('characterization: the generations lane\'s PreCompact write (renewalActsOf, routePrecompact)', () => {
  /** The retraction's warning for one session, or null when it warned nothing (the write was `written`). */
  async function retractWarning(answer: CcdResult, opts: { verbs?: string[]; id?: string } = {}): Promise<{ warning: string | null; sent: string[][] }> {
    const sent: string[][] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = {
      io: {}, cfg: { registryDir: '/nonexistent' }, tmux: {}, queue: { run: async <T>(_id: string, fn: () => Promise<T>) => fn() },
      time: { clock: { wall: () => 1_000_000 } },
      fleetState: { ccdVerbs: opts.verbs ?? [ROUTE_CAP, ACTOR_FLAGS_CAP] },
      runCcd: async (argv: CcdArgv): Promise<CcdResult> => { sent.push([...argv]); return answer; },
    } as unknown as Parameters<typeof renewalActsOf>[0];
    const wiring = renewalActsOf(deps, {} as WatcherCoordPort, [], {} as never, async () => ({ ok: false }), null);
    await wiring.retract([opts.id ?? 'lane-a-project-a']);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('precompact=allow'));
    warn.mockRestore();
    return { warning: lines[0] ?? null, sent };
  }

  it('ran and succeeded: written, so the retraction warns nothing; one route --set precompact=allow argv', async () => {
    const r = await retractWarning(WRITTEN);
    expect(r.warning).toBeNull();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toEqual(expect.arrayContaining(['route', '--session', 'lane-a-project-a', '--set', 'precompact=allow']));
  });

  it('did not run: unreachable, with the detail `ccd did not run`, never a refusal', async () => {
    expect((await retractWarning(NOT_RAN)).warning)
      .toBe('ccrc-server: renewal: lane-a-project-a: precompact=allow (retraction) was not written (unreachable: ccd did not run)');
  });

  it('ran and failed: refused, with the first stderr line trimmed', async () => {
    expect((await retractWarning(refusedWith('  ccd: unknown routing field precompact  \nsecond line\n'))).warning)
      .toBe('ccrc-server: renewal: lane-a-project-a: precompact=allow (retraction) was not written (refused: ccd: unknown routing field precompact)');
  });

  it('ran and failed with no stderr: refused, `no stderr`', async () => {
    expect((await retractWarning(refusedWith(''))).warning)
      .toBe('ccrc-server: renewal: lane-a-project-a: precompact=allow (retraction) was not written (refused: no stderr)');
  });

  it('the lane\'s own pre-checks stay its own: no route cap is capability-missing, and a refused id is never sent', async () => {
    const noCap = await retractWarning(WRITTEN, { verbs: [] });
    expect(noCap.warning).toBe('ccrc-server: renewal: lane-a-project-a: precompact=allow (retraction) was not written (capability-missing)');
    expect(noCap.sent).toEqual([]);
    const badId = await retractWarning(WRITTEN, { id: '-bad' });
    expect(badId.warning).toBe('ccrc-server: renewal: -bad: precompact=allow (retraction) was not written (refused: not a registry id)');
    expect(badId.sent).toEqual([]);
  });
});

describe('characterization: the launch-profile lane\'s pass counts (profilePass)', () => {
  const live: LaneArmRead = { kind: 'row', choice: 'live', updatedAt: 1, importedAt: null, imported: null };
  const shadow: LaneArmRead = { kind: 'row', choice: 'shadow', updatedAt: 1, importedAt: null, imported: null };

  async function pass(answer: CcdResult, verbs: string[] = [ROUTE_CAP, ACTOR_FLAGS_CAP]): Promise<{ r: ProfileLaneResult; logs: string[]; sent: number }> {
    const logs: string[] = [];
    let sent = 0;
    const deps: ProfileLaneDeps = {
      coord: {
        laneArmSetting: (lane) => (lane === 'launch-profile' ? live : shadow),
        openCoordinatorIds: () => [],
        run: (() => ({ ok: true, run: null })) as unknown as ProfileLaneDeps['coord']['run'],
        plainAutoMemorySettings: () => ({ kind: 'row', choice: 'off' }),
        designationRead: () => ({ kind: 'not-designated', row: null }),
      },
      reads: {
        usage: async () => ({ kind: 'absent' }),
        steerMarker: async () => 'absent',
        declaredIntent: async () => false,
        buildAgreement: () => 'agreed',
      },
      act: { runCcd: async () => { sent += 1; return answer; }, fleetState: { ccdVerbs: verbs } },
      log: (l) => logs.push(l),
      gate: () => null,
      memory: { lastLine: null },
    };
    const r = await profilePass(deps, [{ id: 'lane-a-project-a', child: { kind: 'none' }, route: null }]);
    return { r, logs, sent };
  }
  const failLine = (detail: string) => `ccrc-server: launch-profile: a route write failed, retried next pass: lane-a-project-a: ${detail}`;

  it('ran and succeeded: written 1, failed 0, no failure line', async () => {
    const p = await pass(WRITTEN);
    expect(p.r).toMatchObject({ would: 1, written: 1, failed: 0, unsupported: 0 });
    expect(p.logs.filter((l) => l.includes('a route write failed'))).toEqual([]);
  });

  it('did not run: failed 1, logged as unmeasured, never as ccd\'s refusal', async () => {
    const p = await pass(NOT_RAN);
    expect(p.r).toMatchObject({ written: 0, failed: 1 });
    expect(p.logs).toContain(failLine('ccd did not run, so the write is unmeasured'));
  });

  it('ran and failed: failed 1, logged with the first stderr line trimmed', async () => {
    const p = await pass(refusedWith('  ccd: unknown routing field profile  \nsecond\n'));
    expect(p.r).toMatchObject({ written: 0, failed: 1 });
    expect(p.logs).toContain(failLine('ccd: unknown routing field profile'));
  });

  it('ran and failed with no stderr: failed 1, `no stderr`', async () => {
    const p = await pass(refusedWith(''));
    expect(p.logs).toContain(failLine('no stderr'));
  });

  it('the lane\'s own pre-check stays its own: no route verb is unsupported, and nothing is sent', async () => {
    const p = await pass(WRITTEN, []);
    expect(p.r).toMatchObject({ written: 0, failed: 0, unsupported: 1 });
    expect(p.sent).toBe(0);
  });
});
