// FLEET DISK RETENTION DR-18 (D-6630): `ws-orphan`'s confirmation token is an `OrphanToken`, and the orphan lane's audit
// reader is the one place that casts to it. A token from anywhere else is a plain string, and a plain string does not
// compile into `ws-orphan`'s argv.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import { CCD_ARGV } from '../../../src/ccdargv.js';

declare const token: string;

void CCD_ARGV.wsOrphan(token, '2f61', false, null);
