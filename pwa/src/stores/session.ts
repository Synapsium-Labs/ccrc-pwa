// Per-session zustand store: chat reducer over the `/ws/session/:id` stream
// plus optimistic prompt sends. The reducer (`applySessionMsg`) is pure and
// exported for unit tests; the store wraps it with connection wiring and the
// pending-send lifecycle.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  composePrompt,
  PRESENCE_REFRESH_MS,
  type ChatEvent,
  type Dialog,
  type HookAsk,
  type MailSummary,
  type SessionStatus,
  type SessionStreamMsg,
  type TaskItem,
} from '../../../shared/api';
import { api, ApiError, sendErrorText, type Api } from '../lib/api';
import { ReconnectingSocket, wsUrl } from '../lib/ws';

/** A staged image handed to send(). The path is what the server/dispatch see;
 *  the preview URL is carried only so the optimistic bubble can render the
 *  same thumbnail the composer chip did. */
export interface PendingAttachment {
  path: string;
  previewUrl?: string;
}

export interface PendingSend {
  key: string;
  text: string;
  state: 'sending' | 'failed';
  /** The sentence shown under the failed bubble. */
  error?: string;
  /** The server's own refusal token behind `error`. The bubble branches on
   *  this, never on the sentence. */
  code?: string;
  /** The box row the server READ, whenever a 409 carried one. Two failures
   *  carry it and they mean opposite things: on `draft-present` it is the
   *  OTHER text, already in the box, that this send refused to clobber (the
   *  Composer sheet shows it); on `enter-ignored` it is OUR OWN text, proven
   *  sitting in the box after both Enters were swallowed — which is what `Send
   *  it` sends back as its correspondence claim, so the rescue can only ever
   *  submit the message this bubble is showing. */
  draft?: string;
  /** The server PROVED `draft` is the whole message currently in the box and
   *  that one Enter would send exactly it. Read off the 409 body by
   *  `failureOf`, and cleared by `retry`/`resolve` alongside `code`/`draft`,
   *  because a stale flag would offer a button for a box the server has not
   *  re-measured.
   *
   *  ABSENT = no `Send it` button, and that is the safe direction rather than
   *  a gap: it is what an older server sends, and it is what today's server
   *  sends on the arms whose `draft` is somebody else's words or a failed
   *  clear's FRAGMENT. `draft` alone cannot carry this — it means three
   *  different things across the failure arms — which is why the flag is a
   *  separate field and not a synonym for a `code`. */
  submittable?: boolean;
  /** Remembered so retry() repeats the original call. */
  replaceDraft?: boolean;
  /** Staged images sent alongside text. Object-URL ownership lives here from
   *  send() until this pending is confirmed or explicitly abandoned (discard). */
  attachments?: PendingAttachment[];
  /** The API accepted this send and the session has not echoed it back yet —
   *  which is the ordinary fate of a message typed while the session is busy:
   *  the pane QUEUES it ("Press up to edit queued messages") and echoes it only
   *  when it gets to it.
   *
   *  A FLAG, NOT A STATE, deliberately. `ChatList`'s `PendingBubble` branches
   *  `state === 'sending'` against everything else, and everything else renders
   *  as the red "not sent" failure — so a third state token would paint a
   *  perfectly healthy queued message as an error. The renderer needs no change
   *  to stay correct today, and showing "queued" instead of "sending" is one
   *  line in it whenever that file is next open. */
  queued?: boolean;
  /** D-4952. The newest TRANSCRIPT timestamp this store held when the operator
   *  pressed send, in epoch ms: the BOX's clock, read off the events already
   *  on screen, never the phone's. Only an event strictly newer than this can
   *  be this message's echo (`isFresh`).
   *
   *  Stamped at `send()`, and RAISED at each re-send (`retry`/`resolve`) to the
   *  newest event on screen then, never lowered (`reSendBar`). What this
   *  excludes is history the operator had already been shown when they sent —
   *  which is what a backlog replays.
   *
   *  It is what THIS STORE had seen, not what the box had written: a screen
   *  that was stale at the send (the socket down, the backlog not yet in)
   *  admits a same-text message written in the gap, and that clears the bubble
   *  early — `main`'s behaviour, and the message itself still shows once it is
   *  delivered.
   *
   *  ABSENT when nothing from the transcript was on screen yet (before the
   *  first backlog, or right after a `rotated`): then there is no bar, and any
   *  matching event clears the bubble, exactly as before the field existed. */
  sentAfter?: number;
}

