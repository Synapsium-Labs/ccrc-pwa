// The `OverlordPolicy` port (Overlord spec §3.6, §7.1 "Verb classes", §11.2 "After the gates"; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` Task B4). Ring L2, context C5: types only. Its consumer
// is each Overlord write door, which asks it after `overlordMayAct` allowed and the egress check passed, through
// `overlordPolicyAsk.ts#askPolicy`; no door asks it yet (the doors come with later pieces).
//
// FAILURE CONTRACT. `check` is synchronous: the door is inside its transaction, so an adapter answers from what it holds and
// makes no I/O in the call. It cannot widen: its only input is an allow the decider minted, and its only other answer is a
// refusal, which the door sends as `policy-refused`. A throw, and an answer of any other shape, is read as that refusal (fail
// closed, review 2271 F15). The target is the allow's own (F5).
import type { MayActAllow } from './overlordMayAct.js';
import type { VerbClass } from '../../../shared/overlord-identity.js';
import type { RecordedActor } from '../auth/callerIdentity.js';

/** What the door asks: the decider's bound allow, the door row's verb class and the caller the identity port minted. */
export interface PolicyQuestion { readonly allow: MayActAllow; readonly verbClass: VerbClass; readonly actor: RecordedActor }

/** The adapter's answer: pass, or a refusal with its reason. */
export type PolicyCheck = { readonly ok: true } | { readonly ok: false; readonly why: string };

export interface OverlordPolicy {
  check(q: PolicyQuestion): PolicyCheck;
}

/** The door's one reading of the port: pass, or `policy-refused` with what refused it (the adapter, a throw, or an answer
 *  that is not a check) and its evidence. */
export type PolicyVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly word: 'policy-refused'; readonly cause: 'refused' | 'threw' | 'malformed'; readonly why: string };
