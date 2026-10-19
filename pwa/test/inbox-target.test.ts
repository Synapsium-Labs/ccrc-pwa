// U3's model (D-5585): where an Inbox record leads. A record opens its session
// when the fleet still lists it (archived included), else the run board when it
// names a run the board can show, else nothing, with a word saying why.
//
// Pure: no render, no store. P4 (the Inbox's rows) and P8 (Instrument's Inbox
// split) are its readers.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetSession, NotifyEvent, RunSummary } from '../../shared/api';
import { inboxTarget } from '../src/fleet/inboxTarget';
import { fleetSession } from './fleetFixture';

const ev = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: 1_000, kind: 'mail', sessionId: 'ws-a', title: 't', body: 'b', runId: null, ...over,
});

const sessions = (...rows: FleetSession[]): ReadonlyMap<string, FleetSession> =>
  new Map(rows.map((s) => [s.id, s] as const));
const runs = (...ids: number[]): ReadonlyMap<number, Pick<RunSummary, 'id'>> =>
  new Map(ids.map((id) => [id, { id }] as const));

const LISTED = fleetSession({ id: 'ws-a', project: 'project-a' });
const ARCHIVED = fleetSession({ id: 'ws-b', project: 'project-a', status: 'dead', bucket: 'archived', archivedAt: 1_700_000_000 });

describe('inboxTarget', () => {
  it('a record naming a listed session opens it', () => {
    expect(inboxTarget(ev({ sessionId: 'ws-a' }), sessions(LISTED), runs())).toEqual({ kind: 'session', path: '/s/ws-a' });
    // A listed session wins over its run: the session is the more specific target.
    expect(inboxTarget(ev({ sessionId: 'ws-a', runId: 7 }), sessions(LISTED), runs(7))).toEqual({ kind: 'session', path: '/s/ws-a' });
  });

  it('an archived session is still a target', () => {
    expect(inboxTarget(ev({ sessionId: 'ws-b' }), sessions(LISTED, ARCHIVED), runs())).toEqual({ kind: 'session', path: '/s/ws-b' });
  });

  it('a session gone from the fleet with a run opens the board', () => {
    expect(inboxTarget(ev({ kind: 'run', sessionId: 'ws-gone', runId: 7 }), sessions(LISTED), runs(7))).toEqual({ kind: 'runs', path: '/runs' });
  });

  it('a session gone with no run is none, session gone', () => {
    expect(inboxTarget(ev({ sessionId: 'ws-gone' }), sessions(LISTED), runs(7))).toEqual({ kind: 'none', why: 'session gone' });
    // A run the board cannot show (not in its read) is no run to open.
    expect(inboxTarget(ev({ sessionId: 'ws-gone', runId: 9 }), sessions(LISTED), runs(7))).toEqual({ kind: 'none', why: 'session gone' });
  });

  it('a config record is none, no target', () => {
    for (const kind of ['coord', 'update'] as const) {
      expect(inboxTarget(ev({ kind, sessionId: '', runId: null }), sessions(LISTED), runs(7))).toEqual({ kind: 'none', why: 'no target' });
    }
    // About no session but about a run the board shows: the board.
    expect(inboxTarget(ev({ kind: 'run', sessionId: '', runId: 7 }), sessions(LISTED), runs(7))).toEqual({ kind: 'runs', path: '/runs' });
  });

  it('the run is read through eventRunId', () => {
    // An unrevived record (an older build's cached row) reaches a renderer with
    // the key missing. `undefined` used as a Map key is the hazard eventRunId's
    // own comment names; the record must answer as one whose runId is null.
    const unrevived = { seq: 1, at: 1_000, kind: 'mail', sessionId: 'ws-gone', title: 't', body: 'b' } as unknown as NotifyEvent;
    const poisoned = new Map<number, Pick<RunSummary, 'id'>>([[undefined as unknown as number, { id: 7 }]]);
    expect(inboxTarget(unrevived, sessions(LISTED), poisoned)).toEqual({ kind: 'none', why: 'session gone' });
    expect(inboxTarget(unrevived, sessions(LISTED), poisoned)).toEqual(inboxTarget(ev({ sessionId: 'ws-gone', runId: null }), sessions(LISTED), poisoned));
    // And the module never reads the field past that boundary (shared/api.ts's NotifyEvent.runId comment).
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'inboxTarget.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('eventRunId(');
    expect(src).not.toMatch(/\.runId\b/);
    expect(src).not.toMatch(/\[\s*['"`]runId['"`]\s*\]/);
    // A non-number runId (a string '7' from a malformed row) is null to eventRunId,
    // so a board keyed by that string never answers: the record is one about no run.
    const stringRun = { seq: 2, at: 1_000, kind: 'mail', sessionId: 'ws-gone', title: 't', body: 'b', runId: '7' } as unknown as NotifyEvent;
    const keyedByString = new Map<number, Pick<RunSummary, 'id'>>([['7' as unknown as number, { id: 7 }]]);
    expect(inboxTarget(stringRun, sessions(LISTED), keyedByString)).toEqual({ kind: 'none', why: 'session gone' });
  });

  // Step 0's map (the module's header carries it): which fields each kind's
  // server writer fills. Typed on the whole union, so `tsc` fails on a missing kind.
  const KIND_MAP: Record<NotifyEvent['kind'], { readonly session: boolean; readonly run: boolean }> = {
    ask: { session: true, run: false },
    done: { session: true, run: false },
    merged: { session: true, run: false },
    mail: { session: true, run: true },
    run: { session: true, run: true },
    coord: { session: false, run: false },
    update: { session: false, run: false },
    queue: { session: true, run: true },
    interrupt: { session: true, run: false },
    nudge: { session: true, run: false },
    unknown: { session: true, run: true },
  };

  it('every kind has a row in the test\'s table', () => {
    const kinds = Object.keys(KIND_MAP) as NotifyEvent['kind'][];
    expect(kinds).toHaveLength(11);
    for (const kind of kinds) {
      const { session, run } = KIND_MAP[kind];
      const rec = ev({ kind, sessionId: session ? 'ws-a' : '', runId: run ? 7 : null });
      const listed = inboxTarget(rec, sessions(LISTED), runs(7));
      const gone = inboxTarget(rec, sessions(), runs(7));
      expect(listed, kind).toEqual(session ? { kind: 'session', path: '/s/ws-a' } : { kind: 'none', why: 'no target' });
      expect(gone, kind).toEqual(run ? { kind: 'runs', path: '/runs' } : { kind: 'none', why: session ? 'session gone' : 'no target' });
    }
  });

  it('a session id is encoded into its path', () => {
    const odd = fleetSession({ id: 'ws a/b' });
    expect(inboxTarget(ev({ sessionId: 'ws a/b' }), sessions(odd), runs())).toEqual({ kind: 'session', path: '/s/ws%20a%2Fb' });
  });
});
