import type { Deps } from './server.js';
import { readRegistry } from './registry.js';
import { readLiveState } from './livestate.js';
import { resolveTranscript } from './transcript/resolve.js';
import { configDirFor } from './config.js';
import type { SlashCommand } from '../../shared/api.js';

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

/**
 * Parse the skills out of a Claude Code `skill_listing` attachment's markdown
 * content ("- name: description" lines). Names keep their `plugin:skill` form
 * (e.g. "superpowers:brainstorming"), which is exactly what `/`-invocation wants.
 */
export function parseSkillListing(content: string): SlashCommand[] {
  const out: SlashCommand[] = [];
  for (const line of content.split('\n')) {
    const m = SKILL_LINE.exec(line.trim());
    if (m) out.push({ name: m[1]!, desc: m[2]!.trim(), kind: 'skill' });
  }
  return out;
}

/** The `content` of the LAST skill_listing entry in a transcript, or '' if none. */
function lastSkillListing(jsonl: string): string {
  let content = '';
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"skill_listing"')) continue;
    try {
      const obj = JSON.parse(line) as { attachment?: { type?: string; content?: string } };
      if (obj.attachment?.type === 'skill_listing' && typeof obj.attachment.content === 'string') {
        content = obj.attachment.content;
      }
    } catch { /* skip malformed */ }
  }
  return content;
}

/** Built-ins plus the session's skills (from its transcript's skill_listing). */
export async function sessionCommands(deps: Deps, id: string): Promise<{ builtins: SlashCommand[]; skills: SlashCommand[] }> {
  const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
  if (!rec) return { builtins: BUILTINS, skills: [] };
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
    const jsonl = await deps.io.readFile(res.path);
    if (jsonl !== null) skills = parseSkillListing(lastSkillListing(jsonl));
  }
  return { builtins: BUILTINS, skills };
}
