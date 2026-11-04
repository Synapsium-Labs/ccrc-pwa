// The inspector's doors into the open session (console speed, task C1; review 1464 F4). Each runs a command the session
// screen's `SessionFlows` answers (`session-pr`, `session-model`, `session-effort`, `open-history`), and the inspector is
// eager while that screen is a lazy chunk: until the screen has loaded and published its command target, the command
// layer has no one to run them, so a tap would do nothing. Until then each door is drawn `aria-disabled`, says it is
// not ready yet, and its tap is inert; once the target is published it is the ordinary `commandDoor`.
import { commandDoor } from '../command/door';
import { useSessionCommandTarget } from '../session/SessionFlows';

/** What a door says while the session screen is still loading. */
export const SESSION_NOT_YET = 'The session is still opening';

export interface SessionDoor {
  readonly 'data-command': string;
  readonly onClick: () => void;
  /** Present only while the session screen has not published its target. */
  readonly 'aria-disabled'?: 'true';
  readonly title?: string;
}

/** The props of an inspector door that runs session command `id`: inert, and marked so, until the screen can run it. */
export function useSessionDoor(id: string): SessionDoor {
  const ready = useSessionCommandTarget() !== null;
  if (ready) return commandDoor(id);
  return { 'data-command': id, onClick: () => {}, 'aria-disabled': 'true', title: SESSION_NOT_YET };
}
