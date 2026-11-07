// Delegation broker wave 5, PR10 (Task 5.10.2): a project card over one `delegation` frame, with `fetch` stubbed, for the
// worktree controls. Neither `pwa/test/project-card.test.tsx` nor the visibility release has these helpers, so the plan's
// three live here: `renderCard(world, { fetch })` draws `ProjectCard` over `fleetTree` and `withRunBinding`, exactly as
// project-card.test.tsx's delegation renders do, with both delegation groups open; `worldWithLease(over)` is a world whose
// frame holds one worktree row (`delegationFixture`'s `lease`, a newer server's: it carries a disposition and an expiry,
// with `over` applied last, so a test can drop them); `okJson(body)` is a `Response` with status 200 and that JSON.
// `cardElement(world)` is the card itself, with the app's toast host, for a `rerender` to a changed frame.
// Neutral names only (`project-a`, `coord-a`, `worker-a`). A test that calls `renderCard` unstubs globals after itself.
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ToastHost } from '@ccrc/ui';
import type { DelegationLeaseWire, DelegationProjectionWire, DelegationUnownedWire, FleetSession } from '../../shared/api';
import { ProjectCard } from '../src/fleet/ProjectCard';
import { fleetTree } from '../src/fleet/fleetTree';
import { fleetSession } from './fleetFixture';
import { withRunBinding } from './runBindingFixture';
import { frame, lease, unowned } from './delegationFixture';

/** A worktree id the doors accept: a lease id is a UUID. */
export const LEASE_ID = '0b0c3f8e-5d55-4c1e-9a77-2f1d8c3e4a10';
/** The card's clock in these tests: 2026-11-07, so a date in 2026 is drawn without its year. */
export const CARD_NOW = Date.parse('2026-11-07T09:00:00.000Z');

export const COORD_A: FleetSession = fleetSession({
  id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a',
});

export interface CardWorld { readonly frame: DelegationProjectionWire; readonly sessions: readonly FleetSession[] }

/** One worktree row under `coord-a`, as a newer server sends it. */
export function worldWithLease(over: Partial<DelegationLeaseWire> = {}, sessions: readonly FleetSession[] = [COORD_A]): CardWorld {
  return { frame: frame({ leases: [lease({ leaseId: LEASE_ID, disposition: 'ephemeral', expiresAt: null, ...over })] }), sessions };
}
/** One unowned row on `project-a`, with `over` applied. */
export function worldWithUnowned(over: Partial<DelegationUnownedWire> = {}): CardWorld {
  return { frame: frame({ unowned: [unowned(over)] }), sessions: [COORD_A] };
}

/** A 200 whose body is `body`, as JSON. */
export const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type CardFetch = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** The card over `world`, both delegation groups open, with the app's toast host beside it. */
export function cardElement(world: CardWorld): ReactElement {
  const group = fleetTree(withRunBinding([...world.sessions], []), [], [], {}, world.frame).find((g) => g.project === 'project-a');
  if (group === undefined) throw new Error('no project-a card');
  return <><ProjectCard group={group} onOpen={() => {}} onActions={() => {}} offlineOpen unownedOpen nowMs={CARD_NOW} /><ToastHost /></>;
}

/** The card over `world`, with `fetch` answering through `opts.fetch` (by default a 500, so a test that did not expect a
 *  call sees one fail). Re-render another world with `rerender(cardElement(next))`. */
export function renderCard(world: CardWorld, opts: { fetch?: CardFetch } = {}): RenderResult {
  const answer: CardFetch = opts.fetch ?? (() => okJson({ error: 'unexpected-call' }, 500));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => answer(String(input), init)));
  return render(cardElement(world));
}
