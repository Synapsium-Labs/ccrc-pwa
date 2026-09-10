// New-session sheet — two steps in one sheet. Step 1: pick the account
// (shared AccountRow chips with limit gauges from GET /api/accounts).
// Step 2: pick the project — searchable list from api.projects, with
// registry projects first, most recently active on top. The confirm row
// narrates the action in plain language ("Start OpenClawHetzner on
// team·alt") and posts api.createSession; success closes the sheet (the
// new card arrives over /ws/fleet), failure toasts ccd's stderr and leaves
// every choice in place.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectRow } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { accountLabel } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import {
  AccountRow,
  disabledWrappers,
  factsFor,
  pickableWrappers,
  pickerEmptiness,
} from './SwapSheet';
import { useAccountUsage } from './useProjectedHome';
import './fleet.css';


export interface NewSessionSheetProps {
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store. */
  fleet?: FleetStore;
}

export function NewSessionSheet({
  open,
  onClose,
  fleet = useFleetStore,
}: NewSessionSheetProps): ReactNode {
  const sessions = fleet((s) => s.sessions);
  const roster = fleet((s) => s.roster);
  // The SAME poll the picker's eligibility already came from, now also the
  // source of its gauges — this sheet was fetching every account row and using
  // one boolean off it while reading its numbers off the live fleet frame,
  // which carries no provenance and no row for an account with no live session.
  // One source per fact; see `useAccountUsage`.
  const accounts = useAccountUsage(open);

  const [wrapper, setWrapper] = useState<string | null>(null); // null = step 1
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ProjectRow[] | null>(null); // null = loading
  const [listError, setListError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** `starting` has been true for long enough that "Starting…" is no longer an
   *  honest description of the wait. The server's `start`/`enable` budget is
   *  300 s (the unsupervised fallback settles for up to `SPAWN_SETTLE_S` — a COLD
   *  Claude Code boot against a freshly seeded workspace HOME), so the old
   *  ninety-second failure is gone and the sheet can legitimately sit for
   *  minutes. There is still no cancel — this is the minimum: say what is
   *  happening rather than imply it is nearly done. */
  const [slow, setSlow] = useState(false);

  // Fetch the project list the moment the sheet opens so step 2 is instant.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setList(null);
    setListError(null);
    api.projects().then(
      (r) => {
        if (!cancelled) setList(r.projects);
      },
      (err: unknown) => {
        if (!cancelled) setListError(apiErrorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  // The slow-label clock. Keyed on `starting` alone, so it is armed by the same
  // transition that disables the button and disarmed by every exit from it —
  // including the close-reset below, which sets `starting` back to false.
  useEffect(() => {
    if (!starting) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(t);
  }, [starting]);

  // A closed sheet forgets its choices — reopening starts fresh at step 1.
  useEffect(() => {
    if (open) return;
    setWrapper(null);
    setProject(null);
    setQuery('');
    setStarting(false);
    setSlow(false);
  }, [open]);

  // Registry projects first, most recently active on top; the rest keep the
  // server's order. Recency comes from the fleet snapshot (workdir-keyed).
  const lastActive = new Map<string, number>();
  for (const s of sessions) {
    const at = s.statusUpdatedAt ?? 0;
    const prev = lastActive.get(s.workdir);
    if (prev === undefined || at > prev) lastActive.set(s.workdir, at);
  }
  const ordered =
    list === null
      ? []
      : [...list].sort((a, b) => {
          const ra = lastActive.get(a.workdir);
          const rb = lastActive.get(b.workdir);
          if (ra === undefined && rb === undefined) return 0; // keep server order
          return (rb ?? -1) - (ra ?? -1);
        });
  const needle = query.trim().toLowerCase();
  const filtered =
    needle === '' ? ordered : ordered.filter((p) => p.name.toLowerCase().includes(needle));

  // THE SAME RULE THE SWAP PICKER ASKS, AND THAT IS A DECISION, NOT A SHARED
  // HELPER'S SIDE EFFECT (D-1978). The two surfaces were re-examined separately, because
  // a swap is the RESCUE of a wedged session while this starts a brand-new one,
  // and "a rescue must always have a destination" does not obviously reach a
  // first placement. It reaches it by a different route: the fleet-side twin of
  // THIS sheet is `ws-add`, whose `_ws_least_loaded` was given a condemned-lane
  // fallback tier for exactly this case — "letting it empty this function would
  // let one bad probe run wedge every `ws-add` on the box" — and the server's
  // `projectHome` mirrors it ("filtering condemned lanes out of the fallback
  // altogether answers `null` on an all-condemned fleet"). Both of those are
  // AUTOMATIC placement, which is the stricter setting; a human choosing on
  // purpose is the looser one. So there is no reading on which a new session
  // should be barred from a lane `ws-add` would still place work on, and the
  // two pickers do not diverge. If they ever must, the divergence is a
  // PARAMETER to the shared rule — never a second copy of it here.
  const switchedOff = disabledWrappers(accounts);
  const candidates = pickableWrappers(roster, sessions);
  const wrappers = candidates.filter((w) => !switchedOff.includes(w));
  const emptiness = pickerEmptiness(candidates, wrappers);
  const emptyNote =
    emptiness === null
      ? null
      : emptiness === 'none-known'
        ? 'No accounts to start a session on yet.'
        : 'Every account is switched off on the fleet host — turn one back on from Accounts.';

  const start = async (): Promise<void> => {
    if (wrapper === null || project === null || starting) return;
    setStarting(true);
    try {
      await api.createSession({ wrapper, project: project.name, workdir: project.workdir });
      toast(`Starting ${project.name} on ${accountLabel(roster, wrapper)}…`);
      onClose();
    } catch (err) {
      toast(`Couldn't start — ${apiErrorText(err)}`, 'error');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="new session" title="Start a session">
      {wrapper === null ? (
        <>
          <p className="sheet-copy">Pick the account it runs on — you can move it later.</p>
          <div className="acct-list">
            {/* A lane an OPERATOR switched off is not offered — intent cannot
                be wrong. A lane the health PROBE condemned is offered, marked
                by `AccountRow`, and never suggested: see `disabledWrappers`
                for the ruling and the paragraph above for why this sheet
                answers it the same way SwapSheet does. */}
            {emptyNote === null ? (
              wrappers.map((w) => (
                <AccountRow
                  key={w}
                  wrapper={w}
                  facts={factsFor(accounts, w)}
                  onPick={setWrapper}
                  roster={roster}
                />
              ))
            ) : (
              <p className="acct-none">{emptyNote}</p>
            )}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="acct-change"
            onClick={() => {
              setWrapper(null);
              setProject(null);
            }}
          >
            <span aria-hidden="true">‹</span> on {accountLabel(roster, wrapper)} — change
          </button>
          <input
            className="proj-search"
            type="search"
            placeholder="Search projects"
            aria-label="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {list === null && listError === null ? (
            <Skeleton lines={4} className="proj-skel" />
          ) : listError !== null ? (
            <p className="proj-error" role="alert">
              Couldn't load the project list — {listError}
            </p>
          ) : (
            <div className="proj-list">
              {filtered.map((p) => {
                const selected = p.workdir === project?.workdir;
                return (
                  <button
                    key={p.workdir}
                    type="button"
                    className={selected ? 'proj-row proj-row--selected' : 'proj-row'}
                    onClick={() => setProject(p)}
                  >
                    <span className="proj-glyph" aria-hidden="true">
                      {selected ? '❯' : ''}
                    </span>
                    <span className="proj-name">{p.name}</span>
                    <span className="proj-dir">{p.workdir}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="proj-none">No project matches "{query}"</p>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn-primary sheet-confirm"
            disabled={project === null || starting}
            onClick={() => void start()}
          >
            {starting
              ? (slow ? 'Still starting — a cold session can take minutes' : 'Starting…')
              : project === null
                ? 'Choose a project'
                : `Start ${project.name} on ${accountLabel(roster, wrapper)}`}
          </button>
        </>
      )}
    </Sheet>
  );
}
