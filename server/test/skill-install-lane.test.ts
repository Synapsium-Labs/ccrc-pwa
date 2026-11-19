// D-8126 (wave A7-5, row 38): the worker skill's self-install. The L1 deciders (`coord/skillInstall.ts`) case by case,
// then the lane's pass (`coord/skillInstallLane.ts`) over a stand-in store: what it runs, what it records, and what it
// leaves alone. The dispatch's own half (it runs no install, so the serialiser never waits on one) is pinned in
// `dispatch-skillstate.test.ts`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutants, type SuiteCase } from './sim/mutate.js';
import {
  SKILL_INSTALL_OUTCOMES, SKILL_INSTALL_WINDOW_MS, skillInstallDue, skillInstallOutcomeOf, type SkillInstallRun,
} from '../src/coord/skillInstall.js';
import { SKILL_INSTALL_PER_PASS, skillInstallPass, type SkillInstallLaneDeps } from '../src/coord/skillInstallLane.js';
import type { CcdArgv } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
import type { RunState } from '../../shared/api.js';

type SkillInstallModule = typeof import('../src/coord/skillInstall.js');

const NOW = 1_790_000_000_000;
const work: SkillInstallRun = { id: 7, kind: 'work', sessionId: 'demo-w1' };
const ev = (at: number, detail: string | null) => ({ at, detail });
const absentAt = (at = NOW - 1_000) => ev(at, 'skill-preflight:absent');

describe('skillInstallDue', () => {
  it('a work run with a session whose newest measurement is absent, inside the window, with no install after it', () => {
    expect(skillInstallDue(work, [ev(NOW - 5_000, 'route-defaulted'), absentAt()], NOW)).toBe(true);
  });
  it('never for a review run, a run with no session, or a run with no measurement', () => {
    expect(skillInstallDue({ ...work, kind: 'review' }, [absentAt()], NOW)).toBe(false);
    expect(skillInstallDue({ ...work, kind: 'unknown' }, [absentAt()], NOW)).toBe(false);
    expect(skillInstallDue({ ...work, sessionId: null }, [absentAt()], NOW)).toBe(false);
    expect(skillInstallDue(work, [ev(NOW - 1_000, 'route-defaulted')], NOW)).toBe(false);
    expect(skillInstallDue(work, [], NOW)).toBe(false);
  });
  it('the NEWEST measurement decides: present or unmeasurable after an older absent is not due', () => {
    expect(skillInstallDue(work, [absentAt(NOW - 3_000), ev(NOW - 1_000, 'skill-preflight:present')], NOW)).toBe(false);
    expect(skillInstallDue(work, [absentAt(NOW - 3_000), ev(NOW - 1_000, 'skill-preflight:unmeasurable')], NOW)).toBe(false);
    expect(skillInstallDue(work, [ev(NOW - 3_000, 'skill-preflight:present'), absentAt()], NOW)).toBe(true);
  });
  it('an install recorded after the measurement settles it; one recorded before (an older dispatch) does not', () => {
    expect(skillInstallDue(work, [absentAt(NOW - 3_000), ev(NOW - 1_000, 'skill-install:failed')], NOW)).toBe(false);
    expect(skillInstallDue(work, [absentAt(NOW - 3_000), ev(NOW - 2_000, 'skill-install:installed'), absentAt()], NOW)).toBe(true);
  });
  it('the window: a measurement exactly at its edge is due, one older is not', () => {
    expect(skillInstallDue(work, [absentAt(NOW - SKILL_INSTALL_WINDOW_MS)], NOW)).toBe(true);
    expect(skillInstallDue(work, [absentAt(NOW - SKILL_INSTALL_WINDOW_MS - 1)], NOW)).toBe(false);
  });
});

