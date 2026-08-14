import type { Runner } from './exec.js';
import { parseCcdCaps } from '../../shared/agent-protocol.js';

/**
 * Local mode's own evidence for `stopSurfaceSupported` and every other
 * capability check `verbSupported` makes (fix round 3, task 14, Important
 * #3). Before this, local mode's `Deps.fleetState` was simply absent, so
 * every gated check answered off `ccdVerbs === null` — "no evidence,
 * permit" for an ordinary verb, which is safe (guessing wrong there is
 * LOUD: ccd's own usage refusal, a 502, never a lie) but, for `--surface`
 * specifically, the opposite guess is the safe one (see
 * `stopSurfaceSupported`'s own comment in `ccdargv.ts`) — and inverting
 * that default with no local evidence at all would have left the surface
 * feature permanently dead in local mode, the DEFAULT deployment mode
 * (`deploy/ccrc.env.example`'s own `CCRC_FLEET=local`).
 *
 * The fix the remote side already has does not need reinventing: the
 * binary is right there, on the same box, at `cfg.ccdBin`, and `ccd caps`
 * is a pure read (its own docstring in `ccd/ccd` says so) — one exec, at
 * boot, the exact shape `agent/src/server.ts`'s `readCcdVerbs` already
 * uses for the remote case. `parseCcdCaps` (`shared/agent-protocol.ts`) is
 * the SAME parser both readers call, so the two sides cannot drift on what
 * counts as a capability line.
 *
 * `null` — not `[]` — on any failure (nonzero exit, spawn error), matching
 * `readCcdVerbs`'s own "no evidence, not zero evidence" contract: a
 * missing or broken local `ccd` must not read as "zero capabilities",
 * which would refuse `--surface` (and every other gated verb, under the
 * ORDINARY null-permits policy those keep) for a reason that has nothing
 * to do with whether the box's ccd actually supports them.
 *
 * ONE exec, at startup — not re-probed on a timer the way the remote side
 * is (`refreshCaps`, `CAPS_REFRESH_MS`). A local ccd replaced without a
 * server restart (rare — this branch's `deploy.sh` never installs ccd for
 * the local/server target at all) reads stale evidence until the process
 * restarts; disclosed here rather than silently assumed away.
 */
export async function readLocalCcdCaps(run: Runner, ccdBin: string): Promise<string[] | null> {
  const r = await run(ccdBin, ['caps']);
  if (r.code !== 0) return null;
  return parseCcdCaps(r.stdout);
}
