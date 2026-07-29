// New-session sheet — two steps in one sheet. Step 1: pick the account
// (shared AccountRow chips with live limit gauges from the fleet store).
// Step 2: pick the project — searchable list from api.projects, with
// registry projects first, most recently active on top. The confirm row
// narrates the action in plain language ("Start OpenClawHetzner on
// alt·max") and posts api.createSession; success closes the sheet (the
// new card arrives over /ws/fleet), failure toasts ccd's stderr and leaves
// every choice in place.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { accountLabel } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { AccountRow, limitsFor, pickableWrappers } from './SwapSheet';
import { useDisabledWrappers } from './useProjectedHome';
import './fleet.css';

interface Project {
  name: string;
  workdir: string;
}

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
  const disabledWrappers = useDisabledWrappers(open);

  const [wrapper, setWrapper] = useState<string | null>(null); // null = step 1
  const [project, setProject] = useState<Project | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Project[] | null>(null); // null = loading
  const [listError, setListError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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

  // A closed sheet forgets its choices — reopening starts fresh at step 1.
  useEffect(() => {
    if (open) return;
    setWrapper(null);
    setProject(null);
    setQuery('');
    setStarting(false);
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
      toast(`Starting ${project.name} on ${accountLabel(wrapper)}…`);
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
            {/* A kill-switched lane cannot start a session either — offering
                it here is the same bug SwapSheet's picker had, one layer up. */}
            {pickableWrappers(sessions, disabledWrappers).map((w) => (
              <AccountRow
                key={w}
                wrapper={w}
                limits={limitsFor(sessions, w)}
                onPick={setWrapper}
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
            <span aria-hidden="true">‹</span> on {accountLabel(wrapper)} — change
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
              ? 'Starting…'
              : project === null
                ? 'Choose a project'
                : `Start ${project.name} on ${accountLabel(wrapper)}`}
          </button>
        </>
      )}
    </Sheet>
  );
}
