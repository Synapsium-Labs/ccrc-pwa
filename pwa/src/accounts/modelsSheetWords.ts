// EVERY SENTENCE THE MODELS SHEET SAYS, AND ITS TWO READERS (programme model-class-advance, wave R4; plan
// 2026-10-15-model-class-auto-advance-codex-arm.md, Task 20 as re-planned, D-8686, D-8690). Ring L1: pure, no fetch, no
// store, no component. A class arrives as data and is named through `classWord`; no class word and no model name is spelled
// here, and no sentence claims a running session picks a re-pinned model up by itself (it may keep the model it has until
// it is relaunched, spec §2.4).
//
// AN ANTHROPIC LANE (wave 9, Task A4.3; D-8744, D-8746, D-8820): its classes are the client's aliases, so each card also says
// where its id came from, the held id beside the alias's own, and the lines that explain a class with no id; `anthropicFacts`
// decides every one of them, and the sheet draws what it returns.
//
// REVERT ONLY (revert-holds-until-newer, D-8757). The sheet offers Revert and nothing else, on a Codex lane and an Anthropic
// one by the same rule, and only where the read it shows PROVES the fleet box ends a revert's hold by itself
// (`revertHoldEndsOn`: the read's own `revertHoldEnds: true`, never inferred from the lane kind, the build or an absence).
// A hand hold is made and released in the shell (`ccrc models <lane> hold|release`), which stays; the sheet only shows one
// that stands. No sentence here tells a person to hold or release anything.
//
// THE TWO READERS. `asLaneModelsActAnswer` reads `POST /api/models/:lane`'s 200, its `models` through `asLaneModelsRead`
// (the ONE reader of that wire, `lib/models.ts`); `modelsActFailure` reads a refused POST into a typed failure, whose
// `outcome` is the one fact the sheet words by: `none` (the verb NEVER RAN, so nothing was changed, and only then is that said),
// `refused` (the verb or a word of a later build refused: it may have written before it did, so nothing is claimed either way)
// or `unknown` (it MAY have run: never success and never failure). The sheet reads the lane again after EVERY act, whatever
// the outcome, and the row shows that read, never a guess (F1).
import type { LaneAdvanceRead, LaneClassAdvance, LaneClassModel, LaneModelsRead, ModelClass } from '../../../shared/models';
import { CLASSES } from '../../../shared/models';
import type { HistoryEntry, Hold, Pending, Previous } from '../../../shared/model-advance.mjs';
import { ApiError, writeOutcomeUnknown } from '../lib/apiError';
import { asLaneModelsRead, classWord, laneReadWords, type LaneKindFacts, type LaneReadFailure } from '../lib/models';

export type ModelsAction = 'revert';
const ACTIONS: readonly ModelsAction[] = ['revert'];

// ── the POST's 200 ──

/** `POST /api/models/:lane`'s 200, held to its shape. `models` is the FRESH read after the act. */
export interface LaneModelsActAnswer {
  readonly lane: string;
  readonly action: ModelsAction;
  readonly class: ModelClass;
  /** `null` for a revert, which always moves (the op's own boolean belongs to a hold or a release, which the sheet no longer asks). */
  readonly changed: boolean | null;
  /** A revert whose last bookkeeping write failed after the move landed. */
  readonly partial: boolean;
  readonly models: LaneModelsRead;
}

/** The 200, or `null` for anything off its grammar (the sheet then says the act may have happened and reads again). */
export function asLaneModelsActAnswer(raw: unknown): LaneModelsActAnswer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.ok !== true || typeof r.lane !== 'string') return null;
  if (typeof r.action !== 'string' || !(ACTIONS as readonly string[]).includes(r.action)) return null;
  if (typeof r.class !== 'string' || !(CLASSES as readonly string[]).includes(r.class)) return null;
  if (r.changed !== null && typeof r.changed !== 'boolean') return null;
  if (typeof r.partial !== 'boolean') return null;
  const models = asLaneModelsRead(raw);
  if (models === null) return null;
  return { lane: r.lane, action: r.action as ModelsAction, class: r.class as ModelClass, changed: r.changed, partial: r.partial, models };
}

// ── a refused POST ──

