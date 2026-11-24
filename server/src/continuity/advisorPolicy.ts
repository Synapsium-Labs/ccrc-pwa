// L1, context C3 (Session Conversation): the coordinator advisor's decisions (plan `2026-11-23-coordinator-advisor.md`,
// spec §4-§6, D-8967, D-8968, D-8970). Pure: every fact arrives as an argument.
//
//   * `coordinatorAdvisorOf` what the Settings row means (a lost row is the default; a failed read or an unknown word is
//     null, and nothing is written from it);
//   * `advisorFor`           the route field `advisor` a session's next launch should carry: a model, `clear`, or null
//     (leave the field alone: a fact was unmeasured);
//   * `advisorStaleOf`       whether the running pane's spawn applied something other than the route asks (the roll's
//     `advisor-stale` reason);
//   * `advisorStateOf`       the readout's one word (spec §6).
//
// AN UNMEASURED FACT NEVER WRITES. Each rule that cannot be read answers null, so the lane leaves the field as it stands;
// an undecided role reading takes the member that does less (C49), which is never a coordinator here.
import {
  ADVISOR_CAP_MAX, ADVISOR_UNSEEN_REQUESTS, COORDINATOR_ADVISOR_DEFAULT, advisorScopeHas, advisorScopeOf, isAdvisorCap,
  isAdvisorChoice, type AdvisorApplyPath, type AdvisorModel, type AdvisorSpawnRecord, type AdvisorState, type AdvisorTokens,
  type CoordinatorAdvisorSetting,
} from '../../../shared/coordinatorAdvisor.js';
import type { AdvisorLineFact } from '../transcript/parse.js';
import type { RoleReading } from '../roleOf.js';

/** The Settings row as read: a row (its words unnarrowed), no row, or a read that failed, never one `null`. */
export type CoordinatorAdvisorRead =
  | { readonly kind: 'row'; readonly choice: unknown; readonly cap: unknown; readonly scope: unknown }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The forward reader's place in one coordinator's transcript, and what it saw since the spawn it read for. */
export interface AdvisorReadState {
  readonly file: string;
  readonly offset: number;
  /** The spawn record's epoch (seconds) this state was read for; a new spawn restarts the counts below. */
  readonly spawnAt: number;
  /** Main-loop API requests (distinct assistant message ids) since that spawn. */
  readonly requests: number;
  readonly lastMessageId: string | null;
  /** The newest `advisor_tool` attachment since that spawn: `true`, `false`, or null for none. */
  readonly available: 'true' | 'false' | null;
  readonly availableAt: number | null;
  /** The newest advisor call since that spawn (epoch ms). */
  readonly lastCallAt: number | null;
  /** Lines the reader could not parse, since that spawn: counted, never dropped in silence. */
  readonly unreadable: number;
  /** The UTC day of the newest `available:false` attachment after a spawn that applied the flag. Unlike the counts above it
   *  outlives a new spawn, so a drop holds for the rest of its day (review F4: the restart that dropped the flag would
   *  otherwise read as no drop, and the lane would ask for it again). */
  readonly droppedDay: string | null;
}

/** One advisor call as the count lane records it. `tokens` null: no line has carried its message's usage yet. */
export interface AdvisorCallRow {
  readonly callId: string;
  readonly day: string;
  readonly at: number;
  readonly model: string | null;
  readonly tokens: AdvisorTokens | null;
}

/** The setting as stored: a lost row is the default (off); a failed read, or any word this build does not know, is null. */
export function coordinatorAdvisorOf(r: CoordinatorAdvisorRead): CoordinatorAdvisorSetting | null {
  if (r.kind === 'absent') return COORDINATOR_ADVISOR_DEFAULT;
  if (r.kind === 'unreadable') return null;
  const scope = advisorScopeOf(r.scope);
  if (!isAdvisorChoice(r.choice) || !isAdvisorCap(r.cap) || scope === null) return null;
  return { choice: r.choice, cap: r.cap, scope };
}

/** The UTC day of an epoch-ms instant, `YYYY-MM-DD`: the cap's day (spec §5). */
export function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The facts `advisorFor` decides from, each with its own unmeasured value. */
export interface AdvisorFacts {
  /** The Settings row (`coordinatorAdvisorOf`); null when it could not be read. */
  readonly setting: CoordinatorAdvisorSetting | null;
  readonly sessionId: string;
  readonly reading: RoleReading;
  /** The session's lane is an Anthropic lane (the roster's `telemetry: anthropic`). */
  readonly anthropic: boolean | 'unmeasured';
  /** The route's `class` as it stands; undefined when the route names none. */
  readonly routeClass: string | undefined;
  /** The family class of the session's measured main-loop model (the usage sidecar's), or `unmeasured`. */
  readonly mainClass: string | null | 'unmeasured';
  /** That model's id, when measured (absent or `unmeasured`: not read). Only Opus 5 and later pair with an advisor. */
  readonly mainModel?: string | null | 'unmeasured';
  /** Today's counted advisor calls. */
  readonly today: number | 'unmeasured';
  /** A drop seen today: ccd's fast-death fallback, or an `available:false` attachment since the spawn. */
  readonly droppedToday: boolean | 'unmeasured';
}

