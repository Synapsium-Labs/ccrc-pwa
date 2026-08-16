// Task 13 — offline shell: the fleet snapshot persists to localStorage, the
// fleet store hydrates from it at boot (conn stays 'connecting'), and the
// fleet screen stale-marks hydrated data until the socket opens.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { FleetSession } from '../../shared/api';
import { loadFleetSnapshot, saveFleetSnapshot } from '../src/lib/offline';
import { createFleetStore } from '../src/stores/fleet';
import { FleetScreen } from '../src/screens/FleetScreen';
import { TEST_ROSTER } from './rosterFixture';

const session = (id: string): FleetSession => ({
  id,
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/projects/OpenClawHetzner',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: null,
  limits: { five: 10, seven: 40 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  version: '2.1.0', hookState: null, askSummary: null, subagents: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, started: true, spawnState: null,
});

/** Scripted WebSocket stand-in (same shape the store tests use). */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  FakeSocket.instances = [];
});

afterEach(() => {
  cleanup();
});

describe('fleet snapshot (lib/offline)', () => {
  it('round-trips sessions through localStorage', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    const snap = loadFleetSnapshot();
    expect(snap?.sessions).toHaveLength(1);
    expect(snap?.sessions[0]?.id).toBe('claude:OpenClawHetzner');
    expect(typeof snap?.savedAt).toBe('number');
  });

  it('returns null when absent or corrupt', () => {
    expect(loadFleetSnapshot()).toBeNull();
    window.localStorage.setItem('ccrc.fleet-snapshot.v1', 'not json');
    expect(loadFleetSnapshot()).toBeNull();
    window.localStorage.setItem('ccrc.fleet-snapshot.v1', '{"savedAt":"no","sessions":{}}');
    expect(loadFleetSnapshot()).toBeNull();
  });
});

// Fix round 1, finding 3: a cold offline start hydrated `sessions` from the
// snapshot but never `roster` — every account rendered as its raw wrapper id
// (`claude2`, `claude-corp`) instead of the jargon-free label this module
// exists to restore, a real regression against the compile-time roster this
// replaced (which had no "unarrived" state at all).
describe('the roster travels with the snapshot (fix round 1, finding 3)', () => {
  it('round-trips the roster alongside sessions', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')], TEST_ROSTER);
    expect(loadFleetSnapshot()?.roster).toEqual(TEST_ROSTER);
  });

  it('degrades an absent roster to `[]` — a pre-Task-7 snapshot is version skew, not corruption', () => {
    // Same call shape a caller that has never heard of `roster` would make —
    // the second argument defaults, it is not required.
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    expect(loadFleetSnapshot()?.roster).toEqual([]);
    // And the sessions still revive normally — an unknown-to-this-snapshot
    // field must not sink the read the way a malformed SESSION does.
    expect(loadFleetSnapshot()?.sessions).toHaveLength(1);
  });

  it('degrades a roster of the wrong shape entirely to `[]`, without rejecting the whole snapshot', () => {
    window.localStorage.setItem(
      'ccrc.fleet-snapshot.v1',
      JSON.stringify({ savedAt: Date.now(), sessions: [session('claude:OpenClawHetzner')], roster: 'not an array' }),
    );
    const snap = loadFleetSnapshot();
    expect(snap?.roster).toEqual([]);
    expect(snap?.sessions).toHaveLength(1);
  });

  it('filters out individually malformed roster entries rather than crashing or rejecting the snapshot', () => {
    window.localStorage.setItem(
      'ccrc.fleet-snapshot.v1',
      JSON.stringify({
        savedAt: Date.now(),
        sessions: [session('claude:OpenClawHetzner')],
        roster: [
          TEST_ROSTER[0],
          null, // the shape a `null` array entry takes — `.id` on it would throw
          { id: 'claude2', label: 'alt·max', hue: 'not-a-real-hue', homeAble: true },
          { id: 'claude-corp', label: 'team·shared', homeAble: true }, // missing hue
          'not an object',
        ],
      }),
    );
    const snap = loadFleetSnapshot();
    expect(snap?.roster).toEqual([TEST_ROSTER[0]]);
    expect(snap?.sessions).toHaveLength(1);
  });
});

