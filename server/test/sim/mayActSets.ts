// `overlordMayAct`'s oracle and its cases (Overlord W2, the act catalogue B; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` §6, Tasks B2 and B3). The cases are written ONCE here, as
// suite cases over a module: `overlord-may-act.test.ts` runs them against the real decider and the mutation floors run them
// against each textual mutant, so a case reads only what `m` hands it, plus the catalogue as data.
//
// THE ORACLE IS WRITTEN FROM THE RULE LIST, NOT FROM THE DECIDER. It reads the catalogue's rows, `CLASS_COVERS` and
// `effectiveClasses` as data, and its own strength order and rank. It never calls or copies the decider's helpers
// (`coverVerdicts`, `runPath`, `mayActRank`, `grantCovers`); from the decider's file this module takes types only, and
// the functions under test. Every expected value of a named case is written out by hand.
import { expect } from 'vitest';
import {
  CLASS_COVERS, OVERLORD_ACT_KIND_LIST, actRow, effectiveClasses,
  type ActRowLookup, type ClassMember, type CoverKind, type OverlordActKind, type OverlordActRow,
} from '../../../shared/overlord.js';
import { ISOLATION_UNMEASURED, type IsolationRead } from '../../../shared/isolation.js';
import type { CallerStrength } from '../../../shared/overlord-identity.js';
import type { CeilingVerdict } from '../../src/coord/overlordActCeiling.js';
import type { ActTarget, CommandFact, GrantFact, MayActAnswer, MayActFacts } from '../../src/coord/overlordMayAct.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../fakeTime.js';
import type { MutantSet, SuiteCase } from './mutate.js';

export type MayActModule = typeof import('../../src/coord/overlordMayAct.js');

// -------------------------------------------------------------------------------------------------------------- the oracle

/** What the oracle answers: the answer's shape, word, mode and authority (`none` or `kind:id`), the ceiling verdict, the
 *  step that answered, and the evidence path (`null` when the answer is decided before any path is chosen, else `none` or
 *  the candidate's `kind:id` with its cover kind word). */
export interface Expected {
  readonly kind: 'allowed' | 'refused' | 'ceiling';
  readonly word: string;
  readonly mode: string | null;
  readonly authority: string | null;
  readonly verdict: CeilingVerdict | null;
  readonly step: string;
  readonly path: string | null;
}

const STRENGTH_ORDER: readonly CallerStrength[] = ['attributed', 'workload', 'operator'];
const strengthRank = (s: CallerStrength): number => STRENGTH_ORDER.indexOf(s);

const refusalAt = (word: string, step: string, path: string | null): Expected =>
  ({ kind: 'refused', word, mode: null, authority: null, verdict: null, step, path });
/** A refusal decided before any path is chosen, so it names none. */
const refusal = (word: string, step: string): Expected => refusalAt(word, step, null);

/** The rule list's rank: a refusal 0 (`defer` 1); an allow `(staged ? 2 : 3) * 2 + (shadow or proposal ? 0 : 1)`. */
export function rankOfExpected(e: { readonly kind: string; readonly word: string; readonly mode: string | null }): number {
  if (e.kind !== 'allowed') return e.word === 'defer' ? 1 : 0;
  return (e.word === 'staged' ? 2 : 3) * 2 + (e.mode === 'shadow' || e.mode === 'proposal' ? 0 : 1);
}
/** The same rank over a decider answer, written here and not read from the decider. */
export function rankOfAnswer(a: MayActAnswer): number {
  if (a.kind === 'refused') return a.word === 'defer' ? 1 : 0;
  if (a.kind === 'ceiling') return 0;
  return (a.allow.word === 'staged' ? 2 : 3) * 2 + (a.allow.mode === 'shadow' || a.allow.mode === 'proposal' ? 0 : 1);
}

type Verdict = 'covers' | 'no' | 'unmeasured';
type PathKind = 'none' | 'stated-entry' | 'operator-request' | 'command' | 'grant';
interface Candidate { readonly kind: PathKind; readonly id: number | null; readonly v: Verdict; readonly grant: GrantFact | null }

/** The rule list's grant test: any failing check is `no`, else any unread fact is `unmeasured`, else it covers. */
function oracleGrant(g: GrantFact, kind: string, target: ActTarget, f: MayActFacts, now: number): Verdict {
  let no = false;
  let unread = false;
  const gf = f.grantFacts;
  if (g.state !== 'live') no = true;
  if (gf === null) unread = true;
  else if (gf.suspendedNow.includes(g.id)) no = true;
  if (g.effect !== kind) no = true;
  const p = target.programme;
  if (p === null || p.id !== g.scope.programme || p.incarnation !== g.scope.incarnation) no = true;
  if (!(now < g.expiresAt)) no = true;
  for (const c of g.conditions) {
    if (c.kind === 'operator-started-only') {
      if (target.startedBy === 'unmeasured') unread = true;
      else if (target.startedBy !== 'operator') no = true;
    } else if (c.kind === 'max-per-day') {
      const used = gf === null ? 'unmeasured' : gf.usesToday[g.id] ?? 'unmeasured';
      if (used === 'unmeasured') unread = true;
      else if (!(used < c.n)) no = true;
    } else if (c.kind === 'model-class') {
      const mc = gf === null ? 'unmeasured' : gf.modelClass;
      if (mc === 'unmeasured') unread = true;
      else if (mc !== c.modelClass) no = true;
    } else if (c.kind === 'only-when-recommended-by-coordinator') {
      const rec = gf === null ? 'unmeasured' : gf.recommendedByCoordinator;
      if (rec === 'unmeasured') unread = true;
      else if (rec === false) no = true;
    } else {
      // A kind this build does not know (cast in by a test, so the type calls it unreachable): an unread fact, never a pass
      // and never a `no` by itself. The kind is read through a widened type, which `never` would not allow.
      const unknown: { readonly kind: string } = c;
      void unknown.kind;
      unread = true;
    }
  }
  return no ? 'no' : unread ? 'unmeasured' : 'covers';
}

/** One path's answer, steps 4 to 15 of the rule list. */
function oraclePath(c: Candidate, row: OverlordActRow, effRow: OverlordActRow | null, members: readonly ClassMember[], f: MayActFacts): Expected {
  const onGrant = c.kind === 'grant';
  const onCommand = c.kind === 'command';
  // The evidence path this candidate answers on: `none`, or the cover kind word and the id.
  const pathText = c.kind === 'none' ? 'none' : `${c.kind}:${c.id}`;
  const refusal = (word: string, step: string): Expected => refusalAt(word, step, pathText);
  // 4
  let need = strengthRank(row.leastStrength);
  if (effRow !== null) need = Math.max(need, strengthRank(effRow.leastStrength));
  if (c.grant !== null) need = Math.max(need, strengthRank(c.grant.leastStrength));
  if (strengthRank(f.caller) < need) return refusal('identity-too-weak', 'identity');
  // 5
  if (onCommand || onGrant) {
    if (f.isolation.kind === 'unmeasured') return refusal('unmeasured', 'isolation');
    if (f.isolation.word === 'shared-user') return refusal('server-not-isolated', 'isolation');
  }
  // 6
  if (f.cell === 'by-grant' && !onCommand && !onGrant) return refusal('operator-only', 'cell');
  // 6b: an unread arming refuses here, before the blind check could defer (fix after the monotonicity case: a refusal after
  // step 12's defer let a weakening raise the rank)
  if (f.cell === 'armed' && f.armedLive === 'unmeasured') return refusal('unmeasured', 'arming');
  // 15, the mode of every allow below
  const mint = (word: string, step: string, authority: string): Expected => {
    const at = pathText;
    if (f.cell === 'armed') return { kind: 'allowed', word, mode: f.armedLive ? 'live' : 'shadow', authority, verdict: null, step, path: at };
    if (f.cell === 'proposal') return { kind: 'allowed', word: 'staged', mode: 'proposal', authority, verdict: null, step, path: at };
    return { kind: 'allowed', word, mode: 'act', authority, verdict: null, step, path: at };
  };
  // 7
  if (onCommand) return mint('allow', 'command', `command:${c.id}`);
  // 8
  if (!row.answer && c.kind === 'none') return mint('allow', 'not-an-answer', 'none');
  if (!row.answer && c.kind === 'operator-request') return mint('allow', 'not-an-answer', `request:${c.id}`);
  // 9
  const a = f.answer;
  if (row.answer || onGrant) {
    if (a.kind === 'not-an-answer') return refusal(row.answer ? 'unmeasured' : 'evidence-too-weak', 'evidence');
    if (a.evidence === 'unmeasured') return refusal('unmeasured', 'evidence');
    if (a.evidence === 'too-weak') return refusal('evidence-too-weak', 'evidence');
  }
  // 10
  if (row.answer && a.kind === 'answer') {
    if (a.askOrAct === 'unmeasured') return refusal('unmeasured', 'ask-or-act');
    if (a.askOrAct === 'ask') return refusal('ask-is-cheaper', 'ask-or-act');
  }
  // 11
  if (c.kind === 'none') return mint('allow', 'by-cover', 'none');
  if (c.kind === 'stated-entry') return mint('allow', 'by-cover', `entry:${c.id}`);
  if (c.kind === 'operator-request') return mint('allow', 'by-cover', `request:${c.id}`);
  // 12
  // The check goes on only for a passing word; any other value, one outside the declared type included, defers.
  if (a.kind === 'answer') {
    const bc: string = a.blindCheck;
    if (bc !== 'clear-yes' && bc !== 'not-armed') return refusal('defer', 'blind-check');
  }
  // 13, 14
  if (members.some((m) => m.member === 'O3') && f.caller === 'attributed') return mint('staged', 'staging', `grant:${c.id}`);
  return mint('allow-by-grant', 'by-grant', `grant:${c.id}`);
}

/** `overlordMayAct`, written from the rule list. */
export function mayActOracle(act: string, effect: string | null, target: ActTarget, grants: readonly GrantFact[], f: MayActFacts,
  now: number, lookup: ActRowLookup = actRow): Expected {
  // 1
  const row = lookup(act);
  if (row === null) return refusal('operator-only', 'may-carry');
  if (row.mayCarry === 'question-effect') {
    if (effect === null) return refusal('operator-only', 'may-carry');
    const e = lookup(effect);
    if (e === null || e.carrier || e.actor === 'server') return refusal('operator-only', 'may-carry');
  } else if (effect !== null) {
    if (!row.mayCarry.includes(effect) || lookup(effect) === null) return refusal('operator-only', 'may-carry');
  }
  const effRow = effect === null ? null : lookup(effect);
  // 2
  const ec = f.effectCeiling;
  if (ec === 'not-asked') {
    if (effRow !== null && effRow.ceiling.kind === 'counted') {
      return { kind: 'ceiling', word: 'ceiling', mode: null, authority: null, step: 'effect-ceiling', path: null,
        verdict: { pass: false, word: 'unavailable', group: effRow.ceiling.group, why: "the effect's ceiling was not asked", latch: null } };
    }
  } else if (!ec.pass) {
    return { kind: 'ceiling', word: 'ceiling', mode: null, authority: null, verdict: ec, step: 'effect-ceiling', path: null };
  }
  // 3
  const members = effectiveClasses(act, effect, lookup);
  const rowOf = (m: ClassMember): OverlordActRow => (m.from === 'act' ? row : effRow!);
  const barred = (kind: CoverKind): boolean =>
    members.some((m) => !CLASS_COVERS[m.member].includes(kind) || !rowOf(m).covers.includes(kind));
  const kindOf = (m: ClassMember): string => (m.from === 'act' ? act : effect!);
  const cands: Candidate[] = [];
  if (members.length === 0) cands.push({ kind: 'none', id: null, v: 'covers', grant: null });
  else {
    const e = f.statedEntry;
    if (e.kind === 'cited') {
      const holds = e.active && e.stated && e.restsOnOperatorMessage && e.confirmedOrWhole && e.subjectMatches;
      cands.push({ kind: 'stated-entry', id: e.id, v: barred('stated-entry') || !holds ? 'no' : 'covers', grant: null });
    }
    const r = f.request;
    if (r.kind === 'bound') {
      const v: Verdict = barred('operator-request') || r.origin !== 'operator' ? 'no'
        : r.namesTarget === 'unmeasured' ? 'unmeasured' : r.namesTarget ? 'covers' : 'no';
      cands.push({ kind: 'operator-request', id: r.id, v, grant: null });
    }
    const c = f.command;
    if (c !== null) {
      const v: Verdict = barred('command') || !c.live || !c.forThisProposal ? 'no'
        : c.targetsMoved === 'unmeasured' ? 'unmeasured' : c.targetsMoved ? 'no' : 'covers';
      cands.push({ kind: 'command', id: c.id, v, grant: null });
    }
    for (const g of [...grants].sort((x, y) => x.id - y.id)) {
      let v: Verdict = 'covers';
      if (barred('grant')) v = 'no';
      else {
        const vs = members.map((m) => oracleGrant(g, kindOf(m), target, f, now));
        v = vs.includes('no') ? 'no' : vs.includes('unmeasured') ? 'unmeasured' : 'covers';
      }
      cands.push({ kind: 'grant', id: g.id, v, grant: g });
    }
  }
  const unread = cands.some((c) => c.v === 'unmeasured');
  const paths = cands.filter((c) => c.v === 'covers');
  if (paths.length === 0) return unread ? refusal('unmeasured', 'covers') : refusal('operator-only', 'covers');
  // 4 to 15 on each path, and the best answers (R-d)
  let best: Expected | null = null;
  for (const p of paths) {
    const r = oraclePath(p, row, effRow, members, f);
    if (best === null || rankOfExpected(r) > rankOfExpected(best)) best = r;
  }
  // An unread cover turns only a plain refusal into `unmeasured`, never a `defer`, which ranks above it.
  if (best!.kind === 'refused' && best!.word !== 'defer' && unread) return refusal('unmeasured', 'covers');
  return best!;
}

