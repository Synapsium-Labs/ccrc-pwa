// THE ASK FIXTURES (D-6325, desktop-polish plan, T1b Global constraints): one builder for each of the twelve states an
// ask surface can be handed, so every Step 1 suite and the browser test read the SAME inputs and none restates a
// `Dialog`.
//
// Each fixture is what the session store holds once its frames have been applied (`ask`, `dialog`, `askFrameSeen`),
// beside the `frames` that produced it, in the order the stream sent them. Fixtures 6 and 11 add the fleet row the
// header reads (`session`, built by `fleetFixture.ts`, never a hand-rolled literal: `fixture-census.test.ts`).
//
// THE DEBRIS IS THE POINT. On an AskUserQuestion no string the PWA renders may come from the pane, so every pane field
// of these fixtures carries a string from `ASK_DEBRIS` instead of anything plausible: `title`, `body` and `raw` are
// box-drawn rubbish a suite can assert is ABSENT from the DOM, while the positive content (the question, the labels)
// comes from the hook envelope or the transcript copy and is asserted PRESENT. A fixture whose pane text read like a
// real question could not tell the two sources apart.
//
// Neutral names only (the repository is public): `project-a`, `ws-a`, `lane-a`, `programme-a`, `project-a-coord`.
import type { Dialog, DialogAsk, DialogMulti, FleetSession, HookAsk, HookAskQuestion, SessionStreamMsg } from '../../shared/api';
import { fleetSession } from './fleetFixture';

/** A banner row the way a pane paints one, box characters and block glyphs included. */
export const DEBRIS_BANNER = '│ ▐▛███▜▌ debris';
/** A rule of pane chrome. */
export const DEBRIS_CHROME = '╭──── pane chrome ────╮';
/** A scraped title: what `Dialog.title` carries (the nearest non-empty line above the rows). */
export const DEBRIS_TITLE = 'scraped title debris';
/** A scraped preamble line, as `Dialog.body` carries above the rows. */
export const DEBRIS_PREAMBLE = 'scraped preamble debris';
/** A line of the review's summary as the pane paints it, and as `reviewSummary` once read from `raw`. */
export const DEBRIS_REVIEW = ' ● scraped review line debris';
/** A scraped option label, for the fixtures whose rows are all the pane has. */
export const DEBRIS_LABEL = 'scraped label debris';
/** What `Dialog.raw` carries on an unparsed menu. */
export const DEBRIS_RAW = '│ unparsed pane debris │';

/** Every debris string, for a suite that asserts none of them reaches the DOM or an `askSource` answer. */
export const ASK_DEBRIS: readonly string[] = [
  DEBRIS_BANNER, DEBRIS_CHROME, DEBRIS_TITLE, DEBRIS_PREAMBLE, DEBRIS_REVIEW, DEBRIS_LABEL, DEBRIS_RAW,
];

/** The fixed clock of fixtures 6 and 11 (`since`, `notifyAt`). */
export const ASK_NOW = 1_760_000_000_000;

/** The fixture's session, as `sessionLabel` names it: `ws-a` in `project-a`. */
export const ASKER_SESSION = 'ws-a';
export const ASKER_PROJECT = 'project-a';
export const ASKER_COORD = 'project-a-coord';

export interface AskFixture {
  /** The session stream's hook envelope after `frames`. */
  ask: HookAsk | null;
  /** The pane's menu after `frames`. */
  dialog: Dialog | null;
  /** Has an `ask` or `ask_cleared` frame arrived on this connection? */
  askFrameSeen: boolean;
  /** The frames, in the order the stream sent them. */
  frames: SessionStreamMsg[];
  /** Fixtures 6 and 11: the fleet row the header reads. */
  session?: FleetSession;
}

/** The three questions of fixture 1. The first has `(Recommended)` on its first label; every option has a description;
 *  the third is a pick-several question. */
export const HOOK_QUESTIONS: readonly HookAskQuestion[] = [
  {
    question: 'Which cache should the service use?',
    header: 'Cache',
    multiSelect: false,
    options: [
      { label: 'Redis (Recommended)', description: 'Shared across instances, survives a restart.' },
      { label: 'In-process', description: 'Fastest, but every instance warms its own.' },
      { label: 'None', description: 'Skip caching until a number asks for it.' },
    ],
  },
  {
    question: 'Should tracing be on from the first deploy?',
    header: 'Tracing',
    multiSelect: false,
    options: [
      { label: 'Yes', description: 'Sampled at ten percent.' },
      { label: 'No', description: 'Add it when the first incident asks for it.' },
    ],
  },
  {
    question: 'Which regions should it deploy to?',
    header: 'Regions',
    multiSelect: true,
    options: [
      { label: 'North', description: 'The default region.' },
      { label: 'East', description: 'Closest to the batch jobs.' },
      { label: 'South', description: 'Only for the latency test.' },
    ],
  },
];

