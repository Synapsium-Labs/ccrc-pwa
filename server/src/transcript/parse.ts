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
 * D-4950. The operator's message as Claude Code records it when it ABSORBS the
 * message mid-turn, or null when the record is anything else.
 *
 * A message sent to a busy session is queued in the pane, and on current Claude
 * Code the usual fate of a queued message is not a turn of its own: the harness
 * hands it to the model at the next tool boundary and writes three records —
 * `{"type":"queue-operation","operation":"enqueue"}`, the same with
 * `"operation":"remove","reason":"absorbed_mid_turn"`, and
 *
 *     {"type":"attachment","uuid":…,"timestamp":…,"attachment":{"type":"queued_command",
 *      "prompt":"<the text>","commandMode":"prompt","origin":{"kind":"human"},…}}
 *
 * — and NO `type:"user"` record, ever. Measured 2026-10-13 over the fleet's 25
 * most recent transcripts: 1058 enqueues, 578 dequeues and 467 removes as
 * `absorbed_mid_turn`; the shape is in transcripts from 2.1.201 builds on, and
 * the 2.1.296 binary still writes it. So the absorbed path is the common case,
 * not an edge, and reading only `user` records made that message invisible
 * twice over: the chat never showed it, and the PWA's optimistic bubble never
 * met its echo and sat under Claude's answer to it for the whole ten-minute
 * queued horizon before vanishing anyway.
 *
 * Read as a `user` event — what it IS — so the chat shows it once, at the point
 * in the turn where the model actually received it, and the PWA's existing
 * echo match clears the bubble with no second matcher. ONCE is measured, not
 * assumed: over 25 recent transcripts, 44 queued `prompt` records, the only one
 * whose text also appeared as a user record was a one-letter answer typed
 * twice. A dequeued message is written as an ordinary user record and gets no
 * attachment, so the two paths never describe the same message.
 *
 * BOTH fields decide, positively, because the queue carries more than the
 * operator. `origin.kind` names the speaker: `human` is the pane's input box,
 * which is where the PWA's tmux path types (a mail nudge arrives the same way,
 * and reads here exactly as it does when it lands as a user record); the same
 * record also arrives as `peer` (another agent's message, with mode `prompt`),
 * `task-notification` (or no origin at all, on older builds) and further kinds
 * the 2.1.296 binary spells (`plugin`, `channel`, `auto-continuation`, …).
 * `commandMode` names what kind of input it was: `prompt` is prose, while the
 * binary's queue also holds `bash`, `task-notification` and `poll-event`
 * items — a human's `!cmd` would be the first, and is not something they SAID.
 * No human item in any mode but `prompt` was seen in the transcripts measured.
 * An item that fails either test is dropped exactly as every attachment was
 * before this read existed.
 *
 * The text is the prompt VERBATIM, as a string user record's content is — the
 * PWA compares it byte for byte against `composePrompt`'s output. The
 * `rendered` member is the system-reminder the MODEL was shown, not what the
 * operator typed, and is never read.
 */
function absorbedPrompt(attachment: unknown): string | null {
  if (attachment === null || typeof attachment !== 'object') return null;
  const a = attachment as { type?: unknown; prompt?: unknown; commandMode?: unknown; origin?: unknown };
  if (a.type !== 'queued_command' || a.commandMode !== 'prompt') return null;
  const origin = a.origin;
  if (origin === null || typeof origin !== 'object' || (origin as { kind?: unknown }).kind !== 'human') return null;
  if (typeof a.prompt !== 'string' || a.prompt.trim() === '') return null;
  return a.prompt;
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
    attachment?: unknown;
  };
  if (env.isSidechain === true) return [];

  const uuid = typeof env.uuid === 'string' ? env.uuid : '';
  const ts = typeof env.timestamp === 'string' ? env.timestamp : '';

  // D-4950: the one attachment that is the operator's own message.
  if (env.type === 'attachment') {
    const text = absorbedPrompt(env.attachment);
    return text === null ? [] : [{ kind: 'user', uuid, ts, text }];
  }
  if (env.type !== 'user' && env.type !== 'assistant') return [];
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

/** How many bytes of a transcript's tail a reader needs to see its last line.
 *  Every reader of the marker uses this one window — the server here, `ccd`'s
 *  `_sync_uuid` and `ccrc doctor`'s `transcripts` check, whose bash copies are
 *  held equal to this number by `server/test/continued-in-parity.test.ts`. */
export const CONTINUATION_TAIL_BYTES = 8192;

const UUID_RE = /^[0-9a-f-]{36}$/;

/**
 * The session this transcript CONTINUES IN, or null.
 *
 * Claude Code 2.1.278 forks a live session into a daemon-hosted background PTY
 * under a new sessionId and writes, as the last line of the file it abandons:
 *
 *     {"type":"continued-in","sessionId":"<old>","continuedInSessionId":"<new>"}
 *
 * This is the harness's own statement about itself, so it is read rather than
 * inferred — but it is also data off a disk other processes write, so every
 * field is checked before it is believed.
 *
 * `ofUuid` is the uuid of the file the line came from. A marker naming a
 * DIFFERENT `sessionId` is not this file's marker and is refused; a marker
 * naming no `sessionId` at all is accepted (absence-permits — an older or
 * newer harness may not write the field, and the line's position at the end of
 * this file is already evidence enough). A successor that is not a uuid, or is
 * this file's own uuid, is refused: the first is unusable and the second is a
 * one-element cycle.
 *
 * Never throws. A caller reading a file's tail can land on a half-written line,
 * and a parse failure there means "not a marker", not "the session is broken".
 */
export function continuationOf(line: string, ofUuid: string): string | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r['type'] !== 'continued-in') return null;
  const from = r['sessionId'];
  if (typeof from === 'string' && from !== ofUuid) return null;
  const to = r['continuedInSessionId'];
  if (typeof to !== 'string' || !UUID_RE.test(to) || to === ofUuid) return null;
  return to;
}
