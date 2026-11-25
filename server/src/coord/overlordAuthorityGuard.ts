// The guard that holds `authority-rolled-back`, and the boot step that feeds it (Overlord spec §7.6, Table 7.6a; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` Task 4, questions 1, 6 and 9, rulings X3b and F4).
// Ring L4, context C5. The guard is the one holder of the refusal: its inputs are the boot verdict (1), a witness's verdict (2:
// `witnessRefused`, and 2b: `witnessUnmeasured`, a witness's read of the server's own facts that failed), the writer's failure
// (3, through `AuthorityGuardPort`) and a confirmed restore (4, PR C). Nothing else sets or clears it. The gates' step 3 (gates B)
// and the writer read `state()`. Two hooks report out: `onRefusing` (each move from coherent to anything else, which the ladder's
// `restore-detected` latch listens to) and `onAppended` (the writer's post-append report, deferred past the caller's `tx()`,
// which the witness exchange listens to).
//
// A DETECTED RESTORE FENCES THE DOORS, NOT THE BOOT (`restore-fences-doors-not-boot`). The landing journal's failed replay exits
// the server; here the operator ends a rollback at a door, Confirm the restore, so the server must start. The boot step records
// its verdict in the guard, logs one line naming it, and the server starts whatever the verdict. A rollback boot coherence found,
// or the writer found by measuring the file against the head row, is in the file and the head row, so every boot finds it
// again. The guard holds the rest in memory, and a restart clears them: a rollback only a witness found, until a witness answers
// again (review F17); and a writer's `trailing` after an append that wrote no byte, or left a partial tail the boot's heal cuts,
// where the file a restart reads is sound again (review F5). Each clears in the safe direction: nothing was appended.
import type { AuthorityState, CoherenceVerdict } from './overlordAuthorityCoherence.js';
import {
  AUTHORITY_UNREADABLE, type AuthorityGuardPort, type AuthorityHeal, type AuthorityUnreadable, type AuthorityWriterFailure,
} from './overlordAuthorityJournal.js';

/** What the boot step and `remeasure()` need of the journal, bound to the process's one `coord.db` by the composition root
 *  (only the journal holds the handle). Declared here, by its consumer. */
export interface AuthorityBootPort {
  healTornTail(): AuthorityHeal;
  measure(): CoherenceVerdict;
}

export class OverlordAuthorityGuard implements AuthorityGuardPort {
  /** Before the boot step's verdict, nothing has been measured: fail closed. */
  private st: AuthorityState = { kind: 'unmeasured', why: 'journal' };

  private booted = false;
  private readonly refusing: (() => void)[] = [];
  private readonly appendedListeners: (() => void)[] = [];

  /** `journal` is the composition root's binding of the journal's heal and measure to `coord.db`, the boot step's own. */
  constructor(private readonly journal: AuthorityBootPort) {}

  /** Called once each time the state moves from coherent to anything else, and once when `bootVerdict` records a non-coherent
   *  verdict; a second failure while already non-coherent calls nothing. A throwing listener is caught: the state stands. */
  onRefusing(listener: () => void): void {
    this.refusing.push(listener);
  }

  /** Called after the writer's successful append, deferred with `setImmediate` so it runs after the caller's `tx()` has finished. */
  onAppended(listener: () => void): void {
    this.appendedListeners.push(listener);
  }

  /** The writer's post-append report (`AuthorityGuardPort.appended`). */
  appended(): void {
    setImmediate(() => { for (const l of this.appendedListeners) this.call(l); });
  }

  private call(listener: () => void): void {
    try { listener(); } catch { /* a listener never breaks the guard */ }
  }

  private move(next: AuthorityState): void {
    const wasCoherent = this.st.kind === 'coherent';
    this.st = next;
    if (wasCoherent && next.kind !== 'coherent') for (const l of this.refusing) this.call(l);
  }

  /** Gates B's step 3, and the writer through its port. */
  state(): AuthorityState {
    return this.st;
  }

