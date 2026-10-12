// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10): `ws-collect`'s confirmation token is a `CollectToken`, and the
// collect audit's reader is the shipped tree's one cast to it. A token from anywhere else is a plain string, and a
// plain string does not compile into `ws-collect`'s argv.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import { CCD_ARGV } from '../../../src/ccdargv.js';

declare const token: string;

void CCD_ARGV.wsCollect(token, 'demo-quiet-mesa', null);
