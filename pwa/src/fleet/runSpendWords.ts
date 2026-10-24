// L1 words (D-6799): how the run board says what a run's sessions have spent.
// Pure: the row mounts what this returns and decides nothing. A MEASUREMENT -
// no word here is a budget, a cap or a warning.
import type { RunSpend, RunSpendUnmeasuredReason } from '../../../shared/api';

/** 999 -> '999', 1234 -> '1.2k', 4_500_000 -> '4.5M'. One decimal, trailing '.0' dropped. */
export function compactCount(n: number): string {
  const trim = (x: number): string => x.toFixed(1).replace(/\.0$/, '');
  if (n >= 999_950) return `${trim(n / 1e6)}M`;
  if (n >= 1000) return `${trim(n / 1e3)}k`;
  return String(Math.round(n));
}

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
    short: `≈ $${spend.proxyUsd.toFixed(2)} · out ${compactCount(t.output)}`,
    long: `in ${compactCount(t.input)} · cache r ${compactCount(t.cacheRead)} w ${compactCount(t.cacheWrite)}`,
    title: `what this run's sessions have spent, from the usage sweep pass finished ${spend.measuredAt}. ` +
      'The dollar figure is an API-rate-card proxy, not an invoice; it measures, it is no budget.',
  };
}
