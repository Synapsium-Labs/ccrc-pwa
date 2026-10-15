// The recorded AskUserQuestion screens, as the sheet's tests read them (D-5089, plan
// docs/superpowers/plans/2026-10-15-ask-sheet-half.md, "The shapes the tests hand-build").
//
// The PWA does not import server code, so its tests hand-build `Dialog` objects. These are COPIED from `parseDialog`,
// never invented: `ask-panes.json` holds each recorded screen's reading without its `raw`, keyed by the fixture's
// name, and `pane()` attaches `raw` from the fixture file itself (`server/test/fixtures/panes/<name>.txt`, Claude Code
// 2.1.300 unless the name says otherwise). `server/test/dialog.test.ts` re-parses every entry and compares it with the
// JSON, so a parser change cannot leave these tests reading stale screens. A shape no recording shows is built in the
// test that needs it and marked DERIVED there.
//
// The envelopes below are the recorded asks, read off each fixture's own prompt line: the questions, headers,
// `multiSelect` and labels the prompt asked for. A description is copied from the recorded screen that paints that
// question (`fromPane`, `fromMulti`); a question no recording paints carries labels only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Dialog, HookAskQuestion } from '../../shared/api';

const panesDir = path.join(import.meta.dirname, '..', '..', 'server', 'test', 'fixtures', 'panes');
const READINGS = JSON.parse(readFileSync(path.join(import.meta.dirname, 'ask-panes.json'), 'utf8')) as Record<
  string,
  Omit<Dialog, 'raw'>
>;

/** The recorded screen `name` as `parseDialog` reads it, `raw` included. A fresh copy on every call, so a test may
 *  DERIVE from it without touching another test's reading. */
export function pane(name: string): Dialog {
  const reading = READINGS[name];
  if (reading === undefined) throw new Error(`ask-panes.json has no reading for ${name}`);
  const raw = readFileSync(path.join(panesDir, `${name}.txt`), 'utf8');
  return { ...(structuredClone(reading) as Omit<Dialog, 'raw'>), raw };
}

/** An envelope of AskUserQuestion questions, as the hook writes it. */
export interface AskEnvelope {
  questions: HookAskQuestion[];
}

type EnvOption = HookAskQuestion['options'][number];

/** The first `n` parsed rows of a recorded screen, as an envelope question's options (label and description). */
function fromPane(name: string, n: number): EnvOption[] {
  return pane(name).options.slice(0, n).map(({ label, description }) =>
    description === undefined ? { label } : { label, description });
}

/** A recorded multiSelect screen's boxes, as an envelope question's options. */
function fromMulti(name: string): EnvOption[] {
  const multi = pane(name).multi;
  if (multi === undefined) throw new Error(`${name} carries no Dialog.multi`);
  return multi.options.map(({ label, description }) => (description === undefined ? { label } : { label, description }));
}

const labels = (...ls: string[]): EnvOption[] => ls.map((label) => ({ label }));

function q(header: string, question: string, multiSelect: boolean, options: EnvOption[]): HookAskQuestion {
  return { question, header, multiSelect, options };
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

const envelope = (...questions: HookAskQuestion[]): AskEnvelope => deepFreeze({ questions });

/** One single-select question (`cc300-ask-1q-open`). */
export const COLOUR_ONE = envelope(q('Colour', 'Which colour?', false, fromPane('cc300-ask-1q-open', 2)));

/** Two single-select questions (`cc300-ask-q2-of-2-single`, `cc300-ask-freetext-held`). */
export const FRUIT_DRINK = envelope(
  q('Fruit', 'Which fruit?', false, fromPane('cc300-ask-freetext-held', 2)),
  q('Drink', 'Which drink?', false, fromPane('cc300-ask-q2-of-2-single', 2)),
);

/** Two single-select questions with the same labels (`cc300-ask-same-labels-q1`, `-q2`, the free-text walk, the
 *  review). */
export const CACHING_TRACING = envelope(
  q('Caching', 'Enable caching?', false, fromPane('cc300-ask-same-labels-q1', 2)),
  q('Tracing', 'Enable tracing?', false, fromPane('cc300-ask-same-labels-q2', 2)),
);

/** The markdown question, verbatim (markdown is literal on screen); the question too long for one row; two short ones
 *  no recording paints (`cc300-ask-markdown-question`, `-wrapped-question`, `-freetext-1000`, `-review-4q-long`). */
export const FOUR_Q = envelope(
  q('Engine', 'Should the `ledger` table use **Postgres** or SQLite?', false,
    fromPane('cc300-ask-markdown-question', 2)),
  q('Order', 'When the new release is ready, in which order should the two machines be updated, given that the second '
    + 'machine reads files the first machine writes and caches its settings at start-up, so a change that widens a '
    + 'reader must land before any writer that relies on it?', false, fromPane('cc300-ask-wrapped-question', 2)),
  q('Notes', 'Any notes for the reviewer?', false, labels('None', 'Later')),
  q('Region', 'Which region?', false, labels('EU', 'US')),
);

/** A single-select question, then a multiSelect one (`cc300-ask-q1-of-2`, `-multiselect-freetext-ticked`). */
export const COLOUR_FEATURES = envelope(
  q('Colour', 'Which colour do you prefer?', false, fromPane('cc300-ask-q1-of-2', 3)),
  q('Features', 'Which features do you want?', true, fromMulti('cc300-ask-multiselect-freetext-ticked')),
);

/** A single-select question, then two multiSelect ones (`cc300-ask-multiselect-next-open` and its walk,
 *  `-submit-open`, `-review-multiselect`). No recording paints its first question. */
export const DRINK_FEATURES_TOOLS = envelope(
  q('Drink', 'Which drink?', false, labels('Tea', 'Coffee')),
  q('Features', 'Which features do you want?', true, fromMulti('cc300-ask-multiselect-next-open')),
  q('Tools', 'Which tools?', true, fromMulti('cc300-ask-multiselect-submit-open')),
);

/** Two multiSelect questions (`cc300-ask-multiselect-tools-*`, `-sizes-*`, `-review-tick-order`). */
export const TOOLS_SIZES = envelope(
  q('Tools', 'Which tools?', true, fromMulti('cc300-ask-multiselect-tools-open')),
  q('Sizes', 'Which sizes?', true, fromMulti('cc300-ask-multiselect-sizes-open')),
);

/** Two multiSelect questions (`cc300-ask-multiselect-walk-to-next`). No recording paints its second question. */
export const PETS_SIZES = envelope(
  q('Pets', 'Which pets?', true, fromMulti('cc300-ask-multiselect-walk-to-next')),
  q('Sizes', 'Which sizes?', true, labels('Small', 'Large')),
);

/** A multiSelect question, then two single-select ones; answered with the second skipped (`cc300-ask-review-skipped`).
 *  No recording paints its questions. */
export const PETS_SIZE_MODE = envelope(
  q('Pets', 'Which pets do you like?', true, labels('Cats', 'Dogs', 'Fish')),
  q('Size', 'Which size?', false, labels('Small', 'Large')),
  q('Mode', 'Which mode?', false, labels('Fast', 'Safe')),
);
