// The sign-in gate's one pure question, kept out of SignInGateCard.tsx so an L1 module (sectionStatus.ts) can ask it
// without loading a component (the PWA ring rule, ARCH-04 stage 3, D-6118). SignInGateCard re-exports it.
import type { AuthStatus } from '../../../../shared/api';
import { LOOPBACK_HOSTS } from '../../../../shared/base-url';

/** (D-3298) true iff status?.mode === 'off' exactly AND the page's hostname is not one of shared/base-url.ts's
 *  LOOPBACK_HOSTS: the one list of loopback spellings, reused rather than re-spelled (single-definition.test.ts's
 *  LOOP_SET scan holds that). */
export function unarmedExposure(status: Partial<AuthStatus> | null, hostname: string): boolean {
  return status?.mode === 'off' && !LOOPBACK_HOSTS.includes(hostname);
}
