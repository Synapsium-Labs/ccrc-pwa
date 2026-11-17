// The Overlord's designation deciders (Overlord W1, designation A, plan Task 2; spec §3.1, §3.4 C46 and C56). Ring L1,
// context C5: pure decisions over facts the door gathers. It imports L0 and `poolrule.ts` (L1) only, makes no I/O and
// reads no clock (`nowS` rides in the facts). `designateVerdict` (Start the Overlord's refusals, in order, and the one
// create it allows), `overlordAccounts` (C56's ordered account list and the count that gates it), `retireVerdict` (what a
// retire does to the row it reads), and the Settings doors' (designation C): `modelClassVerdict`, `setWidens` and
// `accountSetVerdict`, with the step-up each door asks.
import type { BuildAgreement } from '../../../shared/api.js';
import { DESIGNATE_CCD_WORDS, DESIGNATE_SERVER_WORDS } from '../../../shared/overlord-designation.js';
import type { DesignationRead, DesignationView, OverlordModelClass } from '../../../shared/overlord-designation.js';
import { orgSpread, type OrgSpread } from '../../../shared/accountOrg.js';
import type { ProjectedHome } from '../../../shared/api.js';
import { poolSetSpelling } from '../../../shared/poolset.js';
import type { PoolSet } from '../../../shared/poolset.js';
import type { Roster } from '../../../shared/roster.js';
import { poolRule } from '../../../shared/poolrule.js';
import { serviceability } from '../../../shared/serviceability.js';
import type { LaneFacts } from '../../../shared/serviceability.js';
import type { AccountLimits } from '../limits.js';
import { parsePoolAnswer, poolRostered, resolvedAccountPool } from '../poolrule.js';

/** The ccd words the create itself needs, past `DESIGNATE_CCD_WORDS`' first five, are in that list already (the eight). */
export interface AccountFacts {
  readonly roster: Roster; readonly limits: Readonly<Record<string, AccountLimits>>;
  readonly edges: ReadonlyMap<string, readonly string[]>;
  /** One entry per roster account, built by the door with `limits.ts#laneFactsOf`; a missing entry is unmeasured. */
  readonly lanes: Readonly<Record<string, LaneFacts>>;
  readonly nowS: number;
}

export interface DesignateFacts {
  readonly read: DesignationRead;
  readonly ccdWords: readonly string[] | null;          // the fleet state's `ccdVerbs`; null is no evidence
  readonly serverWords: readonly string[];               // `SERVER_CAPS`
  readonly builds: BuildAgreement;
  readonly probe: ReturnType<typeof parsePoolAnswer>;    // asked of the id the door minted (plan question 2)
  readonly model: OverlordModelClass; readonly accountPools: PoolSet;
  readonly accounts: AccountFacts;
  /** The door's `projectHome(…, { state: 'set', set }, …)`; `null` is no lane placeable, and the pick falls back. */
  readonly home: ProjectedHome | null;
}

/** The kebab words this decider and its store (`overlordDesignationStore.ts`) spell as literals that are no wire refusal:
 *  the verdicts' acts, the store's answers, the body adapter's ccd verbs, and the words of the reads they take (`PoolAnswerRead`'s `not-run`, the set
 *  side's `set-side`, ccd's `pool-set` word, `DesignationRead`'s `not-designated`, the read door's `unknown-pool` warning and the create door's attempt outcome `create-failed` and the first prompt's `INJECTED_PROMPTS` key). The mail-routes kebab census admits
 *  them through `isDesignationKebab`; a refusal the door answers is `OVERLORD_REFUSALS`' and admitted there. */
export const DESIGNATION_KEBABS = ['refuse-input', 'retire-live', 'cancel-pending', 'not-designated', 'not-pending',
  'generation-set', 'bad-outcome', 'not-run', 'set-side', 'pool-set', 'unknown-pool', 'create-failed', 'overlord-first-prompt',
  // the body adapter's ccd verbs and the `ws-add` refusal words it reads (`overlordBody.ts`, `workspaceCreate.ts#classifyAddFailure`)
  'project-add', 'ws-add', 'keep-awake', 'account-refused', 'slug-taken', 'bad-slug',
  // the Settings doors (designation C): the gate's own refusal word the set decider re-asks, and the set door's op-key stem
  'step-up-required', 'account-set'] as const;
export const isDesignationKebab = (w: string): boolean => (DESIGNATION_KEBABS as readonly string[]).includes(w);

