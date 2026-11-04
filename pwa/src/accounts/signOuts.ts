// THE SIGN-OUTS THIS APP RAN (accounts plan Task A38, D-7872 (2), (10)). N5's sign-out removes a sign-in lane's
// credential on the fleet host, and the box clears the lane's check and nothing else; the server does not say the lane
// has no credential. So a lane as the screen last read it can still show the passing check from before the sign-out.
// This record holds, per lane, the last check the app knew of at the sign-out (`checkAt`, the box's clock), so that no
// sheet opened later on the lane says it keeps its old credential on that check (`oldCredentialOf`, connectFlow.ts).
// It is the app's memory alone: a reload or another device forgets it, and the rule's neutral words cover that.
//
// Writers: the re-auth sheet's and the connect sheet's Sign this lane out and start again, on any answer that may have
// signed the lane out (removed, absent, or a request that never completed), whether or not the sheet is still open.
// Readers: every sheet that speaks of the lane's old credential (the re-auth and method switch sheets), through
// `oldCredentialOf`.
import type { SignOutRecord } from './connectFlow';

const signOuts = new Map<string, SignOutRecord>();

/** A sign-out this app ran on lane `id`, with the last check of it known then. */
export function noteSignOut(id: string, checkAt: number | undefined): void {
  signOuts.set(id, checkAt !== undefined ? { checkAt } : {});
}
/** The sign-out this app ran on lane `id`, if it knows of one. */
export function signOutOf(id: string): SignOutRecord | undefined { return signOuts.get(id); }
/** The lane has a credential again (installed here, or a passing check newer than the sign-out): the record retires. */
export function forgetSignOut(id: string): void { signOuts.delete(id); }
export function resetSignOutsForTests(): void { signOuts.clear(); }
