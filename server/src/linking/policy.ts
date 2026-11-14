// The linking standard's deciders (D-8147). L1: pure; every rule about the convention is decided here and nowhere
// else. A private repository carries the ticket id; a public or unmeasured one never does.
import { LINEAR_TEAM_KEY_SHAPE } from '../../../shared/linear.js';
import type { LinkingMode, LinkingOverride, LinkingWriteBody, ProjectLinkingWire } from '../../../shared/linking.js';
import { publicTextClassesFor } from './publicTextClasses.js';

/** A visibility reading is kept this long before the sweep takes another. */
export const VISIBILITY_MAX_AGE_MS = 24 * 3_600_000;

/** Which rule applies: a measured PUBLIC repository is public whatever the override says (a mis-chosen `private` never
 *  turns the id-writing acts on for a public repository); otherwise the override wins; a measured private/internal
 *  repository is private; nothing measured is unknown. */
export function linkingMode(override: LinkingOverride | null, measured: ProjectLinkingWire['measured']): LinkingMode {
  if (measured.state === 'measured' && measured.visibility === 'public') return 'public';
  if (override !== null) return override;
  if (measured.state !== 'measured') return 'unknown';
  return measured.visibility === 'public' ? 'public' : 'private';
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validKey = (k: string | null): k is string => k !== null && LINEAR_TEAM_KEY_SHAPE.test(k.toUpperCase());

/** `ws/key-123-x` → `KEY-123`: the team's ticket at the slug's start, in either case; null otherwise. */
export function ticketRefOfBranch(branch: string, teamKey: string | null): string | null {
  if (!validKey(teamKey)) return null;
  const m = new RegExp(`^(?:ws/)?${escapeRe(teamKey)}-(\\d+)(?:-|$)`, 'i').exec(branch);
  return m ? `${teamKey.toUpperCase()}-${m[1]}` : null;
}

/** The team's tracker ids in `text`, case-insensitive and as whole tokens, uppercased, first-seen order, no repeats. */
export function trackerIdsIn(text: string, teamKey: string | null): string[] {
  if (!validKey(teamKey)) return [];
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(teamKey)}-(\\d+)(?![A-Za-z0-9_])`, 'gi');
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const id = `${teamKey.toUpperCase()}-${m[1]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** `text` with the team's tracker ids taken out, line by line, and the punctuation they leave behind tidied
 *  (`fix (KEY-123) login` → `fix login`, `KEY-123: fix` → `fix`). No team key: the text unchanged. */
export function withoutTrackerIds(text: string, teamKey: string | null): string {
  if (trackerIdsIn(text, teamKey).length === 0) return text;
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(teamKey as string)}-\\d+(?![A-Za-z0-9_])`, 'gi');
  return text.split('\n').map((line) => {
    const bare = line.replace(re, '');
    if (bare === line) return line;
    return bare.replace(/\(\s*\)|\[\s*\]/g, '').replace(/(^|\s)[:;,]\s+/g, '$1')
      .replace(/(\S)[ \t]{2,}/g, '$1 ').replace(/\s+([,.:;])/g, '$1').replace(/[ \t]+$/, '');
  }).join('\n');
}

/** The operator's write body: exactly `teamKey` and `override`; a key in the Linear shape (uppercased) or null. */
export function parseLinkingWrite(body: unknown):
  { ok: true; write: LinkingWriteBody } | { ok: false; error: 'bad-team-key' | 'bad-override' | 'bad-request' } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'bad-request' };
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 2 || !('teamKey' in o) || !('override' in o)) return { ok: false, error: 'bad-request' };
  let teamKey: string | null = null;
  if (o.teamKey !== null) {
    if (typeof o.teamKey !== 'string' || !LINEAR_TEAM_KEY_SHAPE.test(o.teamKey.toUpperCase())) return { ok: false, error: 'bad-team-key' };
    teamKey = o.teamKey.toUpperCase();
  }
  if (o.override !== null && o.override !== 'private' && o.override !== 'public') return { ok: false, error: 'bad-override' };
  return { ok: true, write: { teamKey, override: o.override } };
}

/** A failed reading is taken again after this long, not after a day: a failure says nothing about the repository. */
export const VISIBILITY_RETRY_MS = 5 * 60_000;

/** The project to measure next: a never-measured one first, then the oldest reading that is due. A reading is due when it
 *  is 24 h old, or, if it failed, when it is `VISIBILITY_RETRY_MS` old; else null. */
export function visibilityDue(rows: readonly { project: string; at: number | null; failed?: boolean }[], now: number): string | null {
  const never = rows.find((r) => r.at === null);
  if (never) return never.project;
  let best: { project: string; at: number } | null = null;
  for (const r of rows) {
    if (r.at === null || now - r.at < (r.failed === true ? VISIBILITY_RETRY_MS : VISIBILITY_MAX_AGE_MS)) continue;
    if (best === null || r.at < best.at) best = { project: r.project, at: r.at };
  }
  return best ? best.project : null;
}

/** The path a text is read as by the hashed class: its exemptions key on a file, and plan text is nobody's file. */
const TEXT_FILE = 'plan-text';

/** D-8181 (design §4.3, §6.1): may this text reach a tracker? A `private` project's text passes; a `public` or `unknown`
 *  one (unmeasured is treated as public, as `linkingMode` does everywhere) is refused if it names one of the team's
 *  tracker ids (`trackerIdsIn`, the ids listed) or any topology class matches (the class named). A hashed hit names its
 *  class and `#h8`, never the text; the sentence the operator sees is the word's fixed one. Each line is read alone and each
 *  consecutive pair as a phrase broken across a line, as the tree scan reads a file. `privateKeys` are the installer's
 *  private tracker keys (`CCRC_PRIVATE_TRACKER_KEYS`), whose ids the tracker class refuses besides the team's own. */
export function publicTextVerdict(text: string, teamKey: string | null, mode: LinkingMode, privateKeys: readonly string[] = []):
  { ok: true } | { ok: false; word: 'linear-text-public'; class: string; ids?: string[] } {
  if (mode === 'private') return { ok: true };
  const ids = trackerIdsIn(text, teamKey);
  if (ids.length > 0) return { ok: false, word: 'linear-text-public', class: 'tracker id', ids };
  const lines = text.split('\n');
  for (const cls of publicTextClassesFor(privateKeys)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (cls.skipLine?.(line, TEXT_FILE)) continue;
      if (cls.match !== undefined) {
        const hits = [...cls.match(line, TEXT_FILE),
          ...(cls.matchPair !== undefined && i + 1 < lines.length ? cls.matchPair(line, lines[i + 1]!, TEXT_FILE) : [])];
        if (hits.length > 0) return { ok: false, word: 'linear-text-public', class: `${cls.name} #${hits[0]!}` };
        continue;
      }
      for (const m of line.matchAll(cls.pattern!)) {
        if (!cls.allowed?.(m[0])) return { ok: false, word: 'linear-text-public', class: cls.name };
      }
    }
  }
  return { ok: true };
}
