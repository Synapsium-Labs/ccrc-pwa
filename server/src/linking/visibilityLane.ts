// The visibility reading's sweep lane (D-8147). L4: it acts and records; `visibilityDue` (policy.ts) decides which
// project is next and `linkingStore.ts` is the table. One `ccd repo-visibility` call per tick at most, so a fleet of
// projects is read over a few passes and the GitHub budget the PR sweep already spends does not grow with it.
import type { RepoVisibility, TemplateState } from '../../../shared/linking.js';
import { REPO_VISIBILITIES, TEMPLATE_STATES } from '../../../shared/linking.js';
import type { WatcherDeps } from '../deps.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import { visibilityDue } from './policy.js';

type LaneDeps = Pick<WatcherDeps, 'coord' | 'runCcd' | 'fleetState'>;

/** What ccd printed, narrowed: a full answer, a failure with its word, or nothing intelligible. */
function parseAnswer(stdout: string):
  { kind: 'measured'; visibility: RepoVisibility; slug: string; template: TemplateState }
  | { kind: 'failed'; reason: string } {
  try {
    const v = JSON.parse(stdout.split('\n')[0] ?? '') as Record<string, unknown>;
    if (typeof v.reason === 'string' && /^[a-z-]{1,24}$/.test(v.reason)) return { kind: 'failed', reason: v.reason };
    if (typeof v.slug === 'string' && REPO_VISIBILITIES.includes(v.visibility as RepoVisibility)
      && TEMPLATE_STATES.includes(v.template as TemplateState)) {
      return { kind: 'measured', visibility: v.visibility as RepoVisibility, slug: v.slug, template: v.template as TemplateState };
    }
  } catch { /* falls to bad-answer */ }
  return { kind: 'failed', reason: 'bad-answer' };
}

export class VisibilityLane {
  constructor(private readonly deps: () => LaneDeps) {}

  /** Measure the one project that is due, if any. Never throws; a ccd without the verb is skipped without a record. */
  async tick(projects: readonly string[], now: number): Promise<void> {
    try {
      const { coord, runCcd, fleetState } = this.deps();
      if (coord === undefined || projects.length === 0) return;
      if (!ccdCan(fleetState, 'repoVisibility')) return;
      const known = coord.linkingAll();
      const rows = projects.map((project) => {
        const m = known.get(project)?.measured;
        return { project, at: m === undefined || m.state === 'unmeasured' ? null : m.at };
      });
      const due = visibilityDue(rows, now);
      if (due === null) return;
      const res = await runCcd(CCD_ARGV.repoVisibility(due));
      if (res.ran === false) {   // the call never ran: a failed reading, not an answer to parse (D-6840)
        coord.recordLinkingReading(due, { state: 'failed', reason: 'not-ran', at: now });
        return;
      }
      const a = parseAnswer(res.stdout);
      if (res.ok && a.kind === 'measured') {
        coord.recordLinkingReading(due, { state: 'measured', visibility: a.visibility, slug: a.slug, template: a.template, at: now });
      } else {
        coord.recordLinkingReading(due, { state: 'failed', reason: a.kind === 'failed' ? a.reason : 'bad-answer', at: now });
      }
    } catch (e) {
      console.warn(`ccrc-server: visibility lane failed (${e instanceof Error ? e.message.slice(0, 120) : 'unknown'})`);
    }
  }
}