// -------------------------------------------------------------------------------------------------------- comparing answers

function shallowSame(a: object, b: object): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return false;
  return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

const authorityText = (a: { readonly kind: string; readonly id: number | null }): string => (a.kind === 'none' ? 'none' : `${a.kind}:${a.id}`);

/** Where a decider answer departs from the oracle's, or `null` when it does not. Checks the shape, word, mode, authority,
 *  the ceiling verdict, the step, and that the evidence is an object whose step is a string. */
export function diffAnswer(e: Expected, a: MayActAnswer): string | null {
  const step = (a as { evidence?: { step?: unknown } }).evidence?.step;
  if (typeof step !== 'string') return 'the answer carries no evidence step';
  if (a.kind !== e.kind) return `kind ${a.kind}, oracle ${e.kind}`;
  if (a.kind === 'allowed') {
    if (a.allow.word !== e.word) return `word ${a.allow.word}, oracle ${e.word}`;
    if (a.allow.mode !== e.mode) return `mode ${a.allow.mode}, oracle ${e.mode}`;
    if (authorityText(a.allow.authority) !== e.authority) return `authority ${authorityText(a.allow.authority)}, oracle ${e.authority}`;
  } else if (a.kind === 'refused') {
    if (a.word !== e.word) return `word ${a.word}, oracle ${e.word}`;
  } else if (!shallowSame(a.verdict, e.verdict!)) return `verdict ${JSON.stringify(a.verdict)}, oracle ${JSON.stringify(e.verdict)}`;
  if (step !== e.step) return `step ${step}, oracle ${e.step}`;
  // The evidence at value level (review 4213 F5): the path that answered, and a read that says something.
  const { path: p, read } = a.evidence as { readonly path: { readonly cover: string; readonly id?: number } | null; readonly read: unknown };
  const pt = p === null ? null : p.cover === 'none' ? 'none' : `${p.cover}:${p.id}`;
  if (pt !== e.path) return `evidence path ${pt}, oracle ${e.path}`;
  if (typeof read !== 'string' || read.trim() === '') return 'the answer carries an empty evidence read';
  return null;
}

/** An allow binds what the rule list says it binds, and is frozen. */
function diffBound(a: MayActAnswer, act: string, effect: string | null, target: ActTarget, f: MayActFacts): string | null {
  if (a.kind !== 'allowed') return null;
  const x = a.allow;
  if (x.act !== act || x.effect !== effect) return 'the allow does not bind its act and effect';
  const p = target.programme;
  if (x.target.programme !== (p?.id ?? null) || x.target.incarnation !== (p?.incarnation ?? null)) return 'the allow does not bind its target';
  if (x.naturalKey !== f.naturalKey || x.cell !== f.cell || x.generation !== f.generation) return 'the allow does not bind its key, cell and generation';
  if (!Object.isFrozen(x) || !Object.isFrozen(x.authority) || !Object.isFrozen(x.target)) return 'the allow is not frozen';
  return null;
}

// ----------------------------------------------------------------------------------------------------------------- fixtures

const NOW = 1_000_000;
const TARGET: ActTarget = { programme: { id: 3, incarnation: 2 }, startedBy: 'operator' };
const ISO_OK: IsolationRead = { kind: 'measured', word: 'separate-user', cause: 'other-user' };
const ISO_SHARED: IsolationRead = { kind: 'measured', word: 'shared-user', cause: 'same-user' };
const ISO_HOST: IsolationRead = { kind: 'measured', word: 'separate-host', cause: 'other-host' };
const ISO_UNREAD: IsolationRead = { kind: 'unmeasured', why: 'link-down' };

const facts = (o: Partial<MayActFacts> = {}): MayActFacts => ({
  caller: 'operator', isolation: ISO_OK, command: null, request: { kind: 'none' }, statedEntry: { kind: 'none' },
  answer: { kind: 'not-an-answer' }, grantFacts: null, effectCeiling: { pass: true }, cell: 'allow', armedLive: true,
  naturalKey: 'nk-1', generation: 5, ...o,
});
const REQ: Extract<MayActFacts['request'], { kind: 'bound' }> = { kind: 'bound', id: 11, origin: 'operator', namesTarget: true };
const ANS: Extract<MayActFacts['answer'], { kind: 'answer' }> = { kind: 'answer', evidence: 'enough', askOrAct: 'act', blindCheck: 'clear-yes' };
const ENTRY: Extract<MayActFacts['statedEntry'], { kind: 'cited' }> = { kind: 'cited', id: 12, active: true, stated: true, restsOnOperatorMessage: true, confirmedOrWhole: true, subjectMatches: true };
const CMD: CommandFact = { id: 31, live: true, forThisProposal: true, targetsMoved: false };
const GF: NonNullable<MayActFacts['grantFacts']> = { modelClass: 'class-a', usesToday: {}, recommendedByCoordinator: true, suspendedNow: [] };
const grant = (effect: string, o: Partial<GrantFact> = {}): GrantFact => ({
  id: 21, effect, scope: { programme: 3, incarnation: 2 }, state: 'live', expiresAt: NOW + 1000, leastStrength: 'attributed', conditions: [], ...o,
});

/** A synthetic row, as the house pattern writes one: class none, no answer, carrying nothing, the Overlord's. */
const syn = (over: Partial<OverlordActRow>): OverlordActRow => ({
  what: 'synthetic', actor: 'overlord', classes: [], answer: false, carrier: false, mayCarry: [], reversibility: 'reversible',
  covers: [], verbClass: 'operate', compensator: null, ceiling: { kind: 'never' }, leastStrength: 'attributed',
  rungs: { chat: 'allow', advise: 'allow', full: 'allow' }, ...over,
});
const ALL_COVERS: readonly CoverKind[] = ['grant', 'command', 'operator-request', 'stated-entry'];
const SYN: Readonly<Record<string, OverlordActRow>> = {
  'syn-plain': syn({}),
  'syn-plain-weak': syn({ leastStrength: 'attributed' }),
  'syn-plain-workload': syn({ leastStrength: 'workload' }),
  'syn-plain-operator': syn({ leastStrength: 'operator' }),
  'syn-plain-counted': syn({ ceiling: { kind: 'counted', group: 'relay' } }),
  'syn-o3': syn({ classes: ['O3'], covers: ALL_COVERS, leastStrength: 'workload', ceiling: { kind: 'counted', group: 'o3-effect' },
    mayCarry: ['syn-o3b', 'syn-plain', 'syn-plain-operator', 'syn-plain-counted', 'syn-o5'] }),
  'syn-o3b': syn({ classes: ['O3'], covers: ['grant', 'command', 'operator-request'], ceiling: { kind: 'counted', group: 'o3-effect' } }),
  'syn-o5': syn({ classes: ['O5'], covers: ALL_COVERS, answer: true }),
  'syn-o35': syn({ classes: ['O3', 'O5'], covers: ALL_COVERS }),
  'syn-ans-none': syn({ answer: true }),
  'syn-ans-o3': syn({ answer: true, classes: ['O3'], covers: ALL_COVERS }),
  'syn-carrier': syn({ carrier: true, answer: true, classes: ['O6'], mayCarry: 'question-effect', covers: ALL_COVERS }),
  'syn-server': syn({ actor: 'server' }),
  'syn-unknown-class': syn({ classes: ['unknown' as never], covers: ALL_COVERS }),
  'syn-list-act': syn({ mayCarry: ['syn-plain', 'syn-o3b', 'widen-scope', 'no-such-kind', 'syn-server'] }),
};
const lookupSyn: ActRowLookup = (k) => (Object.prototype.hasOwnProperty.call(SYN, k) ? SYN[k]! : actRow(k));

const ALL_KINDS: readonly string[] = OVERLORD_ACT_KIND_LIST;

// ---------------------------------------------------------------------------------------- (a) exhaustive over the catalogue

interface Call { readonly act: string; readonly effect: string | null; readonly target: ActTarget; readonly grants: readonly GrantFact[];
  readonly facts: MayActFacts; readonly now: number; readonly lookup: ActRowLookup | undefined }

const run = (m: MayActModule, c: Call): MayActAnswer =>
  m.overlordMayAct(c.act as OverlordActKind, c.effect, c.target, c.grants, c.facts, c.now, c.lookup);

const FACT_SETS: readonly (readonly [string, Partial<MayActFacts>])[] = [
  ['no covers', {}],
  ['a bound operator request naming the target', { request: REQ }],
  ['a bound request naming the target as unmeasured', { request: { ...REQ, namesTarget: 'unmeasured' } }],
  ['an entry that holds', { statedEntry: ENTRY }],
  ['answer facts: enough, act, clear-yes', { answer: ANS }],
  ['an entry that holds and answer facts', { statedEntry: ENTRY, answer: ANS }],
  ['a request and answer facts', { request: REQ, answer: ANS }],
  ['a request and answer facts, caller attributed', { request: REQ, answer: ANS, caller: 'attributed' }],
  ['an entry and answer facts, caller attributed', { statedEntry: ENTRY, answer: ANS, caller: 'attributed' }],
  ['a request, answer facts, the ceiling not asked, armed unmeasured', { request: REQ, answer: ANS, effectCeiling: 'not-asked', armedLive: 'unmeasured' }],
  ['isolation separate-user with a request and answer facts', { request: REQ, answer: ANS, isolation: ISO_OK }],
];
const CELLS = ['allow', 'proposal', 'armed', 'by-grant'] as const;

