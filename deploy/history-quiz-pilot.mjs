// deploy/history-quiz-pilot.mjs: the replay quiz's pilot, stage B (Overlord W1a; the note
// docs/superpowers/programs/overlord/quiz-pilot-stage-b.md). The pure rules the single-arm module
// (history-quiz-single.mjs) and the unattended runner (history-quiz-unattended.mjs) share about a pilot, kept out of the
// replay driver (history-replay.mjs), which sits at its growth cap:
//   - B0, a pilot's key: what can change a pilot's outcome, the Claude Code build the driver measures (its `--version` line)
//     and the gate's code hash as the gate computes it (codeShas over CODE_SHA_FILES). The runner pilots a week again only on
//     a key no pilot of that week has run on; the release tag is no longer the key.
//   - B1, the skill: the shipped history skill's files, read from the installed tree and pinned by their sha, staged into a
//     treatment-arm run's own working folder as a project skill (`.claude/skills/ccrc-history/`), which the driver removes
//     with that folder. A source missing or changed since it was pinned refuses with a word of its own.
//   - B2, the fallback probe: when, and only when, the skill check is the only failing check under restricted, one more probe
//     runs under the fallback mode and records whether the skill is listed there. The verdict stays restricted's.
//   - B3, the plugins-off map: composed from the entries the pilot's first run reported that are not the build's own, one
//     `enabledPlugins` value with each entry off, passed to every later run; a source that is not a plain name, one `@` and a
//     plain marketplace name is put in no argument and fails the plugins check.
//   - B4, the persistence proof: a run that left something passes the persistence check only when all it left is under its own
//     project folder, no main transcript exists, the walk of it is complete, and the sweep's own ingest decision answers, for
//     every regular file found, that the store cannot read it.
//
// L1 rules with two small adapters beside them (B1's source read and staging write, B4's known-id read), each named. It imports
// nothing from the single-arm module, and from the replay driver only pure readers, so no import cycles back.
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, decideAgentIngest, sha256Hex } from '../ccd/history/lib.mjs';
import { knownUuids } from '../ccd/history/sweep.mjs';
import { pluginClassOf, projectSlugOf } from './history-replay.mjs';

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

// ── B1: the skill, staged as a project skill ─────────────────────────────────────────────────────────────────────────
/** The shipped history skill's folder in the installed tree, and its files, as ccd/install-history-skill.sh installs them
 *  (its REQUIRED_FILES: the skill and the license sidecar it is derived under). */
export const HISTORY_SKILL_SOURCE = 'ccd/history-skill';
export const HISTORY_SKILL_FILES = Object.freeze(['SKILL.md', 'LICENSE.lossless-claw']);
/** Where a run finds it: a project skill in the run's own working folder. */
export const STAGED_SKILL_DIR = '.claude/skills/ccrc-history';
/** The most bytes one skill file may hold; past it the source is unmeasured, never truncated. */
const SKILL_FILE_MAX = 1_048_576;
/** The words of B1: the source could not be read when pinned or when staged, or its bytes changed since they were pinned. */
export const SKILL_WORDS = Object.freeze(['skill-source-unmeasured', 'skill-source-moved']);

/** The skill's files under `root` (the installed tree), read without following a link, each a regular file within its bound:
 *  `{state: 'value', files: {name: Buffer}, sha256}` (sha256 over the canonical map of each file's sha256), or `{state:
 *  'unmeasured', detail}`. The one reader of the source: the pin and every staging read it. An adapter (L3).
 *  @param {string} root */
