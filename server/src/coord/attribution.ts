import type { CcrcConfig } from '../config.js';
import type { FleetIO } from '../io.js';
import { measuredIdentity, readSessionRecord } from '../registry.js';
import type { AttributionRead } from './openRun.js';

/**
 * The box-token lanes' sender check: is `{whoId, whoUuid}` a session the registry knows, with its current uuid?
 * Moved whole out of `registerCoordRoutes` (#1444, spec §6.2), where it was a closure over `deps.io` and
 * `deps.cfg`; those two are its first parameters now, and nothing else changed. Its callers: the routes'
 * `requireAttribution` and `POST /api/runs`' `attribute` gate in `coord/routes.ts`.
 *
 * The claim lanes' attribution gate — the mail ingress's checks 5/5.5/6 with
 * the SAME transient-vs-terminal split (D-37), factored because both claim
 * writes are new in this build and share it exactly. NOT `refuse()`: a claim
 * refusal is answered synchronously to a live caller and replayed by
 * nothing, so there is no delivery lane needing a recorded rejection to
 * explain itself — the claims table itself is the record of every
 * acquisition that happened.
 *
 * `uuidField` (Task 9 fix round 1) names the body field THIS CALLER's
 * request actually carries — `'byUuid'` for the claim lanes, `'fromUuid'`
 * for `POST /api/questions/ask-<n>/rule` — so the `stale-uuid` detail can tell a
 * caller which of ITS OWN fields to re-read. Before this, the prose was a
 * literal `'byUuid does not match...'` no matter who called it: an ask
 * caller, whose body has no `byUuid` field at all, was told to fix a field
 * it never sent. The wording is ALSO caller-agnostic now ("sender", not
 * "claimant") — this gate has two callers with two different verbs for
 * what they are doing, and "claimant" is only true of one of them.
 */
export async function attributionVerdict(
  io: FleetIO, cfg: CcrcConfig,
  whoId: string, whoUuid: string, uuidField: 'byUuid' | 'fromUuid' | 'claimedByUuid' | 'sessionUuid',
): Promise<AttributionRead> {
  // Console speed S2: the sender's ONE row (a listing plus that row's field reads), not the whole registry's.
  // `readSessionRecord` keeps the three-way split `readRegistryMeasured` drew, narrowed to one id; a `found` row may
  // still carry an unmeasured identity, which `measuredIdentity` below reads as unmeasurable, never as a stale uuid.
  const read = await readSessionRecord(io, cfg, whoId);
  switch (read.kind) {
    case 'unlistable':
      return { ok: false, error: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed — transient, not a fact about the sender' };
    case 'unmeasurable':
      return { ok: false, error: 'registry-unmeasurable',
        detail: `registry row for ${whoId} is listed but unreadable — transient, not a fact about the sender` };
    case 'absent':
      return { ok: false, error: 'unknown-sender', detail: `no registry row for ${whoId}` };
    case 'bad-id': {
      // An id the registry refuses is never read as a row. One listing keeps the two answers this check always gave
      // for it: a file named `<id>.uuid` that IS listed is a row the registry will not hand out (unmeasurable), and
      // an unlisted one is no sender at all.
      const names = await io.readdir(cfg.registryDir);
      if (names === null) {
        return { ok: false, error: 'registry-unmeasurable',
          detail: 'the registry directory could not be listed — transient, not a fact about the sender' };
      }
      if (names.includes(`${whoId}.uuid`)) {
        return { ok: false, error: 'registry-unmeasurable',
          detail: `registry row for ${whoId} is listed but unreadable — transient, not a fact about the sender` };
      }
      return { ok: false, error: 'unknown-sender', detail: `no registry row for ${whoId}` };
    }
    case 'found':
      break;
  }
  const row = read.record;
  const identity = measuredIdentity(row);
  if (identity === null) {
    return { ok: false, error: 'registry-unmeasurable',
      detail: `registry row for ${whoId} is listed but its identity could not be measured — transient` };
  }
  if (identity.uuid !== whoUuid) {
    return { ok: false, error: 'stale-uuid',
      detail: `${uuidField} does not match the registry — stale sender; re-read your own .uuid` };
  }
  return { ok: true };
}