describe('skillInstallOutcomeOf', () => {
  const ok = (stdout: string) => ({ ok: true, stdout });
  it('installed and converged come only from ccd\'s JSON line, the last non-empty one', () => {
    expect(skillInstallOutcomeOf(ok('{"wrapper":"lane-a","result":"installed","detail":"x"}\n'))).toBe('installed');
    expect(skillInstallOutcomeOf(ok('noise\n{"wrapper":"lane-a","result":"converged","detail":"x"}\n\n'))).toBe('converged');
  });
  it('everything else is failed: no answer, a non-zero exit, an unparsable line, a JSON non-object, another word', () => {
    expect(skillInstallOutcomeOf(null)).toBe('failed');
    expect(skillInstallOutcomeOf({ ok: false, stdout: '{"result":"installed"}' })).toBe('failed');
    expect(skillInstallOutcomeOf(ok(''))).toBe('failed');
    expect(skillInstallOutcomeOf(ok('installed'))).toBe('failed');
    expect(skillInstallOutcomeOf(ok('5'))).toBe('failed');
    expect(skillInstallOutcomeOf(ok('null'))).toBe('failed');
    expect(skillInstallOutcomeOf(ok('{"result":"failed"}'))).toBe('failed');
    expect(skillInstallOutcomeOf(ok('{"result":"unsupported"}'))).toBe('failed');
    expect(skillInstallOutcomeOf(ok('{"result":"installed"}\ntrailing'))).toBe('failed');
  });
  it('the outcome vocabulary is the four words', () => {
    expect(SKILL_INSTALL_OUTCOMES).toEqual(['installed', 'converged', 'failed', 'unsupported']);
  });
});

/** A stand-in store holding runs and their journals, and a runner that records every argv. */
const lane = (opts: { answer?: (argv: CcdArgv) => Promise<CcdResult>; verbs?: string[] | null } = {}) => {
  const runs: { id: number; kind: 'work' | 'review'; sessionId: string | null; state: RunState }[] = [];
  const events = new Map<number, { at: number; detail: string | null; causedBy: string }[]>();
  const calls: string[][] = [];
  const records: { id: string; wrapper: string }[] = [];
  const answered = (stdout: string): CcdResult => ({ ran: true, ok: true, stdout, stderr: '', killed: false, signal: null });
  const deps: SkillInstallLaneDeps = {
    coord: {
      runs: () => ({ ok: true, runs: runs as never }),
      runEvents: (id: number) => (events.get(id) ?? []) as never,
      recordRunEvent: (id: number, causedBy: string, detail: string, at = NOW) => { events.get(id)!.push({ at, detail, causedBy }); },
    },
    records,
    runCcd: async (argv) => {
      calls.push([...argv]);
      return opts.answer ? opts.answer(argv) : answered('{"wrapper":"lane-a","result":"installed","detail":"ok"}\n');
    },
    fleetState: { ccdVerbs: opts.verbs === undefined ? ['ws-add', 'skill-ensure'] : opts.verbs },
    now: () => NOW,
  };
  const addRun = (id: number, over: Partial<(typeof runs)[number]> = {}, journal = [absentAt()]): void => {
    runs.push({ id, kind: 'work', sessionId: `demo-w${id}`, state: 'dispatched', ...over });
    events.set(id, journal.map((e) => ({ ...e, causedBy: 'coordinator' })));
    records.push({ id: `demo-w${id}`, wrapper: 'lane-a' });
  };
  const installs = (id: number) => (events.get(id) ?? []).filter((e) => e.detail?.startsWith('skill-install:') === true);
  return { deps, calls, addRun, installs, records, runs };
};

