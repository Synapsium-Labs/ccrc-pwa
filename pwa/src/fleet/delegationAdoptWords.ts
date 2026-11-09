// D-8114 (delegation broker wave 5 PR8c): the Settings card "Worktrees left behind", its pure half: the card's words, the wire
// guard for the switch's view, the radio it checks, the lines for the lane's last pass, and the confirm's words.
// `DelegationAdoptSection.tsx` has no words of its own.
//
// THE OPERATOR'S WORDS ARE "keep a worktree", "kept" and "the change check" (W4-U10, D-7845). No exported string here, and
// no string an exported function returns, says the broker's own names for these things or claims anything is happening
// now (the word itself included, review 1693 F10): `delegation-adopt-section.test.tsx` collects them all and holds the census.
// The one exception is ruled (review 1693 F9): a failed write that is not one of the door's words is said by the ccd write
// reader (`verbWriteFailure`), which relays the server's detail as the precedent cards relay it; that detail is the server's
// data, not this card's words.
import {
  delegationAdoptionKeepsOf, isMarkerState, type DelegationAdoptionHealth, type DelegationAdoptionKeep,
} from '../../../shared/api';
import {
  DELEGATION_ADOPT_CAPS, isDelegationAdoptOnRefusal, isDelegationAdoptRefusal, type DelegationAdoptCap, type DelegationAdoptOnRefusal,
  type DelegationAdoptView,
} from '../../../shared/delegation-adopt';
import { ApiError } from '../lib/apiError';
import { isCount, isRecord } from '../lib/wire';
import { PANE_SCOPE_STOP_TEXT } from './paneScopeStopWords';
import { SCOPE_SWEEP_TEXT } from './scopeSweepWords';
import { VERB_WRITE_TEXT, verbWriteFailure } from './verbWriteFailure';

/** The switch's two choices, as the card's radios spell them; `POST /api/coord/delegation-adopt` takes `{on}`. */
export type DelegationAdoptChoice = 'off' | 'on';

// `unmeasured` and `stale` are the neighbouring switch cards' sentences, taken from them so the same words are spelled once.
export const DELEGATION_ADOPT_TEXT = {
  title: 'Worktrees left behind',
  purpose: 'Whether the server keeps a changed worktree that a finished delegated agent or workflow left behind. A kept '
    + 'worktree is held back from the disk sweep, and the session that started the agent is mailed about it.',
  legend: 'Keeping worktrees',
  off: 'Do not keep',
  offNote: 'The server stops keeping new worktrees. Worktrees it has already kept stay held back from the disk sweep until '
    + 'their hold ends.',
  on: 'Keep them',
  onNote: 'The server keeps a worktree that a finished delegated agent or workflow left changed, holds it back from the disk '
    + 'sweep and mails the session that started the agent. A worktree the change check finds unchanged is left to the sweep.',
  unmeasured: PANE_SCOPE_STOP_TEXT.unmeasurable,
  unread: 'This could not be read.',
  stale: SCOPE_SWEEP_TEXT.stale,
  nothingCounted: 'No pass has counted a worktree yet, or the last pass counted nothing.',
  noList: 'The last pass served no list of worktrees.',
  noChanges: 'No change check was read for this worktree.',
  confirmTitle: 'Keep worktrees?',
  confirmLabel: 'Keep worktrees',
  confirmCannotCount: 'No pass has counted a worktree yet, or the last pass counted nothing, so this card cannot say how many this '
    + 'would keep.',
  confirmUntilNextPass: 'The last pass did not count what turning this on would keep, so this card cannot say how many until the '
    + 'next pass.',
  confirmMail: 'The session that started each agent is mailed about its worktree. A kept worktree stays held back from the '
    + 'disk sweep until its hold ends.',
  ...VERB_WRITE_TEXT,
} as const;

/** The door's refusal words, each in the operator's words: its three, and `on`'s own `sign-in-unarmed` (review 1665 N6); keyed by
 *  the L0 type, so a new word is a compile error here until it has a sentence. The server's own detail names its internals and is
 *  never shown. */
export const DELEGATION_ADOPT_REFUSAL_TEXT: Readonly<Record<DelegationAdoptOnRefusal, string>> = {
  'fleet-caps-unmeasured': 'The fleet box did not report what it can do, so this cannot be turned on until it does. Try again shortly.',
  'fleet-switch-missing': 'The fleet box has no switch for this yet, so it cannot be changed until its ccrc is updated.',
  'fleet-audit-missing': 'The fleet box cannot check whether a worktree changed, so it would keep every finished worktree. '
    + 'Update the fleet box first.',
  'sign-in-unarmed': 'Turning this on needs sign-in to be armed on this server, and you to be signed in.',
};

