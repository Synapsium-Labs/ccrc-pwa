// D-8073 (spec 2026-11-04 §11.7; ruled plan W1, "Telling the coordinator"): the notice that tells a coordinator its runs were
// closed by the operator or the sweep. `CoordStore.closeRun` writes one `run_close_untold` row per run in the close's own
// transaction; `untoldPass` sends ONE system mail per claimant per pass, with `runId` null, to a claimant `measureClaimant`
// reads alive (a hibernated one included, which the ladder reads alive), and deletes the rows in the SAME transaction as the
// insert. The delivery carries `wake = 'never'`, so the mail sweep holds it for a sleeper without asking `ccd ensure`, and
// the push lane records it without pushing. A claimant that reads dead or unmeasurable gets no mail and its rows wait for an
// heir (`CoordStore.reclaimProgram` rewrites the rows' claimant in the transaction that rewrites the programme's `claimedBy`).
import type { WatcherCoordPort } from './ports.js';
import type { ClaimantVerdict } from './reclaim.js';
import { insertSystemMailTx } from './rundefsTx.js';
import type { UntoldRow } from './store.js';

/** The head of every notice this file sends; the push lane and the tests read it from here. */
export const UNTOLD_SUBJECT_PREFIX = 'runs closed:';

export const isUntoldNotice = (subject: string): boolean => subject.startsWith(UNTOLD_SUBJECT_PREFIX);

const who = (cause: string): string => (cause === 'sweep' ? 'the sweep' : 'the operator');

/** What a refused close says it was refused for (spec §12.2): the notice asks nothing, it tells the coordinator the lane met
 *  something it will not close over. An `unknown` run is a state a newer server can move. */
const REFUSED_WORDS: Readonly<Record<string, string>> = {
  'open-pr': 'it has an open pull request',
  'unpushed-commits': 'its branch has commits that are not pushed',
  'busy-worker': 'its worker is still busy',
  'child-marker-unreadable': 'ccrc cannot tell whether a child is still working in its workspace',
  'warning-undelivered': 'the warning that it would close could not be delivered',
  'unknown-run': 'it is in a state this server cannot read, which a newer server can move',
};

function noticeOf(rows: readonly UntoldRow[]): { subject: string; body: string } {
  const closed = rows.filter((r) => r.cause !== 'refused');
  const subject = `${UNTOLD_SUBJECT_PREFIX} ${closed.length === 0 ? 'none' : `${closed.length} ${closed.length === 1 ? 'run' : 'runs'}`}`;
  const lines = rows.map((r) => r.cause === 'refused'
    ? `run ${r.runId} (${r.program} wave ${r.wave}/${r.waveOf ?? '?'}) was not closed: ${REFUSED_WORDS[r.detail ?? ''] ?? 'ccrc refused to close it'}`
    : `run ${r.runId} (${r.program} wave ${r.wave}/${r.waveOf ?? '?'}) was closed by ${who(r.cause)}${r.detail === null ? '' : ` (${r.detail})`}`);
  return { subject, body: [...lines, 'This is a record. It asks nothing of you.'].join('\n') };
}

export interface UntoldPassDeps {
  readonly coord: WatcherCoordPort;
  /** `measureClaimant`, bound by the watcher. */
  readonly measure: (claimant: string) => Promise<ClaimantVerdict>;
}

/** One pass. Never throws: a failure is warned, the rows stand, and the next pass tells once. */
export async function untoldPass(deps: UntoldPassDeps): Promise<void> {
  const { coord } = deps;
  try {
    const claimants = [...new Set(coord.untoldRows().map((r) => r.claimant))].sort();
    for (const claimant of claimants) {
      const verdict = await deps.measure(claimant);
      if (verdict.state !== 'alive') continue;
      coord.drainUntold(claimant, (rows) => {
        const n = noticeOf(rows);
        insertSystemMailTx(coord, null, { fromId: 'operator', toId: claimant, runId: null, kind: 'status',
          subject: n.subject, body: n.body, wake: 'never' });
      });
    }
  } catch (err) {
    console.warn(`ccrc-server: untold: the pass failed (${err instanceof Error ? err.message : String(err)}) — the rows stand and the next pass tells once`);
  }
}
