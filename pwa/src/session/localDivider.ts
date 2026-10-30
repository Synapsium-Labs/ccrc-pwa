// The local-divider predicate, read by the session store and the chat items.
// The minting (`localDivider`, its counter and its clock) stays in the store.
import type { ChatEvent } from '../../../shared/api';

/** A divider `stores/session.ts` minted, stamped with the PHONE's clock — never a
 *  transcript time. Exported so every reader of event time skips it the same
 *  way (`stores/session.ts#newestTranscriptTs`, the quiet-gap divider in `ChatList`). */
export const isLocalDivider = (e: ChatEvent): boolean =>
  e.kind === 'system' && e.uuid.startsWith('local-');
