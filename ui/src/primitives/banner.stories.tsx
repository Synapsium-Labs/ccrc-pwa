// The two tones, the sticky/static split, and the long-reason case — which is
// the one that was never visible before, because both banners this replaced
// only ever rendered inside a fleet screen under a specific health poll.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner } from './banner';
import { Button } from './button';

const meta = {
  title: 'Primitives/Banner',
  component: Banner,
  parameters: {
    docs: {
      description: {
        component:
          'A screen-level statement with an optional trailing action — shadcn’s Alert shape '
          + 'on ccrc tokens. Two tones: `dead` is the red that carries a destructive action, '
          + '`attention` the amber the fleet already uses for “waiting on you”. `sticky` pins '
          + 'it under the header, which is for a banner whose action must stay in reach while '
          + 'a list scrolls — off when recovery is a human at a terminal and there is nothing '
          + 'here to tap. A nested `<code>` drops to mono one step down, with no class needed.',
      },
    },
  },
} satisfies Meta<typeof Banner>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The amber: the host is UP and the two boxes disagree. No action, because
 *  the fix is a deploy or an edit on one of the two boxes, and the PWA can do
 *  neither. The `<code>` paths are the mono drop. */
export const Attention: Story = {
  args: {
    tone: 'attention',
    children: (
      <>
        This server and the fleet host are projecting different account rosters. Redeploy both
        boxes; if it persists, reconcile <code>~/.ccrc/accounts.json</code> on each.
      </>
    ),
  },
};

/** The red, with its action. GLOW MEANS LIFE holds here too: this is matte —
 *  a dead host does not emit, it is simply gone, and the tint plus the ink is
 *  the whole signal. */
export const Dead: Story = {
  args: {
    tone: 'dead',
    children: 'Fleet host unreachable since 4m 12s',
    action: <Button variant="primary" className="flex-none">Reboot</Button>,
  },
};

/** The substrate fault: amber, no action, a mono reason inline. This is the
 *  shape that made the component worth extracting — identical to Attention in
 *  every declaration, and it had its own 31-line stylesheet block. */
export const WithInlineReason: Story = {
  args: {
    tone: 'attention',
    children: (
      <>
        tmux unreachable on the fleet host — 3 sessions report it
        {' '}(<code>no server running on /tmp/tmux-1000/default</code>);
        sessions are still running unattached. Remedy: restart tmux or reboot.
      </>
    ),
  },
};

/** A long reason beside an action — the case that proves the message region
 *  wraps rather than pushing the button off the edge. `banner-msg` carries
 *  `flex-1 min-w-0`, and without the `min-w-0` a flex child refuses to shrink
 *  below its content. */
export const LongReasonWithAction: Story = {
  args: {
    tone: 'dead',
    children:
      'Fleet host unreachable since 2h 41m — the agent WebSocket has been down since the '
      + 'last deploy, and no session on the box has reported a heartbeat in that window.',
    action: <Button variant="primary" className="flex-none">Reboot</Button>,
  },
};
