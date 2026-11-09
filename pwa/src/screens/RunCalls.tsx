// A run's calls (D-8126): every class of call that names the run, collapsed, read only. An older server's record has no
// `calls`, and then nothing is drawn. L4: it draws what it is given and decides nothing.
import type { ReactNode } from 'react';
import type { CallView } from '../../../shared/api';
import { RUN_CALLS_WORDS, runCallLine } from '../fleet/runDetailWords';

export function RunCalls({ calls }: { calls: readonly CallView[] | undefined }): ReactNode {
  if (calls === undefined || calls.length === 0) return null;
  return (
    <details className="rd-calls rd-group" data-group="calls">
      <summary className="rd-calls-sum">{RUN_CALLS_WORDS(calls.length)}</summary>
      <ul className="rd-calls-list">
        {calls.map((c) => <li key={c.id} className="rd-call" data-call={c.id}>{runCallLine(c)}</li>)}
      </ul>
    </details>
  );
}
