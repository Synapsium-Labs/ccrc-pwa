import type { ChatEvent } from '../../../shared/api.js';

const TOOL_RESULT_MAX = 20_000;
const TOOL_INPUT_MAX = 4_000;

/**
 * Cut to the cap, and REPORT WHAT WAS CUT (Build 4 Task 16).
 *
 * The cap is a CHARACTER cap and the report is in BYTES, on purpose (D-B4-12).
 * The cap stays a character cap because changing it changes what every
 * existing transcript renders; the report is bytes because a byte count is the
 * number an operator can compare against the file on disk, and because
 * `s.length - max` would under-report a multi-byte tail by up to 3x while
 * looking correct on every ASCII fixture.
 *
 * `truncatedBytes: 0` is ALWAYS returned, never omitted: absence on the wire
 * means "an older server did not report", and a parser that emitted the field
 * only when it cut something would make those two conditions indistinguishable
 * — the exact collapse the three states exist to prevent.
 */
const truncate = (s: string, max: number): { text: string; truncatedBytes: number } =>
  (s.length > max
    ? {
      text: s.slice(0, max),
      truncatedBytes: Buffer.byteLength(s, 'utf8') - Buffer.byteLength(s.slice(0, max), 'utf8'),
    }
    : { text: s, truncatedBytes: 0 });

/** Flatten a tool_result block's content (string, or array of text blocks) to one string. */
function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: unknown) => {
        if (typeof b === 'string') return b;
        const text = (b as { text?: unknown } | null)?.text;
        return typeof text === 'string' ? text : '';
      })
      .filter((s) => s !== '')
      .join('\n');
  }
  return '';
}

/**
 * Parse one transcript JSONL line into zero or more ChatEvents.
 * Defensive by contract: a malformed line returns [], never throws.
 */
export function parseTranscriptLine(line: string): ChatEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  if (raw === null || typeof raw !== 'object') return [];
  const env = raw as {
    type?: unknown;
    uuid?: unknown;
    timestamp?: unknown;
    isSidechain?: unknown;
    message?: { content?: unknown } | null;
  };
  if (env.isSidechain === true) return [];
  if (env.type !== 'user' && env.type !== 'assistant') return [];

  const uuid = typeof env.uuid === 'string' ? env.uuid : '';
  const ts = typeof env.timestamp === 'string' ? env.timestamp : '';
  const content = env.message?.content;
  const out: ChatEvent[] = [];

  if (env.type === 'user') {
    if (typeof content === 'string') {
      if (content.startsWith('<local-command-caveat>')) return [];
      if (content.startsWith('<command-name>')) {
        const m = content.match(/<command-name>([\s\S]*?)<\/command-name>/);
        const text = (m?.[1] ?? content).trim();
        if (text !== '') out.push({ kind: 'system', uuid, ts, text });
        return out;
      }
      if (content.trim() !== '') out.push({ kind: 'user', uuid, ts, text: content });
      return out;
    }
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown> | null>) {
        if (block?.type === 'tool_result') {
          const cut = truncate(flattenContent(block.content), TOOL_RESULT_MAX);
          out.push({
            kind: 'tool_result',
            ts,
            toolId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
            text: cut.text,
            isError: block.is_error === true,
            truncatedBytes: cut.truncatedBytes,
          });
        } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          out.push({ kind: 'user', uuid, ts, text: block.text });
        }
      }
    }
    return out;
  }

  // assistant
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content as Array<Record<string, unknown> | null>) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        texts.push(block.text);
      } else if (block?.type === 'tool_use') {
        let input = '';
        try {
          input = JSON.stringify(block.input ?? null) ?? '';
        } catch {
          input = '';
        }
        const cut = truncate(input, TOOL_INPUT_MAX);
        out.push({
          kind: 'tool_use',
          uuid,
          ts,
          toolId: typeof block.id === 'string' ? block.id : '',
          name: typeof block.name === 'string' ? block.name : '',
          input: cut.text,
          truncatedBytes: cut.truncatedBytes,
        });
      }
      // thinking blocks (and anything else) are skipped
    }
    if (texts.length > 0) out.unshift({ kind: 'assistant', uuid, ts, text: texts.join('\n') });
  } else if (typeof content === 'string' && content.trim() !== '') {
    out.push({ kind: 'assistant', uuid, ts, text: content });
  }
  return out;
}
