import { IDLE_COMPACT_NOTICE_PREFIXES, TASKS_STALE_MS, type AskState, type SessionLifecycle, type SessionStatus } from '../../shared/api.js';

/**
 * `idle-compact-nudge` (D-5373). L1: pure decisions, no `fs`, no clock of its own.
 *
 * Claude Code's idle ("sleep") compaction runs about 55 minutes after a turn
 * ENDED, before the prompt cache expires, and starts no turn (110 of 111
 * measured post-compaction "stalls", 2026-10-17). The operator ruled "Nudge if
 * work is open": type one "continue" prompt after an idle compaction when the
 * session's task list is fresh and has open items. This module decides
 * whether one compaction earns that prompt; `watch.ts`'s `sweepIdleCompactNudge`
 * gathers the facts and types it through `sendPrompt`.
 *
 * AT MOST ONCE PER COMPACTION, and only when EVERY hold below is clear. Every
 * fact the lane could not read is a hold, never a pass: a nudge starts a turn
 * the operator did not ask for, so doubt types nothing.
 */

/** Every reason the lane types nothing, enumerated once. */
const IDLE_NUDGE_HOLD_MAP = {
  disabled: 'the kill switch `$REG/idle-compact-nudge-disabled` exists',
  'no-store': 'no coordination store: the once-per-compaction record has nowhere durable to live',
  unmeasured: 'the fleet row, the registry identity or the live status could not be measured',
  'not-running': 'the session is not supervised and live (stopped, dead, orphaned, unmeasurable)',
  archived: 'the workspace is archived',
  'not-idle': 'the live status is not idle',
  dialog: 'a pane menu or a permission dialog is pending',
  ask: 'an AskUserQuestion or a coordination ask is open',
  'no-marker': 'the turn marker is absent or did not read: no proof the turn finished',
  'turn-open': 'the turn marker is not `done`',
  background: 'the turn marker counts background work (bg is not 0)',
  'tasks-unread': 'the task list could not be read',
  'no-open-tasks': 'the task list has no in_progress or pending item',
  'tasks-stale': 'the task list was last touched longer ago than TASKS_STALE_MS',
  'no-compaction': 'the transcript tail holds no compaction boundary',
  'not-idle-compaction': 'the compaction was not an idle one (no notice, and the turn had not finished before it)',
  'turn-after': 'a turn ran after the compaction',
  'operator-typed': 'a user entry follows the compaction',
  settling: 'the compaction or the idle status is younger than the settle window',
  'already-nudged': 'this compaction was already nudged (durable feed record or this process)',
} as const;
export type IdleNudgeHold = keyof typeof IDLE_NUDGE_HOLD_MAP;
export const IDLE_NUDGE_HOLDS = Object.keys(IDLE_NUDGE_HOLD_MAP) as IdleNudgeHold[];

/** The kill switch: a whole file name in the registry listing. No writer in the tree; touched and removed by hand on
 *  the fleet box, the `stall-watch-disabled` precedent (`single-definition.test.ts` pins that). */
export const IDLE_NUDGE_DISABLED_MARKER = 'idle-compact-nudge-disabled';
export function idleNudgeDisabled(names: readonly string[]): boolean {
  return names.includes(IDLE_NUDGE_DISABLED_MARKER);
}

/** How long the session must have stayed idle after the compaction, and the compaction must have aged, before the
 *  prompt is typed. Claude Code writes its notice ~2 s after the boundary and rewrites the live status once; a real
 *  mid-turn compaction resumes within ~3 s (measured). */
export const IDLE_NUDGE_SETTLE_MS = 30_000;

/** What the transcript tail says about the newest compaction in it. */
export type CompactionTail =
  | { readonly kind: 'none' }
  | {
    readonly kind: 'compaction';
    /** The boundary row's uuid, or its timestamp when it has none: the once-per-compaction key. */
    readonly key: string;
    /** The boundary's timestamp, epoch ms (null when unparseable). */
    readonly at: number | null;
    readonly trigger: string | null;
    /** Claude Code's idle-compaction notice follows the boundary. */
    readonly notice: boolean;
    /** The last main-thread assistant row before the boundary ended its turn (`end_turn`) and a
     *  `stop_hook_summary`/`turn_duration` row followed it, with no prompt after. */
    readonly finishedBefore: boolean;
    /** An assistant row, or a tool result, follows the boundary. */
    readonly turnAfter: boolean;
    /** A user entry (not the summary, not a harness `isMeta` row) follows the boundary — the operator, or a nudge. */
    readonly userAfter: boolean;
  };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const TURN_END_SUBTYPES: readonly string[] = ['stop_hook_summary', 'turn_duration'];