/** Whether a measured main-loop model id can take an advisor: an Opus id names its major version, and only 5 and later
 *  pair (an Opus 5/5.5 main model accepts Fable or Opus 5+). Any other id is left to the class rule. */
export function advisorPairsWith(model: string): boolean {
  const m = /opus-(\d+)/i.exec(model);
  return m === null || Number(m[1]) >= 5;
}

/** The route field this session's next launch should carry (spec §4). `clear` removes it; null leaves it alone.
 *  EVERY MEASURED REASON TO REMOVE COMES FIRST (review F3): removing the advisor needs none of the facts that adding it
 *  needs, so an unmeasured lane or main model never keeps a coordinator past its cap, its drop or the operator's Off. */
export function advisorFor(f: AdvisorFacts): AdvisorModel | 'clear' | null {
  if (f.setting === null) return null;
  if (f.setting.choice === 'off' || !advisorScopeHas(f.setting.scope, f.sessionId)) return 'clear';
  // The Overlord is its own role with its own profile; a worker, a reviewer and a plain session have no advisor.
  if (f.reading.kind !== 'role' || f.reading.role !== 'coordinator') return 'clear';
  if (f.today !== 'unmeasured' && f.today >= Math.min(f.setting.cap, ADVISOR_CAP_MAX)) return 'clear';
  if (f.droppedToday === true) return 'clear';
  if (f.anthropic === false) return 'clear';
  const routed = f.routeClass !== undefined && f.routeClass !== 'default';
  if (routed && f.routeClass !== 'opus') return 'clear';
  if (!routed && f.mainClass !== 'unmeasured' && f.mainClass !== 'opus') return 'clear';
  if (typeof f.mainModel === 'string' && f.mainModel !== 'unmeasured' && !advisorPairsWith(f.mainModel)) return 'clear';
  // Adding it needs every fact measured.
  if (f.anthropic === 'unmeasured' || (!routed && f.mainClass === 'unmeasured')) return null;
  if (f.today === 'unmeasured' || f.droppedToday === 'unmeasured') return null;
  return f.setting.choice;
}

/** The route word as a model: the two words ccd renders, else none. */
export function advisorRouteModelOf(word: string | undefined): AdvisorModel | null {
  return word === 'fable' || word === 'opus' ? word : null;
}

/** Whether a restart would change what the running pane has: the route's model differs from the one its spawn applied.
 *  Measured only: an unreadable route field or spawn record is never stale. A fast-death spawn is settled ON ITS UTC DAY
 *  (a restart would try the launch that died) until the lane clears the field; on a later day it is stale like any other
 *  `off`, so the advisor the lane asks for again is restored (review F5). `day` is today's UTC day. */
export function advisorStaleOf(routeWord: string | undefined, routeUnread: boolean, spawn: AdvisorSpawnRecord | 'unreadable' | null,
  day: string): boolean {
  if (routeUnread || spawn === 'unreadable') return false;
  if (fastDeathOn(spawn, day)) return false;
  const want = advisorRouteModelOf(routeWord);
  const have = spawn !== null && spawn.kind === 'applied' ? spawn.model : null;
  return want !== have;
}

/** Whether the spawn record says ccd's fast-death fallback dropped the advisor on this UTC day. */
export function fastDeathOn(spawn: AdvisorSpawnRecord | 'unreadable' | null, day: string): boolean {
  return spawn !== null && spawn !== 'unreadable' && spawn.kind === 'off' && spawn.fastDeath && utcDayOf(spawn.at * 1000) === day;
}

/** The forward reader's state counts only for the spawn it was read for. */
const forSpawn = (read: AdvisorReadState | null, spawn: AdvisorSpawnRecord): AdvisorReadState | null =>
  read !== null && read.spawnAt === spawn.at ? read : null;

/** Whether the reader saw an `available:false` attachment since this spawn. */
export function droppedSinceSpawn(read: AdvisorReadState | null, spawn: AdvisorSpawnRecord | 'unreadable' | null): boolean {
  if (spawn === null || spawn === 'unreadable' || spawn.kind !== 'applied') return false;
  return forSpawn(read, spawn)?.available === 'false';
}

/** Whether the advisor was dropped on `day`: ccd's fast-death fallback, an `available:false` since this spawn, or one after
 *  an earlier spawn of the same day (`droppedDay`). One rule for the lane and the readout. */
export function droppedOn(read: AdvisorReadState | null, spawn: AdvisorSpawnRecord | 'unreadable' | null, day: string): boolean {
  return fastDeathOn(spawn, day) || droppedSinceSpawn(read, spawn) || read?.droppedDay === day;
}

export interface AdvisorStateInput {
  readonly routeWord: string | undefined;
  readonly spawn: AdvisorSpawnRecord | 'unreadable' | null;
  readonly read: AdvisorReadState | null;
  /** Today's counted calls; null when the count could not be read. */
  readonly today: number | null;
  readonly cap: number;
  readonly day: string;
}