export interface ModelsActFailure {
  /** `none`: the verb never ran. `refused`: the verb (or a word of a later build) refused, possibly after a write: nothing is
   *  claimed. `unknown`: it may have run. */
  readonly outcome: 'none' | 'refused' | 'unknown';
  /** The route's word when it sent one, else `null`. */
  readonly code: string | null;
  readonly text: string;
}

const NOTHING_CHANGED = 'Nothing was changed.';

/** The refusal words `ccrc models <lane> hold|release|revert` can print (the sheet sends a revert only; the shell sends the rest): a HAND-KEPT list of every code `deploy/models-op.mjs`
 *  (the prelude every op runs, `holdOp`, `revertOp` and what they write through) and the lane-lock layer in `ccd/ccrc`
 *  (`_models_lock`, `_models_answer_locked`, `_models_answer`) print on that path, each a sentence of its own.
 *  `server/test/models-verb-codes.test.ts` scans both files and reds when a printed code is in neither this list nor its
 *  list of codes that belong to other ops. NO sentence says nothing was changed or written: a revert writes its hold
 *  FIRST, so a refusal after that leaves the class held, and the sheet reads the lane again and shows what it holds
 *  (F1, F9). */
export const VERB_CODE_WORDS: Readonly<Record<string, string>> = {
  'no-previous': 'There is no earlier model on record for this class, so there is nothing to put back.',
  'previous-not-in-catalogue': 'The model this class had before is no longer in the lane\'s catalogue, so it cannot be put back.',
  'previous-taken': 'Another class pins the model this one had before, and a revert never empties another class.',
  'lock-busy': 'The lane\'s models are being changed by something else right now. Try again in a moment.',
  'lock-unwritable': 'The lane\'s lock file cannot be written on the fleet box, so no change can be made safely.',
  'no-registry': 'This lane has no class registry on the fleet box yet, so there is nothing to revert.',
  'registry-invalid': 'The lane\'s class registry is not one this build accepts, so it was left alone.',
  'unroutable-lane': 'The lane\'s files cannot be rendered for routing, so the model was not moved. A hold may already be in place: the row shows what the lane holds now.',
  'no-such-account': 'The fleet box has no account by this name.',
  'anthropic-lane': 'This is an Anthropic lane: its classes are the client\'s own and carry no registry, so there is nothing to revert.',
  'alias-source-absent': 'The fleet box has no model on record for this class\'s alias that this lane\'s Claude Code can launch, so a revert cannot tell which earlier model to put back.',
  'aliases-file-unreadable': 'The lane\'s aliases file cannot be read on the fleet box, so a revert cannot tell which earlier model to put back. Doctor names the file.',
  'aliases-file-invalid': 'The lane\'s aliases file is not one the fleet box reads, so a revert cannot tell which earlier model to put back. Doctor names the file.',
  'settings-overrides-hold': 'This lane\'s own settings name a model for this class, and they win over the model a revert sets, so the revert could not reach a launch.',
  'registry-unwritable': 'The lane\'s class registry could not be written on the fleet box. A revert\'s hold may already be in place: the row shows what the lane holds now.',
  'advance-unwritable': 'The lane\'s advance file could not be written on the fleet box. The row shows what the lane holds now.',
  'settings-unwritable': 'The lane\'s settings could not be rendered or written on the fleet box. A revert\'s hold, and its move of the model, may already be in place: the row shows what the lane holds now.',
  'materialise-failed': 'Rendering the lane\'s files failed on the fleet box after the registry moved. The registry is put back where it could be, and a revert\'s hold stays: the row shows what the lane holds now.',
  'advance-file-unreadable': 'The lane\'s advance file cannot be read on the fleet box, and no act overwrites a file it cannot read. Fix or remove that file on the fleet box.',
  'advance-file-invalid': 'The lane\'s advance file is not one the fleet box reads, and no act overwrites it. Fix or remove that file on the fleet box.',
  'advance-invalid': 'The advance record this act built would not read back, so the fleet box did not write it.',
  'registry-unreadable': 'The lane\'s class registry cannot be read on the fleet box.',
  'catalogue-unreadable': 'The lane\'s model catalogue cannot be read on the fleet box.',
  'catalogue-invalid': 'The lane\'s model catalogue is not one the fleet box accepts.',
  'roster-absent': 'The fleet box has no account roster yet, so this lane could not be looked up. Run the install on the fleet box.',
  'roster-unreadable': 'The fleet box\'s account roster exists but cannot be read, so this lane could not be looked up. Fix its permissions on the fleet box.',
  'roster-invalid': 'The fleet box\'s account roster is not one this build accepts, so this lane could not be looked up. Fix it on the fleet box.',
  'bad-account-id': 'That is not an account id the fleet box takes.',
  'install-incomplete': 'The fleet box\'s ccrc install is incomplete: a file it ships with is missing or older than the rest. Re-run the install on the fleet box.',
  'budget-deferred': 'The time budget of the run on the fleet box could not carry this change, so it was deferred. Try again in a moment.',
  'no-answer': 'The fleet box\'s model tool gave no usable answer, so the sheet cannot say what happened. The row shows what the lane holds now. If it keeps happening, re-run the install on the fleet box.',
  'unknown-class': 'That is not one of the four classes.',
};

