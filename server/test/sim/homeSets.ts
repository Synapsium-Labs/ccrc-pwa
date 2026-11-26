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
type AnyRead<T> =
  | { state: 'loading' } | { state: 'answered'; value: T; at: number }
  | { state: 'stale'; value: T; at: number; error: string } | { state: 'unmeasured'; error: string } | { state: 'absent' };
interface HomeModule {
  OVERLORD_CAP: string;
  designationStateOf(read: Read): DesignationState;
  homePlace(caps: CapRead, d: DesignationState, rung: RungRead): HomeAnswer;
  homeSettled(caps: AnyRead<readonly string[]>, designation: Read, ladder: AnyRead<unknown>): boolean;
  capReadOf(read: AnyRead<readonly string[]>): CapRead;
  rungReadOf(read: AnyRead<{ operatorRung: string }>): RungRead;
  designationWordOf(read: Read): string;
  DESIGNATION_WORDS: Readonly<Record<string, string>>;
  DESIGNATION_LOADING_WORD: string;
}
type Outcome<T> = { kind: 'value'; value: T } | { kind: 'absent' } | { kind: 'failed'; error: string };
interface ReadOutcomeModule {
  nextReadState<T>(prev: AnyRead<T>, outcome: Outcome<T>, at: number): AnyRead<T>;
  readFailed(read: AnyRead<unknown>): boolean;
}
interface Place { id: string }
interface PlacesModule {
  placesFor(shown: boolean, d: DesignationState): readonly Place[];
  deskPlacesFor(shown: boolean, d: DesignationState, home: HomeAnswer): readonly Place[];
  phoneDoorsFit(widthPx: number, places: readonly Place[]): readonly Place[];
}

// `sinceWords.ts` (Overlord W1 home B, Task 6): "Since you were last here", Table 4.1b's order, its cap of seven, and the rule that a
// failed read is "unmeasured" and never "quiet".
interface SinceLine { key: string; section: string; text: string; measured: boolean }
type SinceRead<T> = { state: 'answered'; value: T } | { state: 'failed' };
interface SinceProgrammes {
  closedToday: { operator: number; sweep: number; coordinator: number };
  programmes: { slug: string; title: string; stuck?: number; waves: { working: number; waiting: number; queued: number } }[];
}
interface SinceFacts { waiting: SinceRead<{ items: { state: string }[] }>; programmes: SinceRead<SinceProgrammes> }
interface SinceModule {
  SINCE_MAX_LINES: number;
  UNMEASURED_TEXT: string;
  sinceLines(facts: SinceFacts, lastHereMs: number | null, nowMs: number): readonly SinceLine[];
}

const AT = 1_700_000_000_000;
const row =(over: Partial<Row> = {}): Row => ({ bound: null, pending: null, lastAttempt: null, ...over });
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

