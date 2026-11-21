import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AgentHelperView, WorkflowView } from '../../../shared/workflows';
import { HelpersStrip, type HelperItem, type HelpersView } from './workflow-strip';

// Session helpers H2 (D-8872): the Helpers section, which replaced the workflow strip in place. Its head words and lists
// come from the PWA's words module; these stories hand them in as it would. Invented data, neutral names.
const NOW = Date.now();
const agent = (id: string, o: Partial<AgentHelperView> = {}): HelperItem => ({
  kind: 'agent', id,
  agent: {
    id, description: `Measure the ${id} sources`, agentType: 'general-purpose', model: 'Sonnet', effort: 'high', state: 'running',
    startedAt: NOW - 725_000, endedAt: null, lastActivityAt: NOW - 20_000, tokens: 41_000, summary: null, hasReport: false, ...o,
  },
});
const workflow = (id: string, o: Partial<WorkflowView> = {}): HelperItem => ({
  kind: 'workflow', id,
  workflow: {
    id, name: 'review-panel', state: 'running', done: 7, failed: 0, total: 12, phase: 'Verify', phases: ['Build', 'Verify'],
    startedAt: NOW - 362_000, endedAt: null, tokens: 2_500_000, tokensUnmeasured: 0,
    agents: [{ label: 'build', phase: 'Build', state: 'done' }, { label: 'verify-1', phase: 'Verify', state: 'running' }],
    agentsOmitted: 0, lastActivityAt: NOW - 4_000, ...o,
  },
});

const RUNNING: HelpersView = {
  count: '3 running · 2 finished', notes: [],
  main: [agent('server'), agent('transcript', { lastActivityAt: NOW - 11 * 60_000, tokens: 63_000 }), workflow('wf_00000000-aaa')],
  finished: [
    agent('panel', { state: 'done', startedAt: NOW - 400_000, endedAt: NOW - 148_000, summary: 'header facts only', hasReport: true }),
    agent('mockup', { state: 'failed', startedAt: NOW - 200_000, endedAt: NOW - 137_000, summary: 'headless browser not found' }),
  ],
};

const meta = {
  title: 'Components/HelpersStrip',
  component: HelpersStrip,
  args: {
    view: RUNNING,
    reports: { panel: { report: 'one\ntwo\nthree\nfour\nfive\nsix', cut: false } },
    onReport: () => undefined,
  },
} satisfies Meta<typeof HelpersStrip>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Two subagents and a workflow running, two finished. CHECK the head says each count once; collapsed, line 1 of the first
 *  two running rows with `running` kept visible; open, the finished fold closed by default, and the done row opening to the
 *  first four lines of its report, then Show all and Copy. */
export const Running: Story = {};

/** A stale roster, said once in the head; the rows carry no state and draw the neutral glyph, never the running one. */
export const Stale: Story = {
  args: {
    view: {
      count: '2 helpers', notes: ['live state not known: no news from the session for 41m'],
      main: [agent('fixtures', { state: 'unmeasured' }), agent('release note', { state: 'unmeasured' })], finished: [],
    },
  },
};

/** A fresh roster with a no-longer-listed row in the main list, and stopped and finished rows in the fold. */
export const States: Story = {
  args: {
    view: {
      count: '1 running · 2 finished', notes: [],
      main: [agent('fixtures', { agentType: 'Explore', model: 'Haiku', effort: null }), agent('release note', { state: 'unlisted', lastActivityAt: NOW - 180_000 })],
      finished: [
        agent('migration order', { state: 'stopped', startedAt: NOW - 30_000, endedAt: NOW - 8_000 }),
        agent('failing suites', { state: 'finished', startedAt: NOW - 400_000, endedAt: NOW - 40_000 }),
      ],
    },
  },
};
