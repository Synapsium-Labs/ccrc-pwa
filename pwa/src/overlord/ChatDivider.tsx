// A generation's divider in the Overlord chat (Overlord W1, the chat, Task 4): "generation n", or "term t, generation n" at
// the first of a new term, with what its earlier text offers (`chatWords.ts#earlierWords`): a page to show, or where to read
// it. An earlier page, once asked for, is drawn under it. L4: it draws and decides nothing.
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import type { ChatEntry } from '../../../shared/overlordChat';
import { dividerWords, earlierWords } from './chatWords';

type Divider = Extract<ChatEntry, { kind: 'divider' }>;

export function ChatDivider({ divider, onShow, busy = false, children }: {
  divider: Divider;
  /** Asks for this generation's (next) earlier page. */
  onShow?: () => void;
  busy?: boolean;
  /** The earlier page's rows, drawn under the divider. */
  children?: ReactNode;
}): ReactNode {
  const offer = earlierWords(divider);
  return (
    <section className="oc-divider" data-current={divider.current || undefined} aria-label={dividerWords(divider)}>
      <p className="oc-divider-label">{dividerWords(divider)}</p>
      {offer !== null && (divider.earlier === 'readable' && onShow !== undefined
        ? <Button variant="ghost" size="fit" disabled={busy} onClick={onShow}>{offer}</Button>
        : <p className="oc-divider-where">{offer}</p>)}
      {children}
    </section>
  );
}
