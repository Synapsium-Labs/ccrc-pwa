/**
 * What each subagent is DOING — read from the launch record Claude Code
 * already wrote, joined to the hook's roster on `agent_id`.
 *
 * WHY THIS EXISTS. `FleetSession.subagents[].name` is the hook's
 * `.agent_name // .subagent_name // .agent_type // "subagent"` ladder, and the
 * first two keys are not in the shipped schema — so `name` is always the agent
 * TYPE. Measured on a live box: one session carrying five rows all reading
 * `workflow-subagent`. The count was real and the names carried nothing.
 *
 * WHAT IS READ, AND WHAT IS NOT. Claude Code writes
 * `<transcript-dir>/<uuid>/subagents/agent-<agent_id>.meta.json`, ~137 bytes,
 * carrying `{agentType, description, toolUseId, parentAgentId, spawnDepth}`.
 * That file is read. The sibling `agent-<id>.jsonl` — the subagent's own
 * transcript — is NEVER read: measured p50 857 KB and max 48 MB across this
 * box, and `transcript/tail.ts` already records what reading transcripts whole
 * cost once (~1.9 GB agent RSS).
 *
 * WHAT STILL CANNOT BE KNOWN. A per-subagent working/blocked/waiting state.
 * The launch record has no status field, `SubagentStart` carries only
 * `{agent_id, agent_type}`, and a subagent's own question surfaces as the
 * PARENT's `ask` because the hook identifies a session by tmux window name.
 * A state glyph here would be invented, and the existing refusal
 * (`SessionLine.tsx`'s comment and its two-children pin) stands.
 */
import path from 'node:path';
import type { FleetIO } from './io.js';

/** What one launch record says. Only the two fields anything reads. */
export interface LaunchRecord {
  agentType: string | null;
  description: string | null;
}

/**
 * The result of trying to read one. TWO ARMS, NOT THREE.
 *
 * `absent` is deliberately NOT a member — but the REASON has changed, and the
 * old one is no longer true. This docstring used to say the port could not
 * supply the distinction and that the arm could be earned "when `FleetIO`
 * grows a measured read for this path". It has one: `readFileMeasured`
 * (`io.ts`) answers `MeasuredRead`, and both sides implement it honestly —
 * `localIO` maps ENOENT alone to `absent`, and the agent lane reports a
 * `forbidden` path as `unreadable`, never as absent. Main's wave 8 built that;
 * leaving the sentence standing would have made a shipped comment argue from a
 * limitation the tree had removed.
 *
 * The fold stays anyway, and on its own merits: on THIS path an ENOENT is
 * genuinely ambiguous. `agent-<id>.meta.json` is missing both when the harness
 * never wrote one AND when the resolver's winning transcript has no sidecar
 * directory YET — the record lands after the launch, and a sweep can arrive in
 * between. An `absent` arm here would read as "this subagent has no record",
 * and a caller acting on it would give up on strike one and blank the
 * description of every subagent whose record simply had not landed. So the two
 * conditions are folded ON PURPOSE, and what bounds the cost is the retry
 * budget in `describeSubagents`, not a distinction this read cannot honestly
 * make about intent.
 */
export type LaunchRead =
  | { found: true; record: LaunchRecord }
  | { found: false };

/**
 * `<dir>/<uuid>.jsonl` → `<dir>/<uuid>/subagents`.
 *
 * DERIVED FROM THE RESOLVER'S WINNING PATH, never re-munged from the workdir.
 * `resolveTranscript` walks a six-rung ladder and rungs 5 and 6 can land in a
 * DIFFERENT account's configDir; recomputing the munge here would rebuild the
 * path the resolver rejected, and read somebody else's subagents or nothing.
 */
export function sidecarDirFor(transcriptPath: string): string {
  const dir = path.dirname(transcriptPath);
  const base = path.basename(transcriptPath).replace(/\.jsonl$/, '');
  return path.join(dir, base, 'subagents');
}

/** A launch record is ~137 bytes; this bound is three orders of magnitude of
 *  headroom and exists so a wrong path can never pull a transcript into
 *  memory. */
export const LAUNCH_MAX_BYTES = 4096;

export async function readLaunchRecord(
  io: FleetIO, sidecarDir: string, agentId: string,
): Promise<LaunchRead> {
  const raw = await io.readFile(path.join(sidecarDir, `agent-${agentId}.meta.json`));
  if (raw === null || raw.length > LAUNCH_MAX_BYTES) return { found: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { found: false };
  }
  if (typeof parsed !== 'object' || parsed === null) return { found: false };
  const o = parsed as Record<string, unknown>;
  const description = typeof o['description'] === 'string' && o['description'].trim() !== ''
    ? o['description'].trim() : null;
  const agentType = typeof o['agentType'] === 'string' && o['agentType'] !== ''
    ? o['agentType'] : null;
  // A record that parsed but describes nothing is not a find: the caller would
  // cache it forever and never look again, and there is nothing to show.
  if (description === null && agentType === null) return { found: false };
  return { found: true, record: { agentType, description } };
}
