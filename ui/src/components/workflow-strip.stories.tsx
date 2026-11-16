import type { Meta, StoryObj } from '@storybook/react-vite';
import type { WorkflowView } from '../../../shared/workflows';
import { WorkflowStrip } from './workflow-strip';

const agents = (n: number, phase: string, done: number, failed = 0): WorkflowView['agents'] =>
  Array.from({ length: n }, (_, i) => ({
    label: `${phase.toLowerCase()}-${i + 1}`,
    phase,
    state: i < done ? 'done' : i < done + failed ? 'failed' : 'running',
  }));

const START = Date.parse('2026-01-01T00:00:00Z');

const RUNNING: WorkflowView = {
  id: 'wf_00000000-aaa', name: 'example-flow', state: 'running', done: 19, failed: 0, total: 20,
  phase: 'Review', phases: ['Build', 'Review', 'Land'], startedAt: START, endedAt: null,
  tokens: 2_500_000, tokensUnmeasured: 0, agents: [...agents(16, 'Build', 16), ...agents(4, 'Review', 3)], agentsOmitted: 0,
};
const FAILING: WorkflowView = {
  id: 'wf_00000000-bbb', name: 'second-flow', state: 'running', done: 2, failed: 1, total: 7,
  phase: 'Verify', phases: null, startedAt: START, endedAt: null, tokens: 412_300, tokensUnmeasured: 2,
  agents: [...agents(3, 'Measure', 2, 1), ...agents(4, 'Verify', 0)], agentsOmitted: 0,
};
const FINISHED: WorkflowView = {
  ...RUNNING, id: 'wf_00000000-ccc', name: 'third-flow', state: 'completed', done: 6, total: 6,
  endedAt: START + 300_000, tokens: 98_000, agents: agents(6, 'Build', 6), phases: ['Build'],
};

const meta = {
  title: 'Components/WorkflowStrip',
  component: WorkflowStrip,
  args: { workflows: [RUNNING] },
} satisfies Meta<typeof WorkflowStrip>;
export default meta;

type Story = StoryObj<typeof meta>;

/** One running workflow, collapsed. CHECK the line reads like Claude Code's
 *  own row — name, the bar, `19/20 · <elapsed> · ↓ 2.5m tokens` — and that the
 *  head is a sentence, not a count. */
export const Running: Story = {};

/** Two running and one finished inside its 30 s. CHECK the failed agent turns
 *  the second bar amber and adds `· 1 failed`, the `+` on a token floor, and
 *  the finished row's last word `· done`. Open it: phases in script order, the
 *  current one marked `now`, done agents folded. */
export const Several: Story = { args: { workflows: [RUNNING, FAILING, FINISHED] } };

/** The source could not be read. CHECK it says so — no `0/0`, no `0 tokens`. */
export const Unreadable: Story = {
  args: {
    workflows: [{ ...FAILING, name: null, done: null, failed: null, total: null, tokens: null, startedAt: null, agents: [] }],
    unreadable: true,
  },
};
