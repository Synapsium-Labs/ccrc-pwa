import type { DesignationRead } from '../../../shared/overlord-designation.js';
import { designationFactFrom, type DesignationFact } from '../roleOf.js';

/** L4 delivery, context C3: the mail sweep's one read of the designation a pass, and the episode of its being unreadable
 *  (plan 2026-11-14 w1-designation Task 3, review M9). A read that fails answers `'unmeasured'`, which the sweep fails
 *  closed on (a pace read as `plain` for the Overlord would deliver at a coordinator's pace, and no other value is safe).
 *  The first unmeasured read of an episode logs once and raises one operator push; a read that succeeds ends the episode,
 *  so the next failure raises again. The memory is bookkeeping across sweeps, never a decision's durable state. */
export class DesignationEpisode {
  private open = false;

  observe(read: () => DesignationRead, raise: (why: string) => void): DesignationFact | 'unmeasured' {
    let r: DesignationRead;
    try { r = read(); } catch (e) { r = { kind: 'unmeasured', why: e instanceof Error ? e.message : String(e) }; }
    const fact = designationFactFrom(r);
    if (fact !== 'unmeasured') { this.open = false; return fact; }
    if (!this.open) {
      this.open = true;
      const why = r.kind === 'unmeasured' ? r.why : 'unreadable';
      console.warn(`ccrc-server: mail sweep: the Overlord designation could not be read (${why}); no mail is delivered until it can`);
      raise(why);
    }
    return 'unmeasured';
  }
}
