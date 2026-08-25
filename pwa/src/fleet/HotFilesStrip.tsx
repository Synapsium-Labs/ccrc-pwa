// Hot files — the fleet's ACTIVE claims, each with its holder's stated
// intent (Build 9 D12 ruling 3: the naming sweep freezes a held workspace's
// ai-title, so `intent` is the REPLACEMENT signal — a branch name is written
// once; an intent can be written every ten minutes). MailStrip's shape:
// collapsed to one headline, expanding to rows, rendering NOTHING when no
// claim is live — a fleet not running a program must not pay a row for it.
// AccountsStrip's poll idiom: this strip owns its own GET /api/claims
// cadence rather than coupling to a store no frame feeds — claims ship no
// WS frame (the wire is additive-only and a 30 s poll is plenty for a
// 45-minute lease).
//
// READ-ONLY BY DESIGN: no release, no break. Release is the holding
// SESSION's own door, and the break door is the operator's, deliberately
// unnamed everywhere — a strip that could break a claim from a phone tap
// would be an enforcement surface for a mechanism D12 rules advisory.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClaimSummary } from '../../../shared/api';
import { api } from '../lib/api';
import { useNow } from '../lib/useNow';
import './fleet.css';

export const CLAIMS_POLL_MS = 30_000;

/** 'expires in 12m' | 'expires in <1m' | 'expires in 2h' — local, like
 *  lifecycleWords' elapsed: there is still no shared time-formatting module
 *  to import from. */
function expiresIn(at: number, now: number): string {
  const m = Math.floor((at - now) / 60_000);
  if (m < 1) return 'expires in <1m';
  return m < 60 ? `expires in ${m}m` : `expires in ${Math.floor(m / 60)}h`;
}

export function HotFilesStrip(): ReactNode {
  const [claims, setClaims] = useState<readonly ClaimSummary[]>([]);
  const [open, setOpen] = useState(false);
  const now = useNow(30_000);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      void api.claims().then((r) => {
        if (!live) return;
        // `Array.isArray`, not bare trust — AccountsStrip's own rule for a
        // stub or an older server answering with a shape this build never
        // asked for; keep the last good list rather than clobbering it.
        if (Array.isArray(r.claims)) setClaims(r.claims);
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, CLAIMS_POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, []);

  // `=== 'live'` — never a guard-map over `state`: a token a newer server
  // mints is simply not live, which is the safe direction for a strip whose
  // one question is "what is contested RIGHT NOW".
  const liveClaims = claims.filter((c) => c.state === 'live');
  if (liveClaims.length === 0) return null;

  return (
    <section className={open ? 'hotfiles hotfiles--open' : 'hotfiles'} aria-label="Hot files">
      <button type="button" className="hotfiles-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="hotfiles-mark" aria-hidden="true">✋</span>
        <span className="hotfiles-headline">
          {liveClaims.length === 1 ? '1 hot-file claim' : `${liveClaims.length} hot-file claims`}
        </span>
        <span className="hotfiles-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <ol className="hotfiles-rows">
          {liveClaims.map((c) => (
            <li key={c.id} className="hotfiles-row">
              <span className="hotfiles-holder">{c.heldBy}</span>
              <span className="hotfiles-expiry">{expiresIn(c.expiresAt, now)}</span>
              {/* Intent is free text off the wire — rendered VERBATIM,
                  parsed nowhere: `.sess-held`'s rule for the hold reason. */}
              {c.intent !== null && c.intent !== '' && (
                <span className="hotfiles-intent">{c.intent}</span>
              )}
              {/* Paths render project-qualified — the claim's own key is
                  (project, path), and a bare `shared/api.ts` on a mixed
                  fleet names half a fact. */}
              <ul className="hotfiles-paths">
                {c.paths.map((p) => (
                  <li key={p} className="hotfiles-path">{c.project}/{p}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