// Review 3319 F3: `homeSettled` says when `/` may replace itself. Each wait is a guard: without the caps wait the home lands
// before the word is known, without the designation wait it lands on the Fleet before the designation answers, and without
// the ladder wait a designated Overlord's home lands on the place before an `off` rung would send it to the Fleet.
export function settledCases(m: HomeModule): Record<string, SuiteCase> {
  const word = { state: 'answered', value: [m.OVERLORD_CAP], at: AT } as const;
  const bound = answered(row({ bound: { sessionId: 'lane-a-overlord', generation: 'g1' } }));
  const pending = answered(row({ pending: { sessionId: 'lane-a-overlord' } }));
  const loading = { state: 'loading' } as const;
  const chat = { state: 'answered', value: { operatorRung: 'chat' }, at: AT } as const;
  return {
    'the caps still loading: not settled, whatever else has answered': () => {
      expect(m.homeSettled(loading, bound, chat)).toBe(false);
      expect(m.homeSettled(loading, answered(null), chat)).toBe(false);
    },
    'no word (answered without it, or a failed caps read): settled at once': () => {
      expect(m.homeSettled({ state: 'answered', value: [], at: AT }, loading, loading)).toBe(true);
      expect(m.homeSettled({ state: 'unmeasured', error: 'HTTP 503' }, loading, loading)).toBe(true);
    },
    'with the word, the designation still loading: not settled': () => {
      expect(m.homeSettled(word, loading, loading)).toBe(false);
      expect(m.homeSettled(word, loading, chat)).toBe(false);
    },
    'a designated Overlord with its ladder still loading: not settled; answered or failed, settled': () => {
      for (const d of [bound, pending]) {
        expect(m.homeSettled(word, d, loading)).toBe(false);
        expect(m.homeSettled(word, d, chat)).toBe(true);
        expect(m.homeSettled(word, d, { state: 'unmeasured', error: 'timeout' })).toBe(true);
      }
    },
    'no Overlord, or a failed designation read: settled with the ladder still loading': () => {
      expect(m.homeSettled(word, answered(null), loading)).toBe(true);
      expect(m.homeSettled(word, { state: 'unmeasured', error: 'HTTP 503' }, loading)).toBe(true);
      expect(m.homeSettled(word, { state: 'absent' }, loading)).toBe(true);
    },
  };
}

// The read-to-input deciders (review 3319 F3 and A10): a stale caps read keeps its words, and an unread or absent ladder is
// an unmeasured rung, never `off` (which would send the home to the Fleet and hide the brake).
export function capReadCases(m: HomeModule): Record<string, SuiteCase> {
  return {
    'an answer and a stale read are their words; anything else is unmeasured': () => {
      expect(m.capReadOf({ state: 'answered', value: ['overlord-v1'], at: AT })).toEqual({ kind: 'caps', caps: ['overlord-v1'] });
      expect(m.capReadOf({ state: 'stale', value: ['overlord-v1'], at: AT, error: 'x' })).toEqual({ kind: 'caps', caps: ['overlord-v1'] });
      for (const r of [{ state: 'loading' }, { state: 'unmeasured', error: 'x' }, { state: 'absent' }] as const) {
        expect(m.capReadOf(r)).toEqual({ kind: 'unmeasured' });
      }
    },
  };
}
export function rungReadCases(m: HomeModule): Record<string, SuiteCase> {
  return {
    'an answer and a stale read are the rung; loading, a failure and an older server (absent) are unmeasured': () => {
      expect(m.rungReadOf({ state: 'answered', value: { operatorRung: 'off' }, at: AT })).toEqual({ kind: 'rung', rung: 'off' });
      expect(m.rungReadOf({ state: 'stale', value: { operatorRung: 'chat' }, at: AT, error: 'x' })).toEqual({ kind: 'rung', rung: 'chat' });
      for (const r of [{ state: 'loading' }, { state: 'unmeasured', error: 'x' }, { state: 'absent' }] as const) {
        expect(m.rungReadOf(r)).toEqual({ kind: 'unmeasured' });
      }
    },
  };
}
export function placeWordCases(m: HomeModule): Record<string, SuiteCase> {
  return {
    'a read in flight says it is loading, never that it could not be read': () => {
      expect(m.designationWordOf({ state: 'loading' })).toBe(m.DESIGNATION_LOADING_WORD);
      expect(m.designationWordOf({ state: 'loading' })).not.toBe(m.DESIGNATION_WORDS.unmeasured);
    },
    'a failed read could not be read; an answer takes its kind\'s word': () => {
      expect(m.designationWordOf({ state: 'unmeasured', error: 'HTTP 503' })).toBe(m.DESIGNATION_WORDS.unmeasured);
      expect(m.designationWordOf(answered(row({ bound: { sessionId: 'lane-a-overlord', generation: 'g1' } })))).toBe(m.DESIGNATION_WORDS.bound);
      expect(m.designationWordOf({ state: 'absent' })).toBe(m.DESIGNATION_WORDS.none);
    },
  };
}

