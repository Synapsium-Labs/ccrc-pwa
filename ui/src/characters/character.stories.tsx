import type { Meta, StoryObj } from '@storybook/react-vite';
import { MOODS } from '../../../shared/face';
import { Character } from './character';

const meta = {
  title: 'Characters/Character',
  component: Character,
  parameters: { layout: 'padded' },
  args: { character: 'orb', mood: 'neutral' },
} satisfies Meta<typeof Character>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One mood at the default scale. CHECK the body takes the palette's accent and the eye its primary ink. */
export const Default: Story = {};

/** The Orb in all fourteen moods at scale 2. CHECK each reads as its label says, and the colour changes with the
 *  theme toolbar: a character owns no colour of its own. */
export const Orb: Story = {
  render: () => (
    <div className="grid justify-start gap-4" style={{ gridTemplateColumns: 'repeat(7, 64px)' }}>
      {MOODS.map((m) => <Character key={m} character="orb" mood={m} scale={2} />)}
    </div>
  ),
};

/** The Dark Lord in all fourteen moods at scale 2. */
export const DarkLord: Story = {
  render: () => (
    <div className="grid justify-start gap-4" style={{ gridTemplateColumns: 'repeat(7, 64px)' }}>
      {MOODS.map((m) => <Character key={m} character="dark-lord" mood={m} scale={2} />)}
    </div>
  ),
};

/** `play={false}`: the resting pose, as reduced motion holds it. CHECK nothing moves. */
export const Still: Story = {
  args: { mood: 'sleeping', scale: 4, play: false },
};
