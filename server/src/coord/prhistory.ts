import path from 'node:path';
import type { FleetIO } from '../io.js';
import type { PrLineageEntry } from './store.js';

export type PrHistoryRead =
  | { ok: true; entries: PrLineageEntry[] }
  | { ok: false; error: 'unreadable' };

/**
 * `$REG/<id>.prhistory` — the FIRST server-side reader of this file. It is
 * appended by ccd at exactly one chokepoint, the `prnumber` replacement inside
 * `_pr_py` (`ccd/ccd:849-859`), which is the only line in ccd that ever
 * replaces a persisted `prnumber` and therefore the only place PR lineage can
 * be recorded at all.
 *
 * ONLY THE OUTER TWO RUNGS OF THE LADDER ARE ccd'S OWN (`ccd/ccd:2013-2035`):
 *   - ABSENT      -> `[]`, and it is a MEASURED answer: this workspace has
 *                    retired no PR.
 *   - UNREADABLE  -> REFUSAL. A `chmod 000` ledger answering `[]` would put
 *                    "this workspace retired no PRs" into the record that
 *                    closes a run — the SIXTEENTH FORGERY's exact shape.
 *
 * THE MIDDLE RUNG IS A DELIBERATE DIVERGENCE, not a port. ccd's own MALFORMED
 * handling (`ccd/ccd:2020-2022`, `:2046`, `:2060-2061`) is WHOLE-FILE: one line
 * `json.loads` cannot parse raises inside a single list comprehension over
 * every line, which the one `try` around it catches, discarding EVERY row —
 * good ones included — down to `[]`; this repo's own `ccd-prhistory.test.ts:126`
 * pins exactly that with a good row ahead of the bad one — the one shape that
 * tells whole-file discard apart from this reader's per-line salvage (a
 * single-line ledger, e.g. `ccd-prhistory.test.ts:105`, answers `[]` under
 * either policy and proves nothing about which one ran). This reader instead
 * salvages every line it can parse and validate, in order, dropping only the
 * lines it can't — because ccd's writer only ever appends with `O_APPEND`, so
 * the one line ever at risk of tearing is the LAST one, and a torn tail is
 * one lost record, not grounds to discard every record that came before it.
 * The cost of that choice: on a ledger whose bad line ISN'T the tail
 * (hand-edited, or a future ccd change to the record
 * shape), this reader and ccd's OWN `ws-archive` fold can disagree — for the
 * same file, at the same moment — about whether a workspace retired any PRs.
 * ccd also performs no shape validation at all; a line that parses as JSON but
 * fails the four field guards below (`pr`/`branch`/`phase`/`recordedAt` typed
 * wrong) is dropped here exactly like an unparseable one, silently, with
 * nothing on `PrHistoryRead` distinguishing "this ledger is genuinely empty"
 * from "a line was rejected" — a second, narrower divergence in the same
 * direction. Left unsignalled deliberately for now: the one prospective reader
 * of that signal is the run-close route, which does not exist in this tree yet
 * (Task 9), and how it should present a partially-rejected ledger is that
 * route's call to make, not this reader's to guess ahead of it.
 *
 * `FleetIO.readFile` maps every error to `null` (`io.ts:41-43`), so present and
 * unreadable are indistinguishable from the read alone. The registry DIRECTORY
 * listing is what separates them — it names `<id>.prhistory` whether or not its
 * bytes can be fetched — the same evidence `registry.ts:26-46` uses for
 * `HOLD_UNREADABLE`. Unlike `registry.ts`, which lists FIRST and confirms an
 * ambiguous read with a SECOND listing, this reader reads first (the common
 * case never needs a listing at all) and, only when that read comes back null,
 * takes a second LOOK before refusing: a listing naming the file could mean the
 * file is genuinely unreadable, or it could mean the file was CREATED in the
 * gap between the read above and the listing below — ccd's chokepoint only
 * appends on a `prnumber` replacement, which lands at exactly the moment a run
 * is most likely to close, so that gap is not a theoretical one. The second
 * look is a plain re-read rather than a re-list: a read is the only op that can
 * produce this function's actual answer, and refusal is reserved for a file
 * that is STILL unreadable on that second attempt. In remote mode every one of
 * these is an agent round trip; up to three is the price of the distinction,
 * and it is paid once per run close, never per sweep.
 */
export async function readPrHistory(
  io: FleetIO, registryDir: string, id: string,
): Promise<PrHistoryRead> {
  const name = `${id}.prhistory`;
  const filePath = path.join(registryDir, name);
  const raw = await io.readFile(filePath);
  if (raw !== null) return parseLedger(raw);

  const listing = await io.readdir(registryDir);
  // A listing we could not take either: refuse. Absence is only absence when
  // something actually looked.
  if (listing === null) return { ok: false, error: 'unreadable' };
  if (!listing.includes(name)) return { ok: true, entries: [] };

  // Listed but the first read came back null: either genuinely unreadable, or
  // a file that appeared in the gap between the read above and this listing.
  // A second read resolves it either way — refuse only if IT also fails.
  const raw2 = await io.readFile(filePath);
  return raw2 !== null ? parseLedger(raw2) : { ok: false, error: 'unreadable' };
}

/** The MALFORMED rung: every line that parses AND validates, in order. See the
 *  module docstring for why this salvages per-line rather than degrading the
 *  whole file the way ccd's own reader does. */
function parseLedger(raw: string): PrHistoryRead {
  const entries: PrLineageEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (typeof o['pr'] !== 'number' || !Number.isInteger(o['pr'])) continue;
      if (typeof o['branch'] !== 'string' || typeof o['phase'] !== 'string') continue;
      if (typeof o['recordedAt'] !== 'number') continue;
      entries.push({ pr: o['pr'], branch: o['branch'], phase: o['phase'], recordedAt: o['recordedAt'] });
    } catch { /* a torn or hand-edited line is one lost record, never a lost history */ }
  }
  return { ok: true, entries };
}
