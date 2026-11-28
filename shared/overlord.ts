// The Overlord's act catalogue (Overlord spec 2026-11-09 §7.1 C25 and H24, Table 7.1a; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`). Ring L0, context K: one row per act kind the Overlord
// can take, read by the ladder's `rungStep` (each row's `rungs`), and by every later decider that answers for an act. It
// imports only sibling `shared/` files, by type, and nothing at run time, because the PWA bundles this file. Every union is the
// key set of a const map, and each map has a runtime list beside it.
//
// An act missing from this table cannot be performed by any Overlord door (§7.1). Its rows are Table 7.1a's, with
// `escalate-request` (the W2 index's question 7), the three rows completed from D-8126 §3 and the SAFETY list
// (`live-box-act`, `account-management`, `accept-limit`; plan question 5) and the Overlord's team link (D-8809). A timer is no
// act kind (§3.3.12), so no row names one.
import type { Rung } from './overlord-ladder.js';
import type { CallerStrength, VerbClass } from './overlord-identity.js';

/** The five rung cell words (plan question 6). `rungStep` refuses only `refuse`; every other word passes and names its mode,
 *  which the decider of an act reads and binds into its allow. */
const RUNG_CELL_WORD_MAP = {
  allow: 'allowed at this rung',
  refuse: 'refused at this rung',
  proposal: 'staged for one tap',
  armed: 'allowed when the kind is armed, shadow while it is not',
  'by-grant': 'allowed only by a grant or a command',
} as const;
export type RungCellWord = keyof typeof RUNG_CELL_WORD_MAP;
export const RUNG_CELL_WORDS = Object.keys(RUNG_CELL_WORD_MAP) as RungCellWord[];
export function isRungCellWord(v: unknown): v is RungCellWord {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RUNG_CELL_WORD_MAP, v);
}
/** A row's cells: one word at each rung but `off`, which has no cell (§11.2). */
export type RungCells = Readonly<Record<Exclude<Rung, 'off'>, RungCellWord>>;

/** D-8126 §3's classes (O1 to O6). A row's set is empty for class none. `unknown` is a class this build does not know: never
 *  none (R1), and never covered (Table 4b). */
const OVERLORD_CLASS_MAP = {
  O1: 'irreversible or outward-facing',
  O2: 'spend beyond plan',
  O3: "the programme's goals, scope or definition of done",
  O4: 'credentials and access',
  O5: 'a fact only the operator holds',
  O6: 'overriding a person',
  unknown: 'a class this build does not know',
} as const;
export type OverlordClass = keyof typeof OVERLORD_CLASS_MAP;
export const OVERLORD_CLASSES = Object.keys(OVERLORD_CLASS_MAP) as OverlordClass[];

/** §10.1's words. `n/a` is a read's. */
const REVERSIBILITY_MAP = {
  'n/a': 'a read changes nothing',
  reversible: 'undone with nothing lost',
  compensable: 'undone only by a compensating act',
  irreversible: 'cannot be undone',
} as const;
export type Reversibility = keyof typeof REVERSIBILITY_MAP;
export const REVERSIBILITIES = Object.keys(REVERSIBILITY_MAP) as Reversibility[];

/** What can cover a classed member (§7.1, §7.2, C12). Table 7.1a's Grant column is `grant`'s presence. */
const COVER_KIND_MAP = {
  grant: 'a live grant in scope (§7.2)',
  command: "the operator's live command on this proposal",
  'operator-request': "an operator request whose cited words name the programme or project (C12)",
  'stated-entry': 'a cited stated entry resting on an operator message (§7.1, `state-a-fact` only)',
} as const;
export type CoverKind = keyof typeof COVER_KIND_MAP;
export const COVER_KINDS = Object.keys(COVER_KIND_MAP) as CoverKind[];

/** Table 4b: the covers a member of each class can ever take (review 2271 F1). A member is covered only by a cover in both
 *  this list and its row's `covers`. */
export const CLASS_COVERS: Readonly<Record<OverlordClass, readonly CoverKind[]>> = {
  O1: [], O2: [], O3: ['grant', 'command', 'operator-request'], O4: [], O5: ['stated-entry'], O6: [], unknown: [],
};

/** The compensating acts, each with the door that performs it (§10.3). `operator-relink` is the operator's own write of a
 *  project's team, which overturns the Overlord's team link (the linear hierarchy spec §3.1, item 5; slug
 *  `team-link-compensated-by-the-operators-relink`). */