function exhaustiveCase(m: MayActModule): void {
  const effects: (string | null)[] = [null, ...ALL_KINDS, 'no-such-kind'];
  const bad: string[] = [];
  let n = 0;
  for (const act of ALL_KINDS) {
    for (const effect of effects) {
      for (const cell of CELLS) {
        for (const [label, over] of FACT_SETS) {
          const c: Call = { act, effect, target: TARGET, grants: [], facts: facts({ ...over, cell }), now: NOW, lookup: undefined };
          const a = run(m, c);
          const d = diffAnswer(mayActOracle(act, effect, TARGET, [], c.facts, NOW), a) ?? diffBound(a, act, effect, TARGET, c.facts);
          n++;
          if (d !== null && bad.length < 8) bad.push(`${act} / ${effect} / ${cell} / ${label}: ${d}`);
        }
      }
    }
  }
  expect(n).toBe(ALL_KINDS.length * effects.length * CELLS.length * FACT_SETS.length);
  expect(bad).toEqual([]);
}

// ------------------------------------------------------------------------------------------------ (b) the drawn domain

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const chance = (r: () => number, p: number): boolean => r() < p;

const SYN_KEYS = Object.keys(SYN);
const ALL_ACTS: readonly string[] = [...ALL_KINDS, ...SYN_KEYS];
const INTERESTING: readonly string[] = ['approve-spec', 'approve-dod', 'widen-scope', 'start-programme', 'state-a-fact', 'relay', 'answer-item',
  'answer-ask', 'link-team', 'rekick-coordinator', 'syn-o3', 'syn-o3b', 'syn-o5', 'syn-ans-o3', 'syn-carrier', 'syn-list-act', 'syn-o35', 'syn-ans-none'];
const CARRIABLE: readonly string[] = ALL_ACTS.filter((k) => { const r = lookupSyn(k)!; return !r.carrier && r.actor !== 'server'; });
const EFFECT_POOL: readonly string[] = [...ALL_ACTS, 'no-such-kind'];
const STRENGTHS: readonly CallerStrength[] = ['attributed', 'workload', 'operator'];
const ISOLATIONS: readonly IsolationRead[] = [ISO_OK, ISO_SHARED, ISO_HOST, ISO_UNREAD, { kind: 'unmeasured', why: 'no-agent' }];

function drawCeiling(r: () => number): MayActFacts['effectCeiling'] {
  const u = r();
  if (u < 0.2) return 'not-asked';
  if (u < 0.75) return { pass: true };
  if (u < 0.88) return { pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'all', limit: 3, latch: 'act-ceiling-hit' };
  return { pass: false, word: 'unavailable', group: 'relay', why: 'a count was not read', latch: null };
}

/** A draw leaning on the grant path: an O3 act or effect, a grant that mostly covers it, and facts that mostly let it through,
 *  each of which can still fail. The generic draw alone reaches the grant arms too rarely to say they were tested. */
function drawGrantCall(r: () => number): Call {
  const [act, effect] = pick<readonly [string, string | null]>(r, [['approve-spec', null], ['approve-dod', null], ['widen-scope', null], ['syn-o3', null],
    ['answer-item', 'widen-scope'], ['answer-ask', 'widen-scope'], ['relay', 'widen-scope'], ['syn-ans-o3', null]]);
  const kind = effect ?? act;
  const programme = { id: 3, incarnation: 2 };
  const target: ActTarget = { programme, startedBy: chance(r, 0.85) ? 'operator' : pick(r, ['overlord', 'unmeasured'] as const) };
  const now = NOW;
  const ids = [21, 22, 5].sort(() => r() - 0.5).slice(0, pick(r, [1, 1, 2]));
  const usesToday: Record<number, number | 'unmeasured'> = {};
  const grants: GrantFact[] = ids.map((id) => {
    usesToday[id] = pick(r, [0, 1, 2, 'unmeasured']);
    return {
      id, effect: chance(r, 0.92) ? kind : 'approve-dod',
      scope: chance(r, 0.92) ? { programme: 3, incarnation: 2 } : { programme: 3, incarnation: 1 },
      state: chance(r, 0.92) ? 'live' : 'suspended', expiresAt: NOW + pick(r, [1, 5, 1000, 1000, 1000, 0]), leastStrength: pick(r, STRENGTHS),
      conditions: [
        ...(chance(r, 0.2) ? [{ kind: 'operator-started-only' as const }] : []), ...(chance(r, 0.2) ? [{ kind: 'max-per-day' as const, n: 2 }] : []),
        ...(chance(r, 0.2) ? [{ kind: 'model-class' as const, modelClass: 'class-a' }] : []),
        ...(chance(r, 0.2) ? [{ kind: 'only-when-recommended-by-coordinator' as const }] : []),
      ],
    };
  });
  const f: MayActFacts = {
    caller: pick(r, STRENGTHS), isolation: pick(r, [ISO_OK, ISO_OK, ISO_HOST, ISO_SHARED, ISO_UNREAD]),
    command: chance(r, 0.15) ? { id: 31, live: true, forThisProposal: true, targetsMoved: pick(r, [false, true, 'unmeasured']) } : null,
    request: chance(r, 0.2) ? { kind: 'bound', id: 11, origin: 'operator', namesTarget: pick(r, [true, true, false, 'unmeasured']) } : { kind: 'none' },
    statedEntry: { kind: 'none' },
    answer: chance(r, 0.07) ? { kind: 'not-an-answer' } : { kind: 'answer', evidence: pick(r, ['enough', 'enough', 'enough', 'enough', 'too-weak', 'unmeasured']),
      askOrAct: pick(r, ['act', 'act', 'act', 'act', 'ask', 'unmeasured']), blindCheck: pick(r, ['clear-yes', 'clear-yes', 'not-armed', 'not-clear', 'shadow']) },
    grantFacts: chance(r, 0.05) ? null : { modelClass: pick(r, ['class-a', 'class-a', 'class-a', 'class-b', 'unmeasured']), usesToday,
      recommendedByCoordinator: pick(r, [true, true, true, false, 'unmeasured']), suspendedNow: chance(r, 0.05) ? [ids[0]!] : [] },
    effectCeiling: chance(r, 0.9) ? { pass: true } : drawCeiling(r), cell: pick(r, ['allow', 'armed', 'armed', 'proposal', 'by-grant'] as const),
    armedLive: pick(r, [true, true, true, false, 'unmeasured']),
    naturalKey: `nk-${Math.floor(r() * 1000)}`, generation: Math.floor(r() * 50),
  };
  return { act, effect, target, grants, facts: f, now, lookup: lookupSyn };
}

function drawCall(r: () => number): Call {
  if (chance(r, 0.4)) return drawGrantCall(r);
  const act =chance(r, 0.4) ? pick(r, INTERESTING) : chance(r, 0.04) ? 'no-such-kind' : pick(r, ALL_ACTS);
  const row = lookupSyn(act);
  let effect: string | null = null;
  const u = r();
  if (row === null) { if (u >= 0.5) effect = pick(r, EFFECT_POOL); }
  else if (row.mayCarry === 'question-effect') effect = u < 0.1 ? null : u < 0.9 ? pick(r, CARRIABLE) : pick(r, EFFECT_POOL);
  else if (row.mayCarry.length > 0) { if (u >= 0.2) effect = u < 0.9 ? pick(r, row.mayCarry) : pick(r, EFFECT_POOL); }
  else if (u >= 0.9) effect = pick(r, EFFECT_POOL);
  const involvesSyn = act.startsWith('syn-') || (effect !== null && effect.startsWith('syn-'));
  const lookup = involvesSyn || chance(r, 0.5) ? lookupSyn : undefined;

  const programme = chance(r, 0.1) ? null : { id: pick(r, [3, 4]), incarnation: pick(r, [1, 2]) };
  const startedBy = programme === null && chance(r, 0.85) ? null : pick(r, ['operator', 'operator', 'overlord', 'unmeasured'] as const);
  const target: ActTarget = { programme, startedBy };

  const now = NOW + pick(r, [-1, 0, 1]);
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => r() - 0.5).slice(0, pick(r, [0, 0, 1, 1, 1, 2]));
  const kinds = [act, effect ?? act, 'widen-scope', 'approve-spec', 'syn-o3', 'syn-o3b'];
  const grants: GrantFact[] = ids.map((id) => ({
    id,
    effect: chance(r, 0.85) ? pick(r, kinds) : 'other-kind',
    scope: programme !== null && chance(r, 0.8) ? { programme: programme.id, incarnation: programme.incarnation } : { programme: pick(r, [3, 4, 5]), incarnation: pick(r, [1, 2, 3]) },
    state: chance(r, 0.8) ? 'live' : pick(r, ['shadow', 'suspended', 'revoked', 'expired'] as const),
    expiresAt: NOW + pick(r, [-1, 0, 1, 5, 1000]),
    leastStrength: pick(r, STRENGTHS),
    conditions: Array.from({ length: pick(r, [0, 0, 1, 1, 2, 3]) }, () => {
      const k = pick(r, ['operator-started-only', 'max-per-day', 'model-class', 'only-when-recommended-by-coordinator'] as const);
      if (k === 'max-per-day') return { kind: k, n: pick(r, [1, 2, 3]) };
      if (k === 'model-class') return { kind: k, modelClass: pick(r, ['class-a', 'class-b']) };
      return { kind: k };
    }),
  }));

  const usesToday: Record<number, number | 'unmeasured'> = {};
  for (const g of grants) if (chance(r, 0.8)) usesToday[g.id] = chance(r, 0.15) ? 'unmeasured' : pick(r, [0, 1, 2, 3, 4]);
  const grantFacts: MayActFacts['grantFacts'] = chance(r, 0.1) ? null : {
    modelClass: pick(r, ['class-a', 'class-a', 'class-b', 'unmeasured']), usesToday,
    recommendedByCoordinator: pick(r, [true, true, false, 'unmeasured']), suspendedNow: grants.filter(() => chance(r, 0.1)).map((g) => g.id),
  };

  const f: MayActFacts = {
    caller: pick(r, STRENGTHS), isolation: pick(r, ISOLATIONS),
    command: chance(r, 0.35) ? { id: 31, live: chance(r, 0.85), forThisProposal: chance(r, 0.85), targetsMoved: pick(r, [false, false, true, 'unmeasured']) } : null,
    request: chance(r, 0.45) ? { kind: 'bound', id: 11, origin: chance(r, 0.85) ? 'operator' : 'overlord', namesTarget: pick(r, [true, true, true, false, 'unmeasured']) } : { kind: 'none' },
    statedEntry: chance(r, 0.35) ? { kind: 'cited', id: 12, active: chance(r, 0.9), stated: chance(r, 0.9), restsOnOperatorMessage: chance(r, 0.9),
      confirmedOrWhole: chance(r, 0.9), subjectMatches: chance(r, 0.9) } : { kind: 'none' },
    answer: chance(r, 0.15) ? { kind: 'not-an-answer' } : { kind: 'answer', evidence: pick(r, ['enough', 'enough', 'enough', 'too-weak', 'unmeasured']),
      askOrAct: pick(r, ['act', 'act', 'act', 'ask', 'unmeasured']), blindCheck: pick(r, ['not-armed', 'clear-yes', 'clear-yes', 'not-clear', 'shadow']) },
    grantFacts, effectCeiling: drawCeiling(r), cell: pick(r, CELLS), armedLive: pick(r, [true, true, false, 'unmeasured']),
    naturalKey: `nk-${Math.floor(r() * 1000)}`, generation: Math.floor(r() * 50),
  };
  return { act, effect, target, grants, facts: f, now, lookup };
}

let drawn: readonly Call[] | null = null;
/** The 2000 drawn calls, from one fixed seed: the same in every run, and drawn once per process. */
function drawnCalls(): readonly Call[] {
  if (drawn === null) { const r = mulberry32(0x0A11C47); drawn = Array.from({ length: 2000 }, () => drawCall(r)); }
  return drawn;
}

const oracleOf = (c: Call): Expected => mayActOracle(c.act, c.effect, c.target, c.grants, c.facts, c.now, c.lookup ?? actRow);

