// The compactions a session's current conversation has had (Overlord W1a, context readings; spec Table 3.3.11b, row
// "Two compactions in one generation"; Table 3.6a, the compactions journal). Two writers on the fleet box, one file
// each: PostCompact commits one record per settled compaction to `$REG/<id>.compactions` (the compaction card's
// journal, `ccd/session-hook.sh#_hook_compact_post`), and PreCompact writes one `phase:"pre"` line per compaction to
// `$REG/<id>.compactevents`, rotated to `.compacteventsprev` at the hook's PRECOMPACT_KEEP lines
// (`ccd/session-hook.sh#_hook_compact_pre_line`). The pre line is what counts an automatic compaction that fires
// PreCompact with no PostCompact after it (W0-05). The same file may carry `phase:"refused"` lines, which the compaction
// piece writes IN PLACE OF a refused event's pre line: they are read, and never counted (plan review 1896 B3). Every
// line carries the hook's scope verdict, and only `main` lines count: every PreCompact payload names the parent's
// transcript, so the verdict is all that tells a subagent's compaction apart (plan review 1896 B2).
//
// Two exported functions: `readCompactionsMeasured` (L3, reads the three files through `FleetIO` and keeps every
// distinction it receives) and `compactionsSince` (L1, pure: it imports nothing that does I/O). No renewal decision is
// made here; the renewal deciders read these answers.
import path from 'node:path';
import type { FleetIO } from '../io.js';

export interface CompactionLine {
  /** Epoch MILLISECONDS, the unit both hook writers use (`_hook_epoch_ms`, the helper's `Date.now()`). */
  readonly at: number;
  /** `other` for any word but the two Claude Code sends: never guessed into `auto`. */
  readonly trigger: 'auto' | 'manual' | 'other';
  readonly phase: 'pre' | 'post' | 'refused';
  /** The transcript the compaction was attributed to, or null when the writer could not name one (an ambiguous or
   *  normalised record). A pre line and a post line pair only when these do not contradict. */
  readonly transcript: string | null;
  /** The hook's scope verdict (`_hook_compact_scope`): only `main` counts; `ambiguous` and null (no verdict) do not. */
  readonly scope: 'main' | 'subagent' | 'ambiguous' | null;
}

export type CompactionsRead =
  | { readonly kind: 'lines'; readonly lines: readonly CompactionLine[]; readonly skipped: number }  // skipped: malformed lines
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

/** A `post` pairs with a `pre` of the same compaction when it comes at most this long after it. Ten minutes: far
 *  longer than a compaction takes, far shorter than the gap between two (decision compaction-counted-by-pre). */
export const COMPACTION_PAIR_MS = 600_000;

const triggerOf = (v: unknown): CompactionLine['trigger'] => (v === 'auto' || v === 'manual' ? v : 'other');

/** One line of either file, or null when it is not a line of that file. A journal record has no `phase`; a line of
 *  the pre file must say `"pre"` or `"refused"`, so a stray record there is skipped rather than counted twice. */
function lineOf(text: string, file: 'journal' | 'pre'): CompactionLine | null {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const at = r['at'];
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return null;
  const ph = r['phase'];
  let phase: CompactionLine['phase'];
  if (file === 'journal') { if (ph !== undefined) return null; phase = 'post'; }
  else if (ph === 'pre' || ph === 'refused') phase = ph;
  else return null;
  const t = r['transcript'];
  if (t !== null && t !== undefined && typeof t !== 'string') return null;
  const sc = r['scope'];
  const scope = sc === 'main' || sc === 'subagent' || sc === 'ambiguous' ? sc : null;
  return { at, trigger: triggerOf(r['trigger']), phase, transcript: typeof t === 'string' && t !== '' ? t : null, scope };
}

export const compactionsPaths = (registryDir: string, id: string): { journal: string; pre: string; prev: string } => ({
  journal: path.join(registryDir, `${id}.compactions`),
  pre: path.join(registryDir, `${id}.compactevents`),
  prev: path.join(registryDir, `${id}.compacteventsprev`),
});

/** Three answers. `absent` only when none of the three files exists; `unreadable` when any one could not be read
 *  (a count from part of the evidence would read low, and a low count is the wrong side to fail on); otherwise
 *  `lines`, with every line that is not a line of its file counted in `skipped`, never thrown. The current pre file
 *  is read BEFORE `.compacteventsprev`: a rotation between the two reads then shows a line twice, never zero times, and
 *  a pre line repeated byte for byte is taken once. */
export async function readCompactionsMeasured(io: FleetIO, registryDir: string, id: string): Promise<CompactionsRead> {
  const p = compactionsPaths(registryDir, id);
  const journal = await io.readFileMeasured(p.journal);
  const pre = await io.readFileMeasured(p.pre);
  const prev = await io.readFileMeasured(p.prev);
  const reads = [journal, pre, prev];
  if (reads.some((r) => !r.ok && r.reason !== 'absent')) return { kind: 'unreadable' };
  if (reads.every((r) => !r.ok)) return { kind: 'absent' };
  const lines: CompactionLine[] = [];
  let skipped = 0;
  const take = (content: string, file: 'journal' | 'pre', seen: Set<string> | null): void => {
    for (const text of content.split('\n')) {
      if (text === '') continue;
      if (seen !== null) { if (seen.has(text)) continue; seen.add(text); }
      const l = lineOf(text, file);
      if (l === null) skipped += 1; else lines.push(l);
    }
  };
  if (journal.ok) take(journal.content, 'journal', null);
  const seen = new Set<string>();
  if (pre.ok) take(pre.content, 'pre', seen);
  if (prev.ok) take(prev.content, 'pre', seen);
  return { kind: 'lines', lines, skipped };
}

/** May this `post` be the settlement of that `pre`? Same trigger, transcripts that do not contradict (equal, or one
 *  side unnamed), and the post at most COMPACTION_PAIR_MS after the pre. */
function pairs(pre: CompactionLine, post: CompactionLine): boolean {
  return pre.trigger === post.trigger
    && (pre.transcript === null || post.transcript === null || pre.transcript === post.transcript)
    && post.at >= pre.at && post.at - pre.at <= COMPACTION_PAIR_MS;
}

/** Pure. How many compactions of the MAIN conversation the lines record at or after `sinceMs`. One compaction per
 *  `pre`; a `post` that may be the settlement of a `pre` (see `pairs`) is the same one; a `post` with no such `pre` is
 *  one more. A line whose scope is not `main`, a `refused` line, and a line before `sinceMs` count nothing. The pairing
 *  is a MAXIMUM matching (augmenting paths), so the count is the number of counted lines less the most pairs they
 *  admit, and appending a line never lowers it. */
export function compactionsSince(lines: readonly CompactionLine[], sinceMs: number): number {
  const kept = lines.filter((l) => l.at >= sinceMs && l.scope === 'main');
  const pres = kept.filter((l) => l.phase === 'pre');
  const posts = kept.filter((l) => l.phase === 'post');
  const preOf: number[] = new Array<number>(pres.length).fill(-1);   // pre index -> the post index it is paired with
  const augment = (j: number, seen: boolean[]): boolean => {
    for (let i = 0; i < pres.length; i += 1) {
      if (seen[i] || !pairs(pres[i]!, posts[j]!)) continue;
      seen[i] = true;
      if (preOf[i] === -1 || augment(preOf[i]!, seen)) { preOf[i] = j; return true; }
    }
    return false;
  };
  let matched = 0;
  for (let j = 0; j < posts.length; j += 1) if (augment(j, new Array<boolean>(pres.length).fill(false))) matched += 1;
  return pres.length + posts.length - matched;
}
