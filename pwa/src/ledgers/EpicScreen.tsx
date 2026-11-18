// `/programmes/<slug>/epics/<key>` (Linear hierarchy design §11.2, D-8184): one epic of a programme's plan. A screen of the
// ladder, ring L4: it reads `GET /api/programmes/:slug/plan` once on arrival and draws what the plan says. It decides nothing:
// every sentence is `epicWords.ts`'s, a refused programme and a failed read are two words (never one `null`), and a key the plan
// does not have is "No such epic in this programme".
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlanView } from '../../../shared/plan';
import { api, ApiError } from '../lib/api';
import { apiErrorText } from '../lib/refusalWords';
import { programmePath } from '../lib/routes';
import { EpicBody, EpicHead, EpicLine } from './EpicBody';
import { EPIC_TEXT } from './epicWords';
import { Back } from './WaitingRoutes';

/** What the read of the plan has come to: not answered, the server refused the slug (400), the read failed (with its
 *  fixed sentence), or the plan. Four conditions, four values. */
type PlanRead =
  | { readonly kind: 'reading' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'ok'; readonly plan: PlanView };

function usePlanRead(slug: string): PlanRead {
  const [read, setRead] = useState<{ slug: string; read: PlanRead }>({ slug, read: { kind: 'reading' } });
  useEffect(() => {
    let live = true;
    api.plan(slug).then(
      (a) => { if (live) setRead({ slug, read: a.ok === true && a.plan.program === slug ? { kind: 'ok', plan: a.plan } : { kind: 'failed', text: EPIC_TEXT.readFailed } }); },
      (err: unknown) => {
        if (!live) return;
        // An unknown programme answers 200 with no epics (`planRoutes.ts`), so only a malformed slug (400) is a refused programme;
        // a 404 means a server with no plan route (an older build): a failed read, never "No such programme".
        const refused = err instanceof ApiError && err.status === 400;
        setRead({ slug, read: refused ? { kind: 'refused' } : { kind: 'failed', text: apiErrorText(err) } });
      },
    );
    return () => { live = false; };
  }, [slug]);
  return read.slug === slug ? read.read : { kind: 'reading' };
}

const barHead = (slug: string): ReactNode => (
  <header className="ep-head"><Back to={programmePath(slug)} label={EPIC_TEXT.backProgramme} /><h1 className="ep-kicker">{EPIC_TEXT.kicker}</h1></header>
);

export function EpicScreen({ slug, epicKey }: { slug: string; epicKey: string }): ReactNode {
  const read = usePlanRead(slug);
  const head = barHead(slug);
  if (read.kind === 'reading') return <EpicLine head={head} line={EPIC_TEXT.reading} role="status" />;
  if (read.kind === 'refused') return <EpicLine head={head} line={EPIC_TEXT.noSuchProgramme} role="status" />;
  if (read.kind === 'failed') return <EpicLine head={head} line={read.text} role="alert" />;
  const epic = read.plan.epics.find((e) => e.key === epicKey);
  if (epic === undefined) return <EpicLine head={head} line={EPIC_TEXT.noSuchEpic} role="status" />;
  return <EpicBody epic={epic} showCheckpoints head={<EpicHead epic={epic} back={<Back to={programmePath(slug)} label={EPIC_TEXT.backProgramme} />} />} />;
}
