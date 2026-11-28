// `overlordMayAct`, the one decider that answers whether an Overlord act may pass (Overlord W2, the act catalogue B; spec
// §7.1 H24, §7.2 C26, §7.4 C27 and H28, §3.8 C12; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`
// §6 and Tasks B2 and B3). Ring L1, context C5: pure, no I/O and no clock (`now` is an argument); it imports L0 and the
// ceiling step's verdict type only. Its one importer of the decider itself is `overlordMayActW2.ts` (W2's wrapper), held by
// `server/test/single-definition/overlord-may-act.test.ts`.
//
// FIRST MATCH WITHIN A PATH, THE BEST PATH ACROSS COVERS (slug `the-best-cover-answers`). Steps 1 to 3 are common: what the
// act may carry, the effect's ceiling, and which covers cover every member of the effective class. Each cover that covers is a
// path (class none is the one path `none`), and steps 4 to 16 run over each path in §6's order, first match. The answer is the
// most permissive path's, ties to the first in the cover order (entry, request, command, grants by id). A fixed order alone
// cannot be monotone: a command skips evidence but needs isolation, and a request needs evidence but not isolation, so either
// order lets removing one cover turn a refusal into an allow. Taking the best path makes "weakening an input never moves the
// answer up" hold by construction, because removing a cover removes a candidate.
//
// AN UNREAD FACT IS ITS OWN WORD (the coordinator's item 5). Every fact with an `unmeasured` arm, and every fact the decider
// needed that was not gathered (an answer's verdicts, the grant facts), answers `unmeasured`, naming the fact: never an allow,
// and never another refusal's word. Every answer carries its evidence, by its type.
import {
  CLASS_COVERS, actRow, effectiveClasses,
  type ActAuthority, type ActRowLookup, type AllowMode, type ClassMember, type CoverKind, type MayActAllowWord, type MayActWord,
  type OverlordActKind, type OverlordActRow, type RungCellWord,
} from '../../../shared/overlord.js';
import { strengthAtLeast, type CallerStrength } from '../../../shared/overlord-identity.js';
import type { IsolationRead } from '../../../shared/isolation.js';
import type { CeilingVerdict } from './overlordActCeiling.js';

/** What the act targets (C26's scope): the programme's row and incarnation, and who started it; or no programme. */
export interface ActTarget {
  readonly programme: { readonly id: number; readonly incarnation: number } | null;
  /** `null` when there is no programme. */
  readonly startedBy: 'operator' | 'overlord' | 'unmeasured' | null;
}

/** A grant's states (§7.2). Only `live` covers; a suspended grant reads as absent. */
export type GrantState = 'shadow' | 'live' | 'suspended' | 'revoked' | 'expired';
export type GrantCondition =
  | { readonly kind: 'operator-started-only' } | { readonly kind: 'max-per-day'; readonly n: number }
  | { readonly kind: 'model-class'; readonly modelClass: string } | { readonly kind: 'only-when-recommended-by-coordinator' };
/** One grant row the door read (C26). Dormant in W2: `mayActW2` passes none (index question 27). */
export interface GrantFact {
  readonly id: number; readonly effect: string; readonly scope: { readonly programme: number; readonly incarnation: number };
  readonly state: GrantState; readonly expiresAt: number; readonly leastStrength: CallerStrength;
  readonly conditions: readonly GrantCondition[];
}
/** The operator's command on a proposal (§7.1). Dormant in W2. */
export interface CommandFact {
  readonly id: number; readonly live: boolean; readonly forThisProposal: boolean; readonly targetsMoved: boolean | 'unmeasured';
}

