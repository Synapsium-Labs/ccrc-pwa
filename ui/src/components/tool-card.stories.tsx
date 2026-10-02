import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToolCard, type ToolResultEvent, type ToolUseEvent } from './tool-card';

const T0 = '2026-10-02T14:00:00.000Z';
const T1 = '2026-10-02T14:00:04.200Z';

const use = (over: Partial<ToolUseEvent> = {}): ToolUseEvent => ({
  kind: 'tool_use',
  uuid: 'u_1',
  toolId: 'tu_1',
  ts: T0,
  name: 'Bash',
  input: "grep -rn 'attach-spin' pwa/src/session/chat.css",
  ...over,
});

const result = (over: Partial<ToolResultEvent> = {}): ToolResultEvent => ({
  kind: 'tool_result',
  toolId: 'tu_1',
  ts: T1,
  text: '2626:  animation: attach-spin var(--caret-period) linear infinite;',
  isError: false,
  ...over,
});

const ASK_INPUT = JSON.stringify({
  questions: [{ question: 'Promote this build to stable?' }],
});

const meta = {
  title: 'Components/ToolCard',
  component: ToolCard,
  args: { use: use(), result: result() },
} satisfies Meta<typeof ToolCard>;
export default meta;

type Story = StoryObj<typeof meta>;

/** A finished call, collapsed. CHECK that the whole row is 44px and that four
 *  things fit on it: a result dot, the mono tool name, a ONE-LINE input summary
 *  and a duration. The summary is the first line only — a tool card in a
 *  transcript is an index entry, not the payload. */
export const Default: Story = {};

/** Errored. CHECK that the dot turns red AND that an `ERROR` badge appears once
 *  expanded: the failure is carried by a shape as well as a hue. */
export const Errored: Story = {
  args: { result: result({ isError: true, text: 'grep: no such file (exit 2)' }) },
};

/** Running — no result yet. CHECK that the dot BREATHES (glow means life), that
 *  the duration is a live m:ss elapsed clock rather than a finished total, and
 *  that expanding shows "running…" instead of an empty result well.
 *
 *  KNOWN GAP IN THIS STORY: `@keyframes tool-breathe` stayed in the app's
 *  chat.css — it is shared with the terminal drawer's "attaching" word — so the
 *  dot holds still here and breathes in the app. */
export const Running: Story = { args: { result: undefined } };

/** Truncation. CHECK that the cue says how many bytes were CUT, and that there
 *  is ONE CUE PER WELL: input and result are cut against two different caps, so
 *  a single shared number would report one cut for two. CHECK too that a card
 *  with no `truncatedBytes` at all (every other story here) renders NO cue —
 *  absence must never be rendered as a completeness claim, because an old
 *  server can only ever produce absence. */
export const Truncated: Story = {
  args: {
    use: use({ input: 'cat server/src/coord/store.ts', truncatedBytes: 18_204 }),
    result: result({ text: 'export class CoordStore {\n  …', truncatedBytes: 92_117 }),
  },
};

/** An empty result. CHECK that the well says "(no output)" rather than
 *  rendering an empty box — a tool that answered nothing and a tool whose
 *  answer failed to render look identical otherwise. */
export const NoOutput: Story = { args: { result: result({ text: '' }) } };

/** An answered AskUserQuestion. CHECK that it does NOT render as a tool row at
 *  all: a question put to the reader is not machine work, and the generic card
 *  filed it as a line of raw JSON. The question and its answer ARE the whole
 *  event, so there is no expander over them. */
export const AskAnswered: Story = {
  args: {
    use: use({ name: 'AskUserQuestion', input: ASK_INPUT }),
    result: result({
      text: 'Your questions have been answered: "Promote this build to stable?"="Not yet — wait for the daily full suite". You can now continue with these answers.',
    }),
  },
};

/** The ask the agent is blocked on right now. CHECK that `.ask-live` is the ONE
 *  rule on this card permitted a live cue — everything else here is a record and
 *  goes still. CHECK that `Answer` is present and that it does NOT answer: it
 *  raises the hardened answer sheet, which is the single door for that act. */
export const AskAwaiting: Story = {
  args: {
    use: use({ name: 'AskUserQuestion', input: ASK_INPUT }),
    result: undefined,
    askPending: true,
    onAnswer: () => {},
  },
};

/** An ask the session moved past, or died holding. CHECK the word is
 *  "unanswered" and NOT "waiting for you", and that there is no Answer button:
 *  a dead session must not beg forever, and a control whose handler is absent is
 *  worse than no control. */
export const AskUnanswered: Story = {
  args: {
    use: use({ name: 'AskUserQuestion', input: ASK_INPUT }),
    result: undefined,
    askPending: false,
  },
};

/** An ask that came back with no answer — declined, interrupted, timed out.
 *  CHECK that the outcome row says "no answer" and folds the harness's own
 *  briefing (which runs past 1 kB) behind a tap, and that it never wears
 *  --accent-tint: that token means "this is what was chosen", and nothing was. */
export const AskNoAnswer: Story = {
  args: {
    use: use({ name: 'AskUserQuestion', input: ASK_INPUT }),
    result: result({
      text: 'The user doesn\'t want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.',
    }),
  },
};

/** An AskUserQuestion whose input was truncated past parsing. CHECK that it
 *  falls back to the GENERIC tool card rather than rendering a card with no
 *  question on it — one bad question spoils the card, because answers are
 *  matched to questions by position and a hole would slide them onto the wrong
 *  ones. */
export const AskUnparseable: Story = {
  args: {
    use: use({ name: 'AskUserQuestion', input: '{"questions":[{"question":"Promote this bui' }),
    result: result({ text: '(interrupted)' }),
  },
};

/** Overflow. CHECK that a long input summary truncates on the collapsed row
 *  (the duration and chevron must keep their place) while the expanded well
 *  scrolls inside --well-max rather than growing the transcript. */
export const Overflow: Story = {
  args: {
    use: use({
      name: 'Bash',
      input: Array.from({ length: 40 }, (_, i) => `line ${i + 1}: cd server && ./node_modules/.bin/vitest run test/contrast.test.ts`).join('\n'),
    }),
    result: result({ text: Array.from({ length: 60 }, (_, i) => `  ✓ case ${i + 1}`).join('\n') }),
  },
};