/** A refusal code as a screen may print it: a kebab word, never a sentence, a path or a command. */
const CODE_RE = /^[a-z][a-z0-9-]{0,63}$/;
const wordIn = (body: unknown, k: string): string | undefined => {
  const v = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[k] : undefined;
  return typeof v === 'string' && CODE_RE.test(v) ? v : undefined;
};

const BAD_REQUEST_WHY: Readonly<Record<string, string>> = {
  'bad-body': 'The request was malformed.',
  'bad-lane': 'That is not a lane id the fleet box takes.',
  'bad-action': 'That action is not revert.',
  'bad-class': 'That is not one of the four classes.',
};

const UNKNOWN_CAUSE: Readonly<Record<string, string>> = {
  timeout: 'The fleet box did not answer in time',
  'too-large': 'The fleet box\'s answer was too large to read',
  lost: 'The link to the fleet box dropped before it answered',
  unreadable: 'The fleet box answered, but not in a form this console can read',
};

const mayHave = (cls: string, lead: string): string =>
  `${lead}, so the change to the ${cls} class may have happened. The sheet is reading the lane again: check the row before you try again.`;

/** A refused or failed POST as a typed failure. `lane` and `cls` are the ones asked, for the sentences that name them. */
export function modelsActFailure(err: unknown, lane: string, cls: string): ModelsActFailure {
  // `none` is said ONLY where the verb never ran (F1): the route's own pre-op refusals, the auth gate's, and the builder's.
  const none = (code: string | null, text: string): ModelsActFailure => ({ outcome: 'none', code, text: `${text} ${NOTHING_CHANGED}` });
  const refusedAs = (code: string | null, text: string): ModelsActFailure => ({ outcome: 'refused', code, text });
  if (!(err instanceof ApiError)) {
    return { outcome: 'unknown', code: null, text: mayHave(cls, 'No answer arrived') };
  }
  const body: unknown = err.body;
  const error = wordIn(body, 'error');
  const cause = wordIn(body, 'cause');
  switch (error) {
    case 'not-found': return none(error, `The fleet box has no lane named ${lane}.`);
    case 'bad-request': {
      const why = wordIn(body, 'why');
      return none(error, why !== undefined && Object.hasOwn(BAD_REQUEST_WHY, why) ? BAD_REQUEST_WHY[why]! : 'The request was refused as malformed.');
    }
    // revert-holds-until-newer (D-8757): the server reads the lane fresh before it acts and refuses, writing nothing, when that
    // read does not prove the box ends a revert's hold by itself. Each cause has a sentence of its own; any other cause keeps
    // the words it had.
    case 'unsupported':
      if (cause === 'revert-hold-ends') return none(error, 'The fleet box\'s ccrc does not end a revert\'s hold by itself, so the revert was not sent. Update the fleet box, then try again.');
      return none(error, 'This server cannot run it: the fleet agent predates this act, or the server has no fleet to run it on. Update the fleet box, then try again.');
    case 'unavailable':
      if (cause === 'lane-unreadable') return none(error, 'The lane could not be read just before the revert, so it was not sent.');
      if (cause === 'lane-absent') return none(error, 'The fleet box has no model record for this lane, so the revert was not sent.');
      return none(error, 'The act did not start.');
    // The fleet agent's one gate is shared with reads, so the other holder may be this sheet's own read, not another change.
    case 'busy': return none(error, 'The fleet box is busy with another models request (it may be this sheet\'s own read). Try again in a moment.');
    case 'outcome-unknown':
      return { outcome: 'unknown', code: error, text: mayHave(cls, cause !== undefined && Object.hasOwn(UNKNOWN_CAUSE, cause) ? UNKNOWN_CAUSE[cause]! : 'The fleet box did not say how it ended') };
    case 'lane-act-refused': {
      const verb = wordIn(body, 'verbCode');
      // The verb ran and refused: it may have written first (a revert's hold), so no sentence claims otherwise.
      if (verb === undefined) return refusedAs(error, 'The fleet box refused the act. The row shows what the lane holds now.');
      return refusedAs(error, Object.hasOwn(VERB_CODE_WORDS, verb) ? VERB_CODE_WORDS[verb]! : `The fleet box refused the act (${verb}). The row shows what the lane holds now.`);
    }
    case 'unauthenticated': return none(error, 'You are signed out of this console. Sign in again, then repeat it.');
    case 'foreign-origin': return none(error, 'This device is not allowed to change models: the console refused it.');
    default: break;
  }
  // No word of ours: a 401 or 403 is the gate's, which never reached the route; any other 4xx is a refusal of a later build's
  // word, which proves nothing either way; a 5xx may have landed.
  if (err.status === 401) return none(null, 'You are signed out of this console. Sign in again, then repeat it.');
  if (err.status === 403) return none(null, 'This device is not allowed to change models: the console refused it.');
  if (writeOutcomeUnknown(err)) return { outcome: 'unknown', code: error ?? null, text: mayHave(cls, `The fleet box answered with an error (${err.status})`) };
  return refusedAs(error ?? null, error === undefined ? `The act was refused (${err.status}).` : `The act was refused (${error}).`);
}

