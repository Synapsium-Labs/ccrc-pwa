// Which AskUserQuestion is on screen. The chat stream can't answer this: it caps
// tool inputs at TOOL_INPUT_MAX (4000), and a real question with previews runs
// past that — the one that motivated this feature serialised to 4572 bytes. So
// read the JSONL directly, untruncated.
import type { AskQuestion } from '../../../shared/api.js';
import type { FleetIO } from '../io.js';

/** Enough tail to hold the current turn comfortably. */
const TAIL_BYTES = 256 * 1024;

/** Line types that mean the conversation moved on. Everything else — attachment,
 *  system, ai-title, mode, queue-operation, pr-link, permission-mode,
 *  worktree-state, and whatever the harness adds next — is noise between a
 *  tool_use and its result. A DENYLIST on purpose: as an allowlist this guard
 *  wrongly rejects 6% of real answered asks, and the type list keeps growing. */
const CONVERSATIONAL = new Set(['user', 'assistant']);

function parseQuestions(input: unknown): AskQuestion[] | null {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  const out: AskQuestion[] = [];
  for (const raw of qs) {
    const q = raw as { question?: unknown; header?: unknown; multiSelect?: unknown; options?: unknown };
    if (typeof q.question !== 'string' || !Array.isArray(q.options)) return null;
    const options = q.options.map((o) => {
      const opt = o as { label?: unknown; description?: unknown; preview?: unknown };
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
    let o: { type?: unknown; message?: { content?: unknown } | null };
    try { o = JSON.parse(line); } catch { continue; }
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
