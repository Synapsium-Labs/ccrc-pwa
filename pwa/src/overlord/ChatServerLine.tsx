// The server's line under an operator message in the Overlord chat (Overlord W1, the chat, Task 4): what the Overlord was
// doing when the message was recorded, in the server's voice, never a bubble. L4: it draws and decides nothing.
import type { ReactNode } from 'react';

export function ChatServerLine({ text }: { text: string }): ReactNode {
  return <p className="oc-server-line" role="note">{text}</p>;
}
