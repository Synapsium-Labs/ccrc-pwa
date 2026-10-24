// L4 (D-6799): one read of a run's spend per row mount. Not polled - the figure
// moves once per usage-sweep pass (hours), and the row re-mounts when the board does.
import { useEffect, useState } from 'react';
import type { RunSpend, RunSummary } from '../../../shared/api';

export function useRunSpend(run: Pick<RunSummary, 'id' | 'sessionId'>, load: (id: number) => Promise<RunSpend>): RunSpend | undefined {
  const asked = run.sessionId !== null;
  const [spend, setSpend] = useState<RunSpend | undefined>(undefined);
  useEffect(() => {
    if (!asked) return undefined;
    let live = true;
    load(run.id).then(
      (s) => { if (live) setSpend(s); },
      () => { if (live) setSpend({ measured: false, reason: 'unreadable' }); },
    );
    return () => { live = false; };
    // `load` is the screen's stable default: re-asking on its identity would re-read on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, asked]);
  return asked ? spend : { measured: false, reason: 'no-session' };
}
