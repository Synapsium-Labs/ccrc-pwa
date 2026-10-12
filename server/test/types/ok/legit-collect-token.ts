// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10): the positive control for bypass b7. A `CollectToken` compiles
// into `ws-collect`'s argv, so b7's error is the brand's and not a broken builder. This file MUST compile clean.
import { CCD_ARGV } from '../../../src/ccdargv.js';
import type { CollectToken } from '../../../../shared/api.js';

declare const token: CollectToken;

void CCD_ARGV.wsCollect(token, 'demo-quiet-mesa', null);
