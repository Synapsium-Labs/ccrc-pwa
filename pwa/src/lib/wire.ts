// The PWA's ONE wire-guard kit (ARCH-30, #544). Five hand-copied kits answered "is this an object" and "is this a count"
// in slightly different ways (`Number.isInteger` in one, `Number.isSafeInteger` in another); a reader that wants to know
// what the wire may carry imports it from here. Pure leaf: it imports nothing, so an L1 reader and the fetch adapter
// both take it.

/** A plain object: not null, not an array. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite number. */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A count: a SAFE integer, zero or more. `2 ** 53 + 1` is not one: it cannot be told from its neighbour, so a count
 *  that large is a misread, never a number to render. */
export const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** Membership by `includes`, never `in` or a map lookup: `'toString' in` any object literal is true. */
export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