const COMPENSATOR_MAP = {
  'correction-mail': { door: 'POST /api/digest/correct' },
  'new-request': { door: 'POST /api/overlord/requests' },
  'end-programme': { door: 'POST /api/sessions/:id/archive' },
  'operator-relink': { door: 'POST /api/projects/:project/linking' },
} as const;
export type Compensator = keyof typeof COMPENSATOR_MAP;
export const COMPENSATORS = Object.keys(COMPENSATOR_MAP) as Compensator[];
export function compensatorDoor(c: Compensator): string { return COMPENSATOR_MAP[c].door; }

/** The ceiling groups (the plan's Table 5, question 19 as proposed, approved by the coordinator): each act kind of a group
 *  counts against one count, per programme and in all, over a rolling hour of wall time. A `null` per-programme value is a
 *  group with no per-programme ceiling, never a ceiling of zero. Starting values of Table 11.5b, re-fitted after a week. */
const CEILING_GROUP_MAP = {
  relay: { perProgramme: 6, all: 30 },
  request: { perProgramme: 6, all: 30 },
  brief: { perProgramme: 6, all: 30 },
  'operator-reach': { perProgramme: 3, all: 10 },
  proposal: { perProgramme: 1, all: 6 },
  answer: { perProgramme: 6, all: 30 },
  'o3-effect': { perProgramme: 1, all: 3 },
  fact: { perProgramme: 3, all: 10 },
  start: { perProgramme: 1, all: 2 },
  rekick: { perProgramme: 1, all: 3 },
  'own-record': { perProgramme: null, all: 60 },
} as const satisfies Readonly<Record<string, { readonly perProgramme: number | null; readonly all: number }>>;
export type CeilingGroup = keyof typeof CEILING_GROUP_MAP;
export const CEILING_GROUPS = Object.keys(CEILING_GROUP_MAP) as CeilingGroup[];
export const ACT_CEILINGS: Readonly<Record<CeilingGroup, { readonly perProgramme: number | null; readonly all: number }>> = CEILING_GROUP_MAP;
/** A rolling hour of wall time (Table 11.5b). */
export const ACT_CEILING_WINDOW_MS = 3_600_000;

/** A row's ceiling (§7.5, plan §5): counted in a group; held by an owner that already bounds the kind, so no count is asked
 *  (plan question 2); or `never`, a kind refused at every rung, so no count is ever asked. */
export type CeilingCell =
  | { readonly kind: 'counted'; readonly group: CeilingGroup }
  | { readonly kind: 'held-by'; readonly owner: string }
  | { readonly kind: 'never' };
const CEILING_CELL_KIND_MAP = { counted: true, 'held-by': true, never: true } as const satisfies Record<CeilingCell['kind'], true>;
export const CEILING_CELL_KINDS = Object.keys(CEILING_CELL_KIND_MAP) as CeilingCell['kind'][];

/** One catalogue row (Table 4a). `classes` holds only known classes; a carrier's own are its effect's, so it holds none. */
export interface OverlordActRow {
  readonly what: string;
  readonly actor: 'overlord' | 'server';
  readonly classes: readonly Exclude<OverlordClass, 'unknown'>[];
  /** It answers a held question, so evidence and `askOrAct` apply (review 2271 F2). */
  readonly answer: boolean;
  /** It carries its question's fixed effect, whose class and reversibility are its own (F2). */
  readonly carrier: boolean;
  /** The effects it may carry: its question's (a carrier), the kinds listed, or none (F1). */
  readonly mayCarry: 'question-effect' | readonly string[];
  readonly reversibility: Reversibility;
  readonly covers: readonly CoverKind[];
  readonly verbClass: VerbClass;
  readonly compensator: Compensator | null;
  readonly ceiling: CeilingCell;
  readonly leastStrength: CallerStrength;
  readonly rungs: RungCells;
}

const ALL: RungCells = { chat: 'allow', advise: 'allow', full: 'allow' };
const ADVISE_UP: RungCells = { chat: 'refuse', advise: 'allow', full: 'allow' };
const PROPOSE_THEN_ALLOW: RungCells = { chat: 'refuse', advise: 'proposal', full: 'allow' };
const FULL_ONLY: RungCells = { chat: 'refuse', advise: 'refuse', full: 'allow' };
const FULL_ARMED: RungCells = { chat: 'refuse', advise: 'refuse', full: 'armed' };
const FULL_BY_GRANT: RungCells = { chat: 'refuse', advise: 'refuse', full: 'by-grant' };
const NEVER: RungCells = { chat: 'refuse', advise: 'refuse', full: 'refuse' };

type RowIn = Pick<OverlordActRow, 'what' | 'reversibility' | 'rungs' | 'ceiling'> & Partial<OverlordActRow>;
/** A row with Table 4a's defaults: the Overlord's, class none, no answer, carrying nothing, no cover, `operate`, no
 *  compensator, `attributed`. Every row below names what differs, and its ceiling. */