const MODE_LINE: Readonly<Record<DelegationAdoptionHealth['mode'], string>> = {
  live: 'Keeping was on at the last pass. The counts are from that pass.',
  shadow: 'Not keeping yet. The last pass only recorded the worktrees it would keep.',
  suspended: 'Paused. The server is holding off until its own check clears.',
  unmeasured: 'The server could not read whether it keeps worktrees at the last pass.',
};

const MODES: readonly string[] = ['live', 'shadow', 'suspended', 'unmeasured'];
const CAPS: readonly unknown[] = DELEGATION_ADOPT_CAPS;

const COUNT_KEYS = ['adopted', 'wouldAdopt', 'waiting', 'unchanged', 'unaudited', 'conflicting', 'unsupported', 'uncensused', 'owed'] as const;

/** The last pass: its mode and counts checked here, its list read through `keeps`' one reader, `delegationAdoptionKeepsOf`
 *  (review 1693 F1). A list that reader refuses is dropped, so the card reads it as "served no list", as the shared readers do,
 *  and a bad list never costs the switch. */
function asHealth(raw: unknown): DelegationAdoptionHealth | null {
  if (!isRecord(raw) || typeof raw.mode !== 'string' || !MODES.includes(raw.mode)) return null;
  for (const k of COUNT_KEYS) if (!isCount(raw[k])) return null;
  const { keeps: _unread, ...rest } = raw;
  const counts = rest as unknown as DelegationAdoptionHealth;
  const keeps = delegationAdoptionKeepsOf(raw as Pick<DelegationAdoptionHealth, 'keeps'>);
  return keeps === null ? counts : { ...counts, keeps };
}

/** The view, whole, or null: the marker, both capabilities, each direction's refusal and the last pass. `adoption` null (or
 *  absent) is the lane that has counted nothing yet; any other shape that is not a pass is no view at all. */
export function asDelegationAdoptView(raw: unknown): DelegationAdoptView | null {
  if (!isRecord(raw)) return null;
  const { state, caps, refused, adoption } = raw;
  if (!isMarkerState(state) || !isRecord(caps) || !isRecord(refused)) return null;
  if (!CAPS.includes(caps.verb) || !CAPS.includes(caps.audit)) return null;
  const { on, off } = refused;
  // `on` reads the door's three words and its own `sign-in-unarmed`; `off` the three only (review 1665 N6).
  const refusalOf = <W>(v: unknown, is: (x: unknown) => x is W): W | null | undefined => (v === null ? null : is(v) ? v : undefined);
  const refusedOn = refusalOf(on, isDelegationAdoptOnRefusal);
  const refusedOff = refusalOf(off, isDelegationAdoptRefusal);
  if (refusedOn === undefined || refusedOff === undefined) return null;
  const health = adoption === null || adoption === undefined ? null : asHealth(adoption);
  if (health === null && adoption !== null && adoption !== undefined) return null;
  return {
    state,
    caps: { verb: caps.verb as DelegationAdoptCap, audit: caps.audit as DelegationAdoptCap },
    refused: { on: refusedOn, off: refusedOff },
    adoption: health,
  };
}

/** The radio the server's answer checks: neither for a registry it could not list, so either tap can replace it. */
export function delegationAdoptChecked(view: DelegationAdoptView): DelegationAdoptChoice | null {
  return view.state === 'set' ? 'on' : view.state === 'clear' ? 'off' : null;
}

/** Whether the switch could not be read, so the card cannot say what stands. */
export const delegationAdoptUnmeasured = (view: DelegationAdoptView): boolean => view.state === 'unmeasurable';

/** The lane's mode at its last pass, or that it has counted nothing since the server started (`adoption` null). */
export function delegationAdoptModeLine(adoption: DelegationAdoptionHealth | null): string {
  return adoption === null ? DELEGATION_ADOPT_TEXT.nothingCounted : MODE_LINE[adoption.mode];
}

/** The last pass's counts, in the operator's words, every one shown even at zero. */
export function delegationAdoptCountsLine(h: DelegationAdoptionHealth): string {
  return `Last pass: kept ${h.adopted}, would keep ${h.wouldAdopt}, waiting ${h.waiting}, unchanged ${h.unchanged}, `
    + `not yet checked ${h.unaudited}, waiting for your choice ${h.conflicting}, not possible on the fleet box ${h.unsupported}, `
    + `in projects not read ${h.uncensused}, mails owed ${h.owed}.`;
}

