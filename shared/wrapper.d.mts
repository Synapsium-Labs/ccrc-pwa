/**
 * Thrown by `generateWrapperBody` for any account it refuses to write a
 * wrapper for. `remedy` is always a non-empty string naming the fix — see
 * `shared/wrapper.mjs` for the exact refusal conditions.
 */
export class WrapperInvalid extends Error {
  remedy: string;
}

/**
 * The finished, UNMARKED text of one generated account's wrapper — the
 * caller runs it through `markGenerated` (`shared/mark.mjs`) to stamp
 * ownership. See `shared/wrapper.mjs` for the emitted shape, the refusal
 * rules (ccrc writes a wrapper only for `execKind: 'generated'`), and why it
 * refuses rather than escapes.
 *
 * @throws {WrapperInvalid}
 */
export function generateWrapperBody(
  account: { id: string; configDirSuffix: string; execKind: string; secretsFile?: string },
  upstreamId: string,
): string;