const row = (r: RowIn): OverlordActRow => ({
  actor: 'overlord', classes: [], answer: false, carrier: false, mayCarry: [], covers: [], verbClass: 'operate',
  compensator: null, leastStrength: 'attributed', ...r,
});
const counted = (group: CeilingGroup): CeilingCell => ({ kind: 'counted', group });
const heldBy = (owner: string): CeilingCell => ({ kind: 'held-by', owner });
/** A row refused at every rung: no cover, the operator's strength (plan Table 4) and the ceiling `never` (§5, F7). */
const refused = (what: string, classes: OverlordActRow['classes'], reversibility: Reversibility): OverlordActRow =>
  row({ what, classes, reversibility, rungs: NEVER, leastStrength: 'operator', ceiling: { kind: 'never' } });
const ownRecord = (what: string, ceiling: CeilingCell): OverlordActRow => row({ what, reversibility: 'reversible', rungs: ALL, ceiling });
const routeOrPropose = (what: string, group: CeilingGroup): OverlordActRow =>
  row({ what, reversibility: 'reversible', rungs: ADVISE_UP, ceiling: counted(group) });

/** Table 4 of the plan, which is Table 7.1a with the plan's completions; each row's ceiling is the plan's Tables 5 and 6. */
const OVERLORD_ACT_KIND_MAP = {
  read: row({ what: "Read the server's rows through the door process", reversibility: 'n/a', verbClass: 'view', rungs: ALL,
    ceiling: heldBy('the read ceilings, per door (Table 11.5b; the inbox piece\'s read-ceiling)') }),
  'write-note': ownRecord('Keep its own records: a note', heldBy('the notes cap, 200 notes of 500 characters for one identity (shared/continuity.ts#NOTES_CAP)')),
  // The W2 index's wording of the acknowledge cell (Table W2, ruled, fold; slug acknowledge-cell-reads-the-index).
  acknowledge: ownRecord("Keep its own records: acknowledge an operator message, a held delivery to the role or a band-3 request row",
    heldBy('its targets: one acknowledgement for each operator message, each held delivery to the role and each band-3 request row')),
  'open-request': ownRecord('Keep its own records: open a request, citing an operator message or none', counted('own-record')),
  'model-write': ownRecord('Keep its own records: propose or change an entry of the operator model', counted('own-record')),
  'seal-prediction': ownRecord('Keep its own records: seal a prediction with its brief', counted('own-record')),
  relay: row({ what: 'Route a request to the coordinator that owns it', reversibility: 'compensable', mayCarry: ['widen-scope'],
    compensator: 'correction-mail', rungs: ADVISE_UP, ceiling: counted('relay') }),
  'drop-request': row({ what: 'Drop a request', reversibility: 'compensable', compensator: 'new-request', rungs: ADVISE_UP,
    ceiling: counted('request') }),
  'close-request': routeOrPropose('Close a request', 'request'),
  'escalate-request': routeOrPropose("Move a request to the operator (`needs-you`)", 'request'),
  'attach-brief': routeOrPropose("Attach a brief to a coordinator's item", 'brief'),
  escalate: routeOrPropose('Escalate to the operator', 'operator-reach'),
  'return-over-asked': routeOrPropose('Return an over-asked question to its coordinator', 'operator-reach'),
  object: routeOrPropose('Object to a call made in the operator\'s name', 'operator-reach'),
  'propose-grant': routeOrPropose('Propose a grant to the operator', 'proposal'),
  'propose-command': routeOrPropose('Propose a command to the operator', 'proposal'),
  'propose-retire': routeOrPropose('Propose retiring a programme to the operator', 'proposal'),
  'propose-practice': routeOrPropose('Propose a practice to the operator', 'proposal'),
  // Index question 21: a nudge counts against the relay's ceilings.
  'nudge-owner': routeOrPropose('Mail the owner of a routed request a follow-up, through the relay door', 'relay'),
  'raise-item': routeOrPropose('Raise an operator item of its own, with a brief, keyed by its subject', 'operator-reach'),
  'answer-item': row({ what: 'Answer a held item with an option', answer: true, carrier: true, mayCarry: 'question-effect',
    reversibility: 'compensable', compensator: 'correction-mail', rungs: FULL_ARMED, ceiling: counted('answer') }),
  'answer-ask': row({ what: "Answer a held ask with an option", answer: true, carrier: true, mayCarry: 'question-effect',
    reversibility: 'compensable', compensator: 'correction-mail', rungs: FULL_ARMED, ceiling: counted('answer') }),
  'start-programme': row({ what: 'Start a coordinator in a named workspace', classes: ['O3'], reversibility: 'compensable',
    covers: ['operator-request', 'command'], compensator: 'end-programme', rungs: PROPOSE_THEN_ALLOW, ceiling: counted('start') }),
  'rekick-coordinator': row({ what: 'Re-kick a coordinator as the same session', reversibility: 'compensable',
    compensator: 'correction-mail', rungs: PROPOSE_THEN_ALLOW, ceiling: counted('rekick') }),
  'approve-spec': row({ what: 'Approve a spec', classes: ['O3'], reversibility: 'compensable', covers: ['grant', 'command'],
    compensator: 'correction-mail', rungs: FULL_BY_GRANT, ceiling: counted('o3-effect') }),
  'approve-dod': row({ what: 'Approve or change a definition of done', classes: ['O3'], reversibility: 'compensable',
    covers: ['grant', 'command'], compensator: 'correction-mail', rungs: FULL_BY_GRANT, ceiling: counted('o3-effect') }),
  'widen-scope': row({ what: "Widen a programme's scope", classes: ['O3'], reversibility: 'compensable',
    covers: ['grant', 'command', 'operator-request'], compensator: 'correction-mail', rungs: FULL_BY_GRANT, ceiling: counted('o3-effect') }),
  'state-a-fact': row({ what: 'Answer a value item: a fact only the operator holds', classes: ['O5'], answer: true,
    reversibility: 'compensable', covers: ['stated-entry'], compensator: 'correction-mail', rungs: FULL_ONLY, ceiling: counted('fact') }),
  'accept-limit': refused('Drop or cut a definition-of-done item, or accept a known limit that leaves one unmet', ['O3'], 'compensable'),
  'message-people': refused('Comment where other people take part', ['O1'], 'irreversible'),
  publish: refused('Make public or release', ['O1'], 'irreversible'),
  deploy: refused('Roll the fleet', ['O1'], 'compensable'),
  // The verbs the SAFETY list forbids to sessions, named in prose only: the approval guard's forbidden verbs
  // (`server/src/coord/approvalguard.ts#FORBIDDEN_CCD_VERBS`) and the fleet limit watchdog's two, which that list does not
  // hold (the act classes suite scans both); touching tmux, units or the registries, updating, rolling back or rolling out a
  // build, history writes, and writing live box config, arming markers included.
  'live-box-act': refused('Act on a live box: a verb the SAFETY list forbids, its units, panes or registries, a build, a history write or its config', ['O1'], 'irreversible'),
  'account-management': refused('Manage accounts and their sign-ins', ['O1', 'O4'], 'irreversible'),
  spend: refused('Spend: credits, paid services and accounts', ['O2'], 'irreversible'),
  'secret-or-access': refused('Secrets, sign-ins and access', ['O4'], 'irreversible'),
  'reassign-programme': refused('Hand a programme to another session', ['O4'], 'irreversible'),
  'override-a-person': refused("Ignore a reviewer's requested change, or another person's ruling", ['O6'], 'irreversible'),
  renew: row({ what: 'End the conversation and start a fresh one', actor: 'server', reversibility: 'reversible', rungs: ALL,
    ceiling: heldBy("the renewal's hold-off and restart bounds (Table 11.5b, the W1a rows)") }),
  // D-8809 and the coordinator's ruling (call 1816): the Overlord confirms one team candidate for a project, its own call in the
  // operator's name, which the operator overturns with their own write. Class none; at `full` only; its bound is the linking
  // rule's, so step 10 asks no count for it.
  'link-team': row({ what: "Confirm one team candidate for a project with no key, as a call made in the operator's name",
    reversibility: 'compensable', compensator: 'operator-relink', rungs: FULL_ONLY,
    ceiling: heldBy('the linking rule: one link for a project with no stored key and no operator decision (autoLinkAllowed)') }),
} as const satisfies Readonly<Record<string, OverlordActRow>>;
export type OverlordActKind = keyof typeof OVERLORD_ACT_KIND_MAP;
export const OVERLORD_ACT_KINDS: Readonly<Record<OverlordActKind, OverlordActRow>> = OVERLORD_ACT_KIND_MAP;
export const OVERLORD_ACT_KIND_LIST = Object.keys(OVERLORD_ACT_KIND_MAP) as OverlordActKind[];
export function isOverlordActKind(v: unknown): v is OverlordActKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(OVERLORD_ACT_KIND_MAP, v);
}

