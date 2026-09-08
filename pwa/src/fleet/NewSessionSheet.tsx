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
import { AccountRow, factsFor, pickableWrappers, unusableWrappers } from './SwapSheet';
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
            {/* A lane that cannot take work cannot start a session on it
                either — a kill-switched account, or one whose credential the
                health probe measured dead. Offering either here is the same bug
                SwapSheet's picker had, one layer up, and `unusableWrappers` is
                the one rule both pickers ask. */}
            {pickableWrappers(roster, sessions, unusableWrappers(accounts)).map((w) => (
              <AccountRow
                key={w}
                wrapper={w}
                facts={factsFor(accounts, w)}
                onPick={setWrapper}
                roster={roster}
              />
            ))}
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