/** The readout's one word (spec §6). Capped and dropped come first: they say why the route lost its field. */
export function advisorStateOf(i: AdvisorStateInput): AdvisorState {
  // An unreadable spawn record says nothing about what the pane runs: its own word, never `off` (review F6).
  if (i.spawn === 'unreadable') return 'unmeasured';
  const want = advisorRouteModelOf(i.routeWord);
  const spawn = i.spawn;
  const have = spawn !== null && spawn.kind === 'applied' ? spawn.model : null;
  if (droppedOn(i.read, i.spawn, i.day)) return 'dropped';
  if (i.today !== null && i.today >= i.cap && (want !== null || have !== null)) return 'capped';
  if (want !== null && have !== want) return 'queued';
  if (have === null || spawn === null) return 'off';
  const r = forSpawn(i.read, spawn);
  if (r !== null && (r.available === 'true' || (r.lastCallAt !== null && r.lastCallAt >= spawn.at * 1000))) return 'live';
  if (r !== null && r.requests >= ADVISOR_UNSEEN_REQUESTS) return 'unseen';
  return 'requested';
}

/** Which act applies a change to a running coordinator (spec §5): the renewal lane while `continuity` is live, the roll
 *  while its Settings row takes coordinators, else the next start. */
export function advisorApplyPathOf(continuityLive: boolean, rollTakesCoordinators: boolean): AdvisorApplyPath {
  if (continuityLive) return 'renewal';
  return rollTakesCoordinators ? 'roll' : 'next-spawn';
}

/** Fold one forward read's line facts into the reader's state for `spawnAt` (epoch seconds; `applied`: that spawn passed
 *  the flag) and the call rows to record.
 *  A new spawn, or another file, starts the per-spawn counts afresh; a line older than the spawn counts toward the day's
 *  calls but not toward that spawn's requests or availability. Streamed lines of one message count one request (the
 *  same `messageId` as the line before). A call's tokens are its message's advisor usage, split evenly over the calls the
 *  line carried (one in practice). */
export function foldAdvisorFacts(prev: AdvisorReadState | null, file: string, spawnAt: number, applied: boolean,
  facts: readonly AdvisorLineFact[], next: number, skipped: number): { state: AdvisorReadState; calls: AdvisorCallRow[] } {
  const fresh = prev === null || prev.spawnAt !== spawnAt || prev.file !== file;
  let requests = fresh ? 0 : prev.requests; let lastMessageId = fresh ? null : prev.lastMessageId;
  let available = fresh ? null : prev.available; let availableAt = fresh ? null : prev.availableAt;
  let lastCallAt = fresh ? null : prev.lastCallAt; let unreadable = (fresh ? 0 : prev.unreadable) + skipped;
  let droppedDay = prev?.droppedDay ?? null;   // outlives a new spawn and a new file: the drop holds for its day
  const calls = new Map<string, AdvisorCallRow>();
  // The calls each message of this read carried: a later streamed line of the same message may carry fuller usage (review F8).
  const byMessage = new Map<string, readonly string[]>();
  const sinceSpawn = (at: number | null): boolean => at !== null && at >= spawnAt * 1000;
  for (const f of facts) {
    if (f.kind === 'unreadable') { unreadable += 1; continue; }
    if (f.kind === 'availability') {
      if (sinceSpawn(f.at)) {
        available = f.available ? 'true' : 'false'; availableAt = f.at;
        if (!f.available && applied && f.at !== null) droppedDay = utcDayOf(f.at);
      }
      continue;
    }
    if (f.kind !== 'request') continue;
    if (sinceSpawn(f.at) && (f.messageId === null || f.messageId !== lastMessageId)) requests += 1;
    if (f.messageId !== null) lastMessageId = f.messageId;
    if (f.at === null) continue;   // a call with no time has no day: it is not counted
    if (f.messageId !== null && f.calls.length > 0) byMessage.set(f.messageId, f.calls);
    // A line with no call of its own still carries its message's usage: the newest measured usage fills that message's calls.
    const own = f.calls.length > 0 ? f.calls : f.messageId !== null && f.usage !== null ? byMessage.get(f.messageId) ?? [] : [];
    const n = own.length;
    for (const id of own) {
      const tokens: AdvisorTokens | null = f.usage === null ? null : {
        input: Math.round(f.usage.input / n), output: Math.round(f.usage.output / n),
        cacheRead: Math.round(f.usage.cacheRead / n), cacheWrite: Math.round(f.usage.cacheWrite / n),
      };
      const had = calls.get(id);
      calls.set(id, { callId: id, day: had?.day ?? utcDayOf(f.at), at: had?.at ?? f.at, model: f.model ?? had?.model ?? null, tokens: tokens ?? had?.tokens ?? null });
      if (f.calls.length > 0 && sinceSpawn(f.at) && (lastCallAt === null || f.at > lastCallAt)) lastCallAt = f.at;
    }
  }
  return {
    state: { file, offset: next, spawnAt, requests, lastMessageId, available, availableAt, lastCallAt, unreadable, droppedDay },
    calls: [...calls.values()],
  };
}