// Registry ladder (Task 2): `saveFleetSnapshot` refuses two frame shapes
// before ever touching storage — same reasoning `lib/seen.ts`'s `prune`
// already states for an empty set (seen.ts:198-208): absent evidence proves
// nothing, so a frame this shape must never overwrite a fuller prior one.
describe('saveFleetSnapshot refuses an empty or degraded frame (Task 2)', () => {
  it('an empty frame never overwrites a real prior snapshot', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    saveFleetSnapshot([]); // e.g. a transient readdir failure broadcast as `[]`
    expect(loadFleetSnapshot()?.sessions.map((s) => s.id)).toEqual(['claude:OpenClawHetzner']);
  });

  it('an empty frame writes nothing on a cold start either — no snapshot is the honest answer, not an empty one', () => {
    saveFleetSnapshot([]);
    expect(loadFleetSnapshot()).toBeNull();
  });

  it('a frame carrying even one degraded (unmeasured) row never overwrites a real prior snapshot', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    saveFleetSnapshot([
      session('claude:OpenClawHetzner'),
      { ...session('claude2:mekwarlive'), unmeasured: ['workdir'] },
    ]);
    expect(loadFleetSnapshot()?.sessions.map((s) => s.id)).toEqual(['claude:OpenClawHetzner']);
  });

  it('a fully-measured frame writes normally — the guard is specific to the two refused shapes, not a blanket freeze', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    saveFleetSnapshot([session('claude:OpenClawHetzner'), session('claude2:mekwarlive')]);
    expect(loadFleetSnapshot()?.sessions.map((s) => s.id).sort()).toEqual(
      ['claude:OpenClawHetzner', 'claude2:mekwarlive'].sort(),
    );
  });
});

