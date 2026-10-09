// server/test/historyFixtures.ts — synthetic Claude Code transcript rows for
// the ccrc history suites (spec 2026-10-05). A helper module with no
// `describe`: importing a .test.ts from another test registers its suite
// twice, so shared builders live in a *Fixtures.ts file (the
// compactCardFixtures.ts precedent).
//
// Every value here is synthetic: fixture uuids, `/home/u/...` paths, the
// fixture project `p`. No real transcript content, account, session id or
// host is ever pasted in; the repo is public.
//
// KEY PATHS, AND WHERE EACH WAS CONFIRMED. The builders spell the row shapes
// Claude Code 2.1.289 writes. Their KEY NAMES (never values) were measured on
// a real transcript by the spec's research pass (2026-10-05, read-only, key
// names only):
//   - compact_boundary: `type:'system'`, `subtype:'compact_boundary'`, `uuid`,
//     `parentUuid`, `logicalParentUuid`, `timestamp`, `cwd`, `gitBranch`,
//     `sessionId`, `content`, `compactMetadata{trigger, preTokens,
//     postTokens, durationMs, preservedSegment{headUuid, anchorUuid,
//     tailUuid}, preservedMessages{anchorUuid, uuids[], allUuids[]}}`.
//     `allUuids` sits under `preservedMessages`, not `preservedSegment` (the
//     spec's §6.10 item 3 wording slips; §4.1 G12 is right).
//   - the summary row: `type:'user'`, `isCompactSummary:true`,
//     `isVisibleInTranscriptOnly:true`, `message.content` a string.
//   - assistant rows: `message{role, model, id, content[]}`, `requestId`.
//   - tool output rows: `type:'user'` with `tool_result` blocks, and
//     `sourceToolUseID` on rows a tool produced.
// Plan-chosen (not measured, and not read by anything but `isStoredRow`):
// the keys of the uuid-less `bridge-session` row beyond `type`. A uuid-less
// row is never stored whatever else it carries (G13), so its other keys only
// need to be plausible. A worker who re-measures on a dev box records the
// result here, key names only.

export type Row = Record<string, unknown>;

export interface RowBase {
  uuid: string;
  /** ISO-8601, the shape Claude Code writes (`2026-10-01T10:00:00.000Z`). */
  ts: string;
  parentUuid?: string | null;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
}

const envelope = (o: RowBase): Row => ({
  parentUuid: o.parentUuid ?? null,
  isSidechain: false,
  userType: 'external',
  cwd: o.cwd ?? '/home/u/worktrees/p/quiet-basin',
  sessionId: o.sessionId ?? '0189abcd-1234-4678-9abc-000000000001',
  version: '2.1.289',
  gitBranch: o.gitBranch ?? 'ws/quiet-basin',
  uuid: o.uuid,
  timestamp: o.ts,
});

/** Typed operator text. */
export const userRow = (o: RowBase & { text: string }): Row => ({
  ...envelope(o), type: 'user', message: { role: 'user', content: [{ type: 'text', text: o.text }] },
});

/** One assistant text block. `thinking`, when given, becomes a thinking block
 *  BEFORE the text, the way Claude Code writes an extended-thinking turn. */
export const assistantRow = (o: RowBase & {
  text: string; model?: string; requestId?: string; msgId?: string; thinking?: string;
}): Row => ({
  ...envelope(o), type: 'assistant', requestId: o.requestId ?? 'req_fixture_0001',
  message: {
    id: o.msgId ?? 'msg_fixture_0001', type: 'message', role: 'assistant', model: o.model ?? 'claude-fixture-4',
    content: [
      ...(o.thinking === undefined ? [] : [{ type: 'thinking', thinking: o.thinking, signature: 'fixture-signature' }]),
      { type: 'text', text: o.text },
    ],
  },
});

/** An assistant `tool_use` block. */
export const toolUseRow = (o: RowBase & {
  toolUseId: string; name: string; input: Record<string, unknown>; model?: string; requestId?: string; msgId?: string;
}): Row => ({
  ...envelope(o), type: 'assistant', requestId: o.requestId ?? 'req_fixture_0001',
  message: {
    id: o.msgId ?? 'msg_fixture_0001', type: 'message', role: 'assistant', model: o.model ?? 'claude-fixture-4',
    content: [{ type: 'tool_use', id: o.toolUseId, name: o.name, input: o.input }],
  },
});

/** The user row carrying a tool's result. */
export const toolResultRow = (o: RowBase & {
  toolUseId: string; content: string | Array<{ type: 'text'; text: string }>; sourceToolUseID?: string;
}): Row => ({
  ...envelope(o), type: 'user',
  ...(o.sourceToolUseID === undefined ? {} : { sourceToolUseID: o.sourceToolUseID }),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: o.toolUseId, content: o.content }] },
});

export const systemRow = (o: RowBase & { subtype: string; content: string }): Row => ({
  ...envelope(o), type: 'system', subtype: o.subtype, content: o.content, level: 'info',
});

export const attachmentRow = (o: RowBase & { attachment: Record<string, unknown> }): Row => ({
  ...envelope(o), type: 'attachment', attachment: o.attachment,
});

/** A compact_boundary row with the measured metadata shape. Pass `omit` to
 *  drop named metadata fields, which is how a test models an older or newer
 *  Claude Code whose boundary lacks one. */
