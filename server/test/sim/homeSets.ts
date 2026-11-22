// The console's home and places deciders (Overlord W1 home, Task 1, plan Global Constraints' "Mutation floors", F13): their
// oracle cases and mutant sets. Each decider is a pure L1 function in the PWA (`pwa/src/overlord/homePlace.ts`,
// `pwa/src/lib/places.ts`); its cases are restated here over a loaded module, as `faceSets.ts` does, so
// `mutation-floors.test.ts` can run them against each textual mutant. The pwa suites (`overlord-home-place.test.ts`,
// `places.test.ts`) pin the same behaviour against the real modules; the duplication is the point, the server runner needs a
// suite it can hand a copy. The modules load by path at runtime, so vitest's import graph does not tie them to the floors
// suite: a pull request that changes only a home decider runs no floor on its fast run, and the merge queue's full run does.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The loaded modules' shapes, written here and only as far as the suite uses them: a type edge into `pwa/` would pull pwa
// sources into the server's node16 resolution (TS2835), and `modulePath` below is a runtime load, not a type edge.
type DesignationState =
  | { kind: 'unmeasured'; why: string } | { kind: 'none' } | { kind: 'failed-start'; outcome: string }
  | { kind: 'pending'; sessionId: string } | { kind: 'bound'; sessionId: string };
type CapRead = { kind: 'unmeasured' } | { kind: 'caps'; caps: readonly string[] };
type RungRead = { kind: 'unmeasured' } | { kind: 'rung'; rung: string };
interface HomeAnswer { place: 'overlord' | 'fleet'; why: string }
interface Row {
  bound: { sessionId: string; generation: string } | null;
  pending: { sessionId: string } | null;
  lastAttempt: { sessionId: string; outcome: string; at: number } | null;
}
type Read =
  | { state: 'loading' } | { state: 'answered'; value: Row | null; at: number }
  | { state: 'stale'; value: Row | null; at: number; error: string } | { state: 'unmeasured'; error: string } | { state: 'absent' };
interface HomeModule {
  OVERLORD_CAP: string;
  designationStateOf(read: Read): DesignationState;
  homePlace(caps: CapRead, d: DesignationState, rung: RungRead): HomeAnswer;
}
interface Place { id: string }
interface PlacesModule {
  placesFor(shown: boolean, d: DesignationState): readonly Place[];
  deskPlacesFor(shown: boolean, d: DesignationState, home: HomeAnswer): readonly Place[];
  phoneDoorsFit(widthPx: number, places: readonly Place[]): readonly Place[];
}

const AT = 1_700_000_000_000;
const row = (over: Partial<Row> = {}): Row => ({ bound: null, pending: null, lastAttempt: null, ...over });
const answered = (value: Row | null): Read => ({ state: 'answered', value, at: AT });
const S: Readonly<Record<DesignationState['kind'], DesignationState>> = {
  unmeasured: { kind: 'unmeasured', why: 'loading' },
  none: { kind: 'none' },
  'failed-start': { kind: 'failed-start', outcome: 'create-failed' },
  pending: { kind: 'pending', sessionId: 'lane-a-overlord' },
  bound: { kind: 'bound', sessionId: 'lane-a-overlord' },
};
const OFF: RungRead = { kind: 'rung', rung: 'off' };
const CHAT: RungRead = { kind: 'rung', rung: 'chat' };
const UNREAD: RungRead = { kind: 'unmeasured' };
const TODAY = ['fleet', 'waiting', 'inbox', 'runs', 'accounts', 'docs'];
const ids = (ps: readonly Place[]): string[] => ps.map((p) => p.id);