function drawnCase(m: MayActModule): void {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const c of drawnCalls()) {
    const e = oracleOf(c);
    const a = run(m, c);
    seen.add(`${e.kind}:${e.word}:${e.mode}:${e.authority?.split(':')[0] ?? ''}`);
    const d = diffAnswer(e, a) ?? diffBound(a, c.act, c.effect, c.target, c.facts);
    if (d !== null && bad.length < 8) bad.push(`${JSON.stringify({ act: c.act, effect: c.effect, target: c.target, grants: c.grants, facts: c.facts, now: c.now })} => ${d}`);
  }
  expect(bad).toEqual([]);
  // The draw reaches every word, mode and authority the oracle can name (a draw that misses an arm tests nothing there).
  const want = [
    'allowed:allow:act:none', 'allowed:allow:act:request', 'allowed:allow:act:entry', 'allowed:allow:act:command', 'allowed:allow-by-grant:act:grant',
    'allowed:staged:act:grant', 'allowed:staged:proposal:none', 'allowed:staged:proposal:request', 'allowed:allow:live:none', 'allowed:allow:shadow:none',
    'allowed:allow-by-grant:live:grant', 'allowed:allow-by-grant:shadow:grant', 'allowed:staged:live:grant', 'allowed:staged:shadow:grant',
    'refused:defer:null:', 'refused:ask-is-cheaper:null:', 'refused:evidence-too-weak:null:', 'refused:identity-too-weak:null:',
    'refused:server-not-isolated:null:', 'refused:operator-only:null:', 'refused:unmeasured:null:', 'ceiling:ceiling:null:',
  ];
  expect(want.filter((w) => !seen.has(w))).toEqual([]);
}

// -------------------------------------------------------------------------------------------------------- (c) monotonicity

interface Weakening { readonly name: string; readonly make: (c: Call) => readonly Call[] }
const withFacts = (c: Call, o: Partial<MayActFacts>): Call => ({ ...c, facts: { ...c.facts, ...o } });
const ARMED_UNREAD = 'unmeasured' as const;

const WEAKENINGS: readonly Weakening[] = [
  { name: 'a lower caller', make: (c) => STRENGTHS.filter((s) => strengthRank(s) < strengthRank(c.facts.caller)).map((s) => withFacts(c, { caller: s })) },
  { name: 'isolation shared-user', make: (c) => (c.facts.isolation.kind === 'measured' && c.facts.isolation.word === 'shared-user' ? [] : [withFacts(c, { isolation: ISO_SHARED })]) },
  { name: 'isolation unmeasured', make: (c) => (c.facts.isolation.kind === 'unmeasured' ? [] : [withFacts(c, { isolation: ISO_UNREAD })]) },
  { name: 'a grant removed', make: (c) => c.grants.map((_g, i) => ({ ...c, grants: c.grants.filter((_x, j) => j !== i) })) },
  { name: 'now at a grant\'s expiry', make: (c) => c.grants.filter((g) => c.now < g.expiresAt).map((g) => ({ ...c, now: g.expiresAt })) },
  { name: 'now later', make: (c) => [{ ...c, now: c.now + 1 }, { ...c, now: c.now + 100_000 }] },
  { name: 'a grant off live', make: (c) => c.grants.filter((g) => g.state === 'live').map((g) => ({ ...c, grants: c.grants.map((x) => (x === g ? { ...x, state: 'suspended' as const } : x)) })) },
  { name: 'the command removed', make: (c) => (c.facts.command === null ? [] : [withFacts(c, { command: null })]) },
  { name: 'the request removed', make: (c) => (c.facts.request.kind === 'none' ? [] : [withFacts(c, { request: { kind: 'none' } })]) },
  { name: 'the entry removed', make: (c) => (c.facts.statedEntry.kind === 'none' ? [] : [withFacts(c, { statedEntry: { kind: 'none' } })]) },
  { name: 'evidence enough to too-weak', make: (c) => (c.facts.answer.kind === 'answer' && c.facts.answer.evidence === 'enough' ? [withFacts(c, { answer: { ...c.facts.answer, evidence: 'too-weak' } })] : []) },
  { name: 'evidence to unmeasured', make: (c) => (c.facts.answer.kind === 'answer' && c.facts.answer.evidence !== 'unmeasured' ? [withFacts(c, { answer: { ...c.facts.answer, evidence: 'unmeasured' } })] : []) },
  { name: 'askOrAct act to ask', make: (c) => (c.facts.answer.kind === 'answer' && c.facts.answer.askOrAct === 'act' ? [withFacts(c, { answer: { ...c.facts.answer, askOrAct: 'ask' } })] : []) },
  { name: 'askOrAct to unmeasured', make: (c) => (c.facts.answer.kind === 'answer' && c.facts.answer.askOrAct !== 'unmeasured' ? [withFacts(c, { answer: { ...c.facts.answer, askOrAct: 'unmeasured' } })] : []) },
  { name: 'blindCheck to not-clear', make: (c) => (c.facts.answer.kind === 'answer' && (c.facts.answer.blindCheck === 'clear-yes' || c.facts.answer.blindCheck === 'not-armed')
    ? [withFacts(c, { answer: { ...c.facts.answer, blindCheck: 'not-clear' } })] : []) },
  { name: 'the ceiling verdict to a refusal', make: (c) => (c.facts.effectCeiling !== 'not-asked' && !c.facts.effectCeiling.pass ? []
    : [withFacts(c, { effectCeiling: { pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'all', limit: 3, latch: 'act-ceiling-hit' } }),
      withFacts(c, { effectCeiling: { pass: false, word: 'unavailable', group: 'relay', why: 'unread', latch: null } })]) },
  { name: 'armedLive true to false or unmeasured', make: (c) => (c.facts.armedLive === true ? [withFacts(c, { armedLive: false }), withFacts(c, { armedLive: ARMED_UNREAD })] : []) },
  { name: 'armedLive false to unmeasured', make: (c) => (c.facts.armedLive === false ? [withFacts(c, { armedLive: ARMED_UNREAD })] : []) },
  { name: 'namesTarget to unmeasured', make: (c) => (c.facts.request.kind === 'bound' && c.facts.request.namesTarget !== 'unmeasured'
    ? [withFacts(c, { request: { ...c.facts.request, namesTarget: 'unmeasured' } })] : []) },
  { name: 'targetsMoved to unmeasured', make: (c) => (c.facts.command !== null && c.facts.command.targetsMoved !== 'unmeasured'
    ? [withFacts(c, { command: { ...c.facts.command, targetsMoved: 'unmeasured' } })] : []) },
  { name: 'the grant facts unread', make: (c) => {
    const gf = c.facts.grantFacts;
    if (gf === null) return [];
    return [withFacts(c, { grantFacts: null }), withFacts(c, { grantFacts: { ...gf, modelClass: 'unmeasured' } }),
      withFacts(c, { grantFacts: { ...gf, recommendedByCoordinator: 'unmeasured' } }),
      withFacts(c, { grantFacts: { ...gf, usesToday: Object.fromEntries(Object.keys(gf.usesToday).map((k) => [k, 'unmeasured' as const])) } })];
  } },
];

/** `flatRefusals`: every refusal ranks 0, `defer` included, so only the allows' ranks are compared. Unflattened, `defer` ranks 1
 *  above the other refusals, as Table 11.7b orders them. That case was red on the first decider: an unread cover turned a `defer`
 *  into `unmeasured`, and an unread arming refused after the blind check, so a removal or a weakening uncovered a `defer`. The
 *  decider then spared a `defer` from the unread rule and read the arming at step 7 (slug
 *  `the-arming-is-read-before-the-blind-check`), and the oracle with it; both cases hold now. */
function monotoneCase(m: MayActModule, flatRefusals: boolean): void {
  const bad: string[] = [];
  let applied = 0;
  let lowered = 0;
  const lowered_by = new Set<string>();
  const raisedBy = new Map<string, number>();
  const rk = (a: MayActAnswer): number => (flatRefusals && a.kind !== 'allowed' ? 0 : rankOfAnswer(a));
  for (const c of drawnCalls()) {
    const base = rk(run(m, c));
    for (const w of WEAKENINGS) {
      for (const c2 of w.make(c)) {
        const r2 = rk(run(m, c2));
        applied++;
        if (r2 < base) { lowered++; lowered_by.add(w.name); }
        if (r2 > base) {
          raisedBy.set(w.name, (raisedBy.get(w.name) ?? 0) + 1);
          // Whether the oracle (the rule list) raises it too: then the rules, not the decider, are not monotone there.
          const o1 = rankOfExpected(oracleOf(c));
          const o2 = rankOfExpected(oracleOf(c2));
          if (bad.length < 6) bad.push(`${w.name} raised ${base} to ${r2} (oracle ${o1} to ${o2}): ${JSON.stringify({ act: c.act, effect: c.effect, grants: c.grants, facts: c.facts, now: c.now })}`);
        }
      }
    }
  }
  expect(bad).toEqual([]);
  expect([...raisedBy.entries()], `weakenings that raised a rank, with counts`).toEqual([]);
  // The weakenings are not vacuous: each one applied, and each one lowered a rank somewhere in the draw.
  expect(applied).toBeGreaterThan(5000);
  expect(lowered).toBeGreaterThan(500);
  expect(WEAKENINGS.map((w) => w.name).filter((n) => !lowered_by.has(n))).toEqual([]);
}

// ------------------------------------------------------------------------------------------------------------ (d) named cases

const go = (m: MayActModule, act: string, effect: string | null, f: Partial<MayActFacts> = {}, grants: readonly GrantFact[] = [],
  x: { target?: ActTarget; now?: number; lookup?: ActRowLookup } = {}): MayActAnswer =>
  m.overlordMayAct(act as OverlordActKind, effect, x.target ?? TARGET, grants, facts(f), x.now ?? NOW, x.lookup);

function isRefused(a: MayActAnswer, word: string, step?: string): void {
  expect(a.kind).toBe('refused');
  if (a.kind === 'refused') expect(a.word).toBe(word);
  if (step !== undefined) expect(a.evidence.step).toBe(step);
}
function isAllowed(a: MayActAnswer, word: string, mode: string, authority: string, step?: string): void {
  expect(a.kind).toBe('allowed');
  if (a.kind === 'allowed') {
    expect(a.allow.word).toBe(word);
    expect(a.allow.mode).toBe(mode);
    expect(authorityText(a.allow.authority)).toBe(authority);
  }
  if (step !== undefined) expect(a.evidence.step).toBe(step);
}

/** approve-spec under a grant: the base of the grant-path cases. */
const GRANT_FACTS: Partial<MayActFacts> = { answer: ANS, grantFacts: GF };

