// A user turn typed in the Overlord's pane, not from the console (Overlord W1, the chat, Task 4; plan question 6, ruled F9):
// any process of the fleet user can type there, so it is never drawn as the operator's words. Its text is data: plain,
// never markdown, in a style no operator bubble uses. L4: it draws and decides nothing.
import type { ReactNode } from 'react';
import { PANE_TURN_WORDS } from './chatWords';

export function PaneTurn({ text }: { text: string }): ReactNode {
  return (
    <figure className="oc-pane-turn">
      <figcaption className="oc-pane-turn-label">{PANE_TURN_WORDS}</figcaption>
      <pre className="oc-pane-turn-text">{text}</pre>
    </figure>
  );
}