/** A row by its kind, as a stored string: `null` for a kind this build lacks. A test passes its own over synthetic rows. */
export type ActRowLookup = (kind: string) => OverlordActRow | null;
export const actRow: ActRowLookup = (kind) => (isOverlordActKind(kind) ? OVERLORD_ACT_KIND_MAP[kind] : null);

/** One class member and the row it comes from. */
export interface ClassMember { readonly member: OverlordClass; readonly from: 'act' | 'effect' }
/** Each member with the row it comes from (F1). A carrier's own classes are its effect's, so its row adds none; an effect the
 *  lookup lacks adds `unknown`, and an act the lookup lacks is `unknown` itself; a `null` effect adds nothing. */
export function effectiveClasses(act: string, effect: string | null, lookup: ActRowLookup = actRow): readonly ClassMember[] {
  const a = lookup(act);
  const out: ClassMember[] = a === null ? [{ member: 'unknown', from: 'act' }]
    : a.carrier ? [] : a.classes.map((member) => ({ member, from: 'act' as const }));
  if (effect === null) return out;
  const e = lookup(effect);
  if (e === null) return [...out, { member: 'unknown', from: 'effect' }];
  return [...out, ...e.classes.map((member) => ({ member, from: 'effect' as const }))];
}

// ------------------------------------------------------------------------------------ what `overlordMayAct` answers (PR B)

