// EVERY SENTENCE THE MODELS SHEET SAYS, AND ITS TWO READERS (programme model-class-advance, wave R4; plan
// 2026-10-15-model-class-auto-advance-codex-arm.md, Task 20 as re-planned, D-8686, D-8690). Ring L1: pure, no fetch, no
// store, no component. A class arrives as data and is named through `classWord`; no class word and no model name is spelled
// here, and no sentence claims a running session picks a re-pinned model up by itself (it may keep the model it has until
// it is relaunched, spec §2.4).
//
// THE TWO READERS. `asLaneModelsActAnswer` reads `POST /api/models/:lane`'s 200, its `models` through `asLaneModelsRead`
// (the ONE reader of that wire, `lib/models.ts`); `modelsActFailure` reads a refused POST into a typed failure, whose
// `outcome` is the one fact the sheet branches on: `none` (the act did not run, so the row stays as it was) or `unknown` (it
// MAY have run: never success and never failure, and the lane is read again before anything more is said).
import type { LaneAdvanceRead, LaneModelsRead, ModelClass } from '../../../shared/models';
import { CLASSES } from '../../../shared/models';
import type { HistoryEntry, Hold, Pending, Previous } from '../../../shared/model-advance.mjs';
import { ApiError, writeOutcomeUnknown } from '../lib/apiError';
import { asLaneModelsRead, classWord } from '../lib/models';

export type ModelsAction = 'hold' | 'release' | 'revert';
const ACTIONS: readonly ModelsAction[] = ['hold', 'release', 'revert'];

// ── the POST's 200 ──

/** `POST /api/models/:lane`'s 200, held to its shape. `models` is the FRESH read after the act. */
export interface LaneModelsActAnswer {
  readonly lane: string;
  readonly action: ModelsAction;
  readonly class: ModelClass;
  /** A hold's or a release's own boolean (`false`: there was nothing to do); `null` for a revert, which always moves. */
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
  /** `none`: the act did not run. `unknown`: it may have run. */
  readonly outcome: 'none' | 'unknown';
  /** The route's word when it sent one, else `null`. */
  readonly code: string | null;
  readonly text: string;
}

const NOTHING_CHANGED = 'Nothing was changed.';

/** The verb's own refusal words (`deploy/models-op.mjs`'s `hold` and `revert`), each a sentence of its own. */
export const VERB_CODE_WORDS: Readonly<Record<string, string>> = {
  'no-previous': 'There is no earlier model on record for this class, so there is nothing to put back.',
  'previous-not-in-catalogue': 'The model this class had before is no longer in the lane\'s catalogue, so it cannot be put back.',
  'previous-taken': 'Another class pins the model this one had before, and a revert never empties another class.',
  'lock-busy': 'The lane\'s models are being changed by something else right now. Try again in a moment.',
  'lock-unwritable': 'The lane\'s lock file cannot be written on the fleet box, so no change can be made safely.',
  'no-registry': 'This lane has no class registry on the fleet box yet, so there is nothing to hold or revert.',
  'registry-invalid': 'The lane\'s class registry is not one this build accepts, so it was left alone.',
  'unroutable-lane': 'The lane\'s files cannot be rendered for routing, so the move was refused.',
  'no-such-account': 'The fleet box has no account by this name.',
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
  'bad-action': 'That action is not hold, release or revert.',
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
  const none = (code: string | null, text: string): ModelsActFailure => ({ outcome: 'none', code, text: `${text} ${NOTHING_CHANGED}` });
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
    case 'unsupported':
      return none(error, 'This server cannot run it: the fleet agent predates this act, or the server has no fleet to run it on. Update the fleet box, then try again.');
    case 'unavailable': return none(error, 'The act did not start.');
    case 'busy': return none(error, 'The fleet box is running another models change. Try again in a moment.');
    case 'outcome-unknown':
      return { outcome: 'unknown', code: error, text: mayHave(cls, cause !== undefined && Object.hasOwn(UNKNOWN_CAUSE, cause) ? UNKNOWN_CAUSE[cause]! : 'The fleet box did not say how it ended') };
    case 'lane-act-refused': {
      const verb = wordIn(body, 'verbCode');
      if (verb === undefined) return none(error, 'The fleet box refused the act.');
      return none(error, Object.hasOwn(VERB_CODE_WORDS, verb) ? VERB_CODE_WORDS[verb]! : `The fleet box refused the act (${verb}).`);
    }
    case 'unauthenticated': return none(error, 'You are signed out of this console. Sign in again, then repeat it.');
    case 'foreign-origin': return none(error, 'This device is not allowed to change models: the console refused it.');
    default: break;
  }
  // No word of ours: a 401 or 403 is the gate's; any other 4xx is a refusal that proves nothing ran; a 5xx may have landed.
  if (err.status === 401) return none(null, 'You are signed out of this console. Sign in again, then repeat it.');
  if (err.status === 403) return none(null, 'This device is not allowed to change models: the console refused it.');
  if (writeOutcomeUnknown(err)) return { outcome: 'unknown', code: error ?? null, text: mayHave(cls, `The fleet box answered with an error (${err.status})`) };
  return none(error ?? null, error === undefined ? `The act was refused (${err.status}).` : `The act was refused (${error}).`);
}

// ── what the sheet shows ──

