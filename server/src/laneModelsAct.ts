// Programme model-class-advance, wave R4 (plan 2026-10-15-model-class-auto-advance-codex-arm.md, Task 19's POST as
// re-planned, D-8686, D-8687, D-8693; revert-holds-until-newer, D-8757): what `POST /api/models/:lane` decides. Ring L1,
// context C1 (Fleet Registry & Accounts): pure, imports `shared/` only, no fs, no fastify, no clock. The route
// (`laneModelsRoutes.ts`, L4) applies these verdicts and decides nothing.
//
// THREE DECISIONS, each one function:
//  - `parseModelsActBody`: the body is exactly `{action: 'revert', class}`; the lane, action and class go through the op's
//    own builder (`buildModelsArgv`), so the route refuses what the agent's builder would refuse, in the builder's order.
//    The door takes Revert only (`MODELS_DOOR_ACTIONS`): `hold` and `release` stay the shell's and the agent's verbs, and
//    `show` is the GET's, so all three are `bad-action` here, the lane judged first.
//  - `revertGateVerdict`: whether a FRESH read of the lane proves the box ends a revert's hold by itself
//    (`revertHoldEnds`); a revert is written only then, because a hold the box would never end by itself must not be
//    written from the console, and an older or unreadable box proves nothing.
//  - `modelsActVerdict`: how the revert ended, each arm kept apart (no overloaded null). A refusal is a WORD, never
//    the verb's sentence: the verb's `detail` can carry paths and commands, so only its kebab `error` crosses, as
//    `verbCode` on `lane-act-refused`. A timeout, an output past its cap and a lost answer are `outcome-unknown`: the verb
//    may have run, so it is neither success nor failure. A verb that ran and printed anything off the grammar is
//    `outcome-unknown` with cause `unreadable`: it ran and we cannot say what it did.
//
// The grammar is `deploy/models-op.mjs`'s `holdOp` and `revertOp`: success is exit 0 and ONE JSON object
// `{ok: true, op, class, id, advanceNote? (revert: a final write failed after the move landed)}`;
// a refusal is exit 1 or 2 and `{ok: false, error, detail}`. The exit code must agree with the body, as `readShowAnswer`
// (`laneModels.ts`) holds for `show`; unlike `show`, an empty stdout is never a refusal here (nothing prints before a
// writing verb's own answer, so an empty one is not an answer at all).
import { buildModelsArgv, type ModelsAsked } from '../../shared/agent-protocol.js';
import type { LaneModelsRead, ModelClass } from '../../shared/models.js';
import type { RouteRefusal } from '../../shared/refusal.js';

/** The actions this door takes, defined once: Revert only. The builder (`buildModelsArgv`) still admits hold and release for
 *  the shell's and the agent's path; this door does not. */
export const MODELS_DOOR_ACTIONS = ['revert'] as const;
export type ModelsDoorAction = (typeof MODELS_DOOR_ACTIONS)[number];

/** Why a body was refused, checked in this order: the shape, then the builder's own order (lane, action, class). */
export const MODELS_ACT_BODY_REFUSALS = ['bad-body', 'bad-lane', 'bad-action', 'bad-class'] as const;
export type ModelsActBodyRefusal = (typeof MODELS_ACT_BODY_REFUSALS)[number];

export type ModelsActParsed =
  | { readonly ok: true; readonly action: ModelsDoorAction; readonly cls: ModelClass }
  | { readonly ok: false; readonly why: ModelsActBodyRefusal };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** THE ONE reader of the POST's body. Exactly `{action: 'revert', class}`: any other key is `bad-body`. A missing `action`
 *  reads as `bad-action` and a missing `class` as `bad-class`, the builder's own words. `lane` is the path's, already measured
 *  against the roster by the route; the builder still refuses an id the op cannot carry. */
export function parseModelsActBody(lane: string, body: unknown): ModelsActParsed {
  if (!isObj(body)) return { ok: false, why: 'bad-body' };
  for (const k of Object.keys(body)) if (k !== 'action' && k !== 'class') return { ok: false, why: 'bad-body' };
  const { action, class: cls } = body;
  if (action !== 'revert') {
    // `show`, `hold` and `release` are real actions the builder accepts, but never this door's: the lane is judged first,
    // as the builder does, then the action is refused (an unknown action reads the same way).
    const laneOnly = buildModelsArgv(lane, 'show', undefined);
    return { ok: false, why: laneOnly.ok ? 'bad-action' : laneOnly.why };
  }
  const built = buildModelsArgv(lane, action, cls);
  if (!built.ok) return { ok: false, why: built.why };
  return { ok: true, action, cls: cls as ModelClass };
}

/** The extra keys a refusal carries, each a short word: never a sentence, a path or a command. */
export type ModelsActExtra =
  | { readonly why: string } | { readonly cause: string } | { readonly verbCode: string } | Readonly<Record<string, never>>;

