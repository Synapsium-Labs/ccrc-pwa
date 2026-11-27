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

type RowIn = Pick<OverlordActRow, 'what' | 'reversibility' | 'rungs'> & Partial<OverlordActRow>;
/** A row with Table 4a's defaults: the Overlord's, class none, no answer, carrying nothing, no cover, `operate`, no
 *  compensator, `attributed`. Every row below names what differs. */
const row = (r: RowIn): OverlordActRow => ({
  actor: 'overlord', classes: [], answer: false, carrier: false, mayCarry: [], covers: [], verbClass: 'operate',
  compensator: null, leastStrength: 'attributed', ...r,
});
/** A row refused at every rung: no cover, and the operator's strength (plan Table 4). */
const refused = (what: string, classes: OverlordActRow['classes'], reversibility: Reversibility): OverlordActRow =>
  row({ what, classes, reversibility, rungs: NEVER, leastStrength: 'operator' });
const ownRecord = (what: string): OverlordActRow => row({ what, reversibility: 'reversible', rungs: ALL });
const routeOrPropose = (what: string): OverlordActRow => row({ what, reversibility: 'reversible', rungs: ADVISE_UP });

/** Table 4 of the plan, which is Table 7.1a with the plan's completions. */
const OVERLORD_ACT_KIND_MAP = {
  read: row({ what: "Read the server's rows through the door process", reversibility: 'n/a', verbClass: 'view', rungs: ALL }),
  'write-note': ownRecord('Keep its own records: a note'),
  acknowledge: ownRecord("Keep its own records: acknowledge an operator message, a held delivery to the role or a band-3 request row"),
  'open-request': ownRecord('Keep its own records: open a request, citing an operator message or none'),
  'model-write': ownRecord('Keep its own records: propose or change an entry of the operator model'),
  'seal-prediction': ownRecord('Keep its own records: seal a prediction with its brief'),
  relay: row({ what: 'Route a request to the coordinator that owns it', reversibility: 'compensable', mayCarry: ['widen-scope'],
    compensator: 'correction-mail', rungs: ADVISE_UP }),
  'drop-request': row({ what: 'Drop a request', reversibility: 'compensable', compensator: 'new-request', rungs: ADVISE_UP }),
  'close-request': routeOrPropose('Close a request'),
  'escalate-request': routeOrPropose("Move a request to the operator (`needs-you`)"),
  'attach-brief': routeOrPropose("Attach a brief to a coordinator's item"),
  escalate: routeOrPropose('Escalate to the operator'),
  'return-over-asked': routeOrPropose('Return an over-asked question to its coordinator'),
  object: routeOrPropose('Object to a call made in the operator\'s name'),
  'propose-grant': routeOrPropose('Propose a grant to the operator'),
  'propose-command': routeOrPropose('Propose a command to the operator'),
  'propose-retire': routeOrPropose('Propose retiring a programme to the operator'),
  'propose-practice': routeOrPropose('Propose a practice to the operator'),
  'nudge-owner': routeOrPropose('Mail the owner of a routed request a follow-up, through the relay door'),
  'raise-item': routeOrPropose('Raise an operator item of its own, with a brief, keyed by its subject'),
  'answer-item': row({ what: 'Answer a held item with an option', answer: true, carrier: true, mayCarry: 'question-effect',
    reversibility: 'compensable', compensator: 'correction-mail', rungs: FULL_ARMED }),
  'answer-ask': row({ what: "Answer a held ask with an option", answer: true, carrier: true, mayCarry: 'question-effect',
    reversibility: 'compensable', compensator: 'correction-mail', rungs: FULL_ARMED }),
  'start-programme': row({ what: 'Start a coordinator in a named workspace', classes: ['O3'], reversibility: 'compensable',
    covers: ['operator-request', 'command'], compensator: 'end-programme', rungs: PROPOSE_THEN_ALLOW }),
  'rekick-coordinator': row({ what: 'Re-kick a coordinator as the same session', reversibility: 'compensable',
    compensator: 'correction-mail', rungs: PROPOSE_THEN_ALLOW }),
  'approve-spec': row({ what: 'Approve a spec', classes: ['O3'], reversibility: 'compensable', covers: ['grant', 'command'],
    compensator: 'correction-mail', rungs: FULL_BY_GRANT }),
  'approve-dod': row({ what: 'Approve or change a definition of done', classes: ['O3'], reversibility: 'compensable',
    covers: ['grant', 'command'], compensator: 'correction-mail', rungs: FULL_BY_GRANT }),
  'widen-scope': row({ what: "Widen a programme's scope", classes: ['O3'], reversibility: 'compensable',
    covers: ['grant', 'command', 'operator-request'], compensator: 'correction-mail', rungs: FULL_BY_GRANT }),
  'state-a-fact': row({ what: 'Answer a value item: a fact only the operator holds', classes: ['O5'], answer: true,
    reversibility: 'compensable', covers: ['stated-entry'], compensator: 'correction-mail', rungs: FULL_ONLY }),
  'accept-limit': refused('Drop or cut a definition-of-done item, or accept a known limit that leaves one unmet', ['O3'], 'compensable'),
  'message-people': refused('Comment where other people take part', ['O1'], 'irreversible'),
  publish: refused('Make public or release', ['O1'], 'irreversible'),
  deploy: refused('Roll the fleet', ['O1'], 'compensable'),
  // Every verb the SAFETY list forbids to sessions (`server/src/coord/approvalguard.ts#FORBIDDEN_CCD_VERBS`, named in prose
  // only), touching tmux, units or the registries, updating, rolling back or rolling out a build, history writes, and writing
  // live box config, arming markers included.
  'live-box-act': refused('Act on a live box: a verb the SAFETY list forbids, its units, panes or registries, a build, a history write or its config', ['O1'], 'irreversible'),
  'account-management': refused('Manage accounts and their sign-ins', ['O1', 'O4'], 'irreversible'),
  spend: refused('Spend: credits, paid services and accounts', ['O2'], 'irreversible'),
  'secret-or-access': refused('Secrets, sign-ins and access', ['O4'], 'irreversible'),
  'reassign-programme': refused('Hand a programme to another session', ['O4'], 'irreversible'),
  'override-a-person': refused("Ignore a reviewer's requested change, or another person's ruling", ['O6'], 'irreversible'),
  renew: row({ what: 'End the conversation and start a fresh one', actor: 'server', reversibility: 'reversible', rungs: ALL }),
  // D-8809 and the coordinator's ruling (call 1816): the Overlord confirms one team candidate for a project, its own call in the
  // operator's name, which the operator overturns with their own write. Class none; at `full` only.
  'link-team': row({ what: "Confirm one team candidate for a project with no key, as a call made in the operator's name",
    reversibility: 'compensable', compensator: 'operator-relink', rungs: FULL_ONLY }),
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
