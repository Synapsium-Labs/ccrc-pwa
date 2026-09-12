// The pool projections the phone renders — and the ONE place `poolRule` is
// composed with `accountPool`.
//
// There is no rule here. `shared/poolrule.ts` decides; this module only asks
// it the questions a screen has: which of these accounts may take this
// project, which of these projects may this account take, and what does the
// card say when nobody can decide. The spec's own words for why that split
// matters: "Two implementations of one rule drift; that is what they do."
//
// NOTHING IN THIS MODULE IS PERSISTED. `stores/fleet.ts`'s `pools` slot starts
// null on every load and the offline snapshot has no field for it, so
// `projectPoolOf` can never be asked about a tag that was true an hour ago.
import type { ProjectPoolWire, ProjectPoolsWire, RosterWire } from '../../../shared/api';
import { poolRule } from '../../../shared/poolrule';
import { accountPool, joinLabels } from './accounts';

/** Which side of the pool line one candidate falls on.
 *
 *  THREE values, because a caller handles each differently. `eligible` is
 *  offered plainly; `crossing` is hidden behind a disclosure and, when picked,
 *  travels with an explicit `crossPool` flag; `unknown` is offered plainly
 *  WITH a note saying so — hiding on unknown would be inventing a rule the
 *  fleet never stated, and flagging on unknown would accuse a project whose
 *  tag nobody could read. */
export type PoolSide = 'eligible' | 'crossing' | 'unknown';

/** `poolRule`, asked the screen's question.
 *
 *  `projectPool === null` — no `pools` frame has arrived, or the server
 *  predates the field — is the one condition the rule itself has no vocabulary
 *  for, so it is answered here and nowhere else. Every OTHER undecidable
 *  condition (`unreadable`, `malformed`) is the rule's own `pool-undecidable`,
 *  read off the verdict rather than re-listed. */
export function poolSide(
  accountPoolName: string | null,
  projectPool: ProjectPoolWire | null,
): PoolSide {
  if (projectPool === null) return 'unknown';
  const verdict = poolRule(accountPoolName, projectPool);
  if (verdict.ok) return 'eligible';
  return verdict.reason === 'pool-mismatch' ? 'crossing' : 'unknown';
}

/** Split swap/start targets into the ones this project's pool admits and the
 *  ones a deliberate crossing would be. `unknown` means nobody could decide:
 *  EVERY wrapper comes back eligible, `crossing` is empty, and the caller
 *  renders its note instead of a disclosure. */
export function splitByPool(
  roster: readonly RosterWire[],
  wrappers: readonly string[],
  projectPool: ProjectPoolWire | null,
): { eligible: string[]; crossing: string[]; unknown: boolean } {
  // ONE probe, with a deliberately untagged account, asks the RULE whether
  // anything can be decided against this tag at all — `poolRule` settles the
  // undecidable states before it ever looks at the account, so this never
  // re-lists `unreadable`/`malformed` here and cannot fall out of step with
  // the states wave 1 declares.
  if (poolSide(null, projectPool) === 'unknown') {
    return { eligible: [...wrappers], crossing: [], unknown: true };
  }
  const eligible: string[] = [];
  const crossing: string[] = [];
  for (const w of wrappers) {
    if (poolSide(accountPool(roster, w), projectPool) === 'crossing') crossing.push(w);
    else eligible.push(w);
  }
  return { eligible, crossing, unknown: false };
}

/** This project's pool, off the fleet-level `pools` frame (spec §5.9: DERIVED
 *  by project name, never carried per session and never revived).
 *
 *  `null` is "nobody has told this build anything" — no frame yet, or a server
 *  that does not send one. It is NOT `{state:'untagged'}`, which is a
 *  measurement, and the difference is the whole reason `ProjectCard` renders
 *  nothing for the first and a flagged chip for the second.
 *
 *  `listed:false` maps to `unreadable`, matching the server's own `poolFor`:
 *  the directory is present at the registry root and could not be listed, so
 *  no project's tag is known. Untagged here would silently lift every
 *  constraint on the box, which is the destructive direction. */
export function projectPoolOf(
  pools: ProjectPoolsWire | null,
  project: string,
): ProjectPoolWire | null {
  if (pools === null) return null;
  if (!pools.listed) return { state: 'unreadable' };
  return pools.byProject[project] ?? { state: 'untagged' };
}

/** The distinct pool names this roster actually carries, in roster order.
 *
 *  DERIVED AT RENDER, never a list in source: a pool name typed into a shipped
 *  file would be one operator's fleet baked into everybody's bundle, which
 *  `topology-clean` exists to prevent. Read through `accountPool` rather than
 *  `a.pool`, so this stays inside the single-reader rule. */
export function poolOptions(roster: readonly RosterWire[]): string[] {
  const out: string[] = [];
  for (const a of roster) {
    const p = accountPool(roster, a.id);
    if (p !== null && !out.includes(p)) out.push(p);
  }
  return out;
}

/** "team·alt and team·d" — the HOME-ABLE accounts that may serve this project,
 *  by label, for the "nothing is placeable" copy on `ProjectCard`'s `+`.
 *
 *  `homeAbleLabelList`'s pool-aware sibling, sharing its `joinLabels` so the
 *  two sentences punctuate identically, and inheriting its rule: name the
 *  accounts individually, never "all accounts" — an enabled `gpt` in the same
 *  list would make that claim false on its face.
 *
 *  An UNDECIDABLE or absent project pool admits everything, so this is
 *  byte-identical to `homeAbleLabelList` there: a card must not tell the
 *  operator a pool is empty on the strength of a tag nobody could read. */
export function poolLabelList(
  roster: readonly RosterWire[],
  projectPool: ProjectPoolWire | null,
): string {
  return joinLabels(
    roster
      .filter((a) => a.homeAble && poolSide(accountPool(roster, a.id), projectPool) !== 'crossing')
      .map((a) => a.label),
  );
}