export const boundaryRow = (o: RowBase & {
  trigger: 'manual' | 'auto'; headUuid: string; anchorUuid: string; tailUuid: string; allUuids: string[];
  preTokens?: number; postTokens?: number; durationMs?: number;
  omit?: ReadonlyArray<'trigger' | 'preTokens' | 'postTokens' | 'durationMs' | 'preservedSegment' | 'preservedMessages'>;
}): Row => {
  const meta: Record<string, unknown> = {
    trigger: o.trigger, preTokens: o.preTokens ?? 160_000, postTokens: o.postTokens ?? 12_000, durationMs: o.durationMs ?? 41_000,
    preservedSegment: { headUuid: o.headUuid, anchorUuid: o.anchorUuid, tailUuid: o.tailUuid },
    preservedMessages: { anchorUuid: o.anchorUuid, uuids: o.allUuids, allUuids: o.allUuids },
  };
  for (const k of o.omit ?? []) delete meta[k];
  return {
    ...envelope(o), logicalParentUuid: o.parentUuid ?? null, type: 'system', subtype: 'compact_boundary',
    content: 'Conversation compacted', level: 'info', compactMetadata: meta,
  };
};

/** Claude Code's summary row, right after a boundary. */
export const summaryRow = (o: RowBase & { text: string }): Row => ({
  ...envelope(o), type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true,
  message: { role: 'user', content: o.text },
});

/** A uuid-less metadata row that carries account and organisation uuids
 *  (G13). It must never be stored. */
export const bridgeSessionRow = (o: { ts: string; accountUuid: string; organizationUuid: string }): Row => ({
  type: 'bridge-session', timestamp: o.ts, sessionId: '0189abcd-1234-4678-9abc-000000000001',
  accountUuid: o.accountUuid, organizationUuid: o.organizationUuid,
});

/** G16: a manual `/compact` echoes the PreCompact stdout into this user row
 *  after the summary row. Harness provenance, never parsed. */
export const localCommandEchoRow = (o: RowBase & { stdout: string }): Row => ({
  ...envelope(o), type: 'user',
  message: { role: 'user', content: `<local-command-stdout>${o.stdout}</local-command-stdout>` },
});

/** Rows as a transcript file's text: one JSON object per line, LF-terminated. */
export const jsonl = (rows: readonly Row[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// --- W1-B2 Task 4: summary text and steered blocks (spec 2026-10-05 §7.4) ---
/** The sections of Claude Code's full (and partial `from`) compaction prompt,
 *  and of its partial `up_to` prompt. MEASURED: the last two titles of each
 *  (spec §7.4 item 8, from the prompt text); the others are fixture-chosen. */
export const FULL_SECTIONS = [
  'Primary Request and Intent', 'Key Technical Concepts', 'Files and Code Sections', 'Errors and fixes',
  'Problem Solving', 'All user messages', 'Pending Tasks', 'Current Work', 'Optional Next Step',
] as const;
export const UP_TO_SECTIONS = [
  'Primary Request and Intent', 'Key Technical Concepts', 'Files and Code Sections', 'Errors and fixes',
  'Problem Solving', 'All user messages', 'Work Completed', 'Context for Continuing Work',
] as const;

export interface SummaryTextOpts {
  /** Section titles in order, numbered from 1; FULL_SECTIONS when omitted. */
  sections?: readonly string[];
  /** A section's text by title; `- fixture point for <title>` when omitted. */
  body?: Readonly<Record<string, string>>;
  /** `8. Current Work:` (plain), `## 8. Current Work` (hash) or `**8. Current Work:**` (bold). */
  style?: 'plain' | 'hash' | 'bold';
  /** No tags (a stored Claude-run summary), `<summary>…</summary>`, or an open never closed. */
  wrap?: 'none' | 'closed' | 'unclosed';
  before?: string;
  after?: string;
}

/** A summary row's text in the nine-section shape the native gist reads. */
export const summaryText = (o: SummaryTextOpts = {}): string => {
  const heading = (n: number, t: string): string =>
    (o.style === 'hash' ? `## ${n}. ${t}` : o.style === 'bold' ? `**${n}. ${t}:**` : `${n}. ${t}:`);
  const text = (o.sections ?? FULL_SECTIONS)
    .map((t, k) => `${heading(k + 1, t)}\n${o.body?.[t] ?? `- fixture point for ${t.toLowerCase()}`}\n`)
    .join('\n');
  const wrapped = o.wrap === 'closed' ? `<summary>\n${text}</summary>\n` : o.wrap === 'unclosed' ? `<summary>\n${text}` : text;
  return `${o.before ?? ''}${wrapped}${o.after ?? ''}`;
};

/** A steered `<ccrc-leaf|node>` block as W3's template asks for it (spec §7.4
 *  item 3). An id-less block carries `v="1"`, because the grammar needs one
 *  attribute after the tag name. */
export const steeredBlock = (o: {
  kind?: 'leaf' | 'node'; id?: string; gist: string; expand?: string; refs?: string | null; extra?: string;
}): string => {
  const kind = o.kind ?? 'leaf';
  return [
    `<ccrc-${kind} ${o.id === undefined ? 'v="1"' : `id="${o.id}"`}>`,
    `gist: ${o.gist}`,
    ...(o.expand === undefined ? [] : [`Expand for details about: ${o.expand}`]),
    ...(o.refs === undefined || o.refs === null ? [] : [`refs: ${o.refs}`]),
    ...(o.extra === undefined ? [] : [o.extra]),
    `</ccrc-${kind}>`,
  ].join('\n');
};