// The failure contract (ruled F11) and the poll's retry (review 3319 F2), `readOutcome.ts`.
export function nextReadCases(m: ReadOutcomeModule): Record<string, SuiteCase> {
  const prior = { state: 'answered', value: 1, at: AT } as const;
  return {
    'a value is answered; the read\'s own 404 is absent, never unmeasured': () => {
      expect(m.nextReadState({ state: 'loading' }, { kind: 'value', value: 2 }, AT + 1)).toEqual({ state: 'answered', value: 2, at: AT + 1 });
      expect(m.nextReadState(prior, { kind: 'absent' }, AT + 1)).toEqual({ state: 'absent' });
      expect(m.nextReadState({ state: 'loading' }, { kind: 'absent' }, AT + 1)).toEqual({ state: 'absent' });
    },
    'a failure after an answer is stale with its last value; before one, unmeasured': () => {
      expect(m.nextReadState(prior, { kind: 'failed', error: 'timeout' }, AT + 5)).toEqual({ state: 'stale', value: 1, at: AT, error: 'timeout' });
      expect(m.nextReadState({ state: 'stale', value: 1, at: AT, error: 'a' }, { kind: 'failed', error: 'b' }, AT + 5))
        .toEqual({ state: 'stale', value: 1, at: AT, error: 'b' });
      expect(m.nextReadState({ state: 'loading' }, { kind: 'failed', error: 'HTTP 503' }, AT)).toEqual({ state: 'unmeasured', error: 'HTTP 503' });
    },
  };
}
export function readFailedCases(m: ReadOutcomeModule): Record<string, SuiteCase> {
  return {
    'unmeasured and stale are failures the poll reads again': () => {
      expect(m.readFailed({ state: 'unmeasured', error: 'HTTP 503' })).toBe(true);
      expect(m.readFailed({ state: 'stale', value: [], at: AT, error: 'timeout' })).toBe(true);
    },
    'an answer, an absence and a read in flight are not': () => {
      expect(m.readFailed({ state: 'answered', value: [], at: AT })).toBe(false);
      expect(m.readFailed({ state: 'absent' })).toBe(false);
      expect(m.readFailed({ state: 'loading' })).toBe(false);
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
    'six doors at 320 px and seven at 360 and 390, dropped from the end': () => {
      expect(ids(m.phoneDoorsFit(320, eight()))).toEqual(['overlord', ...TODAY.slice(0, -2)]);
      expect(ids(m.phoneDoorsFit(360, eight()))).toEqual(['overlord', ...TODAY.slice(0, -1)]);
      expect(ids(m.phoneDoorsFit(390, eight()))).toEqual(['overlord', ...TODAY.slice(0, -1)]);
    },
    'all eight from 400 px': () => {
      expect(ids(m.phoneDoorsFit(400, eight()))).toEqual(['overlord', ...TODAY]);
      expect(ids(m.phoneDoorsFit(412, eight()))).toEqual(['overlord', ...TODAY]);
    },
    'the Overlord and the Fleet are never dropped': () => {
      expect(ids(m.phoneDoorsFit(132, eight()))).toEqual(['overlord', 'fleet']);
      expect(ids(m.phoneDoorsFit(88, eight()))).toEqual(['overlord', 'fleet']);
      expect(ids(m.phoneDoorsFit(88, m.placesFor(false, S.none!)))).toEqual(['fleet']);
    },
  };
}

const HOUR = 3_600_000;
const waves = { working: 0, waiting: 0, queued: 0 };
const stalled = (slug: string) => ({ slug, title: `Programme ${slug}`, stuck: 1, waves });
const sinceFacts = (over: Partial<SinceFacts> = {}): SinceFacts => ({
  waiting: { state: 'answered', value: { items: [{ state: 'open' }, { state: 'open' }, { state: 'done' }] } },
  programmes: { state: 'answered', value: { closedToday: { operator: 0, sweep: 1, coordinator: 2 }, programmes: [] } }, ...over,
});

export function sinceCases(m: SinceModule): Record<string, SuiteCase> {
  return {
    "Table 4.1b's order: Needs you, then Changed that matters": () => {
      const lines = m.sinceLines(sinceFacts(), AT - HOUR, AT);
      expect(lines.map((l) => [l.key, l.section])).toEqual([['needs-you', 'needs-you'], ['closed', 'changed'], ['stalled', 'changed']]);
      expect(lines.map((l) => l.text)).toEqual(['2 items waiting on you', '3 runs closed since you were last here', 'no programme stalled']);
    },
    'a failed read is unmeasured on every line it feeds, never quiet and never 0': () => {
      const both = m.sinceLines({ waiting: { state: 'failed' }, programmes: { state: 'failed' } }, AT - HOUR, AT);
      expect(both.map((l) => l.text)).toEqual([m.UNMEASURED_TEXT, m.UNMEASURED_TEXT, m.UNMEASURED_TEXT]);
      expect(both.every((l) => !l.measured)).toBe(true);
      const waitingOnly = m.sinceLines(sinceFacts({ waiting: { state: 'failed' } }), AT - HOUR, AT);
      expect(waitingOnly.map((l) => l.text)).toEqual([m.UNMEASURED_TEXT, '3 runs closed since you were last here', 'no programme stalled']);
      const programmesOnly = m.sinceLines(sinceFacts({ programmes: { state: 'failed' } }), AT - HOUR, AT);
      expect(programmesOnly.map((l) => l.text)).toEqual(['2 items waiting on you', m.UNMEASURED_TEXT, m.UNMEASURED_TEXT]);
    },
    'the cap of seven: the sixth line is kept, the rest are counted': () => {
      const many = { closedToday: { operator: 0, sweep: 0, coordinator: 0 }, programmes: Array.from({ length: 9 }, (_, i) => stalled(`prog-${i}`)) };
      const lines = m.sinceLines(sinceFacts({ programmes: { state: 'answered', value: many } }), AT - HOUR, AT);
      expect(m.SINCE_MAX_LINES).toBe(7);
      expect(lines).toHaveLength(7);
      expect(lines.slice(0, 6).map((l) => l.key)).toEqual(['needs-you', 'closed', 'stalled:prog-0', 'stalled:prog-1', 'stalled:prog-2', 'stalled:prog-3']);
      expect(lines[6]).toMatchObject({ key: 'more', text: '5 more not shown' });
    },
    'a device with no stamp, or a stamp from the future, reads the last 24 hours': () => {
      for (const stamp of [null, AT + HOUR]) {
        expect(m.sinceLines(sinceFacts(), stamp, AT)[1]!.text).toBe('3 runs closed in the last 24 hours');
      }
    },
  };
}

const HOME = path.join(ROOT, 'pwa/src/overlord/homePlace.ts');
const READ_OUTCOME = path.join(ROOT, 'pwa/src/overlord/readOutcome.ts');
const PLACES = path.join(ROOT, 'pwa/src/lib/places.ts');
const SINCE = path.join(ROOT, 'pwa/src/overlord/sinceWords.ts');

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
const SETTLED_SET: MutantSet<HomeModule> = {
  modulePath: HOME,
  mutants: [
    { id: 'H9', old: "  if (designation.state === 'loading') return false;\n", new: '' },
    { id: 'H10', old: "return !((d.kind === 'bound' || d.kind === 'pending') && ladder.state === 'loading');", new: 'return true;' },
    { id: 'H11', old: "  if (caps.state === 'loading') return false;\n", new: '' },
  ],
  suite: settledCases,
};
const CAP_READ_SET: MutantSet<HomeModule> = {
  modulePath: HOME,
  mutants: [{
    id: 'H12',
    old: "read.state === 'answered' || read.state === 'stale' ? { kind: 'caps', caps: read.value }",
    new: "read.state === 'answered' ? { kind: 'caps', caps: read.value }",
  }],
  suite: capReadCases,
};
const RUNG_READ_SET: MutantSet<HomeModule> = {
  modulePath: HOME,
  mutants: [{ id: 'H13', old: "rung: read.value.operatorRung } : { kind: 'unmeasured' }", new: "rung: read.value.operatorRung } : { kind: 'rung', rung: 'off' }" }],
  suite: rungReadCases,
};
const PLACE_WORD_SET: MutantSet<HomeModule> = {
  modulePath: HOME,
  mutants: [{ id: 'H14', old: "read.state === 'loading' ? DESIGNATION_LOADING_WORD : ", new: '' }],
  suite: placeWordCases,
};
const NEXT_READ_SET: MutantSet<ReadOutcomeModule> = {
  modulePath: READ_OUTCOME,
  mutants: [
    { id: 'H15', old: "if (outcome.kind === 'absent') return { state: 'absent' };", new: "if (outcome.kind === 'absent') return { state: 'unmeasured', error: 'absent' };" },
    { id: 'H16', old: "if (prev.state === 'answered' || prev.state === 'stale') return", new: 'if (false) return' },
  ],
  suite: nextReadCases,
};
const READ_FAILED_SET: MutantSet<ReadOutcomeModule> = {
  modulePath: READ_OUTCOME,
  mutants: [
    { id: 'H17', old: "return read.state === 'unmeasured' || read.state === 'stale';", new: "return read.state === 'stale';" },
    { id: 'H18', old: "return read.state === 'unmeasured' || read.state === 'stale';", new: "return read.state === 'unmeasured';" },
  ],
  suite: readFailedCases,
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
    { id: 'H7', old: 'Math.floor(widthPx / PHONE_DOOR_FIT_PX)', new: 'Math.ceil(widthPx / PHONE_DOOR_FIT_PX)' },
    { id: 'H8', old: 'if (PHONE_KEEPS.has(kept[i]!.id)) continue;', new: 'if (kept[i]!.id === FLEET_PLACE) continue;' },
  ],
  suite: phoneCases,
};

