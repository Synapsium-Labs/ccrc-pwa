// The name field's preview, live (named workspaces S7, design §4.2: "the PWA debounces it (400 ms) and treats any
// failure as 'show the offline title'"). L4: it owns the timer and the call; what each answer means is
// `workspaceNameWords.ts`'s.
//
// WHAT IS ASKED, AND WHEN. Typing never makes a request by itself. The preview is computed from the grammar at once
// (`localPreview`), and only a name that PARSES AS A TICKET waits `NAME_LOOKUP_DEBOUNCE_MS` after the last keystroke
// and then asks `GET /api/linear/resolve` once. A plain name, an empty field and a refused name ask nothing: the
// server could add nothing to them. An answer that lands for text the field no longer holds is dropped (the effect's
// cleanup), so a slow reply can never repaint a newer name.
//
// A FAILED CALL IS NOT A REFUSAL. A rejected request and an unreadable body both read as `'call-failed'`: the title
// stays what the operator typed, a quiet note says the lookup did not happen, and the create is not blocked: the
// server resolves again at create (design §4.2, "the create resolves too").
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { localPreview, needsLookup, withLookup, type NamePreview, type ResolveRead } from './workspaceNameWords';

/** The wait after the last keystroke before a ticket is looked up (design §4.2). */
export const NAME_LOOKUP_DEBOUNCE_MS = 400;

interface Answered { text: string; answer: ResolveRead | 'call-failed' }

/** `enabled: false` is a door that cannot take a name (its field is disabled): the preview is `empty` and NOTHING is
 *  asked, because text the door will never send is not worth a Linear call on the operator's behalf. `keepSlug` is the
 *  rename door's: the workspace's own slug, and the preview then reads a title and not a slug (`localPreview`). */
export function useNamePreview(
  value: string,
  { enabled = true, debounceMs = NAME_LOOKUP_DEBOUNCE_MS, keepSlug }: { enabled?: boolean; debounceMs?: number; keepSlug?: string } = {},
): NamePreview {
  const local = useMemo<NamePreview>(
    () => (enabled ? localPreview(value, keepSlug === undefined ? undefined : { keepSlug }) : { kind: 'empty' }),
    [value, enabled, keepSlug],
  );
  const [answered, setAnswered] = useState<Answered | null>(null);
  const text = value.trim();
  const wanted = needsLookup(local);

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.linearResolve(text).then(
        (read) => { if (live) setAnswered({ text, answer: read === 'unreadable' ? 'call-failed' : read }); },
        () => { if (live) setAnswered({ text, answer: 'call-failed' }); },
      );
    }, debounceMs);
    return () => { live = false; clearTimeout(timer); };
  }, [wanted, text, debounceMs]);

  return answered !== null && answered.text === text ? withLookup(local, answered.answer) : local;
}
