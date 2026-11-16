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

/** The behind marker: `cc .296 behind` on the card, the full pair in the header, and what happens next in `title`. A
 *  restart reaches only the newest build on the session's own lane (`reach`, binary-lifecycle spec §2.2), so the title
 *  promises a roll only when there is one; a session its lane cannot move is told so. */
export function behindFact(b: { readonly build: string; readonly latest: string; readonly reach: string | null }): { text: string; short: string; title: string } {
  const lead = `Runs Claude Code ${b.build}; the newest build the fleet runs is ${b.latest}. `;
  return {
    text: `${buildText(b.build)} · behind ${b.latest}`,
    short: `cc ${buildShort(b.build, b.latest)} behind`,
    title: b.reach !== null
      ? `${lead}A restart on its lane reaches ${b.reach}, so Roll idle sessions restarts it onto that build once it is idle, `
        + 'resuming its conversation, unless the setting leaves it out or it is opted out.'
      : `${lead}A restart would keep it on ${b.build}: its lane starts the build that lane's own updater recorded, and no `
        + 'session on the lane runs a newer one yet. Roll idle sessions does not restart it for the build.',
  };
}

/** `it` / `each` when the clause covers every session behind, `N of them` when only some; and the matching possessive. */
const whom = (k: number, whole: boolean): string => (whole ? (k === 1 ? 'it' : 'each') : `${k} of them`);
const whose = (k: number, whole: boolean): string => (k === 1 || whole ? 'its' : 'their');

/** Settings › Automation › Roll idle sessions: how many sessions are behind, against which build, and what the setting
 *  does about it. Only the sessions a restart can move (`reachable`: their lane runs a newer build) are promised a roll;
 *  the rest are said to stay until their lane's own updater installs a newer build. Null when no build is measured
 *  (nothing to count against). */
export function rollIdleBuildLine(c: ClaudeBuildCounts, targets: ClaudeRollTargets | null): string | null {
  if (c.latest === null) return null;
  if (c.behind === 0) return `Every running session is on Claude Code ${c.latest}, the newest build the fleet runs.`;
  const lead = c.behind === 1 ? '1 session is behind: it runs' : `${c.behind} sessions are behind: they run`;
  const out = [`${lead} an older Claude Code build than ${c.latest}, the newest the fleet runs.`];
  const r = c.reachable;
  if (r > 0) {
    out.push(targets === 'all' ? `Roll idle sessions restarts ${whom(r, r === c.behind)} onto the newest build ${whose(r, r === c.behind)} lane runs once idle.`
      : targets === 'coordinators' ? 'Only coordinators roll onto a newer build once idle; the rest pick it up when they next start.'
        : targets === 'off' ? 'Nothing rolls while this is off.' : 'Nothing rolls until the setting can be read.');
  }
  const h = c.behind - r;
  if (h > 0) {
    const all = h === c.behind;
    out.push(`A restart would keep ${whom(h, all)} on ${whose(h, all)} build: no session on ${whose(h, all)} lane runs a newer `
      + `one, so the roll leaves ${h === 1 ? 'it' : 'them'} until that lane's own updater installs one.`);
  }
  return out.join(' ');
}