export function designationCases(m: HomeModule): Record<string, SuiteCase> {
  return {
    'loading and a failed read are unmeasured': () => {
      expect(m.designationStateOf({ state: 'loading' }).kind).toBe('unmeasured');
      expect(m.designationStateOf({ state: 'unmeasured', error: 'HTTP 503' })).toEqual({ kind: 'unmeasured', why: 'HTTP 503' });
    },
    'an older server (absent) is none, never unmeasured': () => {
      expect(m.designationStateOf({ state: 'absent' })).toEqual({ kind: 'none' });
    },
    'no row, a bare row and a retired attempt are none': () => {
      expect(m.designationStateOf(answered(null))).toEqual({ kind: 'none' });
      expect(m.designationStateOf(answered(row()))).toEqual({ kind: 'none' });
      expect(m.designationStateOf(answered(row({ lastAttempt: { sessionId: 'lane-a-overlord', outcome: 'retired', at: AT } }))))
        .toEqual({ kind: 'none' });
    },
    'a failed attempt that stands is failed-start': () => {
      expect(m.designationStateOf(answered(row({ lastAttempt: { sessionId: 'lane-a-overlord', outcome: 'create-failed', at: AT } }))))
        .toEqual({ kind: 'failed-start', outcome: 'create-failed' });
    },
    'bound before pending, pending before a failure': () => {
      const bound = row({ bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: { sessionId: 'lane-b-overlord' } });
      expect(m.designationStateOf(answered(bound))).toEqual({ kind: 'bound', sessionId: 'lane-a-overlord' });
      const pending = row({ pending: { sessionId: 'lane-b-overlord' }, lastAttempt: { sessionId: 'x', outcome: 'create-failed', at: AT } });
      expect(m.designationStateOf(answered(pending))).toEqual({ kind: 'pending', sessionId: 'lane-b-overlord' });
    },
    'a stale read keeps its last answer': () => {
      expect(m.designationStateOf({ state: 'stale', value: row({ bound: { sessionId: 'lane-a-overlord', generation: 'g1' } }), at: AT, error: 'x' }))
        .toEqual({ kind: 'bound', sessionId: 'lane-a-overlord' });
    },
  };
}

export function homeCases(m: HomeModule): Record<string, SuiteCase> {
  const word: CapRead = { kind: 'caps', caps: [m.OVERLORD_CAP] };
  return {
    'without the word the home is the Fleet, not advertised': () => {
      for (const caps of [{ kind: 'caps', caps: [] } as CapRead, { kind: 'unmeasured' } as CapRead]) {
        for (const d of Object.values(S)) for (const r of [OFF, CHAT, UNREAD]) expect(m.homePlace(caps, d, r)).toEqual({ place: 'fleet', why: 'not-advertised' });
      }
    },
    'a designated Overlord is the home unless the rung is off': () => {
      for (const d of [S.bound, S.pending]) {
        expect(m.homePlace(word, d!, CHAT)).toEqual({ place: 'overlord', why: 'designated' });
        expect(m.homePlace(word, d!, UNREAD)).toEqual({ place: 'overlord', why: 'rung-unmeasured' });
        expect(m.homePlace(word, d!, OFF)).toEqual({ place: 'fleet', why: 'rung-off' });
      }
    },
    'no Overlord, a failed start and an unread designation are the Fleet': () => {
      for (const r of [OFF, CHAT, UNREAD]) {
        expect(m.homePlace(word, S.none!, r)).toEqual({ place: 'fleet', why: 'none' });
        expect(m.homePlace(word, S['failed-start']!, r)).toEqual({ place: 'fleet', why: 'failed-start' });
        expect(m.homePlace(word, S.unmeasured!, r)).toEqual({ place: 'fleet', why: 'designation-unmeasured' });
      }
    },
  };
}

export function placesCases(m: PlacesModule): Record<string, SuiteCase> {
  return {
    "today's places with no door": () => {
      for (const d of Object.values(S)) expect(ids(m.placesFor(false, d))).toEqual(TODAY);
      expect(ids(m.placesFor(true, S.none!))).toEqual(TODAY);
      expect(ids(m.placesFor(true, S.unmeasured!))).toEqual(TODAY);
    },
    'the Overlord first for bound, pending and a failed start': () => {
      for (const k of ['bound', 'pending', 'failed-start'] as const) expect(ids(m.placesFor(true, S[k]!))).toEqual(['overlord', ...TODAY]);
    },
  };
}