export interface SessionState {
  events: ChatEvent[]; // deduped by uuid (tool_result keyed by toolId)
  offset: number;
  uuid: string | null;
  status: SessionStatus | null;
  statusUpdatedAt: number | null;
  dialog: Dialog | null;
  /** The hook-sourced envelope (`session-hook.sh` via the `ask`/`ask_cleared`
   *  stream frames) — see DialogSheet's header comment for the full
   *  rationale and how it relates to (and takes display priority over)
   *  `dialog` above. */
  ask: HookAsk | null;
  tasks: TaskItem[]; // the session's task list, as the TUI's widget shows it
  /** D-5372: the tasks frame's `touchedAt` (newest task file mtime, epoch ms);
   *  absent when the frame carried none. Replaced with every tasks frame. */
  tasksTouchedAt?: number;
  /** Outstanding mail for THIS session — queued or delivered, never acked or
   *  rejected (the server filters, `sessionws.ts`'s `checkMail`). Replaced
   *  wholesale like `tasks`, because the frame is a statement about the
   *  present and these streams never queue (`lib/ws.ts:12-17`). */
  mail: MailSummary[];
  missingFile: string | null; // backlog missing:true → the attempted transcript path
  /** The transcript `offset` above was taken in — kept from EVERY backlog,
   *  found or missing, and echoed back as `?sinceFile=` on reconnect (§5.3).
   *
   *  Not the same field as `missingFile` next door and not derivable from it:
   *  that one is gated on `missing:true` and exists to name a path in a
   *  banner, this one is the address half of a resume. Since the ladder
   *  (§5.1) one uuid can resolve to SEVERAL files, so a bare `uuid:offset`
   *  resume is a byte offset with no file attached — the server honours it
   *  against whatever it resolves to now, which after a swap carried the
   *  transcript elsewhere is a different file. `null` only before the first
   *  backlog and immediately after a `rotated`; the server reads a missing
   *  echo as an older client and falls back to today's uuid-only resume. */
  file: string | null;
  /** The OTHER account this transcript was read from — set only when the
   *  resolver answered at its foreign-glob rung (§5.1 rung 6). Null on every
   *  ordinary session, which is what "own account" looks like on the wire. */
  strandedAccount: string | null;
  /** Whether the resolver finished looking. False means a rung was SKIPPED
   *  because the fleet host could not be read — rule (b): an unmeasured
   *  absence is a different fact from a measured one, and collapsing them
   *  would reproduce this whole spec's defect one seam further out. Absent on
   *  the wire reads as `true`: every pre-ladder server did complete its
   *  (shorter) search. */
  searchComplete: boolean;
  /** Whether the transcript itself was MEASURED. False means the server's
   *  stat (or, since the body read is measured too, its read) failed for a
   *  reason that is not a proven ENOENT — rule (b) again, one seam further
   *  in than `searchComplete`: the search may well have finished and still
   *  have measured nothing. Absent on the wire reads as `true`: every
   *  pre-field server did stat the file. */
  fileMeasured: boolean;
  pending: PendingSend[]; // optimistic sends
  conn: 'connecting' | 'open' | 'down';
  apply(msg: SessionStreamMsg): void;
  /** Decision `ask-answer-returns-next-screen`: the screen an answer route says the pane moved to (`DialogAnswered`'s
   *  `next`), applied by the sheet that sent the answer. It replaces `dialog` only while the store still holds the
   *  screen that was answered (`answeredId`), or no screen at all: a frame the stream delivered since is newer, and
   *  wins. A no-menu poll that cleared `dialog` before the answer came back is exactly what it overrides (the
   *  2026-10-16 report). `next: null` clears it, as `dialog_cleared` would. */
  applyAnswered(answeredId: string, next: Dialog | null): void;
  connect(): void;
  disconnect(): void;
  send(text: string, opts?: { replaceDraft?: boolean; attachments?: PendingAttachment[] }): Promise<void>;
  retry(key: string): void;
  /** Re-send a pending in place after a draft conflict — same record, so the
   *  attachments and their preview URLs survive. */
  resolve(key: string, text: string, opts: { replaceDraft: boolean }): void;
  discard(key: string): void;
}

export type SessionSnapshot = Pick<
  SessionState,
  'events' | 'offset' | 'uuid' | 'status' | 'statusUpdatedAt' | 'dialog' | 'ask' | 'tasks' | 'tasksTouchedAt' | 'mail'
> & {
  missingFile: string | null;
  strandedAccount: string | null;
  searchComplete: boolean;
  fileMeasured: boolean;
  file: string | null;
};

// Locally minted system dividers (rotation markers, notices) — uuid-prefixed so
// the reducer can tell them apart from transcript events.
let localSeq = 0;
const localDivider = (text: string): ChatEvent => {
  localSeq += 1;
  return { kind: 'system', uuid: `local-${localSeq}`, ts: new Date().toISOString(), text };
};
/** A divider this store minted, stamped with the PHONE's clock — never a
 *  transcript time. Exported so every reader of event time skips it the same
 *  way (`newestTranscriptTs` here, the quiet-gap divider in `ChatList`). */
export const isLocalDivider = (e: ChatEvent): boolean =>
  e.kind === 'system' && e.uuid.startsWith('local-');

