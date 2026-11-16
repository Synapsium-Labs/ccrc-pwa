// L2 ports: the clock kernel's time and chance (Overlord spec §11.5, §3.6 H2). Context K. Types only: the system
// adapters are `./system.ts` (L3), the bounds and the wall clamp `./rules.ts` (L1), and the one construction is the
// composition root's (`index.ts`), handed on as `Deps.time`. A test drives `server/test/fakeTime.ts` instead.

/** The server's two clocks. `wall()`: epoch milliseconds; it may step back or forward (NTP, a VM resume), so a deadline
 *  that fails towards the operator reads it through `wallNotBefore` (time/rules.ts). `mono()`: milliseconds on this
 *  process's monotonic clock; it never steps back, starts near zero at each process start, and means nothing across
 *  a restart, so it is never stored. Failure contract: neither throws. */
export interface Clock { wall(): number; mono(): number }

/** Idempotent; harmless after the call fired. */
export type Cancel = () => void;

/** One-shot calls on this process's event loop, timed on `Clock.mono`. Never a cadence (a cadence is a LANE_SCHEDULE
 *  row) and never a durable deadline (a deadline is a column read through `Clock`). Failure contract: `after` throws
 *  RangeError for a delay `checkDelayMs` refuses; a call that throws or rejects is reported as one
 *  `ccrc-server: a scheduled call failed: <message>` line and never reaches the caller or the process. */
export interface Scheduler { after(ms: number, fn: () => unknown): Cancel }

/** Chance. Failure contract: each method throws RangeError for an argument the rules refuse, and never answers a
 *  weaker value instead. */
export interface Entropy {
  /** `bytes` random bytes as lowercase hex (2 x bytes characters). For secrets and ids. */
  hex(bytes: number): string;
  /** A lowercase version-4 UUID. */
  uuid(): string;
  /** A uniform integer in [0, n). For a sample, a jitter or a seed (`below(2 ** 32)`). */
  below(n: number): number;
}

/** The three, as the composition root hands them on. */
export interface TimePorts { readonly clock: Clock; readonly scheduler: Scheduler; readonly entropy: Entropy }
