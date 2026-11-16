// D-5373: transcript rows in the SHAPES measured on fleet transcripts for an idle
// ("sleep") compaction, with neutral content. A finished turn (assistant
// end_turn, then stop_hook_summary and turn_duration), ~3,300 s of silence, the
// compaction (boundary, summary, the attachments Claude Code re-injects), and
// Claude Code's own notice. Times are epoch ms so a test can place `now`.
import { IDLE_COMPACT_NUDGE_PROMPT } from '../../shared/api.js';

/** The Stop: 17:43:12 on the measured session. */
export const T_STOP = Date.parse('2026-10-17T17:43:12.000Z');
/** The boundary: 3,286 s after the Stop (measured median 3,294 s). */
export const T_BOUNDARY = T_STOP + 3_286_000;
/** The notice: ~2 s after the boundary. */
export const T_NOTICE = T_BOUNDARY + 1_980;

const iso = (ms: number): string => new Date(ms).toISOString();

export const ROW = {
  prompt: { type: 'user', uuid: 'u1', isSidechain: false, timestamp: iso(T_STOP - 60_000),
    message: { role: 'user', content: 'Please write the next question.' } },
  toolUse: { type: 'assistant', uuid: 'a0', isSidechain: false, timestamp: iso(T_STOP - 30_000),
    message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'true' } }] } },
  toolResult: { type: 'user', uuid: 'r1', isSidechain: false, timestamp: iso(T_STOP - 20_000),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  endTurn: { type: 'assistant', uuid: 'a1', isSidechain: false, timestamp: iso(T_STOP),
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the third question.' }] } },
  stopHook: { type: 'system', subtype: 'stop_hook_summary', uuid: 'h1', isSidechain: false, timestamp: iso(T_STOP + 600) },
  turnDuration: { type: 'system', subtype: 'turn_duration', isMeta: false, uuid: 'd1', isSidechain: false, timestamp: iso(T_STOP + 1_000) },
  boundary: { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', level: 'info', uuid: 'b1', isSidechain: false,
    compactMetadata: { trigger: 'auto', preTokens: 201796, postTokens: 38994, durationMs: 68059 }, timestamp: iso(T_BOUNDARY) },
  summary: { type: 'user', isCompactSummary: true, uuid: 's1', isSidechain: false, timestamp: iso(T_BOUNDARY + 500),
    message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context. Continue the conversation from where it left off without asking the user any further questions.' } },
  attachment: { type: 'attachment', uuid: 'f1', isSidechain: false, timestamp: iso(T_BOUNDARY + 900),
    attachment: { type: 'file', filename: 'notes.md', content: 'neutral file body' } },
  notice: { type: 'system', subtype: 'informational', isMeta: false, level: 'notice', uuid: 'n1', isSidechain: false, timestamp: iso(T_NOTICE),
    content: 'Compacted while idle, before the prompt cache expired · turn off with "idleCompaction": false in settings.json' },
  lastPrompt: { type: 'last-prompt', lastPrompt: 'Please write the next question.', sessionId: 'x' },
  /** The operator typing after the compaction. */
  operator: { type: 'user', uuid: 'u2', isSidechain: false, timestamp: iso(T_NOTICE + 60_000),
    message: { role: 'user', content: 'Here is my answer.' } },
  /** The nudge itself, as `sendPrompt` lands it: a plain user row. */
  nudge: { type: 'user', uuid: 'u3', isSidechain: false, timestamp: iso(T_NOTICE + 40_000),
    message: { role: 'user', content: IDLE_COMPACT_NUDGE_PROMPT } },
  /** A turn after the compaction (the mid-turn shape resumes by itself in ~2 s). */
  resumed: { type: 'assistant', uuid: 'a2', isSidechain: false, timestamp: iso(T_BOUNDARY + 2_500),
    message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'true' } }] } },
} as const;

export const jsonl = (rows: readonly object[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

/** The measured idle-compaction tail, notice included. */
export const IDLE_TAIL: readonly object[] = [
  ROW.prompt, ROW.toolUse, ROW.toolResult, ROW.endTurn, ROW.stopHook, ROW.turnDuration,
  ROW.boundary, ROW.summary, ROW.attachment, ROW.notice, ROW.lastPrompt,
];
/** The same idle compaction with no notice row (an older or reworded notice): trigger auto after a finished turn. */
export const IDLE_TAIL_NO_NOTICE: readonly object[] = IDLE_TAIL.filter((r) => r !== ROW.notice);
/** A compaction in the middle of a turn: a tool result, the compaction, and the turn going on. */
export const MID_TURN_TAIL: readonly object[] = [
  ROW.prompt, ROW.toolUse, ROW.toolResult, ROW.boundary, ROW.summary, ROW.resumed,
];
