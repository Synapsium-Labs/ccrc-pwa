// Shared re-render tick for live readouts (elapsed clocks, relative times) —
// the consolidation of the private useNow hooks that grew in SessionCard,
// SessionHeader and ToolCard (each flagged "Task 14 may consolidate").
import { useEffect, useState } from 'react';

/** Re-render every `intervalMs` while `active`, returning Date.now(). An
 *  inactive hook keeps its last tick — readouts freeze rather than reset. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now()); // (re)activation snaps the readout current
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
