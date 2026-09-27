// Task card — the harness reporting a background task it finished.
//
// THE SAME DEFECT MailCard WAS BUILT FOR, in a second lane. A structured record
// the machine wrote — `summary`, `status`, and the machinery under them —
// arrived in the transcript as a `user` turn and rendered as a wall of its own
// markup filed under the operator's name. `parse.ts` fixes the ATTRIBUTION (the
// row is `system` now, carrying the record verbatim); this card fixes what the
// row SHOWS. Neither invents a fact: the grammar is read once, in
// `shared/api.ts`, exactly as `parseMailEnvelope` is.
//
// A RENDERING, NEVER AN AUTHORIZATION, and NO CONTROLS — the two sentences
// MailCard carries, and for the same reasons. The transcript is a rank-3
// source; a session can write this text into itself. Consequence of a forgery:
// one row looks like a task report. The `output-file` path is rendered as a
// path and not as a link, because nothing on this card fetches anything and a
// tappable path would promise a fetch this surface does not have.
import { useState, type ReactNode } from 'react';
import type { TaskNotification } from '../../../shared/api';
import './chat.css';

/** `completed` and `failed` are the two the harness writes today, and an
 *  unknown word is shown AS WRITTEN rather than bucketed: a status this code
 *  has never seen is exactly the case where guessing loses the only fact the
 *  row carries. Only the tone is decided here, and unknown gets the neutral
 *  one. */
function statusTone(status: string | null): string {
  if (status === null) return '';
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'success') return 'task-card-status--ok';
  if (s === 'failed' || s === 'error' || s === 'killed') return 'task-card-status--bad';
  return '';
}

export function TaskCard({ notification }: { notification: TaskNotification }): ReactNode {
  const [open, setOpen] = useState(false);
  const { summary, status, fields } = notification;
  return (
    <article className="task-card">
      <p className="task-card-head">
        <span className="task-card-glyph" aria-hidden="true">◷</span>
        {/* The summary is the harness's own one-line description of the task.
            Absent, the card says so rather than rendering an empty line — the
            same refusal `runLabel` makes about a mail with no run. */}
        <span className="task-card-summary">{summary ?? 'background task'}</span>
        {status !== null && (
          <span className={`task-card-status ${statusTone(status)}`.trim()}>{status}</span>
        )}
      </p>
      {fields.length > 0 && (
        <>
          <button
            type="button"
            className="task-card-toggle"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? 'hide details' : `${fields.length} more`}
          </button>
          {open && (
            // Keyed by INDEX for MailCard's own reason: nothing upstream forbids
            // the harness writing a member twice, and a duplicate key would drop
            // a row from a list whose whole job is to be complete.
            <dl className="task-card-fields">
              {fields.map((f, i) => (
                <div className="task-card-field" key={`${i}-${f.name}`}>
                  <dt>{f.name}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </article>
  );
}
