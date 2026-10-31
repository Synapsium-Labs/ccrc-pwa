// ARCH-42 (GitHub #777): the bound-by census (D-7069; plan 2026-10-26-arch-42-bindings-of.md). Its own
// module, as W3's questions and W8's chains keep theirs (`census-w3/`, `census-w8/`): no series appends to
// `consolidationCensus.ts`'s tail (spec §5.1 rule 6). The query returns `CensusSite` rows through that module's shared
// helpers, and its fixture and real-tree rows live in the sibling `bindings.test.ts`.
//
// THE QUESTION. "Is this session bound by coordination, and by whom?" The consolidation spec says it is "assembled 9 ways"
// and names no site. This census answers it by a rule, read from the syntax tree (`scan/symbols.ts`): a SITE is a named
// production code unit (a function, a method, an arrow bound to a name) under `server/src/` that calls one of the
// BOUND-BY READERS below. A unit counts once however many of them it calls. The readers' own definitions are the readers,
// not sites. KNOWN WIDTH: a reader reached through a computed name, an alias or a destructured binding is not seen.
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { REPO, sourceFiles, type CensusSite } from '../consolidationCensus.js';

/**
 * The bound-by readers: every session-keyed read of a session's OPEN binding, by its name.
 *   - `openRunsForSession`: the open runs naming the session as worker (`role: 'claimant'`: the ones it claims);
 *   - `openRunsClaimedBy`: the open runs the session claims (`openRunsForSession`'s claimant column);
 *   - `childParentRead`: the session's parent, the claimant of its open binding (heldFor, the drift lane);
 *   - `sessionRunRead`: the card's newest and open bound run, whose claimant the card shows;
 *   - `claimantsOfSession`: every coordinator the session currently works for.
 * Not readers, by the rule (each written down in the plan note): the series read `bindingRunsOf` (the binding values
 * read it; it answers no question by itself), the any-state history reads `runsNamingSession` and `runsTouching` ("was
 * it ever", not "is it"), the pass-wide reads `lastRunBySession`, `activeClaims` and `outstandingMailFor` (fleet-wide or
 * mail, not a session's run binding), the run-keyed reads (`run`, `readCoordinatorOfRun`) and the coordinator-keyed
 * `withChildIds` (whom a coordinator binds, not who binds a session).
 */
export const BOUND_BY_READERS: readonly string[] = [
  'openRunsForSession', 'openRunsClaimedBy', 'childParentRead', 'sessionRunRead', 'claimantsOfSession',
];

/** One call of a bound-by reader, with the named unit it sits in (`module scope` for none). */
export interface BoundByCall extends CensusSite { readonly reader: string; readonly owner: string }

/** One site: a named unit that calls at least one reader, at its first call, with every reader it calls. */
export interface BoundBySite extends CensusSite { readonly owner: string; readonly readers: readonly string[] }

const lastName = (qualified: string): string => qualified.slice(qualified.lastIndexOf('.') + 1);

/** Every call of a `BOUND_BY_READERS` name under `server/src/`, outside the readers' own definitions, in file order. */
export function boundByCalls(root: string = REPO): BoundByCall[] {
  const out: BoundByCall[] = [];
  for (const abs of sourceFiles(root, 'server/src')) {
    const file = path.relative(root, abs).split(path.sep).join('/');
    const parsed = parsedFile(abs);
    const lines = parsed.text.split('\n');
    for (const c of parsed.calls) {
      if (c.name === null || !BOUND_BY_READERS.includes(c.name)) continue;
      // The innermost named unit holding the call.
      const holders = parsed.symbols.filter((s) => s.start <= c.start && c.end <= s.end).sort((a, b) => (b.start - a.start) || (a.end - b.end));
      const owner = holders[0]?.name ?? 'module scope';
      if (BOUND_BY_READERS.includes(lastName(owner))) continue;
      out.push({ file, line: c.line, text: lines[c.line - 1] ?? '', reader: c.name, owner });
    }
  }
  return out;
}

/** The census: one row per named unit that calls a bound-by reader (`D-7069`). */
export function boundBySites(root: string = REPO): BoundBySite[] {
  const byOwner = new Map<string, { site: BoundByCall; readers: string[] }>();
  for (const c of boundByCalls(root)) {
    const key = `${c.file}\u0000${c.owner}`;
    const had = byOwner.get(key);
    if (had === undefined) byOwner.set(key, { site: c, readers: [c.reader] });
    else if (!had.readers.includes(c.reader)) had.readers.push(c.reader);
  }
  return [...byOwner.values()].map(({ site, readers }) => ({ file: site.file, line: site.line, text: site.text, owner: site.owner, readers }));
}