export type ModelsActVerdict =
  /** Exit 0 with a well-formed `ok:true` for this very revert and class. `changed` is always `null` (a revert always
   *  moves); the key stays on the wire for an older console. `partial` is true iff the revert's final write failed after
   *  the move landed (its `advanceNote`). */
  | { readonly kind: 'done'; readonly changed: null; readonly partial: boolean }
  | { readonly kind: 'refuse'; readonly error: RouteRefusal; readonly extra: ModelsActExtra };

/** A refusal word the verb may print: kebab, lower case, at most 64 characters. Anything else is off the grammar. */
const VERB_CODE_RE = /^[a-z][a-z0-9-]{0,63}$/;

const unreadable: ModelsActVerdict = { kind: 'refuse', error: 'outcome-unknown', extra: { cause: 'unreadable' } };

/** What the capability read before the revert allows: the act, or a refusal that writes nothing and audits nothing. */
export type RevertGateVerdict =
  | { readonly kind: 'act' }
  | { readonly kind: 'refuse'; readonly error: RouteRefusal; readonly extra: ModelsActExtra };

/** Whether a FRESH read of the lane proves the box ends a revert's hold by itself (`revertHoldEnds`, which `readLaneModels`
 *  decodes: exactly `true`, never a truthy value). Only a `read` that carries it lets the revert be written: an older op, an
 *  unreadable lane and every other arm prove nothing, and a hold the box would never end by itself must not be written from
 *  the console. Each arm of `LaneModelsRead` has its own row, none folded into another. */
export function revertGateVerdict(read: LaneModelsRead): RevertGateVerdict {
  switch (read.kind) {
    case 'read':
      return read.revertHoldEnds === true
        ? { kind: 'act' }
        : { kind: 'refuse', error: 'unsupported', extra: { cause: 'revert-hold-ends' } };
    case 'unsupported': return { kind: 'refuse', error: 'unsupported', extra: {} };
    case 'not-started': return { kind: 'refuse', error: 'unavailable', extra: { cause: 'not-started' } };
    case 'busy': return { kind: 'refuse', error: 'busy', extra: { cause: 'agent-busy' } };
    case 'refused': return { kind: 'refuse', error: 'bad-request', extra: { why: read.why } };
    case 'unreadable': return { kind: 'refuse', error: 'unavailable', extra: { cause: 'lane-unreadable' } };
    case 'absent': return { kind: 'refuse', error: 'unavailable', extra: { cause: 'lane-absent' } };
  }
}

/** How the revert ended, from how the op's seam answered. Never throws; every arm of `ModelsAsked` has its own row. */
export function modelsActVerdict(lane: string, action: ModelsDoorAction, cls: ModelClass, asked: ModelsAsked): ModelsActVerdict {
  switch (asked.kind) {
    case 'refused': return { kind: 'refuse', error: 'bad-request', extra: { why: asked.why } };
    case 'unsupported': return { kind: 'refuse', error: 'unsupported', extra: {} };
    case 'not-started': return { kind: 'refuse', error: 'unavailable', extra: { cause: 'not-started' } };
    case 'busy': return { kind: 'refuse', error: 'busy', extra: { cause: 'agent-busy' } };
    case 'timeout': case 'too-large': case 'lost':
      return { kind: 'refuse', error: 'outcome-unknown', extra: { cause: asked.kind } };
    case 'exited': return exitedVerdict(lane, action, cls, asked.code, asked.stdout);
  }
}

function exitedVerdict(lane: string, action: ModelsDoorAction, cls: ModelClass, code: number, stdout: string): ModelsActVerdict {
  if (code !== 0 && code !== 1 && code !== 2) return unreadable;
  // exactly one JSON object, with at most one trailing newline
  const body = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  // (an empty one is no JSON, so `JSON.parse` refuses it below: the unreadable arm, whatever the exit code)
  if (body.includes('\n')) return unreadable;
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return unreadable; }
  if (!isObj(raw)) return unreadable;
  // the exit code must agree with the body: an answer at 0, a refusal at 1 or 2
  if ((raw.ok === false) !== (code !== 0)) return unreadable;
  if (raw.ok === false) {
    if (typeof raw.error !== 'string' || !VERB_CODE_RE.test(raw.error)) return unreadable;
    return { kind: 'refuse', error: 'lane-act-refused', extra: { verbCode: raw.error } };
  }
  // the answer names the lane (`describe`'s `id`), the action and the class this call asked, as `readShowAnswer` holds for `show`
  if (raw.ok !== true || raw.op !== action || raw.class !== cls || raw.id !== lane) return unreadable;
  return { kind: 'done', changed: null, partial: typeof raw.advanceNote === 'string' };
}

/** The one outcome word the audit line carries: `done`, `done-partial` (a revert whose final write failed), or the refusal
 *  word followed by its cause, verb code or builder reason. */
export function modelsActAuditWord(v: ModelsActVerdict): string {
  if (v.kind === 'done') return v.partial ? 'done-partial' : 'done';
  const e = v.extra as Readonly<Record<string, string>>;
  const detail = e.cause ?? e.verbCode ?? e.why;
  return detail === undefined ? v.error : `${v.error} ${detail}`;
}
