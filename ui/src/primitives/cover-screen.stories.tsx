import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { CoverScreen } from './cover-screen';

const meta = {
  title: 'Primitives/CoverScreen',
  component: CoverScreen,
  // `fullscreen`, because `padded` would put a gutter around a component whose
  // entire claim is that there is no gutter: it is `fixed inset-0`.
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CoverScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The stale-build block. CHECK that nothing is reachable behind it — the
 *  cover is the whole affordance, and a story that renders it over other
 *  content is the only place that claim is visible. */
export const AStaleBuild: Story = {
  args: {
    className: 'gap-5 bg-page text-ink-primary',
    role: 'alert',
    children: (
      <>
        <p className="m-0 max-w-[40ch] font-ui text-base font-medium leading-normal">
          This app build is too old for the fleet server. Updating…
        </p>
        <Button variant="primary" className="w-auto min-w-[180px]">Reload</Button>
      </>
    ),
  },
};

/** The session gate. CHECK the two gaps against each other: this one is
 *  `--sp-4` and the block screen above is `--sp-5`, which is the single
 *  declaration the two rules disagreed on and the reason the component
 *  carries no gap of its own. */
export const ASessionGate: Story = {
  args: {
    className: 'gap-4 bg-page text-ink-primary',
    role: 'dialog',
    'aria-modal': true,
    /* A dialog MUST be named, and `LoginScreen` — the real call site this
       story reconstructs — names itself exactly this way. The story did not,
       and axe's `aria-dialog-name` said so the first time a browser rendered
       it: a fixture that models the one thing the app gets right, wrong. */
    'aria-labelledby': 'cover-screen-story-title',
    children: (
      <>
        <h1
          id="cover-screen-story-title"
          className="m-0 font-mono text-lg font-semibold leading-tight tracking-[0.04em]"
        >
          ccrc
        </h1>
        <p className="m-0 max-w-[40ch] font-ui text-base font-medium leading-normal">
          This console is gated. Sign in to reach the fleet.
        </p>
        <Button variant="primary" className="max-w-[320px]">Sign in</Button>
      </>
    ),
  },
};
