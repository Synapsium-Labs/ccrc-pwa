import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import {
  isPrPhase, isStopSurface, type IdentityField, type LifecycleField, type PrPhase, type StopSurface,
} from '../../shared/api.js';

// `IdentityField` moved to shared/api.ts (Task 2): `FleetSession.unmeasured`
// carries the SAME evidence onto the wire, and a second, server-only
// definition here is exactly the drift `shared/api.ts`'s `UNCHECKED_PR`
// docstring spends thirty lines warning about. Re-exported (never imported
// from here today, but every OTHER type this file exports is) so a future
// consumer that wants "the type `SessionRecord.unmeasured` holds" finds it
// one hop from the field itself, rather than having to know it lives in
// `shared/` instead.
export type { IdentityField };

export interface SessionRecord {
  id: string; wrapper: string; project: string; workdir: string; uuid: string;
  started: boolean; home: string | null; pool: string[] | null; lastswap: number | null;
  workspace: string | null; branch: string | null;
  /** `origin/main` — what ws-add recorded as this branch's base (ccd:221).
   *  Never re-derived: a proof against a base the workspace was not cut from
   *  is a proof about a different question. */
  base: string | null;
  /** Written by `ccd pr-state`, read here. The server cannot write the
   *  registry — the agent's write whitelist is `.cc-clips` only — so the box
   *  that reads GitHub is the box that persists the answer. Persisted at all
   *  so a server restart degrades to HONEST STALE, never to silence. */
  prPhase: PrPhase | null;
  prNumber: number | null;
  prCheckedAt: number | null;    // epoch ms
  archivedAt: number | null;     // epoch seconds
  /** The worktree size ws-archive measured AT ARCHIVE TIME. Null when the
   *  manifest is absent or half-written — never 0, which would argue
   *  against a cleanup that would free gigabytes. */
  archivedBytes: number | null;
  /** The workspace's program claim — `$REG/<id>.hold`, reason string verbatim,
   *  null when absent. Absence IS release (the verb unlinks), so ONLY absence
   *  reads as unheld.
   *
   *  Fail-shut here too, and this layer can be (review finding 2): `field()`'s
   *  own `readFile` cannot tell a failed read from a missing file — remote
   *  `io.ts` maps every error to null — but `readRegistry` reads the registry
   *  DIRECTORY first, and that listing names `<id>.hold` whether or not its
   *  bytes can be fetched. A present-but-unread file therefore reads as held,
   *  carrying `HOLD_UNREADABLE` as its reason — after a second listing has
   *  confirmed the file is still there, so an ordinary `ws-release` landing in
   *  the gap between the two reads is not reported as corruption.
   *
   *  A readable but EMPTY file is held too (an empty string is not null), and
   *  it carries `HOLD_NO_REASON` rather than the empty string: the reason IS
   *  the display, and `held: ''` renders as nothing on every surface while
   *  every consumer still enforces it — a hold visible nowhere is exactly what
   *  the no-expiry design cannot afford. `ccd ws-hold` refuses to write one
   *  (whitespace included, since `field()` trims), so the only ways to reach
   *  it are `touch $REG/<id>.hold` and a truncated write. */
  held: string | null;
  /** Which of `uuid`/`wrapper`/`workdir` — the identity triple — could not be
   *  MEASURED this read: LISTED in the registry directory (so provably not
   *  absent — `names.includes(id + '.uuid')` is true by construction for
   *  every id `readRegistry`/`readSessionRecord` ever hands to `buildRecord`,
   *  the same "PRESENCE independently of whether the read succeeded"
   *  evidence `held`'s own ladder above already trusts) but the file's own
   *  bytes did not come back — one dropped agent-WS round trip, the ordinary
   *  shape in remote mode. Empty when every triple member read clean.
   *
   *  A degraded member's OWN field on this record (`.uuid`/`.wrapper`/
   *  `.workdir`) reads `''` — never `null`, so the type stays `string`
   *  everywhere this tree already assumes that — and `''` is a value NO REAL
   *  uuid/wrapper/workdir can ever equal, so a stray `rec.uuid === x`
   *  comparison can never be fooled by it. It is still a MEASUREMENT ERROR,
   *  not a fact about identity, which is exactly why this array — not the
   *  empty string — is the thing a caller must check: see `measuredIdentity`. */
  unmeasured: readonly IdentityField[];
  /** `$REG/<id>.stopped` — `<epoch> <surface>`, written by `_ws_unsupervise`
   *  (the single choke point every deliberate unsupervise reaches systemd
   *  through: `cmd_stop`, `ws-rm`, `ws-archive`, `ws-reap`, `forget`) and
   *  cleared by `_ws_supervise` and any successful spawn. Epoch SECONDS, as
   *  ccd writes it (`date +%s`, exactly like `archivedAt`); `fleet.ts` is the
   *  one place it becomes ms. A surface outside the closed set — a newer ccd,
   *  a hand-edited file — normalizes to `unknown` here, never leaks. */
  stopped: { at: number; surface: StopSurface } | null;
  /** `$REG/<id>.supervised` — epoch SECONDS, re-stamped by `cmd_supervise`
   *  every 30s and by `cmd_swap` while it carries files. Younger than
   *  `SUPERVISED_FRESH_MS` means a supervisor is watching RIGHT NOW, which is
   *  strictly more than an enable symlink promises (§4.2). The server cannot
   *  ask systemd anything — the agent's read whitelist covers `~/.cc-sessions`
   *  and not `~/.config/systemd` — so the supervisor publishes instead. */
  supervisedAt: number | null;
  /** `$REG/<id>.swapblocked` — `<epoch> <reason>`, the durable half of §2.4's
   *  refusal (M9: a notify banner with no socket open is gone). */
  swapBlocked: { at: number; reason: string } | null;
  /** `$REG/<id>.spawn` — `<epoch> <rc>`, written by `_spawn` ALWAYS, before
   *  returning (§3.1). Read here so the verdict a supervisor raised in its own
   *  process is a fact this side of the seam can see; no wire field carries it
   *  yet, which is what makes the PWA task purely additive. */
  spawn: { at: number; rc: number } | null;
  /** Which of `started`/`stopped`/`supervised` were LISTED but unreadable this
   *  pass — the same evidence rule `unmeasured` uses for the identity triple,
   *  over the three fields §4.3's classifier reads. Kept SEPARATE from
   *  `unmeasured` on purpose: that array is typed `IdentityField[]`, is carried
   *  onto the wire verbatim, and is validated against the identity triple by
   *  `reviveFleetSession` — widening it would reject every snapshot. The
   *  visible consequence of this one is `lifecycle: 'unmeasurable'`, which is
   *  the honest thing to show and the only thing a viewer can act on.
   *
   *  `.stopped` gets a WIDER net than `started`/`supervised`: it is pushed here
   *  not only when unreadable-but-listed (the shared evidence rule) but also
   *  when its bytes come back LISTED, READABLE and still fail to parse an
   *  epoch (`packedStamp` returns null). That second case is real: ccd's own
   *  `.stopped` write is `printf '%s %s' "$(date +%s)" "$surface" > file`
   *  (ccd/ccd:336) — non-atomic, so an interrupted write leaves a zero-byte or
   *  half-written file — and ccd's OWN reader (`_session_state`, ccd/ccd:377)
   *  tests only `[[ -e "$REG/$id.stopped" ]]`, never content, so bash answers
   *  `stopped` for exactly that on-disk state. `.supervised`'s bash reader
   *  (ccd/ccd:367) already guards content with `^[0-9]+$`, matching what
   *  `numOrNull` does below, so no such widening applies there. Collapsing a
   *  present-but-unparseable `.stopped` to `stopped: null` would let
   *  `sessionLifecycle`'s `dead + started -> orphan` rung fire about a row
   *  bash confidently calls stopped — rule (b)'s exact prohibition. */
  lifecycleUnmeasured: readonly LifecycleField[];
}