/** A user row's content is only tool results: a turn in progress, never a prompt. */
function toolResultsOnly(content: unknown): boolean {
  return Array.isArray(content) && content.length > 0
    && content.every((b) => isRecord(b) && b['type'] === 'tool_result');
}

/** An `attachment` row carrying a queued command: Claude Code absorbs a prompt typed mid-turn into one
 *  (`transcript/parse.ts`'s `absorbedPrompt` reads the human ones). Any of them after the boundary holds, wider than
 *  the chat's reader on purpose: doubt types nothing. */
function absorbedPrompt(a: unknown): boolean {
  return isRecord(a) && a['type'] === 'queued_command';
}

/**
 * Scan a transcript tail (JSONL, oldest first; a cut first line and any unparseable line are skipped) for its NEWEST
 * compaction boundary and the facts around it. Sidechain rows are skipped: a subagent's rows are not the main turn.
 */
export function readCompactionTail(tail: string): CompactionTail {
  let endTurn = false;
  let stopSeen = false;
  let cur: {
    key: string; at: number | null; trigger: string | null; notice: boolean; finishedBefore: boolean;
    turnAfter: boolean; userAfter: boolean;
  } | null = null;
  for (const line of tail.split('\n')) {
    if (line.trim() === '') continue;
    let r: unknown;
    try { r = JSON.parse(line); } catch { continue; }
    if (!isRecord(r) || r['isSidechain'] === true) continue;
    const type = r['type'];
    if (type === 'system' && r['subtype'] === 'compact_boundary') {
      const meta = isRecord(r['compactMetadata']) ? r['compactMetadata'] : {};
      const ts = typeof r['timestamp'] === 'string' ? Date.parse(r['timestamp']) : NaN;
      const key = typeof r['uuid'] === 'string' && r['uuid'] !== '' ? r['uuid']
        : typeof r['timestamp'] === 'string' ? r['timestamp'] : null;
      if (key === null) { cur = null; continue; }
      cur = {
        key, at: Number.isFinite(ts) ? ts : null,
        trigger: typeof meta['trigger'] === 'string' ? meta['trigger'] : null,
        notice: false, finishedBefore: endTurn && stopSeen, turnAfter: false, userAfter: false,
      };
      endTurn = false; stopSeen = false;
      continue;
    }
    if (type === 'system') {
      const sub = r['subtype'];
      if (cur !== null && sub === 'informational' && typeof r['content'] === 'string') {
        const text = r['content'].trim();
        if (IDLE_COMPACT_NOTICE_PREFIXES.some((p) => text.startsWith(p))) cur.notice = true;
      }
      if (typeof sub === 'string' && TURN_END_SUBTYPES.includes(sub) && endTurn) stopSeen = true;
      continue;
    }
    if (type === 'assistant') {
      const msg = isRecord(r['message']) ? r['message'] : {};
      endTurn = msg['stop_reason'] === 'end_turn';
      stopSeen = false;
      if (cur !== null) cur.turnAfter = true;
      continue;
    }
    if (type === 'user') {
      if (r['isCompactSummary'] === true || r['isMeta'] === true) continue;
      const msg = isRecord(r['message']) ? r['message'] : {};
      if (toolResultsOnly(msg['content'])) { if (cur !== null) cur.turnAfter = true; }
      else if (cur !== null) cur.userAfter = true;
      endTurn = false; stopSeen = false;
      continue;
    }
    if (type === 'attachment' && absorbedPrompt(r['attachment'])) {
      if (cur !== null) cur.userAfter = true;
      endTurn = false; stopSeen = false;
    }
  }
  return cur === null ? { kind: 'none' } : { kind: 'compaction', ...cur };
}

/** The idle compaction the ruling names: Claude Code's own notice, or a context-trigger `auto` compaction whose turn
 *  had already finished. A `manual` compaction (the operator's or ccd's `/compact`) never qualifies without the notice. */
