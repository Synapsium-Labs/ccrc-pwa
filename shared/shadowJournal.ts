// DISK RETENTION shadow journal (D-6861). L0 vocabulary: what the durable record of an
// unarmed disk lane's verdict says, so the server's recorder (L3), its store (L3) and its read route (L4) share one
// definition. A shadow lane (`expire-child`, `stale-archive`, `nested-rescue`) never acts before its arming marker; this
// journal is how an operator or an agent reviews what it WOULD have done, long after the 2000-row feed has rolled over.

/** The lanes that write a shadow verdict: the three whose only shadow evidence was a feed row. */
export const SHADOW_LANES = ['expire-child', 'stale-archive', 'nested-rescue'] as const;
export type ShadowLane = typeof SHADOW_LANES[number];
/** The lanes by role, so a writer names one without spelling its word (the coord kebab scan reads quoted words). */
export const SHADOW_LANE = { expireChild: SHADOW_LANES[0], staleArchive: SHADOW_LANES[1], nestedRescue: SHADOW_LANES[2] } as const;
export const isShadowLane = (v: unknown): v is ShadowLane => typeof v === 'string' && (SHADOW_LANES as readonly string[]).includes(v);

/** The rung that would act, named by the CALLER, so the row says more than its lane does: nested-rescue is refused on
 *  two ladders (the reclaim lane's rung 9, epoch a run id; the expiry lane's rung 9, epoch an archive instant), and the
 *  row says which. By role, for the same reason as `SHADOW_LANE`. */
export const SHADOW_RUNG = {
  reclaimRescue: 'reclaim:rescue', expireRescue: 'expire:rescue', childShadow: 'child-shadow', archiveIfNoPane: 'archive-if-no-pane',
} as const;
export type ShadowRung = typeof SHADOW_RUNG[keyof typeof SHADOW_RUNG];

/** What a lane hands the recorder. `path` is null where the verdict names a session only; `bytes`/`inodes` are null
 *  where the lane does not measure them (none of the three does today, so they are recorded when a lane learns them). */
export interface ShadowVerdictInput {
  readonly lane: ShadowLane;
  readonly subject: string;
  readonly path: string | null;
  /** What distinguishes this verdict from the next one about the same subject: an archive's instant, a run id. */
  readonly epoch: string;
  /** The rung that would act (`SHADOW_RUNG`), from the call site that refused or held the verdict. */
  readonly rung: ShadowRung;
  readonly bytes: number | null;
  readonly inodes: number | null;
  readonly detail: string;
}

/** One stored verdict, as the read route answers it. `key` is built from the REDACTED path, as stored. `rung` is a
 *  string: a later build may name a rung this one does not. */
export interface ShadowVerdictRow {
  readonly key: string;
  readonly lane: ShadowLane;
  readonly subject: string;
  readonly path: string | null;
  readonly rung: string;
  readonly bytes: number | null;
  readonly inodes: number | null;
  readonly detail: string;
  readonly at: number;
}

/** Retention: a row older than this is pruned on the next write, and never answered by a read (writes may stop). */
export const SHADOW_JOURNAL_MAX_AGE_MS = 30 * 86_400_000;
/** Size bound: at most this many newest rows are kept, whatever their age. */
export const SHADOW_JOURNAL_MAX_ROWS = 5000;
/** The read route's page: default and ceiling. */
export const SHADOW_JOURNAL_DEFAULT_LIMIT = 200;
export const SHADOW_JOURNAL_MAX_LIMIT = 1000;

/** The durable once-only key of a verdict: the same lane, subject, path and epoch is the same row after a restart.
 *  A JSON tuple, never a NUL-joined string: node:sqlite on Node 22 binds text only up to its first NUL, so every key
 *  of a lane would be stored as the bare lane word and collide (measured on CI). JSON escapes a NUL inside a field,
 *  so the tuple stays unambiguous. */
export const shadowVerdictKey = (v: Pick<ShadowVerdictInput, 'lane' | 'subject' | 'path' | 'epoch'>): string =>
  JSON.stringify([v.lane, v.subject, v.path ?? '', v.epoch]);