export type DesignateVerdict =
  | { readonly act: 'refuse'; readonly word: 'overlord-exists' | 'capability-missing' | 'launch-profile-unmet'
      | 'overlord-single-account'; readonly detail: string;
      readonly needs?: readonly string[]; readonly count?: number }
  | { readonly act: 'refuse-input'; readonly why: 'unspellable' }
  | { readonly act: 'unmeasured'; readonly why: string }
  | { readonly act: 'create'; readonly wrapper: string; readonly acctorder: string; readonly poolset: string };

/** C56's list: every enabled Anthropic account the set admits, in the set's pool order, roster order within a pool,
 *  untagged accounts after every pool (only when the set admits them). `counted` are those not signed out and servable
 *  for the class now; `unmeasured` are those whose servability nothing has measured. An unmeasured account is in the
 *  list, never in `counted`, and never folded into "unservable": a count that could pass on it must refuse instead. No
 *  pay-per-use or other-provider lane is listed until an operator-lists-it fact exists (review F10, ruled). The list
 *  orders and never admits: every member passes `poolRule` under the set. */
export function overlordAccounts(set: PoolSet, cls: OverlordModelClass, f: AccountFacts): {
  readonly list: readonly string[]; readonly counted: readonly string[]; readonly unmeasured: readonly string[];
} {
  const side = { state: 'set', set } as const;
  const ranked: { id: string; rank: number; at: number }[] = [];
  f.roster.accounts.forEach((a, at) => {
    if (f.limits[a.id]?.disabled === true) return;
    // ccd's `--wrapper` refuses a lane that is not home-able, so it is neither counted nor picked (review 2349 F5).
    if (!a.homeAble) return;
    // An Anthropic account only: an API-key lane (pay-per-use) and another provider's lane are left out; an undeclared
    // provider is not known to be Anthropic, so it is left out too. The provider is `exec.provider`, and `upstream` is
    // Anthropic by construction (`shared/roster.ts#rosterKindOf`'s rule; that function has one caller by a census pin, so
    // this reads the same field rather than calling it).
    const provider = a.exec.kind === 'upstream' ? 'anthropic' : a.exec.provider;
    if (provider !== 'anthropic') return;
    const pool = resolvedAccountPool(a.id, a, f.edges);
    if (!poolRule(pool, side).ok) return;
    const named = pool.state === 'tagged' ? set.pools.findIndex((p) => pool.pools.includes(p)) : -1;
    ranked.push({ id: a.id, rank: named >= 0 ? named : set.pools.length, at });
  });
  ranked.sort((x, y) => x.rank - y.rank || x.at - y.at);
  const list = ranked.map((r) => r.id);
  const counted: string[] = [];
  const unmeasured: string[] = [];
  for (const id of list) {
    if (f.limits[id]?.authDead === true) continue;
    const lane = f.lanes[id];
    if (lane === undefined) { unmeasured.push(id); continue; }
    const s = serviceability(cls, lane, 'set-side', f.nowS);
    if (s.kind === 'servable') counted.push(id);
    else if (s.kind !== 'unservable') unmeasured.push(id);
  }
  return { list, counted, unmeasured };
}

const present = (words: readonly string[] | null, w: string): boolean => words !== null && words.includes(w);

/** Question 2: `answer`, or `refused` with code 1 (no such session), means the agent ran the verb. */
function probeRan(p: DesignateFacts['probe']): boolean {
  return p.kind === 'answer' || (p.kind === 'refused' && p.code === 1);
}

