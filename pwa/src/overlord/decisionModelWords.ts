// Settings › Overlord's decision model: its words and its pure readers (Overlord W2 Settings, plan `w2-settings.md` Tasks 1 and
// 2; spec 2026-11-09 §3.7 H6 and Table 3.7b). Ring L1: no store, no React, no DOM, no clock and no `lib/api.ts`. It imports L0
// shared vocabulary only. The decision model's cards (`DecisionModelCard.tsx`, `DecisionHostCard.tsx`, L4) draw what these answer.
//
// THE CONSOLE NEVER DECIDES WHAT A DOOR DECIDES (the brief's ruling 2). Nothing here says whether a move widens or narrows, which
// line a row is armed on, or whether a ceiling is in bounds: a card sends the move with the side it read, and the door asks the
// step-up, refuses or answers the row. What is here is reading:
// - the read goes through decision model B's one reader (`shared/decisionModel.ts#readDecisionModelView`), whole or not at all;
// - a row is drawn from the read, its checked mode the stored one, and a held row says why, by a closed list of causes;
// - a door's answer is read for the row it installed, and an off the journal refused says "held, not off".
import {
  DECISION_QUESTIONS, readDecisionModelView, readDecisionRowSide, type DecisionHeldCause, type DecisionHostKind, type DecisionModelView,
  type DecisionRowMode, type DecisionRowSide, type DecisionRowView,
} from '../../../shared/decisionModel';
import { isRecord as isObj } from '../lib/wire';

/** The read's view, or null for an answer the one reader refuses (the card says the read could not be read). */
export function decisionViewOf(body: unknown): DecisionModelView | null {
  const r = readDecisionModelView(body);
  return r.ok ? r.view : null;
}

/** A row's three states, in the order the radio set draws them. Keyed by the mode, so a mode the shared list gains without a label
 *  is a compile error. */
export const DECISION_MODE_LABELS: Readonly<Record<DecisionRowMode, string>> = { off: 'Off', shadow: 'Shadow', armed: 'Armed' };

/** Why the server held a row, one sentence per cause (`DECISION_HELD_CAUSES`, a closed list): a cause the list gains without a
 *  sentence is a compile error, and `decision-model-words.test.ts` holds the keys to the list both ways. */
export const DECISION_HELD_TEXT: Readonly<Record<DecisionHeldCause, string>> = {
  drift: "the model's answers to the fixed questions drifted from the line's",
  'line-key': "the host or model changed, so the line it was armed on no longer stands",
  canary: "the line's canary crossed",
  bound: 'the armed line missed its bound',
  'no-key': 'the key was removed',
  'off-refused': 'an off was refused by the authority journal',
};

/** The host kinds in words (`DECISION_HOST_KINDS`): the select's labels. */
export const DECISION_HOST_KIND_LABELS: Readonly<Record<DecisionHostKind, string>> = {
  hosted: 'Hosted (a provider runs the model)',
  local: 'Local (on your own network)',
  'zero-retention': 'Zero retention (a provider that keeps nothing)',
};

export const DECISION_WORDS = {
  modeLegend: 'State',
  advice: 'Advice: a wrong answer only suggests',
  gate: 'Gate: while armed, its answer can hold an act',
  privateState: 'Carries your words: never asked of a hosted model.',
  noRows: 'This server lists no decision-model rows.',
  unread: (error: string) => `The decision model could not be read (${error}).`,
  fleet: (today: number, cap: number) => `The fleet today: ${today} of ${cap} calls.`,
  ceilingLabel: 'Daily ceiling (calls)',
  saveCeiling: 'Save ceiling',
  resume: 'Resume',
  approve: 'Approve the new line',
  hostKindLabel: 'Host',
  chooseKind: 'Choose a host',
  /** A second `step-up-required` on the one retry after the confirm (the coordinator's condition 4): final, and the key is gone. */
  stepUpFinal: "Confirm it's you did not hold for this save, so nothing was saved. Type the key again, then save.",
  saving: 'Saving…',
  endpointLabel: 'Endpoint',
  modelIdLabel: 'Model id',
  keyLabel: 'Key',
  noHost: 'No host is set.',
  noKey: 'No key.',
  keySet: (date: string) => `Key set ${date}.`,
  keyNotMasked: 'This key is shorter than 20 characters, so logs cannot mask it.',
  hosted: 'A hosted model is paid per question, and its provider sees each question. Read its terms before you turn a row to shadow.',
  saveHost: 'Save host',
  removeKey: 'Remove the key',
  removeTitle: 'Remove the key?',
  removeWhy: 'Removing the key holds every armed gate.',
  removing: 'Removing…',
  keyRemoved: 'The key was removed.',
  saved: 'Saved.',
} as const;

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** What one row of the read says, beside its controls (plan SQ3). Every field is from the row as read, never from a tap. */
export interface DecisionRowLine {
  /** The question it asks: the catalogue's own text, never a second copy. */
  readonly question: string;
  readonly direction: string;
  readonly privateState: string | null;
  /** "Held: <why>. Resume to turn it on again", or null when it is not held. */
  readonly held: string | null;
  readonly today: string;
  readonly line: string;
  /** An armed gate's own line, from `side.armedLine`. */
  readonly armedOn: string | null;
  /** A newer admitted line offered to an armed gate, with its id for Approve. */
  readonly offered: { readonly text: string; readonly id: number } | null;
}

