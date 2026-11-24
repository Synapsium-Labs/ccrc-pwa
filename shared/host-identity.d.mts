import type { HostReport } from './isolation.js';

/** Where the measurer reads; tests pass synthetic trees under the run's temp root. Defaults: `/proc`, `/etc`,
 *  `process.platform`. */
export interface HostRoots { readonly procRoot: string; readonly etcRoot: string; readonly platform: string }
/** The raw ids, for the measuring process's memory only: never logged, never sent. */
export interface HostIds { readonly machine: string | 'unmeasured'; readonly boot: string | 'unmeasured' }
/** Reads `<etcRoot>/machine-id` (32 lowercase hex) and `<procRoot>/sys/kernel/random/boot_id` (a UUID). Off Linux, or
 *  on any read or parse failure, that id is 'unmeasured'. Never throws, never logs. */
export function readHostIds(roots?: Partial<HostRoots>): HostIds;
/** HMAC-SHA-256 under `key` of `ccrc-host-<kind>-v1`, a newline and the value, as lowercase hex. */
export function hostDigest(key: string, kind: 'machine' | 'boot', value: string): string;
/** The report an agent sends: its uid, and each id digested under the bearer, or 'unmeasured'. */
export function hostReportOf(ids: HostIds, uid: number | undefined, key: string): HostReport;