/**
 * The accessor an identity-sensitive consumer must go through to read
 * `uuid`/`wrapper`/`workdir` off a `SessionRecord` (orchestrator amendment to
 * the architecture doc's increment 1). Used at every REFUSE/SKIP-gated call
 * site this ladder added: `POST /api/mail`'s ingress and ack routes, dispatch
 * (both the identity-by-subtraction after-read and the wave N>=2 resume),
 * `verifyDone`, the stop route, and `sessionws.ts`'s per-connection resolve.
 *
 * NO SCANNER enforces this repo-wide, by deliberate choice, recorded as a
 * deviation from the "or a mechanically-scanned choke point" half of the
 * amendment: `uuid`/`wrapper`/`workdir` are common property names this repo
 * ALSO uses for unrelated shapes at the same identifiers a text scan cannot
 * tell apart from this one — a parsed transcript envelope's own `.uuid`
 * (`transcript/parse.ts`), a per-connection `Resolved`/similar local struct's
 * own `.uuid` (`sessionws.ts`), and raw HTTP request bodies' `.wrapper`/
 * `.workdir` (`server.ts`'s `POST /api/sessions`, `/swap`). A blind
 * `\.wrapper\b`-style scan false-positives on all of them; an allowlist wide
 * enough to silence those false positives would have to cover most of
 * `server/src` and stop meaning anything. `single-definition.test.ts`'s own
 * docstring names exactly this limitation ("catches the copy that looks like
 * the original... not unforgeable") — here the copy-that-looks-like-the-
 * original problem runs the other way, into false POSITIVES on unrelated
 * code, which is the failure mode that erodes trust in a scanner rather than
 * the one it exists to catch. The remaining `SessionRecord`-typed direct
 * reads of these three fields (`fleet.ts`'s display assembly and
 * `liveStatus`'s deliberately wrapper-only tolerance, `watch.ts`'s
 * hookstate/task display lanes, `lifecycle.ts`'s project listing,
 * `commands.ts`'s skill listing, `server.ts`'s PR-task listing) are all
 * DISPLAY/connectivity, degrade-and-heal by THE PRINCIPLE, and reviewed by
 * hand as part of this change rather than mechanically pinned.
 *
 * `null` the instant ANY of the three is unmeasured: a consumer that DOES
 * call this cannot reach a degraded field piecemeal (there is no OTHER path
 * through this function) and cannot forget to check, because the function
 * itself has no other way to answer.
 */