// ── what the sheet shows ──

/** The fold's act that opens the sheet. */
export const MODELS_ACT = 'Models';
/** Whether a lane's card offers the Models act, decided from the roster's lane kind: a Codex-kind lane (R4, D-8752), or an
 *  Anthropic one (`telemetry: 'anthropic'`, wave 9 Task A4.3, the one test `modelListProvider` asks). `undefined` is a
 *  lane the roster has no row for. */
export const modelsActOffered = (entry: Pick<LaneKindFacts, 'kind' | 'telemetry'> | undefined): boolean =>
  entry?.kind === 'codex' || entry?.telemetry === 'anthropic';
/** The sheet's lane-kind prop: an Anthropic lane draws its cards with the Anthropic lines (the Revert rule is the same). */
export const modelsSheetAnthropic = (entry: Pick<LaneKindFacts, 'telemetry'> | undefined): boolean => entry?.telemetry === 'anthropic';
export const MODELS_SHEET_TITLE = 'Model classes';
export const MODELS_EMPTY_CLASS = 'No model: this class is empty on this lane.';
export const MODELS_NOT_HELD = 'Not held: an automatic advance may move it.';
/** What the sheet says when the lane's read answered no classes (R3b): the one sentence `laneReadWords` (`lib/models.ts`)
 *  gives each arm, and, on every arm but `absent`, that the class names are listed below. The arms that do not say it
 *  themselves add that the sheet reads again when it is opened; the transient arms (`busy`, `not-started`) already say
 *  so, and say it once (fix round 2, N2). `beside` is a transient word the sheet says on its own line after these words
 *  (`laneTransientBeside`, follow-up transient-beside-kept-answer): that line already says the lane is read again, so
 *  these words then say only that the names are listed, and "again" is said once. */
