// deploy/history-quiz-pilot.mjs: the replay quiz's pilot, stage B (Overlord W1a; the note
// docs/superpowers/programs/overlord/quiz-pilot-stage-b.md). The pure rules the single-arm module
// (history-quiz-single.mjs) and the unattended runner (history-quiz-unattended.mjs) share about a pilot, kept out of the
// replay driver (history-replay.mjs), which sits at its growth cap:
//   - B0, a pilot's key: what can change a pilot's outcome, the Claude Code build the driver measures (its `--version` line)
//     and the gate's code hash as the gate computes it (codeShas over CODE_SHA_FILES). The runner pilots a week again only on
//     a key no pilot of that week has run on; the release tag is no longer the key.
//
// L1: pure, no I/O. It imports nothing from the replay driver or the single-arm module, so neither import cycles back.
import { canonicalJson } from '../ccd/history/lib.mjs';

const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;

// ── B0: a pilot's key ────────────────────────────────────────────────────────────────────────────────────────────────
/** Whether `k` is a pilot key: `claude_code`, a non-empty `--version` line, and `code_shas`, a non-empty map of file path to a
 *  sha256 hex (codeShas' `files`). Anything else is no key, so a damaged record never matches one. Pure.
 *  @param {unknown} k  @returns {boolean} */
export function pilotKeyValid(k) {
  if (!plainObject(k) || Object.keys(k).sort().join(',') !== 'claude_code,code_shas') return false;
  if (typeof k.claude_code !== 'string' || k.claude_code === '' || !plainObject(k.code_shas)) return false;
  const files = Object.entries(k.code_shas);
  return files.length > 0 && files.every(([f, s]) => f !== '' && typeof s === 'string' && HEX64.test(s));
}
/** A pilot's key from what the driver measures: the build's `--version` line and codeShas' answer. null when either is not
 *  measured, so an unmeasured key is never a key. Pure.
 *  @param {unknown} version  @param {unknown} code  codeShas' answer, `{ state: 'measured', files }` or not
 *  @returns {{ claude_code: string, code_shas: Record<string, string> } | null} */
export function pilotKeyOf(version, code) {
  if (!plainObject(code) || code.state !== 'measured') return null;
  const k = { claude_code: version, code_shas: code.files };
  return pilotKeyValid(k) ? { claude_code: version, code_shas: { ...code.files } } : null;
}
/** Two keys are one key when their canonical bytes are equal. Pure.  @param {unknown} a  @param {unknown} b */
export function sameKey(a, b) {
  return pilotKeyValid(a) && pilotKeyValid(b) && canonicalJson(a) === canonicalJson(b);
}