/** Everything the door gathered before its transaction (H24: the decider makes no call). */
export interface MayActFacts {
  readonly caller: CallerStrength;
  readonly isolation: IsolationRead;
  readonly command: CommandFact | null;
  readonly request: { readonly kind: 'none' } | { readonly kind: 'bound'; readonly id: number;
    readonly origin: 'operator' | 'overlord'; readonly namesTarget: boolean | 'unmeasured' };
  readonly statedEntry: { readonly kind: 'none' } | { readonly kind: 'cited'; readonly id: number;
    readonly active: boolean; readonly stated: boolean; readonly restsOnOperatorMessage: boolean;
    readonly confirmedOrWhole: boolean; readonly subjectMatches: boolean };
  /** An answer's verdicts; `not-an-answer` when none were gathered. */
  readonly answer: { readonly kind: 'not-an-answer' } | { readonly kind: 'answer';
    readonly evidence: 'enough' | 'too-weak' | 'unmeasured'; readonly askOrAct: 'act' | 'ask' | 'unmeasured';
    readonly blindCheck: 'not-armed' | 'clear-yes' | 'not-clear' | 'shadow' };
  /** The facts a grant's conditions read; `null` when none were gathered. */
  readonly grantFacts: { readonly modelClass: string | 'unmeasured';
    readonly usesToday: Readonly<Record<number, number | 'unmeasured'>>;
    readonly recommendedByCoordinator: boolean | 'unmeasured'; readonly suspendedNow: readonly number[] } | null;
  /** The effect's ceiling verdict, gathered by `actCeilingStep` with both counts read (F9; call 1874). */
  readonly effectCeiling: CeilingVerdict | 'not-asked';
  /** Step 10's cell for the act (F4). */
  readonly cell: Exclude<RungCellWord, 'refuse'>;
  /** Whether an `armed` kind is live (W3's arming), read only under `armed`. */
  readonly armedLive: boolean | 'unmeasured';
  /** The act's natural key and the gate's live generation (F5). */
  readonly naturalKey: string;
  readonly generation: number;
}

/** The decider's steps, in its order (§6), each the step an answer's evidence names. */
const MAY_ACT_STEP_MAP = {
  'may-carry': 1, 'effect-ceiling': 2, covers: 3, identity: 4, isolation: 5, cell: 6, arming: 7, command: 8, 'not-an-answer': 9,
  evidence: 10, 'ask-or-act': 11, 'by-cover': 12, 'blind-check': 13, staging: 14, 'by-grant': 15,
} as const;
export type MayActStep = keyof typeof MAY_ACT_STEP_MAP;
export const MAY_ACT_STEPS = Object.keys(MAY_ACT_STEP_MAP) as MayActStep[];

/** A path the decider ran: class none, or the cover it rests on. */
export type MayActPath = { readonly cover: 'none' } | { readonly cover: Exclude<CoverKind, 'grant'>; readonly id: number }
  | { readonly cover: 'grant'; readonly id: number };

/** Why the answer is what it is: the step that answered, the path it ran on (`null` before a path is chosen) and what it read. */
export interface MayActEvidence { readonly step: MayActStep; readonly path: MayActPath | null; readonly read: string }

declare const mayActAllowBrand: unique symbol;
/** The decider's bound allow (F4, F5): frozen, minted only here, registered so `isMayActAllow` knows it, and spent once by act
 *  rows A's writer. */
export type MayActAllow = {
  readonly word: MayActAllowWord; readonly mode: AllowMode; readonly authority: ActAuthority;
  readonly act: OverlordActKind; readonly effect: OverlordActKind | null;
  readonly target: { readonly programme: number | null; readonly incarnation: number | null };
  readonly naturalKey: string; readonly cell: Exclude<RungCellWord, 'refuse'>; readonly generation: number;
} & { readonly [mayActAllowBrand]: true };

export type MayActRefusal = Exclude<MayActWord, MayActAllowWord>;
export type CeilingRefusal = Exclude<CeilingVerdict, { readonly pass: true }>;
export type MayActAnswer =
  | { readonly kind: 'allowed'; readonly allow: MayActAllow; readonly evidence: MayActEvidence }
  | { readonly kind: 'refused'; readonly word: MayActRefusal; readonly evidence: MayActEvidence }
  | { readonly kind: 'ceiling'; readonly verdict: CeilingRefusal; readonly evidence: MayActEvidence };

