// The Goals panel of the programme view (programme ledgers plan PL5b; spec section 4, D3): the spec the programme is
// working towards, its "In short" as it now stands, and the dated list "Changed since approval". Props only: it fetches
// nothing and owns no route, and it decides nothing. The "In short" and the modifications are the coordinator's copy of
// the spec's summary and its own record of each rewrite (`GoalsView`, built by `goalsFor`, newest modification first),
// so the panel draws them as given.
//
// A change that came from a Waiting on you item links to it through `itemHref`, which the screen hands in (it knows the
// route and what the list still holds), so this file still names no route and reads no store.
//
// The Docs link is the one thing built here, and it is built only from a checked path: `isSpecPath` (under the specs
// directory, Markdown, no `..`) in a project that passes the project grammar. A pin that fails either draws no link
// (plan Review Focus 5, PWA side). The URL goes through `docsPageUrl(docsLocation(...))` as every Docs link does
// (refinement (q)); the Docs reader serves merged content only, so a change whose PR has not merged says so.
import type { ReactNode } from 'react';
import { TextLink } from '@ccrc/ui';
import { docsPageUrl, isDocsProject } from '../../../shared/docs';
import { isSpecPath, type GoalsView } from '../../../shared/ledgers';
import { docsLocation } from '../docs/docsLinks';
import { inAppClick } from '../fleet/settingsText';
import { releaseDate } from '../lib/format';

const SPECS_DIR = 'docs/superpowers/specs/';

/** The Docs page of the pinned spec in the programme's home project, or null: no pin, a path that is not a spec
 *  path, or no usable home project. Null has those three meanings and no caller needs to tell them apart. */
function specHref(specPath: string | null, homeProject: string | null): string | null {
  if (specPath === null || homeProject === null) return null;
  if (!isSpecPath(specPath) || !isDocsProject(homeProject)) return null;
  return docsPageUrl(docsLocation(
    { kind: 'project', project: homeProject, ref: null },
    { kind: 'path', section: 'specs', path: specPath.slice(SPECS_DIR.length), dirSlash: false },
  ));
}

/** "Open the item" for a change that came from one, when the screen has a page to send it to. */
function ItemLink({ itemId, itemHref }: { itemId: number | null; itemHref: ((itemId: number) => string | null) | undefined }): ReactNode {
  const href = itemId === null || itemHref === undefined ? null : itemHref(itemId);
  return href === null ? null : (
    <span className="pg-goals-item"><TextLink href={href} onClick={inAppClick(href)}>Open the item</TextLink>{' that prompted it'}</span>
  );
}

export function GoalsPanel({ goals, homeProject, itemHref }: {
  goals: GoalsView;
  homeProject: string | null;
  /** The page of a Waiting on you item, or `null` when the screen holds none for it. Given, a change that came from an item
   *  links to it; absent, no change does. A function and not a path, so this panel names no route and reads no store. */
  itemHref?: (itemId: number) => string | null;
}): ReactNode {
  const href = specHref(goals.specPath, homeProject);
  const pending = goals.modifications.some((m) => !m.merged);
  return (
    <section className="pg-goals" aria-labelledby={`goals-${goals.program}`}>
      <h2 id={`goals-${goals.program}`} className="pg-goals-title">Goals</h2>

      <div className="pg-goals-short">
        <h3 className="pg-goals-label">In short</h3>
        {goals.inShort === null
          ? <p className="pg-goals-none">No spec is pinned yet.</p>
          : (
            <>
              <p className="pg-goals-text">{goals.inShort}</p>
              {goals.inShortAt !== null && <p className="pg-goals-date">{`As of ${releaseDate(goals.inShortAt)}`}</p>}
            </>
          )}
        {href !== null && (
          <p className="pg-goals-open">
            <TextLink href={href} onClick={inAppClick(href)}>Open the spec in Docs</TextLink>{' to read all of it.'}
          </p>
        )}
      </div>

      <div className="pg-goals-changes">
        <h3 className="pg-goals-label">Changed since approval</h3>
        {goals.modifications.length === 0
          ? <p className="pg-goals-none">Nothing has changed since approval.</p>
          : (
            <ul className="pg-goals-list">
              {goals.modifications.map((m) => (
                <li key={m.id} className="pg-goals-mod" data-merged={m.merged ? 'true' : 'false'}>
                  <span className="pg-goals-date">{releaseDate(m.at)}</span>
                  <span className="pg-goals-what">{m.text}</span>
                  {m.ruling !== null && <span className="pg-goals-ruling">{`Ruling: ${m.ruling}`}</span>}
                  <ItemLink itemId={m.itemId} itemHref={itemHref} />
                  {m.merged
                    ? m.pr !== null && <span className="pg-goals-pr">{`PR #${m.pr}`}</span>
                    : (
                      <span className="pg-goals-pending">
                        {m.pr === null ? 'spec update pending' : `spec update pending (PR #${m.pr})`}
                      </span>
                    )}
                </li>
              ))}
            </ul>
          )}
        {pending && <p className="pg-goals-note">Until it merges, the spec opens without it.</p>}
      </div>
    </section>
  );
}