describe('skillInstallPass', () => {
  it('an absent skill on an active work run runs skill-ensure once for the bound worker\'s account and records the outcome', async () => {
    const l = lane();
    l.addRun(1);
    expect(await skillInstallPass(l.deps)).toEqual(['installed']);
    expect(l.calls).toEqual([['skill-ensure', '--wrapper', 'lane-a']]);
    expect(l.installs(1)).toEqual([{ at: NOW, detail: 'skill-install:installed', causedBy: 'sweep' }]);
    // Once: the recorded outcome settles the measurement, so the next pass runs nothing.
    expect(await skillInstallPass(l.deps)).toEqual([]);
    expect(l.calls).toHaveLength(1);
  });

  it('a failing verb, a verb that did not run, a throwing runner and an overdue verb all record failed', async () => {
    const shapes: ((argv: CcdArgv) => Promise<CcdResult>)[] = [
      async () => ({ ran: true, ok: false, stdout: '', stderr: 'boom', killed: false, signal: null }),
      async () => ({ ran: false, ok: false, stdout: '', stderr: 'no link', killed: false, signal: null } as unknown as CcdResult),
      async () => { throw new Error('runner'); },
      () => new Promise<CcdResult>(() => {}),
    ];
    for (const answer of shapes) {
      const l = lane({ answer });
      l.addRun(1);
      expect(await skillInstallPass({ ...l.deps, deadlineMs: 20 })).toEqual(['failed']);
      expect(l.installs(1).map((e) => e.detail)).toEqual(['skill-install:failed']);
    }
  });

  it('a box whose ccd lacks the verb records unsupported once and runs nothing', async () => {
    const l = lane({ verbs: ['ws-add'] });
    l.addRun(1);
    expect(await skillInstallPass(l.deps)).toEqual(['unsupported']);
    expect(l.calls).toEqual([]);
    expect(await skillInstallPass(l.deps)).toEqual([]);
  });

  it('runs nothing for a present or unmeasurable skill, a review run, or a run that is no longer active', async () => {
    const l = lane();
    l.addRun(1, {}, [ev(NOW - 1_000, 'skill-preflight:present')]);
    l.addRun(2, {}, [ev(NOW - 1_000, 'skill-preflight:unmeasurable')]);
    l.addRun(3, { kind: 'review' });
    l.addRun(4, { state: 'awaiting-review' });
    l.addRun(5, { state: 'planned' });
    expect(await skillInstallPass(l.deps)).toEqual([]);
    expect(l.calls).toEqual([]);
  });

  it('a session with no registry row or no account is left for a later pass, with nothing recorded', async () => {
    const l = lane();
    l.addRun(1);
    l.records.length = 0;
    expect(await skillInstallPass(l.deps)).toEqual([]);
    expect(l.calls).toEqual([]);
    expect(l.installs(1)).toEqual([]);
    l.records.push({ id: 'demo-w1', wrapper: '' });
    expect(await skillInstallPass(l.deps)).toEqual([]);
    l.records[0] = { id: 'demo-w1', wrapper: 'lane-a' };
    expect(await skillInstallPass(l.deps)).toEqual(['installed']);
  });

  it(`at most ${SKILL_INSTALL_PER_PASS} installs a pass; the rest follow on the next`, async () => {
    const l = lane();
    for (let i = 1; i <= SKILL_INSTALL_PER_PASS + 2; i += 1) l.addRun(i);
    expect(await skillInstallPass(l.deps)).toHaveLength(SKILL_INSTALL_PER_PASS);
    expect(await skillInstallPass(l.deps)).toHaveLength(2);
    expect(l.calls).toHaveLength(SKILL_INSTALL_PER_PASS + 2);
  });

  it('an unreadable store reads nothing and runs nothing', async () => {
    const l = lane();
    l.addRun(1);
    const deps = { ...l.deps, coord: { ...l.deps.coord, runs: () => ({ ok: false as const, kind: 'run-unreadable' as const, detail: 'x' }) } };
    expect(await skillInstallPass(deps)).toEqual([]);
    expect(l.calls).toEqual([]);
  });
});

