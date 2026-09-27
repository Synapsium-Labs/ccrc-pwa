import {
  envelopeMembers, NO_RESPONSE_TEXT, RATE_LIMIT_ERROR, RESUME_PROMPT_PREFIX, SYNTHETIC_MODEL,
  type ChatEvent,
} from '../../../shared/api.js';

const TOOL_RESULT_MAX = 20_000;
const TOOL_INPUT_MAX = 4_000;

/**
 * Cut to the cap, and REPORT WHAT WAS CUT (Build 4 Task 16).
 *
 * The cap is a CHARACTER cap and the report is in BYTES, on purpose (D-285 (was D-B4-12)).
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

/** Any ANSI colour/attr code. The FIFTH module-private copy of this line in
 *  `server/src` — `inject/send.ts`, `pane/dialog.ts`, `sessionws.ts` and
 *  `watch.ts` each hold their own, three of them saying so in a comment — and
 *  copied rather than exported for a reason that is not laziness: those four
 *  normalise a tmux PANE CAPTURE, this one normalises a transcript record.
 *  Two bounded contexts that share a regex and nothing else. One shared helper
 *  would be worth having; reaching it means editing four files in the
 *  pane-capture cluster that this fix has no business touching, and
 *  `single-definition.test.ts` scans named vocabularies, not regex literals, so
 *  nothing pins the agreement either way. Named here rather than hidden. */
