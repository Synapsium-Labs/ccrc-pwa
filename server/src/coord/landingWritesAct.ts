// L4, context C4 (landing order wave 5f Task 2). The attributed landing writes' ONE action: call the store's guarded
// writer once, then raise the notice `landingMutationNotice` says is due. It gathers no second snapshot and decides no
// graph policy (decide in L1, act here); the notice goes through the `NoticeSink` port, never a feed writer of its own.
// Synchronous on purpose: the store's facts, decision and write are one call with no await between them.
import type { NoticeSink } from '../notice.js';
import {
  landingMutationNotice, type LandingAuthorityCommand, type LandingAuthorityWrite,
} from './landingWrites.js';

export interface LandingWritePorts {
  write: (command: LandingAuthorityCommand, at: number) => LandingAuthorityWrite;
  notice: NoticeSink;
}

export function actLandingWrite(command: LandingAuthorityCommand, at: number, ports: LandingWritePorts): LandingAuthorityWrite {
  const result = ports.write(command, at);
  if (!result.ok) return result;
  const owed = landingMutationNotice(command, result);
  if (owed.due) ports.notice(owed.event, 'record-only');
  return result;
}