export function skillSourceOf(root) {
  const files = {};
  for (const name of HISTORY_SKILL_FILES) {
    const at = path.join(root, HISTORY_SKILL_SOURCE, name);
    let fd = null;
    try {
      fd = openSync(at, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const st = fstatSync(fd);
      if (!st.isFile()) return { state: 'unmeasured', detail: `${HISTORY_SKILL_SOURCE}/${name} is not a regular file` };
      if (st.size > SKILL_FILE_MAX) return { state: 'unmeasured', detail: `${HISTORY_SKILL_SOURCE}/${name} is over ${SKILL_FILE_MAX} bytes` };
      const b = Buffer.alloc(st.size);
      let n = 0;
      while (n < b.length) { const r = readSync(fd, b, n, b.length - n, n); if (r === 0) break; n += r; }
      if (n !== b.length) return { state: 'unmeasured', detail: `${HISTORY_SKILL_SOURCE}/${name} changed while it was read` };
      files[name] = b;
    } catch (e) {
      return { state: 'unmeasured', detail: `${HISTORY_SKILL_SOURCE}/${name} is ${e?.code === 'ENOENT' ? 'absent' : `unreadable ${e?.code ?? 'error'}`}` };
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }
  const sha256 = sha256Hex(canonicalJson(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha256Hex(b)]))));
  return { state: 'value', files, sha256 };
}
/** One staging: the source read again, checked against the sha pinned at the act's start, then written into `cwd` (a run's
 *  fresh working folder, which the driver removes after the run). Answers null when staged, else `{word, detail}`, one of
 *  SKILL_WORDS, and writes nothing. An adapter (L3): it writes only under `cwd`, never over an existing file.
 *  @param {string} root  @param {string} pinned  @param {string} cwd */
export function stageSkillInto(root, pinned, cwd) {
  const src = skillSourceOf(root);
  if (src.state !== 'value') return { word: 'skill-source-unmeasured', detail: src.detail };
  if (src.sha256 !== pinned) return { word: 'skill-source-moved', detail: `the skill's files hash to ${src.sha256}, pinned ${pinned} at this act's start` };
  const dir = path.join(cwd, STAGED_SKILL_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of Object.entries(src.files)) writeFileSync(path.join(dir, name), bytes, { mode: 0o600, flag: 'wx' });
  return null;
}

// ── B2: the fallback probe ───────────────────────────────────────────────────────────────────────────────────────────
/** Whether the pilot makes its one fallback probe: under restricted, when the skill check is the only failing check and none
 *  is unmeasured. Pure.  @param {string} settingsMode  @param {{ failed: string[], unmeasured: string[] }} verdict */
export function fallbackProbeDueOf(settingsMode, verdict) {
  return settingsMode === 'restricted' && verdict.failed.length === 1 && verdict.failed[0] === 'skill' && verdict.unmeasured.length === 0;
}
/** What the fallback probe recorded about the skill, from the driver's own skill check over its one run (initChecksOf's
 *  `skill` state): `listed`, `not-listed`, or `unmeasured` when its run gave no skills list. Pure.  @param {string} state */
export function fallbackSkillOf(state) {
  return state === 'pass' ? 'listed' : state === 'fail' ? 'not-listed' : 'unmeasured';
}

// ── B3: the plugins-off map ──────────────────────────────────────────────────────────────────────────────────────────
/** A plugin source the map may switch off: a plain name, one `@`, a plain marketplace name. */
const PLUGIN_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** The map, from the pilot's first run alone: `observed` false when that run gave no init or no plugins list (then nothing is
 *  switched off); `off`, each reported entry that is not the build's own (pluginClassOf) and whose source is plain, set to
 *  false; `refused`, each such entry whose source is not, by its reported name and source, which no argument carries. Pure.
 *  @param {{ plugins: unknown[] | null } | null} init */
export function pluginsOffOf(init) {
  if (init === null || !Array.isArray(init.plugins)) return { observed: false, off: {}, refused: [] };
  const off = {};
  const refused = [];
  for (const p of init.plugins) {
    if (pluginClassOf(p) === 'build') continue;
    const source = plainObject(p) && typeof p.source === 'string' ? p.source : null;
    if (source !== null && PLUGIN_SOURCE_RE.test(source)) off[source] = false;
    else refused.push({ name: plainObject(p) && typeof p.name === 'string' ? p.name : null, source });
  }
  return { observed: true, off, refused };
}
/** The one settings value the map passes, or undefined when it switches nothing off (the argv then stays the mode's). Every
 *  key must be a plain source set to false, or the map is no map: a recorded map read back from a file is checked here
 *  again, so a damaged one never reaches an argument (a TypeError for the caller to refuse). Pure. */
