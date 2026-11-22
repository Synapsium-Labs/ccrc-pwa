// The console's `opened` receipts (Overlord W1, C67), L4: posted once per mount with the page's first render, never
// retried, the failure swallowed and shown nowhere (a lost receipt reads `unmeasured`, never as no open).
import { useEffect, useRef } from 'react';
import { RECEIPTS_MAX_PER_BODY, type ResponseRef } from '../../../shared/responses';
import { api } from '../lib/api';

/** Posts one `opened` receipt for each of `refs` not yet posted by this mount, in bodies of at most
 *  `RECEIPTS_MAX_PER_BODY`; a re-render posts nothing, a ref that newly appears (another day's lines) is posted once. */
export function useOpenedReceipt(refs: readonly ResponseRef[]): void {
  const sent = useRef(new Set<string>());
  useEffect(() => {
    const fresh = refs.filter((r) => !sent.current.has(JSON.stringify(r)));
    for (const r of fresh) sent.current.add(JSON.stringify(r));
    for (let i = 0; i < fresh.length; i += RECEIPTS_MAX_PER_BODY) {
      const body = fresh.slice(i, i + RECEIPTS_MAX_PER_BODY).map((ref) => ({ ref, receipt: 'opened' as const, from: { source: 'console' as const } }));
      try { api.postResponseReceipts(body).catch(() => {}); } catch { /* a receipt never shows */ }
    }
  }, [refs]);
}
