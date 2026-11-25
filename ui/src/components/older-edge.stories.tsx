import type { Meta, StoryObj } from '@storybook/react-vite';
import { OlderEdge, OlderGap } from './older-edge';

const meta = {
  title: 'Components/OlderEdge',
  component: OlderEdge,
  args: { state: 'more', onLoad: () => {} },
} satisfies Meta<typeof OlderEdge>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Older messages can be loaded. CHECK the control is a pill, 44px tall, centred in the column, reached by Tab with a
 *  visible ring, and that it is not a primary: loading history commits nothing. */
export const More: Story = {};

/** A page is on its way. CHECK the words change on the SAME button and that it stays focusable (aria-disabled, not
 *  disabled): a keyboard reader who pressed it keeps their place. */
export const Loading: Story = { args: { state: 'loading' } };

/** The start of what this transcript holds. CHECK the sentence says "available here" and never that the session began
 *  here: a context reset or a swap can leave earlier messages outside this transcript. No control. */
export const Start: Story = { args: { state: 'start' } };

/** The server was still reading another page for this chat. CHECK Try again is offered and the sentence does not read
 *  as a failure of the transcript. */
export const Busy: Story = { args: { state: 'busy' } };

/** The transcript is not the one the chat was paging. CHECK there is no Try again: asking again cannot help until the
 *  chat reloads its newest messages. */
export const Changed: Story = { args: { state: 'changed' } };

/** The transcript is gone. CHECK no control, and words distinct from Changed. */
export const Absent: Story = { args: { state: 'absent' } };

/** The transcript could not be read this time. CHECK Try again is offered. */
export const Unreadable: Story = { args: { state: 'unreadable' } };

/** A step could not be measured. CHECK Try again is offered, and words distinct from Unreadable. */
export const Unmeasured: Story = { args: { state: 'unmeasured' } };

/** The server no longer accepts this view's place (a restart). CHECK the words say older messages are there and that
 *  reopening the chat loads them, with no control: asking again cannot help. */
export const Expired: Story = { args: { state: 'expired' } };

/** Where a page left out records too long to load. CHECK a dashed rule across the column in mono caps, never read as a
 *  message of the session's own, and that a long line wraps inside a 360px column. */
export const Gap: Story = { render: () => <OlderGap /> };
