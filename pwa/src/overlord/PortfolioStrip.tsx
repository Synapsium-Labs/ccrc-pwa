// The portfolio strip on the Overlord's place (Overlord W1 home B, Task 6; spec §5.6 H38; plan Global Constraints "Portfolio").
// L4 (context C5): it reads `GET /api/portfolio` on mount, keeps it as a `ReadState` through `nextReadState`, holds the
// operator's draft, and writes `POST /api/portfolio/rank`. `portfolioWords.ts` (L1) decides every row, every edit and the
// body; this file decides nothing.
//
// THE RANK CONTROL is plain buttons and a chooser, so a keyboard reaches and works all of it: Move up and Move down per row
// (a row moves inside its class band), a class chooser, and, for `fixed-date`, a date field. Save order writes
// `{ basedOn: the read's revision, seen: every slug the strip drew, order }` once. `rank-changed` (another tab moved the order
// since this read) reads the portfolio again, says so, and shows the new order: it NEVER sends the same order a second time.
// Every other refusal is drawn by its word's sentence and keeps the draft.
//
// Titles are session-written text: they are rendered as text and never as markup.
//
// CLASS NAMES for the place's one stylesheet: `ov-portfolio` (the section), `ov-portfolio-title`, `ov-portfolio-note` (a
// sentence under the title: absent, unmeasured, stale, empty), `ov-portfolio-rows` (an ordered list with no markers; each row
// carries its own number), `ov-portfolio-row` (a card row; the controls wrap below the text at 320 px), `ov-portfolio-head`,
// `ov-portfolio-name`, `ov-portfolio-class` (the class and its fixed date), `ov-portfolio-flag` (rank unreadable, not ranked),
// `ov-portfolio-facts` (a definition list), `ov-portfolio-controls` (a wrapping row; each control at least 44 px square),
// `ov-portfolio-actions` (Save and Discard), `ov-portfolio-said`.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Select, TextInput } from '@ccrc/ui';
import type { PortfolioView, ServiceClass } from '../../../shared/portfolio';
import { SERVICE_CLASSES } from '../../../shared/portfolio';
import { api, ApiError, ApiTimeout, apiErrorText } from '../lib/api';
import { LEDGER_REFUSAL_TEXT, refusalText } from '../lib/refusalWords';
import {
  CLASS_WORDS, PORTFOLIO_WORDS, canMove, draftOf, isDirty, isRankChanged, moveRow, rankWriteOf, setClass, setFixedDate, stripView,
  type StripDraft,
} from './portfolioWords';
import { nextReadState, type ReadOutcome } from './readOutcome';
import type { ReadState } from './readState';

/** A failure's words, as the strip prints them: the 503's own detail, else its status. Never a value. */
function failureWords(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = typeof err.body === 'object' && err.body !== null ? (err.body as { detail?: unknown }).detail : undefined;
    return typeof detail === 'string' && detail.length > 0 ? detail : `HTTP ${err.status}`;
  }
  if (err instanceof ApiTimeout) return 'timeout';
  return err instanceof Error ? err.message : String(err);
}

const isView = (v: unknown): v is PortfolioView =>
  typeof v === 'object' && v !== null && Array.isArray((v as { programmes?: unknown }).programmes)
  && typeof (v as { revision?: unknown }).revision === 'number';

async function readPortfolio(): Promise<ReadOutcome<PortfolioView>> {
  try {
    const body = await api.portfolio();
    if ('absent' in body) return { kind: 'absent' };
    // A 2xx body that is not a portfolio is a failure the strip prints, never an empty strip.
    return isView(body.portfolio) ? { kind: 'value', value: body.portfolio } : { kind: 'failed', error: 'unreadable answer' };
  } catch (err) {
    return { kind: 'failed', error: failureWords(err) };
  }
}

const refusalWords = (err: unknown): string => refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err);

