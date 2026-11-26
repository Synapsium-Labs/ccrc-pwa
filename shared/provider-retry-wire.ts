// What the console is told of a session's provider retry, and its one reader (the provider-failure ladder, wave 2; plan
// `docs/superpowers/plans/2026-11-25-provider-retry.md`). Ring L0, context C5. It imports nothing: `shared/api.ts` imports a value
// from it, and that file's value imports come from import-free siblings (D-3021), which `provider-retry.ts` is not.

/** `FleetSession.providerRetry` (wave 2): a session whose turn ended on a provider error and that the ladder retries by itself.
 *  ABSENT (or null) says no more than that no retry is known: none owed, a stopped ladder, not measured, an older server. */
export interface ProviderRetryWire {
  /** The turn marker's error token (`overloaded`, `server_error`); null when it names none. */
  readonly err: string | null;
  /** Epoch ms of the oldest of the consecutive failures, and how many there were. */
  readonly since: number;
  readonly attempts: number;
  /** Epoch ms at which the next nudge falls due; null while something keeps it out, so no time is promised. */
  readonly nextAt: number | null;
  readonly phase: 'retrying';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The one reader of `FleetSession.providerRetry`, for a revived row and for a live frame, which is cast. A phase this build
 *  does not know, and anything malformed, is absent: the words are never a guess. */
export function providerRetryOf(v: unknown): ProviderRetryWire | null {
  if (typeof v !== 'object' || v === null) return null;
  const { err, since, attempts, nextAt, phase } = v as Record<string, unknown>;
  if (phase !== 'retrying' || !(err === null || typeof err === 'string') || !isNum(since) || !isNum(attempts) || !(nextAt === null || isNum(nextAt))) return null;
  return { err, since, attempts, nextAt, phase };
}