const SGR = /\x1b\[[0-9;]*m/g;

/** A slash command's own stdout, ANCHORED TO THE WHOLE RECORD and greedy.
 *  Measured over this box's 18 session transcripts: all 64 such records are the
 *  envelope whole and entire, nothing before the `<` and nothing after the
 *  `>`. The anchors are what keep the read off a human: someone who pastes the
 *  offending row and then types a question fails `$` and stays a user turn,
 *  where a `startsWith` test would have captured to the first closing tag and
 *  thrown the question away. */
const COMMAND_STDOUT_RE = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/;

/**
 * What an envelope the harness wrote should read as, or null when the record is
 * not one. TWO envelopes, one reader, because they differ only in which member
 * NAMES them — and the name is the whole of the safety argument. A structural
 * "the record is entirely tag blocks" rule has zero false positives against
 * every human turn measured here and is still not safe, because no human turn
 * measured here so much as begins with `<`: the corpus never exercised it.
 *
 * ORDER-INDEPENDENT, which `content.startsWith('<command-name>')` was not: the
 * harness does not fix the tag order, and of 76 envelopes measured here 64 put
 * `<command-name>` first while 12 put `<command-message>` first. Those 12 render
 * as raw XML in a bubble attributed to the operator — 16% of one family, missed
 * by construction rather than by oversight.
 */
function harnessEnvelope(s: string): string | null {
  const members = envelopeMembers(s);
  if (members === null) return null;

  // A slash command the operator ran. The row's job is to say WHICH, so the
  // name is the text. Returns the whole record when the envelope names an empty
  // command, never the empty string: the old read's `if (text !== '')` dropped
  // such a record outright, and a parser that can delete a turn is worse than
  // one that renders an ugly one.
  const named = members.find((m) => m.name === 'command-name');
  if (named !== undefined) {
    const text = named.value.trim();
    return text === '' ? s.trim() : text;
  }

  // The harness reporting a background task it finished — 13 records measured,
  // 418 B to 50,760 B, and 12 of the 13 carry no `isMeta`, so the member name
  // is the only signal there is.
  //
  // The text is the record VERBATIM. Reading it into summary/status/fields is
  // `parseTaskNotification`'s job in `shared/`, and rendering those is the
  // delivery layer's — the same three-part split mail already has
  // (`parseMailEnvelope` -> `buildChatItems` -> `MailCard`). This parser says
  // WHAT the record is; it does not reformat what the record says.
  if (members.some((m) => m.name === 'task-notification')) return s.trim();

  return null;
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
    isMeta?: unknown;
    message?: { content?: unknown; model?: unknown } | null;
    isApiErrorMessage?: unknown;
    error?: unknown;
    quotaLimits?: unknown;
  };
  if (env.isSidechain === true) return [];
  if (env.type !== 'user' && env.type !== 'assistant') return [];

  const uuid = typeof env.uuid === 'string' ? env.uuid : '';
  const ts = typeof env.timestamp === 'string' ? env.timestamp : '';
  const content = env.message?.content;
  const out: ChatEvent[] = [];

  if (env.type === 'user') {
    // D-2228: the harness's own resume prompt — META, never a human. The prefix
    // is the sentence Claude Code's default is; ccd's longer prompt starts with it.
    if (env.isMeta === true && flattenContent(content).trim().startsWith(RESUME_PROMPT_PREFIX)) {
      return [{ kind: 'system', uuid, ts, text: RESUME_PROMPT_PREFIX, origin: 'resume-prompt' }];
    }
    if (typeof content === 'string') {
      // Claude Code's caveat banner is nobody's speech, and stays a drop. It is
      // read FIRST and on its own literal: all 64 in the corpus carry `isMeta`,
      // but this repo's own fixture row does not, so the check is load-bearing
      // rather than redundant.
      if (content.startsWith('<local-command-caveat>')) return [];
      // An envelope the harness wrote — a slash command, or its own report of a
      // finished background task. Read BEFORE the `isMeta` arm below, because 5
      // of the 12 message-first envelopes carry the flag and their 64 siblings
      // do not. Reading the flag first would render one operator action two
      // ways, and would miss the 12 of 13 notifications that carry no flag.
      const envelope = harnessEnvelope(content);
      if (envelope !== null) {
        out.push({ kind: 'system', uuid, ts, text: envelope });
        return out;
      }
      // …and the ANSWER to that row. `ccd` already refuses to count this tag as
      // a human re-drive in its redrive detector; this parser was the reader
      // that did not. The inner text is terminal output, so SGR comes off:
      // measured across all 64 records the only control codepoints present are
      // ESC — every one of them `\e[2m` or `\e[22m` — and LF. No cursor moves,
      // no erase, no OSC, no CR, and no ESC survives the strip.
      const stdout = COMMAND_STDOUT_RE.exec(content);
      if (stdout !== null) {
        out.push({ kind: 'system', uuid, ts, text: stdout[1].replace(SGR, '').trim() });
        return out;
      }
      if (content.trim() === '') return out;
      // THE HARNESS'S OWN MARKER. `isMeta` is written by Claude Code and by
      // nothing in this tree; the compose path (`inject/send.ts`) writes a plain
      // user record. Measured over this box's 18 session transcripts: 99
      // non-sidechain user records carry it — 64 caveats, 14 image-scaling
      // notes, 13 injected SKILL.md bodies, 5 command envelopes, 3 resume
      // prompts — and ZERO human turns.
      //
      // It RE-ATTRIBUTES, it never drops. The flag belongs to a harness this
      // tree does not version, so if some build ever stamps it on something an
      // operator typed, that turn still renders IN FULL under the wrong label,
      // which a reader can see through. A deleted turn cannot be.
      if (env.isMeta === true) out.push({ kind: 'system', uuid, ts, text: content });
      else out.push({ kind: 'user', uuid, ts, text: content });
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
          // The same rule, and it lives HERE rather than above the loop so it
          // cannot swallow a block it does not understand: this is where the
          // injected skill bodies land (13 records, 746,871 bytes, the largest
          // 92,401), and a guard hoisted above the loop and fed through
          // `flattenContent` would take the tool_result arm's records with them
          // — that helper reads `b.text`, and a tool_result carries `.content`.
          if (env.isMeta === true) out.push({ kind: 'system', uuid, ts, text: block.text });
          else out.push({ kind: 'user', uuid, ts, text: block.text });
        }
      }
    }
    return out;
  }

  // D-2365: the row Claude Code appends on a 429 is a harness event, not the
  // model. The FIELDS decide (`error`, not the sentence); `resetsAt` is copied
  // in the unit Claude Code wrote it (epoch seconds) and dropped when it is not
  // a number — an adapter may not coerce a distinction it received.
  if (env.isApiErrorMessage === true && env.error === RATE_LIMIT_ERROR) {
    const q = env.quotaLimits;
    const resetsAt = q !== null && typeof q === 'object' && typeof (q as { resetsAt?: unknown }).resetsAt === 'number'
      ? (q as { resetsAt: number }).resetsAt : undefined;
    const text = flattenContent(content).trim() || 'usage limit reached';
    return [{ kind: 'system', uuid, ts, text, origin: 'limit', ...(resetsAt !== undefined ? { resetsAt } : {}) }];
  }

  // D-2228: the padding Claude Code writes after an unsubmitted resume prompt.
  // The MODEL decides — a real model saying these words is a reply.
  if (env.message?.model === SYNTHETIC_MODEL && flattenContent(content).trim() === NO_RESPONSE_TEXT) {
    return [{ kind: 'system', uuid, ts, text: NO_RESPONSE_TEXT, origin: 'no-response' }];
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