describe('fleet store hydration + persistence', () => {
  it('hydrates sessions from the snapshot at boot, still connecting', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['claude:OpenClawHetzner']);
    expect(store.getState().conn).toBe('connecting');
  });

  // Fix round 1, finding 3.
  it('hydrates the roster from the snapshot at boot too, alongside sessions', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')], TEST_ROSTER);
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    expect(store.getState().roster).toEqual(TEST_ROSTER);
  });

  it('persists each live fleet message as the new snapshot', () => {
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    store.getState().connect();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.message(JSON.stringify({ type: 'fleet', sessions: [session('claude2:mekwarlive')] }));

    expect(store.getState().sessions.map((s) => s.id)).toEqual(['claude2:mekwarlive']);
    expect(loadFleetSnapshot()?.sessions.map((s) => s.id)).toEqual(['claude2:mekwarlive']);
    store.getState().disconnect();
  });

  // Fix round 1, finding 3: a `fleet` frame carries no roster of its own (it
  // travels over the separate `/api/accounts` poll), so the snapshot's
  // roster has to come off CURRENT store state at the moment of the write,
  // not off the message.
  it('persists the current in-memory roster alongside a live fleet frame', () => {
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    store.getState().connect();
    // Simulates the independent roster poll having already landed by the
    // time this fleet frame arrives.
    store.setState({ roster: TEST_ROSTER });
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.message(JSON.stringify({ type: 'fleet', sessions: [session('claude2:mekwarlive')] }));

    expect(loadFleetSnapshot()?.roster).toEqual(TEST_ROSTER);
    store.getState().disconnect();
  });

  // Task 2: the store's own `onMessage` calls `saveFleetSnapshot` unguarded
  // on every `fleet` frame (stores/fleet.ts) — the refusal has to live INSIDE
  // that function for a live socket message to inherit it too, not just a
  // direct call site.
  it('a LIVE fleet frame carrying a degraded row still updates the in-memory store (the socket is still ' +
     'authoritative) but does NOT overwrite the offline snapshot', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    store.getState().connect();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.message(JSON.stringify({
      type: 'fleet',
      sessions: [{ ...session('claude2:mekwarlive'), unmeasured: ['workdir'] }],
    }));

    // The live view still reflects the fresh frame — degrade-and-heal is a
    // DISPLAY concern (SessionLine's own grey+reason note), not a reason to
    // hide the row from the connected client.
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['claude2:mekwarlive']);
    // The offline cache, by contrast, keeps the last FULLY-measured snapshot.
    expect(loadFleetSnapshot()?.sessions.map((s) => s.id)).toEqual(['claude:OpenClawHetzner']);
    store.getState().disconnect();
  });

  // Blocking review finding 2: `saveFleetSnapshot` used to read
  // `s.unmeasured.length` directly. A LIVE `fleet` frame is never revived
  // (`stores/fleet.ts`'s `asFleetMsg` casts, it does not call
  // `reviveFleetSession`), so a row from a server that predates this field —
  // `FLEET_PROTO` stays 1 on purpose, an older server keeps talking to a
  // newer client by design — can omit the `unmeasured` KEY entirely at
  // runtime. The existing degraded-row case above always SETS the key
  // (`unmeasured: ['workdir']`), so it cannot catch a missing key; this test
  // deletes it from the wire object instead of setting it to anything.
  it('a LIVE fleet frame whose rows omit `unmeasured` entirely (an older server) does not throw, ' +
     'and is not treated as degraded', () => {
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    store.getState().connect();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    const raw = session('claude2:mekwarlive') as unknown as Record<string, unknown>;
    delete raw['unmeasured'];

    expect(() => sock.message(JSON.stringify({ type: 'fleet', sessions: [raw] }))).not.toThrow();

    expect(store.getState().sessions.map((s) => s.id)).toEqual(['claude2:mekwarlive']);
    // Absent reads as MEASURED (same rule `optUnmeasured` applies on the
    // revival path), so this frame is not degraded and DOES overwrite the
    // offline snapshot.
    expect(loadFleetSnapshot()?.sessions.map((s) => s.id)).toEqual(['claude2:mekwarlive']);
    store.getState().disconnect();
  });
});

/**
 * A session object exactly as an OLDER BUILD wrote it into the snapshot: every
 * field that build knew, and NONE of the ones added since — `tasks`, and Task
 * 1's `pr`/`archivedAt`. Deliberately NOT typed `FleetSession`: the whole point
 * is that what comes out of storage is not one yet.
 */
const v1Session = (id: string): Record<string, unknown> => ({
  id,
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/worktrees/OpenClawHetzner/quiet-basin',
  workspace: 'quiet-basin',
  name: null,
  status: 'idle',
  statusUpdatedAt: 1785300000000,
  limits: { five: 10, seven: 40 },
  dialogPending: false,
  version: '2.1.0',
  model: null,
  effort: null,
  ultracode: false,
  branch: 'ws/quiet-basin',
});

/** Write a snapshot the way an older build did — bypassing saveFleetSnapshot,
 *  which can only ever write TODAY's shape. The key is spelled out rather than
 *  imported: this is the key that build used, and it has to stay readable. */
const putRaw = (sessions: unknown[]): void =>
  window.localStorage.setItem(
    'ccrc.fleet-snapshot.v1',
    JSON.stringify({ savedAt: 1785300000001, sessions }),
  );

