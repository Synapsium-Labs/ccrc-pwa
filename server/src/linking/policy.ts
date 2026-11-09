// The linking standard's deciders (D-8147). L1: pure; every rule about the convention is decided here and nowhere
// else. A private repository carries the ticket id; a public or unmeasured one never does.
import { LINEAR_TEAM_KEY_SHAPE } from '../../../shared/linear.js';
import type { LinkingMode, LinkingOverride, LinkingWriteBody, ProjectLinkingWire } from '../../../shared/linking.js';

/** A visibility reading is kept this long before the sweep takes another. */
export const VISIBILITY_MAX_AGE_MS = 24 * 3_600_000;

/** Which rule applies: the override wins; a measured private/internal repository is private, public is public; nothing measured is unknown. */
export function linkingMode(override: LinkingOverride | null, measured: ProjectLinkingWire['measured']): LinkingMode {
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

/** The project to measure next: a never-measured one first, then the oldest reading at least 24 h old, else null. */
export function visibilityDue(rows: readonly { project: string; at: number | null }[], now: number): string | null {
  const never = rows.find((r) => r.at === null);
  if (never) return never.project;
  let best: { project: string; at: number } | null = null;
  for (const r of rows) {
    if (r.at === null || now - r.at < VISIBILITY_MAX_AGE_MS) continue;
    if (best === null || r.at < best.at) best = { project: r.project, at: r.at };
  }
  return best ? best.project : null;
}