  /** Input 1: the boot step, once. A rollback already held stays: it leaves only by `confirmed()`. */
  bootVerdict(v: CoherenceVerdict): void {
    if (this.st.kind === 'rolled-back') return;
    const first = !this.booted;
    this.booted = true;
    const was = this.st.kind;
    this.st = v;
    // The state before the boot step's verdict is `unmeasured` (fail closed), so the first non-coherent verdict is a report of its own.
    if (v.kind !== 'coherent' && (first || was === 'coherent')) for (const l of this.refusing) this.call(l);
  }

  /** Input 2 (PR B): a witness off the volume holds a higher epoch, or another head at a sequence this server holds. */
  witnessRefused(cause: 'witness-epoch' | 'witness-heads'): void {
    if (this.st.kind !== 'rolled-back') this.move({ kind: 'rolled-back', cause });
  }

  /** Input 2b (PR B): the server's own facts could not be read when a witness was judged (the journal, or the privacy head). A
   *  coherent guard moves to `unmeasured` with that why; any other state stays as it is. */
  witnessUnmeasured(why: 'journal' | 'privacy-head'): void {
    if (this.st.kind === 'coherent') this.move({ kind: 'unmeasured', why });
  }

  /** Input 3: the writer's failure at or after the append, or a head mismatch it measured (F1). A read it could not make moves
   *  a coherent guard to `unmeasured`, keeping the word of what it could not read (`journal` or `rows`, review F6; X3b), and
   *  leaves any other state as it is; every other cause moves a coherent or unmeasured guard to `rolled-back` with that cause,
   *  and leaves a rollback as it is. */
  writerFailed(cause: AuthorityWriterFailure): void {
    if (Object.hasOwn(AUTHORITY_UNREADABLE, cause)) {
      if (this.st.kind === 'coherent') this.move({ kind: 'unmeasured', why: AUTHORITY_UNREADABLE[cause as AuthorityUnreadable] });
      return;
    }
    if (this.st.kind !== 'rolled-back') this.move({ kind: 'rolled-back', cause: cause as Exclude<AuthorityWriterFailure, AuthorityUnreadable> });
  }

  /** Input 4 (PR C): after the Confirm transaction commits. It lowers nothing on the ladder: the `restore-detected` latch stands
   *  until the operator clears it (F4). */
  confirmed(): void {
    this.st = { kind: 'coherent' };
  }

  /** Re-runs the boot step's heal and coherence when the state is `unmeasured`, at most once a call, by the door that reads it,
   *  so a boot that met a transient read error recovers without a restart, and a torn tail a restart would have healed is healed
   *  here too rather than read `malformed` (review F4). Never when `coherent` or `rolled-back`. */
  remeasure(): void {
    if (this.st.kind !== 'unmeasured') return;
    this.journal.healTornTail();
    this.st = this.journal.measure();
  }
}

/** What the boot step found: the heal's outcome and the verdict the guard now holds. */
export interface OverlordAuthorityBoot { heal: AuthorityHeal; verdict: CoherenceVerdict }

/** The boot step, before the HTTP server: heal a torn tail by the kernel's rule, then measure Table 7.6a, record the verdict in
 *  the guard, and log one line naming it. It never refuses the boot. Raising the ladder's `restore-detected` latch on a refusing
 *  verdict is PR B's (the ladder is not on `main` yet: `restore-detected-latch-waits-for-the-ladder`). */
export function runOverlordAuthorityBoot(
  journal: AuthorityBootPort, guard: OverlordAuthorityGuard, warn: (line: string) => void,
): OverlordAuthorityBoot {
  const heal = journal.healTornTail();
  const verdict = journal.measure();
  guard.bootVerdict(verdict);
  if (heal.kind === 'healed') warn(`ccrc-server: the Overlord authority journal's torn tail was kept aside as ${heal.name} and cut`);
  if (heal.kind === 'cut-failed') warn(`ccrc-server: the Overlord authority journal's torn-tail cut failed (${heal.error})`);
  const word = verdict.kind === 'coherent' ? 'coherent'
    : verdict.kind === 'rolled-back' ? `rolled-back: ${verdict.cause}` : `unmeasured: ${verdict.why}`;
  const after = verdict.kind === 'coherent' ? '' : verdict.kind === 'rolled-back'
    ? '; every widening refuses until Confirm the restore' : '; every widening refuses until it can be read';
  warn(`ccrc-server: the Overlord authority journal reads ${word}${after}`);
  return { heal, verdict };
}
