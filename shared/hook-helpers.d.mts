/** The hook's project/session-id shape, bounds and read cap: their one definition. */
export const HOOK_CONSTANTS: Readonly<{ CCRC_PROJ_CLASS: string; CCRC_PROJ_MAX: number; CCRC_ID_MAX: number }>;
export const HOOK_REGION_BEGIN: string;
export const HOOK_REGION_END: string;
/** The body of ccd's `_plat_epoch_ms`, or null when ccd has none. */
export function ccdEpochBody(ccdSrc: string): string | null;
/** The region's unstamped body: `_hook_epoch_ms` and the three constants. */
export function renderHookBody(ccdSrc: string): string;
/** The whole stamped region, BEGIN and END lines included. */
export function renderHookRegion(ccdSrc: string): string;
/** The region as the hook carries it, or null. */
export function extractHookRegion(hookSrc: string): string | null;
/** `hookSrc` with its region regenerated from `ccdSrc`. */
export function applyHookRegion(hookSrc: string, ccdSrc: string): string;
export type HookRegionStatus = 'current' | 'missing' | 'edited' | 'stale';
export function checkHookRegion(hookSrc: string, ccdSrc: string): HookRegionStatus;
