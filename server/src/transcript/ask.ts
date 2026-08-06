// Which AskUserQuestion is on screen. The chat stream can't answer this: it caps
// tool inputs at TOOL_INPUT_MAX (4000), and a real question with previews runs
// past that — the one that motivated this feature serialised to 4572 bytes. So
// read the JSONL directly, untruncated.
import type { AskQuestion, DialogAsk } from '../../../shared/api.js';
import type { FleetIO } from '../io.js';

/** Enough tail to hold the current turn comfortably. */
const TAIL_BYTES = 256 * 1024;

/** Line types that mean the conversation moved on. Everything else — attachment,
 *  system, ai-title, mode, queue-operation, pr-link, permission-mode,
 *  worktree-state, and whatever the harness adds next — is noise between a
 *  tool_use and its result. A DENYLIST on purpose: as an allowlist this guard
 *  wrongly rejects 6% of real answered asks, and the type list keeps growing. */
const CONVERSATIONAL = new Set(['user', 'assistant']);

/** The transcript is logged before it is validated, so a node the shape says is an
 *  object can be null or a primitive. Read properties off an empty object instead
 *  of throwing on them — every miss then falls through to a null return. */
const asObject = (v: unknown): object => (v !== null && typeof v === 'object' ? v : {});

function parseQuestions(input: unknown): AskQuestion[] | null {
  const qs = (asObject(input) as { questions?: unknown }).questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  const out: AskQuestion[] = [];
  for (const raw of qs) {
    const q = asObject(raw) as { question?: unknown; header?: unknown; multiSelect?: unknown; options?: unknown };
    if (typeof q.question !== 'string' || !Array.isArray(q.options)) return null;
    const options = q.options.map((o) => {
      const opt = asObject(o) as { label?: unknown; description?: unknown; preview?: unknown };
      return {
        label: typeof opt.label === 'string' ? opt.label : '',
        description: typeof opt.description === 'string' ? opt.description : undefined,
        preview: typeof opt.preview === 'string' ? opt.preview : undefined,
      };
    });
    if (options.some((o) => o.label === '')) return null;
    out.push({
      question: q.question,
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options,
    });
  }
  return out;
}

/**
 * The AskUserQuestion still awaiting an answer on screen, or null.
 * Never throws — a malformed transcript degrades to "no structured question",
 * and the sheet falls back to the scraped pane.
 */
export async function readPendingAsk(io: FleetIO, file: string): Promise<AskQuestion[] | null> {
  const stat = await io.stat(file);
  if (stat === null) return null;
  const from = Math.max(0, stat.size - TAIL_BYTES);
  const chunk = await io.readFileFrom(file, from);
  if (chunk === null) return null;

  const lines = chunk.data.split('\n');
  if (from > 0) lines.shift();   // the tail almost certainly cut a line in half

  let found: { at: number; id: string; questions: AskQuestion[] } | null = null;
  const answered = new Set<string>();
  const conversationalAt: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    // `null` and bare primitives are valid JSON, so the catch above never sees them.
    if (parsed === null || typeof parsed !== 'object') continue;
    const o = parsed as { type?: unknown; message?: { content?: unknown } | null };
    const type = typeof o.type === 'string' ? o.type : '';
    if (CONVERSATIONAL.has(type)) conversationalAt.push(i);
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<Record<string, unknown> | null>) {
      if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') answered.add(b.tool_use_id);
      if (b?.type === 'tool_use' && b.name === 'AskUserQuestion' && typeof b.id === 'string') {
        const questions = parseQuestions(b.input);
        if (questions) found = { at: i, id: b.id, questions };
      }
    }
  }

  if (found === null) return null;
  if (answered.has(found.id)) return null;
  // Gate 2: nothing conversational after it. Line positions, not message ids —
  // one assistant message spans consecutive lines (thinking, thinking, tool_use).
  if (conversationalAt.some((at) => at > found!.at)) return null;
  return found.questions;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** Either side may be the truncated one: `leftCol` cuts a scraped label at a run
 *  of two spaces or at the two-column gutter, so compare as prefixes.
 *
 *  THE rule for "this scraped row and this structured option are the same
 *  option", exported because `inject/ask.ts`'s menu-identity gate must decide
 *  the same question a keystroke earlier, and `DialogSheet.tsx` mirrors it
 *  client-side (it cannot import server code; see its `prefixMatches`). Three
 *  layers, one rule — a second definition here would let them disagree about
 *  which menu is on screen while each stayed internally consistent. */
export const pairMatches = (a: string, b: string): boolean => {
  const [x, y] = [norm(a), norm(b)];
  return x !== '' && y !== '' && (x.startsWith(y) || y.startsWith(x));
};

/**
 * Which of the pending questions the on-screen menu is showing, or null.
 *
 * Head-anchored: only the first `ask.options.length` scraped rows are considered.
 * Rows past that are the TUI's own — numbered in one-column layout
 * (`4. Type something.`), unnumbered-then-appended in two-column — and nothing in
 * Dialog.options marks them, which is why a "fraction of rows matched" rule has
 * no definable denominator.
 *
 * The returned `options` are per POSITION, and a position that did NOT match
 * comes back `null`: identifying the question is one judgement, and trusting a
 * given row's copy is another. From four options up a single disagreeing row is
 * forgiven (a capture taken mid-redraw drops one, and the TUI's own rows slide
 * up into the hole) — but forgiving it is not the same as believing it, and the
 * sheet renders by position, so that row keeps the pane's own copy.
 */
export function alignAsk(
  scraped: readonly { label: string }[],
  questions: readonly AskQuestion[],
): DialogAsk | null {
  const fits: DialogAsk[] = [];
  for (const q of questions) {
    const n = q.options.length;
    if (n === 0 || scraped.length < n) continue;
    const matched = q.options.map((o, i) => pairMatches(scraped[i]!.label, o.label));
    const miss = matched.filter((m) => !m).length;
    // Two-option questions are 29% of the corpus; one coincidental label must
    // never be enough evidence.
    if (n >= 4 ? miss > 1 : miss > 0) continue;
    fits.push({ ...q, options: q.options.map((o, i) => (matched[i] ? o : null)) });
  }
  return fits.length === 1 ? fits[0]! : null;
}
