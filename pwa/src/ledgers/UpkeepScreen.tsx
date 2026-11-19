// `/projects/<project>/upkeep` (Linear hierarchy design §7.6 and §11.2, D-8184): a project's Upkeep epic, the same body as the
// epic page with no checkpoints, and the inbound closes Linear refused. A screen of the ladder, ring L4: it reads
// `GET /api/projects/:project/upkeep` once on arrival and decides nothing: the sentences are `epicWords.ts`'s.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { EpicView } from '../../../shared/plan';
import { api, type UpkeepClose } from '../lib/api';
import { apiErrorText } from '../lib/refusalWords';
import { ROUTES } from '../lib/routes';
import { EpicBody, EpicFrame, EpicLine } from './EpicBody';
import { EPIC_TEXT, dayWords, notClosedWords } from './epicWords';
import { Back } from './WaitingRoutes';

/** Not answered, failed (with its fixed sentence), or the epic (null before its first use) and the closes Linear refused. */
type UpkeepRead =
  | { readonly kind: 'reading' }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'ok'; readonly epic: EpicView | null; readonly notClosed: readonly UpkeepClose[] };

const SETTINGS_PATH: string = ROUTES.find((r) => r.id === 'settings-security')?.path ?? '/settings';

function useUpkeepRead(project: string): UpkeepRead {
  const [read, setRead] = useState<{ project: string; read: UpkeepRead }>({ project, read: { kind: 'reading' } });
  useEffect(() => {
    let live = true;
    api.upkeep(project).then(
      (a) => { if (live) setRead({ project, read: a.ok === true ? { kind: 'ok', epic: a.epic, notClosed: a.notClosed } : { kind: 'failed', text: EPIC_TEXT.readFailed } }); },
      (err: unknown) => { if (live) setRead({ project, read: { kind: 'failed', text: apiErrorText(err) } }); },
    );
    return () => { live = false; };
  }, [project]);
  return read.project === project ? read.read : { kind: 'reading' };
}

function Head({ project }: { project: string }): ReactNode {
  return (
    <header className="ep-head">
      <Back to={SETTINGS_PATH} label={EPIC_TEXT.backSettings} />
      <span className="ep-kicker">{EPIC_TEXT.upkeepKicker}</span>
      <h1 className="ep-name">{EPIC_TEXT.upkeepTitle}</h1>
      <p className="ep-summary">{project}</p>
    </header>
  );
}

function NotClosedSection({ rows }: { rows: readonly UpkeepClose[] }): ReactNode {
  return (
    <section className="ep-col ep-notclosed" aria-label={EPIC_TEXT.notClosedHeading}>
      <h2 className="ep-h">{EPIC_TEXT.notClosedHeading}</h2>
      {rows.length === 0
        ? <p className="wl-note">{EPIC_TEXT.notClosedNone}</p>
        : (
          <ul className="ep-list">
            {rows.map((r) => (
              <li key={`${r.teamKey}-${r.identifier}`} className="ep-row">
                <span className="ep-title">{`${r.identifier}: ${notClosedWords(r.word)}`}</span>
                {r.at !== null && <span className="ep-meta"><span>{dayWords(r.at)}</span></span>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export function UpkeepScreen({ project }: { project: string }): ReactNode {
  const read = useUpkeepRead(project);
  const head = <Head project={project} />;
  if (read.kind === 'reading') return <EpicLine head={head} line={EPIC_TEXT.readingUpkeep} role="status" />;
  if (read.kind === 'failed') return <EpicLine head={head} line={read.text} role="alert" />;
  const closes = <NotClosedSection rows={read.notClosed} />;
  if (read.epic === null) {
    return <EpicFrame>{head}<p className="wl-note" role="status">{EPIC_TEXT.noUpkeepYet}</p>{closes}</EpicFrame>;
  }
  return <EpicBody epic={read.epic} showCheckpoints={false} head={head} after={closes} />;
}