/** `overlordMayAct`'s answer words (H24, plan Task B1): the plan's nine, and `unmeasured`, a fact the decider needed and could
 *  not read (the coordinator's item 5), which is never an allow and never another refusal's word. `allows` marks the three
 *  that mint an allow. The ceiling's `act-ceiling` and `unavailable` are the ceiling verdict's own words, passed through. */
const MAY_ACT_ANSWER_MAP = {
  allow: { allows: true, what: 'allowed: by class none, a command, an operator request or a stated entry' },
  'allow-by-grant': { allows: true, what: 'allowed by a live grant in scope' },
  staged: { allows: true, what: 'staged: a proposal for one tap, or an O3 effect under attribution kept for its veto window' },
  defer: { allows: false, what: 'the blind check is not a clear yes, so the matter goes to the operator' },
  'ask-is-cheaper': { allows: false, what: 'askOrAct says asking costs less than a wrong act' },
  'evidence-too-weak': { allows: false, what: 'the evidence is not enough' },
  'identity-too-weak': { allows: false, what: "the caller's strength is under the act's, the effect's or the grant's least" },
  'server-not-isolated': { allows: false, what: 'a grant or a command on a shared-user server' },
  'operator-only': { allows: false, what: 'a member of the effective class is not covered, or the act may not carry the effect' },
  unmeasured: { allows: false, what: 'a fact the decider needed could not be read' },
} as const satisfies Readonly<Record<string, { readonly allows: boolean; readonly what: string }>>;
export type MayActWord = keyof typeof MAY_ACT_ANSWER_MAP;
export const MAY_ACT_WORDS = Object.keys(MAY_ACT_ANSWER_MAP) as MayActWord[];
/** The words that mint an allow. */
export type MayActAllowWord = { [W in MayActWord]: (typeof MAY_ACT_ANSWER_MAP)[W]['allows'] extends true ? W : never }[MayActWord];
export const MAY_ACT_ALLOW_WORDS = MAY_ACT_WORDS.filter((w) => MAY_ACT_ANSWER_MAP[w].allows) as MayActAllowWord[];

/** What an allow rests on (plan question 11): class none, the operator's command, an operator request, a stated entry or a
 *  grant. An act row stores it, and I4 checks each arm against its store. */
const ACT_AUTHORITY_MAP = { none: true, command: true, request: true, entry: true, grant: true } as const;
export type ActAuthorityKind = keyof typeof ACT_AUTHORITY_MAP;
export const ACT_AUTHORITY_KINDS = Object.keys(ACT_AUTHORITY_MAP) as ActAuthorityKind[];
/** An allow's authority: `none` names no row, every other kind names the row it rests on. */
export type ActAuthority =
  | { readonly kind: 'none'; readonly id: null }
  | { readonly kind: Exclude<ActAuthorityKind, 'none'>; readonly id: number };

/** How a writer uses an allow (F4): act on the effect, write a proposal row, or record a live or shadow answer. */
const ALLOW_MODE_MAP = {
  act: 'act on the effect', proposal: 'write a proposal row for one tap, never the effect',
  live: 'an armed kind, armed: act', shadow: 'an armed kind, not armed: record the answer only',
} as const;
export type AllowMode = keyof typeof ALLOW_MODE_MAP;
export const ALLOW_MODES = Object.keys(ALLOW_MODE_MAP) as AllowMode[];