/** The fold's act that opens the sheet. */
export const MODELS_ACT = 'Models';
export const MODELS_SHEET_TITLE = 'Model classes';
export const MODELS_EMPTY_CLASS = 'No model: this class is empty on this lane.';
export const MODELS_NOT_HELD = 'Not held: an automatic advance may move it.';
export const MODELS_READ_ABSENT = 'This lane has no class registry, so its classes have no models to show.';
export const MODELS_READ_UNREADABLE = 'The lane\'s model files could not be read just now. Class names only; the sheet reads again when it is opened.';
export const MODELS_REVERT_CONFIRM = 'Put back and hold';
export const MODELS_CONFIRM_SESSIONS = 'Sessions already running may keep their current model until they are relaunched.';

export const classLabel = (cls: ModelClass): string => classWord(cls);

/** The pin as a person reads it: the catalogue's label beside the id when it has one, else the id. */
export const modelLine = (model: string | null, label: string | null): string =>
  model === null ? MODELS_EMPTY_CLASS : label !== null && label !== model ? `${label} (${model})` : model;

/** `2026-11-17T09:00:00Z` read to the minute, UTC said. */
export const minuteOf = (at: string): string => `${at.slice(0, 10)} ${at.slice(11, 16)}Z`;

export const holdWords = (h: Hold | null): string =>
  h === null ? MODELS_NOT_HELD : `Held ${h.by === 'revert' ? 'by a revert' : 'by hand'} since ${minuteOf(h.at)}.`;

export function lastMoveWords(m: HistoryEntry | null): string {
  if (m === null) return 'No move on record.';
  const how = m.how === 'advance' ? 'Advanced' : m.how === 'revert' ? 'Reverted' : 'Set by hand';
  return `${how} ${minuteOf(m.at)}: ${m.from ?? 'empty'} → ${m.to ?? 'empty'}.`;
}

/** What a Revert would put back, or `null` when there is nothing recorded. */
export const previousWords = (p: Previous | null): string | null =>
  p === null ? null : `A revert would put back ${p.model ?? 'an empty class'}.`;

export const familyWords = (family: string | null): string => (family === null ? 'No family recorded.' : `Family ${family}.`);

/** Each way the advance file can read, and the one where the answer carried no advance key at all (an agent without the
 *  op: the advance file was not read, which is not "unreported"). */
export function advanceStateWords(a: LaneAdvanceRead | undefined): { readonly state: LaneAdvanceRead['state'] | 'not-read'; readonly text: string } {
  if (a === undefined) {
    return { state: 'not-read', text: 'The advance record was not read: holds and the last move are not known, so none is offered.' };
  }
  switch (a.state) {
    case 'ok': return { state: 'ok', text: 'The advance record is read.' };
    case 'absent': return { state: 'absent', text: 'No automatic advance is on record for this lane yet.' };
    case 'unreadable': return { state: 'unreadable', text: `The advance record cannot be read: ${a.detail ?? 'no reason given'}.` };
    case 'invalid': return { state: 'invalid', text: `The advance record is not one this build reads: ${a.detail ?? 'no reason given'}.` };
    case 'unreported': return { state: 'unreported', text: 'The fleet box\'s ccrc predates the advance record, so holds are not known. Update it to hold or revert from here.' };
  }
}

/** A pending intent (D-5188): a move written down and not yet settled. */
export function pendingWords(p: Pending): string {
  const target = p.to === null ? 'emptying the class' : `moving it to ${p.to}`;
  const how = p.how === 'hand' ? 'set by hand' : 'an automatic advance';
  return `A change to the ${p.class} class is pending (${how}, ${minuteOf(p.at)}): ${target}. It settles on the fleet box by itself.`;
}

export const holdAriaLabel = (action: 'hold' | 'release', cls: ModelClass): string =>
  `${action === 'hold' ? 'Hold' : 'Release'} the ${cls} class`;
export const revertAriaLabel = (cls: ModelClass): string => `Revert the ${cls} class`;
export const revertTitle = (cls: ModelClass): string => `Revert the ${cls} class?`;
export function revertConsequence(lane: string, cls: ModelClass, current: string | null, previous: Previous | null): string[] {
  return [
    `Put back ${previous?.model ?? 'an empty class'} and hold ${cls} on ${lane}, so no automatic advance moves it until you release it.`,
    `As last read, that replaces ${current ?? 'an empty class'}.`,
    MODELS_CONFIRM_SESSIONS,
  ];
}

/** What was done, said once the box has answered (the live region's status). */
export function actDoneWords(a: LaneModelsActAnswer): string {
  const cls = a.class;
  if (a.action === 'revert') {
    return a.partial
      ? `Reverted the ${cls} class and held it, but a final bookkeeping write failed after the model moved. The sheet shows what the fleet box holds now.`
      : `Reverted the ${cls} class and held it.`;
  }
  if (a.action === 'hold') return a.changed === false ? `The ${cls} class was already held.` : `Held the ${cls} class.`;
  return a.changed === false ? `The ${cls} class was not held.` : `Released the ${cls} class.`;
}

/** The answer came back 200 but could not be read: the act may have happened. */
export const actUnreadableWords = (cls: ModelClass): string =>
  `The fleet box answered, but not in a form this console can read, so the change to the ${cls} class may have happened. The sheet is reading the lane again: check the row before you try again.`;
