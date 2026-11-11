// A session's Claude Code build in words (D-8276): the card's quiet `behind` marker, the header's build fact, and the
// Settings › Automation line that counts the sessions behind. The reading itself (the fleet's newest build, each row's
// place against it, the counts) is `shared/claudeVersion.ts`'s, the one the roll lane acts on; this file only words it.
import type { ClaudeBuildCounts, ClaudeRollTargets } from '../../../shared/claudeVersion';

/** The card's build: the patch alone (`.296`) when major and minor match the newest, the whole build otherwise. */
export function buildShort(build: string, latest: string): string {
  const [a, b, c] = build.split('.');
  const [x, y] = latest.split('.');
  return a === x && b === y && c !== undefined ? `.${c}` : build;
}

/** The header's fact for a session on the newest build. */
export const buildText = (build: string): string => `Claude Code ${build}`;

/** The behind marker: `cc .296 behind` on the card, the full pair in the header, and what happens next in `title`. */
export function behindFact(b: { readonly build: string; readonly latest: string }): { text: string; short: string; title: string } {
  return {
    text: `${buildText(b.build)} · behind ${b.latest}`,
    short: `cc ${buildShort(b.build, b.latest)} behind`,
    title: `Runs Claude Code ${b.build}; the newest build the fleet runs is ${b.latest}. Roll idle sessions restarts it onto `
      + 'that build once it is idle, resuming its conversation, unless the setting is off or it is opted out.',
  };
}

/** Settings › Automation › Roll idle sessions: how many sessions are behind, against which build, and what the setting
 *  does about it. Null when no build is measured (nothing to count against). */
export function rollIdleBuildLine(c: ClaudeBuildCounts, targets: ClaudeRollTargets | null): string | null {
  if (c.latest === null) return null;
  if (c.behind === 0) return `Every running session is on Claude Code ${c.latest}, the newest build the fleet runs.`;
  const lead = c.behind === 1 ? '1 session is behind: it runs' : `${c.behind} sessions are behind: they run`;
  const tail = targets === 'all' ? 'Each rolls onto it once it is idle.'
    : targets === 'coordinators' ? 'Only coordinators roll onto it once idle; the rest pick it up when they next start.'
      : targets === 'off' ? 'Nothing rolls while this is off.' : 'Nothing rolls until the setting can be read.';
  return `${lead} an older Claude Code build than ${c.latest}, the newest the fleet runs. ${tail}`;
}