// ---------------------------------------------------------------------------------------------------------- the allow

const mintedAllows = new WeakSet<object>();
const spentAllows = new WeakSet<object>();

type AllowFields = Omit<MayActAllow, typeof mayActAllowBrand>;
/** THE ONE MINTER: the only place a `MayActAllow` is made (the census in the area file holds it). */
function mintMayActAllow(f: AllowFields): MayActAllow {
  const allow = Object.freeze({
    ...f, authority: Object.freeze({ ...f.authority }), target: Object.freeze({ ...f.target }),
  }) as MayActAllow;
  mintedAllows.add(allow);
  return allow;
}

/** Run time: true only for an allow `overlordMayAct` minted and nobody has spent. */
export function isMayActAllow(v: unknown): v is MayActAllow {
  return typeof v === 'object' && v !== null && mintedAllows.has(v) && !spentAllows.has(v);
}

/** Act rows A's writer spends an allow once; a second spend, or an allow this module did not mint, answers `false`. */
export function spendMayActAllow(a: MayActAllow): boolean {
  if (!mintedAllows.has(a) || spentAllows.has(a)) return false;
  spentAllows.add(a);
  return true;
}

// ------------------------------------------------------------------------------------------------------------ helpers

const ev = (step: MayActStep, path: MayActPath | null, read: string): MayActEvidence => ({ step, path, read });
const refused = (word: MayActRefusal, evidence: MayActEvidence): MayActAnswer => ({ kind: 'refused', word, evidence });
const strongest = (a: CallerStrength, b: CallerStrength): CallerStrength => (strengthAtLeast(a, b) ? a : b);

/** Step 1: why the act may not carry this effect, or `null` when it may (F1). */
function mayCarryRefusal(row: OverlordActRow | null, effect: string | null, lookup: ActRowLookup): string | null {
  if (row === null) return 'the act kind is not in the catalogue';
  if (row.mayCarry === 'question-effect') {
    if (effect === null) return "a carrier carries its question's effect, and none was given";
    const e = lookup(effect);
    if (e === null) return `the effect ${effect} is not in the catalogue`;
    if (e.carrier) return `the effect ${effect} is a carrier`;
    if (e.actor === 'server') return `the effect ${effect} is the server's own act`;
    return null;
  }
  if (effect === null) return null;
  if (!row.mayCarry.includes(effect)) return `its row does not list the effect ${effect}`;
  if (lookup(effect) === null) return `the effect ${effect} is not in the catalogue`;
  return null;
}

/** A cover's verdict over every member: it covers, it cannot, or a fact it needs was not read. */
type CoverVerdict = { readonly kind: 'covers' } | { readonly kind: 'no'; readonly why: string } | { readonly kind: 'unmeasured'; readonly fact: string };
const COVERS: CoverVerdict = { kind: 'covers' };

/** One verdict from several checks, read whole: any `no` is no, else any `unmeasured` is unmeasured, else it covers. */
function combine(vs: readonly CoverVerdict[]): CoverVerdict {
  return vs.find((v) => v.kind === 'no') ?? vs.find((v) => v.kind === 'unmeasured') ?? COVERS;
}

/** Whether a cover of this kind is allowed for every member: by `CLASS_COVERS` and by the member's row's `covers` (F1). */
function allowedForEvery(kind: CoverKind, members: readonly ClassMember[], rowOf: (m: ClassMember) => OverlordActRow): string | null {
  for (const m of members) {
    if (!CLASS_COVERS[m.member].includes(kind)) return `${kind} never covers ${m.member}`;
    if (!rowOf(m).covers.includes(kind)) return `the ${m.from}'s row takes no ${kind} cover for ${m.member}`;
  }
  return null;
}