const NAMES_LISTED = 'The four classes are listed below by name.';
const READ_AGAIN = 'The four classes are listed below by name; the sheet reads again when it is opened.';
export function modelsReadStateWords(
  read: Exclude<LaneModelsRead, { readonly kind: 'read' }>, beside: 'busy' | 'not-started' | null = null,
): string {
  const said = laneReadWords(read) ?? '';
  if (read.kind === 'absent') return said;
  return `${said} ${read.kind === 'busy' || read.kind === 'not-started' || beside !== null ? NAMES_LISTED : READ_AGAIN}`;
}
export const MODELS_READ_ABSENT = modelsReadStateWords({ kind: 'absent' });
export const MODELS_READ_UNREADABLE = modelsReadStateWords({ kind: 'unreadable' });
export const MODELS_RETRY = 'Try again';
/** A failed read of the lane, by what happened (F12): never a skeleton forever. */
export const MODELS_READ_FAILED: Readonly<Record<LaneReadFailure, string>> = {
  'signed-out': 'The lane could not be read: you are signed out of this console. Sign in again, then try again.',
  'foreign-origin': 'The lane could not be read: the console refused this page because it was not opened at the console\'s own address. Open the console at that address, then try again.',
  refused: 'The lane could not be read: the console refused the request.',
  'not-in-roster': 'The lane could not be read: it is no longer in the fleet\'s roster.',
  'no-answer': 'The lane could not be read: no answer arrived (you may be offline, or the link to the fleet box is down).',
  unreadable: 'The lane could not be read: the console got an answer it cannot read, so no models are shown.',
};
export const MODELS_REVERT_CONFIRM = 'Put back and hold';
export const MODELS_CONFIRM_SESSIONS = 'Sessions already running may keep their current model until they are relaunched.';

export const classLabel = (cls: ModelClass): string => classWord(cls);

/** The pin as a person reads it: the catalogue's label beside the id when it has one, else the id. */
export const modelLine = (model: string | null, label: string | null): string =>
  model === null ? MODELS_EMPTY_CLASS : label !== null && label !== model ? `${label} (${model})` : model;

/** `2026-11-17T09:00:00Z` read to the minute, UTC said. */
export const minuteOf = (at: string): string => `${at.slice(0, 10)} ${at.slice(11, 16)}Z`;

/** One shared sentence for every hold the read proves the box ends: a hand hold's story is never told as a Revert's, and
 *  nothing says what the Revert left or that the next refresh records anything (revert-holds-until-newer, D-8757). */
const HOLD_ENDS_WORDS = 'It ends by itself once a newer model appears; nothing needs doing.';
/** A class's hold, first sentence by who made it. `endsHold` (`revertHoldEndsOn` of the shown read) adds the one ending
 *  sentence; without it a hold that stands is said as it is, with no ending and no remedy. */
export const holdWords = (h: Hold | null, endsHold: boolean): string => {
  if (h === null) return MODELS_NOT_HELD;
  const held = `Held ${h.by === 'revert' ? 'by a revert' : 'by hand'} since ${minuteOf(h.at)}.`;
  return endsHold ? `${held} ${HOLD_ENDS_WORDS}` : held;
};

/** Said on the lane, in place of Revert, when the read is good, the advance record is read and the read does not prove the
 *  fleet box ends a revert's hold by itself (an older ccrc there). */
export const MODELS_REVERT_UNOFFERED =
  'This fleet box\'s ccrc does not end a revert\'s hold by itself, so Revert is not offered. Updating the fleet box brings it back.';

export function lastMoveWords(m: HistoryEntry | null): string {
  if (m === null) return 'No move on record.';
  const how = m.how === 'advance' ? 'Advanced' : m.how === 'revert' ? 'Reverted' : 'Set by hand';
  return `${how} ${minuteOf(m.at)}: ${m.from ?? 'empty'} → ${m.to ?? 'empty'}.`;
}

/** What a Revert would put back, or `null` when there is nothing recorded. */
export const previousWords = (p: Previous | null): string | null =>
  p === null ? null : `A revert would put back ${p.model ?? 'an empty class'}.`;

/** An Anthropic class card's model line: the label and id when the class has one, else the class word (an alias names no
 *  id until one is on record, so the class word is the one name it has). */
export const anthropicModelLine = (cls: ModelClass, model: string | null, label: string | null): string =>
  model === null ? classWord(cls) : modelLine(model, label);

/** D-8820's residual, said once on a held Anthropic class: a supervisor kept on the previous ccd body is the one place a
 *  hold does not reach a launch. A fact, not an instruction. */
export const SUPERVISOR_RESIDUAL_WORDS =
  'If a session supervisor on the fleet box still runs the previous ccd build, it launches this class\'s sessions without the held model until it restarts; the update\'s degraded sweep line names such a supervisor.';

export type AnthropicFactKind =
  | 'source' | 'disagree' | 'held' | 'alias' | 'orphaned' | 'no-id' | 'unlaunchable' | 'unobserved' | 'supervisor';
export interface AnthropicFact { readonly kind: AnthropicFactKind; readonly text: string }

