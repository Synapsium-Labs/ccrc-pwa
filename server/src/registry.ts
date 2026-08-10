import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { isPrPhase, type PrPhase } from '../../shared/api.js';

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
}

/**
 * The reason a held workspace carries when its `.hold` file is listed in the
 * registry directory but its contents could not be read — one failed op over
 * the agent WS is enough (`readRegistry` fires ~17 reads per session under one
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

/**
 * One session's 17-field read plus the `SessionRecord` it builds — the ONE
 * parser, shared by `readRegistry`'s whole-fleet sweep and
 * `readSessionRecord`'s single-id read below (C0.3), so there is no second
 * copy of this shape to drift out of sync with the first. `names` is the
 * caller's directory listing, passed in rather than re-read here, for the
 * same "PRESENCE independently of whether the read succeeded" reason the
 * `held` field below already relies on.
 *
 * Returns null for an incomplete registry entry (missing wrapper/workdir/
 * uuid) — skip, don't crash, same as the inline `continue` this replaced.
 */
async function buildRecord(io: FleetIO, cfg: CcrcConfig, names: string[], id: string): Promise<SessionRecord | null> {
  const [wrapper, project, workdir, uuid, started, home, pool, lastswap, workspace, branch,
    base, prPhaseRaw, prNumberRaw, prCheckedAtRaw, archivedRaw, manifestRaw, holdRaw] = await Promise.all([
    field(io, cfg.registryDir, id, 'wrapper'), field(io, cfg.registryDir, id, 'project'),
    field(io, cfg.registryDir, id, 'workdir'), field(io, cfg.registryDir, id, 'uuid'),
    field(io, cfg.registryDir, id, 'started'), field(io, cfg.registryDir, id, 'home'),
    field(io, cfg.registryDir, id, 'pool'), field(io, cfg.registryDir, id, 'lastswap'),
    field(io, cfg.registryDir, id, 'workspace'), field(io, cfg.registryDir, id, 'branch'),
    field(io, cfg.registryDir, id, 'base'), field(io, cfg.registryDir, id, 'prphase'),
    field(io, cfg.registryDir, id, 'prnumber'), field(io, cfg.registryDir, id, 'prcheckedat'),
    field(io, cfg.registryDir, id, 'archived'), field(io, cfg.registryDir, id, 'archivemanifest'),
    field(io, cfg.registryDir, id, 'hold'),
  ]);
  if (!wrapper || !workdir || !uuid) return null;   // incomplete registry entry — skip, don't crash
  const holdListed = names.includes(`${id}.hold`);
  return {
    id, wrapper, project: project ?? id, workdir, uuid,
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
  };
}

export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {
  const names = await io.readdir(cfg.registryDir);
  if (names === null) return [];
  const ids = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  const out: SessionRecord[] = [];
  /** Ids whose `.hold` was in `names` but whose bytes came back null. Resolved
   *  after the loop by ONE second listing — see below. */
  const holdUnconfirmed = new Set<string>();
  for (const id of ids) {
    const rec = await buildRecord(io, cfg, names, id);
    if (rec === null) continue;
    if (rec.held === HOLD_UNREADABLE) holdUnconfirmed.add(id);
    out.push(rec);
  }
  // ONE SECOND LISTING, and only when something needs it. `names` was taken
  // before ~17 field reads per session; a `ccd ws-release` that lands anywhere
  // inside that window leaves the name in the listing and no bytes behind it,
  // which the evidence above cannot tell apart from a read that failed — so a
  // perfectly ordinary release was reported as `HOLD_UNREADABLE`, the
  // registry-is-broken sentence, and `archiveMerged` fired a held-merged push
  // announcing corruption seconds after the operator tapped Release.
  //
  // Re-listing distinguishes them, because a directory read is exactly the
  // evidence `field()` lacks: gone from the second listing = deleted on
  // purpose (absence IS release, and it is now TWICE-observed absence, not an
  // absent read). Still listed = genuinely unreadable, and it keeps
  // `HOLD_UNREADABLE`. A second listing that FAILS proves nothing and changes
  // nothing: fail-shut stands.
  if (holdUnconfirmed.size > 0) {
    const again = await io.readdir(cfg.registryDir);
    if (again !== null) {
      for (const rec of out) {
        if (holdUnconfirmed.has(rec.id) && !again.includes(`${rec.id}.hold`)) rec.held = null;
      }
    }
  }
  return out;
}

/**
 * `readRegistry`, narrowed to ONE session (C0.3). One `readdir` plus that
 * id's 17 field reads — ~18 agent-WS round trips in remote mode, instead of
 * `readRegistry`'s 24-generation sweep of the whole fleet (~409 round trips
 * on a 24-session fleet) — for every caller that only ever asked "what does
 * the registry say about THIS session" and never needed uniqueness or a
 * subtraction over the rest of the fleet. Built from the SAME `buildRecord`
 * loop body `readRegistry` uses, so there remains exactly one parser.
 *
 * `null` when the id has no `.uuid` in the listing OR its own fields don't
 * parse into a complete record — the two ways `readRegistry`'s caller-side
 * `.find(r => r.id === id)` already returned undefined, now collapsed into
 * one return value at the source instead of two.
 *
 * Carries the SAME hold-reconfirm discipline as `readRegistry` (see the
 * "ONE SECOND LISTING" comment above): a hold that reads `HOLD_UNREADABLE`
 * gets ONE follow-up listing, because a `ws-release` landing inside this
 * call's own field-read window is indistinguishable from a failed read at
 * `field()` alone, exactly as for the whole-fleet sweep.
 */
export async function readSessionRecord(io: FleetIO, cfg: CcrcConfig, id: string): Promise<SessionRecord | null> {
  const names = await io.readdir(cfg.registryDir);
  if (names === null) return null;
  if (!names.includes(`${id}.uuid`)) return null;   // not in the registry — no field reads worth making
  const rec = await buildRecord(io, cfg, names, id);
  if (rec === null) return null;
  if (rec.held === HOLD_UNREADABLE) {
    const again = await io.readdir(cfg.registryDir);
    if (again !== null && !again.includes(`${id}.hold`)) rec.held = null;
  }
  return rec;
}