/** C26's grant test (§7.2, plan §6), read whole: the grant is live and not suspended now, for this kind, in the target's
 *  programme and incarnation, before `expiresAt`, and every condition holds. A fact a check needs that was not read answers
 *  `unmeasured`; any check that fails answers `no` first. */
export function grantCovers(g: GrantFact, kind: string, target: ActTarget, facts: MayActFacts, now: number): CoverVerdict {
  const gf = facts.grantFacts;
  const checks: CoverVerdict[] = [];
  const no = (why: string): CoverVerdict => ({ kind: 'no', why });
  const unread = (fact: string): CoverVerdict => ({ kind: 'unmeasured', fact });
  if (g.state !== 'live') checks.push(no(`grant ${g.id} is ${g.state}`));
  if (gf === null) checks.push(unread('the grant facts'));
  else if (gf.suspendedNow.includes(g.id)) checks.push(no(`grant ${g.id} is suspended now`));
  if (g.effect !== kind) checks.push(no(`grant ${g.id} covers ${g.effect}, not ${kind}`));
  const p = target.programme;
  if (p === null || g.scope.programme !== p.id || g.scope.incarnation !== p.incarnation) checks.push(no(`grant ${g.id} is scoped to another programme`));
  if (!(now < g.expiresAt)) checks.push(no(`grant ${g.id} has expired`));
  for (const c of g.conditions) {
    if (c.kind === 'operator-started-only') {
      checks.push(target.startedBy === 'unmeasured' ? unread('who started the programme')
        : target.startedBy === 'operator' ? COVERS : no('the programme was not started by the operator'));
    } else if (c.kind === 'max-per-day') {
      const uses = gf === null ? 'unmeasured' : (gf.usesToday[g.id] ?? 'unmeasured');
      checks.push(uses === 'unmeasured' ? unread(`grant ${g.id}'s uses today`) : uses < c.n ? COVERS : no(`grant ${g.id} is used ${uses} of ${c.n} today`));
    } else if (c.kind === 'model-class') {
      const mc = gf === null ? 'unmeasured' : gf.modelClass;
      checks.push(mc === 'unmeasured' ? unread("the generation's model class") : mc === c.modelClass ? COVERS : no(`the model class is ${mc}, not ${c.modelClass}`));
    } else {
      const r = gf === null ? 'unmeasured' : gf.recommendedByCoordinator;
      checks.push(r === 'unmeasured' ? unread("the coordinator's recommendation") : r ? COVERS : no('the coordinator did not recommend it'));
    }
  }
  return combine(checks);
}

/** The kind a member comes from: the act, or the effect it carries. */
const kindOf = (m: ClassMember, act: string, effect: string | null): string => (m.from === 'act' ? act : effect!);

/** Step 3's candidates, in the cover order, each with its verdict over every member. */
function coverVerdicts(act: string, effect: string | null, members: readonly ClassMember[], rowOf: (m: ClassMember) => OverlordActRow,
  target: ActTarget, grants: readonly GrantFact[], facts: MayActFacts, now: number): { readonly path: MayActPath; readonly verdict: CoverVerdict }[] {
  const out: { path: MayActPath; verdict: CoverVerdict }[] = [];
  const e = facts.statedEntry;
  if (e.kind === 'cited') {
    const barred = allowedForEvery('stated-entry', members, rowOf);
    const holds = e.active && e.stated && e.restsOnOperatorMessage && e.confirmedOrWhole && e.subjectMatches;
    out.push({ path: { cover: 'stated-entry', id: e.id },
      verdict: barred !== null ? { kind: 'no', why: barred } : holds ? COVERS : { kind: 'no', why: `entry ${e.id} does not hold` } });
  }
  const r = facts.request;
  if (r.kind === 'bound') {
    const barred = allowedForEvery('operator-request', members, rowOf);
    out.push({ path: { cover: 'operator-request', id: r.id },
      verdict: barred !== null ? { kind: 'no', why: barred } : r.origin !== 'operator' ? { kind: 'no', why: `request ${r.id} is not the operator's` }
        : r.namesTarget === 'unmeasured' ? { kind: 'unmeasured', fact: `whether request ${r.id} names the target` }
          : r.namesTarget ? COVERS : { kind: 'no', why: `request ${r.id} does not name the target` } });
  }
  const c = facts.command;
  if (c !== null) {
    const barred = allowedForEvery('command', members, rowOf);
    out.push({ path: { cover: 'command', id: c.id },
      verdict: barred !== null ? { kind: 'no', why: barred } : !c.live ? { kind: 'no', why: `command ${c.id} is not live` }
        : !c.forThisProposal ? { kind: 'no', why: `command ${c.id} is for another proposal` }
          : c.targetsMoved === 'unmeasured' ? { kind: 'unmeasured', fact: `whether command ${c.id}'s targets moved` }
            : c.targetsMoved ? { kind: 'no', why: `command ${c.id}'s targets moved` } : COVERS });
  }
  for (const g of [...grants].sort((a, b) => a.id - b.id)) {
    const barred = allowedForEvery('grant', members, rowOf);
    out.push({ path: { cover: 'grant', id: g.id },
      verdict: barred !== null ? { kind: 'no', why: barred } : combine(members.map((m) => grantCovers(g, kindOf(m, act, effect), target, facts, now))) });
  }
  return out;
}