export function measuredIdentity(rec: SessionRecord): { uuid: string; wrapper: string; workdir: string } | null {
  return rec.unmeasured.length === 0 ? { uuid: rec.uuid, wrapper: rec.wrapper, workdir: rec.workdir } : null;
}

/**
 * The reason a held workspace carries when its `.hold` file is listed in the
 * registry directory but its contents could not be read — one failed op over
 * the agent WS is enough (`readRegistry` fires ~21 reads per session under one
 * request timeout). Held with an unreadable reason, never unheld: the
 * consumer is `archiveMerged`'s `held !== null` gate, and `ccd ws-archive` has
 * no held rung of its own, so a misread that read as released would kill a
 * live pane at a wave boundary.
 *
 * A human-readable sentence rather than a marker value because the reason
 * string IS the display — this text is what the PWA chip and the merged push
 * show, and it has to explain itself there with no parsing anywhere.
 */
export const HOLD_UNREADABLE = '<hold file unreadable — treated as held>';

/**
 * The reason a held workspace carries when its `.hold` file reads back EMPTY.
 * `ccd ws-hold` refuses to write one, but `touch $REG/<id>.hold` and a
 * truncated write both produce it, and `''` is not null — so every consumer
 * enforces the hold while every surface renders the reason as nothing at all:
 * a `Held — ` with a blank after it, a fleet chip with an empty tooltip, a
 * push reading `PR #591 merged — ; nothing archived.` The spec's stated price
 * for having no expiry is that an orphan hold is visible everywhere with a
 * reason saying why; this is the one hold that was visible nowhere, so it gets
 * a sentence of its own instead of an empty one.
 */
export const HOLD_NO_REASON = '<hold file is empty — no program named>';

/**
 * The reason a swap refusal carries when `$REG/<id>.swapblocked` records an
 * epoch and nothing after it. Same ruling as `HOLD_NO_REASON` and for the same
 * reason: §2.4's refusal is durable precisely so somebody who was not watching
 * finds out WHY, and `reason: ''` renders as a marker with an empty
 * explanation on every surface — visible enough to alarm, empty enough to
 * ignore.
 */
export const SWAP_BLOCKED_NO_REASON = '<swap refusal recorded no reason>';

async function field(io: FleetIO, dir: string, id: string, name: string): Promise<string | null> {
  const content = await io.readFile(path.join(dir, `${id}.${name}`));
  return content !== null ? content.trim() : null;
}

/** A registry field as a finite number, or null. `parseInt` alone yields NaN
 *  for a truncated write, and NaN on the wire renders as `null` in JSON while
 *  typing as `number` — a silent lie. */
function numOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/** `<epoch> <rest>` — the packed two-token stamp shape every D3 field uses.
 *  Epoch and payload share ONE registry file on purpose (§4.1): the registry is
 *  read per-field per-session on a 2s tick, and packing is what keeps `stopped`
 *  one read instead of two. A stamp whose epoch does not parse is NOT a stamp —
 *  an interrupted `_reg_set` leaves a zero-byte file, and `Number('')` is 0,
 *  which would date a live session's stop to 1970. */
function packedStamp(raw: string | null): { at: number; rest: string } | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  const sp = trimmed.indexOf(' ');
  const at = numOrNull(sp === -1 ? trimmed : trimmed.slice(0, sp));
  if (at === null) return null;
  return { at, rest: sp === -1 ? '' : trimmed.slice(sp + 1).trim() };
}

function manifestBytes(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    const n = typeof v === 'object' && v !== null ? (v as { worktreeBytes?: unknown }).worktreeBytes : null;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ── Observability (spec's OBSERVABILITY section) ───────────────────────────
//
// A degraded field must be LOUD without being a flood: a read-storm sweep
// (registry.ts's own module docstring: "~21 reads per session" — a 24-session
// fleet sees ~505 round trips PER `readRegistry` call) would otherwise log the
// same stuck field dozens of times a minute. `warnOnce` is keyed `id#field`,
// not just `field`, so one wrapper's degraded read never silences a
// DIFFERENT session's — and it is pruned per id no longer listed, so a
// reaped session's history does not live forever.

/** The escalation ceiling: 15 minutes, the fleet's existing "stuck" number
 *  (`watch.ts`'s `PR_SWEEP_STUCK_MS`/`MAIL_BACKOFF_MAX_MS`, both `900_000`) —
 *  not a new one. */
export const REGISTRY_UNMEASURED_STUCK_MS = 900_000;

/** How often the SAME `id#field` may re-log at `warn` while it stays
 *  degraded. Independent of the escalation ceiling above: this bounds noise,
 *  that bounds how long "transient" is allowed to mean before it is a lie. */
const WARN_COOLDOWN_MS = 60_000;

interface WarnState { firstAt: number; lastAt: number; escalated: boolean }

/** `id#field#{degraded|dropped}` -> state. Module-level: this is process-wide
 *  observability, the same reason `FleetWatcher`'s `mailInFlight`/
 *  `mailCooldown` live on the watcher instance rather than being threaded
 *  through every call — there is no per-request scope a registry read could
 *  hang this off instead. */
const warnState = new Map<string, WarnState>();

/** Drops every entry whose id is no longer in the CURRENT listing — a session
 *  that is genuinely gone must not keep its degraded history (and its
 *  cooldown/escalation clock) alive in this map forever. Called once per
 *  whole-fleet read, keyed off the SAME listing the read itself just took. */
function pruneWarnState(listedIds: ReadonlySet<string>): void {
  for (const key of warnState.keys()) {
    const id = key.slice(0, key.indexOf('#'));
    if (!listedIds.has(id)) warnState.delete(key);
  }
}

/** One line at first sight, silence for `WARN_COOLDOWN_MS`, then a repeat —
 *  and, for `escalates` keys only, exactly one `console.error` once the SAME
 *  key has stood degraded for `REGISTRY_UNMEASURED_STUCK_MS`. A drop
 *  (`escalates: false`) never escalates: it is not an ongoing condition to
 *  get MORE alarming about, it is a permanent fault already logged once. */
function noteIssue(key: string, now: number, message: string, escalates: boolean): void {
  const prior = warnState.get(key);
  if (prior === undefined) {
    warnState.set(key, { firstAt: now, lastAt: now, escalated: false });
    console.warn(`ccrc-server: ${message}`);
    return;
  }
  if (escalates && !prior.escalated && now - prior.firstAt >= REGISTRY_UNMEASURED_STUCK_MS) {
    prior.escalated = true;
    prior.lastAt = now;
    console.error(`ccrc-server: ${message} — stuck unmeasured for over ` +
      `${Math.floor(REGISTRY_UNMEASURED_STUCK_MS / 60_000)} minutes`);
    return;
  }
  if (now - prior.lastAt >= WARN_COOLDOWN_MS) {
    prior.lastAt = now;
    console.warn(`ccrc-server: ${message}`);
  }
}

/** The whole-fleet collapse (`io.readdir` -> null): logged on ENTRY and EXIT
 *  of the episode, never per tick — a box that stays unlistable for an hour
 *  gets two log lines, not eighteen hundred. Module-level for the same reason
 *  `warnState` is: every caller (`readRegistryMeasured`, `readSessionRecord`)
 *  shares the one registry directory, so whichever caller happens to notice
 *  the transition first is the one that logs it. */
let wholeFleetUnlistableSince: number | null = null;

function noteWholeFleetListing(listable: boolean, now: number): void {
  if (!listable) {
    if (wholeFleetUnlistableSince === null) {
      wholeFleetUnlistableSince = now;
      console.error('ccrc-server: registry directory could not be listed — every session read ' +
        'degrades to unmeasured until this clears');
    }
    return;
  }
  if (wholeFleetUnlistableSince !== null) {
    console.warn(`ccrc-server: registry directory listable again after ${now - wholeFleetUnlistableSince}ms unlistable`);
    wholeFleetUnlistableSince = null;
  }
}

/**
 * One session's 17-field read plus the `SessionRecord` it builds — the ONE
 * parser, shared by `readRegistry`'s whole-fleet sweep and
 * `readSessionRecord`'s single-id read below (C0.3), so there is no second
 * copy of this shape to drift out of sync with the first. `names` is the
 * caller's directory listing, passed in rather than re-read here, for the
 * same "PRESENCE independently of whether the read succeeded" reason the
 * `held` field below already relies on.
 *
 * Returns null for a DROPPED registry entry — narrowed (architecture doc,
 * increment 1's second half) from the old "missing wrapper/workdir/uuid"
 * blanket rule to exactly two evidenced cases, both now LOGGED rather than
 * silent: a triple member that is neither readable NOR listed at all (the
 * file genuinely does not exist — a session mid-write or mid-teardown), or
 * one that reads back MEASURED-EMPTY (a truncated write — a permanent fault,
 * not a read failure). A triple member that is null but LISTED degrades the
 * row instead of dropping it — see `SessionRecord.unmeasured`.
 */
async function buildRecord(
  io: FleetIO, cfg: CcrcConfig, names: string[], id: string, now: number,
): Promise<SessionRecord | null> {
  const [wrapper, project, workdir, uuid, started, home, pool, lastswap, workspace, branch,
    base, prPhaseRaw, prNumberRaw, prCheckedAtRaw, archivedRaw, manifestRaw, holdRaw,
    stoppedRaw, supervisedRaw, swapBlockedRaw, spawnRaw] = await Promise.all([
    field(io, cfg.registryDir, id, 'wrapper'), field(io, cfg.registryDir, id, 'project'),
    field(io, cfg.registryDir, id, 'workdir'), field(io, cfg.registryDir, id, 'uuid'),
    field(io, cfg.registryDir, id, 'started'), field(io, cfg.registryDir, id, 'home'),
    field(io, cfg.registryDir, id, 'pool'), field(io, cfg.registryDir, id, 'lastswap'),
    field(io, cfg.registryDir, id, 'workspace'), field(io, cfg.registryDir, id, 'branch'),
    field(io, cfg.registryDir, id, 'base'), field(io, cfg.registryDir, id, 'prphase'),
    field(io, cfg.registryDir, id, 'prnumber'), field(io, cfg.registryDir, id, 'prcheckedat'),
    field(io, cfg.registryDir, id, 'archived'), field(io, cfg.registryDir, id, 'archivemanifest'),
    field(io, cfg.registryDir, id, 'hold'),
    field(io, cfg.registryDir, id, 'stopped'), field(io, cfg.registryDir, id, 'supervised'),
    field(io, cfg.registryDir, id, 'swapblocked'), field(io, cfg.registryDir, id, 'spawn'),
  ]);

  // The identity-triple ladder. `uuid` first: `names.includes(id + '.uuid')`
  // is TRUE BY CONSTRUCTION for every id this function is ever called with —
  // both callers below derive/confirm `id` from that exact listing — so a
  // null `uuid` read can only mean "listed but unreadable", never "absent".
  // `wrapper`/`workdir` carry no such guarantee: either can genuinely be
  // absent from the listing (a half-written or half-torn-down entry).
  const unmeasured: IdentityField[] = [];
  const measured: { uuid: string; wrapper: string; workdir: string } = { uuid: '', wrapper: '', workdir: '' };
  for (const f of ['uuid', 'wrapper', 'workdir'] as const) {
    const raw = f === 'uuid' ? uuid : f === 'wrapper' ? wrapper : workdir;
    if (raw !== null && raw !== '') { measured[f] = raw; continue; }
    if (raw === null && names.includes(`${id}.${f}`)) {
      unmeasured.push(f);
      noteIssue(`${id}#${f}#degraded`, now,
        `registry ${id}.${f} is listed but unreadable — ${f} is unmeasured, not absent`, true);
      continue;
    }
    noteIssue(`${id}#${f}#dropped`, now,
      `registry entry ${id} dropped — ${f} ${raw === null ? 'is not present in the registry directory' : 'read back empty'}`,
      false);
    return null;   // narrowed drop, logged — see this function's own docstring
  }

  const holdListed = names.includes(`${id}.hold`);

  // §4.3's three-valued read, over the three fields the lifecycle classifier
  // consumes. Same evidence as the identity ladder above: `names` is the
  // listing this function opened with, so it proves PRESENCE independently of
  // whether the bytes came back — the one thing `field()` alone cannot tell
  // you. Without it a stop that WAS recorded but could not be read looks like
  // no stop at all, and the classifier prints `orphan` about a session nobody
  // managed to look at. That is rule (b)'s exact prohibition, and it is why the
  // discrimination lives here rather than in the pure function.
  const stopStamp = packedStamp(stoppedRaw);
  const swapStamp = packedStamp(swapBlockedRaw);
  const spawnStamp = packedStamp(spawnRaw);
  const spawnRc = spawnStamp === null ? null : numOrNull(spawnStamp.rest);

  const lifecycleUnmeasured: LifecycleField[] = [];
  for (const [f, raw] of [
    ['started', started], ['supervised', supervisedRaw],
  ] as const) {
    if (raw === null && names.includes(`${id}.${f}`)) lifecycleUnmeasured.push(f);
  }
  // `.stopped` gets the wider net `SessionRecord.lifecycleUnmeasured`'s own
  // docstring explains: unreadable-but-listed (the shared rule above) OR
  // listed-and-readable-but-unparseable (`stopStamp === null` while
  // `stoppedRaw` itself is non-null) — the proven bash/TS divergence a
  // zero-byte or torn `.stopped` produces.
  if (stopStamp === null && (stoppedRaw !== null || names.includes(`${id}.stopped`))) {
    lifecycleUnmeasured.push('stopped');
  }

  return {
    id, wrapper: measured.wrapper, project: project ?? id, workdir: measured.workdir, uuid: measured.uuid,
    started: started === '1',
    home, pool: pool ? pool.split(/\s+/).filter(Boolean) : null,
    lastswap: lastswap ? parseInt(lastswap, 10) : null,
    workspace, branch,
    base,
    // A phase this build does not know degrades to null (= unchecked), never
    // to a raw string the PWA would switch on and render as nothing.
    // `isPrPhase`, not `PR_PHASES.includes(x as PrPhase)`: the old form cast
    // the untrusted value twice, asserting the very thing the check asks
    // (final review, integration 3). The predicate also rejects a non-string
    // outright, so a half-written registry entry cannot reach `.includes`
    // wearing a `PrPhase` annotation.
    prPhase: isPrPhase(prPhaseRaw) ? prPhaseRaw : null,
    prNumber: numOrNull(prNumberRaw),
    prCheckedAt: numOrNull(prCheckedAtRaw),
    archivedAt: numOrNull(archivedRaw),
    /** The worktree size ws-archive measured AT ARCHIVE TIME. Null when the
     *  manifest is absent or half-written — never 0, which would argue
     *  against a cleanup that would free gigabytes. */
    archivedBytes: manifestBytes(manifestRaw),
    // `names` is the directory listing this function opened with, so it
    // proves PRESENCE independently of whether the read succeeded — the one
    // piece of evidence `field()` alone does not have. See `HOLD_UNREADABLE`.
    // An empty read is a hold with nothing to show, which is not the same
    // fact as an unreadable one — see `HOLD_NO_REASON`.
    held: holdRaw === null
      ? (holdListed ? HOLD_UNREADABLE : null)
      : (holdRaw === '' ? HOLD_NO_REASON : holdRaw),
    // The surface is validated on READ as well as on write. The write-side
    // check is `_ws_unsupervise`'s own `case "$surface" in cli|pwa|agent|ccd)
    // ;; *) surface=unknown ;;` — NOT `cmd_stop`, which this comment used to
    // name (final review, Minor #6): `cmd_stop` only parses the flag
    // (`surface="$2"`) and hands the word on unchecked, so every other caller
    // of `_ws_unsupervise` is covered by the same single check rather than by
    // the verb. Both sides, not either: this box runs a ccd
    // that is routinely a deploy ahead of or behind the server, so a word from
    // a vocabulary this build does not have is the ordinary case, not the
    // exotic one. `unknown` is a real member, so there is somewhere honest to
    // put it — and the epoch, which is the part the ladder reads, survives.
    stopped: stopStamp === null
      ? null
      : { at: stopStamp.at, surface: isStopSurface(stopStamp.rest) ? stopStamp.rest : 'unknown' },
    supervisedAt: numOrNull(supervisedRaw),
    swapBlocked: swapStamp === null
      ? null
      : { at: swapStamp.at, reason: swapStamp.rest === '' ? SWAP_BLOCKED_NO_REASON : swapStamp.rest },
    // An rc that does not parse is not a verdict. `_spawn` writes the stamp
    // ALWAYS, before returning, so a half-written one means a torn write, not
    // an ambiguous outcome — and `rc: NaN` on the wire renders as `null` while
    // typing as `number`, the silent lie `numOrNull` exists to refuse.
    spawn: spawnStamp === null || spawnRc === null ? null : { at: spawnStamp.at, rc: spawnRc },
    lifecycleUnmeasured,
    unmeasured,
  };
}

/** The whole-fleet read, typed (architecture doc, increment 1's second half):
 *  `listed: false` is the `io.readdir` collapse itself — the LARGER cousin of
 *  a single unmeasured field, and now distinguishable from "the registry
 *  genuinely lists nobody" the same way a degraded row is now distinguishable
 *  from an absent one. `readRegistry` below is the old, narrower signature
 *  ([] on unlistable) kept for pure-display call sites that have no refusal
 *  to make either way.
 *
 *  `names` (Build 4, D-B4-10) is the RAW listing this read derived its records
 *  from, carried rather than re-read. It exists for the one caller that needs a
 *  NON-session fact out of the same directory — `watch.ts`'s `emitCoord`, which
 *  reports `$REG/coordinator-paused` and `$REG/mail-disabled` to the wire. A
 *  second `readdir` for that would be a second clock for one fact, and the two
 *  would disagree on exactly the ticks that matter. It is the FIRST listing,
 *  deliberately: the re-listing below exists to resolve a per-row reap race,
 *  runs on some calls only, and hanging the markers' cadence on it would make
 *  the banner's clock depend on whether an unrelated session was mid-reap. */
export type RegistryRead =
  | { listed: true; records: SessionRecord[]; names: readonly string[] }
  | { listed: false };

export async function readRegistryMeasured(io: FleetIO, cfg: CcrcConfig): Promise<RegistryRead> {
  const now = Date.now();
  const names = await io.readdir(cfg.registryDir);
  noteWholeFleetListing(names !== null, now);
  if (names === null) return { listed: false };
  const ids = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  pruneWarnState(new Set(ids));
  const out: SessionRecord[] = [];
  /** Ids whose `.hold` was in `names` but whose bytes came back null. Resolved
   *  after the loop by ONE second listing — see below. */
  const holdUnconfirmed = new Set<string>();
  /** Ids with an unmeasured identity-triple member. Resolved by the SAME
   *  second listing: proof the row was reaped mid-read (architecture doc,
   *  "twice-observed absence… retires a row within the same call"), not a
   *  second, independent probe. */
  const identityUnconfirmed = new Set<string>();
  for (const id of ids) {
    const rec = await buildRecord(io, cfg, names, id, now);
    if (rec === null) continue;
    if (rec.held === HOLD_UNREADABLE) holdUnconfirmed.add(id);
    if (rec.unmeasured.length > 0) identityUnconfirmed.add(id);
    out.push(rec);
  }
  // ONE SECOND LISTING, and only when something needs it. `names` was taken
  // before ~21 field reads per session; a `ccd ws-release` that lands anywhere
  // inside that window leaves the name in the listing and no bytes behind it,
  // which the evidence above cannot tell apart from a read that failed — so a
  // perfectly ordinary release was reported as `HOLD_UNREADABLE`, the
  // registry-is-broken sentence, and `archiveMerged` fired a held-merged push
  // announcing corruption seconds after the operator tapped Release.
  //
  // Re-listing distinguishes them, because a directory read is exactly the
  // evidence `field()` lacks: gone from the second listing = deleted on
  // purpose (absence IS release, and — for a degraded row — it is now
  // TWICE-observed absence, not an absent read: the row is RETIRED, dropped
  // from `out`, rather than kept degraded forever). Still listed = genuinely
  // unreadable (or genuinely still held), and it keeps its degraded/held
  // shape. A second listing that FAILS proves nothing and changes nothing:
  // fail-shut stands — the BOUND on masking a real reap is evidence, not
  // time, and a failed listing is not evidence.
  if (holdUnconfirmed.size > 0 || identityUnconfirmed.size > 0) {
    const again = await io.readdir(cfg.registryDir);
    if (again !== null) {
      const retired = new Set<string>();
      for (const rec of out) {
        if (holdUnconfirmed.has(rec.id) && !again.includes(`${rec.id}.hold`)) rec.held = null;
        if (identityUnconfirmed.has(rec.id) && !again.includes(`${rec.id}.uuid`)) retired.add(rec.id);
      }
      // `names`, not `again`: the FIRST listing is the one every caller shares
      // (D-B4-10). `again` answers a different question, on some calls only.
      if (retired.size > 0) return { listed: true, records: out.filter((r) => !retired.has(r.id)), names };
    }
  }
  return { listed: true, records: out, names };
}

export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {
  const r = await readRegistryMeasured(io, cfg);
  return r.listed ? r.records : [];
}

/** `readSessionRecord`'s widened result (architecture doc, increment 1's
 *  second half): the same three-way split `RegistryRead` draws for the
 *  whole fleet, narrowed to one id. `found: true` may still carry a
 *  `record.unmeasured` — a caller that needs identity, not just presence,
 *  reaches it through `measuredIdentity`, never through this shape alone. */
export type SingleRead =
  | { found: true; record: SessionRecord }
  | { found: false; reason: 'absent' }
  | { found: false; reason: 'unlistable' };

/**
 * `readRegistry`, narrowed to ONE session (C0.3). One `readdir` plus that
 * id's 21 field reads — ~22 agent-WS round trips in remote mode, instead of
 * `readRegistry`'s 24-generation sweep of the whole fleet (~505 round trips
 * on a 24-session fleet) — for every caller that only ever asked "what does
 * the registry say about THIS session" and never needed uniqueness or a
 * subtraction over the rest of the fleet. Built from the SAME `buildRecord`
 * loop body `readRegistry` uses, so there remains exactly one parser.
 *
 * `reason: 'absent'` covers both of `readRegistry`'s old ways to answer
 * `undefined` for one id — no `.uuid` in the listing at all, and a dropped
 * (narrowed, see `buildRecord`'s own docstring) entry — collapsed into one
 * shape at the source instead of two. `reason: 'unlistable'` is the SEPARATE
 * whole-directory collapse, never conflated with a proven absence.
 *
 * Carries the SAME hold-reconfirm discipline as `readRegistry` (see
 * `readRegistryMeasured`'s "ONE SECOND LISTING" comment): a hold that reads
 * `HOLD_UNREADABLE`, OR a record with an unmeasured identity field, gets ONE
 * follow-up listing, because a `ws-release`/full reap landing inside this
 * call's own field-read window is indistinguishable from a failed read at
 * `field()` alone, exactly as for the whole-fleet sweep. Twice-observed
 * absence there retires the record to `{found:false, reason:'absent'}`,
 * never a silent degrade-forever.
 */
export async function readSessionRecord(io: FleetIO, cfg: CcrcConfig, id: string): Promise<SingleRead> {
  const now = Date.now();
  const names = await io.readdir(cfg.registryDir);
  noteWholeFleetListing(names !== null, now);
  if (names === null) return { found: false, reason: 'unlistable' };
  if (!names.includes(`${id}.uuid`)) return { found: false, reason: 'absent' };   // no field reads worth making
  const rec = await buildRecord(io, cfg, names, id, now);
  if (rec === null) return { found: false, reason: 'absent' };
  if (rec.held === HOLD_UNREADABLE || rec.unmeasured.length > 0) {
    const again = await io.readdir(cfg.registryDir);
    if (again !== null) {
      if (rec.held === HOLD_UNREADABLE && !again.includes(`${id}.hold`)) rec.held = null;
      if (rec.unmeasured.length > 0 && !again.includes(`${id}.uuid`)) return { found: false, reason: 'absent' };
    }
  }
  return { found: true, record: rec };
}
