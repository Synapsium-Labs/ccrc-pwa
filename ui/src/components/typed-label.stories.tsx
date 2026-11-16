import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { TYPE_MS, TypedLabel } from './typed-label';

const meta = {
  title: 'Components/TypedLabel',
  component: TypedLabel,
  args: { text: 'ws/quiet-mesa', className: 'font-mono text-base text-ink-primary' },
} satisfies Meta<typeof TypedLabel>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The resting state, and the one this component is in almost always: a label
 *  that has not changed since mount renders as plain text with no caret and no
 *  animation. A fleet screen typing fourteen session names in on every
 *  navigation would be a stunt, not a signal. */
export const Settled: Story = {};

/** What the component actually exists for — a workspace taking the name the
 *  model wrote for it, arriving on some later frame with nothing else on screen
 *  changing. Flip the switch to watch a rename stream in.
 *
 *  The caret is a GLYPH (▏), not a blinking stylesheet rule: an animated one
 *  would owe the contrast gate's `KEYFRAME_TROUGHS` a registered opacity trough
 *  for a mark on screen for at most `text.length * TYPE_MS` ms. */
export const Renaming: Story = {
  render: () => {
    const [name, setName] = useState('ws/quiet-mesa');
    const swap = () =>
      setName((n) => (n === 'ws/quiet-mesa' ? 'ws/fix-the-pr-sheet' : 'ws/quiet-mesa'));
    return (
      <div className="flex flex-col items-start gap-4">
        <TypedLabel className="font-mono text-base text-ink-primary" text={name} />
        <button
          type="button"
          onClick={swap}
          className="btn-ghost min-h-tap rounded-md border border-edge-strong px-4 text-ink-secondary"
        >
          rename
        </button>
      </div>
    );
  },
};

/** The accessibility property that is invisible on screen and is the whole
 *  reason the root carries `aria-label`.
 *
 *  Before that fix the accessible name replayed the animation: empty the
 *  instant a rename started, then a growing prefix on every frame. A screen
 *  reader querying mid-flight announced the workspace as unnamed. Here the
 *  rendered text and the accessible name are shown side by side while a rename
 *  is in flight — the left one streams, the right one never moves. */
export const AccessibleNameHoldsStill: Story = {
  parameters: { layout: 'padded' },
  render: () => {
    const [name, setName] = useState('ws/a');
    useEffect(() => {
      const t = setInterval(
        () => setName((n) => (n === 'ws/a' ? 'ws/second-guess-at-the-name' : 'ws/a')),
        TYPE_MS * 40,
      );
      return () => clearInterval(t);
    }, []);
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 font-mono text-sm">
        <dt className="text-ink-tertiary">rendered</dt>
        <dd className="text-ink-primary">
          <TypedLabel text={name} />
        </dd>
        <dt className="text-ink-tertiary">aria-label</dt>
        <dd className="text-ink-primary">{name}</dd>
      </dl>
    );
  },
};

/** Reduced motion: the rename lands in one frame, caret and all skipped.
 *  Storybook cannot fake the media query, so this story documents the branch —
 *  `useReducedMotion()` short-circuits straight to `setShown(text)`. Toggle the
 *  OS setting and `Renaming` above becomes this. */
export const ReducedMotion: Story = {
  args: { text: 'ws/fix-the-pr-sheet' },
};