/** First refusal wins (plan Task 2, "The order"). */
export function designateVerdict(f: DesignateFacts): DesignateVerdict {
  // 0. a row this reader cannot narrow is never read as "none": the door answers 503 `unavailable`.
  // 1. a session is bound or pending.
  if (f.read.kind === 'unmeasured') {
    return { act: 'unmeasured', why: `the designation could not be read: ${f.read.why}` };
  }
  const row = f.read.kind === 'designated' ? f.read.row : f.read.row;
  if (f.read.kind === 'designated' || (row !== null && row.pending !== null)) {
    return { act: 'refuse', word: 'overlord-exists', detail: 'an Overlord is already designated or being started' };
  }
  // 2. every missing word, ccd's, then the server's, then the probe's.
  const needs: string[] = [];
  for (const w of DESIGNATE_CCD_WORDS) if (!present(f.ccdWords, w)) needs.push(w);
  for (const w of DESIGNATE_SERVER_WORDS) if (!f.serverWords.includes(w)) needs.push(w);
  let detail = '';
  if (!probeRan(f.probe)) {
    if (!needs.includes('pool-set')) needs.push('pool-set');
    if (f.probe.kind !== 'not-run') detail = "the agent's pool answer could not be read";
  }
  if (needs.length > 0) {
    return { act: 'refuse', word: 'capability-missing', detail: detail || `missing: ${needs.join(', ')}`, needs };
  }
  // 3. the builds the launch profile hashes against must agree.
  if (f.builds !== 'agreed') {
    return { act: 'refuse', word: 'launch-profile-unmet', detail: f.builds === 'skewed' ? 'skewed' : 'unmeasured' };
  }
  // 4. a set the grammar cannot spell is the caller's input error.
  const spelled = poolSetSpelling(f.accountPools);
  if (spelled.kind === 'unspellable') return { act: 'refuse-input', why: 'unspellable' };
  // 5. at least two counted accounts; an empty set counts zero.
  const { list, counted, unmeasured } = overlordAccounts(f.accountPools, f.model, f.accounts);
  if (counted.length < 2) {
    return {
      act: 'refuse', word: 'overlord-single-account', count: counted.length,
      detail: unmeasured.length > 0
        ? `${counted.length} counted account(s) and ${unmeasured.length} unmeasured: the count is unmeasured`
        : `${counted.length} counted account(s); the Overlord needs at least two`,
    };
  }
  // 6. the pick is always inside the counted list.
  const wrapper = f.home !== null && counted.includes(f.home.wrapper) ? f.home.wrapper : counted[0]!;
  // `empty` cannot reach here: it counts zero above.
  const poolset = spelled.kind === 'spelled' ? spelled.spelling : '';
  return { act: 'create', wrapper, acctorder: list.join(','), poolset };
}

/** What a retire does to the row it reads (plan question 8). */
export function retireVerdict(read: DesignationRead):
  | { readonly act: 'retire-live' } | { readonly act: 'cancel-pending' }
  | { readonly act: 'none' } | { readonly act: 'unmeasured' } {
  if (read.kind === 'unmeasured') return { act: 'unmeasured' };
  if (read.kind === 'designated') return { act: 'retire-live' };
  return read.row !== null && read.row.pending !== null ? { act: 'cancel-pending' } : { act: 'none' };
}

// ── the Settings doors (designation C, plan Tasks 8 and 9; spec §3.4 C45, C46, C56, §11.2) ──────────────────────────────

/** The bodies the row names: the live one, then a pending one. A Settings change writes the route record of each. */
const bodiesOf = (v: DesignationView): string[] =>
  [v.bound?.sessionId, v.pending?.sessionId].filter((x): x is string => x !== undefined);

/** C45, §11.2: the model door asks a step-up when the body selects `fable`, never for `opus`. */
export const modelStepUp = (model: OverlordModelClass): boolean => model === 'fable';

export type ModelClassVerdict =
  | { readonly act: 'unmeasured'; readonly why: string } | { readonly act: 'not-found' } | { readonly act: 'none' }
  | { readonly act: 'refuse'; readonly word: 'overlord-single-account'; readonly detail: string; readonly count: number }
  | { readonly act: 'set'; readonly bodies: readonly string[]; readonly warnings: readonly SingleAccountWarning[] };
export type SingleAccountWarning = { readonly warning: 'overlord-single-account'; readonly count: number };

/** Task 8: `none` when the class is unchanged; otherwise C56 is counted again under the NEW class (slug
 *  `model-door-recounts-c56`, the coordinator's ruling): a move to `fable` (a widening) with a body bound or pending and fewer
 *  than two accounts that serve it refuses, as the set door does, so a save never wedges every later set change. A move to
 *  `opus` narrows, and the operator can always narrow (review 2410 F2): below two it only warns, as a save with no body does.
 *  Else `set`, naming the bodies whose route record takes the class. */
export function modelClassVerdict(read: DesignationRead, model: OverlordModelClass, f: AccountFacts): ModelClassVerdict {
  if (read.kind === 'unmeasured') return { act: 'unmeasured', why: read.why };
  if (read.row === null) return { act: 'not-found' };
  if (read.row.model === model) return { act: 'none' };
  const bodies = bodiesOf(read.row);
  const serving = overlordAccounts(read.row.accountPools, model, f);
  const count = serving.counted.length;
  if (modelStepUp(model) && bodies.length > 0 && count <= 1) {
    return { act: 'refuse', word: 'overlord-single-account', count,
      detail: `${count} account(s) serve ${model} in the set and ${serving.unmeasured.length} unmeasured; the Overlord needs at least two` };
  }
  return { act: 'set', bodies, warnings: count <= 1 ? [{ warning: 'overlord-single-account', count }] : [] };
}

