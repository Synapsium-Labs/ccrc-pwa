import { timingSafeEqual } from 'node:crypto';

// D-7506 (ARCH-05, #551): the constant-time slot matcher, moved verbatim out of `coord/token.ts` so the claim
// door (`token/door.ts#ClaimDoor`, L1) reads it from an L1 file instead of the L3 holder's module;
// `coord/token.ts#BoxTokenHolder` imports it from here. Its only import is `node:crypto`, a pure builtin. It is not in
// `token/policy.ts`, whose header promises it imports nothing but `shared/`.

/**
 * The index of the first slot equal to `presented`, or -1. CONSTANT TIME over
 * the slots: every slot is compared on every call, and each result is folded
 * into numbers with `|=`, so neither which slot matched nor whether any did
 * changes how many compares run. The combine below carries no `||`, `&&`,
 * `||=`, `&&=`, ternary, `return`, `break`, `some` or `find`;
 * `coord-token.test.ts` scans the region between its two markers for each.
 * Every slot and `presented` must be the same length (sha256 digests, 32
 * bytes), which `timingSafeEqual` requires. `compare` is injected by tests to
 * count calls.
 */
export function matchDigestSlots(presented: Buffer, slots: readonly Buffer[],
  compare: (a: Buffer, b: Buffer) => boolean = timingSafeEqual): number {
  let index = 0;
  let found = 0;
  // combine:begin
  for (let i = 0; i < slots.length; i++) {
    const hit = Number(compare(presented, slots[i]!));
    index |= (i + 1) * (hit & (found ^ 1));
    found |= hit;
  }
  // combine:end
  return index - 1;
}
