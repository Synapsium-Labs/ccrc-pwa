// Tag a project into a roster-derived account pool, or clear its tag. There is
// intentionally no free-text field: a name no account carries creates a pool
// that strands every session it constrains.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectPoolWire, ProjectPoolsWire } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';
import { poolOptions, projectPoolOf } from '../lib/pools';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

export interface PoolSheetProps {
  /** `null` while no project card has been selected. */
  project: string | null;
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store. */
  fleet?: FleetStore;
}

interface Scope {
  project: string | null;
  open: boolean;
  fleet: FleetStore;
}

interface MeasuredPool {
  pool: ProjectPoolWire;
  generation: number;
  /** The pools frame present when the route's read-back arrived. */
  frame: number;
}

interface FrameIdentity {
  pools: ProjectPoolsWire | null;
  number: number;
}

const sameScope = (left: Scope, right: Scope): boolean =>
  left.project === right.project && left.open === right.open && left.fleet === right.fleet;

const measuredToast = (project: string, pool: ProjectPoolWire): string =>
  pool.state === 'tagged'
    ? `${project} is in pool ${pool.name}.`
    : pool.state === 'untagged'
      ? `${project} is no longer in a pool.`
      : pool.state === 'malformed'
        ? `${project}'s pool tag is malformed.`
        : pool.state === 'unreadable'
          ? `${project}'s pool tag could not be read.`
          : `This app is older than the fleet; reload to understand ${project}'s pool.`;

/** A sheet whose request and frame relevance are both governed by ONE monotonically
 * increasing generation. Every write and every scope transition invalidates work
 * captured before it, so an old route response cannot affect a reopened sheet. */
export function PoolSheet({ project, open, onClose, fleet = useFleetStore }: PoolSheetProps): ReactNode {
  const roster = fleet((state) => state.roster);
  const pools = fleet((state) => state.pools);

  const generation = useRef(0);
  const scope = useRef<Scope>({ project, open, fleet });
  const frame = useRef<FrameIdentity>({ pools: fleet.getState().pools, number: 0 });
  const [measured, setMeasured] = useState<MeasuredPool | null>(null);
  const [savingGeneration, setSavingGeneration] = useState<number | null>(null);

  // This happens during render, before an old continuation can run after its
  // parent has closed, reopened, or pointed this mounted sheet at another card.
  const nextScope: Scope = { project, open, fleet };
  if (!sameScope(scope.current, nextScope)) {
    scope.current = nextScope;
    generation.current += 1;
  }

  useEffect(() => {
    // Zustand notifies synchronously for each assigned pools frame. Its monotonically
    // increasing identity lets a 200 distinguish the frame already on screen from
    // the first frame that arrives after the response.
    frame.current = { pools: fleet.getState().pools, number: frame.current.number };
    return fleet.subscribe((state, previous) => {
      if (state.pools !== previous.pools) {
        frame.current = { pools: state.pools, number: frame.current.number + 1 };
      }
    });
  }, [fleet]);

  useEffect(() => {
    // The frame is durable; a closed/reopened or re-targeted sheet starts from it.
    setMeasured(null);
    setSavingGeneration(null);
  }, [open, project, fleet]);

  useEffect(() => () => {
    // A request that resolves after unmount has no surviving sheet to update.
    generation.current += 1;
  }, []);

  const visibleMeasured = measured !== null
    && measured.generation === generation.current
    && frame.current.number <= measured.frame
    ? measured.pool
    : null;
  const current = visibleMeasured ?? projectPoolOf(pools, project ?? '');
  const options = poolOptions(roster);
  const saving = savingGeneration === generation.current;

  const setPool = (pool: string | null): void => {
    if (project === null || !open || saving) return;

    // One generation covers request relevance and the response/frame ordering.
    // A newer write invalidates any previous write before it can settle.
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    const requestProject = project;
    setMeasured(null);
    setSavingGeneration(requestGeneration);

    const stillRelevant = (): boolean =>
      generation.current === requestGeneration
      && scope.current.project === requestProject
      && scope.current.open;

    void api.setProjectPool(requestProject, pool).then(
      (response) => {
        const responseFrame = frame.current.number;
        // The route re-read this state on the box. Keep it only until the first
        // pools frame that arrives after this response, not a frame already seen.
        // State and toast each need their own relevance check because either
        // continuation can synchronously prompt an embedding parent to rerender.
        if (stillRelevant()) {
          setMeasured({ pool: response.pool, generation: requestGeneration, frame: responseFrame });
        }

        if (stillRelevant()) {
          if (response.warning === 'unknown-pool' && pool !== null) {
          toast(
            `Tagged ${requestProject}, but no account on this box is in pool ${pool} — sessions there will strand rather than cross.`,
            'error',
          );
          } else {
            toast(measuredToast(requestProject, response.pool));
          }
        }
      },
      (error: unknown) => {
        if (!stillRelevant()) return;
        toast(`Couldn't set the pool — ${apiErrorText(error)}`, 'error');
      },
    ).finally(() => {
      // This same generation guard prevents a stale request clearing its successor's spinner.
      if (!stillRelevant()) return;
      setSavingGeneration(null);
    });
  };

  if (project === null) return null;

  const path = `~/.cc-sessions/pools/${project}`;
  // `null` is no frame, not a measured untagged project. A future member state
  // is neither unreadable nor malformed: this app is simply older than its fleet.
  const currentCopy =
    current === null
      ? `This box has not said which pool ${project} is in.`
      : current.state === 'tagged'
        ? `${project} is in pool ${current.name}.`
        : current.state === 'untagged'
          ? `${project} is in no pool — every account may serve it.`
          : current.state === 'malformed'
            ? `The pool tag for ${project} is malformed: ${path} holds something that is not a pool name.`
            : current.state === 'unreadable'
              ? `The pool tag for ${project} could not be read: ${path}.`
              : `This app is older than the fleet; reload to understand ${project}'s pool.`;

  return (
    <Sheet open={open} onClose={onClose} eyebrow="project pool" title="Which pool runs this project?">
      <p className="sheet-copy">
        {currentCopy}{' '}
        An account may serve a project when either side is untagged or the names agree.
      </p>
      <div className="pool-list">
        {options.map((name) => (
          <button
            key={name}
            type="button"
            className="pool-row"
            disabled={saving}
            aria-label={`pool ${name}`}
            onClick={() => setPool(name)}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          className="pool-row"
          data-none="true"
          disabled={saving}
          aria-label="no pool — every account may serve it"
          onClick={() => setPool(null)}
        >
          no pool
        </button>
      </div>
    </Sheet>
  );
}
