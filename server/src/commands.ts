import type { Deps } from './deps.js';
import type { FleetIO } from './io.js';
import { walkBack, wholeLines } from './backread.js';
import { readSessionRecord } from './registry.js';
import { readLiveState } from './livestate.js';
import { resolveTranscript } from './transcript/resolve.js';
import { configDirFor } from './configDir.js'; // D-5896: the pure join, not the config reader
import type { SlashCommand } from '../../shared/api.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';

/** Built-in slash commands, most-used first (compact / effort / model lead). */
export const BUILTINS: SlashCommand[] = [
  { name: 'compact', desc: 'Summarize the conversation to free up context', kind: 'builtin' },
  { name: 'effort', desc: 'Set reasoning effort — low / medium / high / xhigh / ultracode', kind: 'builtin' },
  { name: 'model', desc: 'Switch the model', kind: 'builtin' },
  { name: 'clear', desc: 'Start a fresh conversation (saves the current one)', kind: 'builtin' },
  { name: 'context', desc: 'Show context-window usage', kind: 'builtin' },
  { name: 'cost', desc: 'Show token cost for this session', kind: 'builtin' },
  { name: 'resume', desc: 'Resume a previous conversation', kind: 'builtin' },
];

const SKILL_LINE = /^-\s+(\S+):\s+(.+)$/;
/** A bare `- name` line: Claude Code trims descriptions under its budget (D-6434), and the skill is still invocable. */
const BARE_SKILL_LINE = /^-\s+(\S*[^\s:])$/;

/**
 * Parse the skills out of a Claude Code `skill_listing` attachment's markdown
 * content ("- name: description" lines, or a bare "- name" with an empty
 * description). Names keep their `plugin:skill` form (e.g.
 * "superpowers:brainstorming"), which is exactly what `/`-invocation wants.
 */
export function parseSkillListing(content: string): SlashCommand[] {
  const out: SlashCommand[] = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    const m = SKILL_LINE.exec(t);
    if (m) { out.push({ name: m[1]!, desc: m[2]!.trim(), kind: 'skill' }); continue; }
    const bare = BARE_SKILL_LINE.exec(t);
    if (bare) out.push({ name: bare[1]!, desc: '', kind: 'skill' });
  }
  return out;
}

/** One `skill_listing` attachment: a FULL listing (Claude Code's `isInitial`; absent counts as full) names every
 *  skill, a delta (`isInitial: false`) the few that changed since. A delta never removes a skill (measured). */
interface Listing { content: string; full: boolean }

const LISTING_MARK = Buffer.from('"skill_listing"');
/** How far back the scan reads: four chunks, about 1 MiB (listings recur and none is over about 40 KB). */
const LISTING_WINDOW: readonly number[] = [1, 2, 3, 4].map(() => READ_FROM_MAX_BYTES);

/** The listings among whole transcript lines, oldest first. A line that is not valid UTF-8 or JSON is skipped. */
function listingsIn(lines: readonly Uint8Array[]): Listing[] {
  const out: Listing[] = [];
  for (const raw of lines) {
    const line = Buffer.from(raw.buffer, raw.byteOffset, raw.length);
    if (!line.includes(LISTING_MARK)) continue;
    try {
      const obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)) as
        { attachment?: { type?: string; isInitial?: boolean; content?: unknown } };
      const a = obj.attachment;
      if (a?.type === 'skill_listing' && typeof a.content === 'string') out.push({ content: a.content, full: a.isInitial !== false });
    } catch { /* skip a line that will not decode or parse */ }
  }
  return out;
}

/** The skills the listings (oldest first) leave: the LAST full listing's, then each later delta's in order — a new
 *  name appends, a repeated name keeps its place and takes the newer description. Null when none is full. */
function answerOf(listings: readonly Listing[]): SlashCommand[] | null {
  let at = listings.length - 1;
  while (at >= 0 && !listings[at]!.full) at--;
  if (at < 0) return null;
  const byName = new Map<string, SlashCommand>();
  for (const l of listings.slice(at)) for (const c of parseSkillListing(l.content)) byName.set(c.name, c);
  return [...byName.values()];
}

/** The session's skills from the most recent full listing in a bounded tail of its transcript, then the deltas
 *  after it. Four chunks back from EOF; with no full listing there, the head's last one; a read that does not
 *  answer, or no full listing anywhere, is no skills. Never reads the file whole (an intended change from the
 *  last listing of any kind, D-6434). */
async function transcriptSkills(io: FleetIO, file: string): Promise<SlashCommand[]> {
  const st = await io.statMeasured(file);
  if (!st.ok) return [];
  const walk = walkBack(io, file, st.size, LISTING_WINDOW);
  let seen: Listing[] = []; // oldest first, grown at the front as the walk goes back
  let reachedHead = st.size === 0;
  while (walk.more()) {
    const r = await walk.next();
    if (!r.ok) return [];
    reachedHead = r.segment.start === 0;
    seen = [...listingsIn(wholeLines(r.segment)), ...seen];
    const found = answerOf(seen);
    if (found !== null) return found;
  }
  if (reachedHead) return []; // the walk read the whole file
  const head = await io.readFileFromBytesMeasured(file, 0, READ_FROM_MAX_BYTES);
  if (!head.ok) return [];
  // The head's last line is cut unless the read reached EOF.
  const end = head.bytes.length < READ_FROM_MAX_BYTES ? head.bytes.length : head.bytes.lastIndexOf(10) + 1;
  const lines = wholeLines({ bytes: head.bytes.subarray(0, end), cut: 0, start: 0 });
  return answerOf(listingsIn(lines)) ?? [];
}

/** Built-ins plus the session's skills (from its transcript's skill_listing). */
export async function sessionCommands(deps: Deps, id: string): Promise<{ builtins: SlashCommand[]; skills: SlashCommand[] }> {
  // One row, not the registry: every answer but `found` is "no row" here, as it was for the sweep's miss.
  const read = await readSessionRecord(deps.io, deps.cfg, id);
  if (read.kind !== 'found') return { builtins: BUILTINS, skills: [] };
  const rec = read.record;
  const cfgDir = configDirFor(deps.cfg, rec.wrapper);
  let cwd = rec.workdir;
  if (cfgDir && (await deps.tmux.hasSession(id))) {
    const pid = await deps.tmux.panePid(id);
    if (pid) {
      const live = await readLiveState(deps.io, cfgDir, pid);
      if (live?.cwd) cwd = live.cwd;
    }
  }
  let skills: SlashCommand[] = [];
  if (cfgDir) {
    // One-shot per HTTP request, so the bare ladder rather than a memo — and no
    // `foreign` for the same reason the name sweep passes none (§5.2). The
    // registry workdir is passed alongside the live cwd, which is what gains
    // this route rungs 3-5: a live session whose cwd moved into a worktree used
    // to list no skills at all.
    const res = await resolveTranscript(deps.io, {
      configDir: cfgDir, dir: cwd, registryWorkdir: rec.workdir, uuid: rec.uuid,
    });
    skills = await transcriptSkills(deps.io, res.path);
  }
  return { builtins: BUILTINS, skills };
}
