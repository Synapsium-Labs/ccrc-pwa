import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO, MeasuredRead, ReadFailure } from './io.js';
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

/** Why `SessionRecord.branch` reads the way it does — see the field's own
 *  docstring for what each member means and what a consumer owes it.
 *  Derives the two read-failure members from `io.ts`'s `ReadFailure` rather
 *  than restating that pair a second time — `single-definition.test.ts`'s
 *  "one absent/unreadable read vocabulary" pins it. */
export type BranchEvidence = 'named' | ReadFailure | 'empty';

export interface SessionRecord {
  id: string; wrapper: string; project: string; workdir: string; uuid: string;
  started: boolean; home: string | null; pool: string[] | null; lastswap: number | null;
  workspace: string | null; branch: string | null;
  /** WHY `branch` above reads the way it does — one field, four conditions,
   *  and `branch === null` exactly when this is not `'named'`.
   *
   *  It was `branchUnmeasured: boolean` for three commits of Wave 3 and that
   *  was one condition short (review finding): `field()` returns
   *  `content.trim()`, so a zero-byte or torn `.branch` comes back as `''`,
   *  which is neither of a boolean's two answers. It read as `branch: ''` with
   *  the flag false — a MEASURED BRANCH NAMED NOTHING — and `''` then went on
   *  to be used as a branch name by three consumers (see `buildRecord`).
   *
   *    `'named'`      — `branch` is a string. Nothing to say.
   *    `'absent'`     — no `<id>.branch` file at all. The ORDINARY state of a
   *                     project's main checkout, not an error.
   *    `'unreadable'` — the file is LISTED in the registry directory this read
   *                     opened with, and its bytes did not come back.
   *                     TRANSIENT — one dropped agent-WS round trip among the
   *                     ~22 a session's read fires — so it asks to be retried.
   *                     `field()` cannot see this on its own (`io.readFile`
   *                     maps a failed read and a missing file to the same
   *                     null); the directory listing is the evidence, the same
   *                     rule the identity triple and `held` already use.
   *    `'empty'`      — the file is there, its bytes came back, and there are
   *                     none (or only whitespace). NOT transient: re-reading
   *                     returns the same nothing. NOT absent either: something
   *                     wrote, or half-wrote, this field. `ccd`'s `_reg_set` is
   *                     `printf '%s' "$3" > "$REG/$1.$2"` — a truncating
   *                     redirect with no tmp+rename — so a process killed
   *                     between the truncate and the write leaves exactly this,
   *                     and `touch $REG/<id>.branch` is the other way in.
   *                     Its own value, not folded into a neighbour, for the
   *                     reason `HOLD_NO_REASON` above exists: the refusal
   *                     sentence a coordinator reads has to be true, and one
   *                     sentence covering a crashed write and a main checkout
   *                     would be a lie about one of them.
   *
   *  Deliberately NOT a `LifecycleField` and deliberately NOT a member of
   *  `unmeasured`. `LifecycleField` feeds `sessionLifecycle`'s `unmeasurable`
   *  rung, and a branch nobody could read says nothing about whether a
   *  session is running; `unmeasured` is `IdentityField[]`, rides the wire
   *  verbatim, and is validated against the identity triple by
   *  `reviveFleetSession` — widening it would reject every persisted
   *  snapshot. This field is server-side only and reaches no wire field. */
  branchEvidence: BranchEvidence;
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
   *  Fail-shut here too, and this layer can be (review finding 2). A
   *  MEASURED read (`io.readFileMeasured`, Task 5) tells a proven ENOENT
   *  apart from everything else: a measured `absent` `.hold` reads `null`
   *  DIRECTLY — D-112 — because absence proven at the read IS the strongest
   *  form of "the verb unlinked this", strictly better evidence than a
   *  listing that did not come back. A measured `unreadable` (or an older
   *  agent's read, which cannot tell the two apart at all) falls back to
   *  today's rung: `readRegistry` reads the registry DIRECTORY first, and
   *  that listing names `<id>.hold` whether or not its bytes can be
   *  fetched. A present-but-unread file therefore reads as held, carrying
   *  `HOLD_UNREADABLE` as its reason — after a second listing has confirmed
   *  the file is still there, so an ordinary `ws-release` landing in the gap
   *  between the two reads is not reported as corruption.
   *
   *  A readable but EMPTY file is held too (an empty string is not null), and
   *  it carries `HOLD_NO_REASON` rather than the empty string: the reason IS
   *  the display, and `held: ''` renders as nothing on every surface while
   *  every consumer still enforces it — a hold visible nowhere is exactly what
   *  the no-expiry design cannot afford. `ccd ws-hold` refuses to write one
   *  (whitespace included, since `field()` trims), so the only ways to reach
   *  it are `touch $REG/<id>.hold` and a truncated write. */
  held: string | null;
  /** `$REG/<id>.substrate` — a supervisor's own "I could not reach tmux"
   *  record (D-B8-14, spec §2): `<epoch-seconds> <verbatim reason>`, written
   *  by `_substrate_mark` on every unknown probe tick, removed by
   *  `_substrate_clear` on the first live one. Epoch SECONDS, registry-native
   *  like `stopped`/`supervisedAt` — `fleet.ts` is the one place it becomes
   *  ms. Null ONLY on absence: the `.hold` listed-vs-readable ladder above
   *  applies verbatim, because "no fault recorded" re-enables every
   *  destructive affordance downstream while "the marker would not read" must
   *  not — opposite answers a caller handles differently, never collapsed.
   *  D-113: a MEASURED absent read (a proven ENOENT, `io.readFileMeasured`)
   *  is null directly, with no second-listing reconfirm of its own — closing
   *  a live false alarm `.hold`'s second listing exists to catch for that
   *  field but `.substrate` never had one for: `_substrate_clear` removes
   *  the marker on the first live probe, a routine event, so a marker listed
   *  at the top of a read and cleared before its own field read used to
   *  report `SUBSTRATE_UNREADABLE` on an ordinary recovery. An
   *  unreadable-but-listed marker carries `SUBSTRATE_UNREADABLE`; a readable
   *  but empty one (a torn write — ccd's writer synthesizes a reason rather
   *  than write nothing) carries `SUBSTRATE_NO_REASON`; a stampless text keeps
   *  its whole content as `text`. All three degraded shapes sit at `at: 0`,
   *  which downstream renders text-only rather than as 1970. `text` is never
   *  `''`. */
  substrate: { at: number; text: string } | null;
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
   *  bash confidently calls stopped — rule (b)'s exact prohibition.
   *
   *  Task 5: a MEASURED `absent` read never pushes a field here — it is the
   *  ordinary "no stamp was ever written" answer, a positive result rather
   *  than a fault — including for `.stopped`, whose wide net only fires on
   *  proven, unparseable CONTENT; there is nothing to fail to parse when the
   *  file is proven not to exist. Only a measured `unreadable` still falls
   *  back to the listed-vs-not rung above. */
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
 * the agent WS is enough (`readRegistry` fires ~22 reads per session under one
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

/**
 * The reason a substrate fault carries when `$REG/<id>.substrate` is listed in
 * the registry directory but its bytes could not be read — `HOLD_UNREADABLE`'s
 * ruling applied to the marker, with the same polarity stakes: the consumers
 * are the PWA's destructive-affordance gates, and a misread that read as "no
 * fault recorded" would re-enable Restart/Reap against a session nobody can
 * see (D-B8-14, spec §2). Fail-shut, never null.
 */
export const SUBSTRATE_UNREADABLE = '<substrate marker unreadable>';

/**
 * The reason a substrate fault carries when the marker reads back EMPTY.
 * `_substrate_mark` refuses to write one — an empty `PROBE_DETAIL` gets a
 * synthesized text — so the only way in is a torn write. Same ruling as
 * `HOLD_NO_REASON` and for the same reason: the reason string IS the display,
 * and a fault chip with nothing in its tooltip is visible enough to alarm and
 * empty enough to ignore.
 */
export const SUBSTRATE_NO_REASON = '<substrate marker empty — reason lost>';

async function field(io: FleetIO, dir: string, id: string, name: string): Promise<string | null> {
  const content = await io.readFile(path.join(dir, `${id}.${name}`));
  return content !== null ? content.trim() : null;
}

/**
 * `field()`'s measured twin (Task 5): reads through `io.readFileMeasured`
 * instead of `io.readFile`, so a caller gets `absent`/`unreadable` apart
 * rather than collapsed to one `null`. `field()` itself is UNCHANGED and
 * keeps calling `io.readFile` — it stays the reader for every registry field
 * that has not migrated to the measured ladder (see the per-site ruling in
 * the plan; `field()` still backs `project`/`home`/`pool`/`lastswap`/
 * `workspace`/`base`/`prphase`/`prnumber`/`prcheckedat`/`archived`/
 * `archivemanifest`/`swapblocked`/`spawn`).
 *
 * Trims INSIDE the `ok` arm, deliberately, so `r.content` on a hit is
 * ALREADY what `field()`'s callers have always received: `field()`'s own
 * `.trim()` is load-bearing for `branchEvidence`'s `'empty'` rung (a
 * zero-byte or torn `.branch` must read as `''`, not as whitespace) and for
 * `HOLD_NO_REASON`/`SUBSTRATE_NO_REASON` (an all-whitespace `.hold`/
 * `.substrate` must collapse to the same empty-content branch a zero-byte
 * one does). Trimming here, once, is also the one-parser reason `field()`
 * itself trims rather than leaving it to each of the ladder's ~9 call
 * sites to remember. A `reason` (`absent`/`unreadable`) carries no content
 * to trim and passes through unchanged.
 */
async function fieldMeasured(io: FleetIO, dir: string, id: string, name: string): Promise<MeasuredRead> {
  const r = await io.readFileMeasured(path.join(dir, `${id}.${name}`));
  return r.ok ? { ok: true, content: r.content.trim() } : r;
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
// (registry.ts's own module docstring: "~22 reads per session" — a 24-session
// fleet sees ~529 round trips PER `readRegistry` call) would otherwise log the
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
 * One session's 22-field read plus the `SessionRecord` it builds — the ONE
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
  const [wrapperRead, project, workdirRead, uuidRead, startedRead, home, pool, lastswap, workspace, branchRead,
    base, prPhaseRaw, prNumberRaw, prCheckedAtRaw, archivedRaw, manifestRaw, holdRead,
    stoppedRead, supervisedRead, swapBlockedRaw, spawnRaw, substrateRead] = await Promise.all([
    fieldMeasured(io, cfg.registryDir, id, 'wrapper'), field(io, cfg.registryDir, id, 'project'),
    fieldMeasured(io, cfg.registryDir, id, 'workdir'), fieldMeasured(io, cfg.registryDir, id, 'uuid'),
    fieldMeasured(io, cfg.registryDir, id, 'started'), field(io, cfg.registryDir, id, 'home'),
    field(io, cfg.registryDir, id, 'pool'), field(io, cfg.registryDir, id, 'lastswap'),
    field(io, cfg.registryDir, id, 'workspace'), fieldMeasured(io, cfg.registryDir, id, 'branch'),
    field(io, cfg.registryDir, id, 'base'), field(io, cfg.registryDir, id, 'prphase'),
    field(io, cfg.registryDir, id, 'prnumber'), field(io, cfg.registryDir, id, 'prcheckedat'),
    field(io, cfg.registryDir, id, 'archived'), field(io, cfg.registryDir, id, 'archivemanifest'),
    fieldMeasured(io, cfg.registryDir, id, 'hold'),
    fieldMeasured(io, cfg.registryDir, id, 'stopped'), fieldMeasured(io, cfg.registryDir, id, 'supervised'),
    field(io, cfg.registryDir, id, 'swapblocked'), field(io, cfg.registryDir, id, 'spawn'),
    fieldMeasured(io, cfg.registryDir, id, 'substrate'),
  ]);

  // The identity-triple ladder. `uuid` first: `names.includes(id + '.uuid')`
  // is TRUE BY CONSTRUCTION for every id this function is ever called with —
  // both callers below derive/confirm `id` from that exact listing — so a
  // MEASURED-UNREADABLE `uuid` read can only mean "listed but unreadable",
  // never "absent" (the `unreadable` arm below still relies on this: for
  // `uuid` specifically, `names.includes(...)` is always true, so it always
  // takes the `unmeasured` branch, never the final drop). A MEASURED-ABSENT
  // `uuid` read is the one case that guarantee does NOT cover — the race
  // window between the listing this function opened with and this field's
  // own read (a reap landing in that gap) — and Task 5 lets that be proven
  // directly instead of merely inferred: see below. `wrapper`/`workdir`
  // carry no by-construction guarantee at all: either can genuinely be
  // absent from the listing (a half-written or half-torn-down entry).
  //
  // THE GOVERNING RULE: a measured `absent` drops the row IMMEDIATELY —
  // the same end state `readRegistryMeasured`'s second-listing reconfirm
  // reaches for the OLD collapsed-evidence case (raced-absent used to read
  // as `unmeasured` first, then get retired once the second listing also
  // failed to find it), just proven at THIS read instead of inferred two
  // listings later. That equivalence holds only when the second listing both
  // SUCCEEDS and AGREES (no longer names `<id>.uuid`): a second `readdir`
  // that FAILS, or one that still names it, is exactly where the OLD code
  // KEPT the row degraded rather than dropping it — this code drops it on
  // the proven read alone regardless, in strictly more cases than the old
  // ladder retired. The direction is fail-safe (a proven ENOENT outranks an
  // unconfirmed or failed listing) and is not what this comment changes;
  // only the "same end state" claim above is corrected to say so. A
  // measured `unreadable` falls back to exactly today's `names.includes(...)`
  // rung.
  const unmeasured: IdentityField[] = [];
  const measured: { uuid: string; wrapper: string; workdir: string } = { uuid: '', wrapper: '', workdir: '' };
  for (const [f, read] of [
    ['uuid', uuidRead], ['wrapper', wrapperRead], ['workdir', workdirRead],
  ] as const) {
    if (read.ok) {
      if (read.content !== '') { measured[f] = read.content; continue; }
      noteIssue(`${id}#${f}#dropped`, now,
        `registry entry ${id} dropped — ${f} read back empty`, false);
      return null;   // narrowed drop, logged — see this function's own docstring
    }
    if (read.reason === 'unreadable' && names.includes(`${id}.${f}`)) {
      unmeasured.push(f);
      noteIssue(`${id}#${f}#degraded`, now,
        `registry ${id}.${f} is listed but unreadable — ${f} is unmeasured, not absent`, true);
      continue;
    }
    // Two conditions used to share one sentence ("is not present in the
    // registry directory"), which is only true for the second: a measured
    // `absent` field that WAS in this function's own listing means the
    // ENOENT came from the read racing a removal, not from the listing never
    // having named it — an operator grepping this line for a half-written
    // entry deserves the true one.
    if (read.reason === 'absent' && names.includes(`${id}.${f}`)) {
      noteIssue(`${id}#${f}#dropped`, now,
        `registry entry ${id} dropped — ${f} was listed but is gone by the time it was read (raced a removal)`, false);
      return null;   // narrowed drop, logged — see this function's own docstring
    }
    noteIssue(`${id}#${f}#dropped`, now,
      `registry entry ${id} dropped — ${f} is not present in the registry directory`, false);
    return null;   // narrowed drop, logged — see this function's own docstring
  }

  const holdListed = names.includes(`${id}.hold`);
  const substrateListed = names.includes(`${id}.substrate`);

  // §4.3's three-valued read, over the three fields the lifecycle classifier
  // consumes. Same evidence as the identity ladder above: `names` is the
  // listing this function opened with, so it proves PRESENCE independently of
  // whether the bytes came back — the one thing `field()` alone cannot tell
  // you. Without it a stop that WAS recorded but could not be read looks like
  // no stop at all, and the classifier prints `orphan` about a session nobody
  // managed to look at. That is rule (b)'s exact prohibition, and it is why the
  // discrimination lives here rather than in the pure function.
  //
  // Task 5, THE GOVERNING RULE: a measured `absent` `started`/`supervised`/
  // `stopped` is the ORDINARY case — no stamp was ever written — and is
  // simply not pushed, same as today's answer for a genuinely-absent field.
  // A measured `unreadable` falls back to exactly today's `names.includes`
  // rung. (One narrow difference from the OLD collapsed-evidence ladder: a
  // field listed at this function's own listing but genuinely gone by its
  // own read — the same race the identity triple can now prove too — used
  // to be inferred as `unreadable`-and-listed and pushed; a measured read
  // now proves it `absent` and does not push it. Same reasoning as the
  // identity triple's drop, applied here to "not a fault" instead of "row
  // gone".)
  const stopStamp = stoppedRead.ok ? packedStamp(stoppedRead.content) : null;
  const swapStamp = packedStamp(swapBlockedRaw);
  const spawnStamp = packedStamp(spawnRaw);
  const spawnRc = spawnStamp === null ? null : numOrNull(spawnStamp.rest);

  const lifecycleUnmeasured: LifecycleField[] = [];
  for (const [f, read] of [
    ['started', startedRead], ['supervised', supervisedRead],
  ] as const) {
    if (!read.ok && read.reason === 'unreadable' && names.includes(`${id}.${f}`)) lifecycleUnmeasured.push(f);
  }
  // `.stopped` gets the wider net `SessionRecord.lifecycleUnmeasured`'s own
  // docstring explains: unreadable-but-listed (the shared rule above) OR
  // listed-and-readable-but-unparseable (`stopStamp === null` while the read
  // itself succeeded) — the proven bash/TS divergence a zero-byte or torn
  // `.stopped` produces. A measured `absent` does NOT trip the wide net —
  // there is no content to fail to parse when there is proven to be no file.
  if (stoppedRead.ok) {
    if (stopStamp === null) lifecycleUnmeasured.push('stopped');
  } else if (stoppedRead.reason === 'unreadable' && names.includes(`${id}.stopped`)) {
    lifecycleUnmeasured.push('stopped');
  }

  // `names` is the listing this function opened with — PRESENCE, independently
  // of whether the bytes came back. See `SessionRecord.branchEvidence` for why
  // this is its own field rather than a member of either array above, and for
  // what each rung means.
  //
  // THE `'empty'` RUNG WAS THE ONE MISSING (review finding, Wave 3), and it is
  // also where `branch` gets normalised. `field()` returns `content.trim()`, so
  // a zero-byte or torn `.branch` arrives here as `''` — not null — and the
  // boolean this replaced could not see it: the record carried a MEASURED
  // branch that named nothing, and `''` was then used AS A BRANCH NAME by
  // three consumers.
  //   - `verifyDone` (coord/fingerprint.ts) asked `readBranchTip` for a ref
  //     path ending in a slash and refused `tip-unmeasurable` naming no branch
  //     at all ("no readable ref for  under demo").
  //   - `divergence.ts`'s rule 2 skips on `r.branch === null`, so `''` went
  //     through and reported drift as "the registry says , the worktree's own
  //     HEAD says ws/quiet-basin" — a divergence against nothing.
  //   - `assembleFleet`'s `sl?.branch ?? r.branch` put `''` on the wire, where
  //     it renders as an empty branch chip.
  // Normalised at THIS one place — the only place that reads the file — rather
  // than defended against three times downstream. `.stopped` above already
  // refuses to trust the same shape, for the same reason.
  //
  // Task 5, THE GOVERNING RULE: `branchRead.ok` is today's content branch,
  // unchanged. `reason === 'absent'` is a POSITIVE answer that short-circuits
  // to `'absent'` directly — the case that was impossible to express before
  // `readFileMeasured` existed (a LISTED `.branch` a race genuinely removed
  // before its own bytes were read). `reason === 'unreadable'` falls back to
  // EXACTLY today's `names.includes(...)` rung, so an older agent (every read
  // `unreadable`) reproduces today's answer verbatim.
  const branchEvidence: BranchEvidence =
    branchRead.ok ? (branchRead.content === '' ? 'empty' : 'named')
      : branchRead.reason === 'absent' ? 'absent'
        : (names.includes(`${id}.branch`) ? 'unreadable' : 'absent');
  // The invariant every consumer may rely on, stated once: `branch` is a
  // string exactly when the evidence is `'named'`.
  const branchName = branchEvidence === 'named' && branchRead.ok ? branchRead.content : null;

  return {
    id, wrapper: measured.wrapper, project: project ?? id, workdir: measured.workdir, uuid: measured.uuid,
    started: startedRead.ok && startedRead.content === '1',
    home, pool: pool ? pool.split(/\s+/).filter(Boolean) : null,
    lastswap: lastswap ? parseInt(lastswap, 10) : null,
    workspace, branch: branchName,
    branchEvidence,
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
    // Task 5 / D-112: a measured `absent` `.hold` reads null DIRECTLY — a
    // proven ENOENT is the strongest form of "absence IS release" there is,
    // strictly better evidence than a listing that did not come back, so it
    // short-circuits without waiting for `readRegistryMeasured`'s second
    // listing at all. A measured `unreadable` falls back to EXACTLY today's
    // rung: `names` is the directory listing this function opened with, so
    // it proves PRESENCE independently of whether the read succeeded — the
    // one piece of evidence `field()` alone does not have. See
    // `HOLD_UNREADABLE`. An empty read is a hold with nothing to show, which
    // is not the same fact as an unreadable one — see `HOLD_NO_REASON`.
    held: holdRead.ok
      ? (holdRead.content === '' ? HOLD_NO_REASON : holdRead.content)
      : (holdRead.reason === 'absent' ? null : (holdListed ? HOLD_UNREADABLE : null)),
    // The `.hold` ladder, applied to the supervisor's fault record (D-B8-14,
    // spec §2): presence from the LISTING, never from a non-null read — "no
    // fault recorded" re-enables every destructive affordance downstream, so
    // it must never be the misreading of "the marker would not read". Content
    // degrades LOUDLY: an empty marker gets a sentence (only a torn write
    // produces one — `_substrate_mark` synthesizes a reason rather than write
    // nothing), and a stampless one keeps its whole text at `at: 0` rather
    // than losing the one sentence a maintainer could act on.
    //
    // D-113: a measured `absent` reads null DIRECTLY, same reasoning as
    // `held`/D-112 — and it closes a live false alarm here specifically,
    // since `.substrate` has no second listing of its own to demote a
    // false HOLD_UNREADABLE-shaped answer the way `held` does: `_substrate_
    // clear` removes the marker on the first live probe (a routine event),
    // so a marker listed at the top of a read and cleared before its own
    // field read used to report `SUBSTRATE_UNREADABLE` — "the registry is
    // broken" — on an ordinary recovery. A measured `unreadable` still falls
    // back to exactly today's `substrateListed` rung.
    substrate: substrateRead.ok
      ? (substrateRead.content === ''
          ? { at: 0, text: SUBSTRATE_NO_REASON }
          : (() => {
              const p = packedStamp(substrateRead.content);
              return p === null ? { at: 0, text: substrateRead.content } : { at: p.at, text: p.rest || substrateRead.content };
            })())
      : (substrateRead.reason === 'absent' ? null : (substrateListed ? { at: 0, text: SUBSTRATE_UNREADABLE } : null)),
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
    supervisedAt: numOrNull(supervisedRead.ok ? supervisedRead.content : null),
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
  // before ~22 field reads per session; a `ccd ws-release` that lands anywhere
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
 * id's 22 field reads — ~23 agent-WS round trips in remote mode, instead of
 * `readRegistry`'s 24-generation sweep of the whole fleet (~529 round trips
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
