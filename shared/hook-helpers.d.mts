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
/** D-7049: the second region, the auth-dead marker's writers copied from ccd for `ccd/ccd-account-health`. */
export const AUTHDEAD_REGION_BEGIN: string;
export const AUTHDEAD_REGION_END: string;
export const AUTHDEAD_WRITERS: readonly string[];
/** ccd's whole definition of `name` (its `name() {` line through its column-0 `}`, or a one-line definition), or null. */
export function ccdFunctionDefinition(ccdSrc: string, name: string): string | null;
export function renderAuthdeadBody(ccdSrc: string): string;
/** One generated region: its BEGIN/END lines, the prefix it is recognised by, its report label and its renderer. */
export interface GeneratedRegion {
  readonly name: 'hook' | 'authdead';
  readonly label: string;
  readonly begin: string;
  readonly end: string;
  readonly detect: string;
  readonly render: (ccdSrc: string) => string;
}
export const REGIONS: readonly GeneratedRegion[];
/** The region row `src` carries (whole or damaged), or null. */
export function regionOf(src: string): GeneratedRegion | null;
export function renderRegion(row: GeneratedRegion, ccdSrc: string): string;
export function extractRegion(row: GeneratedRegion, src: string): string | null;
export function applyRegion(row: GeneratedRegion, src: string, ccdSrc: string): string;
export function checkRegion(row: GeneratedRegion, src: string, ccdSrc: string): HookRegionStatus;
