// DISK RETENTION shadow journal (D-TBD-shadow-journal). L0 vocabulary: what the durable record of an
// unarmed disk lane's verdict says, so the server's recorder (L3), its store (L3) and its read route (L4) share one
// definition. A shadow lane (`expire-child`, `stale-archive`, `nested-rescue`) never acts before its arming marker; this
// journal is how an operator or an agent reviews what it WOULD have done, long after the 2000-row feed has rolled over.

/** The lanes that write a shadow verdict: the three whose only shadow evidence was a feed row. */
export const SHADOW_LANES = ['expire-child', 'stale-archive', 'nested-rescue'] as const;
export type ShadowLane = typeof SHADOW_LANES[number];
/** The lanes by role, so a writer names one without spelling its word (the coord kebab scan reads quoted words). */
export const SHADOW_LANE = { expireChild: SHADOW_LANES[0], staleArchive: SHADOW_LANES[1], nestedRescue: SHADOW_LANES[2] } as const;
export const isShadowLane = (v: unknown): v is ShadowLane => typeof v === 'string' && (SHADOW_LANES as readonly string[]).includes(v);

/** The rung that would act, spelled once per lane. */
export const SHADOW_RUNG: Readonly<Record<ShadowLane, string>> = {
  'expire-child': 'expire',
  'stale-archive': 'archive',
  'nested-rescue': 'rescue',
};

/** What a lane hands the recorder. `path` is null where the verdict names a session only; `bytes`/`inodes` are null
 *  where the lane does not measure them (none of the three does today, so they are recorded when a lane learns them). */
export interface ShadowVerdictInput {
  readonly lane: ShadowLane;
  readonly subject: string;
  readonly path: string | null;
  /** What distinguishes this verdict from the next one about the same subject: an archive's instant, a run id. */
  readonly epoch: string;
  readonly bytes: number | null;
  readonly inodes: number | null;
  readonly detail: string;
}

/** One stored verdict, as the read route answers it. */
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

/** Retention: a row older than this is pruned on the next write. */
export const SHADOW_JOURNAL_MAX_AGE_MS = 30 * 86_400_000;
/** Size bound: at most this many newest rows are kept, whatever their age. */
export const SHADOW_JOURNAL_MAX_ROWS = 5000;
/** The read route's page: default and ceiling. */
export const SHADOW_JOURNAL_DEFAULT_LIMIT = 200;
export const SHADOW_JOURNAL_MAX_LIMIT = 1000;

/** The durable once-only key of a verdict: the same lane, subject, path and epoch is the same row after a restart. */
export const shadowVerdictKey = (v: Pick<ShadowVerdictInput, 'lane' | 'subject' | 'path' | 'epoch'>): string =>
  `${v.lane}\u0000${v.subject}\u0000${v.path ?? ''}\u0000${v.epoch}`;
