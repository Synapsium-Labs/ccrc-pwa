// D-5517, D-5751 (accounts plan, Task A1): `RosterWire`'s four lane-kind fields are closed unions or a boolean, so
// none of them can carry free text — a secret, a path, an email. A plain string assigned to each must not compile.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts TS2322 on each marked line, one case per field.
import type { RosterWire } from '../../../../shared/api.js';

declare const s: string;

export const provider: RosterWire['provider'] = s; // field: provider
export const kind: RosterWire['kind'] = s; // field: kind
export const telemetry: RosterWire['telemetry'] = s; // field: telemetry
export const managed: RosterWire['managed'] = s; // field: managed
