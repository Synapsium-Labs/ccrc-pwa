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
