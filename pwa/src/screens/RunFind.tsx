// The run board's search (the runs rebuild, Task 8, D-8072; spec 2026-11-04 §8.3, F1, F2, F4). L4: the box, and the results
// that stand in place of the board while a query is held. Each result is a run row with its number in front, and it opens
// `/runs/<id>?q=<query>` so the run page's way back names the search. A result carries no Abandon: a search result is not
// an item that asks.
import { useId } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { EmptyState, TextInput } from '@ccrc/ui';
import type { RunSummary } from '../../../shared/api';
import { closedLine, closeWords } from '../fleet/closeWords';
import { runWhen } from '../fleet/runDetailWords';
import { inAppClick } from '../fleet/settingsText';
import { isRunClosed, runRowName, runStateWord } from '../fleet/runWords';
import { runPath } from '../lib/routes';
import { navigate } from '../lib/router';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { parseRunNumber, useRunFind, type FoundRun } from './useRunFind';
import './run-find.css';

/** The box's words (spec §8.3). */
export const RUN_FIND_WORDS = {
  label: 'Find a run',
  placeholder: 'Number, name, branch or workspace',
  failed: 'Could not search closed runs. Showing open runs only.',
  reviewsHead: (n: number): string => `Reviews of run ${n}`,
  noMatch: (q: string): string => `No run matches '${q}'.`,
  noRun: (n: number): string => `There is no run ${n}.`,
} as const;

/** The input the board's `/` key reaches. */
export const RUN_FIND_ID = 'run-find-box';

/** The box. Enter on a whole number goes straight to that run's page; Enter on anything else leaves the results where they are. */
export function RunFindBox({ value, onChange }: { value: string; onChange: (text: string) => void }): ReactNode {
  const hint = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return;
    const n = parseRunNumber(value);
    if (n === null) return;
    e.preventDefault();
    // The page opens from the search it was typed in, so Back returns to the results.
    navigate(runPath(n, value.trim()));
  };
  return (
    <div className="rf-box">
      <label htmlFor={RUN_FIND_ID} className="rf-label">{RUN_FIND_WORDS.label}</label>
      <TextInput
        id={RUN_FIND_ID}
        type="search"
        enterKeyHint="go"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={RUN_FIND_WORDS.placeholder}
        aria-describedby={hint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span id={hint} hidden>{RUN_FIND_WORDS.placeholder}</span>
    </div>
  );
}

/** One result: "Run 410 · Programme A · wave 2", then the state word and its line. */
function ResultRow({ run, q, openId }: { run: FoundRun; q: string; openId: number | null }): ReactNode {
  const href = runPath(run.id, q);
  const word = closeWords(run) ?? runStateWord(run as RunSummary);
  const closed = isRunClosed(run);
  const line = closed
    ? (typeof run.closedAt === 'number' ? closedLine(run, runWhen) : '')
    : [run.project, run.workspace].filter((t): t is string => typeof t === 'string' && t !== '').join(' · ');
  return (
    <li className="rf-row">
      <a className="rf-link" href={href} aria-current={run.id === openId ? 'true' : undefined} onClick={inAppClick(href)}>
        <span className="rf-name">{`Run ${run.id} · ${runRowName(run)}`}</span>
        <span className="rf-state">{word}</span>
        {line !== '' && <span className="rf-line">{line}</span>}
      </a>
    </li>
  );
}

/** The results in place of the board: the exact hit, open runs, closed runs, then the runs that review the number. */
export function RunFindResults({ q, store = useFleetStore, openId = null }: { q: string; store?: FleetStore; openId?: number | null }): ReactNode {
  const { exact, open, closed, reviewsOf, failed, searching } = useRunFind(q, store);
  const number = parseRunNumber(q);
  const none = exact === null && open.length === 0 && closed.length === 0 && reviewsOf.length === 0;
  return (
    <div className="rf-results" role="region" aria-label="Search results">
      {failed && <EmptyState data-state="error" role="status">{RUN_FIND_WORDS.failed}</EmptyState>}
      {exact !== null && <ul className="rf-list"><ResultRow run={exact} q={q.trim()} openId={openId} /></ul>}
      {(open.length > 0 || closed.length > 0) && (
        <ul className="rf-list">
          {open.map((r) => <ResultRow key={r.id} run={r} q={q.trim()} openId={openId} />)}
          {closed.map((r) => <ResultRow key={r.id} run={r} q={q.trim()} openId={openId} />)}
        </ul>
      )}
      {number !== null && reviewsOf.length > 0 && (
        <section aria-label={RUN_FIND_WORDS.reviewsHead(number)}>
          <h2 className="rf-head">{RUN_FIND_WORDS.reviewsHead(number)}</h2>
          <ul className="rf-list">{reviewsOf.map((r) => <ResultRow key={r.id} run={r} q={q.trim()} openId={openId} />)}</ul>
        </section>
      )}
      {none && !searching && !failed && (
        <EmptyState data-state="ok" role="status">
          {number !== null ? RUN_FIND_WORDS.noRun(number) : RUN_FIND_WORDS.noMatch(q.trim())}
        </EmptyState>
      )}
    </div>
  );
}