const SOURCE_WORDS: Readonly<Record<'cache' | 'use', string>> = {
  cache: 'Id from Claude Code\'s catalogue.',
  use: 'Id seen at a launch.',
};

/** The lines an Anthropic class's card carries, in the order they are read. `c` is the class's read (`model` is the held id
 *  while a hold stands), `adv` its advance entry, which owns the held id (`hold.model`): the card's own `model` is never read
 *  as the held one. A class with no id and an unlaunchable one are two lines apart, never one. `unobserved` is said only
 *  for a class that is held (it exempts nothing else), so another class's card never carries it. */
export function anthropicFacts(cls: ModelClass, c: LaneClassModel, adv: LaneClassAdvance | null): readonly AnthropicFact[] {
  const out: AnthropicFact[] = [];
  const add = (kind: AnthropicFactKind, text: string): void => { out.push({ kind, text }); };
  if (c.source === 'cache' || c.source === 'use') add('source', SOURCE_WORDS[c.source]);
  if (c.cacheTarget != null && c.seenId != null && c.cacheTarget !== c.seenId) {
    add('disagree', `Claude Code\'s catalogue names ${c.cacheTarget}, and the newest launch seen ran ${c.seenId}.`);
  }
  const heldId = adv?.hold?.model;
  if (heldId !== undefined) {
    add('held', `Held at ${heldId}.`);
    if (c.aliasId !== undefined && c.aliasId !== heldId) add('alias', `The ${classWord(cls)} alias now resolves to ${c.aliasId}.`);
  }
  if (c.orphanedEffort != null) {
    add('orphaned', `Saved effort ${c.orphanedEffort.level} is keyed to an older model; ccd carries it at launch under Auto.`);
  }
  if (c.unlaunchable !== undefined) {
    const { needs, laneVersion } = c.unlaunchable;
    add('unlaunchable', laneVersion === null
      ? `This lane\'s Claude Code build could not be read, and this class\'s model needs build ${needs}.`
      : `This lane\'s Claude Code build ${laneVersion} is older than build ${needs}, which this class\'s model needs.`);
  } else if (c.model === null) {
    add('no-id', 'No model id is on record for this class yet.');
  }
  if (adv?.hold != null) {
    if (c.unobserved === true) add('unobserved', 'The alias\'s resolution is not observed while the hold stands.');
    add('supervisor', SUPERVISOR_RESIDUAL_WORDS);
  }
  return out;
}

export const familyWords = (family: string | null): string => (family === null ? 'No family recorded.' : `Family ${family}.`);

/** A verb's reason, as `: <reason>` for a sentence that ends in our own period: one trailing period of the reason's is dropped
 *  (the verb's sentences end in one), and no reason is no clause at all (F20). */
const reasonOf = (detail: string | null): string => {
  const d = detail === null ? '' : detail.trim().replace(/\.$/, '');
  return d === '' ? '' : `: ${d}`;
};

/** Each way the advance file can read, and the one where the answer carried no advance key at all (an agent without the
 *  op: the advance file was not read, which is not "unreported"). */
export function advanceStateWords(a: LaneAdvanceRead | undefined): { readonly state: LaneAdvanceRead['state'] | 'not-read'; readonly text: string } {
  if (a === undefined) {
    return { state: 'not-read', text: 'The advance record was not read: holds and the last move are not known, so no revert is offered.' };
  }
  switch (a.state) {
    case 'ok': return { state: 'ok', text: 'The advance record is read.' };
    case 'absent': return { state: 'absent', text: 'No automatic advance is on record for this lane yet.' };
    case 'unreadable': return { state: 'unreadable', text: `The advance record cannot be read${reasonOf(a.detail)}.` };
    case 'invalid': return { state: 'invalid', text: `The advance record is not one this build reads${reasonOf(a.detail)}.` };
    case 'unreported': return { state: 'unreported', text: 'The fleet box\'s ccrc predates the advance record, so holds are not known. Update it to revert from here.' };
  }
}

/** A pending intent (D-5188): a move written down and not yet settled. */
export function pendingWords(p: Pending): string {
  const target = p.to === null ? 'emptying the class' : `moving it to ${p.to}`;
  const how = p.how === 'hand' ? 'set by hand' : 'an automatic advance';
  return `A change to the ${p.class} class is pending (${how}, ${minuteOf(p.at)}): ${target}. It settles on the fleet box by itself.`;
}