/** One path's answer before the mint: an allowing word with its authority and mode, or a refusal. */
type PathAnswer =
  | { readonly kind: 'allowed'; readonly word: MayActAllowWord; readonly mode: AllowMode; readonly authority: ActAuthority; readonly evidence: MayActEvidence }
  | { readonly kind: 'refused'; readonly word: MayActRefusal; readonly evidence: MayActEvidence };

/** The answers from least to most permissive (Table 11.7b): every refusal, `defer`, `staged`, then the two allows; and the
 *  modes `shadow` and `proposal` below `act` and `live`. */
export function mayActRank(a: { readonly kind: 'allowed'; readonly word: MayActAllowWord; readonly mode: AllowMode } | { readonly kind: 'refused' | 'ceiling'; readonly word?: string }): number {
  if (a.kind !== 'allowed') return a.word === 'defer' ? 1 : 0;
  const word = a.word === 'staged' ? 2 : 3;
  const mode = a.mode === 'shadow' || a.mode === 'proposal' ? 0 : 1;
  return word * 2 + mode;
}

/** Steps 4 to 16 over one path, first match (§6, with the arming read at step 7: slug `the-arming-is-read-before-the-blind-check`). */
function runPath(path: MayActPath, row: OverlordActRow, effRow: OverlordActRow | null, members: readonly ClassMember[],
  grant: GrantFact | null, facts: MayActFacts): PathAnswer {
  const no = (word: MayActRefusal, step: MayActStep, read: string): PathAnswer => ({ kind: 'refused', word, evidence: ev(step, path, read) });
  const onGrant = path.cover === 'grant';
  const onCommand = path.cover === 'command';
  // 4. Identity (F11): the stronger of the act's least, the effect's and, on the grant path, the grant's.
  let need = row.leastStrength;
  if (effRow !== null) need = strongest(need, effRow.leastStrength);
  if (grant !== null) need = strongest(need, grant.leastStrength);
  if (!strengthAtLeast(facts.caller, need)) return no('identity-too-weak', 'identity', `the caller is ${facts.caller}, and the act needs ${need}`);
  // 5. Isolation, on the command and grant paths only (H28): `shared-user` refuses, an unread isolation is its own word.
  if (onGrant || onCommand) {
    const iso = facts.isolation;
    if (iso.kind === 'unmeasured') return no('unmeasured', 'isolation', `the isolation read is unmeasured: ${iso.why}`);
    if (iso.word === 'shared-user') return no('server-not-isolated', 'isolation', `the server is shared-user (${iso.cause})`);
  }
  // 6. The cell (F4): under `by-grant` only the grant and command paths go on.
  if (facts.cell === 'by-grant' && !onGrant && !onCommand) return no('operator-only', 'cell', `the cell is by-grant, and the path is ${path.cover}`);
  // 7. The arming, under `armed`: an unread arming refuses here, before the blind check can defer, because a refusal after a
  //    `defer` would let a clearer blind check lower the answer (monotonicity).
  const armedLive = facts.armedLive;
  if (facts.cell === 'armed' && armedLive === 'unmeasured') return no('unmeasured', 'arming', 'whether the kind is armed is unmeasured');
  // 16. The mode of every allow below: `armed` live or shadow, `proposal` staged as a proposal, otherwise act.
  const mint = (word: MayActAllowWord, step: MayActStep, authority: ActAuthority, read: string): PathAnswer => {
    const cell = facts.cell;
    if (cell === 'armed') return { kind: 'allowed', word, mode: armedLive === true ? 'live' : 'shadow', authority, evidence: ev(step, path, read) };
    if (cell === 'proposal') return { kind: 'allowed', word: 'staged', mode: 'proposal', authority, evidence: ev(step, path, read) };
    return { kind: 'allowed', word, mode: 'act', authority, evidence: ev(step, path, read) };
  };
  // 8. A command: allow, the command spent by the door's transaction.
  if (path.cover === 'command') return mint('allow', 'command', { kind: 'command', id: path.id }, `command ${path.id} covers every member`);
  // 9. Not an answer, decided from the row (F2), by class none or a request: allow.
  if (!row.answer && path.cover === 'none') return mint('allow', 'not-an-answer', { kind: 'none', id: null }, 'class none, and not an answer');
  if (!row.answer && path.cover === 'operator-request') {
    return mint('allow', 'not-an-answer', { kind: 'request', id: path.id }, `request ${path.id} covers every member, and it is not an answer`);
  }
  // 10. Evidence, for an answer or the grant path. An answer with no verdicts gathered is an unread fact.
  const a = facts.answer;
  if (row.answer || onGrant) {
    if (a.kind === 'not-an-answer') {
      if (row.answer) return no('unmeasured', 'evidence', "the answer's verdicts were not gathered");
      return no('evidence-too-weak', 'evidence', 'the grant path needs evidence, and the act carries no answer facts');
    }
    if (a.evidence === 'unmeasured') return no('unmeasured', 'evidence', 'the evidence verdict is unmeasured');
    if (a.evidence !== 'enough') return no('evidence-too-weak', 'evidence', `the evidence is ${a.evidence}`);
  }
  // 11. askOrAct, for an answer.
  if (row.answer && a.kind === 'answer') {
    if (a.askOrAct === 'unmeasured') return no('unmeasured', 'ask-or-act', 'askOrAct is unmeasured');
    if (a.askOrAct !== 'act') return no('ask-is-cheaper', 'ask-or-act', `askOrAct says ${a.askOrAct}`);
  }
  // 12. By class none, an entry or a request: allow.
  if (path.cover === 'none') return mint('allow', 'by-cover', { kind: 'none', id: null }, 'class none');
  if (path.cover === 'stated-entry') return mint('allow', 'by-cover', { kind: 'entry', id: path.id }, `entry ${path.id} covers every member`);
  if (path.cover === 'operator-request') return mint('allow', 'by-cover', { kind: 'request', id: path.id }, `request ${path.id} covers every member`);
  // 13. The blind check, by grant: armed and not a clear yes (a check in shadow included) defers.
  if (a.kind === 'answer' && (a.blindCheck === 'not-clear' || a.blindCheck === 'shadow')) {
    return no('defer', 'blind-check', `the blind check is ${a.blindCheck}`);
  }
  const authority: ActAuthority = { kind: 'grant', id: path.id };
  // 14. Staging: an O3 member under a caller of strength `attributed`.
  if (members.some((m) => m.member === 'O3') && facts.caller === 'attributed') {
    return mint('staged', 'staging', authority, `an O3 member under an ${facts.caller} caller, by grant ${path.id}`);
  }
  // 15. Otherwise allow by grant.
  return mint('allow-by-grant', 'by-grant', authority, `grant ${path.id} covers every member`);
}