function namedCases(m: MayActModule): Record<string, SuiteCase> {
  return {
    // ---- step 1
    'a carrier with no effect is operator-only': () => isRefused(go(m, 'answer-item', null, { answer: ANS }), 'operator-only', 'may-carry'),
    'a carrier carrying a carrier is operator-only': () => isRefused(go(m, 'answer-item', 'answer-ask', { answer: ANS }), 'operator-only', 'may-carry'),
    "a carrier carrying the server's own act (renew) is operator-only": () => isRefused(go(m, 'answer-item', 'renew', { answer: ANS }), 'operator-only', 'may-carry'),
    'a carrier carrying an unknown string is operator-only': () => isRefused(go(m, 'answer-ask', 'no-such-kind', { answer: ANS }), 'operator-only', 'may-carry'),
    'an act the catalogue lacks is operator-only': () => isRefused(go(m, 'no-such-kind', null), 'operator-only', 'may-carry'),
    'relay carrying start-programme, read or an unknown string is operator-only': () => {
      for (const e of ['start-programme', 'read', 'no-such-kind']) isRefused(go(m, 'relay', e, { request: REQ }), 'operator-only', 'may-carry');
    },
    'a listed effect the lookup lacks is operator-only': () => isRefused(go(m, 'syn-list-act', 'no-such-kind', {}, [], { lookup: lookupSyn }), 'operator-only', 'may-carry'),
    // ---- the request cover
    'relay carrying widen-scope with an operator request naming the target is allowed, authority request': () => {
      isAllowed(go(m, 'relay', 'widen-scope', { request: REQ, caller: 'attributed' }), 'allow', 'act', 'request:11', 'not-an-answer');
    },
    'the same request from the overlord, naming no target or absent is operator-only': () => {
      isRefused(go(m, 'relay', 'widen-scope', { request: { ...REQ, origin: 'overlord' } }), 'operator-only', 'covers');
      isRefused(go(m, 'relay', 'widen-scope', { request: { ...REQ, namesTarget: false } }), 'operator-only', 'covers');
      isRefused(go(m, 'relay', 'widen-scope'), 'operator-only', 'covers');
    },
    'a request whose naming of the target is unmeasured answers unmeasured': () => {
      isRefused(go(m, 'relay', 'widen-scope', { request: { ...REQ, namesTarget: 'unmeasured' } }), 'unmeasured', 'covers');
    },
    'answer-item carrying secret-or-access, deploy, message-people or state-a-fact with a request is operator-only': () => {
      for (const e of ['secret-or-access', 'deploy', 'message-people', 'state-a-fact']) isRefused(go(m, 'answer-item', e, { request: REQ, answer: ANS }), 'operator-only', 'covers');
    },
    'a request never covers an O5 member and an entry never covers an O3 member (Table 4b)': () => {
      isRefused(go(m, 'state-a-fact', null, { request: REQ, answer: ANS }), 'operator-only', 'covers');
      isRefused(go(m, 'widen-scope', null, { statedEntry: ENTRY, answer: ANS }), 'operator-only', 'covers');
      expect(Object.entries(CLASS_COVERS).filter(([, v]) => v.includes('stated-entry') && v.includes('operator-request'))).toEqual([]);
    },
    'a class the build does not know is covered by nothing': () => {
      isRefused(go(m, 'syn-unknown-class', null, { request: REQ, statedEntry: ENTRY, command: CMD, answer: ANS }, [], { lookup: lookupSyn }), 'operator-only', 'covers');
    },
    'a class O3 act carrying a class O3 effect needs a cover for both members: a grant for one kind covers neither pair': () => {
      const g = grant('syn-o3');
      isRefused(go(m, 'syn-o3', 'syn-o3b', { ...GRANT_FACTS }, [g], { lookup: lookupSyn }), 'operator-only', 'covers');
      isAllowed(go(m, 'syn-o3', 'syn-o3b', { request: REQ }, [], { lookup: lookupSyn }), 'allow', 'act', 'request:11', 'not-an-answer');
    },
    // ---- answers over class none
    'answer-item carrying a class-none effect with not-an-answer under cell armed is unmeasured': () => {
      isRefused(go(m, 'answer-item', 'close-request', { cell: 'armed' }), 'unmeasured', 'evidence');
    },
    'answer-item carrying close-request: evidence and askOrAct decide': () => {
      isAllowed(go(m, 'answer-item', 'close-request', { answer: ANS, cell: 'armed', armedLive: true }), 'allow', 'live', 'none', 'by-cover');
      isRefused(go(m, 'answer-item', 'close-request', { answer: { ...ANS, evidence: 'too-weak' } }), 'evidence-too-weak', 'evidence');
      isRefused(go(m, 'answer-item', 'close-request', { answer: { ...ANS, evidence: 'unmeasured' } }), 'unmeasured', 'evidence');
      isRefused(go(m, 'answer-item', 'close-request', { answer: { ...ANS, askOrAct: 'ask' } }), 'ask-is-cheaper', 'ask-or-act');
      isRefused(go(m, 'answer-item', 'close-request', { answer: { ...ANS, askOrAct: 'unmeasured' } }), 'unmeasured', 'ask-or-act');
    },
    'state-a-fact with a holding entry, evidence enough and act is allowed, authority entry': () => {
      isAllowed(go(m, 'state-a-fact', null, { statedEntry: ENTRY, answer: ANS }), 'allow', 'act', 'entry:12', 'by-cover');
    },
    'state-a-fact with each entry condition false is operator-only': () => {
      for (const k of ['active', 'stated', 'restsOnOperatorMessage', 'confirmedOrWhole', 'subjectMatches'] as const) {
        isRefused(go(m, 'state-a-fact', null, { statedEntry: { ...ENTRY, [k]: false }, answer: ANS }), 'operator-only', 'covers');
      }
      isRefused(go(m, 'state-a-fact', null, { answer: ANS }), 'operator-only', 'covers');
    },
    'state-a-fact with an entry that holds but no answer facts is unmeasured, and a weak entry beside holding evidence stays operator-only': () => {
      isRefused(go(m, 'state-a-fact', null, { statedEntry: ENTRY }), 'unmeasured', 'evidence');
    },
    // ---- the effect ceiling
    'a counted effect with the ceiling not asked answers the kind ceiling, word unavailable': () => {
      const a = go(m, 'relay', 'widen-scope', { request: REQ, effectCeiling: 'not-asked' });
      expect(a.kind).toBe('ceiling');
      if (a.kind === 'ceiling') {
        expect(a.verdict).toEqual({ pass: false, word: 'unavailable', group: 'o3-effect', why: "the effect's ceiling was not asked", latch: null });
        expect(a.evidence.step).toBe('effect-ceiling');
      }
    },
    'a ceiling not asked passes for no effect, a held-by effect and a never effect': () => {
      isAllowed(go(m, 'rekick-coordinator', null, { effectCeiling: 'not-asked' }), 'allow', 'act', 'none', 'not-an-answer');
      isAllowed(go(m, 'answer-item', 'link-team', { effectCeiling: 'not-asked', answer: ANS }), 'allow', 'act', 'none', 'by-cover');
      isRefused(go(m, 'answer-item', 'deploy', { effectCeiling: 'not-asked', answer: ANS }), 'operator-only', 'covers');
    },
    'a refusing ceiling verdict passes through unchanged, as the same object': () => {
      const verdicts: CeilingVerdict[] = [
        { pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'programme', limit: 1, latch: 'act-ceiling-hit' },
        { pass: false, word: 'unavailable', group: 'answer', why: 'a count was not read', latch: null },
      ];
      for (const v of verdicts) {
        for (const [act, effect] of [['rekick-coordinator', null], ['relay', 'widen-scope'], ['read', null], ['no-such-kind', null]] as const) {
          const a = go(m, act, effect, { effectCeiling: v, request: REQ });
          if (act === 'no-such-kind') { isRefused(a, 'operator-only', 'may-carry'); continue; }
          expect(a.kind).toBe('ceiling');
          if (a.kind === 'ceiling') { expect(a.verdict).toBe(v); expect(a.evidence.step).toBe('effect-ceiling'); }
        }
      }
    },
    'a passing ceiling verdict goes on to the covers': () => isAllowed(go(m, 'rekick-coordinator', null, { effectCeiling: { pass: true } }), 'allow', 'act', 'none'),
    // ---- identity
    'identity: the stronger of the act row and the effect row is the need': () => {
      const table: Record<string, OverlordActRow> = {
        'low-act': syn({ leastStrength: 'attributed', mayCarry: ['high-eff'] }),
        'high-eff': syn({ leastStrength: 'operator' }),
        'high-act': syn({ leastStrength: 'operator', mayCarry: ['low-eff'] }),
        'low-eff': syn({ leastStrength: 'attributed' }),
        'mid-act': syn({ leastStrength: 'workload', mayCarry: ['low-eff'] }),
      };
      const lookup: ActRowLookup = (k) => table[k] ?? null;
      for (const caller of ['attributed', 'workload'] as const) isRefused(go(m, 'low-act', 'high-eff', { caller }, [], { lookup }), 'identity-too-weak', 'identity');
      isAllowed(go(m, 'low-act', 'high-eff', { caller: 'operator' }, [], { lookup }), 'allow', 'act', 'none', 'not-an-answer');
      isRefused(go(m, 'high-act', 'low-eff', { caller: 'workload' }, [], { lookup }), 'identity-too-weak', 'identity');
      isRefused(go(m, 'mid-act', 'low-eff', { caller: 'attributed' }, [], { lookup }), 'identity-too-weak', 'identity');
      isAllowed(go(m, 'mid-act', 'low-eff', { caller: 'workload' }, [], { lookup }), 'allow', 'act', 'none', 'not-an-answer');
    },
    'on the real rows a caller attributed with no covers never answers identity-too-weak (sweep)': () => {
      const bad: string[] = [];
      for (const act of ALL_KINDS) {
        for (const effect of [null, ...ALL_KINDS]) {
          for (const f of [{}, { request: REQ, answer: ANS }, { answer: ANS, statedEntry: ENTRY }] as Partial<MayActFacts>[]) {
            const a = go(m, act, effect, { caller: 'attributed', ...f });
            if (a.kind === 'refused' && a.word === 'identity-too-weak') bad.push(`${act}/${effect}`);
          }
        }
      }
      expect(bad).toEqual([]);
    },
    // ---- the cell
    'the proposal cell mints word staged, mode proposal': () => {
      isAllowed(go(m, 'rekick-coordinator', null, { cell: 'proposal' }), 'staged', 'proposal', 'none', 'not-an-answer');
      isAllowed(go(m, 'relay', 'widen-scope', { cell: 'proposal', request: REQ }), 'staged', 'proposal', 'request:11');
    },
    'the armed cell mints live for true, shadow for false and refuses unmeasured for unmeasured': () => {
      const f = { cell: 'armed' as const, answer: ANS };
      isAllowed(go(m, 'answer-item', 'close-request', { ...f, armedLive: true }), 'allow', 'live', 'none');
      isAllowed(go(m, 'answer-item', 'close-request', { ...f, armedLive: false }), 'allow', 'shadow', 'none');
      isRefused(go(m, 'answer-item', 'close-request', { ...f, armedLive: 'unmeasured' }), 'unmeasured', 'arming');
    },
    'the by-grant cell refuses class none, a request and an entry with operator-only': () => {
      isRefused(go(m, 'rekick-coordinator', null, { cell: 'by-grant' }), 'operator-only', 'cell');
      isRefused(go(m, 'relay', 'widen-scope', { cell: 'by-grant', request: REQ }), 'operator-only', 'cell');
      isRefused(go(m, 'state-a-fact', null, { cell: 'by-grant', statedEntry: ENTRY, answer: ANS }), 'operator-only', 'cell');
    },
    'the by-grant cell lets a grant and a command through, mode act': () => {
      isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, cell: 'by-grant' }, [grant('approve-spec')]), 'allow-by-grant', 'act', 'grant:21', 'by-grant');
      isAllowed(go(m, 'approve-spec', null, { cell: 'by-grant', command: CMD }), 'allow', 'act', 'command:31', 'command');
    },
    'link-team with the cell allow and no facts is allowed, word allow, authority none, answered at the not-an-answer step': () => {
      isAllowed(go(m, 'link-team', null), 'allow', 'act', 'none', 'not-an-answer');
    },
    // ---- the allow
    'the allow binds act, effect, target programme and incarnation, naturalKey, cell and generation, and is frozen': () => {
      const a = go(m, 'relay', 'widen-scope', { request: REQ, naturalKey: 'key-9', generation: 42, cell: 'proposal' });
      expect(a.kind).toBe('allowed');
      if (a.kind !== 'allowed') return;
      expect(a.allow.act).toBe('relay');
      expect(a.allow.effect).toBe('widen-scope');
      expect(a.allow.target).toEqual({ programme: 3, incarnation: 2 });
      expect(a.allow.naturalKey).toBe('key-9');
      expect(a.allow.cell).toBe('proposal');
      expect(a.allow.generation).toBe(42);
      expect(Object.isFrozen(a.allow)).toBe(true);
      expect(Object.isFrozen(a.allow.authority)).toBe(true);
      expect(Object.isFrozen(a.allow.target)).toBe(true);
    },
    'the allow of an act with no programme binds null and null, and effect null': () => {
      const a = go(m, 'rekick-coordinator', null, {}, [], { target: { programme: null, startedBy: null } });
      expect(a.kind).toBe('allowed');
      if (a.kind === 'allowed') { expect(a.allow.target).toEqual({ programme: null, incarnation: null }); expect(a.allow.effect).toBeNull(); expect(a.allow.authority).toEqual({ kind: 'none', id: null }); }
    },
    'isMayActAllow is true for a minted allow and false for an equal literal, a spread copy, null and a string': () => {
      const a = go(m, 'rekick-coordinator', null);
      expect(a.kind).toBe('allowed');
      if (a.kind !== 'allowed') return;
      expect(m.isMayActAllow(a.allow)).toBe(true);
      expect(m.isMayActAllow({ ...a.allow })).toBe(false);
      expect(m.isMayActAllow(JSON.parse(JSON.stringify(a.allow)))).toBe(false);
      expect(m.isMayActAllow(null)).toBe(false);
      expect(m.isMayActAllow('allow')).toBe(false);
      expect(m.isMayActAllow(undefined)).toBe(false);
    },
    'spendMayActAllow answers true once then false, and isMayActAllow is false after the spend': () => {
      const a = go(m, 'rekick-coordinator', null);
      if (a.kind !== 'allowed') throw new Error('expected an allow');
      expect(m.isMayActAllow(a.allow)).toBe(true);
      expect(m.spendMayActAllow(a.allow)).toBe(true);
      expect(m.isMayActAllow(a.allow)).toBe(false);
      expect(m.spendMayActAllow(a.allow)).toBe(false);
      const b = go(m, 'rekick-coordinator', null);
      if (b.kind !== 'allowed') throw new Error('expected an allow');
      expect(m.spendMayActAllow({ ...b.allow } as typeof b.allow)).toBe(false);
      expect(m.isMayActAllow(b.allow)).toBe(true);
    },
    // ---- the grant path
    'a grant that covers, evidence enough, a clear blind check and an operator caller is allow-by-grant': () => {
      isAllowed(go(m, 'approve-spec', null, GRANT_FACTS, [grant('approve-spec')]), 'allow-by-grant', 'act', 'grant:21', 'by-grant');
    },
    'the grant path refuses server-not-isolated for shared-user': () => {
      isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, isolation: ISO_SHARED }, [grant('approve-spec')]), 'server-not-isolated', 'isolation');
      isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, isolation: ISO_HOST }, [grant('approve-spec')]), 'allow-by-grant', 'act', 'grant:21');
    },
    'the grant path answers unmeasured for every unmeasured isolation reason': () => {
      for (const why of ISOLATION_UNMEASURED) {
        isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, isolation: { kind: 'unmeasured', why } }, [grant('approve-spec')]), 'unmeasured', 'isolation');
      }
    },
    "the grant path is identity-too-weak under the grant's least": () => {
      isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, caller: 'workload' }, [grant('approve-spec', { leastStrength: 'operator' })]), 'identity-too-weak', 'identity');
      isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, caller: 'workload' }, [grant('approve-spec', { leastStrength: 'workload' })]), 'allow-by-grant', 'act', 'grant:21');
    },
    'relay carrying widen-scope by a grant with not-an-answer is evidence-too-weak': () => {
      isRefused(go(m, 'relay', 'widen-scope', { grantFacts: GF }, [grant('widen-scope')]), 'evidence-too-weak', 'evidence');
    },
    'the grant path with evidence too weak or unmeasured': () => {
      isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, answer: { ...ANS, evidence: 'too-weak' } }, [grant('approve-spec')]), 'evidence-too-weak', 'evidence');
      isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, answer: { ...ANS, evidence: 'unmeasured' } }, [grant('approve-spec')]), 'unmeasured', 'evidence');
    },
    'an answer carrying widen-scope by a grant with askOrAct ask is ask-is-cheaper': () => {
      isRefused(go(m, 'answer-item', 'widen-scope', { ...GRANT_FACTS, answer: { ...ANS, askOrAct: 'ask' } }, [grant('widen-scope')]), 'ask-is-cheaper', 'ask-or-act');
      isAllowed(go(m, 'answer-item', 'widen-scope', GRANT_FACTS, [grant('widen-scope')]), 'allow-by-grant', 'act', 'grant:21', 'by-grant');
    },
    'the grant path defers for a blind check that is not clear or in shadow, and passes the others': () => {
      for (const b of ['not-clear', 'shadow'] as const) {
        isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, answer: { ...ANS, blindCheck: b } }, [grant('approve-spec')]), 'defer', 'blind-check');
      }
      for (const b of ['clear-yes', 'not-armed'] as const) {
        isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, answer: { ...ANS, blindCheck: b } }, [grant('approve-spec')]), 'allow-by-grant', 'act', 'grant:21');
      }
    },
    'the blind check is read in the positive form: a value outside its type defers, never the grant allow (review 4213 F1)': () => {
      for (const b of ['unmeasured', 'no-such-word', '']) {
        const answer = { ...ANS, blindCheck: b } as unknown as typeof ANS;
        isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, answer }, [grant('approve-spec')]), 'defer', 'blind-check');
      }
    },
    "isMayActKebab admits the decider's own words and refuses a foreign one (review 4213 F6)": () => {
      for (const w of ['allow-by-grant', 'not-an-answer', 'clear-yes', 'operator-started-only', 'not-asked', 'question-effect']) expect(m.isMayActKebab(w), w).toBe(true);
      for (const w of ['policy-refused', 'mail-disabled', 'no-such-word', 'allow-by']) expect(m.isMayActKebab(w), w).toBe(false);
    },
    'an O3 effect under an attributed caller by a grant is staged; under workload or operator it is allow-by-grant': () => {
      isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, caller: 'attributed' }, [grant('approve-spec')]), 'staged', 'act', 'grant:21', 'staging');
      for (const caller of ['workload', 'operator'] as const) {
        isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, caller }, [grant('approve-spec', { leastStrength: 'attributed' })]), 'allow-by-grant', 'act', 'grant:21', 'by-grant');
      }
    },
    'a grant covers only its programme, its incarnation, its kind and before its expiry': () => {
      const f = GRANT_FACTS;
      isRefused(go(m, 'approve-spec', null, f, [grant('approve-spec', { scope: { programme: 4, incarnation: 2 } })]), 'operator-only', 'covers');
      isRefused(go(m, 'approve-spec', null, f, [grant('approve-spec', { scope: { programme: 3, incarnation: 1 } })]), 'operator-only', 'covers');
      isRefused(go(m, 'approve-spec', null, f, [grant('approve-dod')]), 'operator-only', 'covers');
      isRefused(go(m, 'approve-spec', null, f, [grant('approve-spec', { expiresAt: NOW })]), 'operator-only', 'covers');
      isAllowed(go(m, 'approve-spec', null, f, [grant('approve-spec', { expiresAt: NOW + 1 })]), 'allow-by-grant', 'act', 'grant:21');
      isRefused(go(m, 'approve-spec', null, f, [grant('approve-spec')], { target: { programme: null, startedBy: null } }), 'operator-only', 'covers');
    },
    'a grant that is not live or is suspended now covers nothing': () => {
      for (const state of ['shadow', 'suspended', 'revoked', 'expired'] as const) {
        isRefused(go(m, 'approve-spec', null, GRANT_FACTS, [grant('approve-spec', { state })]), 'operator-only', 'covers');
      }
      isRefused(go(m, 'approve-spec', null, { ...GRANT_FACTS, grantFacts: { ...GF, suspendedNow: [21] } }, [grant('approve-spec')]), 'operator-only', 'covers');
    },
    'a grant whose facts were not gathered answers unmeasured': () => {
      isRefused(go(m, 'approve-spec', null, { answer: ANS, grantFacts: null }, [grant('approve-spec')]), 'unmeasured', 'covers');
    },
    'a grant with no cover kind in the row is barred: start-programme takes no grant': () => {
      isRefused(go(m, 'start-programme', null, GRANT_FACTS, [grant('start-programme')]), 'operator-only', 'covers');
    },
    // ---- the command path
    'a live command for this proposal whose targets stood is allowed, authority command, with no answer facts': () => {
      isAllowed(go(m, 'approve-spec', null, { command: CMD }), 'allow', 'act', 'command:31', 'command');
    },
    'a command that is not live, for another proposal or whose targets moved is operator-only': () => {
      isRefused(go(m, 'approve-spec', null, { command: { ...CMD, live: false } }), 'operator-only', 'covers');
      isRefused(go(m, 'approve-spec', null, { command: { ...CMD, forThisProposal: false } }), 'operator-only', 'covers');
      isRefused(go(m, 'approve-spec', null, { command: { ...CMD, targetsMoved: true } }), 'operator-only', 'covers');
    },
    "a command whose targetsMoved is unmeasured answers unmeasured": () => {
      isRefused(go(m, 'approve-spec', null, { command: { ...CMD, targetsMoved: 'unmeasured' } }), 'unmeasured', 'covers');
    },
    'a command on a shared-user or unmeasured isolation is refused; separate-host passes': () => {
      isRefused(go(m, 'approve-spec', null, { command: CMD, isolation: ISO_SHARED }), 'server-not-isolated', 'isolation');
      isRefused(go(m, 'approve-spec', null, { command: CMD, isolation: ISO_UNREAD }), 'unmeasured', 'isolation');
      isAllowed(go(m, 'approve-spec', null, { command: CMD, isolation: ISO_HOST }), 'allow', 'act', 'command:31');
    },
    'a command never covers an O5 member': () => isRefused(go(m, 'state-a-fact', null, { command: CMD, answer: ANS }), 'operator-only', 'covers'),
    // ---- the best path answers
    'a request path that refuses on evidence beside a command path that allows answers the command allow': () => {
      isAllowed(go(m, 'answer-item', 'widen-scope', { request: REQ, command: CMD, answer: { ...ANS, evidence: 'too-weak' } }), 'allow', 'act', 'command:31', 'command');
    },
    'a command path refused on isolation beside a request path that allows answers the request allow': () => {
      isAllowed(go(m, 'relay', 'widen-scope', { request: REQ, command: CMD, isolation: ISO_SHARED }), 'allow', 'act', 'request:11', 'not-an-answer');
    },
    'the cover order breaks a tie: request before command, command before grant, grants by id': () => {
      isAllowed(go(m, 'relay', 'widen-scope', { request: REQ, command: CMD }), 'allow', 'act', 'request:11');
      isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, command: CMD }, [grant('approve-spec')]), 'allow', 'act', 'command:31');
      isAllowed(go(m, 'approve-spec', null, GRANT_FACTS, [grant('approve-spec', { id: 30 }), grant('approve-spec', { id: 21 })]), 'allow-by-grant', 'act', 'grant:21');
      isAllowed(go(m, 'approve-spec', null, GRANT_FACTS, [grant('approve-spec', { id: 21 }), grant('approve-spec', { id: 30 })]), 'allow-by-grant', 'act', 'grant:21');
    },
    'a staged grant path beside a command that cannot cover answers staged; beside one that allows, the command': () => {
      const g = [grant('approve-spec')];
      isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, caller: 'attributed', command: { ...CMD, targetsMoved: true } }, g), 'staged', 'act', 'grant:21');
      isAllowed(go(m, 'approve-spec', null, { ...GRANT_FACTS, caller: 'attributed', command: CMD }, g), 'allow', 'act', 'command:31');
    },
    'a grant path that defers beats a request path that refuses': () => {
      isRefused(go(m, 'answer-item', 'widen-scope', { cell: 'by-grant', request: REQ, answer: { ...ANS, blindCheck: 'not-clear' }, grantFacts: GF }, [grant('widen-scope')]), 'defer', 'blind-check');
    },
    'under the armed cell a tie between two shadow allows goes to the first cover': () => {
      isAllowed(go(m, 'answer-item', 'widen-scope', { cell: 'armed', armedLive: false, request: REQ, answer: ANS, grantFacts: GF }, [grant('widen-scope')]), 'allow', 'shadow', 'request:11');
    },
    'a refusal beside an unread fact answers unmeasured, naming the covers step; an allow beside one stands': () => {
      isRefused(go(m, 'relay', 'widen-scope', { request: { ...REQ, namesTarget: 'unmeasured' }, grantFacts: GF }, [grant('widen-scope')]), 'unmeasured', 'covers');
      isAllowed(go(m, 'relay', 'widen-scope', { request: { ...REQ, namesTarget: 'unmeasured' }, command: CMD }), 'allow', 'act', 'command:31', 'command');
    },
    'a refusal beside a cover that cannot cover is not unmeasured': () => {
      isRefused(go(m, 'relay', 'widen-scope', { request: { ...REQ, namesTarget: false }, grantFacts: GF }, [grant('widen-scope')]), 'evidence-too-weak', 'evidence');
    },
  };
}