/** Whether the read the sheet shows PROVES the fleet box ends a revert's hold by itself: the `read` arm's own
 *  `revertHoldEnds: true` (`asLaneModelsRead` carries it from the server's wire, the server from the op's constant) and
 *  nothing else. Never inferred from the lane kind, the build or an absence: a busy, an absent or an older read answers no. The
 *  one predicate of the capability, asked by the card, the note, the hold's sentence and the confirm alike (revert-holds-until-newer, D-8757). */
export const revertHoldEndsOn = (read: LaneModelsRead | null): boolean => read?.kind === 'read' && read.revertHoldEnds === true;

/** What one class card offers, decided once (F13) from the lane's advance read and asked by the card and by the Revert
 *  confirm alike. `held`: a hold stands on the class (shown whatever the capability, so an existing hold stays visible).
 *  `revert`: whether the read proves the box ends holds (`endsHold`) AND the box says the class can revert AND names what it
 *  would put back; the same rule on a Codex and an Anthropic lane. There is no Hold or Release to offer. */
export interface ClassActs {
  readonly adv: LaneClassAdvance | null;
  readonly held: boolean;
  readonly revert: boolean;
}
export function classActs(advance: LaneAdvanceRead | undefined, cls: ModelClass, endsHold: boolean): ClassActs {
  const adv: LaneClassAdvance | null = advance?.state === 'ok' ? advance.classes?.[cls] ?? null : null;
  return { adv, held: adv?.hold != null, revert: endsHold && adv?.revertable === true && adv.previous !== null };
}
/** Whether a Revert of `cls` is still on offer on the CURRENT read: the confirm asks it when it opens, while it stands and
 *  again when it is confirmed, and sends nothing when it is no longer so. */
export const revertStillOffered = (read: LaneModelsRead | null, cls: ModelClass): boolean =>
  read?.kind === 'read' && classActs(read.advance, cls, revertHoldEndsOn(read)).revert;
/** Said when a Revert that was asked about is withdrawn because the lane's current read no longer offers it: the class
 *  has no earlier model on record now, the read no longer shows the advance record at all (it is unreadable, invalid,
 *  unreported, absent or was not read, or the lane itself could not be read), or the read no longer proves the fleet box
 *  ends a revert's hold by itself (`revertHoldEnds`). */
export const revertWithdrawnWords = (cls: ModelClass): string =>
  `The revert of the ${cls} class was cancelled: the lane's latest read no longer offers it, because the class has no earlier model on record, the lane's advance record could not be read just now, or the fleet box no longer shows that it ends a revert's hold by itself. Nothing was sent.`;

export const revertAriaLabel = (cls: ModelClass): string => `Revert the ${cls} class`;
export const revertTitle = (cls: ModelClass): string => `Revert the ${cls} class?`;
/** `previous` is the one on record: a revert whose class has none is not offered, so there is no sentence for it (F13). */
export function revertConsequence(
  lane: string, cls: ModelClass, current: string | null, previous: Previous,
): string[] {
  return [
    `Put back ${previous.model ?? 'an empty class'} and hold ${cls} on ${lane}.`,
    'The hold ends by itself once a newer model appears, so nothing needs doing to lift it.',
    `As last read, that replaces ${current ?? 'an empty class'}.`,
    MODELS_CONFIRM_SESSIONS,
  ];
}

/** What was done, said once the box has answered (the live region's status). A revert holds the class, and the hold ends by
 *  itself (the server refused to send it where the read did not prove that). */
export function actDoneWords(a: LaneModelsActAnswer): string {
  const cls = a.class;
  return a.partial
    ? `Reverted the ${cls} class and held it, but a final bookkeeping write failed after the model moved. The sheet shows what the fleet box holds now. The hold ends by itself once a newer model appears.`
    : `Reverted the ${cls} class and held it. The hold ends by itself once a newer model appears.`;
}

/** The answer came back 200 but could not be read: the act may have happened. */
export const actUnreadableWords = (cls: ModelClass): string =>
  `The fleet box answered, but not in a form this console can read, so the change to the ${cls} class may have happened. The sheet is reading the lane again: check the row before you try again.`;
