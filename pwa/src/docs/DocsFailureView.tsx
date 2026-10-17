// What a Docs page shows in place of a listing or a body when a loader answered no page (spec 2026-10-01 4.7): the
// sentence, the context its word names, and the actions its retry class allows. A pure renderer: the caller decides
// WHEN an action is offered by passing its handler (an absent handler means the action is not offered), and this
// view decides only WHETHER the answer allows it at all (a `none` word never shows Retry, whatever is passed).
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { docsRetryPlan, type DocsNotOk } from './failures';
import {
  NOT_A_FILE_KIND_TEXT, TRIED_RESULT_TEXT, UNRESOLVED_TAG_HINT, failureSentence, slotSentence,
} from './docsText';
import { DocsPageLink } from './DocsTreeView';

export interface DocsFailureViewProps {
  readonly answer: DocsNotOk;
  /** Retry the read that failed. Absent: no Retry is offered. */
  readonly onRetry?: () => void;
  /** `unresolved-ref`'s manual fetch (`reason: 'manual'`). Absent: not offered. */
  readonly onFetchFromOrigin?: () => void;
  /** Fetch from origin is running: its button is disabled. Absent: not running. */
  readonly fetching?: boolean;
  /** What the visit's fetch is doing or how it ended, said under the actions (`state` is the freshness chip's word).
   *  Absent: nothing to say. */
  readonly fetchNote?: { readonly state: string; readonly text: string } | null;
  /** The page URL for `unresolved-ref`'s `suggest`. Absent: the suggestion is shown as text, not as a link. */
  readonly suggestHref?: (name: string) => string;
}

/** Whether the answer allows a Retry at all: a word by its retry plan, a slot by what it is. `auth` re-fetches on
 *  sign-in and `no-docs-route` cannot change by retrying, so neither offers one. */
function allowsRetry(answer: DocsNotOk): boolean {
  switch (answer.s) {
    case 'failed':
      return docsRetryPlan(answer.body).kind !== 'none';
    case 'unreachable':
    case 'unexpected-response':
      return true;
    case 'auth':
    case 'no-docs-route':
      return false;
  }
}

function FailureContext(p: { readonly answer: DocsNotOk; readonly suggestHref?: (name: string) => string }): ReactNode {
  if (p.answer.s !== 'failed') return null;
  const body = p.answer.body;
  const word: string = body.failure;
  const parts: ReactNode[] = [];
  if (word === 'unresolved-ref') {
    if (body.tried !== undefined && body.tried.length > 0) {
      parts.push(
        <ul key="tried" className="docs-fail-list">
          {body.tried.map((t, i) => (
            <li key={i}><code>{t.ref}</code> {Object.hasOwn(TRIED_RESULT_TEXT, t.result) ? TRIED_RESULT_TEXT[t.result] : t.result}</li>
          ))}
        </ul>,
      );
    }
    if (typeof body.suggest === 'string' && body.suggest !== '') {
      parts.push(
        <p key="suggest" className="docs-fail-suggest">
          Did you mean{' '}
          {p.suggestHref === undefined
            ? <code>{body.suggest}</code>
            : <DocsPageLink href={p.suggestHref(body.suggest)}>{body.suggest}</DocsPageLink>}
          ?
        </p>,
      );
    }
    if (body.hint === 'tag') parts.push(<p key="hint" className="docs-fail-hint">{UNRESOLVED_TAG_HINT}</p>);
  }
  if (word === 'ambiguous-worktree' && body.candidates !== undefined) {
    parts.push(
      <ul key="candidates" className="docs-fail-list">
        {body.candidates.map((c) => <li key={c}><code>{c}</code></li>)}
      </ul>,
    );
  }
  if (word === 'not-a-file' && body.kind !== undefined && Object.hasOwn(NOT_A_FILE_KIND_TEXT, body.kind)) {
    parts.push(<p key="kind" className="docs-fail-kind">{NOT_A_FILE_KIND_TEXT[body.kind]}</p>);
  }
  if (typeof body.stderrHead === 'string' && body.stderrHead !== '') {
    parts.push(<pre key="stderr" className="docs-fail-detail">{body.stderrHead}</pre>);
  }
  return parts;
}

export function DocsFailureView(p: DocsFailureViewProps): ReactNode {
  const { answer } = p;
  const sentence = answer.s === 'failed' ? failureSentence(answer.body) : slotSentence(answer);
  const retry = p.onRetry !== undefined && allowsRetry(answer) ? p.onRetry : undefined;
  const fetchFromOrigin =
    answer.s === 'failed' && answer.body.failure === 'unresolved-ref' ? p.onFetchFromOrigin : undefined;
  return (
    <section
      className="docs-fail"
      role="alert"
      data-state={answer.s}
      data-failure={answer.s === 'failed' ? answer.body.failure : undefined}
    >
      <p className="docs-fail-sentence">{sentence}</p>
      <FailureContext answer={answer} suggestHref={p.suggestHref} />
      {(retry !== undefined || fetchFromOrigin !== undefined) && (
        <div className="docs-fail-actions">
          {fetchFromOrigin !== undefined && (
            <Button variant="ghost" className="docs-fail-action" disabled={p.fetching === true} onClick={fetchFromOrigin}>
              Fetch from origin
            </Button>
          )}
          {retry !== undefined && (
            <Button variant="ghost" className="docs-fail-action" onClick={retry}>Retry</Button>
          )}
        </div>
      )}
      {fetchFromOrigin !== undefined && p.fetchNote != null && (
        <p className="docs-fail-fresh" role="status" data-state={p.fetchNote.state}>{p.fetchNote.text}</p>
      )}
    </section>
  );
}
