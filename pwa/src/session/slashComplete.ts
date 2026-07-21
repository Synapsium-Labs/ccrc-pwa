import type { SlashCommand } from '../../../shared/api';

/**
 * The command-name query the user is typing, or null when not in command mode.
 * Active only while the text is `/` + a run with no whitespace (once a space is
 * typed the command is chosen and its arguments follow).
 */
export function slashQuery(value: string): string | null {
  if (!value.startsWith('/')) return null;
  const rest = value.slice(1);
  if (/\s/.test(rest)) return null;
  return rest;
}

/**
 * Rank commands for the query. Prefix matches rank above mid-string matches;
 * built-ins rank above skills; within a tier the input order is preserved (so
 * compact / effort / model lead). Empty query → the leading built-ins. Max 8.
 */
export function filterCommands(all: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return all
    .map((c, i) => {
      const pos = c.name.toLowerCase().indexOf(q);
      if (pos < 0) return null;
      const score = (pos === 0 ? 0 : 10_000) + (c.kind === 'builtin' ? 0 : 5_000) + i;
      return { c, score };
    })
    .filter((x): x is { c: SlashCommand; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((x) => x.c);
}