const SINCE_SET: MutantSet<SinceModule> = {
  modulePath: SINCE,
  mutants: [
    { id: 'S1', old: 'text: UNMEASURED_TEXT', new: "text: 'quiet'" },
    { id: 'S2', old: 'ordered.length <= SINCE_MAX_LINES', new: 'true' },
    { id: 'S3', old: "'needs-you': 1, changed: 2,", new: "'needs-you': 2, changed: 1," },
  ],
  suite: sinceCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const HOME_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'pwa/src/overlord/homePlace.ts#designationStateOf': DESIGNATION_SET as MutantSet<never>,
  'pwa/src/overlord/homePlace.ts#homePlace': HOME_SET as MutantSet<never>,
  'pwa/src/overlord/homePlace.ts#homeSettled': SETTLED_SET as MutantSet<never>,
  'pwa/src/overlord/homePlace.ts#capReadOf': CAP_READ_SET as MutantSet<never>,
  'pwa/src/overlord/homePlace.ts#rungReadOf': RUNG_READ_SET as MutantSet<never>,
  'pwa/src/overlord/homePlace.ts#designationWordOf': PLACE_WORD_SET as MutantSet<never>,
  'pwa/src/overlord/readOutcome.ts#nextReadState': NEXT_READ_SET as MutantSet<never>,
  'pwa/src/overlord/readOutcome.ts#readFailed': READ_FAILED_SET as MutantSet<never>,
  'pwa/src/lib/places.ts#placesFor': PLACES_SET as MutantSet<never>,
  'pwa/src/lib/places.ts#deskPlacesFor': DESK_SET as MutantSet<never>,
  'pwa/src/lib/places.ts#phoneDoorsFit': PHONE_SET as MutantSet<never>,
  'pwa/src/overlord/sinceWords.ts#sinceLines': SINCE_SET as MutantSet<never>,
};