/** Every case of `overlordMayAct`: the exhaustive sweep, the drawn domain, monotonicity and the named cases. */
export function mayActCases(m: MayActModule): Record<string, SuiteCase> {
  return {
    'exhaustive: every catalogue kind x effect x cell x fact set equals the oracle, and every answer carries its evidence step': () => exhaustiveCase(m),
    'first match: 2000 drawn cases over every branch equal the oracle': () => drawnCase(m),
    'monotonicity over allows: no weakening of one input raises an allow rank or turns a refusal into an allow (Table 11.7b)': () => monotoneCase(m, true),
    'monotonicity with defer ranked 1: no weakening of one input raises the rank (Table 11.7b, rank list as written)': () => monotoneCase(m, false),
    ...namedCases(m),
  };
}

// ------------------------------------------------------------------------------------------------------------- grantCovers

const GKIND = 'widen-scope';
const gc = (m: MayActModule, g: GrantFact, o: { kind?: string; target?: ActTarget; gf?: MayActFacts['grantFacts']; now?: number } = {}): string =>
  m.grantCovers(g, o.kind ?? GKIND, o.target ?? TARGET, facts({ grantFacts: o.gf === undefined ? GF : o.gf }), o.now ?? NOW).kind;

/** `grantCovers`, the grant test of C26: every check, every unread fact, and the order of a failing and an unread one. */
export function grantCoversCases(m: MayActModule): Record<string, SuiteCase> {
  const g = (o: Partial<GrantFact> = {}): GrantFact => grant(GKIND, o);
  return {
    'a live grant in scope, before its expiry, with no conditions covers': () => expect(gc(m, g())).toBe('covers'),
    'a state other than live does not cover': () => { for (const state of ['shadow', 'suspended', 'revoked', 'expired'] as const) expect(gc(m, g({ state })), state).toBe('no'); },
    'a grant suspended now does not cover': () => expect(gc(m, g(), { gf: { ...GF, suspendedNow: [21] } })).toBe('no'),
    'a grant suspended now is not confused with another id': () => expect(gc(m, g(), { gf: { ...GF, suspendedNow: [22] } })).toBe('covers'),
    'a grant for another kind does not cover': () => expect(gc(m, g(), { kind: 'approve-spec' })).toBe('no'),
    'a target with no programme, another programme or another incarnation does not cover': () => {
      expect(gc(m, g(), { target: { programme: null, startedBy: null } })).toBe('no');
      expect(gc(m, g(), { target: { programme: { id: 4, incarnation: 2 }, startedBy: 'operator' } })).toBe('no');
      expect(gc(m, g(), { target: { programme: { id: 3, incarnation: 1 }, startedBy: 'operator' } })).toBe('no');
    },
    'now equal to expiresAt does not cover, one less does': () => {
      expect(gc(m, g({ expiresAt: NOW }))).toBe('no');
      expect(gc(m, g({ expiresAt: NOW + 1 }))).toBe('covers');
      expect(gc(m, g({ expiresAt: NOW - 1 }))).toBe('no');
    },
    'operator-started-only: operator covers, overlord and none do not, unmeasured is unread': () => {
      const c = g({ conditions: [{ kind: 'operator-started-only' }] });
      const t = (startedBy: ActTarget['startedBy']): ActTarget => ({ programme: TARGET.programme, startedBy });
      expect(gc(m, c, { target: t('operator') })).toBe('covers');
      expect(gc(m, c, { target: t('overlord') })).toBe('no');
      expect(gc(m, c, { target: t(null) })).toBe('no');
      expect(gc(m, c, { target: t('unmeasured') })).toBe('unmeasured');
    },
    'max-per-day: under n covers, at n and over do not, absent or unmeasured is unread': () => {
      const c = g({ conditions: [{ kind: 'max-per-day', n: 3 }] });
      const gf = (u: Record<number, number | 'unmeasured'>): MayActFacts['grantFacts'] => ({ ...GF, usesToday: u });
      expect(gc(m, c, { gf: gf({ 21: 0 }) })).toBe('covers');
      expect(gc(m, c, { gf: gf({ 21: 2 }) })).toBe('covers');
      expect(gc(m, c, { gf: gf({ 21: 3 }) })).toBe('no');
      expect(gc(m, c, { gf: gf({ 21: 9 }) })).toBe('no');
      expect(gc(m, c, { gf: gf({}) })).toBe('unmeasured');
      expect(gc(m, c, { gf: gf({ 21: 'unmeasured' }) })).toBe('unmeasured');
      expect(gc(m, c, { gf: gf({ 22: 9 }) })).toBe('unmeasured');
    },
    'model-class: equal covers, another does not, unmeasured is unread': () => {
      const c = g({ conditions: [{ kind: 'model-class', modelClass: 'class-a' }] });
      expect(gc(m, c, { gf: { ...GF, modelClass: 'class-a' } })).toBe('covers');
      expect(gc(m, c, { gf: { ...GF, modelClass: 'class-b' } })).toBe('no');
      expect(gc(m, c, { gf: { ...GF, modelClass: 'unmeasured' } })).toBe('unmeasured');
    },
    'only-when-recommended-by-coordinator: true covers, false does not, unmeasured is unread': () => {
      const c = g({ conditions: [{ kind: 'only-when-recommended-by-coordinator' }] });
      expect(gc(m, c, { gf: { ...GF, recommendedByCoordinator: true } })).toBe('covers');
      expect(gc(m, c, { gf: { ...GF, recommendedByCoordinator: false } })).toBe('no');
      expect(gc(m, c, { gf: { ...GF, recommendedByCoordinator: 'unmeasured' } })).toBe('unmeasured');
    },
    'a condition of a kind this build does not know cannot say: unmeasured, never a cover, whatever the recommendation (review 4213 F2)': () => {
      const c = g({ conditions: [{ kind: 'suspend-on-holiday' } as unknown as GrantFact['conditions'][number]] });
      expect(gc(m, c, { gf: { ...GF, recommendedByCoordinator: true } })).toBe('unmeasured');
      expect(gc(m, c, { gf: { ...GF, recommendedByCoordinator: false } })).toBe('unmeasured');
      expect(gc(m, g({ conditions: [...c.conditions], state: 'revoked' }))).toBe('no');
    },
    'every condition must hold: one that fails among holding ones is no': () => {
      const c = g({ conditions: [{ kind: 'operator-started-only' }, { kind: 'model-class', modelClass: 'class-a' }, { kind: 'only-when-recommended-by-coordinator' }, { kind: 'max-per-day', n: 2 }] });
      const gf = { ...GF, usesToday: { 21: 1 } };
      expect(gc(m, c, { gf })).toBe('covers');
      expect(gc(m, c, { gf: { ...gf, modelClass: 'class-b' } })).toBe('no');
      expect(gc(m, c, { gf: { ...gf, recommendedByCoordinator: false } })).toBe('no');
      expect(gc(m, c, { gf: { ...gf, usesToday: { 21: 2 } } })).toBe('no');
      expect(gc(m, c, { gf, target: { programme: TARGET.programme, startedBy: 'overlord' } })).toBe('no');
    },
    'grant facts that were not gathered are unmeasured, with or without conditions': () => {
      expect(gc(m, g(), { gf: null })).toBe('unmeasured');
      expect(gc(m, g({ conditions: [{ kind: 'max-per-day', n: 1 }, { kind: 'model-class', modelClass: 'class-a' }, { kind: 'only-when-recommended-by-coordinator' }] }), { gf: null })).toBe('unmeasured');
    },
    'a failing check beats an unread one, whichever comes first': () => {
      expect(gc(m, g({ state: 'shadow' }), { gf: null })).toBe('no');
      expect(gc(m, g({ expiresAt: NOW }), { gf: null })).toBe('no');
      expect(gc(m, g({ conditions: [{ kind: 'max-per-day', n: 1 }, { kind: 'model-class', modelClass: 'class-a' }] }), { gf: { ...GF, modelClass: 'class-b', usesToday: {} } })).toBe('no');
      expect(gc(m, g({ conditions: [{ kind: 'model-class', modelClass: 'class-a' }, { kind: 'max-per-day', n: 1 }] }), { gf: { ...GF, modelClass: 'class-b', usesToday: {} } })).toBe('no');
      expect(gc(m, g({ conditions: [{ kind: 'operator-started-only' }] }), { target: { programme: TARGET.programme, startedBy: 'unmeasured' }, gf: { ...GF, suspendedNow: [21] } })).toBe('no');
      expect(gc(m, g(), { kind: 'approve-spec', gf: null })).toBe('no');
      expect(gc(m, g(), { target: { programme: null, startedBy: null }, gf: null })).toBe('no');
    },
  };
}

