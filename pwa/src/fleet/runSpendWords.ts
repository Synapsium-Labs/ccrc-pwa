// L1 words (D-6799): how the run board says what a run's sessions have spent.
// Pure: the row mounts what this returns and decides nothing. A MEASUREMENT -
// no word here is a budget, a cap or a warning.
import { formatTokens } from '@ccrc/ui';
import type { RunSpend, RunSpendUnmeasuredReason } from '../../../shared/api';

const WHY: Record<RunSpendUnmeasuredReason, string> = {
  'no-session': 'no session is bound to this run yet',
  'no-sweep': 'the usage sweep has not written a pass yet',
  unreadable: 'the usage sweep could not be read',
  malformed: 'the usage sweep file is malformed',
  'not-swept': 'the last usage sweep pass has not seen this run\'s sessions yet',
};

export interface RunSpendWords {
  measured: boolean;
  /** Always shown: dollars and output for a measurement, the unmeasured sentence otherwise. */
  short: string;
  /** Shown from the row's wide width up: input and cache. Empty when unmeasured. */
  long: string;
  title: string;
}

/** `undefined` is "not asked yet": no line, not an empty one. */
export function runSpendLine(spend: RunSpend | undefined): RunSpendWords | null {
  if (spend === undefined) return null;
  if (!spend.measured) {
    return { measured: false, short: 'spend not measured', long: '', title: `spend not measured: ${WHY[spend.reason]}` };
  }
  const t = spend.tokens;
  return {
    measured: true,
    short: `≈ $${spend.proxyUsd.toFixed(2)} · out ${formatTokens(t.output)}`,
    long: `in ${formatTokens(t.input)} · cache r ${formatTokens(t.cacheRead)} w ${formatTokens(t.cacheWrite)}`,
    title: `what this run's sessions have spent in the usage sweep's 7-day window, from the pass finished ${spend.measuredAt}. ` +
      'Partial: a session\'s earlier transcripts count only if the sweep saw their uuid while its row named it, ' +
      'and a worker reused across runs is counted in each. ' +
      'The dollar figure is an API-rate-card proxy, not an invoice; it measures, it is no budget.',
  };
}
