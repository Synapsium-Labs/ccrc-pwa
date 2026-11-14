// The visibility reading's sweep lane (D-8147). L4: it acts and records; `visibilityDue` (policy.ts) decides which
// project is next and `linkingStore.ts` is the table. One `ccd repo-visibility` call per tick at most, so a fleet of
// projects is read over a few passes and the GitHub budget the PR sweep already spends does not grow with it.
//
// D-8405: the linking lane's second step, `linkTeams`, the automatic team link. It runs on the same cadence (after each
// visibility tick, from the PR sweep) and when the console adds a project or a Linear workspace key, never on a poller of
// its own. It calls neither Linear nor GitHub: the teams are what the box's Linear keys already learned (the store the
// refresher and the key acts write), and the evidence is what the PR sweep already read. `teamLink.ts` decides; this
// writes through `CoordStore`, whose SQL keeps the operator's key against it.
import type { RepoVisibility, TemplateState } from '../../../shared/linking.js';
import { REPO_VISIBILITIES, TEMPLATE_STATES } from '../../../shared/linking.js';
import type { WatcherDeps } from '../deps.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import { readLinearStore, type LinearStoreRead } from '../linear/store.js';
import { routableTeams } from '../linear/route.js';
import { visibilityDue } from './policy.js';
import { planTeamLink, repoNameOf } from './teamLink.js';

/** `cfg` is the Linear store's home for the team link; a lane given none (a test of the visibility step) links nothing. */
type LaneDeps = Pick<WatcherDeps, 'coord' | 'runCcd' | 'fleetState'> & { cfg?: Pick<WatcherDeps['cfg'], 'ccrcDir'> };

/** What the PR sweep last read of each project, for the team link (D-8405). */
export interface TeamLinkInputs {
  /** The project's ticket ids per key (`ticketTally` of its branches, pull request titles and commits); empty when the
   *  sweep has read none. */
  tally: (project: string) => ReadonlyMap<string, number>;
  /** The repository slug the PR sweep measured for the project, or null. */
  slug: (project: string) => string | null;
}

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
  constructor(
    private readonly deps: () => LaneDeps,
    /** The Linear store's read (the seam a test replaces). */
    private readonly readStore: (ccrcDir: string) => Promise<LinearStoreRead> = readLinearStore,
  ) {}

  /**
   * D-8405: the automatic team link over `projects`: each project's step is `planTeamLink`'s (link the decisive team, or
   * record the candidates; a project with a key keeps none), and the store's SQL holds the operator's key. Nothing when
   * there is no store, no ccrc dir or the Linear store cannot be read (no teams known is not the same as no teams). Never
   * throws.
   */
  async linkTeams(projects: readonly string[], now: number, inputs: TeamLinkInputs): Promise<void> {
    try {
      const { coord, cfg } = this.deps();
      if (coord === undefined || cfg === undefined || projects.length === 0) return;
      const store = await this.readStore(cfg.ccrcDir);
      if (store.kind !== 'listed') return;
      const teams = routableTeams(store);
      const known = coord.linkingAll();
      for (const project of new Set(projects)) {
        const l = known.get(project);
        const slug = l?.measured.state === 'measured' ? l.measured.slug : inputs.slug(project);
        const plan = planTeamLink({ teamKey: l?.teamKey ?? null, source: l?.teamLink?.source ?? null }, {
          project, repo: slug === null ? null : repoNameOf(slug), mode: l?.mode ?? 'unknown', teams, tally: inputs.tally(project),
        });
        if (plan.link !== null && coord.linkTeamAuto(project, plan.link, now)) continue;
        coord.recordTeamCandidates(project, plan.candidates);
      }
    } catch (e) {
      console.warn(`ccrc-server: team link lane failed (${e instanceof Error ? e.message.slice(0, 120) : 'unknown'})`);
    }
  }

  /** Measure the one project that is due, if any. Never throws; a ccd without the verb is skipped without a record. */
  async tick(projects: readonly string[], now: number): Promise<void> {
    try {
      const { coord, runCcd, fleetState } = this.deps();
      if (coord === undefined || projects.length === 0) return;
      if (!ccdCan(fleetState, 'repoVisibility')) return;
      const known = coord.linkingAll();
      const rows = projects.map((project) => {
        const m = known.get(project)?.measured;
        return { project, at: m === undefined || m.state === 'unmeasured' ? null : m.at, failed: m?.state === 'failed' };
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
