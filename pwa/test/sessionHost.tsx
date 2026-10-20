// The session header's host for suites that render the header alone (W2 Task S2d; `session-host-test-wrapper`).
//
// `SessionHeader` no longer owns the ⋯ menu, the PR sheet or the Escape interrupt: `SessionScreen` hosts
// `SessionFlows` around it and calls `useEscapeInterrupt` once, and every menu item, chip and keycap that runs a
// session command is a `commandDoor`, run by the one `CommandLayer`. A suite that rendered `<SessionHeader {...p}/>`
// with the old handler props renders `<SessionHeaderHost {...p}/>` instead: the same props, wired the way
// `SessionScreen` wires them, so no assertion changes. One helper rather than a copy per suite (D-5676's reason), so
// the host a test mounts is the one the screen mounts.
import type { ReactNode } from 'react';
import { CommandLayer } from '../src/command/CommandLayer';
import { SessionFlows } from '../src/session/SessionFlows';
import { SessionHeader, type SessionHeaderProps } from '../src/session/SessionHeader';
import { useEscapeInterrupt } from '../src/session/useEscapeInterrupt';

/** The header's props as they were before the lift: the flows' handlers beside the header's own. */
export interface HeaderHostProps extends SessionHeaderProps {
  onOpenTerminal: () => void;
  onChangeModel: () => void;
  onChangeEffort: () => void;
  onMoveAccount: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onOpenHistory: () => void;
  onReapWorkspace: () => void;
  /** False where the suite mounts its own `CommandLayer` (two layers would run each door twice). */
  layer?: boolean;
}

export function SessionHeaderHost(
  {
    onOpenTerminal, onChangeModel, onChangeEffort, onMoveAccount, onArchive, onRestore, onOpenHistory,
    onReapWorkspace, layer = true, ...header
  }: HeaderHostProps,
): ReactNode {
  const busy = (header.status ?? header.session?.status ?? null) === 'busy';
  useEscapeInterrupt({ busy, onInterrupt: () => header.onInterrupt('escape-key') });
  return (
    <>
      {layer && <CommandLayer openNewSession={() => {}} />}
      <SessionFlows
        session={header.session}
        title={header.session?.project ?? header.fallback?.title ?? '…'}
        actions={{
          changeModel: onChangeModel,
          changeEffort: onChangeEffort,
          openHistory: onOpenHistory,
          moveAccount: onMoveAccount,
          archive: onArchive,
          restore: onRestore,
          openTerminal: onOpenTerminal,
          reapWorkspace: onReapWorkspace,
        }}
      >
        <SessionHeader {...header} />
      </SessionFlows>
    </>
  );
}