export function isIdleCompaction(c: CompactionTail): boolean {
  return c.kind === 'compaction' && (c.notice || (c.trigger === 'auto' && c.finishedBefore));
}

/** The facts the fleet row already carries: decided before any read is paid. */
export interface IdleNudgeRowFacts {
  readonly disabled: boolean;
  readonly durable: boolean;
  readonly unmeasured: boolean;
  readonly lifecycle: SessionLifecycle | null;
  readonly archived: boolean;
  readonly status: SessionStatus;
  readonly dialogPending: boolean;
  readonly askSummary: string | null;
  readonly ask: AskState | null;
}

/** An ask in these states is still waiting on someone; `unknown` is doubt and holds too. */
const OPEN_ASK: readonly AskState[] = ['held', 'answering', 'unknown'];

/** The row-level holds, cheapest first. Null = read on. */
export function idleNudgeRowHold(f: IdleNudgeRowFacts): IdleNudgeHold | null {
  if (f.disabled) return 'disabled';
  if (!f.durable) return 'no-store';
  if (f.unmeasured) return 'unmeasured';
  if (f.lifecycle !== 'running') return 'not-running';
  if (f.archived) return 'archived';
  if (f.status !== 'idle') return 'not-idle';
  if (f.dialogPending) return 'dialog';
  if (f.askSummary !== null || (f.ask !== null && OPEN_ASK.includes(f.ask))) return 'ask';
  return null;
}

export type IdleNudgeMark =
  | { readonly ok: true; readonly state: string; readonly bg: number }
  | { readonly ok: false };
export type IdleNudgeTasks =
  | { readonly ok: true; readonly open: number; readonly touchedAt: number | null }
  | { readonly ok: false };
export type IdleNudgeLive =
  | { readonly ok: true; readonly word: string; readonly since: number | null }
  | { readonly ok: false };

export interface IdleNudgeFacts extends IdleNudgeRowFacts {
  readonly now: number;
  readonly live: IdleNudgeLive;
  readonly mark: IdleNudgeMark;
  readonly tasks: IdleNudgeTasks;
  readonly compaction: CompactionTail;
  /** The durable record (a `nudge` feed row naming this compaction) or this process's attempted set. */
  readonly alreadyNudged: (key: string) => boolean;
}

export type IdleNudgeVerdict =
  | { readonly act: 'nudge'; readonly key: string }
  | { readonly act: 'hold'; readonly reason: IdleNudgeHold };

const hold = (reason: IdleNudgeHold): IdleNudgeVerdict => ({ act: 'hold', reason });

/** The whole decision. Every hold of the coordinator design, in order; the first that applies answers. */
export function decideIdleCompactNudge(f: IdleNudgeFacts): IdleNudgeVerdict {
  const row = idleNudgeRowHold(f);
  if (row !== null) return hold(row);
  if (!f.live.ok) return hold('unmeasured');
  if (f.live.word !== 'idle') return hold('not-idle');
  if (!f.mark.ok) return hold('no-marker');
  if (f.mark.state !== 'done') return hold('turn-open');
  if (f.mark.bg !== 0) return hold('background');
  if (!f.tasks.ok) return hold('tasks-unread');
  if (f.tasks.open === 0) return hold('no-open-tasks');
  if (f.tasks.touchedAt === null || f.now - f.tasks.touchedAt > TASKS_STALE_MS) return hold('tasks-stale');
  const c = f.compaction;
  if (c.kind !== 'compaction') return hold('no-compaction');
  if (!isIdleCompaction(c)) return hold('not-idle-compaction');
  if (c.turnAfter) return hold('turn-after');
  if (c.userAfter) return hold('operator-typed');
  if (c.at === null) return hold('settling');
  const quietSince = Math.max(c.at, f.live.since ?? c.at);
  if (f.now - quietSince < IDLE_NUDGE_SETTLE_MS) return hold('settling');
  if (f.alreadyNudged(c.key)) return hold('already-nudged');
  return { act: 'nudge', key: c.key };
}

/** The feed row's body: derived from the compaction alone, so it is the durable "already nudged" key
 *  (`CoordStore.hasFeedEvent` matches the body exactly). */
export function idleNudgeFeedBody(key: string): string {
  return `Typed a "continue" prompt after an idle compaction left open tasks (compaction ${key})`;
}