// --------------------------------------------------------------------------------------------------------- mutant sets

const DECIDER_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/overlordMayAct.ts');

/** `overlordMayAct`'s mutants: one per step's comparison, per cover's fact, per binding field and per allow rule (plan §8, F13;
 *  the plan's least was 24). */
export const MAY_ACT_SET: MutantSet<MayActModule> = {
  modulePath: DECIDER_TS, suite: mayActCases,
  mutants: [
    // 1. what it may carry
    { id: 'D1 a carrier carries a carrier', old: '    if (e.carrier) return', new: '    if (false) return' },
    { id: 'D2 a carrier carries the server\'s act', old: "    if (e.actor === 'server') return", new: '    if (false) return' },
    { id: 'D3 a listed row carries anything', old: '  if (!row.mayCarry.includes(effect)) return', new: '  if (false) return' },
    { id: 'D4 a listed effect the lookup lacks is carried', old: '  if (lookup(effect) === null) return', new: '  if (false) return' },
    // 2. the effect's ceiling
    { id: 'D5 a counted effect not asked passes', old: "    if (effRow !== null && effRow.ceiling.kind === 'counted') {", new: '    if (false) {' },
    { id: 'D6 a refusing verdict is ignored', old: '  } else if (!ec.pass) {', new: '  } else if (false) {' },
    // 3. covers
    { id: 'D7 CLASS_COVERS ignored', old: '    if (!CLASS_COVERS[m.member].includes(kind)) return', new: '    if (false) return' },
    { id: 'D8 the row\'s covers ignored', old: '    if (!rowOf(m).covers.includes(kind)) return', new: '    if (false) return' },
    { id: 'D9 an inactive entry covers', old: 'const holds = e.active && e.stated &&', new: 'const holds = e.stated &&' },
    { id: 'D10 an entry with another subject covers', old: '&& e.confirmedOrWhole && e.subjectMatches;', new: '&& e.confirmedOrWhole;' },
    { id: 'D11 an overlord request covers', old: ": r.origin !== 'operator' ? {", new: ': false ? {' },
    { id: 'D12 an unread naming reads as named', old: ": r.namesTarget === 'unmeasured' ? {", new: ': false ? {' },
    { id: 'D13 a request not naming the target covers', old: ': r.namesTarget ? COVERS : {', new: ': true ? COVERS : {' },
    { id: 'D14 a command not live covers', old: ': !c.live ? {', new: ': false ? {' },
    { id: 'D15 a command for another proposal covers', old: ': !c.forThisProposal ? {', new: ': false ? {' },
    { id: 'D16 a command whose targets moved covers', old: ": c.targetsMoved ? { kind: 'no'", new: ": false ? { kind: 'no'" },
    { id: 'D17 an unread command reads as unmoved', old: ": c.targetsMoved === 'unmeasured' ? {", new: ': false ? {' },
    { id: 'D18 no path and an unread cover is operator-only', old: "return unread !== null ? refused('unmeasured', ev('covers', null, `${unread} is unmeasured`))\n", new: "return false ? refused('unmeasured', ev('covers', null, `${unread} is unmeasured`))\n" },
    // 4 to 7. identity, isolation, the cell, the arming
    { id: 'D19 the effect\'s least ignored', old: '  if (effRow !== null) need = strongest(need, effRow.leastStrength);', new: '' },
    { id: 'D20 the grant\'s least ignored', old: '  if (grant !== null) need = strongest(need, grant.leastStrength);', new: '' },
    { id: 'D21 identity not checked', old: '  if (!strengthAtLeast(facts.caller, need)) return', new: '  if (false) return' },
    { id: 'D22 isolation skipped on the command path', old: '  if (onGrant || onCommand) {', new: '  if (onGrant) {' },
    { id: 'D23 an unmeasured isolation passes', old: "    if (iso.kind === 'unmeasured') return", new: '    if (false) return' },
    { id: 'D24 an unmeasured isolation read as shared-user', old: "return no('unmeasured', 'isolation'", new: "return no('server-not-isolated', 'isolation'" },
    { id: 'D25 a shared-user server passes', old: "    if (iso.word === 'shared-user') return", new: '    if (false) return' },
    { id: 'D26 by-grant lets every path on', old: "  if (facts.cell === 'by-grant' && !onGrant && !onCommand) return", new: '  if (false) return' },
    { id: 'D27 an unread arming reads as live', old: "  if (facts.cell === 'armed' && armedLive === 'unmeasured') return", new: '  if (false) return' },
    { id: 'D28 the arming read after the blind check', old: "  if (facts.cell === 'armed' && armedLive === 'unmeasured') return no('unmeasured', 'arming', 'whether the kind is armed is unmeasured');\n", new: '' },
    { id: 'D29 a disarmed kind acts live', old: "mode: armedLive === true ? 'live' : 'shadow'", new: "mode: 'live'" },
    { id: 'D30 a proposal acts', old: "    if (cell === 'proposal') return", new: '    if (false) return' },
    // 8 to 15. the paths
    { id: 'D31 a command path runs on', old: "  if (path.cover === 'command') return mint(", new: '  if (false) return mint(' },
    { id: 'D32 is an answer read from the facts', old: "  if (!row.answer && path.cover === 'none') return", new: "  if (facts.answer.kind === 'not-an-answer' && path.cover === 'none') return" },
    { id: 'D33 the grant path skips evidence', old: '  if (row.answer || onGrant) {', new: '  if (row.answer) {' },
    { id: 'D34 an answer with no verdicts is too weak', old: "if (row.answer) return no('unmeasured', 'evidence'", new: "if (row.answer) return no('evidence-too-weak', 'evidence'" },
    { id: 'D35 an unmeasured evidence is too weak', old: "    if (a.evidence === 'unmeasured') return", new: '    if (false) return' },
    { id: 'D36 too-weak evidence passes', old: "    if (a.evidence !== 'enough') return", new: '    if (false) return' },
    { id: 'D37 an unmeasured askOrAct is ask-is-cheaper', old: "    if (a.askOrAct === 'unmeasured') return", new: '    if (false) return' },
    { id: 'D38 ask passes', old: "    if (a.askOrAct !== 'act') return", new: '    if (false) return' },
    { id: 'D39 an entry runs on to the grant steps', old: "  if (path.cover === 'stated-entry') return", new: '  if (false) return' },
    { id: 'D40 a not-armed blind check defers', old: "= ['clear-yes', 'not-armed'];", new: "= ['clear-yes'];" },
    { id: 'D41 a shadow blind check passes', old: "= ['clear-yes', 'not-armed'];", new: "= ['clear-yes', 'not-armed', 'shadow'];" },
    { id: 'D65 the blind check read in the negative form', old: '!BLIND_CHECK_PASSES.includes(a.blindCheck)', new: "(a.blindCheck === 'not-clear' || a.blindCheck === 'shadow')" },
    // the evidence and the kebab guard (review 4213 F5, F6)
    { id: 'D66 the evidence emptied', old: '({ step, path, read });', new: "({ step, path: null, read: '' });" },
    { id: 'D67 the kebab guard admits every word', old: 'export const isMayActKebab = (word: string): boolean =>', new: 'export const isMayActKebab = (word: string): boolean => true ||' },
    { id: 'D42 an O3 effect is staged under operator', old: "members.some((m) => m.member === 'O3') && facts.caller === 'attributed'", new: "members.some((m) => m.member === 'O3')" },
    // Measured equivalent and left out: staging without the O3 test ("a classless grant is staged"), because `CLASS_COVERS` gives a
    // grant to O3 alone, so every grant path holds an O3 member.
    { id: 'D44 a request allow names no authority', old: "{ kind: 'request', id: path.id }, `request ${path.id} covers every member, and it is not an answer`", new: "{ kind: 'none', id: null }, `request ${path.id} covers every member, and it is not an answer`" },
    // across paths
    { id: 'D45 the first path answers', old: '    if (best === null || mayActRank(r) > mayActRank(best)) best = r;', new: '    if (best === null) best = r;' },
    { id: 'D46 a tie goes to the last path', old: 'mayActRank(r) > mayActRank(best)', new: 'mayActRank(r) >= mayActRank(best)' },
    { id: 'D47 an unread cover is dropped after a refusal', old: "return unread !== null && b.word !== 'defer' ? refused(", new: 'return false ? refused(' },
    { id: 'D48 a defer turned unmeasured', old: "return unread !== null && b.word !== 'defer' ? refused(", new: 'return unread !== null ? refused(' },
    { id: 'D49 defer ranks with the refusals', old: "  if (a.kind !== 'allowed') return a.word === 'defer' ? 1 : 0;", new: "  if (a.kind !== 'allowed') return 0;" },
    { id: 'D50 staged ranks above allow', old: "  const word = a.word === 'staged' ? 2 : 3;", new: "  const word = a.word === 'staged' ? 4 : 3;" },
    // the allow
    { id: 'D51 the key not bound', old: '    naturalKey: facts.naturalKey,', new: "    naturalKey: ''," },
    { id: 'D52 the generation not bound', old: 'generation: facts.generation,', new: 'generation: 0,' },
    { id: 'D53 the cell not bound', old: 'cell: facts.cell, generation', new: "cell: 'allow', generation" },
    { id: 'D54 the programme not bound', old: 'programme: p === null ? null : p.id,', new: 'programme: null,' },
    { id: 'D55 the incarnation not bound', old: 'incarnation: p === null ? null : p.incarnation', new: 'incarnation: null' },
    { id: 'D56 the effect not bound', old: 'effect: effect as OverlordActKind | null,', new: 'effect: null,' },
    { id: 'D57 the allow not frozen', old: '  const allow = Object.freeze({', new: '  const allow = ({' },
    { id: 'D58 the authority not frozen', old: 'authority: Object.freeze({ ...f.authority })', new: 'authority: { ...f.authority }' },
    { id: 'D59 the target not frozen', old: 'target: Object.freeze({ ...f.target })', new: 'target: { ...f.target }' },
    { id: 'D60 minted outside the registry', old: '  mintedAllows.add(allow);\n', new: '' },
    { id: 'D61 a spent allow still reads as one', old: ' && mintedAllows.has(v) && !spentAllows.has(v);', new: ' && mintedAllows.has(v);' },
    { id: 'D62 any object reads as an allow', old: ' && mintedAllows.has(v) && !spentAllows.has(v);', new: ' && !spentAllows.has(v);' },
    { id: 'D63 an allow spent twice', old: '  if (!mintedAllows.has(a) || spentAllows.has(a)) return false;', new: '  if (!mintedAllows.has(a)) return false;' },
    { id: 'D64 a forgery spent', old: '  if (!mintedAllows.has(a) || spentAllows.has(a)) return false;', new: '  if (spentAllows.has(a)) return false;' },
  ],
};

