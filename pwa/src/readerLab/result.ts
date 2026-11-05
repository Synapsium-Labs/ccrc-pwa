// The reader lab's result block, format 1 (native Docs reader, the reader lab plan of 2026-11-03, Task 8, refinement (n);
// the reader lab design, section 6; the rich-docs spec's row M10.14). Ring L1: pure. The text the operator selects and
// sends: device classes, fixed keys in a fixed order, each line's own words, the draw-on-open reading, and no host, origin,
// nonce, project, path or user agent, so it can go into a public ledger as it is.
import type { LabRunView } from '../../../shared/readerLab';
import { LAB_E17, LAB_E18, LAB_WALLS, type LabCheckId, type LabOutcome, type LabVerdict } from './checks';
import { deviceFacts, type LabDevice } from './device';
import { drawOnOpenReading, type LabLocal } from './verdicts';

/** The block's format. Adding a line, a key or a parenthesised detail keeps it; changing what a key, a word or a number
 *  means, or removing a line, makes it 2. */
export const LAB_RESULT_FORMAT = 1;

/** The words, the block's and the page's: `labText.ts` shows these. */
export const LAB_VERDICT_WORDS: Readonly<Record<LabVerdict, string>> = {
  holds: 'holds', 'does-not-hold': 'does not hold', 'not-measured': 'not measured', differs: 'differs from desktop',
  'shared-thread': 'shared thread', 'own-thread': 'own thread',
};

/** How the run's final read went. Every verdict's counts were read by the hostile step, so a final read that finds the run
 *  gone or unreadable keeps the last view, and the door line says so. */
export type LabFinalRead = 'read' | 'unknown-run' | 'unreadable';

const lineOf = (key: string, o: LabOutcome): string => `  ${key.padEnd(18)} ${LAB_VERDICT_WORDS[o.verdict]}${o.detail === '' ? '' : ` (${o.detail})`}`;

/** The block. `library` is the library build; `run` null means the door could not be read. */
export function formatLabResult(
  device: LabDevice, library: string, outcomes: Readonly<Record<LabCheckId, LabOutcome>>, local: LabLocal,
  run: LabRunView | null, budgetMs: number, finalRead: LabFinalRead,
): string {
  const head = [`reader-lab ${LAB_RESULT_FORMAT}`, ...deviceFacts(device), `library ${library}`].join(' · ');
  const walls = LAB_WALLS.map((k) => outcomes[k].verdict);
  const summary = [
    `${walls.filter((v) => v === 'holds').length} of ${walls.length} hold`,
    ...(['does-not-hold', 'not-measured'] as const).flatMap((v) => {
      const n = walls.filter((w) => w === v).length;
      return n === 0 ? [] : [`${n} ${LAB_VERDICT_WORDS[v]}`];
    }),
  ].join(', ');
  const gaps = local.mounts.length === 0 ? [] : [`    ${'gaps ms'.padEnd(17)}${local.mounts
    .map((m) => `${m.label} ${m.gapHidden ? 'not measured: the page was hidden' : `${Math.round(m.longestGapMs)} ${m.outcome}`}`).join(' · ')}`];
  const cookie = run === null ? '' : run.probes['cookie-console'].cookie > 0 ? '; session cookie sent' : '; no session cookie (sign-in gate off?)';
  const kept = finalRead === 'read' ? '' : `; final read ${finalRead === 'unknown-run' ? 'found the run gone' : 'unreadable'}, counts as of the hostile step`;
  const door = run === null ? 'door: not read'
    : `door: ${run.counted} counted, ${run.ignored} ignored${run.saturated ? ', saturated' : ''}${cookie}${kept}`;
  return [
    head, `E18 walls: ${summary}; teardown signal ${LAB_VERDICT_WORDS[outcomes['self-nav-teardown'].verdict]}`,
    ...LAB_E18.map((k) => lineOf(k, outcomes[k])),
    `E17 responsive (mermaid budget ${budgetMs} ms):`, ...LAB_E17.map((k) => lineOf(k, outcomes[k])),
    ...gaps, `draw on open: ${drawOnOpenReading(outcomes, local, budgetMs)}`, door,
  ].join('\n');
}