/** Both Settings doors' top-level `route` (review 2410 F1): `failed` when any body's route write failed, so no reader has to
 *  look inside `written` to learn a body was not rewritten; `written` otherwise, a row that binds nothing included. */
export const routeOf = (written: readonly { readonly ok: boolean }[]): 'written' | 'failed' =>
  (written.every((w) => w.ok) ? 'written' : 'failed');

/** C46: `next` adds a pool or turns `untagged` on. A narrowing and a pure reorder are not widenings. */
export function setWidens(old: PoolSet, next: PoolSet): boolean {
  return (next.untagged && !old.untagged) || next.pools.some((p) => !old.pools.includes(p));
}

/** The step-up the account set door asks, from the row read before the gate: a widening asks one, and a row that cannot be
 *  read asks one too (the door refuses it after the gate); with no row there is nothing to widen. */
export function accountSetStepUp(read: DesignationRead, next: PoolSet): boolean {
  if (read.kind === 'unmeasured') return true;
  return read.row !== null && setWidens(read.row.accountPools, next);
}

/** A warning the set door answers beside its save: never a refusal. */
export type AccountSetWarning =
  | { readonly warning: 'unknown-pool'; readonly pool: string } | SingleAccountWarning;

export type AccountSetVerdict =
  | { readonly act: 'unmeasured'; readonly why: string } | { readonly act: 'not-found' }
  | { readonly act: 'refuse-input'; readonly why: 'unspellable' }
  | { readonly act: 'refuse'; readonly word: 'overlord-single-account' | 'step-up-required'; readonly detail: string; readonly count?: number }
  | { readonly act: 'none' | 'set'; readonly bodies: readonly string[]; readonly poolset: string; readonly acctorder: string;
      readonly accounts: ReturnType<typeof overlordAccounts>; readonly warnings: readonly AccountSetWarning[];
      readonly orgSpread: OrgSpread };

/** Task 9, in order: no row; an unspellable set; a widening the gate was not asked to step up (re-read on the serialiser, so a
 *  set that changed after the door asked the gate cannot widen without one); fewer than two counted accounts while a body is
 *  bound or pending (with no body the set is saved for the next Start, and the count only warns, as it does for the same set
 *  re-sent); then `none` for the same set in the same order, or `set` with the spelling, the list in the set's order, the warnings and the organization spread of the
 *  counted accounts (K2a; `unmeasured` when any listed account's servability is, so a partial figure says nothing). */
export function accountSetVerdict(read: DesignationRead, next: PoolSet, f: AccountFacts, stepped: boolean): AccountSetVerdict {
  if (read.kind === 'unmeasured') return { act: 'unmeasured', why: read.why };
  const row = read.row;
  if (row === null) return { act: 'not-found' };
  const spelling = poolSetSpelling(next);
  if (spelling.kind === 'unspellable') return { act: 'refuse-input', why: 'unspellable' };
  if (!stepped && setWidens(row.accountPools, next)) {
    return { act: 'refuse', word: 'step-up-required', detail: 'the account set widens, and a widening needs a step-up' };
  }
  const accounts = overlordAccounts(next, row.model, f);
  const count = accounts.counted.length;
  const bodies = bodiesOf(row);
  const warnings: AccountSetWarning[] = next.pools.filter((p) => !poolRostered(f.roster, p)).map((pool) => ({ warning: 'unknown-pool', pool }));
  const same = row.accountPools.untagged === next.untagged && row.accountPools.pools.join('\n') === next.pools.join('\n');
  if (count <= 1) {
    if (bodies.length > 0 && !same) {
      return { act: 'refuse', word: 'overlord-single-account', count,
        detail: `${count} counted account(s) and ${accounts.unmeasured.length} unmeasured; the Overlord needs at least two` };
    }
    warnings.push({ warning: 'overlord-single-account', count });
  }
  const org = new Map(f.roster.accounts.map((a) => [a.id, a.org]));
  const orgs = orgSpread(accounts.unmeasured.length > 0 ? 'unmeasured' : accounts.counted.map((id) => org.get(id) ?? null));
  return { act: same ? 'none' : 'set', bodies, poolset: spelling.kind === 'spelled' ? spelling.spelling : '',
    acctorder: [...accounts.list].join(','), accounts, warnings, orgSpread: orgs };
}
