// The box frames recipe's CASES (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md,
// sections 3 and 6). L0: imports only `shared/` siblings, and nothing in `pwa/src` imports it, so no draft text travels in
// the capture contract's module graph (the result, its vocabulary and its one reader are `framesResult.ts`'s). This file
// holds what is decided about the drafts and the steps, and nothing that acts:
// - each case's steps, and every text a case types: the drafts, the two earlier turns, the held turn;
// - the person's key shape and the view keys, the recipe's own named shapes (every other key is the product's);
// - `framesOurs`, every fixed text of a case, which the reducer keeps as ours;
// - the recipe's version, computed from all of it, never kept by hand.
//
// No case text travels on any wire: a case is named by its id, and the driver builds the text from this file.
import { asciiRun } from './deliveryCapture.js';
import { reducerFingerprint } from './framesReduce.js';
import { FRAMES_CASE_IDS, FRAMES_PARTS, type FramesCaseId, type FramesPane } from './framesResult.js';

// ── the texts ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A draft row's length: about 60 characters, distinct and numbered, so a frame's row names its line (the wave 185
 *  worker's ask), and one draft line is one box row at 220 columns. */
export const FRAMES_ROW_CHARS = 60;

/** Draft row `n` of `total`: `frames row NNN of MMM ` then a fixed filler, cut to {@link FRAMES_ROW_CHARS}. */
export function framesRow(n: number, total: number): string {
  const head = `frames row ${String(n).padStart(3, '0')} of ${String(total).padStart(3, '0')} `;
  let out = head;
  while (out.length < FRAMES_ROW_CHARS) out += 'abcdefghij';
  return out.slice(0, FRAMES_ROW_CHARS);
}

/** `total` draft rows. */
export const framesRows = (total: number): string[] => Array.from({ length: total }, (_, i) => framesRow(i + 1, total));

/** The long line: 900 characters, over the 800-character collapse floor, built by the delivery recipe's rule. */
export const FRAMES_LONG_LINE = asciiRun('fl', 900);

/** The row cap 2.1.300 drew, `floor((rows - 10) / 2)` (measured, plan 2026-10-15-paste-chip-send.md): 20 at 50 rows, 15
 *  at 40. A PARAMETER of the recipe's `cap` and `cap-over` drafts, never read off a frame: reading this form is what is
 *  broken, so the recipe does not measure the cap to choose a draft. */
export const framesCap300 = (pane: FramesPane): number => Math.floor((pane.rows - 10) / 2);

/** The first earlier turn: a short user turn. */
export const FRAMES_TURN_ONE = 'frames earlier turn ZQX-END-turn';

/** The neutral session id the second earlier turn, the product's mail notice, addresses (the capture owner's bound: no
 *  real session, account or host name appears in a row the reducer keeps as ours). */
export const FRAMES_NUDGE_ID = 'lane-a-project-a';

/** The second earlier turn's text: `server/src/coord/envelope.ts#renderMailNudge(FRAMES_NUDGE_ID)`, written here once
 *  because the agent, which reduces on the test box, cannot import server code. `server/test/frames-capture.test.ts` holds
 *  it equal to the product's own render, so a change to the notice turns that test red until this follows. The driver
 *  types the product's own render, never this copy. */
export const FRAMES_NUDGE_TEXT = 'ccrc-mail: you have new mail. Use the client, never curl or raw HTTP: '
  + `~/.local/bin/ccrc-api mail list --to ${FRAMES_NUDGE_ID} ; then per row use its deliveryId, NOT id: `
  + '~/.local/bin/ccrc-api mail fetch <deliveryId> and ~/.local/bin/ccrc-api mail ack <deliveryId> --json - '
  + `with body {"fromId":"${FRAMES_NUDGE_ID}","fromUuid":"<your uuid>"}. `
  + 'Invoke by that exact path — ~/.local/bin is not on this unit\'s PATH. '
  + 'The client resolves the server address and reads the box token itself, so you '
  + 'handle neither, and it works in a repo whose settings deny curl.';

/** The marker the stand-in holds a turn open on, and the held turn's text (`queued`). */
export const FRAMES_HOLD_MARK = 'ZQX-HOLD';
export const FRAMES_HOLD_TEXT = `frames held turn ${FRAMES_HOLD_MARK}`;

/** The text every frames request is answered with (the stand-in's rule). */
export const FRAMES_REPLY_TEXT = 'ccrc frames: ok';

// ── the steps ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A view key: the recipe's own `view-up` shape. */
export type FramesViewKey = 'Up' | 'PageUp';

/** One step of a case, after the model switch. `turn`: the product's send of an earlier turn, then its Stop. `type`: the
 *  draft through the send's own line loop (`send`), or as a person types (`person`, the recipe's own shape). `keys`: view
 *  keys. `stash`: the send's own stash key. `send`: the product's send of the draft, then its Stop. `held`: the product's
 *  send of the held turn, then its UserPromptSubmit, the stand-in holding the reply. `queued`: the product's send of the
 *  draft while the held turn runs. `frame`: the frame. */
export type FramesStep =
  | { readonly kind: 'turn'; readonly which: 1 | 2 }
  | { readonly kind: 'type'; readonly shape: 'send' | 'person' }
  | { readonly kind: 'keys'; readonly keys: readonly FramesViewKey[] }
  | { readonly kind: 'stash' }
  | { readonly kind: 'send' }
  | { readonly kind: 'held' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'frame' };

const T = (shape: 'send' | 'person' = 'send'): FramesStep => ({ kind: 'type', shape });
const F: FramesStep = { kind: 'frame' };
const TURNS: readonly FramesStep[] = [{ kind: 'turn', which: 1 }, { kind: 'turn', which: 2 }];