describe('snapshot revival (a snapshot written by an older build)', () => {
  it('revives absent pr/archivedAt/tasks as null, not undefined', () => {
    putRaw([v1Session('claude:OpenClawHetzner')]);
    const s = loadFleetSnapshot()?.sessions[0];

    // `undefined !== null` is true, so an absent archivedAt reads as ARCHIVED
    // everywhere and offers "Clean up workspace…" on a live workspace; an
    // absent pr is dereferenced for .title by PrSheet; an absent tasks renders
    // `undefined/undefined` in SessionLine's tally (that one is already on main).
    expect(s?.archivedAt).toBeNull();
    expect(s?.pr).toBeNull();
    expect(s?.tasks).toBeNull();
    // The KEYS must exist too: a JSON round-trip drops undefined-valued keys,
    // so `{archivedAt: undefined}` would persist right back to absent.
    expect(Object.keys(s ?? {})).toEqual(expect.arrayContaining(['pr', 'archivedAt', 'tasks']));
    // Everything the old build DID know survives — this is not a discard.
    expect(s?.id).toBe('claude:OpenClawHetzner');
    expect(s?.branch).toBe('ws/quiet-basin');
    expect(s?.workspace).toBe('quiet-basin');
    expect(s?.statusUpdatedAt).toBe(1785300000000);
    expect(s?.limits).toEqual({ five: 10, seven: 40 });
  });

  it('hydrates the store from an old snapshot with nulls at boot', () => {
    putRaw([v1Session('claude:OpenClawHetzner')]);
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    const s = store.getState().sessions[0];
    expect(s?.archivedAt).toBeNull();
    expect(s?.pr).toBeNull();
    expect(s?.tasks).toBeNull();
  });

  it('revives archivedBytes independently of archivedAt — no key-swap, no shared fallback', () => {
    // DEVIATION from the brief's given test text — added while closing a
    // mutation-sweep gap; see task-19-report.md. Both fields are
    // `number | null` and both revive through the same optNum(o, key)
    // pattern, which is exactly the risk: a mutant reading 'archivedAt'
    // for archivedBytes too (or vice versa) would pass every OTHER test in
    // this file, since they all leave the two fields equal (both absent,
    // both null). Distinct non-null values is the only way to catch that.
    putRaw([{ ...v1Session('claude:OpenClawHetzner'), archivedAt: 100, archivedBytes: 5_000_000 }]);
    const s = loadFleetSnapshot()?.sessions[0];
    expect(s?.archivedAt).toBe(100);
    expect(s?.archivedBytes).toBe(5_000_000);
  });

  it('revives a pr object whose newer fields the writing build did not have', () => {
    // The same skew one level down: `pr` exists, but a field added to PrState
    // after it was written does not.
    putRaw([{ ...v1Session('claude:OpenClawHetzner'), pr: { phase: 'open', number: 7, ahead: 3 } }]);
    const pr = loadFleetSnapshot()?.sessions[0]?.pr;
    expect(pr?.phase).toBe('open');
    expect(pr?.number).toBe(7);
    expect(pr?.ahead).toBe(3);
    expect(pr?.checks).toBeNull();
    expect(pr?.checkNames).toBeNull();
    expect(pr?.retryAt).toBeNull();
    expect(pr?.title).toBeNull();
    expect(pr?.url).toBeNull();
    expect(pr?.reason).toBeNull();
    expect(pr?.checkedAt).toBeNull();
    expect(pr?.mergedAt).toBeNull();
  });

  it('degrades a pr phase or reason this build does not know, and keeps the rest', () => {
    // Same stance as registry.ts: never leak a string the UI switches on.
    // `phase` and `reason` each have a designated "we do not know" member
    // ('unchecked' / null), so a token from a newer build has somewhere honest
    // to land and the session stays usable.
    putRaw([{
      ...v1Session('claude:OpenClawHetzner'),
      pr: { phase: 'teleported', reason: 'sunspots', ahead: 0, number: 12 },
    }]);
    const pr = loadFleetSnapshot()?.sessions[0]?.pr;
    expect(pr?.phase).toBe('unchecked');
    expect(pr?.reason).toBeNull();
    expect(pr?.number).toBe(12);
  });

  it('rejects the whole snapshot rather than launder a malformed session', () => {
    // A wrong-TYPED field is not an older build, it is a broken snapshot, and
    // repairing it would show a plausible fleet built on junk. Cold-starting
    // empty is what bumping the storage key would have done anyway — and one
    // bad session rejects the FILE, because a fleet quietly missing a session
    // looks exactly like a fleet, while an empty one looks empty.
    const cases: [string, unknown][] = [
      ['archivedAt of the wrong type', { ...v1Session('a'), archivedAt: 'yesterday' }],
      ['pr that is not an object', { ...v1Session('a'), pr: 7 }],
      ['tasks without running — no honest value to invent for it',
        { ...v1Session('a'), tasks: { total: 3, done: 1 } }],
      ['pr without ahead — no honest commit count to invent',
        { ...v1Session('a'), pr: { phase: 'open', number: 7 } }],
      // Unlike phase/reason, PrChecks has no "we do not know" member: its null
      // means NO CHECKS ARE CONFIGURED, so an unknown token has nothing safe to
      // degrade to and must not be flattened into that claim.
      ['pr.checks token this build does not know',
        { ...v1Session('a'), pr: { phase: 'open', ahead: 1, checks: 'flaky' } }],
      ['pr.checkNames holding a non-string',
        { ...v1Session('a'), pr: { phase: 'open', ahead: 1, checkNames: ['build', 7] } }],
      // SessionStatus has no "unknown" member either, and it drives a CSS class.
      ['status outside busy|idle|dead', { ...v1Session('a'), status: 'exploded' }],
      ['limits holding a non-number', { ...v1Session('a'), limits: { five: 'lots', seven: 40 } }],
      // JSON.stringify drops undefined-valued keys, so this session reaches the
      // reader with NO id at all: a required field absent, not merely null.
      ['no id at all', { ...v1Session('a'), id: undefined }],
      ['workdir of the wrong type', { ...v1Session('a'), workdir: 42 }],
      ['ultracode missing entirely', (() => {
        const s = v1Session('a');
        delete s['ultracode'];
        return s;
      })()],
      ['not an object at all', 'not a session'],
      ['a session that is an array', [1, 2, 3]],
    ];
    for (const [label, bad] of cases) {
      window.localStorage.clear();
      putRaw([bad]);
      expect(loadFleetSnapshot(), label).toBeNull();
    }
  });

  it('rejects the file when only ONE of several sessions is malformed', () => {
    putRaw([v1Session('good'), { ...v1Session('bad'), archivedAt: 'yesterday' }]);
    expect(loadFleetSnapshot()).toBeNull();
  });

  it('keeps reading the v1 key — the old snapshot is migrated, not discarded', () => {
    // A key bump to .v2 would close the same hole by THROWING THE SNAPSHOT AWAY,
    // cold-starting every phone empty — the one thing this module exists to
    // prevent — and would need bumping again for the next nullable field. So the
    // v1 key must still be read, and written back to, with no second key beside it.
    putRaw([v1Session('claude:OpenClawHetzner')]);
    expect(loadFleetSnapshot()?.sessions).toHaveLength(1);

    saveFleetSnapshot(loadFleetSnapshot()!.sessions);
    const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
    expect(keys).toEqual(['ccrc.fleet-snapshot.v1']);
    // The revived nulls survive the re-save — they are real keys, not undefined.
    expect(loadFleetSnapshot()?.sessions[0]?.archivedAt).toBeNull();
    expect(loadFleetSnapshot()?.sessions[0]?.pr).toBeNull();
  });

  it('still round-trips a snapshot this build wrote', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    expect(loadFleetSnapshot()?.sessions).toEqual([session('claude:OpenClawHetzner')]);
  });
});

describe('FleetScreen stale marking', () => {
  it('shows hydrated cards behind a last-known banner while connecting', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    render(createElement(FleetScreen, { store }));

    // Instant content from the snapshot, clearly marked stale.
    expect(screen.getByText('OpenClawHetzner')).toBeInTheDocument();
    expect(screen.getByText('Last known state — connecting…')).toBeInTheDocument();

    // Socket opens with a live snapshot: the stale banner goes away.
    act(() => {
      const sock = FakeSocket.instances[0]!;
      sock.open();
      sock.message(JSON.stringify({ type: 'fleet', sessions: [session('claude:OpenClawHetzner')] }));
    });
    expect(screen.queryByText('Last known state — connecting…')).not.toBeInTheDocument();
  });
});
