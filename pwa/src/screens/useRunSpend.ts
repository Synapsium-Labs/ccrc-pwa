// L4 (D-6799): one read of a run's spend per row mount. Not polled - the figure
// moves once per usage-sweep pass (hours), and the row re-mounts when the board does.
// Always asked, even for a run with no session bound now: the SERVER is the one judge of
// 'no-session', because an unbound run may have had a session before (workspace-spent).
import { useEffect, useState } from 'react';
import type { RunSpend, RunSummary } from '../../../shared/api';

export function useRunSpend(run: Pick<RunSummary, 'id'>, load: (id: number) => Promise<RunSpend>): RunSpend | undefined {
  const [spend, setSpend] = useState<RunSpend | undefined>(undefined);
  useEffect(() => {
    let live = true;
    load(run.id).then(
      (s) => { if (live) setSpend(s); },
      // A failed load (signed out, rate-limited, unknown run, network) says nothing about the sweep file,
      // so it shows NO line rather than 'the usage sweep could not be read'.
      () => { if (live) setSpend(undefined); },
    );
    return () => { live = false; };
    // `load` is the screen's stable default: re-asking on its identity would re-read on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);
  return spend;
}
