// The spawn verdict's WORDS — one table, for every surface that renders how a
// session's last spawn ended.
//
// It lived inside `SessionLine.tsx` until Task 5 (spawn visibility), private on
// the stated grounds that "it has no reader outside this file". That premise
// expired the moment the run board — which already holds the whole
// `FleetSession` for every row it links, and already reuses `.sess-unmeasured`
// verbatim rather than minting a `.run-…` twin for the same fact — started
// rendering the same verdict. Moving it is not a generalisation for its own
// sake: this file exists so there is exactly ONE answer to "what does this
// build call a `blocked` spawn", and one answer to the harder question below,
// which is what a build does with a verdict it has never heard of.
//
// This is NOT the L0 vocabulary. `SPAWN_VERDICTS` (`shared/api.ts`) is the
// state space; this is one presentation of it, and the two are deliberately
// different lists — `ready` has a member there and no word here.
import type { FleetSession, SpawnVerdict } from '../../../shared/api';

/** The verdict's DISPLAYED word, or `null` for a verdict with nothing to say.
 *
 *  `expired -> 'unconfirmed'` and its quiet ink are deliberate: a systemd
 *  restart of a large session legitimately settles unconfirmed, and painting a
 *  healthy row dead-red trains the operator to ignore the chip. `ready -> null`
 *  because a healthy row has nothing to qualify — and it is a MEMBER with a
 *  null word rather than a case handled before the lookup, so "a healthy spawn
 *  says nothing" is stated in the table that holds every other verdict's word
 *  instead of in a condition beside it. */
const SPAWN_WORD: Record<SpawnVerdict, string | null> = {
  ready: null,
  login: 'login',
  vanished: 'vanished',
  expired: 'unconfirmed',
  blocked: 'blocked',
  unrecognised: 'unknown',
};

/** How many characters of an unnameable verdict a chip will show. `.sess-spawn`
 *  is `flex: none`, so it takes whatever length it is handed and squeezes
 *  `.sess-held` — the one shrinkable cell in the row — out of the way. The token
 *  is untrusted text off the socket; React escapes it, so this is a LAYOUT bound,
 *  not an injection one. Every real member is under 12. */
const UNNAMEABLE_MAX = 18;

/** §1.7's render-seam rule, in one place: a value this build cannot NAME is shown
 *  as ITSELF, prefixed so the operator can tell "the fleet said something this
 *  app is too old to translate" from any word the app chose. Never a member of
 *  `SpawnVerdict`, and never nothing.
 *
 *  The parameter is `unknown` because that is the truth: the field is CAST off
 *  the wire, so a newer server's value need not even be a string. */
function unnameableVerdict(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? '? unnameable' : `? ${s.slice(0, UNNAMEABLE_MAX)}`;
}

/** What a chip renders: the word the operator reads, and the RAW token behind
 *  it. Both, because they are different things — `data` is what actually
 *  arrived off the socket and drives the CSS hook and the tooltip, so an
 *  unknown token simply matches no rule and takes the loud default ink, which
 *  is the correct degrade direction. */
export interface SpawnChip { word: string; data: string }

/**
 * ONE chip for one session, or `null` for a session with nothing to say about
 * its last spawn.
 *
 * THE RULE IS NOT "chip on anything not ready": `null` satisfies "not ready",
 * and `null` is what every healthy live session carries, so that rule would
 * light a warning on every row in the fleet. A session with NO spawn stamp at
 * all is real (`swift-harbor`, measured) and `started === false` is the only
 * signal that shape emits, which is why the second arm is not optional.
 *
 * Both fields read DEFENSIVELY (`?? null`, `!== false`): the live `fleet` frame
 * is CAST, not revived (`stores/fleet.ts`'s `asFleetMsg` validates frames, not
 * members), so an older server's row lacks the keys at runtime.
 *
 * A DEAD row is silent. Nothing is running, so how the last spawn ended
 * describes work that no longer exists — the same exemption `critical` and the
 * subagent list already take.
 *
 * THE TABLE LOOKUP IS `Object.hasOwn`, NOT `?? null` (§1.7, and the defect it
 * fixed): `SPAWN_WORD[v] ?? null` was reached by exactly one input — a verdict a
 * NEWER server sent that this bundle was compiled without — and it rendered NO
 * CHIP, byte for byte the healthy row. A verdict the operator was meant to see
 * vanished BECAUSE it was new, and the two deploy lanes (`deploy.sh` server vs
 * agent, no version handshake between them) make that window real rather than
 * theoretical. `?? null` also could not tell that case from a member whose word
 * is deliberately `null`, so the next silent member added would have rendered
 * `? <token>` instead of nothing — the same collapse one level down.
 * `unrecognised` would be the wrong member to borrow for either: it means the
 * SERVER could not name ccd's rc, one layer in from "this CLIENT cannot name
 * the server's word".
 */
export function spawnChip(session: FleetSession): SpawnChip | null {
  if (session.status === 'dead') return null;
  const spawnState = session.spawnState ?? null;
  const word: string | null =
    spawnState === null
      ? null
      // The cast is the honest one: TS believes this lookup is total, and the
      // whole point is that at runtime it is not.
      : Object.hasOwn(SPAWN_WORD, spawnState as string)
        ? (SPAWN_WORD as Record<string, string | null>)[spawnState as string] ?? null
        : unnameableVerdict(spawnState);
  if (word !== null) return { word, data: spawnState as string };
  if (session.started === false) return { word: 'unstarted', data: 'unstarted' };
  return null;
}