/** `grantCovers`' mutants (the plan's least was 10). */
export const GRANT_COVERS_SET: MutantSet<MayActModule> = {
  modulePath: DECIDER_TS, suite: grantCoversCases,
  mutants: [
    { id: 'G1 a grant not live covers', old: "  if (g.state !== 'live') checks.push", new: '  if (false) checks.push' },
    { id: 'G2 a suspended grant covers', old: '  else if (gf.suspendedNow.includes(g.id)) checks.push', new: '  else if (false) checks.push' },
    { id: 'G3 grant facts not gathered pass', old: "  if (gf === null) checks.push(unread('the grant facts'));", new: '' },
    { id: 'G4 a grant for another kind covers', old: '  if (g.effect !== kind) checks.push', new: '  if (false) checks.push' },
    { id: 'G5 another incarnation covers', old: ' || g.scope.incarnation !== p.incarnation)', new: ')' },
    { id: 'G6 another programme covers', old: ' || g.scope.programme !== p.id ||', new: ' ||' },
    { id: 'G7 no programme covers', old: 'if (p === null || g.scope', new: 'if (p !== null && g.scope' },
    { id: 'G8 expiry read with <=', old: 'if (!(now < g.expiresAt))', new: 'if (!(now <= g.expiresAt))' },
    { id: 'G9 who started it unread reads as the operator', old: "target.startedBy === 'unmeasured' ? unread(", new: 'false ? unread(' },
    { id: 'G10 who started it ignored', old: ": target.startedBy === 'operator' ? COVERS", new: ': true ? COVERS' },
    { id: 'G11 the uses read with <=', old: 'uses < c.n ? COVERS', new: 'uses <= c.n ? COVERS' },
    { id: 'G12 unread uses read as a number', old: "checks.push(uses === 'unmeasured' ? unread(", new: 'checks.push(false ? unread(' },
    { id: 'G13 absent uses read as zero', old: "(gf.usesToday[g.id] ?? 'unmeasured')", new: '(gf.usesToday[g.id] ?? 0)' },
    { id: 'G14 the model class ignored', old: 'mc === c.modelClass ? COVERS', new: 'true ? COVERS' },
    { id: 'G15 an unread model class passes', old: "checks.push(mc === 'unmeasured' ? unread(", new: 'checks.push(false ? unread(' },
    { id: 'G16 the recommendation ignored', old: ": r ? COVERS : no('the coordinator did not recommend it')", new: ": true ? COVERS : no('the coordinator did not recommend it')" },
    { id: 'G17 an unread recommendation reads as yes', old: "checks.push(r === 'unmeasured' ? unread(", new: 'checks.push(false ? unread(' },
    { id: 'G18 an unread check beats a failing one', old: "return vs.find((v) => v.kind === 'no') ?? vs.find((v) => v.kind === 'unmeasured') ?? COVERS;", new: "return vs.find((v) => v.kind === 'unmeasured') ?? vs.find((v) => v.kind === 'no') ?? COVERS;" },
    { id: 'G19 an unread check covers', old: "?? vs.find((v) => v.kind === 'unmeasured') ?? COVERS;", new: '?? COVERS;' },
    { id: 'G20 an unknown kind read as the recommendation (review 4213 F2)', old: "} else if (c.kind === 'only-when-recommended-by-coordinator') {", new: '} else if (true) {' },
    { id: 'G21 an unknown kind covers', old: "checks.push(unread(`grant ${g.id}'s condition of kind", new: "checks.push(COVERS); void ((`grant ${g.id}'s condition of kind" },
  ],
};
