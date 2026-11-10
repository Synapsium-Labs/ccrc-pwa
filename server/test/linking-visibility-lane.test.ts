import { describe, it, expect } from 'vitest';
import { VisibilityLane } from '../src/linking/visibilityLane.js';
import { VISIBILITY_MAX_AGE_MS, VISIBILITY_RETRY_MS } from '../src/linking/policy.js';
import type { ProjectLinkingWire } from '../../shared/linking.js';
import type { CcdResult } from '../src/coord/ports.js';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const ran = (ok: boolean, stdout: string): CcdResult => ({ ran: true, ok, stdout, stderr: '', killed: false, signal: null });
const MEASURED = '{"slug":"owner/repo","visibility":"private","defaultBranch":"main","template":"absent"}\n';

function rig(answer: (argv: readonly string[]) => CcdResult, opts: { verbs?: string[] | null } = {}) {
  const rows = new Map<string, ProjectLinkingWire['measured']>();
  const calls: (readonly string[])[] = [];
  const coord = {
    linkingAll: () => new Map([...rows].map(([p, measured]) => [p, { teamKey: null, override: null, measured, mode: 'unknown' as const }])),
    recordLinkingReading: (p: string, r: ProjectLinkingWire['measured']) => { rows.set(p, r); },
  };
  const lane = new VisibilityLane(() => ({
    coord: coord as never,
    runCcd: async (argv) => { calls.push(argv); return answer(argv); },
    fleetState: opts.verbs === undefined ? undefined : ({ ccdVerbs: opts.verbs } as never),
  }));
  return { lane, rows, calls };
}

describe('the visibility lane (D-8147)', () => {
  it('measures a never-measured project first', async () => {
    const r = rig(() => ran(true, MEASURED));
    r.rows.set('project-b', { state: 'measured', visibility: 'public', slug: 'o/b', template: 'absent', at: NOW - 30 * HOUR });
    await r.lane.tick(['project-b', 'project-a'], NOW);
    expect(r.calls).toEqual([['repo-visibility', '--project', 'project-a']]);
    expect(r.rows.get('project-a')).toEqual({ state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW });
  });

  it('measures nothing while every reading is younger than 24 h', async () => {
    const r = rig(() => ran(true, MEASURED));
    r.rows.set('project-a', { state: 'measured', visibility: 'private', slug: 'o/a', template: 'present', at: NOW - VISIBILITY_MAX_AGE_MS + 1000 });
    await r.lane.tick(['project-a'], NOW);
    expect(r.calls).toEqual([]);
  });

  it('records a failure with its reason and keeps the project due on the next day', async () => {
    const r = rig(() => ran(false, '{"reason":"rate-limit"}\n'));
    await r.lane.tick(['project-a'], NOW);
    expect(r.rows.get('project-a')).toEqual({ state: 'failed', reason: 'rate-limit', at: NOW });
    await r.lane.tick(['project-a'], NOW + 60_000);
    expect(r.calls).toHaveLength(1);
    await r.lane.tick(['project-a'], NOW + VISIBILITY_RETRY_MS);   // a failure is retried in minutes, not a day
    expect(r.calls).toHaveLength(2);
  });

  it('records bad-answer for an answer it cannot read', async () => {
    const r = rig(() => ran(true, 'not json\n'));
    await r.lane.tick(['project-a'], NOW);
    expect(r.rows.get('project-a')).toEqual({ state: 'failed', reason: 'bad-answer', at: NOW });
  });

  it('makes at most one ccd call per tick', async () => {
    const r = rig(() => ran(true, MEASURED));
    await r.lane.tick(['project-a', 'project-b', 'project-c'], NOW);
    expect(r.calls).toHaveLength(1);
    await r.lane.tick(['project-a', 'project-b', 'project-c'], NOW);
    expect(r.calls).toHaveLength(2);
    expect(new Set(r.calls.map((c) => c[2])).size).toBe(2);
  });

  it('answers unsupported quietly on a ccd without the verb', async () => {
    const r = rig(() => ran(true, MEASURED), { verbs: ['pr-state'] });
    await r.lane.tick(['project-a'], NOW);
    expect(r.calls).toEqual([]);
    expect(r.rows.size).toBe(0);
  });

  it('never throws when the box does', async () => {
    const r = rig(() => { throw new Error('boom'); });
    await expect(r.lane.tick(['project-a'], NOW)).resolves.toBeUndefined();
  });
});
