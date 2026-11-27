import type { promises } from 'node:fs';

/** The flag an open ORs in to refuse a link at the last component: `constants.O_NOFOLLOW`, or on Windows a marker bit
 *  only this module's `openSync`/`open` read. */
export const O_NOFOLLOW: number;
/** `fs.openSync`, with `O_NOFOLLOW` honoured on Windows too (ELOOP for a link). */
export function openSync(p: string, flags: number, mode?: number): number;
/** `fs.promises.open`, with `O_NOFOLLOW` honoured on Windows too (ELOOP for a link). */
export function open(p: string, flags: number, mode?: number): Promise<promises.FileHandle>;
