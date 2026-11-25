// The Goals panel of the programme view (programme ledgers plan PL5b; spec section 4, D3): the spec the programme is
// working towards, its "In short" as it now stands, and the dated list "Changed since approval". Props only: it fetches
// nothing and owns no route, and it decides nothing. The "In short" and the modifications are the coordinator's copy of
// the spec's summary and its own record of each rewrite (`GoalsView`, built by `goalsFor`, newest modification first),
// so the panel draws them as given.
//
// A change that came from a Waiting on you item links to it through `itemHref`, which the screen hands in (it knows the
// route and what the list still holds), so this file still names no route and reads no store.
//
// The Docs link is built only from a checked path: `isSpecPath` (under the specs directory, Markdown, no `..`) in a project
// that passes the project grammar. A pin that fails either draws no link (plan Review Focus 5, PWA side). Its one builder is
// `specHref` in `ledgerLinks.ts` (desktop-polish PL10, D-7952), which the item band, each programme group and the programme
// view's head ask too; the Docs reader serves merged content only, so a change whose PR has not merged says so.
import type { ReactNode } from 'react';
import { Button, TextLink } from '@ccrc/ui';
import { ratificationOf, type GoalsVersion, type GoalsView, type Ratification } from '../../../shared/ledgers';
import { inAppClick } from '../fleet/settingsText';
import { useTabLink } from '../lib/useTabLink';
import { releaseDate } from '../lib/format';
import { specHref } from './ledgerLinks';
import { doneWhenPlacement, ratificationWords, ratifyOffered } from './ledgerWords';

/** The "Spec" link wherever the ledgers name a programme (desktop-polish PL10, D-7952; spec §2, D26): the item band, each
 *  programme group of the combined list and the programme view's head. `href` is `specHref`'s or `programmeSpecHref`'s answer;
 *  null draws nothing, so a programme with no pin has no link. Its name says whose spec it opens, since a list holds several. */
export function SpecLink({ href, programme, className }: { href: string | null; programme: string; className?: string }): ReactNode {
  // A document link: at a desk it opens a Docs tab of its own (the Docs tab rule, desktop polish wave 174).
  const link = useTabLink();
  return href === null ? null : (
    <TextLink {...link(href)} aria-label={`Spec for ${programme}`} className={className}>Spec</TextLink>
  );
}

/** "Open the item" for a change that came from one, when the screen has a page to send it to. */
function ItemLink({ itemId, itemHref }: { itemId: number | null; itemHref: ((itemId: number) => string | null) | undefined }): ReactNode {
  const href = itemId === null || itemHref === undefined ? null : itemHref(itemId);
  return href === null ? null : (
    <span className="pg-goals-item"><TextLink href={href} onClick={inAppClick(href)}>Open the item</TextLink>{' that prompted it'}</span>
  );
}

/** A version's verdict in words, and a Ratify button when `ratifyOffered` says so and the caller can ratify. */
function Verdict({ r, itemId, onRatify }: { r: Ratification; itemId: number | null; onRatify: (() => void) | null }): ReactNode {
  return (
    <span className="pg-goals-verdict">
      <span>{ratificationWords(r, itemId)}</span>
      {onRatify !== null && ratifyOffered(r) && <Button variant="ghost" size="fit" onClick={onRatify}>Ratify</Button>}
    </span>
  );
}

/** The stored definition of done, drawn beside the verdict and Ratify button of the version that wrote it, so the operator
 *  never ratifies a list they were not shown (review 2240 F4). Where it goes is `doneWhenPlacement`'s. */
function DoneWhen({ items }: { items: readonly string[] }): ReactNode {
  return (
    <div className="pg-goals-donewhen">
      <h4 className="pg-goals-label">Definition of done</h4>
      <ul className="pg-goals-list">{items.map((t, i) => <li key={i} className="pg-goals-text">{t}</li>)}</ul>
    </div>
  );
}

export function GoalsPanel({ goals, homeProject, itemHref, onRatify }: {
  goals: GoalsView;
  homeProject: string | null;
  /** The page of a Waiting on you item, or `null` when the screen holds none for it. Given, a change that came from an item
   *  links to it; absent, no change does. A function and not a path, so this panel names no route and reads no store. */
  itemHref?: (itemId: number) => string | null;
  /** Given, an unratified version draws a Ratify button that hands back the version: the pin at the stamp this panel drew, or
   *  a modification's id. Absent, no button. The screen owns the call. */
  onRatify?: (version: GoalsVersion) => void;
}): ReactNode {
  const at = goals.inShortAt;
  const href = specHref(goals.specPath, homeProject);
  const link = useTabLink();
  const pending = goals.modifications.some((m) => !m.merged);
  const placement = doneWhenPlacement(goals);
  const doneWhen = goals.doneWhen ?? [];
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
              <Verdict r={ratificationOf(goals.pinRatification)} itemId={null}
                onRatify={onRatify === undefined || at === null ? null : () => onRatify({ pin: { inShortAt: at } })} />
              {placement?.at === 'pin' && <DoneWhen items={doneWhen} />}
            </>
          )}
        {href !== null && (
          <p className="pg-goals-open">
            <TextLink {...link(href)}>Open the spec in Docs</TextLink>{' to read all of it.'}
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
                  <Verdict r={ratificationOf(m.ratification)} itemId={m.itemId}
                    onRatify={onRatify === undefined ? null : () => onRatify({ modification: m.id })} />
                  {placement?.at === 'modification' && placement.id === m.id && <DoneWhen items={doneWhen} />}
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

      {placement?.at === 'alone' && (
        <div className="pg-goals-donewhen-alone">
          <DoneWhen items={doneWhen} />
          <span className="pg-goals-verdict">{ratificationWords(ratificationOf(goals.doneWhenRatification), null)}</span>
        </div>
      )}
    </section>
  );
}