// --------------------------------------------------------------------------------------------------------- the decider

/** H24's decider (§6), with a trailing row lookup so a test can run it over synthetic rows (F11). */
export function overlordMayAct(act: OverlordActKind, effect: string | null, target: ActTarget, grants: readonly GrantFact[],
  facts: MayActFacts, now: number, lookup: ActRowLookup = actRow): MayActAnswer {
  const row = lookup(act);
  // 1. What it may carry (F1).
  const carry = mayCarryRefusal(row, effect, lookup);
  if (carry !== null || row === null) return refused('operator-only', ev('may-carry', null, carry ?? ''));
  const effRow = effect === null ? null : lookup(effect);
  // 2. The effect's ceiling (F9).
  const ec = facts.effectCeiling;
  if (ec === 'not-asked') {
    if (effRow !== null && effRow.ceiling.kind === 'counted') {
      return { kind: 'ceiling', verdict: { pass: false, word: 'unavailable', group: effRow.ceiling.group, why: "the effect's ceiling was not asked", latch: null },
        evidence: ev('effect-ceiling', null, "the effect's ceiling was not asked") };
    }
  } else if (!ec.pass) {
    return { kind: 'ceiling', verdict: ec, evidence: ev('effect-ceiling', null, `the ceiling verdict refused: ${ec.word} in ${ec.group}`) };
  }
  // 3. The effective class and its covers (F1).
  const members = effectiveClasses(act, effect, lookup);
  const rowOf = (m: ClassMember): OverlordActRow => (m.from === 'act' ? row : effRow!);
  let paths: { readonly path: MayActPath; readonly grant: GrantFact | null }[];
  let unread: string | null = null;
  if (members.length === 0) paths = [{ path: { cover: 'none' }, grant: null }];
  else {
    const vs = coverVerdicts(act, effect, members, rowOf, target, grants, facts, now);
    unread = vs.map((v) => (v.verdict.kind === 'unmeasured' ? v.verdict.fact : null)).find((f) => f !== null) ?? null;
    paths = vs.filter((v) => v.verdict.kind === 'covers')
      .map((v) => ({ path: v.path, grant: v.path.cover === 'grant' ? grants.find((g) => g.id === (v.path as { id: number }).id)! : null }));
    if (paths.length === 0) {
      const named = members.map((m) => m.member).join(', ');
      return unread !== null ? refused('unmeasured', ev('covers', null, `${unread} is unmeasured`))
        : refused('operator-only', ev('covers', null, `no cover covers every member (${named})`));
    }
  }
  // 4 to 16 over each path; the best answers (slug `the-best-cover-answers`).
  let best: PathAnswer | null = null;
  for (const p of paths) {
    const r = runPath(p.path, row, effRow, members, p.grant, facts);
    if (best === null || mayActRank(r) > mayActRank(best)) best = r;
  }
  const b = best!;
  if (b.kind === 'refused') {
    // A cover whose fact was not read might have allowed: a plain refusal names that fact (the coordinator's item 5). A `defer`
    // stands, because it ranks above `unmeasured` and removing the unread cover would raise the answer back to it.
    return unread !== null && b.word !== 'defer' ? refused('unmeasured', ev('covers', null, `${unread} is unmeasured`)) : refused(b.word, b.evidence);
  }
  const p = target.programme;
  return { kind: 'allowed', evidence: b.evidence, allow: mintMayActAllow({
    word: b.word, mode: b.mode, authority: b.authority, act, effect: effect as OverlordActKind | null,
    target: { programme: p === null ? null : p.id, incarnation: p === null ? null : p.incarnation },
    naturalKey: facts.naturalKey, cell: facts.cell, generation: facts.generation,
  }) };
}
