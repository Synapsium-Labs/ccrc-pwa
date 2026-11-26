// L4, context C4 (landing order wave 5f Task 2; wave 5j-b). The attributed landing writes' and the operator's two doors'
// ONE action: call the store's guarded writer once, then raise the notice `landingMutationNotice` says is due. It gathers no second snapshot and decides no
// graph policy (decide in L1, act here); the notice goes through the `NoticeSink` port, never a feed writer of its own.
// Synchronous on purpose: the store's facts, decision and write are one call with no await between them.
import type { NoticeSink } from '../notice.js';
import {
  landingMutationNotice, type LandingAuthorityCommand, type LandingAuthorityWrite, type LandingAuthorityWriteOf, type LandingNoticeInput,
  type LandingPauseWrite, type LandingWithdrawWrite,
} from './landingWrites.js';

export interface LandingWritePorts {
  /** The store's generic writer (`CoordStore.writeLandingAuthority`): its answer is typed by the command's arm. */
  write: <C extends LandingAuthorityCommand>(command: C, at: number) => LandingAuthorityWriteOf<C>;
  notice: NoticeSink;
}

/** One body, three signatures (wave 5j-b): the attributed writes (the narrowed `landingCommandOf` result) answer
 *  `LandingAuthorityWrite`, a pause `LandingPauseWrite`, a withdrawal `LandingWithdrawWrite`. No union signature: every
 *  caller passes one known arm. */
export function actLandingWrite(command: Extract<LandingAuthorityCommand, { kind: 'entry' | 'order' }>, at: number, ports: LandingWritePorts): LandingAuthorityWrite;
export function actLandingWrite(command: Extract<LandingAuthorityCommand, { kind: 'pause' }>, at: number, ports: LandingWritePorts): LandingPauseWrite;
export function actLandingWrite(command: Extract<LandingAuthorityCommand, { kind: 'withdraw' }>, at: number, ports: LandingWritePorts): LandingWithdrawWrite;
export function actLandingWrite(command: LandingAuthorityCommand, at: number, ports: LandingWritePorts): LandingAuthorityWrite | LandingPauseWrite | LandingWithdrawWrite {
  const result = ports.write(command, at);
  if (!result.ok) return result;
  // The pair is built from one command and the answer the store gave for that command's arm.
  const owed = landingMutationNotice({ command, result } as LandingNoticeInput);
  if (owed.due) ports.notice(owed.event, 'record-only');
  return result;
}
