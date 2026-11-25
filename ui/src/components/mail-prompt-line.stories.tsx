import type { Meta, StoryObj } from '@storybook/react-vite';
import { MailPromptLine, MailPromptText } from './mail-prompt-line';

const PROMPT =
  'ccrc-mail: you have new mail. Use the client, never curl or raw HTTP: ~/.local/bin/ccrc-api mail list --to lane-a ; ' +
  'then per row use its deliveryId, NOT id: ~/.local/bin/ccrc-api mail fetch <deliveryId> and ~/.local/bin/ccrc-api ' +
  'mail ack <deliveryId> --json - with body {"fromId":"lane-a","fromUuid":"<your uuid>"}.';

const meta = {
  title: 'Components/MailPromptLine',
  component: MailPromptLine,
  args: {
    title: 'Mail arrived',
    count: null,
    time: '14:02',
    label: 'Mail arrived, 14:02',
    open: false,
    onToggle: () => {},
    children: <MailPromptText text={PROMPT} />,
  },
} satisfies Meta<typeof MailPromptLine>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The lane's line, closed. CHECK that it is ONE quiet line at the tap floor (44px), in a system pill's ink, never a
 *  bubble from the person; that Tab reaches it and Enter opens it; and that a screen reader says "Mail arrived, 14:02"
 *  and "collapsed". */
export const Closed: Story = {};

/** Open: the prompt's full text, verbatim. CHECK that it wraps inside the column and is not Markdown (the braces and
 *  the angle brackets read as typed). */
export const Open: Story = { args: { open: true } };

/** A run of prompts with nothing a person would read between them, closed. CHECK the count and the time range. */
export const Run: Story = {
  args: { count: '3 times', time: '14:02 to 14:40', label: 'Mail arrived 3 times, 14:02 to 14:40' },
};

/** The run, open: its own lines, each closed. */
export const RunOpen: Story = {
  args: {
    count: '3 times',
    time: '14:02 to 14:40',
    label: 'Mail arrived 3 times, 14:02 to 14:40',
    open: true,
    children: ['14:02', '14:20', '14:40'].map((t) => (
      <MailPromptLine key={t} title="Mail arrived" count={null} time={t} label={`Mail arrived, ${t}`} open={false} onToggle={() => {}}>
        <MailPromptText text={PROMPT} />
      </MailPromptLine>
    )),
  },
};