type BaseCase = Exclude<FramesCaseId, `${string}-turns`>;

/** Each base case's steps (plan section 3). */
const BASE_STEPS: Readonly<Record<BaseCase, readonly FramesStep[]>> = {
  empty: [F],
  'rows-3': [T(), F], cap: [T(), F], 'cap-over': [T(), F], 'rows-25': [T(), F], 'rows-180': [T(), F],
  'long-in-view': [T(), F], 'long-out': [T(), F],
  'up-3': [T(), { kind: 'keys', keys: ['Up', 'Up', 'Up'] }, F],
  'up-3-pageup': [T(), { kind: 'keys', keys: ['Up', 'Up', 'Up', 'PageUp'] }, F],
  person: [T('person'), F],
  submitted: [{ kind: 'send' }, F],
  chip: [T(), F],
  stash: [T(), { kind: 'stash' }, F],
  queued: [{ kind: 'held' }, { kind: 'queued' }, F],
};

const baseOf = (c: FramesCaseId): BaseCase => (c.endsWith('-turns') ? c.slice(0, -'-turns'.length) : c) as BaseCase;

/** A case's steps: its base case's, after the two earlier turns for a `-turns` case. */
export const framesSteps = (c: FramesCaseId): readonly FramesStep[] => (c.endsWith('-turns') ? [...TURNS, ...BASE_STEPS[baseOf(c)]] : BASE_STEPS[baseOf(c)]);

/** A case's draft lines at `pane`, in the order they are typed (the queued message for `queued`). */
export function framesDraftLines(c: FramesCaseId, pane: FramesPane): readonly string[] {
  switch (baseOf(c)) {
    case 'empty': return [];
    case 'rows-3': return framesRows(3);
    case 'cap': return framesRows(framesCap300(pane));
    case 'cap-over': return framesRows(framesCap300(pane) + 1);
    case 'rows-25': return framesRows(25);
    case 'long-in-view': { const r = framesRows(180); r[179] = FRAMES_LONG_LINE; return r; }
    case 'long-out': { const r = framesRows(180); r[1] = FRAMES_LONG_LINE; return r; }
    case 'chip': return [FRAMES_LONG_LINE];
    case 'stash': return ['frames stash probe ZQX-END-stash'];
    case 'queued': return ['frames queued probe ZQX-END-queued'];
    case 'rows-180': case 'up-3': case 'up-3-pageup': case 'person': case 'submitted': return framesRows(180);
  }
}

/** The text an earlier turn sends. */
export const framesTurnText = (which: 1 | 2): string => (which === 1 ? FRAMES_TURN_ONE : FRAMES_NUDGE_TEXT);

/** Every fixed text a case puts on the screen: its draft lines, its earlier turns, the held turn and the stand-in's reply.
 *  The reducer keeps a row as ours only when its whole squashed text is a run of one of these (plan 5.2 rule 2). */
export function framesOurs(c: FramesCaseId, pane: FramesPane): readonly string[] {
  const steps = framesSteps(c);
  const turns = steps.flatMap((s) => (s.kind === 'turn' ? [framesTurnText(s.which)] : []));
  const held = steps.some((s) => s.kind === 'held') ? [FRAMES_HOLD_TEXT] : [];
  return [...framesDraftLines(c, pane), ...turns, ...held, FRAMES_REPLY_TEXT];
}

/** The first characters Claude Code's box reads as a mode switch. No frames text starts with one (pinned). */
export const FRAMES_MODE_CHARS: readonly string[] = Object.freeze(['/', '!', '#', '@']);

// ── the person's shape and the view keys (the recipe's own) ──────────────────────────────────────────────────────

/** The person's shape: each line as plain literal bursts of this many characters, this far apart, each line break as the
 *  Enter-free newline Claude Code documents. Not the product's per-line loop. */
export const FRAMES_PERSON = Object.freeze({ burst: 8, pauseMs: 15, newline: 'C-j' as const });

/** The pause between two view keys. */
export const FRAMES_VIEW_KEY_PAUSE_MS = 250;

// ── the version ──────────────────────────────────────────────────────────────────────────────────────────────────

/** FNV-1a over a string's UTF-16 code units, from `seed`: 32 bits. Pure and the same on every engine (the delivery
 *  recipe's rule, kept beside its own version as that one is). */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The recipe's version: 16 hex characters computed from the part list, every case's steps, every draft at every pane, the
 *  turn, hold and reply texts, the person's shape, the view pause and `extra` (the reducer's answers on its probe table,
 *  passed by `framesReduce.ts`, so a change in what the reducer does changes the version). The lane measures a build
 *  again when no frames row exists for it at this version. */
export function framesRecipeVersionOf(extra = ''): string {
  const cases = FRAMES_CASE_IDS.map((c) => [c, framesSteps(c), FRAMES_PARTS.filter((p) => p.case === c).map((p) => framesDraftLines(c, p.pane))]);
  const text = JSON.stringify({
    parts: FRAMES_PARTS, cases, turns: [FRAMES_TURN_ONE, FRAMES_NUDGE_TEXT], hold: FRAMES_HOLD_TEXT, reply: FRAMES_REPLY_TEXT,
    person: FRAMES_PERSON, viewPause: FRAMES_VIEW_KEY_PAUSE_MS, extra,
  });
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  return hex(fnv1a(text, 0x811c9dc5)) + hex(fnv1a(text, 0x9e3779b9));
}

/** THE recipe version: the cases with the reducer's answers on its probe table. */
export const FRAMES_RECIPE_VERSION: string = framesRecipeVersionOf(reducerFingerprint());