/** The envelope of fixture 1. */
export const hookEnvelope = (): HookAsk => ({ questions: HOOK_QUESTIONS.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) })) });

/** A question of forty lines, for the browser test's "one vertical scroller" case: fixture 1's envelope with a long
 *  first question. */
export const LONG_QUESTION = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a question that runs on and on.`).join('\n');
export const longHookEnvelope = (): HookAsk => {
  const ask = hookEnvelope();
  if (!('questions' in ask)) throw new Error('unreachable: hookEnvelope is a question envelope');
  ask.questions[0] = { ...ask.questions[0]!, question: LONG_QUESTION };
  return ask;
};

/** The tab row a three-question ask paints, `answered` marking `☒`. */
const tabRow = (answered: readonly boolean[]): string =>
  `←  ${HOOK_QUESTIONS.map((q, i) => `${answered[i] ? '☒' : '☐'} ${q.header}`).join('  ')}  ✔ Submit  →`;

/** The pane's rows for question 1: its three options as painted, the free-text row and `Chat about this`. */
const questionRows = (): Dialog['options'] => [
  { index: 1, label: 'Redis (Recommended)', description: 'Shared across instances, survives a restart.' },
  { index: 2, label: 'In-process', description: 'Fastest, but every instance warms its own.' },
  { index: 3, label: 'None', description: 'Skip caching until a number asks for it.' },
  { index: 4, label: 'Type something.' },
  { index: 5, label: 'Chat about this' },
];

const rawOf = (...lines: string[]): string => [DEBRIS_CHROME, ...lines, DEBRIS_CHROME].join('\n');

/** A parsed ask menu whose every pane field is debris: fixture 1's `dialog`. */
const askMenu = (over: Partial<Dialog> = {}): Dialog => ({
  id: 'dlg-a1',
  title: DEBRIS_TITLE,
  body: [DEBRIS_BANNER, DEBRIS_CHROME, DEBRIS_PREAMBLE].join('\n'),
  options: questionRows(),
  selectedIndex: 1,
  parsed: true,
  raw: rawOf(tabRow([false, false, false]), DEBRIS_PREAMBLE, ...questionRows().map((o) => `  ${o.index}. ${o.label}`)),
  ...over,
});

/** The transcript's copy of question 1, aligned to every row (`DialogAsk`: no `null`). */
const alignedAsk = (): DialogAsk => ({
  question: HOOK_QUESTIONS[0]!.question,
  header: 'Cache',
  multiSelect: false,
  options: HOOK_QUESTIONS[0]!.options.map((o) => ({ ...o })),
});

/** An unparsed pick-several menu the way `parseDialog` reads it (`Dialog.multi`, D-5048). */
const multiMenu = (): DialogMulti => ({
  options: [
    { index: 1, label: 'North', description: 'The default region.', checked: false },
    { index: 2, label: 'East', description: 'Closest to the batch jobs.', checked: true },
    { index: 3, label: 'South', description: 'Only for the latency test.', checked: false },
  ],
  freeText: { index: 4, label: 'Type something', checked: false },
  commit: 'Submit',
  cursor: 1,
});

/** The row of fixtures 6 and 11: a child of `project-a-coord` whose question its coordinator holds. */
const heldRow = (bucket: FleetSession['bucket']): FleetSession => fleetSession({
  id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: ASKER_PROJECT, workspace: ASKER_SESSION,
  bucket, hookState: 'waiting',
  withCoordinator: { kind: 'question', parentId: ASKER_COORD, since: ASK_NOW, notifyAt: ASK_NOW + 180_000 },
  ask: { state: 'held', parentId: ASKER_COORD, answeredBy: null },
});

/** The review screen of fixture 8: two rows under the ready line, with every summary line debris. */
const reviewMenu = (): Dialog => ({
  id: 'dlg-review',
  title: DEBRIS_TITLE,
  body: `${DEBRIS_REVIEW}\n${DEBRIS_REVIEW}\n\nReady to submit your answers?`,
  options: [{ index: 1, label: 'Submit answers' }, { index: 2, label: 'Cancel' }],
  selectedIndex: 1,
  parsed: true,
  raw: rawOf(tabRow([true, false, true]), '', 'Review your answers', '', DEBRIS_REVIEW, DEBRIS_REVIEW, '',
    'Ready to submit your answers?', '', '❯ 1. Submit answers', '  2. Cancel'),
});

const dialogFrame = (dialog: Dialog): SessionStreamMsg => ({ type: 'dialog', dialog });
const askFrame = (ask: HookAsk): SessionStreamMsg => ({ type: 'ask', ask, key: 'ask-key-a' });
const cleared: SessionStreamMsg = { type: 'ask_cleared' };

/** Fixture `n`, 0 to 11 (the plan's list). A fresh object on every call, so a suite may mutate it. */
export function askFixture(n: number): AskFixture {
  switch (n) {
    // none-yet: a parsed ask menu and no `ask` or `ask_cleared` frame on this connection.
    case 0: {
      const dialog = askMenu({ ask: alignedAsk() });
      return { ask: null, dialog, askFrameSeen: false, frames: [dialogFrame(dialog)] };
    }
    // hook: the envelope, with its parsed dialog.
    case 1: {
      const dialog = askMenu();
      const ask = hookEnvelope();
      return { ask, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), askFrame(ask)] };
    }
    // aged: the envelope is gone, the dialog carries a fully aligned transcript copy.
    case 2: {
      const dialog = askMenu({ ask: alignedAsk() });
      return { ask: null, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), cleared] };
    }
    // unreadable: parsed rows (two options, then the free-text row), no `ask` field.
    case 3: {
      const dialog = askMenu({
        id: 'dlg-a3',
        options: [{ index: 1, label: DEBRIS_LABEL }, { index: 2, label: DEBRIS_LABEL }, { index: 3, label: 'Type something.' }],
        // No tab row and no Chat row: the free-text row is this fixture's only evidence that an ask is up.
        raw: rawOf(DEBRIS_PREAMBLE, `  1. ${DEBRIS_LABEL}`, `  2. ${DEBRIS_LABEL}`, '  3. Type something.'),
      });
      return { ask: null, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), cleared] };
    }
    // menu: a plan approval's three rows, no `ask` field.
    case 4: {
      const dialog: Dialog = {
        id: 'dlg-a4',
        title: 'Ready to code?',
        body: [DEBRIS_BANNER, 'Ready to code?'].join('\n'),
        options: [
          { index: 1, label: 'Yes, and auto-accept edits' },
          { index: 2, label: 'Yes, and manually approve edits' },
          { index: 3, label: 'No, keep planning' },
        ],
        selectedIndex: 1,
        parsed: true,
        raw: rawOf('Ready to code?', '  1. Yes, and auto-accept edits', '  2. Yes, and manually approve edits', '  3. No, keep planning'),
      };
      return { ask: null, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), cleared] };
    }
    // unparsed: nothing could be read off the pane.
    case 5: {
      const dialog: Dialog = {
        id: 'dlg-a5', title: DEBRIS_TITLE, body: DEBRIS_PREAMBLE, options: [], selectedIndex: 0, parsed: false, raw: DEBRIS_RAW,
      };
      return { ask: null, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), cleared] };
    }
    // held: fixture 1 on a child row a coordinator holds.
    case 6:
      return { ...askFixture(1), session: heldRow('working') };
    // approval: the hook's permission envelope, no menu.
    case 7: {
      const ask: HookAsk = { approval: { tool: 'Bash', summary: 'git status' } };
      return { ask, dialog: null, askFrameSeen: true, frames: [askFrame(ask)] };
    }
    // review: fixture 1's envelope, the pane on its review screen.
    case 8: {
      const dialog = reviewMenu();
      const ask = hookEnvelope();
      return { ask, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), askFrame(ask)] };
    }
    // multi-unread: an unparsed pick-several menu, no envelope.
    case 9: {
      const dialog: Dialog = {
        id: 'dlg-a9', title: DEBRIS_TITLE, body: DEBRIS_PREAMBLE, options: [], selectedIndex: 0, parsed: false,
        raw: rawOf(tabRow([false, false, false]), DEBRIS_PREAMBLE), multi: multiMenu(),
      };
      return { ask: null, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), cleared] };
    }
    // boxed-placeholder: the free-text row drawn with box characters, and no Chat row.
    case 10: {
      const dialog = askMenu({
        id: 'dlg-a10',
        options: [
          { index: 1, label: DEBRIS_LABEL }, { index: 2, label: DEBRIS_LABEL }, { index: 3, label: '│ Type something. │' },
        ],
        raw: rawOf(DEBRIS_PREAMBLE, `  1. ${DEBRIS_LABEL}`, `  2. ${DEBRIS_LABEL}`, '  3. │ Type something. │'),
      });
      return { ask: null, dialog, askFrameSeen: true, frames: [dialogFrame(dialog), cleared] };
    }
    // held-idle: fixture 6's row gone idle, `withCoordinator` kept.
    case 11:
      return { ...askFixture(1), session: heldRow('idle') };
    default:
      throw new Error(`no ask fixture ${n}`);
  }
}