export function deskCases(m: PlacesModule): Record<string, SuiteCase> {
  const OVER: HomeAnswer = { place: 'overlord', why: 'designated' };
  return {
    'no Fleet door with no Overlord door (D25), whatever the home says': () => {
      expect(ids(m.deskPlacesFor(false, S.bound!, OVER))).toEqual(TODAY.slice(1));
      expect(ids(m.deskPlacesFor(true, S.none!, { place: 'fleet', why: 'none' }))).toEqual(TODAY.slice(1));
    },
    'the Fleet door second while the home is the Overlord': () => {
      expect(ids(m.deskPlacesFor(true, S.bound!, OVER))).toEqual(['overlord', 'fleet', ...TODAY.slice(1)]);
    },
    'no Fleet door while the home is the Fleet': () => {
      expect(ids(m.deskPlacesFor(true, S.bound!, { place: 'fleet', why: 'rung-off' }))).toEqual(['overlord', ...TODAY.slice(1)]);
    },
  };
}

export function phoneCases(m: PlacesModule): Record<string, SuiteCase> {
  const eight = (): readonly Place[] => m.placesFor(true, S.bound!);
  return {
    'seven doors at 320 px, Docs dropped': () => { expect(ids(m.phoneDoorsFit(320, eight()))).toEqual(['overlord', ...TODAY.slice(0, -1)]); },
    'all eight at 360 and 390 px': () => {
      expect(ids(m.phoneDoorsFit(360, eight()))).toEqual(['overlord', ...TODAY]);
      expect(ids(m.phoneDoorsFit(390, eight()))).toEqual(['overlord', ...TODAY]);
    },
    'the Overlord and the Fleet are never dropped': () => {
      expect(ids(m.phoneDoorsFit(132, eight()))).toEqual(['overlord', 'fleet']);
      expect(ids(m.phoneDoorsFit(88, eight()))).toEqual(['overlord', 'fleet']);
      expect(ids(m.phoneDoorsFit(88, m.placesFor(false, S.none!)))).toEqual(['fleet']);
    },
  };
}

const HOME = path.join(ROOT, 'pwa/src/overlord/homePlace.ts');
const PLACES = path.join(ROOT, 'pwa/src/lib/places.ts');

const DESIGNATION_SET: MutantSet<HomeModule> = {
  modulePath: HOME,
  mutants: [
    { id: 'H3', old: " && row.lastAttempt.outcome !== 'retired'", new: '' },
    { id: 'H4', old: "if (read.state === 'absent') return { kind: 'none' };", new: "if (read.state === 'absent') return { kind: 'unmeasured', why: 'absent' };" },
  ],
  suite: designationCases,
};
const HOME_SET: MutantSet<HomeModule> = {
  modulePath: HOME,
  mutants: [
    { id: 'H1', old: "off: FLEET('rung-off'),", new: "off: { place: 'overlord', why: 'designated' }," },
    { id: 'H2', old: 'if (!overlordShown(caps)) return NOT_ADVERTISED;', new: '' },
  ],
  suite: homeCases,
};
const PLACES_SET: MutantSet<PlacesModule> = {
  modulePath: PLACES,
  mutants: [{ id: 'H5', old: 'shown && OVERLORD_DOOR[d.kind] ?', new: 'shown ?' }],
  suite: placesCases,
};
const DESK_SET: MutantSet<PlacesModule> = {
  modulePath: PLACES,
  mutants: [{ id: 'H6', old: 'rest[0]?.id !== OVERLORD_PLACE.id || ', new: '' }],
  suite: deskCases,
};
const PHONE_SET: MutantSet<PlacesModule> = {
  modulePath: PLACES,
  mutants: [
    { id: 'H7', old: 'Math.floor(widthPx / PHONE_DOOR_MIN_PX)', new: 'Math.ceil(widthPx / PHONE_DOOR_MIN_PX)' },
    { id: 'H8', old: 'if (PHONE_KEEPS.has(kept[i]!.id)) continue;', new: 'if (kept[i]!.id === FLEET_PLACE) continue;' },
  ],
  suite: phoneCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const HOME_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'pwa/src/overlord/homePlace.ts#designationStateOf': DESIGNATION_SET as MutantSet<never>,
  'pwa/src/overlord/homePlace.ts#homePlace': HOME_SET as MutantSet<never>,
  'pwa/src/lib/places.ts#placesFor': PLACES_SET as MutantSet<never>,
  'pwa/src/lib/places.ts#deskPlacesFor': DESK_SET as MutantSet<never>,
  'pwa/src/lib/places.ts#phoneDoorsFit': PHONE_SET as MutantSet<never>,
};
