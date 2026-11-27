export type ReaderTimingPair = Readonly<{ baseMs: number; candidateMs: number }>;
export const READER_PAIRED_COUNT = 20;

type ControlRatios = Readonly<{
  opening: readonly [number, number];
  closing: readonly [number, number];
}>;

function pairMedian(values: number[]): number {
  const sorted = values.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[mid]!) / 2;
}

export function readerPairedStats(pairs: readonly ReaderTimingPair[]) {
  if (pairs.length !== READER_PAIRED_COUNT) throw new Error(`Expected ${READER_PAIRED_COUNT} reader timing pairs`);
  if (pairs.some(({ baseMs, candidateMs }) => !Number.isFinite(baseMs) || baseMs <= 0 || !Number.isFinite(candidateMs) || candidateMs <= 0)) {
    throw new Error('Reader timing pairs require two positive, finite times');
  }
  return {
    baseMedian: pairMedian(pairs.map(({ baseMs }) => baseMs)),
    ratio: pairMedian(pairs.map(({ baseMs, candidateMs }) => candidateMs / baseMs)),
    differenceMs: pairMedian(pairs.map(({ baseMs, candidateMs }) => candidateMs - baseMs)),
  };
}

function controlRatioPasses(ratio: number): boolean {
  return ratio >= 0.97 && ratio <= 1.03;
}

export function readerPairedControlPasses(pairs: readonly ReaderTimingPair[]): boolean {
  return controlRatioPasses(readerPairedStats(pairs).ratio);
}

/** D-9030, final form: only a complete, controlled sitting can decide a row. */
export function readerPairedVerdict(arm: 'hosted' | 'mode-only', pairs: readonly ReaderTimingPair[], controls: ControlRatios) {
  const stats = readerPairedStats(pairs);
  const [figure, ceiling] = arm === 'hosted' ? [stats.differenceMs, 30] : [stats.ratio, 1.10];
  const [openingRefined, openingInstrument] = controls.opening;
  const [closingRefined, closingInstrument] = controls.closing;
  const counted = [openingRefined, openingInstrument, closingRefined, closingInstrument].every(controlRatioPasses);
  const verdict = !counted ? 'not-counted' : figure <= ceiling ? 'pass' : arm === 'hosted' ? 'hosted-over' : 'red';
  return { ...stats, figure, ceiling, verdict } as const;
}
