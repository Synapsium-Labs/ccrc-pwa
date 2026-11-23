// shared/model-aliases.d.mts — hand-written, in `shared/model-advance.d.mts`'s shape: the `.mjs` beside it is what
// runs, and this is what lets a TypeScript caller import it with types. Like the `.mjs`, it spells no class word.
import type { ModelClass } from './models.js';
import type { ClassAdvance } from './model-advance.mjs';

/** One catalogue row. `efforts` is `null` when the row carries no effort field and `[]` only when the row says the
 *  model takes none (D-8750): the two are never folded. */
export interface AliasRow {
  id: string;
  label: string | null;
  efforts: readonly string[] | null;
  defaultEffort: string | null;
  minVersion: string | null;
}

/** One row or one class's target the cache reader left out (cache-row-skip): `at` the field that breaks it
 *  (`models[3].id`, `models[3].min_claude_code_version`, `provider_alias_targets.<class>.default`), `why` what is wrong
 *  with that field. */
export interface CacheSkip {
  at: string;
  why: string;
  /** The normalized id of a skipped row (no row for that id survives in this file), `null` if the id was unreadable.
   *  Omitted for skips that cannot hide a row for any valid target (malformed target or invalid string id). */
  rowId?: string | null;
}

export type CacheReading =
  | {
    format: 'current'; fetchedAt: string; aliasTargets: Record<ModelClass, string | null>; rows: Map<string, AliasRow>;
    /** What the reader left out, in file order (targets first); `[]` when it read every row and every target. */
    skipped: readonly CacheSkip[];
  }
  | { format: 'older'; fetchedAt: string | null }
  | { format: 'invalid'; why: string };

export declare function bareModelId(raw: string): string;
/** A Claude Code build's version, a dotted number: the one test of that form. */
export declare const VERSION_RE: RegExp;
export declare function parseCatalogueCache(json: unknown): CacheReading;
export declare function newestCache(readings: readonly CacheReading[]): Extract<CacheReading, { format: 'current' }> | null;

// ── the resolver and the aliases file (Task A2.2) ──
export declare const ALIASES_VERSION: 1;
export declare const CACHE_STALE_AFTER_MS: 604_800_000;

/** A filled launch marker of this lane (Task A3.2): `id` already through `bareModelId`, `bornAt` the process start. */
export interface Launch { class: ModelClass; id: string; bornAt: string }
export interface Hold { at: string; model: string }

export interface ResolveInput {
  /** The lane's own cache files' readings (every file of the home, any format). */
  own: readonly CacheReading[];
  /** The newest-cache readings of every other home on the box: read for a row by id, never for a target. */
  box: readonly CacheReading[];
  launches: readonly Launch[];
  /** The lane's aliases file as last written; null only when that file is absent. */
  prior: Aliases | null;
  /** The advance file's standing holds, with each `hold.model`. */
  holds: Partial<Record<ModelClass, Hold>>;
  /** The lane's Claude Code build, `X.Y.Z`; null when it cannot be read. */
  laneVersion: string | null;
  /** The home's saved effort levels, model id to level. */
  saved: Readonly<Record<string, string>>;
  nowMs: number;
  /** True when the caller could not read the home's cache files at all: with no usable reading and nothing read, the
   *  file's `cache` is `{none: 'unreadable'}`. Without it, no reading at all is `absent`, and only invalid readings
   *  are `invalid`. */
  ownUnreadable?: boolean;
}

export type AliasesCache =
  | { fetchedAt: string | null; format: 'current' | 'older' }
  | { none: 'absent' | 'unreadable' | 'invalid' };

export interface AliasClass {
  id: string | null;
  source: 'cache' | 'use' | null;
  evidenceAt: string | null;
  idSince: string | null;
  /** The newest own cache's target for the class, even if the lane's build is below its measured minimum. Null if
   *  the target is absent, malformed, or a relevant skipped row leaves its minimum unknown. Label from `id`. */
  cacheTarget: string | null;
  seenId: string | null;
  seenAt: string | null;
  unobserved: boolean;
  unlaunchable: { needs: string; laneVersion: string | null } | null;
  row: AliasRow | null;
  rowFrom: 'own' | 'box' | null;
  heldRow: AliasRow | null;
  orphaned: { id: string; level: string } | null;
  [key: string]: unknown;
}

/** `cache.fetchedAt` is null only for an older-format cache whose fetch time could not be read (a departure from the
 *  plan's `string`, which that case needs). */
export interface Aliases {
  v: 1;
  at: string;
  cache: AliasesCache;
  stale: boolean;
  classes: Record<ModelClass, AliasClass>;
  [key: string]: unknown;
}

export type AliasSourceCause = 'alias-source-absent' | 'alias-cache-stale';

export declare class AliasesInvalid extends Error {
  readonly field: string;
  constructor(field: string, message: string);
}

export declare function resolveAliases(input: ResolveInput): Aliases;
export declare function parseAliases(json: unknown): Aliases;
export declare function serializeAliases(a: Aliases): string;
export declare function aliasesSourceCause(a: Aliases): AliasSourceCause | null;

/** Whether a build of `laneVersion` can launch `row` (null: a target with no row, which names no minimum): a row naming
 *  a minimum is not launchable when the build is unreadable (`null`) or below it. */
export declare function rowLaunchable(row: AliasRow | null, laneVersion: string | null): boolean;
/** Whether a held class's id is unobserved against the hold standing now: a hold stands, and the id rests on no evidence
 *  or on evidence older than the hold (the resolver's `unobserved` rule, asked again by the health reading). */
export declare function heldUnobserved(evidenceAt: string | null, hold: { at: string } | null | undefined): boolean;

// ── a session behind its class's alias (Task A2.5) ──
/** One class as `aliasModelBehind` reads it, from whichever reading the caller has (an aliases file and its advance
 *  entry for doctor, the lane-models read for the roll). `id`: the alias's current id (null: none, or unknown); `launchable`:
 *  the lane's build can launch `id`; `seenId`: the newest kept alias-launch reading; `hold`: null when no hold stands, else
 *  the id it holds (null: the hold names none, so the class has no target); `heldId`: the held id the hand-pick rule reads
 *  on ANOTHER class (null: none). */
export interface AliasClassView {
  id: string | null;
  launchable: boolean;
  seenId: string | null;
  hold: { model: string | null } | null;
  heldId: string | null;
}
/** The age-free half of `AliasBehind`. */
export interface AliasModelBehind { class: ModelClass; from: string; to: string }
/** Is this session on a model its class has left, age aside? `seen`: the alias's id is a target only once a launch has been
 *  seen on it (the roll); doctor asks without it. */
export declare function aliasModelBehind(
  session: { cls: ModelClass | null; model: string },
  classes: Readonly<Partial<Record<ModelClass, AliasClassView | null>>>,
  opts: { seen: boolean },
): AliasModelBehind | null;
/** One running session's evidence: the class its routing record served (null: none, or `default`), the model its status
 *  line last rendered, the render's time and the turn marker's `turnAt` (null when the session has no marker), both in
 *  epoch milliseconds. */
export interface AliasSession { cls: ModelClass | null; model: string; renderMs: number; turnAtMs: number | null }
/** The exact fields `model-sessions-behind` reads; none is ever null. */
export interface AliasBehind { class: ModelClass; from: string; to: string; movedAt: string; turnAt: string; renderAt: string }
export declare function aliasSessionBehind(
  session: AliasSession, cls: AliasClass | null, adv: ClassAdvance, lane: Aliases, nowMs: number,
): AliasBehind | null;
