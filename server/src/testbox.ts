// D-7411, D-7444, D-7445 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB9; spec 2026-10-28 test box
// §2.7, §2.10). L1: pure and clock-free (the clock is an argument), `fs`-free; it imports L0 alone. The server's
// DECISION about the test box, from three facts the lane hands it: the fleet agent's `testbox` op answer, the
// registry listing (for the switch marker) and the wrapper's runs log lines.
//
// TWO FIELDS, NEVER FOLDED INTO ONE (D-7444). The STATE is the box's health: `off` ONLY when no test box is configured
// (`CCRC_TESTBOX_URL` unset, the op's `unconfigured`); otherwise `ok`, `degraded` with its reasons, `down` or
// `unreachable`. It is computed from the op's answer alone, so it is the same whether the switch marker is present or
// not, and the card shows a healthy box before anyone arms it. The SWITCH is `$REG/testbox-remote-live`, read as every
// `SWITCHES` marker row is read (`readSwitches`): on, off, or unknown when the registry could not be listed.
//
// THE 24-HOUR COUNTS (D-7445): today's and yesterday's `$REG/testbox-runs/<UTC date>.log`, each line through the
// format's one reader (`parseRunsLine`); a line in the last 24 hours is counted by its outcome and its
// `TestboxFallbackId`, and a line the reader refuses is counted `unreadable`, never guessed at.
import type { TestboxHostMeasure, TestboxOpReply } from '../../shared/agent-protocol.js';
import type { RouteRefusal } from '../../shared/refusal.js';
import { readSwitches, TESTBOX_REMOTE_LIVE_MARKER } from '../../shared/switches.js';
import {
  parseRunsLine, TESTBOX_TOOLS, type StatusAnswer, type TestboxFallbackId, type TestboxState, type TestboxTool,
} from '../../shared/testbox.js';

/** The switch as the marker reads. */
export type TestboxSwitch = 'on' | 'off' | 'unknown';

/** The op's answer as the lane got it (`FleetIO.testboxMeasured`'s shape, restated so this file imports no adapter). */
export type TestboxAnswer =
  | { readonly ok: true; readonly reply: TestboxOpReply }
  | { readonly ok: false; readonly reason: 'no-op' | 'unanswered' };

/** Why the seam answered no op reply: an agent without the op (never sent it), or one that did not answer. */
export type TestboxNoReply = Extract<TestboxAnswer, { ok: false }>['reason'];

/** The tools sync door's refusal for a seam that answered no reply (D-7411): `unsupported` (501) for an agent without
 *  the op, `fleetFailed` (502) for one that did not answer, each with the sentence the block's `unreachable` reason
 *  uses. Decided here, so `POST /api/testbox/tools-sync` answers it through `refuseRoute` and spells no reason. */
export const TESTBOX_SYNC_REFUSAL: Readonly<Record<TestboxNoReply, { readonly error: RouteRefusal; readonly detail: string }>> = {
  'no-op': { error: 'unsupported', detail: 'agent has no testbox-tools-sync op' },
  unanswered: { error: 'fleetFailed', detail: 'the fleet agent did not answer the testbox-tools-sync op' },
};

/** One row of the card's versions table: the fleet host's measured value and the box's, and whether they differ. */
export interface TestboxCell {
  readonly tool: TestboxTool | 'release';
  readonly host: string | null;
  readonly box: string;
  readonly differs: boolean;
}

/** The last 24 hours of the runs log. `byReason` counts the fallback and refused lines by their reason. */
export interface TestboxCounts {
  readonly remote: number;
  readonly fallback: number;
  readonly refused: number;
  readonly unreadable: number;
  readonly byReason: Readonly<Partial<Record<TestboxFallbackId, number>>>;
}

export interface TestboxBlock {
  readonly state: TestboxState;
  /** Why `degraded`, `down` or `unreachable`; empty for `ok` and `off`. */
  readonly reasons: readonly string[];
  /** The state with its reasons, as the card and the doctor print it: `unreachable (agent has no testbox op)`. */
  readonly summary: string;
  readonly switch: TestboxSwitch;
  /** When the answer was taken (ms since the epoch). */
  readonly at: number;
  readonly host: TestboxHostMeasure | null;
  readonly box: StatusAnswer | null;
  /** The six tools and the release, fleet host against box; empty without a status answer. */
  readonly cells: readonly TestboxCell[];
  /** `null` when a runs log could not be read. */
  readonly counts: TestboxCounts | null;
}

/** A runs log as the lane read it: its text (`''` for a file that is not there), or `null` when it could not be read. */
export type RunsLogRead = string | null;

export interface TestboxInputs {
  readonly answer: TestboxAnswer;
  /** The registry listing, or `null` when it could not be listed. */
  readonly listing: readonly string[] | null;
  /** Today's and yesterday's runs logs (`runsLogDates`' order). */
  readonly logs: readonly RunsLogRead[];
  readonly now: number;
}