/** Append `incoming` to `existing`, skipping events already present. */
function dedupeAppend(existing: ChatEvent[], incoming: ChatEvent[]): ChatEvent[] {
  const uuids = new Set<string>();
  const resultIds = new Set<string>();
  for (const e of existing) {
    if (e.kind === 'tool_result') resultIds.add(e.toolId);
    else uuids.add(e.uuid);
  }
  const fresh: ChatEvent[] = [];
  for (const e of incoming) {
    if (e.kind === 'tool_result') {
      if (resultIds.has(e.toolId)) continue;
      resultIds.add(e.toolId);
    } else {
      if (uuids.has(e.uuid)) continue;
      uuids.add(e.uuid);
    }
    fresh.push(e);
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** Pure reducer over the session stream — one message in, next snapshot out. */
export function applySessionMsg(s: SessionSnapshot, msg: SessionStreamMsg): SessionSnapshot {
  switch (msg.type) {
    case 'backlog': {
      // A rotation leaves only local divider(s) behind; the follow-up backlog
      // for the same uuid keeps them on top so "Session context reset" survives.
      const keep =
        msg.uuid === s.uuid && s.events.length > 0 && s.events.every(isLocalDivider)
          ? s.events
          : [];
      return {
        ...s,
        events: [...keep, ...msg.events],
        uuid: msg.uuid,
        offset: msg.offset,
        missingFile: msg.missing ? msg.file : null,
        // Unconditional, where `missingFile` above is gated: the file is the
        // address this `offset` is measured in, and a reconnect has to echo
        // it back (`connect()`'s `sinceFile`). `?? null` because this frame
        // is CAST, not revived (`ReconnectingSocket`'s `onMessage`) — the
        // same reason every other read on this path carries one.
        file: msg.file ?? null,
        // Wire names are `foreignAccount`/`searchComplete` (shared/api.ts's
        // `backlog` frame) — the store keeps `strandedAccount` as its own
        // name for the same fact (D4, §5.2), so `msg.foreignAccount` is the
        // one place the rename happens.
        strandedAccount: msg.foreignAccount ?? null,
        searchComplete: msg.searchComplete ?? true,
        fileMeasured: msg.fileMeasured ?? true,
      };
    }
    case 'events':
      return {
        ...s,
        events: dedupeAppend(s.events, msg.events),
        uuid: msg.uuid,
        offset: msg.offset,
      };
    case 'status':
      return { ...s, status: msg.status, statusUpdatedAt: msg.statusUpdatedAt };
    case 'dialog':
      return { ...s, dialog: msg.dialog };
    case 'dialog_cleared':
      return { ...s, dialog: null };
    case 'tasks':
      return { ...s, tasks: msg.tasks, tasksTouchedAt: msg.touchedAt };
    // Build 7 Task 6: the session's own outstanding mail, one row above the
    // plan (`@ccrc/ui` mail-strip.tsx). Same replace-wholesale rule as `tasks`
    // just above.
    case 'mail':
      return { ...s, mail: msg.mail };
    // The hook-sourced envelope (Task 8, PR C). It resets the exact same way
    // `dialog` does above: only its own `_cleared` message (and the store's
    // initial state) null it out — `rotated` below touches events/uuid/offset
    // only, because a transcript switch does not itself mean a live menu (or
    // the hook's envelope for one) went away.
    case 'ask':
      return { ...s, ask: msg.ask };
    case 'ask_cleared':
      return { ...s, ask: null };
    case 'rotated':
      // FIVE transcript facts die with the transcript (final review, Minor 6;
      // `fileMeasured` joined them with the measured-read completion) — only
      // `events`/`uuid`/`offset` were reset here, so a rotation left
      // `strandedAccount` still naming the account the PREVIOUS file was
      // stranded under and `searchComplete` still reporting the PREVIOUS
      // search. The server normally follows `rotated` with a backlog on the
      // next statement, so it is usually a one-frame window — but that send
      // can fail and the socket can die between the two frames, and a banner
      // that outlives its cause reads as a statement about what is on screen
      // now. `missingFile` (the can't-find banner's path) and `file` (the
      // resume echo) go with them for the same reason; carrying `file`
      // forward in particular would echo a path belonging to the OLD uuid.
      // Every one of the five is re-stated by the backlog that follows.
      return {
        ...s,
        events: [localDivider('Session context reset')],
        uuid: msg.uuid,
        offset: 0,
        file: null,
        missingFile: null,
        strandedAccount: null,
        searchComplete: true,
        fileMeasured: true,
      };
    case 'notice':
      return { ...s, events: [...s.events, localDivider(msg.message)] };
    default:
      // Two guarantees, not one. `satisfies never` keeps the compile-time
      // exhaustiveness this switch had before this arm existed: add a
      // variant to SessionStreamMsg and forget it here, and `tsc` fails
      // right at this line instead of silently compiling a build that drops
      // the frame. The `return s` beneath it is the runtime answer to a
      // DIFFERENT skew — an already-built old client meeting a newer
      // server's frame it was never compiled to know about. Shrug, not
      // corrupt: the snapshot comes back exactly as it went in, rather than
      // the `undefined` an unhandled case would return into the store.
      msg satisfies never;
      return s;
  }
}

const snapshotOf = (s: SessionState): SessionSnapshot => ({
  events: s.events,
  offset: s.offset,
  uuid: s.uuid,
  status: s.status,
  statusUpdatedAt: s.statusUpdatedAt,
  dialog: s.dialog,
  ask: s.ask,
  tasks: s.tasks,
  tasksTouchedAt: s.tasksTouchedAt,
  mail: s.mail,
  missingFile: s.missingFile,
  strandedAccount: s.strandedAccount,
  searchComplete: s.searchComplete,
  fileMeasured: s.fileMeasured,
  file: s.file,
});

/** Bare paths for dispatch/api.prompt — the only place attachments narrow
 *  down from the full { path, previewUrl } shape. Takes anything with an
 *  `attachments` field (a PendingSend, or send()'s own opts) so every caller
 *  can share this one narrowing rule. */
const pathsOf = (p: { attachments?: PendingAttachment[] }): string[] | undefined =>
  p.attachments?.length ? p.attachments.map((a) => a.path) : undefined;

/** Object URLs die with the pending that owned them. */
const revoke = (p: PendingSend | undefined): void => {
  for (const a of p?.attachments ?? []) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
};

/** D-4952. The newest timestamp among the TRANSCRIPT events in `events`, epoch
 *  ms — the bar a pending's echo has to clear (`PendingSend.sentAfter`).
 *
 *  WHY THE BOX'S CLOCK, and not a `Date.now()` stamped at send. A backlog is a
 *  replay: it re-sends up to the last fifty events of history (a reconnect, a
 *  swap repoint, a fork follow, the registry catch-up), and with a pending now
 *  living ten minutes, an old "yes" in that window used to clear a new,
 *  undelivered "yes". Telling the replay from the echo needs a statement of
 *  "after the send", and the two candidates fail differently:
 *  - a phone-clock stamp compares the phone's clock with timestamps Claude
 *    Code wrote on the box. Any skew lands straight in the answer: a phone a
 *    few seconds AHEAD refuses an idle session's echo, which arrives about a
 *    second after the send, and a phone BEHIND re-admits the very history this
 *    exists to refuse. Phone clocks are user-settable, and a skew allowance
 *    wide enough to be safe is a window of replayed history let back in.
 *  - a uuid seen-set is skew-free but answers a different question ("has this
 *    store seen this record?"): a store holds only what its last backlog's
 *    window showed it plus what it tailed since, so history it missed while
 *    disconnected reads as new, and a copy under fresh uuids would pass it.
 *  Both operands here come from ONE clock: the bar is the newest event on
 *  screen when the operator pressed send, the echo's time is the record Claude
 *  Code writes after it, and both were written by Claude Code on the same box
 *  (a swap moves a session between accounts on its box; a fork stays on it).
 *  A copy keeps its timestamps. Read in the 2.1.296 binary, not measured: no
 *  fork pair survives in the fleet's transcripts. A `[bg]` fork copies the old
 *  transcript byte for byte into a snapshot, and the successor resumes from it
 *  with `--fork-session`. The successor then records that history through
 *  Claude Code's ordinary transcript writer, which spreads each record
 *  (`{...record, sessionId: <new>, cwd, version, …}`). Neither that writer nor
 *  its metadata helper sets `timestamp`, so the original `uuid` and `timestamp`
 *  carry over. (`/branch` is a different copy path, the one that adds
 *  `forkedFrom`; the `[bg]` successor writes no `forkedFrom`.)
 *
 *  It errs two ways, in opposite directions:
 *  - the box's clock stepping BACKWARDS between the bar and the echo refuses
 *    the echo, and the bubble waits for the ten-minute fallback;
 *  - the bar is the newest event THIS STORE had seen, not the box's state at
 *    the send. A screen that was stale when the operator pressed send (the
 *    socket down, a reconnect's backlog not yet in) has a low bar, and a
 *    same-text message written in that gap passes it and clears the bubble
 *    early. That is what `main` did for every replay; the message itself still
 *    shows once it is delivered. A uuid seen-set has the same hole (above).
 *
 *  The bar is the MAX over the events on screen, never the first or the last:
 *  transcript order is not time order, because that same writer appends a
 *  resumed or copied record under the time it was first stamped.
 *
 *  Local dividers are skipped: they are minted here with the PHONE's clock
 *  (`localDivider`), and one on screen would raise the bar to phone time. An
 *  event whose `ts` does not parse is skipped too — a NaN in the running max
 *  would make every later comparison false and no echo could ever clear. */
function newestTranscriptTs(events: ChatEvent[]): number | undefined {
  let newest: number | undefined;
  for (const e of events) {
    if (isLocalDivider(e)) continue;
    const t = Date.parse(e.ts);
    if (Number.isNaN(t)) continue;
    if (newest === undefined || t > newest) newest = t;
  }
  return newest;
}

/** D-4952. Whether `e` can be `p`'s echo at all: newer than the bar `p` was
 *  sent over. Strictly newer — the bar IS an event the operator had already
 *  seen. An event whose own time does not parse cannot be shown to be newer,
 *  so against a bar it never clears; with no bar it is accepted as before. */
const isFresh = (e: ChatEvent, p: PendingSend): boolean =>
  p.sentAfter === undefined || Date.parse(e.ts) > p.sentAfter;

/** D-4952. The bar a RE-send (`retry`, `resolve`) carries: the newest event on
 *  screen at the re-send, and never lower than the bar `p` already had.
 *
 *  RAISED, because everything the store has shown by the time the operator
 *  presses Retry or Send it is history to this message, exactly as it is to a
 *  first send: a same-text message that landed while the pending sat failed (a
 *  "yes" typed in the terminal) would otherwise pass the first send's bar on a
 *  later replay and clear a re-send that has not been delivered.
 *
 *  NEVER LOWERED, because "the newest event now" can be no bar at all — right
 *  after a `rotated`, before its backlog, nothing from a transcript is on
 *  screen — and dropping the first send's bar would re-admit the history it
 *  refused.
 *
 *  The cost: an echo of an EARLIER attempt that was delivered after all (a
 *  failure reported on a send that landed) and is no newer than the re-send's
 *  bar no longer clears it. The re-send is delivered too and its own echo
 *  clears it; an error toward the ten-minute fallback, never toward clearing. */
function reSendBar(p: PendingSend, events: ChatEvent[]): number | undefined {
  const now = newestTranscriptTs(events);
  if (now === undefined) return p.sentAfter;
  return p.sentAfter === undefined ? now : Math.max(p.sentAfter, now);
}

/** D-4951. The command a pending would run, when it is one: the first word of
 *  the composed text if that text starts with `/` (`/effort ultracode` ->
 *  `/effort`), else null.
 *
 *  A slash command's echo is a `system` row whose text is the command NAME
 *  alone (`transcript/parse.ts`'s `harnessEnvelope` reads `<command-name>`;
 *  the arguments ride a separate `<command-args>` member and never come back
 *  in the text). Measured over the fleet's 60 most recent transcripts, every
 *  command an operator typed carries its slash in that member (`/effort`,
 *  `/compact`, `/model`, `/clear`, …); the slashless ones are skills the model
 *  loaded itself, which no pending sent.
 *
 *  Prose is null on purpose. A command's own stdout is a `system` row too and
 *  can be a single word, so "a system row equal to the text" would let one
 *  clear an operator's "ok". Read off the COMPOSED text, so a send with
 *  attachments — whose composed text leads with a clip path, and which the
 *  pane therefore never ran as a command — names a path no echo carries. */
const slashCommandOf = (p: PendingSend): string | null => {
  const composed = composePrompt(p.text, pathsOf(p) ?? []);
  return composed.startsWith('/') ? composed.split(/\s/, 1)[0]! : null;
};

/** Drop 'sending' pendings whose echo just arrived. Two echo shapes:
 *  - a `user` event whose text is the pending's composed text — the server
 *    injects composePrompt(text, paths), so matching on p.text alone would
 *    never fire for an attachment send. Since D-4950 this includes a message
 *    the session absorbed mid-turn, which the parser now reads as a user event.
 *  - a `system` event naming the pending's slash command (D-4951). Before it,
 *    the long fallback timer was the only thing that ever cleared a command's
 *    bubble — five seconds once, ten minutes since the queued stage, which left
 *    a "sending /compact" under the compaction it had visibly run. The timer
 *    stays as the fallback for a command that echoes nothing.
 *  Either way the event must be newer than the send (D-4952, `isFresh`).
 *
 *  Returns the KEYS it dropped alongside the next list — this function is pure
 *  and outside the store closure, so it cannot cancel a pending's own timer
 *  itself; the call site does that with `cleared`. */
/** The transcript's wrapper around a message Claude Code collapsed into a paste
 *  chip: `<pasted_content id="…">` and its closing tag (measured on Claude Code
 *  2.1.300, with blank lines added around it). */
const PASTED_WRAPPER = /<\/?pasted_content id="[^"]*">/g;

/** Is `echoed` the transcript's record of `sent`? Exactly, or (D-5087) once the
 *  paste-chip wrapper and ALL whitespace are removed from both: the server now
 *  submits our own chip, and the transcript gives the text back wrapped, with
 *  blank lines around it. Every visible character must still match. */
function sameSent(sent: string, echoed: string): boolean {
  if (sent === echoed) return true;
  if (!echoed.includes('<pasted_content id="')) return false;
  const bare = (t: string): string => t.replace(PASTED_WRAPPER, '').replace(/\s+/g, '');
  return bare(sent) === bare(echoed);
}

function clearConfirmed(
  pending: PendingSend[], msg: SessionStreamMsg,
): { pending: PendingSend[]; cleared: string[] } {
  if (msg.type !== 'events' && msg.type !== 'backlog') return { pending, cleared: [] };
  let next = pending;
  const cleared: string[] = [];
  for (const e of msg.events) {
    let echoes: (p: PendingSend) => boolean;
    if (e.kind === 'user') echoes = (p) => sameSent(composePrompt(p.text, pathsOf(p) ?? []), e.text);
    else if (e.kind === 'system') echoes = (p) => slashCommandOf(p) === e.text;
    else continue;
    const i = next.findIndex((p) => p.state === 'sending' && isFresh(e, p) && echoes(p));
    if (i >= 0) {
      revoke(next[i]);
      cleared.push(next[i]!.key);
      next = [...next.slice(0, i), ...next.slice(i + 1)];
    }
  }
  return { pending: next, cleared };
}

const failureOf = (e: unknown): { error: string; code?: string; draft?: string; submittable?: boolean } => {
  if (e instanceof ApiError) {
    const body = e.body;
    const b = typeof body === 'object' && body !== null
      ? (body as { error?: unknown; draft?: unknown; submittable?: unknown })
      : {};
    if (b.error === 'draft-present') {
      return { error: 'draft-present', code: 'draft-present', draft: typeof b.draft === 'string' ? b.draft : '' };
    }
    // `error` is the SENTENCE and `code` the server's token. They are kept
    // separate because the bubble now branches on the token (only
    // `enter-ignored` earns a Send it button) while still rendering the
    // sentence — reading the branch off the humanised text would break the
    // moment someone rewords it.
    //
    // The `draft` rides along whenever the refusal carried one. `enter-ignored`
    // does, and it is not decoration: it is the box row `Send it` must hand
    // back for the server's correspondence gate, and a bubble without it gets
    // no button at all rather than a button that submits an unproven box.
    //
    // `submittable` rides alongside `draft` with the SAME `typeof` discipline
    // — absence-permits, so an older server (and today's server on the arms
    // that withhold it) simply yields no flag, never a default of true. It is
    // NOT a synonym for the code: `draft` carries three meanings across the
    // failure arms and this is the only thing that tells the one the rescue
    // may act on from the one it must not.
    return {
      // The flag is read BEFORE the sentence, because `verify-failed` has two
      // outcomes under one code and only the flag separates them.
      error: sendErrorText(e.message, typeof b.submittable === 'boolean' ? b.submittable : undefined),
      code: e.message,
      ...(typeof b.draft === 'string' ? { draft: b.draft } : {}),
      ...(typeof b.submittable === 'boolean' ? { submittable: b.submittable } : {}),
    };
  }
  return { error: e instanceof Error ? e.message : 'send failed' };
};

export interface SessionStoreDeps {
  api?: Pick<Api, 'prompt'>;
  makeSocket?: (url: string) => WebSocket;
  /** How long a confirmed-by-api pending lingers waiting for its echo event
   *  before it is marked QUEUED (stage one — see `queuedTimeoutMs` below). */
  confirmTimeoutMs?: number;
  /** How long a QUEUED pending survives before it is retired. The five-second
   *  `confirmTimeoutMs` used to delete it, which is the defect: a busy session
   *  cannot echo inside five seconds, so the operator watched their own message
   *  vanish. The deletion is not removed — it is the terminal condition for
   *  every pending whose echo never comes (a command that writes no
   *  `<command-name>` row, a box clock that stepped back — `isFresh` — and an
   *  echo this store never receives) — it is moved to a horizon where a bubble
   *  quietly retiring is no longer a surprise.
   *
   *  THE BACKLOG WINDOW IS ONE OF THOSE (D-4952). Every backlog the server
   *  sends after the file on screen changed — a reconnect whose `sinceFile`
   *  no longer matches, a fork follow, a repoint, a registry catch-up, even
   *  one delayed by the resolver's back-off — replays only the newest fifty
   *  events (`BACKLOG_N` in `server/src/sessionws.ts`). An echo written while
   *  this store was not receiving, and pushed out of that window by fifty
   *  later events, is never seen: the bubble stays `sending`, truthfully, and
   *  retires here. The fix is server-side and not built: widen a backlog back
   *  to the first event newer than the client's oldest pending `sentAfter`
   *  (within a cap), after which `isFresh` and the echo match clear it with
   *  no change here.
   *
   *  When this landed, a slash command's `system` echo was not matched at all
   *  and this timer was the only way its bubble ever cleared; D-4951 made it
   *  the fallback. */
  queuedTimeoutMs?: number;
}

export type SessionStore = UseBoundStore<StoreApi<SessionState>>;

export function createSessionStore(id: string, deps: SessionStoreDeps = {}): SessionStore {
  const apiImpl = deps.api ?? api;
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 5_000;
  const queuedTimeoutMs = deps.queuedTimeoutMs ?? 10 * 60_000;
  let socket: ReconnectingSocket | null = null;
  /** The presence heartbeat's timer — see `beat` below. */
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let keySeq = 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Arm a deadline for `key`, disarming whatever this key had before.
   *
   *  A bare `timers.set` replaces the MAP ENTRY and leaves the old
   *  `setTimeout` running — and that stray timer still holds this key, so when
   *  it fires it deletes a pending that a re-send has since put back in
   *  flight. That is the "my message vanished while waiting" defect arriving
   *  through the rescue path, which is why both arming sites go through here
   *  rather than remembering to clear first. */
  const arm = (key: string, ms: number, fn: () => void): void => {
    const prev = timers.get(key);
    if (prev !== undefined) clearTimeout(prev);
    timers.set(key, setTimeout(fn, ms));
  };

  const store = create<SessionState>()((set, get) => {
    // Api accepted the prompt but no echo event arrived, even after the long
    // QUEUED horizon: retire it. Abandoning the pending abandons its object
    // URLs with it — the same rule clearConfirmed and discard follow.
    const expireConfirmed = (key: string): void => {
      timers.delete(key);
      set((s) => {
        const p = s.pending.find((x) => x.key === key);
        if (!p || p.state !== 'sending') return {};
        revoke(p);
        return { pending: s.pending.filter((x) => x.key !== key) };
      });
    };

    // Api accepted the prompt and the echo has not arrived. STAGE ONE: say so
    // — mark the pending queued rather than deleting it (a busy session cannot
    // possibly echo inside `confirmTimeoutMs`) — then arm STAGE TWO, the long
    // retirement deadline above.
    const markQueued = (key: string): void => {
      set((s) => {
        const p = s.pending.find((x) => x.key === key);
        if (!p || p.state !== 'sending') return {};
        return { pending: s.pending.map((x) => (x.key === key ? { ...x, queued: true } : x)) };
      });
      if (get().pending.some((x) => x.key === key && x.state === 'sending')) {
        arm(key, queuedTimeoutMs, () => expireConfirmed(key));
      }
    };

    const dispatch = async (
      key: string,
      text: string,
      opts: { replaceDraft?: boolean; attachments?: string[] } = {},
    ): Promise<void> => {
      try {
        await apiImpl.prompt(id, text, opts);
        arm(key, confirmTimeoutMs, () => markQueued(key));
      } catch (e) {
        const { error, code, draft, submittable } = failureOf(e);
        set((s) => ({
          pending: s.pending.map((p) =>
            p.key === key ? { ...p, state: 'failed' as const, error, code, draft, submittable } : p,
          ),
        }));
      }
    };

    const nudge = (): void => socket?.nudge();

    /**
     * Tell the server whether this session is on the operator's screen, so it
     * can suppress notifications for it (`server/src/presence.ts`, read by the
     * watcher's `pushOne`). A notification for the pane you are looking at
     * teaches you to dismiss notifications.
     *
     * Best-effort by design: a frame that cannot be sent right now is dropped
     * rather than queued, because it is a claim about the present moment.
     * `onOpen` re-states the current truth on every connect.
     */
    const reportVisible = (visible = document.visibilityState === 'visible'): void => {
      socket?.send({ type: 'visible', visible });
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') nudge();
      reportVisible();
    };

    /**
     * The heartbeat behind that claim, and the reason the server can believe
     * it. A claim held for the socket's lifetime survives the socket's DEATH
     * whenever no close frame arrives — a phone in a lift or a tunnel sends no
     * FIN — and every notification for this session would then be suppressed
     * for a viewer who is long gone, indefinitely. So the server expires a
     * claim it has not heard for `PRESENCE_TTL_MS` and this re-states it every
     * `PRESENCE_REFRESH_MS` (three refreshes of slack, both defined together
     * in `shared/api.ts`).
     *
     * WHATEVER the visibility (D-5242's presence contract): the server also
     * keeps an OPEN claim per connection, re-stamped by every frame, and it is
     * what holds this session awake while the screen is open — so a hidden tab
     * repeats `visible:false` on the same beat, and an open claim that needs a
     * beat gets one. A hidden frame still deletes only the VISIBLE claim, so
     * notifications behave exactly as before.
     */
    const beat = (): void => {
      reportVisible();
    };

    return {
      events: [],
      offset: 0,
      uuid: null,
      status: null,
      statusUpdatedAt: null,
      dialog: null,
      ask: null,
      tasks: [],
      mail: [],
      missingFile: null,
      strandedAccount: null,
      searchComplete: true,
      fileMeasured: true,
      file: null,
      pending: [],
      conn: 'connecting',

      applyAnswered(answeredId, next) {
        set((s) => (s.dialog === null || s.dialog.id === answeredId ? { dialog: next } : {}));
      },

      apply(msg) {
        set((s) => {
          const confirmed = clearConfirmed(s.pending, msg);
          for (const key of confirmed.cleared) {
            const t = timers.get(key);
            if (t !== undefined) { clearTimeout(t); timers.delete(key); }
          }
          return {
            ...applySessionMsg(snapshotOf(s), msg),
            pending: confirmed.pending,
          };
        });
      },

      connect() {
        if (socket) return;
        socket = new ReconnectingSocket({
          // Recomputed on EVERY attempt (`ReconnectingSocket`), so an
          // automatic reconnect carries whatever the last frame left behind.
          //
          // `sinceFile` is not decoration: since §5.1's ladder one uuid can
          // resolve to several files, so `uuid:offset` alone is a byte count
          // with no file attached. Reproduced on this branch — backlog at
          // offset 6620 of a stranded copy, socket drops, a swap carries the
          // transcript to its exact address, and a uuid-only resume replays
          // byte 6620 of a DIFFERENT file: messages 41-80 of the carried copy
          // stitched onto 40 of the stranded one with the real 1-40 silently
          // absent. It self-heals only when the new file is smaller than the
          // stale offset; a growing conversation goes through silently.
          // `sessionws.ts`'s `start()` compares this echo against the file it
          // is about to tail and resends the backlog on a mismatch.
          //
          // Omitted, never sent empty, when there is no file yet (before the
          // first backlog, and between a `rotated` and its backlog): the
          // server falls back to the uuid-only resume, which at those two
          // moments is the correct answer rather than a compatibility shrug.
          // Both of them carry `offset: 0` — the store's initial state, and
          // `rotated`'s own reset — and that is exactly what the server now
          // requires of an echo-less resume, so a pre-fix build's non-zero
          // offset gets a backlog instead of being honoured against a file
          // nobody agreed on.
          url: () => {
            const { uuid, offset, file } = get();
            const base = wsUrl(`/ws/session/${encodeURIComponent(id)}`);
            if (uuid === null) return base;
            const since = `${base}?since=${encodeURIComponent(uuid)}:${offset}`;
            return file === null ? since : `${since}&sinceFile=${encodeURIComponent(file)}`;
          },
          onMessage: (m) => get().apply(m as SessionStreamMsg),
          onState: (conn) => set({ conn }),
          // Re-stated on EVERY open, automatic reconnects included: the
          // server's presence registry is keyed per connection, so a reconnect
          // starts with no claim at all and a session the operator is still
          // looking at would quietly start pushing notifications again.
          onOpen: () => reportVisible(),
          makeSocket: deps.makeSocket,
        });
        socket.start();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', nudge);
        heartbeat ??= setInterval(beat, PRESENCE_REFRESH_MS);
      },

      disconnect() {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', nudge);
        if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
        // Say so before the socket goes: leaving the session screen means the
        // operator is no longer looking at it, and a close alone would let the
        // server infer that only from the disconnect — true here, but not for
        // the automatic reconnects that share this code path's socket.
        reportVisible(false);
        socket?.stop();
        socket = null;
        // Fix round 1 (I1): a dropped connection must not leave a stale hook
        // ask sitting in the store forever. The server's own per-connection
        // sentinel (sessionws.ts's checkHookAsk) now guarantees an explicit
        // ask_cleared on every fresh connect when nothing is really pending,
        // but `ReconnectingSocket`'s automatic reconnects never call this
        // function — only an explicit teardown (leaving the session screen,
        // a swap/compact cycle) does. This is the belt to that fix's braces:
        // whatever the next connect delivers is authoritative, never a
        // leftover from before the drop. `dialog` is untouched — the scraped
        // channel has no analogous "was this fleet host still writing while
        // we were gone" gap, since the pane is re-scraped fresh every poll.
        //
        // `mail` gets the identical belt-and-braces (fix round 1, finding 3's
        // named residual): `sessionws.ts`'s own per-connection sentinel now
        // sends an explicit `{type:'mail', mail:[]}` on every fresh connect
        // when nothing is outstanding, the same discipline `checkHookAsk`
        // already had — but only while `deps.coord` exists on that server
        // process. A box that starts without a coordination database sends
        // no `mail` frame at all, ever, on any connection; clearing here
        // means an explicit teardown can never leave a stale list on screen
        // even in that corner, the same way `ask: null` covers `checkHookAsk`'s
        // corner.
        //
        // `status` joins them, and its own server-side half is `start()`'s
        // opening statement (`server/src/sessionws.ts`): that channel reports
        // CHANGE, against a seed the client cannot see, so a reading learned
        // in one connection used to still be on screen in the next one. This
        // store is kept per session id for the life of the tab
        // (`getSessionStore` below) and `status` is written by that frame and
        // nothing else, so nothing else could ever correct it. MEASURED
        // 2026-09-10: a lane swap took the pane away for 4.8s, the open screen
        // was told `dead`, the socket that would have corrected it on its next
        // poll was replaced rather than kept — and the operator read "Not
        // running — the chat is read-only" over a disabled composer while that
        // same view streamed the session's live transcript.
        //
        // `null` is not a guess about liveness — it is this store's own
        // initial state, and `SessionScreen`'s `status ?? live?.status` falls
        // through to the fleet snapshot exactly as it does before the first
        // frame of any connection. That is also why the server's cold start
        // is the primary fix and this is the belt: it covers the arms that
        // have nothing to state (a resolve that could not measure the
        // registry), where silence is the honest answer and a stale word
        // would be the lie.
        set({ ask: null, mail: [], status: null, statusUpdatedAt: null });
      },

      async send(text, opts = {}) {
        keySeq += 1;
        const key = `p${keySeq}`;
        set((s) => ({ pending: [...s.pending, {
          key, text, state: 'sending',
          replaceDraft: opts.replaceDraft, attachments: opts.attachments,
          // D-4952: the bar this message's echo has to clear, on the box's clock.
          sentAfter: newestTranscriptTs(s.events),
        }] }));
        await dispatch(key, text, { replaceDraft: opts.replaceDraft, attachments: pathsOf(opts) });
      },

      retry(key) {
        const p = get().pending.find((x) => x.key === key);
        if (!p || p.state !== 'failed') return;
        // Spread, never re-list: an object literal here is exactly why
        // `attachments` used to vanish on retry, and it would swallow every
        // field added after it too.
        set((s) => ({
          pending: s.pending.map((x) =>
            x.key === key ? { ...x, state: 'sending' as const, error: undefined, code: undefined, draft: undefined,
                              submittable: undefined, queued: undefined,
                              sentAfter: reSendBar(x, s.events) } : x),
        }));
        void dispatch(key, p.text, { replaceDraft: p.replaceDraft, attachments: pathsOf(p) });
      },

      /** Re-send a pending in place after a draft conflict — same record, so the
       *  attachments and their preview URLs survive. Replaces the old
       *  discard-then-send, which dropped both. */
      resolve(key, text, opts) {
        const p = get().pending.find((x) => x.key === key);
        if (!p) return;
        set((s) => ({
          pending: s.pending.map((x) =>
            x.key === key
              ? { ...x, text, state: 'sending' as const, error: undefined, code: undefined, draft: undefined,
                  submittable: undefined, queued: undefined, replaceDraft: opts.replaceDraft,
                  sentAfter: reSendBar(x, s.events) }
              : x),
        }));
        void dispatch(key, text, { replaceDraft: opts.replaceDraft, attachments: pathsOf(p) });
      },

      discard(key) {
        const t = timers.get(key);
        if (t !== undefined) {
          clearTimeout(t);
          timers.delete(key);
        }
        set((s) => {
          revoke(s.pending.find((x) => x.key === key));
          return { pending: s.pending.filter((x) => x.key !== key) };
        });
      },
    };
  });

  return store;
}

// One live store per session id — screens for the same session share state.
const stores = new Map<string, SessionStore>();

export function getSessionStore(id: string): SessionStore {
  let s = stores.get(id);
  if (!s) {
    s = createSessionStore(id);
    stores.set(id, s);
  }
  return s;
}