const CAP_LABEL = { verb: 'The fleet box\'s keep switch', audit: 'The fleet box\'s change check' } as const;
const CAP_STATE: Readonly<Record<DelegationAdoptCap, string>> = {
  present: 'is available.', absent: 'is missing.', unmeasured: 'could not be read.',
};
/** One capability's line: the switch's verb or the change check, each available, missing or not read. */
export function delegationAdoptCapLine(which: 'verb' | 'audit', cap: DelegationAdoptCap): string {
  return `${CAP_LABEL[which]} ${CAP_STATE[cap]}`;
}

/** Why a choice cannot be made: the choice's label and the refusal's sentence. */
export function delegationAdoptRefusedLine(label: string, word: DelegationAdoptOnRefusal): string {
  return `${label} is not available. ${DELEGATION_ADOPT_REFUSAL_TEXT[word]}`;
}

/** The list's heading: what the last pass would keep in shadow, what it kept when live. */
export function delegationAdoptKeepsHeading(mode: DelegationAdoptionHealth['mode']): string {
  return mode === 'shadow' ? 'Worktrees the last pass would keep' : mode === 'live' ? 'Worktrees the last pass kept' : 'Worktrees the last pass listed';
}

/** One worktree's line: the project, the worktree's name and the session that started the agent. */
export function delegationAdoptKeepLine(k: DelegationAdoptionKeep): string {
  return `${k.project} / ${k.worktree}, session ${k.parent}`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What the change check measured, one phrase each; `unmeasured` is worded as not read, never as no change. */
export function delegationAdoptKeepChanges(c: NonNullable<DelegationAdoptionKeep['changes']>): string[] {
  const dirty = c.dirty === 'unmeasured' ? 'uncommitted changes not read' : c.dirty ? 'uncommitted changes' : 'no uncommitted changes';
  const ahead = c.aheadOfBase === 'unmeasured' ? 'commits ahead of base not read'
    : `${plural(c.aheadOfBase, 'commit', 'commits')} ahead of base`;
  const branch = c.branchAheadOfBase === 'unmeasured' ? 'branch not read'
    : c.branchAheadOfBase === 'no-branch' ? 'no branch'
    : c.branchAheadOfBase === 'branch-gone' ? 'its branch is gone'
    : `${plural(c.branchAheadOfBase, 'commit', 'commits')} ahead on its branch`;
  return [dirty, ahead, branch];
}

/** The line after the list when the pass kept more than it names. */
export function delegationAdoptKeepsMore(n: number): string {
  return `and ${n} more`;
}

const are = (n: number): string => `${n} ${n === 1 ? 'is' : 'are'}`;

/** The confirm sheet's words (review 1693 F8, review 1699 R2-4, ruled): when the last pass ran in shadow, how many worktrees
 *  turning this on would keep, the same figure the counts line shows (`wouldAdopt`), whether or not a list was served, and, when
 *  the list leaves some off, how many it lists and how many it does not. In any other mode the last pass did not count that (in
 *  live mode it counts what it kept, and the list is what was kept), so the sheet says the card cannot tell until the next pass
 *  and lists nothing. With `adoption` null no pass counted anything. Every sheet says the owners are mailed. */
export function delegationAdoptConfirm(adoption: DelegationAdoptionHealth | null): { title: string; consequence: string[]; confirmLabel: string } {
  const T = DELEGATION_ADOPT_TEXT;
  if (adoption === null) return { title: T.confirmTitle, consequence: [T.confirmCannotCount, T.confirmMail], confirmLabel: T.confirmLabel };
  if (adoption.mode !== 'shadow') return { title: T.confirmTitle, consequence: [T.confirmUntilNextPass, T.confirmMail], confirmLabel: T.confirmLabel };
  const keeps = delegationAdoptionKeepsOf(adoption);
  const count = `This would keep ${plural(adoption.wouldAdopt, 'worktree', 'worktrees')}, the count from the last pass.`;
  const listed = keeps !== null && keeps.more > 0
    ? [`${are(keeps.items.length)} listed on this card and ${are(keeps.more)} not.`]
    : [];
  return { title: T.confirmTitle, consequence: [count, ...listed, T.confirmMail], confirmLabel: T.confirmLabel };
}

/** A write's rejection, as its line: the door's own words (its three and `on`'s `sign-in-unarmed`) in the card's sentences,
 *  anything else as the ccd write reader says it (`verbWriteFailure`: a refusal moved nothing, anything else proves nothing about
 *  the write). */
export function delegationAdoptFailure(err: unknown): { text: string; tone: 'refusal' | 'answer' } {
  if (err instanceof ApiError && isRecord(err.body) && isDelegationAdoptOnRefusal(err.body.error)) {
    return { text: DELEGATION_ADOPT_REFUSAL_TEXT[err.body.error], tone: 'refusal' };
  }
  return verbWriteFailure(err);
}