export function decisionRowLine(r: DecisionRowView): DecisionRowLine {
  const why = r.heldWhy === null ? 'the server did not say why' : DECISION_HELD_TEXT[r.heldWhy];
  const l = r.line;
  const line = l === null
    ? 'No admitted line yet.'
    : `${l.admitted ? `Line ${pct(l.line)} admitted, from ${l.labelled} labelled answers` : `Not admitted yet, ${l.labelled} labelled answers`}`
      + `${l.errors > 0 ? ` (${l.errors} errors)` : ''}; canary asked ${l.canaryAsked} of ${l.canaryExpected}, crossed ${l.canaryCrossed}.`;
  return {
    question: DECISION_QUESTIONS[r.id].instructions,
    direction: r.direction === 'gate' ? DECISION_WORDS.gate : DECISION_WORDS.advice,
    privateState: r.privateState ? DECISION_WORDS.privateState : null,
    held: r.side.held ? `Held: ${why}. Resume to turn it on again.` : null,
    today: `Today: ${r.today.total} of ${r.side.ceiling} calls${r.today.reserved > 0 ? ` (${r.today.reserved} in flight)` : ''}.`,
    line,
    armedOn: r.side.armedLine === null ? null : `Armed on line ${pct(r.side.armedLine.line)} (#${r.side.armedLine.id}).`,
    offered: r.offered === null ? null : { text: `A new line is offered: ${pct(r.offered.line)} (#${r.offered.id}).`, id: r.offered.id },
  };
}


/** A row door's answer (arm, off, ceiling): the side it installed and, for an off the journal refused, `offRefused` with the
 *  guard's cause (ruling F1). Null for an answer it cannot read, which the card answers by reading the view again. */
export interface RowAnswer { readonly side: DecisionRowSide; readonly offRefused: boolean; readonly cause: string | null }
export function rowAnswerOf(body: unknown): RowAnswer | null {
  if (!isObj(body) || body.ok !== true) return null;
  const side = readDecisionRowSide(body.side);
  if (side === null) return null;
  const offRefused = body.offRefused === true;
  return { side, offRefused, cause: offRefused && typeof body.cause === 'string' ? body.cause : null };
}

/** A row door's answer in words: "Held, not off" with the cause when the journal refused an off (SQ4), else "Saved.". An answer
 *  it cannot read says nothing: the card reads the view again either way. */
export function rowAnswerWords(body: unknown): readonly string[] {
  const a = rowAnswerOf(body);
  if (a === null) return [];
  if (a.offRefused) {
    return [`Held, not off: the authority journal could not record the change${a.cause === null ? '' : ` (${a.cause})`}. Nothing is asked while it is held.`];
  }
  return [DECISION_WORDS.saved];
}

/** The key door's answer in words: saved, and the rows the host change held (`held`, row ids the catalogue names). */
export function keyAnswerWords(body: unknown): readonly string[] {
  if (!isObj(body) || body.ok !== true) return [];
  const held = Array.isArray(body.held) ? body.held.filter((x): x is string => typeof x === 'string') : [];
  return held.length === 0 ? [DECISION_WORDS.saved] : [DECISION_WORDS.saved, `Held: ${held.join(', ')}.`];
}

/** The key removal's answer in words, with the armed gates it held. */
export function keyRemoveWords(body: unknown): readonly string[] {
  if (!isObj(body) || body.ok !== true) return [];
  const held = Array.isArray(body.held) ? body.held.filter((x): x is string => typeof x === 'string') : [];
  return held.length === 0 ? [DECISION_WORDS.keyRemoved] : [DECISION_WORDS.keyRemoved, `Held: ${held.join(', ')}.`];
}

/** The ceiling field's text as the number it sends, or null when it is not a whole number (Save is then disabled). The bounds are
 *  the door's (`bad-ceiling`): the console does not restate them. */
export function ceilingOf(text: string): number | null {
  const t = text.trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}