export function pluginsOffSettingsOf(map) {
  const off = plainObject(map) && plainObject(map.off) ? Object.entries(map.off) : null;
  if (off === null || !off.every(([k, v]) => PLUGIN_SOURCE_RE.test(k) && v === false)) throw new TypeError('pluginsOffSettingsOf: not a plugins-off map');
  return off.length === 0 ? undefined : { enabledPlugins: Object.fromEntries(off) };
}
/** The plugins check of the runs made with the map: the driver's check (every entry the build's own, over those runs), failed
 *  too when the map refused an entry, recording whether the map was passed and what it refused. Pure.
 *  @param {{ state: string }} base  initChecksOf's plugins check  @param {ReturnType<typeof pluginsOffOf>} map */
export function pluginsCheckWithMapOf(base, map) {
  return { ...base, state: map.refused.length > 0 ? 'fail' : base.state, map_passed: pluginsOffSettingsOf(map) !== undefined, map_refused: map.refused };
}

// ── B4: the persistence proof ────────────────────────────────────────────────────────────────────────────────────────
/** The sweep's own known ids (knownUuids over the store's read handle and the registry under `home`), or null when they cannot
 *  be read: an unmeasured set proves nothing. An adapter (L3).  @param {object} db  @param {string} home */
export function knownIdsOf(db, home) {
  try { return knownUuids(db, home); } catch { return null; }
}
/** Whether the sweep's ingest decision, asked with every other gate open, could read the regular file at `rel` (relative to
 *  projects/): a file under `<slug>/<session>/…` is a subagent file of that session, read by a tick or an import only when its
 *  parent is known; a file anywhere else is not one the decision covers, so it counts as readable (unproven). Pure. */
function storeCouldRead(rel, slug, known) {
  const parts = rel.split('/');
  if (parts[0] !== slug || parts.length < 3) return true;
  const ask = (form, preInstall) => decideAgentIngest({ historyOff: false, pause: null, admitted: true, parentKnown: known.has(parts[1]), form, armed: true, preInstall });
  return ask('tick', false) || ask('import', true);
}
/** A persistence row with B4's proof added: a measured `left` row gets `proof`, each of its four conditions recorded, and
 *  `passed` only when all hold (a leftover holding no regular file needs the first three alone); a clean row and an unmeasured
 *  one come back as they are. `known` is knownIdsOf's answer. Pure.
 *  @param {object} row  persistenceMeasured's  @param {{ cwd: string, sessionId: string | null, known: Set<string> | null }} o */
export function persistenceProofOf(row, { cwd, sessionId, known }) {
  if (row.unmeasured !== undefined || row.left !== true || !plainObject(row.shape)) return row;
  const slug = projectSlugOf(cwd);
  const files = Array.isArray(row.shape.files) ? row.shape.files : [];
  const ownFolder = row.project_dir === true && row.transcripts.every((t) => t === slug || t.startsWith(`${slug}/`));
  const noMain = !files.some((f) => f.split('/').length === 2 && f.endsWith('.jsonl')) && !row.transcripts.some((t) => path.basename(t) === `${sessionId}.jsonl`);
  const walkComplete = row.shape.truncated === false && row.shape.unmeasured === undefined && Array.isArray(row.shape.files);
  const readable = files.length === 0 || known === null ? [] : files.filter((f) => storeCouldRead(f, slug, known));
  const storeCannotRead = files.length === 0 ? null : known === null ? 'unmeasured' : readable.length === 0;
  const passed = ownFolder && noMain && walkComplete && (files.length === 0 || storeCannotRead === true);
  return { ...row, proof: { own_folder: ownFolder, no_main_transcript: noMain, walk_complete: walkComplete, store_cannot_read: storeCannotRead,
    files: files.length, readable, passed } };
}
