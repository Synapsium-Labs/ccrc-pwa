// Overlord W1, gates and identity (spec 2026-11-09 §3.6 H2 and H3, Table 3.6b, §7.4 C27 and H28, Table 11.2; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md` Task 1): who a row says acted, and how strongly the server knows
// it. Ring L0, one concern (the index's slug `wire-types-in-sibling-modules`): the caller strengths, the actor kinds and
// issuers, the verb classes, the door groups and the actor's column codec. The PWA bundles this file, so it imports nothing,
// not even types.
//
// IDENTITY IS ATTRIBUTION, AND THE STRENGTH SAYS SO. `attributed` is the box token plus a session's id and current uuid,
// which any process of the fleet's one UNIX user can read; `operator` is a console sign-in (and, at a gated door, the
// account gate's passkey); `workload` is a credential only a session's sandbox can read, which no adapter mints yet. Only
// the attribution adapter (`server/src/auth/attributionIdentity.ts`) mints an actor with a strength.

/** How strongly the server knows who is calling (§7.4). Only the attribution adapter mints one. */
export const CALLER_STRENGTH_MAP = { attributed: true, workload: true, operator: true } as const;
export type CallerStrength = keyof typeof CALLER_STRENGTH_MAP;
export const CALLER_STRENGTHS = Object.keys(CALLER_STRENGTH_MAP) as CallerStrength[];

/** Who the actor is: the operator at a console, a session, or the server's own lane. */
export const ACTOR_KIND_MAP = { operator: true, session: true, server: true } as const;
export type ActorKind = keyof typeof ACTOR_KIND_MAP;
export const ACTOR_KINDS = Object.keys(ACTOR_KIND_MAP) as ActorKind[];

/** What verified the subject: the account gate (cookie and passkey), the console's session cookie with no gate,
 *  attribution (box token, id and uuid), or the server itself. A verified credential later adds its issuer here. */
export const ACTOR_ISSUER_MAP = { 'account-gate': true, 'session-cookie': true, attribution: true, server: true } as const;
export type ActorIssuer = keyof typeof ACTOR_ISSUER_MAP;
export const ACTOR_ISSUERS = Object.keys(ACTOR_ISSUER_MAP) as ActorIssuer[];

/** The actor a row carries (H3, Table 3.6b; §7.4). `subject` is the text today's mechanism names: the account gate's
 *  `<label> <8 hex>`, the console's `device:<label>`, or a session id. */
export interface ActorWire {
  readonly kind: ActorKind; readonly subject: string; readonly issuer: ActorIssuer; readonly strength: CallerStrength;
}

/** Table 3.6b's verb classes (#279). A read is `view` in every group, an operator write `admin`, an Overlord or a
 *  coordinator-facing write `operate` (the plan's slug `operator-reads-are-view`). */
export const VERB_CLASS_MAP = { view: true, operate: true, admin: true } as const;
export type VerbClass = keyof typeof VERB_CLASS_MAP;
export const VERB_CLASSES = Object.keys(VERB_CLASS_MAP) as VerbClass[];

/** Table 11.2's five groups. */
export const DOOR_GROUP_MAP = {
  overlord: true, operator: true, 'coordinator-facing': true, hook: true, 'server-body': true,
} as const;
export type DoorGroup = keyof typeof DOOR_GROUP_MAP;
export const DOOR_GROUPS = Object.keys(DOOR_GROUP_MAP) as DoorGroup[];

/** The longest subject a row's actor carries: the account gate's label is at most 64 characters and the console's at most
 *  120, each with its prefix or suffix. */
export const ACTOR_SUBJECT_MAX = 200;

/** A row's actor, read back from its columns: an actor, or the first column that does not read. */
export type ActorColumnsRead =
  | { readonly kind: 'read'; readonly actor: ActorWire }
  | { readonly kind: 'unreadable'; readonly column: 'subject' | 'kind' | 'issuer' | 'strength' };

const isWord = <M extends object>(map: M, v: unknown): v is keyof M =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);

/** The one reader of an actor's four columns, in the order subject, kind, issuer, strength: the first that does not read
 *  is named, so a row with a half actor never reads as an actor. A subject is a non-empty string of at most
 *  `ACTOR_SUBJECT_MAX` characters with no control character. */
export function readActorColumns(subject: unknown, kind: unknown, issuer: unknown, strength: unknown): ActorColumnsRead {
  if (typeof subject !== 'string' || subject === '' || subject.length > ACTOR_SUBJECT_MAX || /\p{Cc}/u.test(subject)) {
    return { kind: 'unreadable', column: 'subject' };
  }
  if (!isWord(ACTOR_KIND_MAP, kind)) return { kind: 'unreadable', column: 'kind' };
  if (!isWord(ACTOR_ISSUER_MAP, issuer)) return { kind: 'unreadable', column: 'issuer' };
  if (!isWord(CALLER_STRENGTH_MAP, strength)) return { kind: 'unreadable', column: 'strength' };
  return { kind: 'read', actor: { kind, subject, issuer, strength } };
}