const DAY_MS = 86_400_000;

/** The runs log's day files to read at `now`: today's UTC date, then yesterday's (D-7445). */
export function runsLogDates(now: number): readonly [string, string] {
  const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  return [day(now), day(now - DAY_MS)];
}

/** The 24-hour counts over the day files' text, or `null` when one could not be read. */
export function runsCounts(logs: readonly RunsLogRead[], now: number): TestboxCounts | null {
  if (logs.some((l) => l === null)) return null;
  let remote = 0, fallback = 0, refused = 0, unreadable = 0;
  const byReason: Partial<Record<TestboxFallbackId, number>> = {};
  for (const text of logs as string[]) {
    for (const line of text.split('\n')) {
      if (line === '') continue;
      const row = parseRunsLine(line);
      if (row === null) { unreadable += 1; continue; }
      if (Date.parse(row.at) <= now - DAY_MS) continue;
      if (row.outcome === 'remote') { remote += 1; continue; }
      if (row.outcome === 'fallback') fallback += 1; else refused += 1;
      if (row.fallback !== null) byReason[row.fallback] = (byReason[row.fallback] ?? 0) + 1;
    }
  }
  return { remote, fallback, refused, unreadable, byReason };
}

/** The switch, through the switch table's one reader. */
export function testboxSwitch(listing: readonly string[] | null): TestboxSwitch {
  const r = readSwitches(listing)[TESTBOX_REMOTE_LIVE_MARKER];
  return r === 'set' ? 'on' : r === 'clear' ? 'off' : 'unknown';
}

/** The versions table: the six tools in the card's order, then the release. */
export function testboxCells(host: TestboxHostMeasure, box: StatusAnswer): TestboxCell[] {
  const cells: TestboxCell[] = TESTBOX_TOOLS.map((tool) => ({ tool, host: host.tools[tool], box: box.tools[tool], differs: host.tools[tool] !== box.tools[tool] }));
  cells.push({ tool: 'release', host: host.release, box: box.release, differs: host.release !== box.release });
  return cells;
}

/** Why a box that answered is `degraded`, in spec §2.7's order: a version cell that differs, a sync in progress or
 *  failed, a failed pristine key, a held run user. A box that says `degraded` for a reason none of these name keeps
 *  its own words. */
export function degradedReasons(cells: readonly TestboxCell[], box: StatusAnswer): string[] {
  const out: string[] = [];
  for (const c of cells) if (c.differs) out.push(`tools differ (${c.tool} ${c.host ?? 'unmeasured'} vs ${c.box})`);
  if (box.sync.state === 'syncing') out.push(`tool sync in progress${box.sync.detail === null ? '' : ` (${box.sync.detail})`}`);
  if (box.sync.state === 'failed') out.push(`tool sync failed${box.sync.detail === null ? '' : ` (${box.sync.detail})`}`);
  for (const k of box.failedKeys) out.push(`pristine install failed (${k.package} ${k.key}, exit ${k.exit})`);
  for (const u of box.heldRunUsers) out.push(`run user held out (${u})`);
  if (out.length === 0 && box.state === 'degraded' && box.reason !== null) out.push(box.reason);
  return out;
}

const summaryOf = (state: TestboxState, reasons: readonly string[]): string =>
  reasons.length === 0 ? state : `${state} (${reasons.join('; ')})`;

/** The block. The state reads the answer alone; the switch reads the listing alone; the counts read the logs. */
export function testboxBlock(i: TestboxInputs): TestboxBlock {
  const sw = testboxSwitch(i.listing);
  const counts = runsCounts(i.logs, i.now);
  const mk = (state: TestboxState, reasons: readonly string[], host: TestboxHostMeasure | null, box: StatusAnswer | null, cells: readonly TestboxCell[]): TestboxBlock =>
    ({ state, reasons, summary: summaryOf(state, reasons), switch: sw, at: i.now, host, box, cells, counts });
  if (!i.answer.ok) {
    return mk('unreachable', [i.answer.reason === 'no-op' ? 'agent has no testbox op' : 'the fleet agent did not answer the testbox op'], null, null, []);
  }
  const { host, box } = i.answer.reply;
  if (!box.ok) {
    if (box.failure === 'unconfigured') return mk('off', [], host, null, []);
    const why = box.failure === 'bad-answer' ? `bad answer${box.detail === null ? '' : `: ${box.detail}`}` : box.detail ?? 'no answer';
    return mk('unreachable', [why], host, null, []);
  }
  const status = box.status;
  const cells = testboxCells(host, status);
  if (status.state === 'down') return mk('down', status.reason === null ? [] : status.reason.split('; '), host, status, cells);
  const reasons = degradedReasons(cells, status);
  return mk(reasons.length === 0 ? 'ok' : 'degraded', reasons, host, status, cells);
}