export function PortfolioStrip({ now = Date.now }: { readonly now?: () => number }): ReactNode {
  const [read, setRead] = useState<ReadState<PortfolioView>>({ state: 'loading' });
  const [edit, setEdit] = useState<{ readonly revision: number; readonly draft: StripDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (): Promise<void> => {
    const outcome = await readPortfolio();
    if (mounted.current) setRead((prev) => nextReadState(prev, outcome, now()));
  }, [now]);
  useEffect(() => { void load(); }, [load]);

  const view = stripView(read);
  // The draft belongs to the revision it was made on: a read that brings another revision drops it.
  const draft = useMemo<StripDraft | null>(() => {
    if (view.kind !== 'rows') return null;
    return edit !== null && edit.revision === view.revision ? edit.draft : draftOf(view.rows);
  }, [view, edit]);

  const change = (next: StripDraft): void => {
    if (view.kind === 'rows') { setSaid(null); setEdit({ revision: view.revision, draft: next }); }
  };

  const save = async (): Promise<void> => {
    if (view.kind !== 'rows' || draft === null || saving) return;
    const answer = rankWriteOf(view.revision, draft);
    if (!answer.ok) { setSaid(PORTFOLIO_WORDS.needsDate); return; }
    setSaving(true);
    setSaid(null);
    try {
      const res = await api.rankPortfolio(answer.write);
      if (!mounted.current) return;
      setEdit(null);
      if (isView(res.portfolio)) {
        setRead((prev) => nextReadState(prev, { kind: 'value', value: res.portfolio }, now()));
        setSaid(PORTFOLIO_WORDS.saved);
      } else {
        await load();
      }
    } catch (err) {
      if (!mounted.current) return;
      const word = err instanceof ApiError && typeof err.body === 'object' && err.body !== null ? (err.body as { error?: unknown }).error : undefined;
      if (isRankChanged(word)) {
        setEdit(null);
        setSaid(PORTFOLIO_WORDS.rankMoved);
        await load();
      } else if (!(err instanceof ApiError && err.status === 401)) {
        setSaid(refusalWords(err));
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <section className="ov-portfolio" aria-label={PORTFOLIO_WORDS.title} data-overlord-portfolio>
      <h2 className="ov-portfolio-title">{PORTFOLIO_WORDS.title}</h2>
      {view.kind === 'loading' && <p className="ov-portfolio-note" role="status">{PORTFOLIO_WORDS.loading}</p>}
      {(view.kind === 'absent' || view.kind === 'unmeasured') && (
        <p className="ov-portfolio-note" data-portfolio={view.kind}>{view.text}</p>
      )}
      {view.kind === 'rows' && draft !== null && (
        <>
          {view.stale !== null && <p className="ov-portfolio-note" data-portfolio="stale">{view.stale}</p>}
          {draft.rows.length === 0 ? (
            <p className="ov-portfolio-note" data-portfolio="empty">{PORTFOLIO_WORDS.empty}</p>
          ) : (
            <ol className="ov-portfolio-rows">
              {draft.rows.map((row) => (
                <li key={row.slug} className="ov-portfolio-row" data-portfolio-row={row.slug} data-class={row.cls}>
                  <div className="ov-portfolio-head">
                    <span className="ov-portfolio-name">{row.title}</span>
                    <span className="ov-portfolio-class">
                      {CLASS_WORDS[row.cls]}{row.fixedDate !== null ? ` · ${row.fixedDate}` : ''}
                    </span>
                    {row.rankUnreadable && <span className="ov-portfolio-flag" data-flag="rank-unreadable">{PORTFOLIO_WORDS.rankUnreadable}</span>}
                    {!row.ranked && !row.rankUnreadable && <span className="ov-portfolio-flag" data-flag="unranked">{PORTFOLIO_WORDS.unranked}</span>}
                  </div>
                  <dl className="ov-portfolio-facts">
                    {row.facts.map((f) => (
                      <div key={f.key} data-fact={f.key}><dt>{f.label}</dt><dd>{f.text}</dd></div>
                    ))}
                  </dl>
                  <div className="ov-portfolio-controls">
                    <Button
                      variant="ghost" size="fit" className="min-w-tap justify-center" disabled={saving || !canMove(draft, row.slug, -1)}
                      aria-label={`Move ${row.title} up`} onClick={() => { change(moveRow(draft, row.slug, -1)); }}
                    >
                      Up
                    </Button>
                    <Button
                      variant="ghost" size="fit" className="min-w-tap justify-center" disabled={saving || !canMove(draft, row.slug, 1)}
                      aria-label={`Move ${row.title} down`} onClick={() => { change(moveRow(draft, row.slug, 1)); }}
                    >
                      Down
                    </Button>
                    <Select
                      className="w-auto" value={row.cls} disabled={saving} aria-label={`Class of ${row.title}`}
                      onChange={(e) => { change(setClass(draft, row.slug, e.target.value as ServiceClass)); }}
                    >
                      {SERVICE_CLASSES.map((c) => <option key={c} value={c}>{CLASS_WORDS[c]}</option>)}
                    </Select>
                    {row.cls === 'fixed-date' && (
                      <TextInput
                        type="date" className="w-auto" value={row.fixedDate ?? ''} disabled={saving} aria-label={`Fixed date of ${row.title}`}
                        onChange={(e) => { change(setFixedDate(draft, row.slug, e.target.value)); }}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {isDirty(draft) && (
            <div className="ov-portfolio-actions">
              <Button
                variant="primary" size="fit" disabled={saving || !rankWriteOf(view.revision, draft).ok}
                onClick={() => { void save(); }}
              >
                {saving ? PORTFOLIO_WORDS.saving : PORTFOLIO_WORDS.save}
              </Button>
              <Button variant="ghost" size="fit" disabled={saving} onClick={() => { setEdit(null); setSaid(null); }}>
                {PORTFOLIO_WORDS.discard}
              </Button>
            </div>
          )}
        </>
      )}
      {said !== null && <p className="ov-portfolio-said" role="status">{said}</p>}
    </section>
  );
}
