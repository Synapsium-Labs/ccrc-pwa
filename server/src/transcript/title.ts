// The line Claude Code has been writing since before ccrc existed, and which
// nothing has ever consumed: `ask.ts:11-16` names `ai-title` among the types it
// deliberately skips. It is a name a model generated from the first prompt, and
// it is already paid for.
import type { FleetIO } from '../io.js';

/** Measured across the 600 transcripts on this box that carry an `ai-title`:
 *  the last one sits at most 45,996 bytes from EOF (p95 31,177; median 12,687).
 *  256 KB is 5.5x headroom on the worst case, where 64 KB would be 1.4x and too
 *  tight. Same figure as `ask.ts`'s TAIL_BYTES, arrived at from a different
 *  measurement — and far under `tail.ts`'s backlog window, which is what bounds
 *  the agent's RSS. */
const TITLE_TAIL_BYTES = 256 * 1024;

/**
 * The LAST `ai-title` in the transcript's tail, or `null`.
 *
 * `null` covers three states the caller treats identically: no transcript, an
 * unreadable one, and one that carries no title. That last is a PERMANENT
 * state, not a startup window — nine of the 609 transcripts on this box have
 * none at all, including some very large ones — which is why the caller
 * stat-gates this read rather than paying for it every sweep forever.
 *
 * Stats the file itself rather than taking a size, mirroring `readPendingAsk`
 * (`ask.ts:55-58`): the caller's own stat is the GATE, this one sizes the tail.
 * Two stats and one ranged read per session per sweep, and in remote mode all
 * three cross the agent WS.
 */
export async function readAiTitle(io: FleetIO, file: string): Promise<string | null> {
  const stat = await io.stat(file);
  if (stat === null) return null;
  const from = Math.max(0, stat.size - TITLE_TAIL_BYTES);
  const chunk = await io.readFileFrom(file, from);
  if (chunk === null) return null;

  const lines = chunk.data.split('\n');
  if (from > 0) lines.shift();   // the tail almost certainly cut a line in half

  let title: string | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    // `null` and bare primitives are valid JSON, so the catch above never sees them.
    if (parsed === null || typeof parsed !== 'object') continue;
    const o = parsed as { type?: unknown; aiTitle?: unknown };
    if (o.type !== 'ai-title' || typeof o.aiTitle !== 'string') continue;
    // LAST wins, not first: Claude Code rewrites the line once per turn.
    // Measured on a 91 MB transcript — 1,809 `ai-title` lines, one distinct
    // value — so in practice they agree; the rule is stated anyway because
    // "they always agree" is not something this can check.
    if (o.aiTitle.trim() !== '') title = o.aiTitle;
  }
  return title;
}