// The L1 deciders' mutants, run here rather than in `sim/mutation-floors.json` (that file is held by another run while this
// wave builds; departure `mutants-in-the-lane-test`). Every mutant must die against the cases below.
describe('skillInstall.ts mutants (runMutants)', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const suite = (m: SkillInstallModule): Record<string, SuiteCase> => ({
    due: () => { expect(m.skillInstallDue(work, [absentAt()], NOW)).toBe(true); },
    review: () => { expect(m.skillInstallDue({ ...work, kind: 'review' }, [absentAt()], NOW)).toBe(false); },
    unbound: () => { expect(m.skillInstallDue({ ...work, sessionId: null }, [absentAt()], NOW)).toBe(false); },
    present: () => { expect(m.skillInstallDue(work, [ev(NOW - 1_000, 'skill-preflight:present')], NOW)).toBe(false); },
    newest: () => { expect(m.skillInstallDue(work, [absentAt(NOW - 3_000), ev(NOW - 1_000, 'skill-preflight:present')], NOW)).toBe(false); },
    installedAfter: () => { expect(m.skillInstallDue(work, [absentAt(NOW - 3_000), ev(NOW - 1_000, 'skill-install:failed')], NOW)).toBe(false); },
    installedBefore: () => { expect(m.skillInstallDue(work, [ev(NOW - 3_000, 'skill-install:installed'), absentAt()], NOW)).toBe(true); },
    edge: () => { expect(m.skillInstallDue(work, [absentAt(NOW - m.SKILL_INSTALL_WINDOW_MS)], NOW)).toBe(true); },
    stale: () => { expect(m.skillInstallDue(work, [absentAt(NOW - m.SKILL_INSTALL_WINDOW_MS - 1)], NOW)).toBe(false); },
    word: () => { expect(m.skillInstallOutcomeOf({ ok: true, stdout: 'x\n{"result":"converged"}\n' })).toBe('converged'); },
    exit: () => { expect(m.skillInstallOutcomeOf({ ok: false, stdout: '{"result":"installed"}' })).toBe('failed'); },
    lastLine: () => { expect(m.skillInstallOutcomeOf({ ok: true, stdout: '{"result":"installed"}\ntrailing' })).toBe('failed'); },
    otherWord: () => { expect(m.skillInstallOutcomeOf({ ok: true, stdout: '{"result":"unsupported"}' })).toBe('failed'); },
  });
  it('every mutant is killed', async () => {
    const report = await runMutants<SkillInstallModule>({
      modulePath: path.join(ROOT, 'server/src/coord/skillInstall.ts'),
      mutants: [
        { id: 'S1 any kind', old: "if (run.kind !== 'work' || run.sessionId === null) return false;", new: 'if (run.sessionId === null) return false;' },
        { id: 'S2 no session', old: "if (run.kind !== 'work' || run.sessionId === null) return false;", new: "if (run.kind !== 'work') return false;" },
        { id: 'S3 any measurement', old: 'if (row.detail !== `${SKILL_PREFLIGHT_EVENT}absent`) return false;', new: '' },
        { id: 'S4 window edge', old: 'if (now - row.at > SKILL_INSTALL_WINDOW_MS) return false;', new: 'if (now - row.at >= SKILL_INSTALL_WINDOW_MS) return false;' },
        { id: 'S5 no window', old: 'if (now - row.at > SKILL_INSTALL_WINDOW_MS) return false;', new: '' },
        { id: 'S6 any install', old: 'return !events.slice(preflight + 1).some(', new: 'return !events.some(' },
        { id: 'S7 oldest measurement', old: 'for (let i = events.length - 1; i >= 0; i -= 1) {', new: 'for (let i = 0; i < events.length; i += 1) {' },
        { id: 'O1 exit ignored', old: "if (res === null || !res.ok) return 'failed';", new: "if (res === null) return 'failed';" },
        { id: 'O2 first line', old: ".filter((l) => l !== '').pop() ?? '';", new: ".filter((l) => l !== '').shift() ?? '';" },
        { id: 'O3 any word', old: "return word === 'installed' || word === 'converged' ? word : 'failed';", new: "return typeof word === 'string' ? (word as 'installed') : 'failed';" },
      ],
      suite,
    });
    expect(report.results.filter((r) => r.status !== 'killed')).toEqual([]);
    expect(report.score).toBe(1);
  }, 60_000);
});
